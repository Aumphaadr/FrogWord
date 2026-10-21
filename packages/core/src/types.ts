export type LocaleCode = 'ru' | 'en';
export type ThemeLanguage = 'ru' | 'en';

export interface Coord {
  row: number;
  col: number;
}

export type Direction = 'up' | 'down' | 'left' | 'right';

export interface MoveToken {
  direction: Direction;
  distance: number;
  raw: string;
}

export type ParsedCommand =
  | { kind: 'join' }
  | { kind: 'moveSequence'; moves: MoveToken[] }
  | { kind: 'submitCurrentBuffer' }
  | { kind: 'reset' }
  | { kind: 'quit' }
  | { kind: 'help' }
  | { kind: 'unknown'; reason: string; raw?: string };

export type PlayerId = string;
export type RoundId = string;
export type ThemeId = string;
export type WordId = string;

export interface CellLock {
  ownerId: PlayerId;
  kind: 'position' | 'path' | 'timedTrail';
  expiresAt?: string;
}

export type Cell =
  | { kind: 'blocked'; id: string }
  | { kind: 'empty'; id: string; locks?: CellLock[] }
  | { kind: 'letter'; id: string; char: string; locks?: CellLock[] };

export interface BoardTemplate {
  id: string;
  title: string;
  width: number;
  height: number;
  activeMask: boolean[][];
}

export interface Board {
  width: number;
  height: number;
  templateId: string;
  cells: Cell[][];
  seed: string;
}

export interface PlayerIdentity {
  provider: 'twitch' | 'fake';
  providerUserId: string;
  login: string;
  displayName: string;
  color?: string;
}

export interface PlayerState {
  id: PlayerId;
  identity: PlayerIdentity;
  markerColor: string;
  status: 'active' | 'idle' | 'left' | 'finished' | 'kicked' | 'blocked';
  position?: Coord;
  buffer: string;
  path: Coord[];
  collectedLetterCellIds: string[];
  acceptedWordIds: WordId[];
  score: number;
  lastActionAt: string;
}

export interface BlockedPlayer {
  playerId: PlayerId;
  identity?: PlayerIdentity;
  blockedAt: string;
  reason?: string;
}

export interface ThemeWord {
  id: WordId;
  canonical: string;
  normalized: string;
  language: ThemeLanguage;
  expertiseTier: 1 | 2;
  scoreMultiplier: number;
  aliases: string[];
}

export interface Theme {
  id: ThemeId;
  language: ThemeLanguage;
  title: string;
  minWordLength: number;
  words: ThemeWord[];
}

export interface FoundWord {
  id: string;
  playerId: PlayerId;
  wordId: WordId;
  canonical: string;
  normalized: string;
  points: number;
  path: Coord[];
  acceptedAt: string;
  source: 'auto' | 'manual' | 'host';
}

export interface RejectedSubmission {
  id: string;
  playerId: PlayerId;
  rawWord: string;
  normalizedWord: string;
  path: Coord[];
  reason: 'word_not_found' | 'duplicate' | 'too_short';
  status: 'pending' | 'approved' | 'rejected' | 'ignored';
  createdAt: string;
}

export interface RoundSettings {
  maxJumpDistance: number | 'unlimited';
  maxMovesPerMessage: number;
  emptyCellRatio: number;
  duplicatePolicy: 'perPlayerUnique';
  lockMode: 'off' | 'positionOnly' | 'path' | 'timedTrail' | 'strict';
  warnOnDeadEnd: boolean;
}

export interface RoundState {
  id: RoundId;
  status: 'setup' | 'running' | 'paused' | 'ended';
  theme: Theme;
  board: Board;
  players: Record<PlayerId, PlayerState>;
  blockedPlayers: Record<PlayerId, BlockedPlayer>;
  foundWords: FoundWord[];
  rejectedSubmissions: RejectedSubmission[];
  settings: RoundSettings;
  eventSeq: number;
  rngState: string;
}

export interface PlayerCommand {
  player: PlayerIdentity;
  command: ParsedCommand;
  receivedAt: string;
}

export type DomainEvent =
  | { seq: number; type: 'round.started'; roundId: RoundId }
  | { seq: number; type: 'player.joined'; playerId: PlayerId; position: Coord }
  | { seq: number; type: 'player.moved'; playerId: PlayerId; from: Coord; to: Coord; buffer: string }
  | { seq: number; type: 'player.bufferCleared'; playerId: PlayerId; reason: 'reset' | 'accepted' | 'quit' | 'kick' | 'ban' | 'timeout' }
  | { seq: number; type: 'player.left'; playerId: PlayerId; reason: 'quit' | 'kick' | 'ban' | 'timeout' }
  | { seq: number; type: 'player.deadEndDetected'; playerId: PlayerId; buffer: string }
  | { seq: number; type: 'player.blocked'; playerId: PlayerId; blockedAt: string; reason?: string }
  | { seq: number; type: 'player.unblocked'; playerId: PlayerId; unblockedAt: string }
  | {
    seq: number;
    type: 'hostAction.rejected';
    action: 'kick' | 'ban' | 'unban' | 'approveSubmission';
    reason: string;
    playerId?: PlayerId;
    rejectedId?: string;
  }
  | { seq: number; type: 'command.rejected'; playerId: PlayerId; reason: string; raw?: string }
  | { seq: number; type: 'submission.accepted'; playerId: PlayerId; wordId: WordId; points: number; source: 'auto' | 'manual' | 'host' }
  | { seq: number; type: 'submission.rejected'; playerId: PlayerId; rejectedId: string; reason: string }
  | { seq: number; type: 'submission.approvedByHost'; playerId: PlayerId; rejectedId: string; wordId: WordId; points: number }
  | { seq: number; type: 'board.cellsRefilled'; cells: Coord[] }
  | { seq: number; type: 'round.ended'; roundId: RoundId; reason: string };

export interface ApplyResult {
  state: RoundState;
  events: DomainEvent[];
}
