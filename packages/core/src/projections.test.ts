import { describe, expect, it } from 'vitest';
import {
  applyCommand,
  createAdminGameProjection,
  createBoardFromRows,
  createPublicGameProjection,
  createRectTemplate,
  createRound,
  createTheme,
  parseChatCommand,
  playerIdFromIdentity,
  type PlayerIdentity,
  type RoundState,
} from './index.js';

const player: PlayerIdentity = {
  provider: 'fake',
  providerUserId: 'mortikon',
  login: 'mortikon',
  displayName: 'Mortikon',
  color: '#44aa66',
};

const otherPlayer: PlayerIdentity = {
  provider: 'fake',
  providerUserId: 'eugene',
  login: 'eugene',
  displayName: 'Eugene_80286',
  color: '#6688cc',
};

const now = '2026-07-06T00:00:00.000Z';

describe('game projections', () => {
  it('creates a public projection without admin-only rejected submissions', () => {
    const state = createProjectionRound();
    activateAt(state, player, { row: 0, col: 0 }, 'лу');
    const playerId = playerIdFromIdentity(player);

    state.players[playerId]!.score = 30;

    const projection = createPublicGameProjection(state);

    expect(projection).toMatchObject({
      roundId: 'projection',
      roundStatus: 'running',
      locale: 'ru',
      themeTitle: 'Лягушки',
    });
    expect(projection.board.cells[0]![1]).toEqual({
      id: '0:1',
      row: 0,
      col: 1,
      kind: 'blocked',
    });
    expect(projection.players).toContainEqual({
      playerId,
      displayName: 'Mortikon',
      markerColor: '#44aa66',
      row: 0,
      col: 0,
      bufferLength: 2,
    });
    expect(projection.participantPanel[0]).toMatchObject({
      playerId,
      displayName: 'Mortikon',
      score: 30,
      buffer: 'лу',
      flags: [],
    });
    expect(projection.commandHints.map((hint) => hint.command)).toContain('!играть');
    expect(Object.prototype.hasOwnProperty.call(projection, 'rejectedSubmissions')).toBe(false);
  });

  it('creates an admin projection with pending rejected submissions', () => {
    const state = createProjectionRound();
    activateAt(state, player, { row: 0, col: 0 }, 'интрепель');

    const result = apply(state, player, '!слово');
    const projection = createAdminGameProjection(result.state);

    expect(projection.rejectedSubmissions).toHaveLength(1);
    expect(projection.rejectedSubmissions[0]).toMatchObject({
      playerId: playerIdFromIdentity(player),
      playerDisplayName: 'Mortikon',
      rawWord: 'интрепель',
      normalizedWord: 'интрепель',
      reason: 'word_not_found',
      status: 'pending',
    });
    expect(projection.playersAdmin[0]).toMatchObject({
      login: 'mortikon',
      buffer: 'интрепель',
      bufferLength: 9,
    });
  });

  it('can hide current buffers from public participant rows', () => {
    const state = createProjectionRound();
    activateAt(state, player, { row: 0, col: 0 }, 'лу');

    const projection = createPublicGameProjection(state, { showCurrentBuffers: false });

    expect(projection.participantPanel[0]!.bufferLength).toBe(2);
    expect(Object.prototype.hasOwnProperty.call(projection.participantPanel[0], 'buffer')).toBe(false);
  });

  it('sorts participant and leaderboard rows by score, then active status, then display name', () => {
    const state = createProjectionRound();
    activateAt(state, player, { row: 0, col: 0 }, '');
    activateAt(state, otherPlayer, { row: 1, col: 0 }, '');

    const playerState = state.players[playerIdFromIdentity(player)]!;
    const otherPlayerState = state.players[playerIdFromIdentity(otherPlayer)]!;
    playerState.score = 10;
    otherPlayerState.score = 50;
    otherPlayerState.status = 'left';

    const projection = createPublicGameProjection(state, { locale: 'en' });

    expect(projection.participantPanel.map((row) => row.displayName)).toEqual([
      'Eugene_80286',
      'Mortikon',
    ]);
    expect(projection.leaderboard.map((row) => [row.rank, row.displayName])).toEqual([
      [1, 'Eugene_80286'],
      [2, 'Mortikon'],
    ]);
    expect(projection.commandHints.map((hint) => hint.command)).toContain('!play');
  });

  it('projects found words with player display names and newest entries first', () => {
    const state = createProjectionRound();
    activateAt(state, player, { row: 0, col: 0 }, 'луна');

    const result = apply(state, player, '!слово');
    const projection = createPublicGameProjection(result.state);

    expect(projection.foundWords[0]).toMatchObject({
      playerId: playerIdFromIdentity(player),
      playerDisplayName: 'Mortikon',
      canonical: 'луна',
      points: 40,
      source: 'manual',
      acceptedAt: now,
    });
  });
});

function createProjectionRound(): RoundState {
  return createRound({
    id: 'projection',
    theme: createTheme({
      id: 'frogs',
      language: 'ru',
      title: 'Лягушки',
      minWordLength: 2,
      words: [
        { canonical: 'луна' },
        { canonical: 'ас' },
      ],
    }),
    boardTemplate: createRectTemplate(3, 2),
    board: createBoardFromRows(['.#а', '..с']),
    seed: 'projection',
  });
}

function activateAt(
  state: RoundState,
  identity: PlayerIdentity,
  position: { row: number; col: number },
  buffer: string,
): void {
  const joined = apply(state, identity, '!играть').state;
  Object.assign(state, joined);

  const playerState = state.players[playerIdFromIdentity(identity)]!;
  playerState.position = position;
  playerState.buffer = buffer;
  playerState.path = [];
  playerState.collectedLetterCellIds = [];
}

function apply(state: RoundState, identity: PlayerIdentity, text: string) {
  return applyCommand(state, {
    player: identity,
    command: parseChatCommand(text),
    receivedAt: now,
  });
}
