import { describe, expect, it } from 'vitest';
import { loadThemeCatalog } from './themeCatalog.js';
import type { SqlDatabase, SqlValue } from './types.js';

interface ThemeRow {
  id: string;
  language: string;
  title_json: string;
  tags_json: string | null;
  min_word_length: number;
  source: string;
  updated_at: string;
}

interface WordRow {
  id: string;
  theme_id: string;
  canonical: string;
  normalized: string;
  language: string;
  expertise_tier: number;
  score_multiplier: number;
  aliases_json: string | null;
}

class ThemeCatalogDatabase implements SqlDatabase {
  readonly queries: { sql: string; params: readonly SqlValue[] }[] = [];

  constructor(
    private readonly themeRows: readonly ThemeRow[],
    private readonly wordRows: readonly WordRow[],
  ) {}

  async execute(): Promise<void> {}

  async query<T>(sql: string, params: readonly SqlValue[] = []): Promise<T[]> {
    this.queries.push({ sql: sql.trim(), params });

    if (sql.includes('FROM themes')) {
      return this.themeRows as T[];
    }

    if (sql.includes('FROM words')) {
      const themeIds = new Set(params.map(String));
      return this.wordRows.filter((row) => themeIds.has(row.theme_id)) as T[];
    }

    return [];
  }
}

const importedAt = '2026-07-07T00:30:00.000Z';

describe('theme catalog read side', () => {
  it('loads trusted themes with words, tags and aliases', async () => {
    const database = new ThemeCatalogDatabase(
      [
        {
          id: 'animals',
          language: 'en',
          title_json: JSON.stringify({ default: 'Animals', ru: 'Животные' }),
          tags_json: JSON.stringify(['nature', 'starter']),
          min_word_length: 3,
          source: 'imported',
          updated_at: importedAt,
        },
      ],
      [
        {
          id: 'animals:word:otter',
          theme_id: 'animals',
          canonical: 'otter',
          normalized: 'otter',
          language: 'en',
          expertise_tier: 1,
          score_multiplier: 1,
          aliases_json: JSON.stringify(['river otter']),
        },
        {
          id: 'animals:word:axolotl',
          theme_id: 'animals',
          canonical: 'axolotl',
          normalized: 'axolotl',
          language: 'en',
          expertise_tier: 2,
          score_multiplier: 1.5,
          aliases_json: null,
        },
      ],
    );

    const catalog = await loadThemeCatalog(database, { sources: ['imported'] });

    expect(catalog).toEqual([
      {
        id: 'animals',
        language: 'en',
        title: 'Animals',
        minWordLength: 3,
        tags: ['nature', 'starter'],
        source: 'imported',
        updatedAt: importedAt,
        words: [
          {
            id: 'animals:word:otter',
            canonical: 'otter',
            normalized: 'otter',
            language: 'en',
            expertiseTier: 1,
            scoreMultiplier: 1,
            aliases: ['river otter'],
          },
          {
            id: 'animals:word:axolotl',
            canonical: 'axolotl',
            normalized: 'axolotl',
            language: 'en',
            expertiseTier: 2,
            scoreMultiplier: 1.5,
            aliases: [],
          },
        ],
      },
    ]);
    expect(database.queries[0]?.params).toEqual(['imported']);
  });

  it('omits empty themes by default and can include them explicitly', async () => {
    const database = new ThemeCatalogDatabase(
      [
        {
          id: 'empty',
          language: 'ru',
          title_json: 'not json',
          tags_json: null,
          min_word_length: 0,
          source: 'user',
          updated_at: importedAt,
        },
      ],
      [],
    );

    await expect(loadThemeCatalog(database, { sources: ['imported', 'user'] })).resolves.toEqual([]);
    await expect(loadThemeCatalog(database, {
      sources: ['imported', 'user'],
      includeEmptyThemes: true,
    })).resolves.toEqual([
      {
        id: 'empty',
        language: 'ru',
        title: 'empty',
        minWordLength: 3,
        tags: [],
        source: 'user',
        updatedAt: importedAt,
        words: [],
      },
    ]);
    expect(database.queries[0]?.params).toEqual(['imported', 'user']);
  });
});
