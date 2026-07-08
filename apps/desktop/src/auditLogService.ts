import type { DomainEvent, PlayerId, RoundState } from '@frogword/core';

export type AuditLogCategory = 'round' | 'player' | 'word' | 'board' | 'host' | 'system';
export type AuditLogFilter = 'all' | AuditLogCategory;
export type AuditLogSource = 'chat' | 'host' | 'round' | 'storage' | 'theme-bank' | 'system';
export type AuditLogTone = 'neutral' | 'success' | 'warning' | 'danger';

export interface AuditLogEntry {
  id: string;
  occurredAt: string;
  category: AuditLogCategory;
  source: AuditLogSource;
  tone: AuditLogTone;
  type: string;
  title: string;
  detail: string;
  chips: readonly string[];
  seq?: number;
  playerId?: PlayerId;
  playerDisplayName?: string;
}

export interface SystemAuditLogInput {
  id: string;
  occurredAt: string;
  source: AuditLogSource;
  title: string;
  detail?: string;
  category?: AuditLogCategory;
  tone?: AuditLogTone;
  chips?: readonly string[];
}

export const AUDIT_LOG_FILTERS: readonly { value: AuditLogFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'word', label: 'Words' },
  { value: 'player', label: 'Players' },
  { value: 'host', label: 'Host' },
  { value: 'board', label: 'Board' },
  { value: 'round', label: 'Round' },
  { value: 'system', label: 'System' },
];

export function createDomainAuditEntries(
  state: RoundState,
  events: readonly DomainEvent[],
  source: AuditLogSource,
  occurredAt: string,
): AuditLogEntry[] {
  return events.map((event) => createDomainAuditEntry(state, event, source, occurredAt));
}

export function createSystemAuditEntry(input: SystemAuditLogInput): AuditLogEntry {
  return {
    id: input.id,
    occurredAt: input.occurredAt,
    category: input.category ?? 'system',
    source: input.source,
    tone: input.tone ?? 'neutral',
    type: 'system.message',
    title: input.title,
    detail: input.detail ?? '',
    chips: input.chips ?? [],
  };
}

export function filterAuditEntries(
  entries: readonly AuditLogEntry[],
  filter: AuditLogFilter,
): AuditLogEntry[] {
  return filter === 'all'
    ? [...entries]
    : entries.filter((entry) => entry.category === filter);
}

export function summarizeDomainEvent(state: RoundState, event: DomainEvent): string {
  return eventSummary(createDomainAuditEntry(state, event, 'system', ''));
}

function createDomainAuditEntry(
  state: RoundState,
  event: DomainEvent,
  source: AuditLogSource,
  occurredAt: string,
): AuditLogEntry {
  const playerId = eventPlayerId(event);
  const playerDisplayName = playerId ? displayName(state, playerId) : undefined;
  const base = {
    id: `${state.id}:${event.seq}:${event.type}:${source}:${occurredAt}`,
    occurredAt,
    source,
    type: event.type,
    seq: event.seq,
    ...(playerId ? { playerId } : {}),
    ...(playerDisplayName ? { playerDisplayName } : {}),
  };

  switch (event.type) {
    case 'round.started':
      return {
        ...base,
        category: 'round',
        tone: 'success',
        title: 'Round started',
        detail: event.roundId,
        chips: seqChips(event),
      };
    case 'round.ended':
      return {
        ...base,
        category: 'round',
        tone: 'warning',
        title: 'Round ended',
        detail: event.reason,
        chips: seqChips(event),
      };
    case 'player.joined':
      return {
        ...base,
        category: 'player',
        tone: 'success',
        title: `${playerDisplayName} joined`,
        detail: `Cell ${formatCoord(event.position)}`,
        chips: [...seqChips(event), 'join'],
      };
    case 'player.moved':
      return {
        ...base,
        category: 'player',
        tone: 'neutral',
        title: `${playerDisplayName} moved`,
        detail: `${formatCoord(event.from)} -> ${formatCoord(event.to)}`,
        chips: event.buffer ? [...seqChips(event), `buffer ${event.buffer}`] : seqChips(event),
      };
    case 'player.bufferCleared':
      return {
        ...base,
        category: 'player',
        tone: 'neutral',
        title: `${playerDisplayName} buffer cleared`,
        detail: event.reason,
        chips: seqChips(event),
      };
    case 'player.left':
      return {
        ...base,
        category: 'player',
        tone: 'warning',
        title: `${playerDisplayName} left`,
        detail: event.reason,
        chips: seqChips(event),
      };
    case 'player.deadEndDetected':
      return {
        ...base,
        category: 'word',
        tone: 'warning',
        title: `${playerDisplayName} dead end`,
        detail: event.buffer,
        chips: [...seqChips(event), 'dead-end'],
      };
    case 'player.blocked':
      return {
        ...base,
        category: 'host',
        tone: 'danger',
        title: `${playerDisplayName} blocked`,
        detail: event.reason ?? 'manual',
        chips: seqChips(event),
      };
    case 'player.unblocked':
      return {
        ...base,
        category: 'host',
        tone: 'success',
        title: `${playerDisplayName} unblocked`,
        detail: event.unblockedAt,
        chips: seqChips(event),
      };
    case 'command.rejected':
      return {
        ...base,
        category: 'player',
        tone: 'warning',
        title: `${playerDisplayName} command rejected`,
        detail: humanizeReason(event.reason),
        chips: event.raw ? [...seqChips(event), event.raw] : seqChips(event),
      };
    case 'hostAction.rejected':
      return {
        ...base,
        category: 'host',
        tone: 'warning',
        title: 'Host action rejected',
        detail: humanizeReason(event.reason),
        chips: [...seqChips(event), event.action],
      };
    case 'submission.accepted': {
      const word = wordLabel(state, event.wordId);
      return {
        ...base,
        category: 'word',
        tone: 'success',
        title: `${playerDisplayName} scored`,
        detail: word,
        chips: [...seqChips(event), `${event.points} pts`, event.source],
      };
    }
    case 'submission.rejected':
      return {
        ...base,
        category: 'word',
        tone: 'warning',
        title: `${playerDisplayName} pending word`,
        detail: humanizeReason(event.reason),
        chips: [...seqChips(event), event.rejectedId],
      };
    case 'submission.approvedByHost':
      return {
        ...base,
        category: 'word',
        tone: 'success',
        title: `${playerDisplayName} approved`,
        detail: wordLabel(state, event.wordId),
        chips: [...seqChips(event), `${event.points} pts`, 'host'],
      };
    case 'board.cellsRefilled':
      return {
        ...base,
        category: 'board',
        tone: 'neutral',
        title: 'Cells refilled',
        detail: `${event.cells.length} cells`,
        chips: [...seqChips(event), ...event.cells.slice(0, 3).map(formatCoord)],
      };
  }
}

function eventSummary(entry: AuditLogEntry): string {
  return entry.detail ? `${entry.title}: ${entry.detail}` : entry.title;
}

function eventPlayerId(event: DomainEvent): PlayerId | undefined {
  return 'playerId' in event ? event.playerId : undefined;
}

function seqChips(event: DomainEvent): string[] {
  return [`#${event.seq}`];
}

function wordLabel(state: RoundState, wordId: string): string {
  return state.theme.words.find((word) => word.id === wordId)?.canonical ?? wordId;
}

function displayName(state: RoundState, playerId: PlayerId): string {
  return state.players[playerId]?.identity.displayName ?? playerId;
}

function formatCoord(coord: { row: number; col: number }): string {
  return `${coord.row}:${coord.col}`;
}

function humanizeReason(reason: string): string {
  return reason.replaceAll('_', ' ');
}
