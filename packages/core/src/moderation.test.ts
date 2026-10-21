import { describe, expect, it } from 'vitest';
import {
  applyCommand,
  applyHostAction,
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

const now = '2026-07-06T00:00:00.000Z';
const later = '2026-07-06T00:01:00.000Z';

describe('host moderation actions', () => {
  it('kicks a player from the current round without losing score history', () => {
    const state = createModerationRound();
    activateAt(state, player, { row: 0, col: 0 }, 'ma');
    const playerId = playerIdFromIdentity(player);
    state.players[playerId]!.score = 90;
    state.players[playerId]!.acceptedWordIds = ['space:word:0'];

    const result = applyHostAction(state, {
      kind: 'kickPlayer',
      playerId,
      actedAt: later,
      reason: 'griefing',
    });
    const playerState = result.state.players[playerId]!;

    expect(playerState.status).toBe('kicked');
    expect(playerState.position).toBeUndefined();
    expect(playerState.buffer).toBe('');
    expect(playerState.path).toEqual([]);
    expect(playerState.score).toBe(90);
    expect(playerState.acceptedWordIds).toEqual(['space:word:0']);
    expect(result.events).toContainEqual(expect.objectContaining({
      type: 'player.left',
      playerId,
      reason: 'kick',
    }));

    const rejoin = apply(result.state, player, '!play');
    expect(rejoin.events).toContainEqual(expect.objectContaining({
      type: 'command.rejected',
      playerId,
      reason: 'player_kicked',
    }));
  });

  it('adds a local ban, clears round presence, and blocks future player commands', () => {
    const state = createModerationRound();
    activateAt(state, player, { row: 0, col: 0 }, 'ma');
    const playerId = playerIdFromIdentity(player);

    const result = applyHostAction(state, {
      kind: 'banPlayer',
      playerId,
      actedAt: later,
      reason: 'local blocklist test',
    });
    const playerState = result.state.players[playerId]!;

    expect(playerState.status).toBe('blocked');
    expect(playerState.position).toBeUndefined();
    expect(playerState.buffer).toBe('');
    expect(result.state.blockedPlayers[playerId]).toMatchObject({
      playerId,
      blockedAt: later,
      reason: 'local blocklist test',
      identity: {
        login: 'mortikon',
        displayName: 'Mortikon',
      },
    });
    expect(result.events).toContainEqual(expect.objectContaining({
      type: 'player.blocked',
      playerId,
      blockedAt: later,
    }));

    const commandAfterBan = apply(result.state, player, '!play');
    expect(commandAfterBan.events).toContainEqual(expect.objectContaining({
      type: 'command.rejected',
      playerId,
      reason: 'player_blocked',
    }));
  });

  it('unbans a player and allows them to join again', () => {
    const state = createModerationRound();
    activateAt(state, player, { row: 0, col: 0 }, 'ma');
    const playerId = playerIdFromIdentity(player);
    const banned = applyHostAction(state, { kind: 'banPlayer', playerId, actedAt: later }).state;

    const unbanned = applyHostAction(banned, {
      kind: 'unbanPlayer',
      playerId,
      actedAt: '2026-07-06T00:02:00.000Z',
    });

    expect(unbanned.state.blockedPlayers[playerId]).toBeUndefined();
    expect(unbanned.state.players[playerId]!.status).toBe('left');
    expect(unbanned.events).toContainEqual(expect.objectContaining({
      type: 'player.unblocked',
      playerId,
    }));

    const rejoin = apply(unbanned.state, player, '!play');
    expect(rejoin.state.players[playerId]!.status).toBe('active');
    expect(rejoin.events).toContainEqual(expect.objectContaining({
      type: 'player.joined',
      playerId,
    }));
  });

  it('exposes local blocklist only in admin projection', () => {
    const state = createModerationRound();
    activateAt(state, player, { row: 0, col: 0 }, 'ma');
    const playerId = playerIdFromIdentity(player);
    const banned = applyHostAction(state, {
      kind: 'banPlayer',
      playerId,
      actedAt: later,
      reason: 'projection test',
    }).state;

    const publicProjection = createPublicGameProjection(banned);
    const adminProjection = createAdminGameProjection(banned);

    expect(Object.prototype.hasOwnProperty.call(publicProjection, 'blockedPlayers')).toBe(false);
    expect(adminProjection.blockedPlayers).toHaveLength(1);
    expect(adminProjection.blockedPlayers[0]).toMatchObject({
      playerId,
      displayName: 'Mortikon',
      reason: 'projection test',
    });
  });

  it('rejects moderation actions that do not match player state', () => {
    const state = createModerationRound();
    const playerId = playerIdFromIdentity(player);

    const kickMissing = applyHostAction(state, {
      kind: 'kickPlayer',
      playerId,
      actedAt: later,
    });

    expect(kickMissing.events).toContainEqual(expect.objectContaining({
      type: 'hostAction.rejected',
      action: 'kick',
      playerId,
      reason: 'player_not_found',
    }));

    const unbanMissing = applyHostAction(state, {
      kind: 'unbanPlayer',
      playerId,
      actedAt: later,
    });

    expect(unbanMissing.events).toContainEqual(expect.objectContaining({
      type: 'hostAction.rejected',
      action: 'unban',
      playerId,
      reason: 'player_not_blocked',
    }));
  });
});

function createModerationRound(): RoundState {
  return createRound({
    id: 'moderation',
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
    board: createBoardFromRows(['..']),
    seed: 'moderation',
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
  playerState.path = [position];
  playerState.collectedLetterCellIds = [];
}

function apply(state: RoundState, identity: PlayerIdentity, text: string) {
  return applyCommand(state, {
    player: identity,
    command: parseChatCommand(text),
    receivedAt: now,
  });
}
