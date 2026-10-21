import { ThemeBankValidationError, parseThemeBank } from '@frogword/core';
import { upsertThemeSeedPack, type ThemeSeedUpsertResult } from '@frogword/storage';
import { initializeNativeStorage } from './nativeStorage';

export interface ThemeBankImportPreview {
  packId: string;
  themeCount: number;
  wordCount: number;
  languageCounts: {
    ru: number;
    en: number;
  };
  sampleThemes: string[];
}

export interface ThemeBankImportDraft {
  rawJson: string;
  preview: ThemeBankImportPreview;
}

export interface ThemeBankImportResult {
  preview: ThemeBankImportPreview;
  storage: ThemeSeedUpsertResult;
}

export class ThemeBankImportError extends Error {
  readonly issues: readonly string[];

  constructor(issues: readonly string[]) {
    super(`Theme bank import failed:\n- ${issues.join('\n- ')}`);
    this.name = 'ThemeBankImportError';
    this.issues = issues;
  }
}

export function previewThemeBankImport(rawJson: string): ThemeBankImportDraft {
  const pack = parseThemeBankJson(rawJson);

  return {
    rawJson,
    preview: {
      packId: pack.packId,
      themeCount: pack.themes.length,
      wordCount: pack.themes.reduce((sum, theme) => sum + theme.words.length, 0),
      languageCounts: {
        ru: pack.themes.filter((theme) => theme.language === 'ru').length,
        en: pack.themes.filter((theme) => theme.language === 'en').length,
      },
      sampleThemes: pack.themes.slice(0, 4).map((theme) => theme.title),
    },
  };
}

export async function importThemeBank(rawJson: string): Promise<ThemeBankImportResult> {
  const pack = parseThemeBankJson(rawJson);
  const storage = await initializeNativeStorage();

  if (!storage) {
    throw new ThemeBankImportError(['Native SQLite storage is unavailable']);
  }

  const result = await upsertThemeSeedPack(storage.database, pack, {
    source: 'imported',
  });

  return {
    preview: previewThemeBankImport(rawJson).preview,
    storage: result,
  };
}

function parseThemeBankJson(rawJson: string): ReturnType<typeof parseThemeBank> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawJson);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new ThemeBankImportError([`JSON parse error: ${message}`]);
  }

  try {
    return parseThemeBank(parsed);
  } catch (error) {
    if (error instanceof ThemeBankValidationError) {
      throw new ThemeBankImportError(error.issues);
    }

    throw error;
  }
}
