import { describe, expect, it } from 'vitest';
import {
  loadRoundEvents,
  loadRoundSnapshot,
  saveRoundSnapshot,
  type StoredRoundState,
} from './roundSnapshots.js';
import type { SqlDatabase, SqlValue } from './types.js';

class RecordingDatabase implements SqlDatabase {
  readonly executed: { sql: string; params: readonly SqlValue[] }[] = [];
  rows: unknown[] = [];
  failOnStatement?: string;

  async execute(sql: string, params: readonly SqlValue[] = []): Promise<void> {
    this.executed.push({ sql: sql.trim(), params });

    if (this.failOnStatement && sql.includes(this.failOnStatement)) {
      throw new Error(`Failed on ${this.failOnStatement}`);
    }
  }

  async query<T>(): Promise<T[]> {
    return this.rows as T[];
  }
}

const savedAt = '2026-07-06T18:45:00.000Z';

const sampleState: StoredRoundState = {
  id: 'local-demo',
  status: 'running',
  theme: {
    id: 'starter-ru-demo',
    language: 'ru',
    title: 'Demo',
    minWordLength: 3,
    words: [
      {
        id: 'word-1',
        canonical: 'кот',
        normalized: 'кот',
        language: 'ru',
        expertiseTier: 1,
        scoreMultiplier: 1,
        aliases: [],
      },
    ],
  },
  board: {
    width: 2,
    height: 2,
    templateId: 'local-2x2',
    seed: 'seed',
    cells: [
      [
        { id: '0:0', kind: 'letter', char: 'к' },
        { id: '0:1', kind: 'blocked' },
      ],
      [
        { id: '1:0', kind: 'empty' },
        { id: '1:1', kind: 'letter', char: 'т' },
      ],
    ],
  },
  players: {
    'fake:nora': {
      id: 'fake:nora',
      identity: {
        provider: 'fake',
        providerUserId: 'nora',
        login: 'nora',
        displayName: 'Nora',
      },
      markerColor: '#2c9f6f',
      status: 'active',
      position: { row: 0, col: 0 },
      buffer: 'кот',
      path: [{ row: 0, col: 0 }],
      collectedLetterCellIds: ['0:0'],
      acceptedWordIds: ['word-1'],
      score: 3,
      lastActionAt: savedAt,
    },
  },
  blockedPlayers: {},
  foundWords: [
    {
      id: 'local-demo:found:1',
      playerId: 'fake:nora',
      wordId: 'word-1',
      canonical: 'кот',
      normalized: 'кот',
      points: 3,
      path: [{ row: 0, col: 0 }],
      acceptedAt: savedAt,
      source: 'auto',
    },
  ],
  rejectedSubmissions: [
    {
      id: 'local-demo:rejected:1',
      playerId: 'fake:nora',
      rawWord: 'ко',
      normalizedWord: 'ко',
      path: [{ row: 0, col: 0 }],
      reason: 'too_short',
      status: 'pending',
      createdAt: savedAt,
    },
  ],
  settings: {
    warnOnDeadEnd: true,
  },
  eventSeq: 2,
  rngState: 'rng',
};

describe('round snapshot repository', () => {
  it('saves a round snapshot and its query-friendly projections in one transaction', async () => {
    const database = new RecordingDatabase();

    await saveRoundSnapshot(database, {
      state: sampleState,
      events: [
        { seq: 1, type: 'player.joined', playerId: 'fake:nora' },
        { seq: 2, type: 'submission.accepted', playerId: 'fake:nora', wordId: 'word-1', points: 3, source: 'auto' },
      ],
      savedAt,
    });

    expect(database.executed[0]?.sql).toBe('BEGIN');
    expect(database.executed.at(-1)?.sql).toBe('COMMIT');
    expect(database.executed.some((entry) => entry.sql.includes('INSERT INTO themes'))).toBe(true);
    expect(database.executed.some((entry) => entry.sql.includes('INSERT INTO words'))).toBe(true);
    expect(database.executed.some((entry) => entry.sql.includes('INSERT INTO players'))).toBe(true);
    expect(database.executed.some((entry) => entry.sql.includes('INSERT INTO found_words'))).toBe(true);
    expect(database.executed.some((entry) => entry.sql.includes('INSERT INTO submissions'))).toBe(true);
    expect(database.executed.some((entry) => entry.sql.includes('INSERT INTO round_events'))).toBe(true);

    const roundInsert = database.executed.find((entry) => entry.sql.includes('INSERT INTO rounds'));
    const summaryJson = String(roundInsert?.params.at(-1));
    const summary = JSON.parse(summaryJson) as { version: number; savedAt: string; state: StoredRoundState };

    expect(summary.version).toBe(1);
    expect(summary.savedAt).toBe(savedAt);
    expect(summary.state.players['fake:nora']?.score).toBe(3);
  });

  it('loads a saved snapshot envelope from rounds.summary_json', async () => {
    const database = new RecordingDatabase();
    database.rows = [
      {
        summary_json: JSON.stringify({
          version: 1,
          savedAt,
          state: sampleState,
        }),
      },
    ];

    const snapshot = await loadRoundSnapshot(database, 'local-demo');

    expect(snapshot?.savedAt).toBe(savedAt);
    expect(snapshot?.state.id).toBe('local-demo');
    expect(snapshot?.state.foundWords[0]?.canonical).toBe('кот');
  });

  it('loads persisted round events with created timestamps', async () => {
    const database = new RecordingDatabase();
    database.rows = [
      {
        payload_json: JSON.stringify({ seq: 1, type: 'player.joined', playerId: 'fake:nora' }),
        created_at: '2026-07-06T18:45:01.000Z',
      },
      {
        payload_json: JSON.stringify({
          seq: 2,
          type: 'submission.accepted',
          playerId: 'fake:nora',
          wordId: 'word-1',
          points: 3,
          source: 'auto',
        }),
        created_at: '2026-07-06T18:45:02.000Z',
      },
    ];

    const events = await loadRoundEvents(database, 'local-demo', { limit: 80 });

    expect(events).toEqual([
      {
        event: { seq: 1, type: 'player.joined', playerId: 'fake:nora' },
        createdAt: '2026-07-06T18:45:01.000Z',
      },
      {
        event: {
          seq: 2,
          type: 'submission.accepted',
          playerId: 'fake:nora',
          wordId: 'word-1',
          points: 3,
          source: 'auto',
        },
        createdAt: '2026-07-06T18:45:02.000Z',
      },
    ]);
    expect(database.executed).toEqual([]);
  });

  it('rolls back when any projection write fails', async () => {
    const database = new RecordingDatabase();
    database.failOnStatement = 'INSERT INTO rounds';

    await expect(saveRoundSnapshot(database, { state: sampleState, savedAt })).rejects.toThrow(
      'Failed on INSERT INTO rounds',
    );

    expect(database.executed.map((entry) => entry.sql)).toContain('ROLLBACK');
  });
});
