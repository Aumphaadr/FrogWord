import { describe, expect, it } from 'vitest';
import {
  applyCommand,
  createBoardFromRows,
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
};

const otherPlayer: PlayerIdentity = {
  provider: 'fake',
  providerUserId: 'eugene',
  login: 'eugene',
  displayName: 'Eugene_80286',
};

const now = '2026-07-06T00:00:00.000Z';

describe('command parser', () => {
  it('parses Russian and English aliases plus batched movement', () => {
    expect(parseChatCommand('!играть')).toEqual({ kind: 'join' });
    expect(parseChatCommand('!play')).toEqual({ kind: 'join' });
    expect(parseChatCommand('!сброс')).toEqual({ kind: 'reset' });
    expect(parseChatCommand('!quit')).toEqual({ kind: 'quit' });
    expect(parseChatCommand('!фрогворд')).toEqual({ kind: 'help' });

    expect(parseChatCommand('!в2 п4 d3 l1')).toEqual({
      kind: 'moveSequence',
      moves: [
        { direction: 'up', distance: 2, raw: 'в2' },
        { direction: 'right', distance: 4, raw: 'п4' },
        { direction: 'down', distance: 3, raw: 'd3' },
        { direction: 'left', distance: 1, raw: 'l1' },
      ],
    });
  });

  it('rejects more than fifteen moves in one message', () => {
    const command = parseChatCommand(`!${Array.from({ length: 16 }, () => 'п1').join(' ')}`);

    expect(command).toMatchObject({ kind: 'unknown', reason: 'too_many_moves' });
  });
});

describe('round engine', () => {
  it('auto-accepts exact words only at the end of a message', () => {
    const state = createPrefixRound();
    activateAt(state, player, { row: 0, col: 0 }, 'мар');

    const singleJump = apply(state, player, '!п1');
    const playerId = playerIdFromIdentity(player);

    expect(singleJump.state.foundWords).toHaveLength(1);
    expect(singleJump.state.foundWords[0]).toMatchObject({
      playerId,
      canonical: 'марс',
      source: 'auto',
    });
    expect(singleJump.state.players[playerId]!.buffer).toBe('');

    const batchedState = createPrefixRound();
    activateAt(batchedState, player, { row: 0, col: 0 }, 'мар');

    const batch = apply(batchedState, player, '!п1 п1 п1');

    expect(batch.state.foundWords).toHaveLength(0);
    expect(batch.state.players[playerId]!.buffer).toBe('марсиа');
  });

  it('does not grant the same word twice to one player but allows another player', () => {
    const state = createScoringRound();
    activateAt(state, player, { row: 0, col: 0 }, 'протазан');
    let result = apply(state, player, '!слово');
    const playerId = playerIdFromIdentity(player);

    expect(result.state.players[playerId]!.score).toBe(120);

    result.state.players[playerId]!.buffer = 'протазан';
    result = apply(result.state, player, '!слово');
    expect(result.state.players[playerId]!.score).toBe(120);
    expect(result.state.players[playerId]!.buffer).toBe('протазан');

    activateAt(result.state, otherPlayer, { row: 0, col: 0 }, 'протазан');
    result = apply(result.state, otherPlayer, '!слово');
    expect(result.state.players[playerIdFromIdentity(otherPlayer)]!.score).toBe(120);
  });

  it('keeps player buffer and position when a manual word is not in the theme', () => {
    const state = createScoringRound();
    activateAt(state, player, { row: 0, col: 0 }, 'интрепель');

    const result = apply(state, player, '!слово');
    const playerState = result.state.players[playerIdFromIdentity(player)]!;

    expect(result.state.rejectedSubmissions).toHaveLength(1);
    expect(result.state.rejectedSubmissions[0]).toMatchObject({
      rawWord: 'интрепель',
      status: 'pending',
      reason: 'word_not_found',
    });
    expect(playerState.buffer).toBe('интрепель');
    expect(playerState.position).toEqual({ row: 0, col: 0 });
  });

  it('rejects a whole movement batch if it crosses a blocked cell', () => {
    const state = createRound({
      id: 'blocked',
      theme: createTheme({
        id: 'theme',
        language: 'ru',
        title: 'Theme',
        words: [{ canonical: 'а' }],
      }),
      boardTemplate: createRectTemplate(3, 1),
      board: createBoardFromRows(['.#а']),
      seed: 'blocked',
    });
    activateAt(state, player, { row: 0, col: 0 }, '');

    const result = apply(state, player, '!п2');
    const playerState = result.state.players[playerIdFromIdentity(player)]!;

    expect(result.events).toContainEqual(expect.objectContaining({
      type: 'command.rejected',
      reason: 'blocked_path',
    }));
    expect(playerState.position).toEqual({ row: 0, col: 0 });
    expect(playerState.buffer).toBe('');
  });

  it('preserves the number of empty cells inside the accepted path refill', () => {
    const state = createRound({
      id: 'refill',
      theme: createTheme({
        id: 'short-words',
        language: 'ru',
        title: 'Short Words',
        minWordLength: 2,
        words: [{ canonical: 'ри' }],
      }),
      boardTemplate: createRectTemplate(3, 1),
      board: createBoardFromRows(['.ри']),
      seed: 'refill',
    });
    activateAt(state, player, { row: 0, col: 0 }, 'ри');
    const playerState = state.players[playerIdFromIdentity(player)]!;
    playerState.path = [{ row: 0, col: 0 }, { row: 0, col: 1 }, { row: 0, col: 2 }];

    const result = apply(state, player, '!слово');
    const refilledCells = result.state.board.cells[0]!.slice(0, 3);

    expect(result.state.foundWords).toHaveLength(1);
    expect(refilledCells.filter((cell) => cell.kind === 'empty')).toHaveLength(1);
  });

  it('keeps the player on the last collected letter cell after accepting a word', () => {
    const state = createRound({
      id: 'stay-put',
      theme: createTheme({
        id: 'short-words',
        language: 'ru',
        title: 'Short Words',
        minWordLength: 2,
        words: [{ canonical: 'ри' }],
      }),
      boardTemplate: createRectTemplate(3, 1),
      board: createBoardFromRows(['.ри']),
      seed: 'stay-put',
    });
    activateAt(state, player, { row: 0, col: 0 }, '');

    const result = apply(state, player, '!п1 п1');
    const playerState = result.state.players[playerIdFromIdentity(player)]!;

    expect(result.state.foundWords).toHaveLength(1);
    expect(playerState.position).toEqual({ row: 0, col: 2 });
    expect(result.state.board.cells[0]![2]!.kind).toBe('empty');
    expect(result.state.board.cells[0]![1]!.kind).toBe('letter');
  });

  it('lets a player quit without losing their score', () => {
    const state = createScoringRound();
    activateAt(state, player, { row: 0, col: 0 }, 'протазан');
    const scored = apply(state, player, '!слово');
    const result = apply(scored.state, player, '!уйти');
    const playerState = result.state.players[playerIdFromIdentity(player)]!;

    expect(playerState.status).toBe('left');
    expect(playerState.position).toBeUndefined();
    expect(playerState.score).toBe(120);
    expect(result.events).toContainEqual(expect.objectContaining({
      type: 'player.left',
      reason: 'quit',
    }));
  });
});

function createPrefixRound(): RoundState {
  return createRound({
    id: 'prefix',
    theme: createTheme({
      id: 'space',
      language: 'ru',
      title: 'Space',
      minWordLength: 3,
      words: [
        { canonical: 'марс' },
        { canonical: 'марсианин' },
      ],
    }),
    boardTemplate: createRectTemplate(4, 1),
    board: createBoardFromRows(['.сиа']),
    seed: 'prefix',
  });
}

function createScoringRound(): RoundState {
  return createRound({
    id: 'scoring',
    theme: createTheme({
      id: 'weapons',
      language: 'ru',
      title: 'Weapons',
      words: [
        { canonical: 'кольчуга' },
        { canonical: 'протазан', expertiseTier: 2 },
      ],
    }),
    boardTemplate: createRectTemplate(2, 1),
    board: createBoardFromRows(['..']),
    seed: 'scoring',
  });
}

function activateAt(state: RoundState, identity: PlayerIdentity, position: { row: number; col: number }, buffer: string): void {
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
