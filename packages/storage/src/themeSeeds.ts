import type { SqlDatabase } from './types.js';

export type ThemeSeedLanguage = 'ru' | 'en';
export type ThemeSeedSource = 'built_in' | 'imported' | 'user';

export interface ThemeSeedWordDefinition {
  id: string;
  canonical: string;
  expertiseTier: 1 | 2;
  aliases?: readonly string[];
  notes?: string;
}

export interface ThemeSeedDefinition {
  id: string;
  language: ThemeSeedLanguage;
  title: string;
  minWordLength: number;
  tags: readonly string[];
  words: readonly ThemeSeedWordDefinition[];
}

export interface ThemeSeedPack {
  formatVersion: 1;
  packId: string;
  themes: readonly ThemeSeedDefinition[];
}

export interface UpsertThemeSeedPackOptions {
  source?: ThemeSeedSource;
  importedAt?: string;
  recordMetadata?: boolean;
}

export interface ThemeSeedUpsertResult {
  packId: string;
  themeCount: number;
  wordCount: number;
}

const DEFAULT_SOURCE: ThemeSeedSource = 'imported';

export async function upsertThemeSeedPack(
  database: SqlDatabase,
  pack: ThemeSeedPack,
  options: UpsertThemeSeedPackOptions = {},
  now: () => string = () => new Date().toISOString(),
): Promise<ThemeSeedUpsertResult> {
  const importedAt = options.importedAt ?? now();
  const source = options.source ?? DEFAULT_SOURCE;

  await database.execute('BEGIN');
  try {
    for (const theme of pack.themes) {
      await upsertTheme(database, theme, source, importedAt);
    }

    if (options.recordMetadata ?? true) {
      await recordThemePackMetadata(database, pack, source, importedAt);
    }

    await database.execute('COMMIT');
  } catch (error) {
    await rollbackQuietly(database);
    throw error;
  }

  return {
    packId: pack.packId,
    themeCount: pack.themes.length,
    wordCount: pack.themes.reduce((sum, theme) => sum + theme.words.length, 0),
  };
}

async function upsertTheme(
  database: SqlDatabase,
  theme: ThemeSeedDefinition,
  source: ThemeSeedSource,
  importedAt: string,
): Promise<void> {
  await database.execute(
    `
    INSERT INTO themes (
      id, slug, language, title_json, description_json, tags_json, difficulty,
      min_word_length, safety_status, source, version, created_at, updated_at
    )
    VALUES (?, ?, ?, ?, NULL, ?, NULL, ?, 'trusted', ?, 1, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      slug = excluded.slug,
      language = excluded.language,
      title_json = excluded.title_json,
      tags_json = excluded.tags_json,
      min_word_length = excluded.min_word_length,
      source = excluded.source,
      updated_at = excluded.updated_at
    `,
    [
      theme.id,
      theme.id,
      theme.language,
      json({ default: theme.title }),
      json(theme.tags),
      theme.minWordLength,
      source,
      importedAt,
      importedAt,
    ],
  );

  for (const word of theme.words) {
    await upsertThemeWord(database, theme, word, source, importedAt);
  }
}

async function upsertThemeWord(
  database: SqlDatabase,
  theme: ThemeSeedDefinition,
  word: ThemeSeedWordDefinition,
  source: ThemeSeedSource,
  importedAt: string,
): Promise<void> {
  await database.execute(
    `
    INSERT INTO words (
      id, theme_id, canonical, normalized, language, expertise_tier,
      score_multiplier, aliases_json, notes, safety_status, source, created_at, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'trusted', ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      theme_id = excluded.theme_id,
      canonical = excluded.canonical,
      normalized = excluded.normalized,
      language = excluded.language,
      expertise_tier = excluded.expertise_tier,
      score_multiplier = excluded.score_multiplier,
      aliases_json = excluded.aliases_json,
      notes = excluded.notes,
      source = excluded.source,
      updated_at = excluded.updated_at
    `,
    [
      word.id,
      theme.id,
      word.canonical,
      normalizeSeedWord(word.canonical, theme.language),
      theme.language,
      word.expertiseTier,
      scoreMultiplier(word.expertiseTier),
      json(word.aliases ?? []),
      word.notes ?? null,
      source,
      importedAt,
      importedAt,
    ],
  );
}

async function recordThemePackMetadata(
  database: SqlDatabase,
  pack: ThemeSeedPack,
  source: ThemeSeedSource,
  importedAt: string,
): Promise<void> {
  await database.execute(
    `
    INSERT INTO app_metadata (key, value_json, updated_at)
    VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET
      value_json = excluded.value_json,
      updated_at = excluded.updated_at
    `,
    [
      `theme_pack:${pack.packId}`,
      json({
        formatVersion: pack.formatVersion,
        packId: pack.packId,
        source,
        themeIds: pack.themes.map((theme) => theme.id),
        importedAt,
      }),
      importedAt,
    ],
  );
}

async function rollbackQuietly(database: SqlDatabase): Promise<void> {
  try {
    await database.execute('ROLLBACK');
  } catch {
    // Preserve the original seed error.
  }
}

function normalizeSeedWord(value: string, language: ThemeSeedLanguage): string {
  let normalized = value.trim().toLocaleLowerCase(language === 'ru' ? 'ru-RU' : 'en-US');
  if (language === 'ru') {
    normalized = normalized.replaceAll('ё', 'е');
  }

  return normalized;
}

function scoreMultiplier(expertiseTier: 1 | 2): number {
  return expertiseTier === 1 ? 1 : 1.5;
}

function json(value: unknown): string {
  return JSON.stringify(value);
}
