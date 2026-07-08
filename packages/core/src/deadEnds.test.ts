import { describe, expect, it } from 'vitest';
import {
  applyCommand,
  createBoardFromRows,
  createPublicGameProjection,
  createRectTemplate,
  createRound,
  createTheme,
  isBufferAtDeadEnd,
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

const now = '2026-07-06T00:00:00.000Z';

describe('dead-end detection', () => {
  it('treats a non-empty buffer as a dead end only when no available word form has that prefix', () => {
    const theme = createTheme({
      id: 'movies',
      language: 'ru',
      title: 'Фильмы',
      words: [
        { canonical: 'терминатор' },
        { canonical: 'джокер' },
      ],
    });

    expect(isBufferAtDeadEnd({ theme, buffer: '' })).toBe(false);
    expect(isBufferAtDeadEnd({ theme, buffer: 'термина' })).toBe(false);
    expect(isBufferAtDeadEnd({ theme, buffer: 'терминак' })).toBe(true);
  });

  it('uses aliases as available prefixes', () => {
    const theme = createTheme({
      id: 'movies',
      language: 'en',
      title: 'Movies',
      words: [
        { canonical: 'terminator', aliases: ['the terminator'] },
      ],
    });

    expect(isBufferAtDeadEnd({ theme, buffer: 'the term' })).toBe(false);
    expect(isBufferAtDeadEnd({ theme, buffer: 'the worm' })).toBe(true);
  });

  it('excludes words already accepted by this player from availability', () => {
    const theme = createTheme({
      id: 'space',
      language: 'ru',
      title: 'Космос',
      words: [
        { canonical: 'марс' },
      ],
    });

    expect(isBufferAtDeadEnd({ theme, buffer: 'марс' })).toBe(false);
    expect(isBufferAtDeadEnd({
      theme,
      buffer: 'марс',
      acceptedWordIds: [theme.words[0]!.id],
    })).toBe(true);
  });

  it('adds a participant flag only when warnings are enabled', () => {
    const state = createDeadEndRound(false);
    activateAt(state, player, { row: 0, col: 0 }, 'max');

    const withoutWarning = createPublicGameProjection(state);
    expect(withoutWarning.participantPanel[0]!.flags).toEqual([]);

    const enabledState = createDeadEndRound(true);
    activateAt(enabledState, player, { row: 0, col: 0 }, 'max');

    const withWarning = createPublicGameProjection(enabledState);
    expect(withWarning.participantPanel[0]!.flags).toEqual(['deadEnd']);
  });

  it('emits a dead-end event only after a valid move enters a dead end with warnings enabled', () => {
    const state = createDeadEndRound(true);
    activateAt(state, player, { row: 0, col: 0 }, 'ma');

    const result = apply(state, player, '!r1');

    expect(result.state.players[playerIdFromIdentity(player)]!.buffer).toBe('max');
    expect(result.events).toContainEqual(expect.objectContaining({
      type: 'player.deadEndDetected',
      playerId: playerIdFromIdentity(player),
      buffer: 'max',
    }));

    const disabledState = createDeadEndRound(false);
    activateAt(disabledState, player, { row: 0, col: 0 }, 'ma');

    const disabledResult = apply(disabledState, player, '!r1');
    expect(disabledResult.events).not.toContainEqual(expect.objectContaining({
      type: 'player.deadEndDetected',
    }));
  });
});

function createDeadEndRound(warnOnDeadEnd: boolean): RoundState {
  return createRound({
    id: warnOnDeadEnd ? 'dead-end-on' : 'dead-end-off',
    theme: createTheme({
      id: 'space',
      language: 'en',
      title: 'Space',
      minWordLength: 2,
      words: [
        { canonical: 'mars' },
      ],
    }),
    boardTemplate: createRectTemplate(2, 1),
    board: createBoardFromRows(['.x']),
    seed: 'dead-end',
    settings: { warnOnDeadEnd },
  });
}

function activateAt(
  state: RoundState,
  identity: PlayerIdentity,
  position: { row: number; col: number },
  buffer: string,
): void {
  const joined = apply(state, identity, '!play').state;
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
