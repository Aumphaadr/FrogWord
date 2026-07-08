import type { LocaleCode, Theme, ThemeLanguage } from './types.js';
import { createTheme } from './words.js';

export interface StarterThemeWordDefinition {
  id: string;
  canonical: string;
  expertiseTier: 1 | 2;
  aliases?: string[];
}

export interface StarterThemeDefinition {
  id: string;
  language: ThemeLanguage;
  title: string;
  minWordLength: number;
  tags: string[];
  words: StarterThemeWordDefinition[];
}

export interface StarterThemePack {
  formatVersion: 1;
  packId: string;
  title: Record<LocaleCode, string>;
  themes: StarterThemeDefinition[];
}

type StarterThemeWordEntry = readonly [
  key: string,
  canonical: string,
  expertiseTier?: 1 | 2,
  aliases?: readonly string[],
];

export const STARTER_THEME_PACK: StarterThemePack = {
  formatVersion: 1,
  packId: 'frogword-starter-core',
  title: {
    ru: 'Стартовый набор FrogWord',
    en: 'FrogWord Starter Pack',
  },
  themes: [
    {
      id: 'starter-ru-ancient-arms',
      language: 'ru',
      title: 'Древнее оружие и защита',
      minWordLength: 3,
      tags: ['expert', 'history', 'weapons'],
      words: starterWords('starter-ru-ancient-arms', [
        ['kolchuga', 'кольчуга'],
        ['alebarda', 'алебарда'],
        ['mech', 'меч'],
        ['shchit', 'щит'],
        ['kope', 'копьё', 1, ['копье']],
        ['berdysh', 'бердыш', 2],
        ['naginata', 'нагината', 2],
        ['protazan', 'протазан', 2],
        ['intrepel', 'интрепель', 2],
        ['falx', 'фалькс', 2],
      ]),
    },
    {
      id: 'starter-ru-ancient-deities',
      language: 'ru',
      title: 'Древние божества',
      minWordLength: 3,
      tags: ['expert', 'mythology', 'deities'],
      words: starterWords('starter-ru-ancient-deities', [
        ['zeus', 'Зевс'],
        ['poseidon', 'Посейдон'],
        ['hades', 'Аид', 1, ['Гадес']],
        ['hera', 'Гера'],
        ['athena', 'Афина'],
        ['apollo', 'Аполлон'],
        ['artemis', 'Артемида'],
        ['aphrodite', 'Афродита'],
        ['hephaestus', 'Гефест', 2],
        ['persephone', 'Персефона', 2],
      ]),
    },
    {
      id: 'starter-ru-celestial-map',
      language: 'ru',
      title: 'Небесная карта',
      minWordLength: 3,
      tags: ['science', 'space', 'astronomy'],
      words: starterWords('starter-ru-celestial-map', [
        ['zvezda', 'звезда'],
        ['planeta', 'планета'],
        ['kometa', 'комета'],
        ['orbita', 'орбита'],
        ['galaktika', 'галактика'],
        ['sputnik', 'спутник'],
        ['tumannost', 'туманность', 2],
        ['kvazar', 'квазар', 2],
        ['pulsar', 'пульсар', 2],
        ['ekliptika', 'эклиптика', 2],
      ]),
    },
    {
      id: 'starter-ru-minerals',
      language: 'ru',
      title: 'Камни и минералы',
      minWordLength: 3,
      tags: ['nature', 'geology', 'minerals'],
      words: starterWords('starter-ru-minerals', [
        ['granit', 'гранит'],
        ['mramor', 'мрамор'],
        ['kvarc', 'кварц'],
        ['opal', 'опал'],
        ['rubin', 'рубин'],
        ['almaz', 'алмаз'],
        ['obsidian', 'обсидиан', 2],
        ['malahit', 'малахит', 2],
        ['ametist', 'аметист', 2],
        ['lazurit', 'лазурит', 2],
      ]),
    },
    {
      id: 'starter-ru-musical-instruments',
      language: 'ru',
      title: 'Музыкальные инструменты',
      minWordLength: 3,
      tags: ['culture', 'music', 'instruments'],
      words: starterWords('starter-ru-musical-instruments', [
        ['gitara', 'гитара'],
        ['skripka', 'скрипка'],
        ['truba', 'труба'],
        ['baraban', 'барабан'],
        ['fleyta', 'флейта'],
        ['royal', 'рояль'],
        ['klavesin', 'клавесин', 2],
        ['goboy', 'гобой', 2],
        ['valtorna', 'валторна', 2],
        ['bandura', 'бандура', 2],
      ]),
    },
    {
      id: 'starter-ru-kitchen-tools',
      language: 'ru',
      title: 'Кухонная утварь',
      minWordLength: 3,
      tags: ['home', 'food', 'tools'],
      words: starterWords('starter-ru-kitchen-tools', [
        ['lozhka', 'ложка'],
        ['vilka', 'вилка'],
        ['nozh', 'нож'],
        ['kovsh', 'ковш'],
        ['tarelka', 'тарелка'],
        ['skovoroda', 'сковорода'],
        ['durshlag', 'дуршлаг', 2],
        ['soteinik', 'сотейник', 2],
        ['venchik', 'венчик', 2],
        ['stupka', 'ступка', 2],
      ]),
    },
    {
      id: 'starter-ru-architecture',
      language: 'ru',
      title: 'Архитектура',
      minWordLength: 3,
      tags: ['city', 'architecture', 'buildings'],
      words: starterWords('starter-ru-architecture', [
        ['arka', 'арка'],
        ['bashnya', 'башня'],
        ['kolonna', 'колонна'],
        ['fasad', 'фасад'],
        ['kupol', 'купол'],
        ['portal', 'портал'],
        ['arkada', 'аркада', 2],
        ['kontrafors', 'контрфорс', 2],
        ['kapitel', 'капитель', 2],
        ['anfilada', 'анфилада', 2],
      ]),
    },
    {
      id: 'starter-ru-seafaring',
      language: 'ru',
      title: 'Морское дело',
      minWordLength: 3,
      tags: ['sea', 'navigation', 'ships'],
      words: starterWords('starter-ru-seafaring', [
        ['yakor', 'якорь'],
        ['paluba', 'палуба'],
        ['macht', 'мачта'],
        ['parus', 'парус'],
        ['kompas', 'компас'],
        ['shkval', 'шквал'],
        ['bramsey', 'брамсель', 2],
        ['kambuz', 'камбуз', 2],
        ['forshteven', 'форштевень', 2],
        ['bakbort', 'бакборт', 2],
      ]),
    },
    {
      id: 'starter-ru-garden-plants',
      language: 'ru',
      title: 'Садовые растения',
      minWordLength: 3,
      tags: ['nature', 'garden', 'plants'],
      words: starterWords('starter-ru-garden-plants', [
        ['roza', 'роза'],
        ['pion', 'пион'],
        ['iris', 'ирис'],
        ['liliya', 'лилия'],
        ['astra', 'астра'],
        ['floks', 'флокс'],
        ['nasturciya', 'настурция', 2],
        ['gortenziya', 'гортензия', 2],
        ['delphinium', 'дельфиниум', 2],
        ['ehinaceya', 'эхинацея', 2],
      ]),
    },
    {
      id: 'starter-ru-professions',
      language: 'ru',
      title: 'Профессии',
      minWordLength: 3,
      tags: ['people', 'work', 'jobs'],
      words: starterWords('starter-ru-professions', [
        ['vrach', 'врач'],
        ['povar', 'повар'],
        ['pilot', 'пилот'],
        ['akter', 'актёр', 1, ['актер']],
        ['kuznec', 'кузнец'],
        ['uchitel', 'учитель'],
        ['arhivar', 'архивар', 2],
        ['kartograf', 'картограф', 2],
        ['restavrator', 'реставратор', 2],
        ['meteorolog', 'метеоролог', 2],
      ]),
    },
    {
      id: 'starter-en-mythic-creatures',
      language: 'en',
      title: 'Mythic Creatures',
      minWordLength: 3,
      tags: ['expert', 'myths', 'creatures'],
      words: starterWords('starter-en-mythic-creatures', [
        ['dragon', 'dragon'],
        ['griffin', 'griffin', 1, ['gryphon']],
        ['golem', 'golem'],
        ['mermaid', 'mermaid'],
        ['phoenix', 'phoenix'],
        ['basilisk', 'basilisk', 2],
        ['manticore', 'manticore', 2],
        ['jormungandr', 'Jormungandr', 2, ['Jormungand']],
        ['orthrus', 'Orthrus', 2, ['Orthos']],
        ['amphisbaena', 'Amphisbaena', 2],
      ]),
    },
    {
      id: 'starter-en-celestial-map',
      language: 'en',
      title: 'Celestial Map',
      minWordLength: 3,
      tags: ['science', 'space', 'astronomy'],
      words: starterWords('starter-en-celestial-map', [
        ['star', 'star'],
        ['planet', 'planet'],
        ['comet', 'comet'],
        ['orbit', 'orbit'],
        ['galaxy', 'galaxy'],
        ['satellite', 'satellite'],
        ['nebula', 'nebula', 2],
        ['quasar', 'quasar', 2],
        ['pulsar', 'pulsar', 2],
        ['ecliptic', 'ecliptic', 2],
      ]),
    },
    {
      id: 'starter-en-minerals',
      language: 'en',
      title: 'Stones and Minerals',
      minWordLength: 3,
      tags: ['nature', 'geology', 'minerals'],
      words: starterWords('starter-en-minerals', [
        ['granite', 'granite'],
        ['marble', 'marble'],
        ['quartz', 'quartz'],
        ['opal', 'opal'],
        ['ruby', 'ruby'],
        ['diamond', 'diamond'],
        ['obsidian', 'obsidian', 2],
        ['malachite', 'malachite', 2],
        ['amethyst', 'amethyst', 2],
        ['lapis', 'lapis', 2, ['lapis lazuli']],
      ]),
    },
    {
      id: 'starter-en-musical-instruments',
      language: 'en',
      title: 'Musical Instruments',
      minWordLength: 3,
      tags: ['culture', 'music', 'instruments'],
      words: starterWords('starter-en-musical-instruments', [
        ['guitar', 'guitar'],
        ['violin', 'violin'],
        ['trumpet', 'trumpet'],
        ['drum', 'drum'],
        ['flute', 'flute'],
        ['piano', 'piano'],
        ['harpsichord', 'harpsichord', 2],
        ['oboe', 'oboe', 2],
        ['bassoon', 'bassoon', 2],
        ['dulcimer', 'dulcimer', 2],
      ]),
    },
    {
      id: 'starter-en-kitchen-tools',
      language: 'en',
      title: 'Kitchen Tools',
      minWordLength: 3,
      tags: ['home', 'food', 'tools'],
      words: starterWords('starter-en-kitchen-tools', [
        ['spoon', 'spoon'],
        ['fork', 'fork'],
        ['knife', 'knife'],
        ['ladle', 'ladle'],
        ['plate', 'plate'],
        ['skillet', 'skillet'],
        ['colander', 'colander', 2],
        ['saucepan', 'saucepan', 2],
        ['whisk', 'whisk', 2],
        ['mortar', 'mortar', 2],
      ]),
    },
    {
      id: 'starter-en-architecture',
      language: 'en',
      title: 'Architecture',
      minWordLength: 3,
      tags: ['city', 'architecture', 'buildings'],
      words: starterWords('starter-en-architecture', [
        ['arch', 'arch'],
        ['tower', 'tower'],
        ['column', 'column'],
        ['facade', 'facade'],
        ['dome', 'dome'],
        ['portal', 'portal'],
        ['arcade', 'arcade', 2],
        ['buttress', 'buttress', 2],
        ['capital', 'capital', 2],
        ['clerestory', 'clerestory', 2],
      ]),
    },
    {
      id: 'starter-en-seafaring',
      language: 'en',
      title: 'Seafaring',
      minWordLength: 3,
      tags: ['sea', 'navigation', 'ships'],
      words: starterWords('starter-en-seafaring', [
        ['anchor', 'anchor'],
        ['deck', 'deck'],
        ['mast', 'mast'],
        ['sail', 'sail'],
        ['compass', 'compass'],
        ['squall', 'squall'],
        ['topsail', 'topsail', 2],
        ['galley', 'galley', 2],
        ['bowsprit', 'bowsprit', 2],
        ['starboard', 'starboard', 2],
      ]),
    },
    {
      id: 'starter-en-garden-plants',
      language: 'en',
      title: 'Garden Plants',
      minWordLength: 3,
      tags: ['nature', 'garden', 'plants'],
      words: starterWords('starter-en-garden-plants', [
        ['rose', 'rose'],
        ['peony', 'peony'],
        ['iris', 'iris'],
        ['lily', 'lily'],
        ['aster', 'aster'],
        ['phlox', 'phlox'],
        ['nasturtium', 'nasturtium', 2],
        ['hydrangea', 'hydrangea', 2],
        ['delphinium', 'delphinium', 2],
        ['echinacea', 'echinacea', 2],
      ]),
    },
    {
      id: 'starter-en-professions',
      language: 'en',
      title: 'Professions',
      minWordLength: 3,
      tags: ['people', 'work', 'jobs'],
      words: starterWords('starter-en-professions', [
        ['doctor', 'doctor'],
        ['cook', 'cook'],
        ['pilot', 'pilot'],
        ['actor', 'actor'],
        ['smith', 'smith'],
        ['teacher', 'teacher'],
        ['archivist', 'archivist', 2],
        ['cartographer', 'cartographer', 2],
        ['restorer', 'restorer', 2],
        ['meteorologist', 'meteorologist', 2],
      ]),
    },
    {
      id: 'starter-en-weather',
      language: 'en',
      title: 'Weather',
      minWordLength: 3,
      tags: ['nature', 'weather', 'sky'],
      words: starterWords('starter-en-weather', [
        ['rain', 'rain'],
        ['snow', 'snow'],
        ['wind', 'wind'],
        ['cloud', 'cloud'],
        ['storm', 'storm'],
        ['frost', 'frost'],
        ['drizzle', 'drizzle', 2],
        ['hailstone', 'hailstone', 2],
        ['monsoon', 'monsoon', 2],
        ['thunderhead', 'thunderhead', 2],
      ]),
    },
  ],
};

export function createStarterThemes(language?: ThemeLanguage): Theme[] {
  return STARTER_THEME_PACK.themes
    .filter((definition) => !language || definition.language === language)
    .map(createStarterThemeFromDefinition);
}

export function createStarterTheme(themeId: string): Theme {
  const definition = STARTER_THEME_PACK.themes.find((theme) => theme.id === themeId);
  if (!definition) {
    throw new Error(`Unknown starter theme ${themeId}`);
  }

  return createStarterThemeFromDefinition(definition);
}

export function getStarterThemeDefinitions(language?: ThemeLanguage): StarterThemeDefinition[] {
  return STARTER_THEME_PACK.themes
    .filter((definition) => !language || definition.language === language)
    .map(cloneThemeDefinition);
}

function createStarterThemeFromDefinition(definition: StarterThemeDefinition): Theme {
  return createTheme({
    id: definition.id,
    language: definition.language,
    title: definition.title,
    minWordLength: definition.minWordLength,
    words: definition.words.map((word) => ({
      id: word.id,
      canonical: word.canonical,
      expertiseTier: word.expertiseTier,
      aliases: word.aliases ? [...word.aliases] : [],
    })),
  });
}

function cloneThemeDefinition(definition: StarterThemeDefinition): StarterThemeDefinition {
  return {
    ...definition,
    tags: [...definition.tags],
    words: definition.words.map((word) => ({
      ...word,
      ...(word.aliases ? { aliases: [...word.aliases] } : {}),
    })),
  };
}

function starterWords(themeId: string, entries: readonly StarterThemeWordEntry[]): StarterThemeWordDefinition[] {
  return entries.map(([key, canonical, expertiseTier = 1, aliases]) => ({
    id: `${themeId}:word:${key}`,
    canonical,
    expertiseTier,
    ...(aliases ? { aliases: [...aliases] } : {}),
  }));
}
