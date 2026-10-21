import {
  createStarterTheme,
  getStarterThemeDefinitions,
  type Theme,
  type ThemeLanguage,
} from '@frogword/core';
import {
  loadThemeCatalog as loadStoredThemeCatalog,
  type StoredThemeCatalogTheme,
  type ThemeSeedSource,
} from '@frogword/storage';
import { initializeNativeStorage } from './nativeStorage';

export type ThemeCatalogEntrySource = 'starter' | Extract<ThemeSeedSource, 'imported' | 'user'>;

export interface ThemeCatalogEntry {
  id: string;
  language: ThemeLanguage;
  title: string;
  minWordLength: number;
  tags: readonly string[];
  source: ThemeCatalogEntrySource;
  wordCount: number;
  theme: Theme;
}

export interface DesktopThemeCatalog {
  entries: ThemeCatalogEntry[];
  storedCount: number;
  storageAvailable: boolean;
}

export function createStarterThemeCatalogEntries(): ThemeCatalogEntry[] {
  return getStarterThemeDefinitions().map((definition) => {
    const theme = createStarterTheme(definition.id);
    return {
      id: definition.id,
      language: definition.language,
      title: definition.title,
      minWordLength: definition.minWordLength,
      tags: [...definition.tags],
      source: 'starter',
      wordCount: definition.words.length,
      theme,
    };
  });
}

export async function loadDesktopThemeCatalog(): Promise<DesktopThemeCatalog> {
  const starterEntries = createStarterThemeCatalogEntries();
  const storage = await initializeNativeStorage();

  if (!storage) {
    return {
      entries: starterEntries,
      storedCount: 0,
      storageAvailable: false,
    };
  }

  const storedThemes = await loadStoredThemeCatalog(storage.database, {
    sources: ['imported', 'user'],
  });
  const entries = mergeThemeCatalog(starterEntries, storedThemes.map(storedThemeToCatalogEntry));

  return {
    entries,
    storedCount: storedThemes.length,
    storageAvailable: true,
  };
}

function mergeThemeCatalog(
  starterEntries: readonly ThemeCatalogEntry[],
  storedEntries: readonly ThemeCatalogEntry[],
): ThemeCatalogEntry[] {
  const entriesById = new Map<string, ThemeCatalogEntry>();
  for (const entry of starterEntries) {
    entriesById.set(entry.id, entry);
  }
  for (const entry of storedEntries) {
    entriesById.set(entry.id, entry);
  }

  return [...entriesById.values()].sort(compareCatalogEntries);
}

function storedThemeToCatalogEntry(stored: StoredThemeCatalogTheme): ThemeCatalogEntry {
  const theme: Theme = {
    id: stored.id,
    language: stored.language,
    title: stored.title,
    minWordLength: stored.minWordLength,
    words: stored.words.map((word) => ({
      id: word.id,
      canonical: word.canonical,
      normalized: word.normalized,
      language: word.language,
      expertiseTier: word.expertiseTier,
      scoreMultiplier: word.scoreMultiplier,
      aliases: [...word.aliases],
    })),
  };

  return {
    id: stored.id,
    language: stored.language,
    title: stored.title,
    minWordLength: stored.minWordLength,
    tags: [...stored.tags],
    source: stored.source === 'user' ? 'user' : 'imported',
    wordCount: stored.words.length,
    theme,
  };
}

function compareCatalogEntries(left: ThemeCatalogEntry, right: ThemeCatalogEntry): number {
  return sourceRank(left.source) - sourceRank(right.source)
    || left.language.localeCompare(right.language)
    || left.title.localeCompare(right.title, left.language === 'ru' ? 'ru-RU' : 'en-US')
    || left.id.localeCompare(right.id);
}

function sourceRank(source: ThemeCatalogEntrySource): number {
  switch (source) {
    case 'starter':
      return 0;
    case 'imported':
      return 1;
    case 'user':
      return 2;
  }
}
