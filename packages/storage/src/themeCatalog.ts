import type { SqlDatabase } from './types.js';
import type { ThemeSeedLanguage, ThemeSeedSource } from './themeSeeds.js';

export interface StoredThemeCatalogWord {
  id: string;
  canonical: string;
  normalized: string;
  language: ThemeSeedLanguage;
  expertiseTier: 1 | 2;
  scoreMultiplier: number;
  aliases: readonly string[];
}

export interface StoredThemeCatalogTheme {
  id: string;
  language: ThemeSeedLanguage;
  title: string;
  minWordLength: number;
  tags: readonly string[];
  source: ThemeSeedSource;
  updatedAt: string;
  words: readonly StoredThemeCatalogWord[];
}

export interface LoadThemeCatalogOptions {
  sources?: readonly ThemeSeedSource[];
  includeEmptyThemes?: boolean;
}

interface ThemeCatalogThemeRow {
  id: string;
  language: string;
  title_json: string;
  tags_json: string | null;
  min_word_length: number;
  source: string;
  updated_at: string;
}

interface ThemeCatalogWordRow {
  id: string;
  theme_id: string;
  canonical: string;
  normalized: string;
  language: string;
  expertise_tier: number;
  score_multiplier: number;
  aliases_json: string | null;
}

export async function loadThemeCatalog(
  database: SqlDatabase,
  options: LoadThemeCatalogOptions = {},
): Promise<StoredThemeCatalogTheme[]> {
  const sources = options.sources ?? [];
  const sourceSql = sources.length > 0
    ? `WHERE source IN (${sources.map(() => '?').join(', ')})`
    : '';
  const themeRows = await database.query<ThemeCatalogThemeRow>(
    `
    SELECT id, language, title_json, tags_json, min_word_length, source, updated_at
    FROM themes
    ${sourceSql}
    ORDER BY language ASC, title_json ASC, id ASC
    `,
    sources,
  );

  if (themeRows.length === 0) {
    return [];
  }

  const themeIds = themeRows.map((row) => row.id);
  const wordRows = await database.query<ThemeCatalogWordRow>(
    `
    SELECT id, theme_id, canonical, normalized, language, expertise_tier, score_multiplier, aliases_json
    FROM words
    WHERE theme_id IN (${themeIds.map(() => '?').join(', ')})
      AND safety_status = 'trusted'
    ORDER BY theme_id ASC, canonical ASC, id ASC
    `,
    themeIds,
  );
  const wordsByTheme = groupWordsByTheme(wordRows);

  return themeRows.flatMap((row) => {
    const language = readLanguage(row.language);
    if (!language) {
      return [];
    }

    const words = wordsByTheme.get(row.id) ?? [];
    if (words.length === 0 && !(options.includeEmptyThemes ?? false)) {
      return [];
    }

    return [{
      id: row.id,
      language,
      title: readTitle(row.title_json, row.id),
      minWordLength: readPositiveInteger(row.min_word_length, 3),
      tags: readStringArray(row.tags_json),
      source: readSource(row.source),
      updatedAt: row.updated_at,
      words,
    }];
  });
}

function groupWordsByTheme(rows: readonly ThemeCatalogWordRow[]): Map<string, StoredThemeCatalogWord[]> {
  const grouped = new Map<string, StoredThemeCatalogWord[]>();

  for (const row of rows) {
    const language = readLanguage(row.language);
    const expertiseTier = readExpertiseTier(row.expertise_tier);
    if (!language || !expertiseTier) {
      continue;
    }

    const bucket = grouped.get(row.theme_id) ?? [];
    bucket.push({
      id: row.id,
      canonical: row.canonical,
      normalized: row.normalized,
      language,
      expertiseTier,
      scoreMultiplier: readPositiveNumber(row.score_multiplier, expertiseTier === 1 ? 1 : 1.5),
      aliases: readStringArray(row.aliases_json),
    });
    grouped.set(row.theme_id, bucket);
  }

  return grouped;
}

function readLanguage(value: string): ThemeSeedLanguage | undefined {
  return value === 'ru' || value === 'en' ? value : undefined;
}

function readSource(value: string): ThemeSeedSource {
  if (value === 'built_in' || value === 'imported' || value === 'user') {
    return value;
  }

  return 'user';
}

function readExpertiseTier(value: number): 1 | 2 | undefined {
  return value === 1 || value === 2 ? value : undefined;
}

function readPositiveInteger(value: number, fallback: number): number {
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

function readPositiveNumber(value: number, fallback: number): number {
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function readTitle(value: string, fallback: string): string {
  const parsed = parseJson(value);
  if (typeof parsed === 'string') {
    return parsed.trim() || fallback;
  }

  if (isRecord(parsed)) {
    const defaultTitle = parsed.default;
    if (typeof defaultTitle === 'string' && defaultTitle.trim()) {
      return defaultTitle;
    }

    for (const candidate of Object.values(parsed)) {
      if (typeof candidate === 'string' && candidate.trim()) {
        return candidate;
      }
    }
  }

  return fallback;
}

function readStringArray(value: string | null): string[] {
  const parsed = value ? parseJson(value) : [];
  if (!Array.isArray(parsed)) {
    return [];
  }

  return parsed.flatMap((entry) => {
    if (typeof entry !== 'string') {
      return [];
    }

    const trimmed = entry.trim();
    return trimmed ? [trimmed] : [];
  });
}

function parseJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
