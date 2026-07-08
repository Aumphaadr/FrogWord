import { describe, expect, it } from 'vitest';
import { upsertThemeSeedPack, type ThemeSeedPack } from './themeSeeds.js';
import type { SqlDatabase, SqlValue } from './types.js';

class RecordingDatabase implements SqlDatabase {
  readonly executed: { sql: string; params: readonly SqlValue[] }[] = [];
  failOnStatement?: string;

  async execute(sql: string, params: readonly SqlValue[] = []): Promise<void> {
    this.executed.push({ sql: sql.trim(), params });

    if (this.failOnStatement && sql.includes(this.failOnStatement)) {
      throw new Error(`Failed on ${this.failOnStatement}`);
    }
  }

  async query<T>(): Promise<T[]> {
    return [];
  }
}

const importedAt = '2026-07-07T00:10:00.000Z';

const seedPack: ThemeSeedPack = {
  formatVersion: 1,
  packId: 'frogword-theme-bank-draft',
  themes: [
    {
      id: 'starter-ru-ancient-arms',
      language: 'ru',
      title: 'Древнее оружие и защита',
      minWordLength: 3,
      tags: ['expert', 'history', 'weapons'],
      words: [
        {
          id: 'starter-ru-ancient-arms:word:kope',
          canonical: 'копьё',
          expertiseTier: 1,
          aliases: ['копье'],
          notes: 'alias for е/ё spelling',
        },
        {
          id: 'starter-ru-ancient-arms:word:protazan',
          canonical: 'протазан',
          expertiseTier: 2,
          aliases: [],
        },
      ],
    },
  ],
};

describe('theme seed upsert', () => {
  it('upserts imported themes, words and pack metadata in one transaction', async () => {
    const database = new RecordingDatabase();

    const result = await upsertThemeSeedPack(database, seedPack, { importedAt });

    expect(result).toEqual({
      packId: 'frogword-theme-bank-draft',
      themeCount: 1,
      wordCount: 2,
    });
    expect(database.executed[0]?.sql).toBe('BEGIN');
    expect(database.executed.at(-1)?.sql).toBe('COMMIT');

    const themeInsert = database.executed.find((entry) => entry.sql.includes('INSERT INTO themes'));
    expect(themeInsert?.params).toEqual([
      'starter-ru-ancient-arms',
      'starter-ru-ancient-arms',
      'ru',
      JSON.stringify({ default: 'Древнее оружие и защита' }),
      JSON.stringify(['expert', 'history', 'weapons']),
      3,
      'imported',
      importedAt,
      importedAt,
    ]);

    const wordInserts = database.executed.filter((entry) => entry.sql.includes('INSERT INTO words'));
    expect(wordInserts).toHaveLength(2);
    expect(wordInserts[0]?.params).toEqual([
      'starter-ru-ancient-arms:word:kope',
      'starter-ru-ancient-arms',
      'копьё',
      'копье',
      'ru',
      1,
      1,
      JSON.stringify(['копье']),
      'alias for е/ё spelling',
      'imported',
      importedAt,
      importedAt,
    ]);
    expect(wordInserts[1]?.params[6]).toBe(1.5);

    const metadataInsert = database.executed.find((entry) => entry.sql.includes('INSERT INTO app_metadata'));
    expect(metadataInsert?.params[0]).toBe('theme_pack:frogword-theme-bank-draft');
    expect(JSON.parse(String(metadataInsert?.params[1]))).toMatchObject({
      formatVersion: 1,
      packId: 'frogword-theme-bank-draft',
      source: 'imported',
      themeIds: ['starter-ru-ancient-arms'],
      importedAt,
    });
  });

  it('supports built-in source without recording metadata', async () => {
    const database = new RecordingDatabase();

    await upsertThemeSeedPack(database, seedPack, {
      source: 'built_in',
      importedAt,
      recordMetadata: false,
    });

    expect(database.executed.some((entry) => entry.sql.includes('INSERT INTO app_metadata'))).toBe(false);
    const themeInsert = database.executed.find((entry) => entry.sql.includes('INSERT INTO themes'));
    expect(themeInsert?.params[6]).toBe('built_in');
  });

  it('rolls back when any seed write fails', async () => {
    const database = new RecordingDatabase();
    database.failOnStatement = 'INSERT INTO words';

    await expect(upsertThemeSeedPack(database, seedPack, { importedAt })).rejects.toThrow(
      'Failed on INSERT INTO words',
    );

    expect(database.executed.map((entry) => entry.sql)).toContain('ROLLBACK');
  });
});
