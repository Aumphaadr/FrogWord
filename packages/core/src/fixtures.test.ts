import { describe, expect, it } from 'vitest';
import {
  STARTER_THEME_PACK,
  createStarterTheme,
  createStarterThemes,
  findThemeWord,
  getStarterThemeDefinitions,
  scoreWord,
} from './index.js';

describe('starter theme fixtures', () => {
  it('contains starter themes for Russian and English content', () => {
    expect(STARTER_THEME_PACK).toMatchObject({
      formatVersion: 1,
      packId: 'frogword-starter-core',
    });

    const themes = createStarterThemes();
    const languages = new Set(themes.map((theme) => theme.language));

    expect(languages).toEqual(new Set(['en', 'ru']));
    expect(themes).toHaveLength(20);
    expect(themes.filter((theme) => theme.language === 'ru')).toHaveLength(10);
    expect(themes.filter((theme) => theme.language === 'en')).toHaveLength(10);
    expect(themes.map((theme) => theme.id)).toEqual(expect.arrayContaining([
      'starter-ru-ancient-arms',
      'starter-ru-celestial-map',
      'starter-en-mythic-creatures',
      'starter-en-weather',
    ]));
  });

  it('filters starter themes by language', () => {
    const russianThemes = createStarterThemes('ru');
    const englishThemes = createStarterThemes('en');

    expect(russianThemes).toHaveLength(10);
    expect(russianThemes[0]).toMatchObject({
      id: 'starter-ru-ancient-arms',
      language: 'ru',
      title: 'Древнее оружие и защита',
    });
    expect(englishThemes).toHaveLength(10);
    expect(englishThemes[0]).toMatchObject({
      id: 'starter-en-mythic-creatures',
      language: 'en',
      title: 'Mythic Creatures',
    });
  });

  it('supports aliases and Russian yo/e normalization', () => {
    const russianTheme = createStarterTheme('starter-ru-ancient-arms');
    const englishTheme = createStarterTheme('starter-en-mythic-creatures');

    expect(findThemeWord(russianTheme, 'копье')?.word.canonical).toBe('копьё');
    expect(findThemeWord(englishTheme, 'gryphon')?.word.canonical).toBe('griffin');
    expect(findThemeWord(englishTheme, 'Jormungand')?.word.canonical).toBe('Jormungandr');
  });

  it('keeps common and exotic score differences stable', () => {
    const russianTheme = createStarterTheme('starter-ru-ancient-arms');
    const kolchuga = findThemeWord(russianTheme, 'кольчуга')!.word;
    const protazan = findThemeWord(russianTheme, 'протазан')!.word;

    expect(kolchuga.normalized).toHaveLength(protazan.normalized.length);
    expect(scoreWord(kolchuga)).toBe(80);
    expect(scoreWord(protazan)).toBe(120);
  });

  it('returns fresh mutable theme instances and cloned definitions', () => {
    const firstTheme = createStarterTheme('starter-en-mythic-creatures');
    const secondTheme = createStarterTheme('starter-en-mythic-creatures');
    firstTheme.words.push({
      id: 'test:word',
      canonical: 'test',
      normalized: 'test',
      language: 'en',
      expertiseTier: 1,
      scoreMultiplier: 1,
      aliases: [],
    });

    const firstDefinition = getStarterThemeDefinitions('en')[0]!;
    const secondDefinition = getStarterThemeDefinitions('en')[0]!;
    firstDefinition.words[0]!.aliases = ['mutated'];

    expect(secondTheme.words).toHaveLength(10);
    expect(secondDefinition.words[0]!.aliases).not.toEqual(['mutated']);
  });

  it('keeps starter theme and word ids unique across the alpha pack', () => {
    const themeIds = STARTER_THEME_PACK.themes.map((theme) => theme.id);
    const wordIds = STARTER_THEME_PACK.themes.flatMap((theme) => theme.words.map((word) => word.id));

    expect(new Set(themeIds).size).toBe(themeIds.length);
    expect(new Set(wordIds).size).toBe(wordIds.length);
    expect(STARTER_THEME_PACK.themes.every((theme) => theme.words.length >= 10)).toBe(true);
  });
});
