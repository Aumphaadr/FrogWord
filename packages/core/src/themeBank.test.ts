import { describe, expect, it } from 'vitest';
import {
  ThemeBankValidationError,
  createThemesFromThemeBank,
  parseThemeBank,
  themeBankToStarterThemePack,
} from './index.js';

const sampleBank = {
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
          key: 'kope',
          canonical: 'копьё',
          expertiseTier: 1,
          aliases: ['копье'],
          notes: 'е/ё alias is intentionally normalized to the same word',
        },
        {
          key: 'protazan',
          canonical: 'протазан',
          expertiseTier: 2,
          aliases: [],
        },
      ],
    },
    {
      id: 'starter-en-mythic-creatures',
      language: 'en',
      title: 'Mythic Creatures',
      minWordLength: 3,
      tags: ['expert', 'myths', 'creatures'],
      words: [
        {
          key: 'griffin',
          canonical: 'griffin',
          expertiseTier: 1,
          aliases: ['gryphon'],
        },
      ],
    },
  ],
};

describe('theme bank import', () => {
  it('converts authoring JSON into starter theme definitions with stable word ids', () => {
    const result = parseThemeBank(sampleBank);

    expect(result).toMatchObject({
      formatVersion: 1,
      packId: 'frogword-theme-bank-draft',
    });
    expect(result.themes).toHaveLength(2);
    expect(result.themes[0]?.words).toEqual([
      {
        id: 'starter-ru-ancient-arms:word:kope',
        canonical: 'копьё',
        expertiseTier: 1,
        aliases: ['копье'],
      },
      {
        id: 'starter-ru-ancient-arms:word:protazan',
        canonical: 'протазан',
        expertiseTier: 2,
        aliases: [],
      },
    ]);
  });

  it('creates usable themes and keeps same-word yo/e aliases valid', () => {
    const themes = createThemesFromThemeBank(sampleBank);
    const russianTheme = themes.find((theme) => theme.language === 'ru')!;

    expect(russianTheme.words[0]).toMatchObject({
      canonical: 'копьё',
      normalized: 'копье',
      aliases: ['копье'],
    });
    expect(russianTheme.words[1]?.scoreMultiplier).toBe(1.5);
  });

  it('can wrap an imported bank as a starter theme pack', () => {
    const pack = themeBankToStarterThemePack(sampleBank, {
      title: {
        ru: 'Черновой банк',
        en: 'Draft Bank',
      },
    });

    expect(pack.title.en).toBe('Draft Bank');
    expect(pack.themes.map((theme) => theme.id)).toEqual([
      'starter-ru-ancient-arms',
      'starter-en-mythic-creatures',
    ]);
  });

  it('reports structural and duplicate normalized-form errors', () => {
    const invalidBank = {
      formatVersion: 1,
      packId: 'Draft Pack',
      themes: [
        {
          id: 'bad-theme',
          language: 'ru',
          title: 'Bad',
          minWordLength: 3,
          tags: ['bad'],
          words: [
            {
              key: 'first',
              canonical: 'копьё',
              expertiseTier: 1,
              aliases: [],
            },
            {
              key: 'second',
              canonical: 'копье',
              expertiseTier: 3,
              aliases: [],
            },
          ],
        },
      ],
    };

    expect(() => parseThemeBank(invalidBank)).toThrow(ThemeBankValidationError);
    try {
      parseThemeBank(invalidBank);
    } catch (error) {
      expect(error).toBeInstanceOf(ThemeBankValidationError);
      expect((error as ThemeBankValidationError).issues).toEqual(expect.arrayContaining([
        'packId must use stable ASCII kebab-case or snake_case',
        'themes[0].words[1].expertiseTier must be 1 or 2',
        'themes[0].words[1].canonical duplicates normalized form "копье" from word key "first"',
      ]));
    }
  });
});
