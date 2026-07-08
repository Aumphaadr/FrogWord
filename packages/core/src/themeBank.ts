import type { Theme, ThemeLanguage } from './types.js';
import type {
  StarterThemeDefinition,
  StarterThemePack,
  StarterThemeWordDefinition,
} from './fixtures.js';
import { createTheme, normalizeWord } from './words.js';

export interface ThemeBankImportResult {
  formatVersion: 1;
  packId: string;
  themes: StarterThemeDefinition[];
}

export interface ThemeBankImportOptions {
  title?: StarterThemePack['title'];
}

export class ThemeBankValidationError extends Error {
  readonly issues: readonly string[];

  constructor(issues: readonly string[]) {
    super(`Invalid theme bank:\n- ${issues.join('\n- ')}`);
    this.name = 'ThemeBankValidationError';
    this.issues = issues;
  }
}

const STABLE_ID_PATTERN = /^[a-z0-9]+(?:[-_][a-z0-9]+)*$/;

export function parseThemeBank(input: unknown): ThemeBankImportResult {
  const errors: string[] = [];

  if (!isRecord(input)) {
    throw new ThemeBankValidationError(['root must be an object']);
  }

  if (input.formatVersion !== 1) {
    errors.push('formatVersion must be 1');
  }

  const packId = readRequiredString(input.packId, 'packId', errors) ?? 'invalid-pack';
  validateStableId(packId, 'packId', errors);

  const rawThemes = readArray(input.themes, 'themes', errors);
  const themeIds = new Set<string>();
  const themes = rawThemes.flatMap((rawTheme, themeIndex) => {
    const path = `themes[${themeIndex}]`;
    const parsed = parseThemeDefinition(rawTheme, path, themeIds, errors);
    return parsed ? [parsed] : [];
  });

  if (themes.length === 0) {
    errors.push('themes must contain at least one valid theme object');
  }

  if (errors.length > 0) {
    throw new ThemeBankValidationError(errors);
  }

  return {
    formatVersion: 1,
    packId,
    themes,
  };
}

export function themeBankToStarterThemePack(
  input: unknown,
  options: ThemeBankImportOptions = {},
): StarterThemePack {
  const parsed = parseThemeBank(input);
  return {
    formatVersion: 1,
    packId: parsed.packId,
    title: options.title ?? {
      ru: parsed.packId,
      en: parsed.packId,
    },
    themes: parsed.themes,
  };
}

export function createThemesFromThemeBank(input: unknown): Theme[] {
  return parseThemeBank(input).themes.map((definition) => createTheme({
    id: definition.id,
    language: definition.language,
    title: definition.title,
    minWordLength: definition.minWordLength,
    words: definition.words.map((word) => ({
      id: word.id,
      canonical: word.canonical,
      expertiseTier: word.expertiseTier,
      aliases: word.aliases ?? [],
    })),
  }));
}

function parseThemeDefinition(
  input: unknown,
  path: string,
  themeIds: Set<string>,
  errors: string[],
): StarterThemeDefinition | undefined {
  if (!isRecord(input)) {
    errors.push(`${path} must be an object`);
    return undefined;
  }

  const id = readRequiredString(input.id, `${path}.id`, errors) ?? `${path}:invalid`;
  validateStableId(id, `${path}.id`, errors);
  if (themeIds.has(id)) {
    errors.push(`${path}.id duplicates theme id "${id}"`);
  }
  themeIds.add(id);

  const language = readThemeLanguage(input.language, `${path}.language`, errors);
  const title = readRequiredString(input.title, `${path}.title`, errors) ?? id;
  const minWordLength = readPositiveInteger(input.minWordLength, `${path}.minWordLength`, errors) ?? 3;
  const tags = readRequiredStringArray(input.tags, `${path}.tags`, errors);
  const rawWords = readArray(input.words, `${path}.words`, errors);
  const wordKeys = new Set<string>();
  const normalizedOwners = new Map<string, string>();
  const words = rawWords.flatMap((rawWord, wordIndex) => {
    const parsed = parseWordDefinition(
      rawWord,
      `${path}.words[${wordIndex}]`,
      id,
      language,
      minWordLength,
      wordKeys,
      normalizedOwners,
      errors,
    );
    return parsed ? [parsed] : [];
  });

  if (words.length === 0) {
    errors.push(`${path}.words must contain at least one valid word object`);
  }

  if (!language) {
    return undefined;
  }

  return {
    id,
    language,
    title,
    minWordLength,
    tags,
    words,
  };
}

function parseWordDefinition(
  input: unknown,
  path: string,
  themeId: string,
  language: ThemeLanguage | undefined,
  minWordLength: number,
  wordKeys: Set<string>,
  normalizedOwners: Map<string, string>,
  errors: string[],
): StarterThemeWordDefinition | undefined {
  if (!isRecord(input)) {
    errors.push(`${path} must be an object`);
    return undefined;
  }

  const key = readRequiredString(input.key, `${path}.key`, errors) ?? `${path}:invalid`;
  validateStableId(key, `${path}.key`, errors);
  if (wordKeys.has(key)) {
    errors.push(`${path}.key duplicates word key "${key}"`);
  }
  wordKeys.add(key);

  const canonical = readRequiredString(input.canonical, `${path}.canonical`, errors) ?? '';
  const expertiseTier = readExpertiseTier(input.expertiseTier, `${path}.expertiseTier`, errors);
  const aliases = readRequiredStringArray(input.aliases, `${path}.aliases`, errors);

  if (language && canonical) {
    validateWordLength(canonical, minWordLength, language, `${path}.canonical`, errors);
    registerNormalizedForm(canonical, key, language, normalizedOwners, `${path}.canonical`, errors);
    for (const [aliasIndex, alias] of aliases.entries()) {
      registerNormalizedForm(alias, key, language, normalizedOwners, `${path}.aliases[${aliasIndex}]`, errors);
    }
  }

  if (!expertiseTier || !canonical) {
    return undefined;
  }

  return {
    id: `${themeId}:word:${key}`,
    canonical,
    expertiseTier,
    aliases,
  };
}

function validateWordLength(
  value: string,
  minWordLength: number,
  language: ThemeLanguage,
  path: string,
  errors: string[],
): void {
  const normalized = normalizeWord(value, language);
  if (normalized.length < minWordLength) {
    errors.push(`${path} is shorter than minWordLength ${minWordLength}`);
  }
}

function registerNormalizedForm(
  value: string,
  ownerKey: string,
  language: ThemeLanguage,
  normalizedOwners: Map<string, string>,
  path: string,
  errors: string[],
): void {
  const normalized = normalizeWord(value, language);
  const existingOwner = normalizedOwners.get(normalized);
  if (existingOwner && existingOwner !== ownerKey) {
    errors.push(`${path} duplicates normalized form "${normalized}" from word key "${existingOwner}"`);
    return;
  }

  normalizedOwners.set(normalized, ownerKey);
}

function readThemeLanguage(value: unknown, path: string, errors: string[]): ThemeLanguage | undefined {
  if (value === 'ru' || value === 'en') {
    return value;
  }

  errors.push(`${path} must be "ru" or "en"`);
  return undefined;
}

function readExpertiseTier(value: unknown, path: string, errors: string[]): 1 | 2 | undefined {
  if (value === 1 || value === 2) {
    return value;
  }

  errors.push(`${path} must be 1 or 2`);
  return undefined;
}

function readPositiveInteger(value: unknown, path: string, errors: string[]): number | undefined {
  if (Number.isInteger(value) && typeof value === 'number' && value > 0) {
    return value;
  }

  errors.push(`${path} must be a positive integer`);
  return undefined;
}

function readRequiredString(value: unknown, path: string, errors: string[]): string | undefined {
  if (typeof value === 'string' && value.trim().length > 0) {
    return value;
  }

  errors.push(`${path} must be a non-empty string`);
  return undefined;
}

function readRequiredStringArray(value: unknown, path: string, errors: string[]): string[] {
  if (!Array.isArray(value)) {
    errors.push(`${path} must be an array`);
    return [];
  }

  const result: string[] = [];
  value.forEach((entry, index) => {
    if (typeof entry === 'string' && entry.trim().length > 0) {
      result.push(entry);
      return;
    }

    errors.push(`${path}[${index}] must be a non-empty string`);
  });

  return result;
}

function readArray(value: unknown, path: string, errors: string[]): unknown[] {
  if (Array.isArray(value)) {
    return value;
  }

  errors.push(`${path} must be an array`);
  return [];
}

function validateStableId(value: string, path: string, errors: string[]): void {
  if (!STABLE_ID_PATTERN.test(value)) {
    errors.push(`${path} must use stable ASCII kebab-case or snake_case`);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
