import { describe, expect, it } from 'vitest';
import { runMigrations } from './runner.js';
import type { Migration, SqlDatabase, SqlValue } from './types.js';

class FakeDatabase implements SqlDatabase {
  readonly executed: string[] = [];
  readonly params: (readonly SqlValue[])[] = [];
  readonly applied = new Map<string, { title: string; appliedAt: string }>();
  failOnStatement?: string;

  async execute(sql: string, params: readonly SqlValue[] = []): Promise<void> {
    this.executed.push(sql.trim());
    this.params.push(params);

    if (this.failOnStatement && sql.includes(this.failOnStatement)) {
      throw new Error(`Failed on ${this.failOnStatement}`);
    }

    if (sql.startsWith('INSERT INTO schema_migrations')) {
      const [id, title, appliedAt] = params;
      this.applied.set(String(id), {
        title: String(title),
        appliedAt: String(appliedAt),
      });
    }
  }

  async query<T>(sql: string): Promise<T[]> {
    if (!sql.includes('FROM schema_migrations')) {
      return [];
    }

    return [...this.applied.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([id, row]) => ({
        id,
        title: row.title,
        applied_at: row.appliedAt,
      })) as unknown as T[];
  }
}

const migrations: readonly Migration[] = [
  {
    id: '001_first',
    title: 'First',
    statements: ['CREATE TABLE IF NOT EXISTS first_table (id text primary key)'],
  },
  {
    id: '002_second',
    title: 'Second',
    statements: ['CREATE TABLE IF NOT EXISTS second_table (id text primary key)'],
  },
];

describe('runMigrations', () => {
  it('applies pending migrations in transactions and records them', async () => {
    const database = new FakeDatabase();

    const result = await runMigrations(database, migrations, () => '2026-07-06T00:00:00.000Z');

    expect(result.applied.map((migration) => migration.id)).toEqual(['001_first', '002_second']);
    expect(result.skipped).toEqual([]);
    expect(database.executed).toEqual(expect.arrayContaining([
      'PRAGMA foreign_keys = ON',
      'BEGIN',
      'CREATE TABLE IF NOT EXISTS first_table (id text primary key)',
      'CREATE TABLE IF NOT EXISTS second_table (id text primary key)',
      'COMMIT',
    ]));
    expect(database.applied.has('001_first')).toBe(true);
    expect(database.applied.has('002_second')).toBe(true);
  });

  it('skips migrations already recorded in schema_migrations', async () => {
    const database = new FakeDatabase();
    database.applied.set('001_first', {
      title: 'First',
      appliedAt: '2026-07-05T00:00:00.000Z',
    });

    const result = await runMigrations(database, migrations, () => '2026-07-06T00:00:00.000Z');

    expect(result.skipped).toEqual([
      {
        id: '001_first',
        title: 'First',
        appliedAt: '2026-07-05T00:00:00.000Z',
      },
    ]);
    expect(result.applied.map((migration) => migration.id)).toEqual(['002_second']);
    expect(database.executed).not.toContain('CREATE TABLE IF NOT EXISTS first_table (id text primary key)');
  });

  it('rolls back and does not record a failing migration', async () => {
    const database = new FakeDatabase();
    database.failOnStatement = 'second_table';

    await expect(runMigrations(database, migrations)).rejects.toThrow('Failed on second_table');

    expect(database.executed).toContain('ROLLBACK');
    expect(database.applied.has('002_second')).toBe(false);
  });

  it('rejects duplicate migration ids before touching the database', async () => {
    const database = new FakeDatabase();

    await expect(runMigrations(database, [migrations[0]!, migrations[0]!])).rejects.toThrow(
      'Duplicate migration id: 001_first',
    );
    expect(database.executed).toEqual([]);
  });
});
