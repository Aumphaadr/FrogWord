import type {
  ApplyResult,
  BlockedPlayer,
  DomainEvent,
  PlayerId,
  PlayerState,
  RoundState,
} from './types.js';

export type HostAction =
  | { kind: 'kickPlayer'; playerId: PlayerId; actedAt: string; reason?: string }
  | { kind: 'banPlayer'; playerId: PlayerId; actedAt: string; reason?: string }
  | { kind: 'unbanPlayer'; playerId: PlayerId; actedAt: string };

export function applyHostAction(state: RoundState, action: HostAction): ApplyResult {
  const next = cloneState(state);

  switch (action.kind) {
    case 'kickPlayer':
      return kickPlayer(next, action);
    case 'banPlayer':
      return banPlayer(next, action);
    case 'unbanPlayer':
      return unbanPlayer(next, action);
  }
}

function kickPlayer(
  state: RoundState,
  action: Extract<HostAction, { kind: 'kickPlayer' }>,
): ApplyResult {
  const player = state.players[action.playerId];
  const events: DomainEvent[] = [];

  if (!player) {
    events.push(nextEvent(state, {
      type: 'hostAction.rejected',
      action: 'kick',
      playerId: action.playerId,
      reason: 'player_not_found',
    }));
    return { state, events };
  }

  if (player.status === 'blocked') {
    events.push(nextEvent(state, {
      type: 'hostAction.rejected',
      action: 'kick',
      playerId: action.playerId,
      reason: 'player_blocked',
    }));
    return { state, events };
  }

  clearPlayerPresence(player, 'kicked', action.actedAt);
  events.push(nextEvent(state, { type: 'player.bufferCleared', playerId: player.id, reason: 'kick' }));
  events.push(nextEvent(state, { type: 'player.left', playerId: player.id, reason: 'kick' }));
  return { state, events };
}

function banPlayer(
  state: RoundState,
  action: Extract<HostAction, { kind: 'banPlayer' }>,
): ApplyResult {
  const player = state.players[action.playerId];
  const events: DomainEvent[] = [];

  if (state.blockedPlayers[action.playerId] || player?.status === 'blocked') {
    events.push(nextEvent(state, {
      type: 'hostAction.rejected',
      action: 'ban',
      playerId: action.playerId,
      reason: 'player_already_blocked',
    }));
    return { state, events };
  }

  state.blockedPlayers[action.playerId] = createBlockedPlayer(action, player);

  if (player) {
    clearPlayerPresence(player, 'blocked', action.actedAt);
    events.push(nextEvent(state, { type: 'player.bufferCleared', playerId: player.id, reason: 'ban' }));
    events.push(nextEvent(state, { type: 'player.left', playerId: player.id, reason: 'ban' }));
  }

  events.push(nextEvent(state, {
    type: 'player.blocked',
    playerId: action.playerId,
    blockedAt: action.actedAt,
    ...(action.reason ? { reason: action.reason } : {}),
  }));
  return { state, events };
}

function unbanPlayer(
  state: RoundState,
  action: Extract<HostAction, { kind: 'unbanPlayer' }>,
): ApplyResult {
  const player = state.players[action.playerId];
  const isBlocked = Boolean(state.blockedPlayers[action.playerId]) || player?.status === 'blocked';
  const events: DomainEvent[] = [];

  if (!isBlocked) {
    events.push(nextEvent(state, {
      type: 'hostAction.rejected',
      action: 'unban',
      playerId: action.playerId,
      reason: 'player_not_blocked',
    }));
    return { state, events };
  }

  delete state.blockedPlayers[action.playerId];

  if (player?.status === 'blocked') {
    player.status = 'left';
    player.lastActionAt = action.actedAt;
  }

  events.push(nextEvent(state, {
    type: 'player.unblocked',
    playerId: action.playerId,
    unblockedAt: action.actedAt,
  }));
  return { state, events };
}

function clearPlayerPresence(
  player: PlayerState,
  status: Extract<PlayerState['status'], 'kicked' | 'blocked'>,
  now: string,
): void {
  player.buffer = '';
  player.path = [];
  player.collectedLetterCellIds = [];
  delete player.position;
  player.status = status;
  player.lastActionAt = now;
}

function createBlockedPlayer(
  action: Extract<HostAction, { kind: 'banPlayer' }>,
  player: PlayerState | undefined,
): BlockedPlayer {
  return {
    playerId: action.playerId,
    ...(player ? { identity: { ...player.identity } } : {}),
    blockedAt: action.actedAt,
    ...(action.reason ? { reason: action.reason } : {}),
  };
}

function nextEvent<T extends Omit<DomainEvent, 'seq'>>(state: RoundState, event: T): T & { seq: number } {
  state.eventSeq += 1;
  return { ...event, seq: state.eventSeq };
}

function cloneState(state: RoundState): RoundState {
  return JSON.parse(JSON.stringify(state)) as RoundState;
}
