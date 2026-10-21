import type { Theme, ThemeLanguage, ThemeWord } from './types.js';

export interface ThemeIndexEntry {
  word: ThemeWord;
  matchedForm: string;
}

export interface ThemeIndex {
  theme: Theme;
  byNormalized: Map<string, ThemeIndexEntry>;
}

export function normalizeWord(value: string, language: ThemeLanguage): string {
  let normalized = value.trim().toLocaleLowerCase(language === 'ru' ? 'ru-RU' : 'en-US');

  if (language === 'ru') {
    normalized = normalized.replaceAll('ё', 'е');
  }

  return normalized;
}

export function createTheme(input: {
  id: string;
  language: ThemeLanguage;
  title: string;
  minWordLength?: number;
  words: Array<{
    id?: string;
    canonical: string;
    expertiseTier?: 1 | 2;
    aliases?: string[];
  }>;
}): Theme {
  const minWordLength = input.minWordLength ?? 3;

  return {
    id: input.id,
    language: input.language,
    title: input.title,
    minWordLength,
    words: input.words.map((word, index) => {
      const expertiseTier = word.expertiseTier ?? 1;
      return {
        id: word.id ?? `${input.id}:word:${index}`,
        canonical: word.canonical,
        normalized: normalizeWord(word.canonical, input.language),
        language: input.language,
        expertiseTier,
        scoreMultiplier: expertiseTier === 1 ? 1 : 1.5,
        aliases: word.aliases ?? [],
      };
    }),
  };
}

export function createThemeIndex(theme: Theme): ThemeIndex {
  const byNormalized = new Map<string, ThemeIndexEntry>();

  for (const word of theme.words) {
    byNormalized.set(word.normalized, { word, matchedForm: word.canonical });

    for (const alias of word.aliases) {
      byNormalized.set(normalizeWord(alias, theme.language), { word, matchedForm: alias });
    }
  }

  return { theme, byNormalized };
}

export function findThemeWord(theme: Theme, rawValue: string): ThemeIndexEntry | undefined {
  const normalized = normalizeWord(rawValue, theme.language);
  return createThemeIndex(theme).byNormalized.get(normalized);
}

export function scoreWord(word: ThemeWord): number {
  return Math.round(word.normalized.length * 10 * word.scoreMultiplier);
}
