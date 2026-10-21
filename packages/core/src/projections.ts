import type {
  BlockedPlayer,
  Cell,
  Coord,
  LocaleCode,
  PlayerId,
  PlayerState,
  RejectedSubmission,
  RoundSettings,
  RoundState,
} from './types.js';
import { isPlayerAtDeadEnd } from './deadEnds.js';

export type ParticipantFlag = 'deadEnd' | 'recentScore' | 'recentError';

export interface ProjectionOptions {
  locale?: LocaleCode;
  showCurrentBuffers?: boolean;
  maxParticipants?: number;
  maxFoundWords?: number;
}

export type PublicBoardCell =
  | { id: string; row: number; col: number; kind: 'blocked' }
  | { id: string; row: number; col: number; kind: 'empty' }
  | { id: string; row: number; col: number; kind: 'letter'; char: string };

export interface PublicBoardProjection {
  width: number;
  height: number;
  templateId: string;
  cells: PublicBoardCell[][];
}

export interface PublicPlayerMarker {
  playerId: PlayerId;
  displayName: string;
  markerColor: string;
  row: number;
  col: number;
  bufferLength: number;
}

export interface ParticipantPanelRow {
  playerId: PlayerId;
  displayName: string;
  markerColor: string;
  score: number;
  status: PlayerState['status'];
  bufferLength: number;
  buffer?: string;
  flags: ParticipantFlag[];
}

export interface LeaderboardRow {
  rank: number;
  playerId: PlayerId;
  displayName: string;
  score: number;
  status: PlayerState['status'];
}

export interface PublicFoundWord {
  id: string;
  playerId: PlayerId;
  playerDisplayName: string;
  canonical: string;
  points: number;
  source: 'auto' | 'manual' | 'host';
  acceptedAt: string;
  path: Coord[];
}

export interface PublicNotification {
  id: string;
  kind: 'info' | 'success' | 'warning' | 'error';
  messageKey: string;
  playerId?: PlayerId;
  createdAt?: string;
}

export interface CommandHint {
  command: string;
  descriptionKey:
    | 'command.join'
    | 'command.move'
    | 'command.submit'
    | 'command.reset'
    | 'command.quit'
    | 'command.help';
}

export interface PublicGameProjection {
  roundId: string;
  roundStatus: RoundState['status'];
  locale: LocaleCode;
  themeTitle: string;
  board: PublicBoardProjection;
  players: PublicPlayerMarker[];
  participantPanel: ParticipantPanelRow[];
  leaderboard: LeaderboardRow[];
  foundWords: PublicFoundWord[];
  notifications: PublicNotification[];
  commandHints: CommandHint[];
}

export interface AdminRejectedSubmission {
  id: string;
  playerId: PlayerId;
  playerDisplayName: string;
  rawWord: string;
  normalizedWord: string;
  reason: RejectedSubmission['reason'];
  status: RejectedSubmission['status'];
  createdAt: string;
  path: Coord[];
}

export interface AdminPlayerRow {
  playerId: PlayerId;
  provider: PlayerState['identity']['provider'];
  providerUserId: string;
  login: string;
  displayName: string;
  markerColor: string;
  score: number;
  status: PlayerState['status'];
  buffer: string;
  bufferLength: number;
  path: Coord[];
  acceptedWordIds: string[];
  collectedLetterCellIds: string[];
  lastActionAt: string;
  position?: Coord;
}

export interface AdminBlockedPlayer {
  playerId: PlayerId;
  blockedAt: string;
  provider?: PlayerState['identity']['provider'];
  providerUserId?: string;
  login?: string;
  displayName?: string;
  reason?: string;
}

export interface AdminGameProjection extends PublicGameProjection {
  playersAdmin: AdminPlayerRow[];
  rejectedSubmissions: AdminRejectedSubmission[];
  blockedPlayers: AdminBlockedPlayer[];
  settings: RoundSettings;
}

export function createPublicGameProjection(
  state: RoundState,
  options: ProjectionOptions = {},
): PublicGameProjection {
  const locale = options.locale ?? state.theme.language;
  const showCurrentBuffers = options.showCurrentBuffers ?? true;
  const maxParticipants = options.maxParticipants ?? 50;
  const maxFoundWords = options.maxFoundWords ?? 20;
  const players = sortedPlayers(state);

  return {
    roundId: state.id,
    roundStatus: state.status,
    locale,
    themeTitle: state.theme.title,
    board: projectBoard(state),
    players: projectPlayerMarkers(players),
    participantPanel: players.slice(0, maxParticipants).map((player) => (
      projectParticipantRow(state, player, showCurrentBuffers)
    )),
    leaderboard: projectLeaderboard(players),
    foundWords: state.foundWords
      .slice(-maxFoundWords)
      .reverse()
      .map((word) => ({
        id: word.id,
        playerId: word.playerId,
        playerDisplayName: displayNameForPlayer(state, word.playerId),
        canonical: word.canonical,
        points: word.points,
        source: word.source,
        acceptedAt: word.acceptedAt,
        path: clonePath(word.path),
      })),
    notifications: [],
    commandHints: commandHintsForLocale(locale),
  };
}

export function createAdminGameProjection(
  state: RoundState,
  options: ProjectionOptions = {},
): AdminGameProjection {
  const publicProjection = createPublicGameProjection(state, options);
  const players = sortedPlayers(state);

  return {
    ...publicProjection,
    playersAdmin: players.map(projectAdminPlayerRow),
    rejectedSubmissions: state.rejectedSubmissions.map((submission) => (
      projectRejectedSubmission(state, submission)
    )),
    blockedPlayers: Object.values(state.blockedPlayers).map(projectBlockedPlayer),
    settings: { ...state.settings },
  };
}

function projectBoard(state: RoundState): PublicBoardProjection {
  return {
    width: state.board.width,
    height: state.board.height,
    templateId: state.board.templateId,
    cells: state.board.cells.map((row, rowIndex) => (
      row.map((cell, colIndex) => projectCell(cell, rowIndex, colIndex))
    )),
  };
}

function projectCell(cell: Cell, row: number, col: number): PublicBoardCell {
  switch (cell.kind) {
    case 'blocked':
      return { id: cell.id, row, col, kind: 'blocked' };
    case 'empty':
      return { id: cell.id, row, col, kind: 'empty' };
    case 'letter':
      return { id: cell.id, row, col, kind: 'letter', char: cell.char };
  }
}

function projectPlayerMarkers(players: PlayerState[]): PublicPlayerMarker[] {
  return players
    .filter((player) => player.status === 'active' && player.position)
    .map((player) => ({
      playerId: player.id,
      displayName: player.identity.displayName,
      markerColor: player.markerColor,
      row: player.position!.row,
      col: player.position!.col,
      bufferLength: player.buffer.length,
    }));
}

function projectParticipantRow(
  state: RoundState,
  player: PlayerState,
  showCurrentBuffer: boolean,
): ParticipantPanelRow {
  return {
    playerId: player.id,
    displayName: player.identity.displayName,
    markerColor: player.markerColor,
    score: player.score,
    status: player.status,
    bufferLength: player.buffer.length,
    ...(showCurrentBuffer ? { buffer: player.buffer } : {}),
    flags: participantFlags(state, player),
  };
}

function projectLeaderboard(players: PlayerState[]): LeaderboardRow[] {
  return players.map((player, index) => ({
    rank: index + 1,
    playerId: player.id,
    displayName: player.identity.displayName,
    score: player.score,
    status: player.status,
  }));
}

function participantFlags(state: RoundState, player: PlayerState): ParticipantFlag[] {
  const flags: ParticipantFlag[] = [];
  const canWarn = player.status === 'active' || player.status === 'idle';

  if (state.settings.warnOnDeadEnd && canWarn && isPlayerAtDeadEnd(state, player)) {
    flags.push('deadEnd');
  }

  return flags;
}

function projectAdminPlayerRow(player: PlayerState): AdminPlayerRow {
  return {
    playerId: player.id,
    provider: player.identity.provider,
    providerUserId: player.identity.providerUserId,
    login: player.identity.login,
    displayName: player.identity.displayName,
    markerColor: player.markerColor,
    score: player.score,
    status: player.status,
    buffer: player.buffer,
    bufferLength: player.buffer.length,
    path: clonePath(player.path),
    acceptedWordIds: [...player.acceptedWordIds],
    collectedLetterCellIds: [...player.collectedLetterCellIds],
    lastActionAt: player.lastActionAt,
    ...(player.position ? { position: cloneCoord(player.position) } : {}),
  };
}

function projectRejectedSubmission(
  state: RoundState,
  submission: RejectedSubmission,
): AdminRejectedSubmission {
  return {
    id: submission.id,
    playerId: submission.playerId,
    playerDisplayName: displayNameForPlayer(state, submission.playerId),
    rawWord: submission.rawWord,
    normalizedWord: submission.normalizedWord,
    reason: submission.reason,
    status: submission.status,
    createdAt: submission.createdAt,
    path: clonePath(submission.path),
  };
}

function projectBlockedPlayer(blockedPlayer: BlockedPlayer): AdminBlockedPlayer {
  return {
    playerId: blockedPlayer.playerId,
    blockedAt: blockedPlayer.blockedAt,
    ...(blockedPlayer.identity ? {
      provider: blockedPlayer.identity.provider,
      providerUserId: blockedPlayer.identity.providerUserId,
      login: blockedPlayer.identity.login,
      displayName: blockedPlayer.identity.displayName,
    } : {}),
    ...(blockedPlayer.reason ? { reason: blockedPlayer.reason } : {}),
  };
}

function sortedPlayers(state: RoundState): PlayerState[] {
  return Object.values(state.players).sort(comparePlayersForPanels);
}

function comparePlayersForPanels(left: PlayerState, right: PlayerState): number {
  const scoreDelta = right.score - left.score;
  if (scoreDelta !== 0) {
    return scoreDelta;
  }

  const statusDelta = statusSortWeight(left.status) - statusSortWeight(right.status);
  if (statusDelta !== 0) {
    return statusDelta;
  }

  return left.identity.displayName.localeCompare(right.identity.displayName, undefined, {
    sensitivity: 'base',
  });
}

function statusSortWeight(status: PlayerState['status']): number {
  return status === 'active' ? 0 : 1;
}

function displayNameForPlayer(state: RoundState, playerId: PlayerId): string {
  return state.players[playerId]?.identity.displayName ?? playerId;
}

function commandHintsForLocale(locale: LocaleCode): CommandHint[] {
  if (locale === 'en') {
    return [
      { command: '!play', descriptionKey: 'command.join' },
      { command: '!u2 !d2 !l2 !r2', descriptionKey: 'command.move' },
      { command: '!word', descriptionKey: 'command.submit' },
      { command: '!reset', descriptionKey: 'command.reset' },
      { command: '!quit', descriptionKey: 'command.quit' },
      { command: '!frogword', descriptionKey: 'command.help' },
    ];
  }

  return [
    { command: '!играть', descriptionKey: 'command.join' },
    { command: '!в2 !н2 !л2 !п2', descriptionKey: 'command.move' },
    { command: '!слово', descriptionKey: 'command.submit' },
    { command: '!сброс', descriptionKey: 'command.reset' },
    { command: '!уйти', descriptionKey: 'command.quit' },
    { command: '!фрогворд', descriptionKey: 'command.help' },
  ];
}

function cloneCoord(coord: Coord): Coord {
  return { row: coord.row, col: coord.col };
}

function clonePath(path: Coord[]): Coord[] {
  return path.map(cloneCoord);
}
