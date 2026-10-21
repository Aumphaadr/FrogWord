import { describe, expect, it } from 'vitest';
import type { PlayerState } from '@frogword/core';
import {
  createDomainAuditEntries,
  createSystemAuditEntry,
  filterAuditEntries,
  summarizeDomainEvent,
} from './auditLogService';
import { createDefaultLocalRound } from './newRoundService';

const occurredAt = '2026-07-07T01:40:00.000Z';

function createPlayer(): PlayerState {
  return {
    id: 'fake:ada',
    identity: {
      provider: 'fake',
      providerUserId: 'ada',
      login: 'ada',
      displayName: 'Ada',
    },
    markerColor: '#2c9f6f',
    status: 'active',
    position: { row: 0, col: 0 },
    buffer: '',
    path: [],
    collectedLetterCellIds: [],
    acceptedWordIds: [],
    score: 0,
    lastActionAt: occurredAt,
  };
}

describe('audit log service', () => {
  it('creates structured entries for accepted words', () => {
    const round = createDefaultLocalRound('audit-test');
    round.players['fake:ada'] = createPlayer();
    const word = round.theme.words[0]!;

    const entries = createDomainAuditEntries(round, [
      {
        seq: 3,
        type: 'submission.accepted',
        playerId: 'fake:ada',
        wordId: word.id,
        points: 70,
        source: 'auto',
      },
    ], 'chat', occurredAt);

    expect(entries).toEqual([
      expect.objectContaining({
        category: 'word',
        source: 'chat',
        tone: 'success',
        type: 'submission.accepted',
        title: 'Ada scored',
        detail: word.canonical,
        chips: ['#3', '70 pts', 'auto'],
        playerDisplayName: 'Ada',
      }),
    ]);
  });

  it('summarizes domain events for the legacy compact event stream', () => {
    const round = createDefaultLocalRound('audit-test');
    round.players['fake:ada'] = createPlayer();

    expect(summarizeDomainEvent(round, {
      seq: 1,
      type: 'player.joined',
      playerId: 'fake:ada',
      position: { row: 2, col: 4 },
    })).toBe('Ada joined: Cell 2:4');
  });

  it('filters entries by category and keeps all entries for all filter', () => {
    const wordEntry = createSystemAuditEntry({
      id: 'word',
      occurredAt,
      source: 'system',
      category: 'word',
      title: 'Word',
    });
    const hostEntry = createSystemAuditEntry({
      id: 'host',
      occurredAt,
      source: 'system',
      category: 'host',
      title: 'Host',
    });

    expect(filterAuditEntries([wordEntry, hostEntry], 'word')).toEqual([wordEntry]);
    expect(filterAuditEntries([wordEntry, hostEntry], 'all')).toEqual([wordEntry, hostEntry]);
  });

  it('creates system entries with neutral defaults', () => {
    expect(createSystemAuditEntry({
      id: 'storage-ready',
      occurredAt,
      source: 'storage',
      title: 'SQLite ready',
      detail: '0 applied',
      chips: ['startup'],
    })).toEqual({
      id: 'storage-ready',
      occurredAt,
      category: 'system',
      source: 'storage',
      tone: 'neutral',
      type: 'system.message',
      title: 'SQLite ready',
      detail: '0 applied',
      chips: ['startup'],
    });
  });
});
