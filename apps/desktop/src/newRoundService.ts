import {
  createRectTemplate,
  createRng,
  createRound,
  createRouteAwareBoard,
  createStarterTheme,
  type RoundState,
  type Theme,
} from '@frogword/core';

export const DEFAULT_THEME_ID = 'starter-ru-ancient-arms';
export const DEFAULT_BOARD_WIDTH = 10;
export const DEFAULT_BOARD_HEIGHT = 6;
export const MIN_BOARD_WIDTH = 6;
export const MAX_BOARD_WIDTH = 14;
export const MIN_BOARD_HEIGHT = 5;
export const MAX_BOARD_HEIGHT = 10;
export const DEFAULT_ROUND_SEED = 'frogword-desktop-demo';
export const DEFAULT_WARN_ON_DEAD_END = true;

export interface NewRoundFormState {
  themeId: string;
  width: number;
  height: number;
  seed: string;
  warnOnDeadEnd: boolean;
}

export interface NewRoundThemeSource {
  id: string;
  theme: Theme;
}

export interface CreateRoundFromNewRoundFormInput {
  roundId: string;
  form: NewRoundFormState;
  themeCatalog: readonly NewRoundThemeSource[];
  currentRound?: RoundState;
  fallbackThemeId?: string;
}

export interface CreateRoundFromNewRoundFormResult {
  form: NewRoundFormState;
  round: RoundState;
}

export const DEFAULT_NEW_ROUND_FORM: NewRoundFormState = {
  themeId: DEFAULT_THEME_ID,
  width: DEFAULT_BOARD_WIDTH,
  height: DEFAULT_BOARD_HEIGHT,
  seed: DEFAULT_ROUND_SEED,
  warnOnDeadEnd: DEFAULT_WARN_ON_DEAD_END,
};

export function updateNewRoundForm(
  current: NewRoundFormState,
  patch: Partial<NewRoundFormState>,
): NewRoundFormState {
  return {
    themeId: patch.themeId ?? current.themeId,
    width: patch.width === undefined ? current.width : clampBoardWidth(patch.width),
    height: patch.height === undefined ? current.height : clampBoardHeight(patch.height),
    seed: patch.seed ?? current.seed,
    warnOnDeadEnd: patch.warnOnDeadEnd ?? current.warnOnDeadEnd,
  };
}

export function newRoundFormFromRound(round: RoundState): NewRoundFormState {
  return {
    themeId: round.theme.id,
    width: clampBoardWidth(round.board.width),
    height: clampBoardHeight(round.board.height),
    seed: round.board.seed,
    warnOnDeadEnd: round.settings.warnOnDeadEnd,
  };
}

export function createDefaultLocalRound(roundId: string): RoundState {
  return createRoundFromNewRoundForm({
    roundId,
    form: DEFAULT_NEW_ROUND_FORM,
    themeCatalog: [],
  }).round;
}

export function createRoundFromNewRoundForm(
  input: CreateRoundFromNewRoundFormInput,
): CreateRoundFromNewRoundFormResult {
  const theme = resolveNewRoundTheme({
    themeId: input.form.themeId,
    themeCatalog: input.themeCatalog,
    ...(input.currentRound ? { currentRound: input.currentRound } : {}),
    ...(input.fallbackThemeId ? { fallbackThemeId: input.fallbackThemeId } : {}),
  });
  const form = normalizeNewRoundForm({
    ...input.form,
    themeId: theme.id,
  });

  const boardTemplate = createRectTemplate(form.width, form.height, `local-demo-${form.width}x${form.height}`);
  const board = createRouteAwareBoard({
    template: boardTemplate,
    theme,
    rng: createRng(`${form.seed}:board`),
    seed: form.seed,
  });

  return {
    form,
    round: createRound({
      id: input.roundId,
      theme,
      boardTemplate,
      board,
      seed: form.seed,
      settings: {
        warnOnDeadEnd: form.warnOnDeadEnd,
      },
    }),
  };
}

export function cloneTheme(theme: Theme): Theme {
  return {
    id: theme.id,
    language: theme.language,
    title: theme.title,
    minWordLength: theme.minWordLength,
    words: theme.words.map((word) => ({
      id: word.id,
      canonical: word.canonical,
      normalized: word.normalized,
      language: word.language,
      expertiseTier: word.expertiseTier,
      scoreMultiplier: word.scoreMultiplier,
      aliases: [...word.aliases],
    })),
  };
}

export function clampBoardWidth(value: number): number {
  return clampInteger(value, MIN_BOARD_WIDTH, MAX_BOARD_WIDTH, DEFAULT_BOARD_WIDTH);
}

export function clampBoardHeight(value: number): number {
  return clampInteger(value, MIN_BOARD_HEIGHT, MAX_BOARD_HEIGHT, DEFAULT_BOARD_HEIGHT);
}

function normalizeNewRoundForm(form: NewRoundFormState): NewRoundFormState {
  return {
    themeId: form.themeId,
    width: clampBoardWidth(form.width),
    height: clampBoardHeight(form.height),
    seed: normalizeRoundSeed(form.seed),
    warnOnDeadEnd: form.warnOnDeadEnd,
  };
}

function resolveNewRoundTheme(input: {
  themeId: string;
  themeCatalog: readonly NewRoundThemeSource[];
  currentRound?: RoundState;
  fallbackThemeId?: string;
}): Theme {
  const catalogTheme = input.themeCatalog.find((entry) => entry.id === input.themeId);
  if (catalogTheme) {
    return cloneTheme(catalogTheme.theme);
  }

  if (input.currentRound?.theme.id === input.themeId) {
    return cloneTheme(input.currentRound.theme);
  }

  return createStarterTheme(input.fallbackThemeId ?? DEFAULT_THEME_ID);
}

function normalizeRoundSeed(value: string): string {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : DEFAULT_ROUND_SEED;
}

function clampInteger(value: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(value)) {
    return fallback;
  }

  return Math.min(max, Math.max(min, Math.round(value)));
}
