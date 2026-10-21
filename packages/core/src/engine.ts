import type {
  ApplyResult,
  BlockedPlayer,
  Board,
  BoardTemplate,
  Coord,
  Direction,
  DomainEvent,
  ParsedCommand,
  PlayerCommand,
  PlayerId,
  PlayerIdentity,
  PlayerState,
  RejectedSubmission,
  RoundSettings,
  RoundState,
  Theme,
  ThemeWord,
} from './types.js';
import { createBoard, emptyCoords, getCell, hasBlockedCellBetween, refillPathCells, sameCoord } from './board.js';
import { isPlayerAtDeadEnd } from './deadEnds.js';
import { createRng } from './rng.js';
import { createThemeIndex, normalizeWord, scoreWord } from './words.js';

const DEFAULT_SETTINGS: RoundSettings = {
  maxJumpDistance: 10,
  maxMovesPerMessage: 15,
  emptyCellRatio: 0.15,
  duplicatePolicy: 'perPlayerUnique',
  lockMode: 'positionOnly',
  warnOnDeadEnd: false,
};

export function createRound(input: {
  id: string;
  theme: Theme;
  boardTemplate: BoardTemplate;
  seed: string;
  settings?: Partial<RoundSettings>;
  board?: Board;
  blockedPlayers?: Record<PlayerId, BlockedPlayer>;
}): RoundState {
  const settings = { ...DEFAULT_SETTINGS, ...input.settings };
  const rng = createRng(input.seed);
  const board = input.board ?? createBoard({
    template: input.boardTemplate,
    theme: input.theme,
    rng,
    seed: input.seed,
    emptyCellRatio: settings.emptyCellRatio,
  });

  return {
    id: input.id,
    status: 'running',
    theme: input.theme,
    board,
    players: {},
    blockedPlayers: cloneBlockedPlayers(input.blockedPlayers ?? {}),
    foundWords: [],
    rejectedSubmissions: [],
    settings,
    eventSeq: 0,
    rngState: rng.state(),
  };
}

export function applyCommand(state: RoundState, command: PlayerCommand): ApplyResult {
  const next = cloneState(state);
  const events: DomainEvent[] = [];
  const playerId = playerIdFromIdentity(command.player);

  if (next.status !== 'running') {
    events.push(nextEvent(next, { type: 'command.rejected', playerId, reason: 'round_not_running' }));
    return { state: next, events };
  }

  if (isPlayerBlocked(next, playerId)) {
    events.push(nextEvent(next, { type: 'command.rejected', playerId, reason: 'player_blocked' }));
    return { state: next, events };
  }

  switch (command.command.kind) {
    case 'join':
      return joinPlayer(next, command.player, command.receivedAt);
    case 'moveSequence':
      return movePlayer(next, command.player, command.command, command.receivedAt);
    case 'submitCurrentBuffer':
      return submitCurrentBuffer(next, command.player, command.receivedAt, 'manual');
    case 'reset':
      return resetPlayer(next, command.player, command.receivedAt);
    case 'quit':
      return quitPlayer(next, command.player, command.receivedAt);
    case 'help':
      events.push(nextEvent(next, { type: 'command.rejected', playerId, reason: 'help_not_implemented' }));
      return { state: next, events };
    case 'unknown':
      events.push(nextEvent(next, {
        type: 'command.rejected',
        playerId,
        reason: command.command.reason,
        ...(command.command.raw ? { raw: command.command.raw } : {}),
      }));
      return { state: next, events };
  }
}

export function playerIdFromIdentity(identity: PlayerIdentity): PlayerId {
  return `${identity.provider}:${identity.providerUserId}`;
}

function joinPlayer(state: RoundState, identity: PlayerIdentity, now: string): ApplyResult {
  const playerId = playerIdFromIdentity(identity);
  const existing = state.players[playerId];
  const events: DomainEvent[] = [];

  if (existing?.status === 'kicked') {
    events.push(nextEvent(state, { type: 'command.rejected', playerId, reason: 'player_kicked' }));
    return { state, events };
  }

  const position = spawnPlayer(state);

  if (!position) {
    events.push(nextEvent(state, { type: 'command.rejected', playerId, reason: 'no_spawn_available' }));
    return { state, events };
  }

  state.players[playerId] = {
    id: playerId,
    identity,
    markerColor: identity.color ?? '#5aba72',
    status: 'active',
    position,
    buffer: existing?.buffer ?? '',
    path: existing?.path ?? [],
    collectedLetterCellIds: existing?.collectedLetterCellIds ?? [],
    acceptedWordIds: existing?.acceptedWordIds ?? [],
    score: existing?.score ?? 0,
    lastActionAt: now,
  };

  events.push(nextEvent(state, { type: 'player.joined', playerId, position }));
  return { state, events };
}

function movePlayer(
  state: RoundState,
  identity: PlayerIdentity,
  command: Extract<ParsedCommand, { kind: 'moveSequence' }>,
  now: string,
): ApplyResult {
  const playerId = playerIdFromIdentity(identity);
  const player = state.players[playerId];
  const events: DomainEvent[] = [];

  if (!player || player.status !== 'active' || !player.position) {
    events.push(nextEvent(state, { type: 'command.rejected', playerId, reason: 'player_not_active' }));
    return { state, events };
  }

  if (command.moves.length > state.settings.maxMovesPerMessage) {
    events.push(nextEvent(state, { type: 'command.rejected', playerId, reason: 'too_many_moves' }));
    return { state, events };
  }

  let simulatedPosition = player.position;
  let simulatedBuffer = player.buffer;
  const simulatedPath = [...player.path];
  const simulatedLetterCellIds = [...player.collectedLetterCellIds];
  const moveEvents: DomainEvent[] = [];
  const wasDeadEnd = isDeadEndWarningActive(state, player);

  for (const move of command.moves) {
    const target = targetCoord(simulatedPosition, move.direction, move.distance);
    const rejection = validateMove(state, playerId, simulatedPosition, target, move.distance);

    if (rejection) {
      events.push(nextEvent(state, { type: 'command.rejected', playerId, reason: rejection, raw: move.raw }));
      return { state, events };
    }

    const cell = getCell(state.board, target);
    if (cell?.kind === 'letter') {
      simulatedBuffer += cell.char;
      simulatedLetterCellIds.push(cell.id);
    }

    simulatedPath.push(target);
    moveEvents.push(nextEvent(state, {
      type: 'player.moved',
      playerId,
      from: simulatedPosition,
      to: target,
      buffer: simulatedBuffer,
    }));
    simulatedPosition = target;
  }

  player.position = simulatedPosition;
  player.buffer = simulatedBuffer;
  player.path = simulatedPath;
  player.collectedLetterCellIds = simulatedLetterCellIds;
  player.lastActionAt = now;

  const accepted = tryAcceptCurrentBuffer(state, player, now, 'auto');
  const deadEndDetected = detectDeadEndTransition(state, player, wasDeadEnd);
  return { state, events: [...moveEvents, ...accepted, ...deadEndDetected] };
}

function submitCurrentBuffer(
  state: RoundState,
  identity: PlayerIdentity,
  now: string,
  source: 'manual',
): ApplyResult {
  const playerId = playerIdFromIdentity(identity);
  const player = state.players[playerId];
  const events: DomainEvent[] = [];

  if (!player || player.status !== 'active') {
    events.push(nextEvent(state, { type: 'command.rejected', playerId, reason: 'player_not_active' }));
    return { state, events };
  }

  const accepted = tryAcceptCurrentBuffer(state, player, now, source);
  if (accepted.length > 0) {
    return { state, events: accepted };
  }

  const normalizedWord = normalizeWord(player.buffer, state.theme.language);
  const rejected: RejectedSubmission = {
    id: `${state.id}:rejected:${state.rejectedSubmissions.length + 1}`,
    playerId,
    rawWord: player.buffer,
    normalizedWord,
    path: [...player.path],
    reason: normalizedWord.length < state.theme.minWordLength ? 'too_short' : 'word_not_found',
    status: 'pending',
    createdAt: now,
  };
  state.rejectedSubmissions.push(rejected);
  events.push(nextEvent(state, {
    type: 'submission.rejected',
    playerId,
    rejectedId: rejected.id,
    reason: rejected.reason,
  }));

  return { state, events };
}

function resetPlayer(state: RoundState, identity: PlayerIdentity, now: string): ApplyResult {
  const playerId = playerIdFromIdentity(identity);
  const player = state.players[playerId];
  const events: DomainEvent[] = [];

  if (!player || player.status !== 'active') {
    events.push(nextEvent(state, { type: 'command.rejected', playerId, reason: 'player_not_active' }));
    return { state, events };
  }

  player.buffer = '';
  player.path = [];
  player.collectedLetterCellIds = [];
  setRespawnPosition(state, player);
  player.lastActionAt = now;
  events.push(nextEvent(state, { type: 'player.bufferCleared', playerId, reason: 'reset' }));
  return { state, events };
}

function quitPlayer(state: RoundState, identity: PlayerIdentity, now: string): ApplyResult {
  const playerId = playerIdFromIdentity(identity);
  const player = state.players[playerId];
  const events: DomainEvent[] = [];

  if (!player || player.status !== 'active') {
    events.push(nextEvent(state, { type: 'command.rejected', playerId, reason: 'player_not_active' }));
    return { state, events };
  }

  player.buffer = '';
  player.path = [];
  player.collectedLetterCellIds = [];
  delete player.position;
  player.status = 'left';
  player.lastActionAt = now;

  events.push(nextEvent(state, { type: 'player.bufferCleared', playerId, reason: 'quit' }));
  events.push(nextEvent(state, { type: 'player.left', playerId, reason: 'quit' }));
  return { state, events };
}

function tryAcceptCurrentBuffer(
  state: RoundState,
  player: PlayerState,
  now: string,
  source: 'auto' | 'manual',
): DomainEvent[] {
  const normalized = normalizeWord(player.buffer, state.theme.language);
  if (normalized.length < state.theme.minWordLength) {
    return [];
  }

  const entry = createThemeIndex(state.theme).byNormalized.get(normalized);
  if (!entry) {
    return [];
  }

  if (player.acceptedWordIds.includes(entry.word.id)) {
    return [];
  }

  return acceptWord(state, player, entry.word, now, source);
}

function acceptWord(
  state: RoundState,
  player: PlayerState,
  word: ThemeWord,
  now: string,
  source: 'auto' | 'manual',
): DomainEvent[] {
  const rng = createRng(`${state.rngState}:accept:${state.foundWords.length}`);
  const points = scoreWord(word);
  const path = [...player.path];
  // The player stays where the word ended; the cell under the frog is kept
  // empty so the fresh letters land only on vacated path cells.
  const refilled = refillPathCells(state.board, path, state.theme, rng, {
    keepEmpty: player.position ? [player.position] : [],
  });
  state.rngState = rng.state();

  player.score += points;
  player.acceptedWordIds.push(word.id);
  player.buffer = '';
  player.path = [];
  player.collectedLetterCellIds = [];

  state.foundWords.push({
    id: `${state.id}:found:${state.foundWords.length + 1}`,
    playerId: player.id,
    wordId: word.id,
    canonical: word.canonical,
    normalized: word.normalized,
    points,
    path,
    acceptedAt: now,
    source,
  });

  return [
    nextEvent(state, { type: 'submission.accepted', playerId: player.id, wordId: word.id, points, source }),
    nextEvent(state, { type: 'player.bufferCleared', playerId: player.id, reason: 'accepted' }),
    nextEvent(state, { type: 'board.cellsRefilled', cells: refilled }),
  ];
}

function validateMove(
  state: RoundState,
  playerId: PlayerId,
  from: Coord,
  target: Coord,
  distance: number,
): string | undefined {
  if (distance <= 0) {
    return 'invalid_distance';
  }

  if (state.settings.maxJumpDistance !== 'unlimited' && distance > state.settings.maxJumpDistance) {
    return 'jump_too_far';
  }

  const cell = getCell(state.board, target);
  if (!cell) {
    return 'out_of_bounds';
  }

  if (hasBlockedCellBetween(state.board, from, target)) {
    return 'blocked_path';
  }

  if (state.settings.lockMode === 'positionOnly' && isOccupiedByOtherPlayer(state, target, playerId)) {
    return 'occupied_cell';
  }

  return undefined;
}

function isOccupiedByOtherPlayer(state: RoundState, target: Coord, playerId: PlayerId): boolean {
  return Object.values(state.players).some((player) => (
    player.id !== playerId
    && player.status === 'active'
    && player.position
    && sameCoord(player.position, target)
  ));
}

function targetCoord(from: Coord, direction: Direction, distance: number): Coord {
  switch (direction) {
    case 'up':
      return { row: from.row - distance, col: from.col };
    case 'down':
      return { row: from.row + distance, col: from.col };
    case 'left':
      return { row: from.row, col: from.col - distance };
    case 'right':
      return { row: from.row, col: from.col + distance };
  }
}

function spawnPlayer(state: RoundState): Coord | undefined {
  const occupied = new Set(
    Object.values(state.players)
      .filter((player) => player.status === 'active' && player.position)
      .map((player) => `${player.position!.row}:${player.position!.col}`),
  );

  return emptyCoords(state.board).find((coord) => !occupied.has(`${coord.row}:${coord.col}`));
}

function setRespawnPosition(state: RoundState, player: PlayerState): void {
  const position = spawnPlayer(state);
  if (position) {
    player.position = position;
  } else {
    delete player.position;
  }
}

function detectDeadEndTransition(state: RoundState, player: PlayerState, wasDeadEnd: boolean): DomainEvent[] {
  if (wasDeadEnd || !isDeadEndWarningActive(state, player)) {
    return [];
  }

  return [nextEvent(state, { type: 'player.deadEndDetected', playerId: player.id, buffer: player.buffer })];
}

function isDeadEndWarningActive(state: RoundState, player: PlayerState): boolean {
  return state.settings.warnOnDeadEnd && player.status === 'active' && isPlayerAtDeadEnd(state, player);
}

function isPlayerBlocked(state: RoundState, playerId: PlayerId): boolean {
  return Boolean(state.blockedPlayers[playerId]) || state.players[playerId]?.status === 'blocked';
}

function nextEvent<T extends Omit<DomainEvent, 'seq'>>(state: RoundState, event: T): T & { seq: number } {
  state.eventSeq += 1;
  return { ...event, seq: state.eventSeq };
}

function cloneState(state: RoundState): RoundState {
  return JSON.parse(JSON.stringify(state)) as RoundState;
}

function cloneBlockedPlayers(blockedPlayers: Record<PlayerId, BlockedPlayer>): Record<PlayerId, BlockedPlayer> {
  return cloneStateValue(blockedPlayers);
}

function cloneStateValue<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
