import { describe, expect, it } from 'vitest';
import { createTheme } from '@frogword/core';
import {
  DEFAULT_BOARD_HEIGHT,
  DEFAULT_BOARD_WIDTH,
  DEFAULT_NEW_ROUND_FORM,
  DEFAULT_ROUND_SEED,
  MAX_BOARD_HEIGHT,
  MAX_BOARD_WIDTH,
  MIN_BOARD_HEIGHT,
  MIN_BOARD_WIDTH,
  createDefaultLocalRound,
  createRoundFromNewRoundForm,
  newRoundFormFromRound,
  updateNewRoundForm,
} from './newRoundService';

const roundId = 'local-test';

describe('new round service', () => {
  it('creates the default local round from centralized defaults', () => {
    const round = createDefaultLocalRound(roundId);

    expect(round.id).toBe(roundId);
    expect(round.theme.id).toBe(DEFAULT_NEW_ROUND_FORM.themeId);
    expect(round.board.width).toBe(DEFAULT_BOARD_WIDTH);
    expect(round.board.height).toBe(DEFAULT_BOARD_HEIGHT);
    expect(round.board.seed).toBe(DEFAULT_ROUND_SEED);
    expect(round.settings.warnOnDeadEnd).toBe(DEFAULT_NEW_ROUND_FORM.warnOnDeadEnd);
  });

  it('clamps board dimensions while preserving an editable seed draft', () => {
    const updated = updateNewRoundForm(DEFAULT_NEW_ROUND_FORM, {
      width: MAX_BOARD_WIDTH + 20,
      height: MIN_BOARD_HEIGHT - 20,
      seed: '   ',
      warnOnDeadEnd: false,
    });

    expect(updated.width).toBe(MAX_BOARD_WIDTH);
    expect(updated.height).toBe(MIN_BOARD_HEIGHT);
    expect(updated.seed).toBe('   ');
    expect(updated.warnOnDeadEnd).toBe(false);
  });

  it('normalizes seed only when creating a round', () => {
    const result = createRoundFromNewRoundForm({
      roundId,
      form: updateNewRoundForm(DEFAULT_NEW_ROUND_FORM, {
        width: MIN_BOARD_WIDTH - 1,
        height: MAX_BOARD_HEIGHT + 1,
        seed: '   ',
      }),
      themeCatalog: [],
    });

    expect(result.form.width).toBe(MIN_BOARD_WIDTH);
    expect(result.form.height).toBe(MAX_BOARD_HEIGHT);
    expect(result.form.seed).toBe(DEFAULT_ROUND_SEED);
    expect(result.round.board.seed).toBe(DEFAULT_ROUND_SEED);
  });

  it('uses catalog themes when selected', () => {
    const importedTheme = createTheme({
      id: 'imported-en-gems',
      language: 'en',
      title: 'Imported Gems',
      words: [
        { id: 'imported-en-gems:word:ruby', canonical: 'ruby' },
        { id: 'imported-en-gems:word:opal', canonical: 'opal' },
      ],
    });

    const result = createRoundFromNewRoundForm({
      roundId,
      form: {
        ...DEFAULT_NEW_ROUND_FORM,
        themeId: importedTheme.id,
      },
      themeCatalog: [
        {
          id: importedTheme.id,
          theme: importedTheme,
        },
      ],
    });

    expect(result.form.themeId).toBe(importedTheme.id);
    expect(result.round.theme).toEqual(importedTheme);
    expect(result.round.theme).not.toBe(importedTheme);
  });

  it('derives editable form state from a loaded round snapshot', () => {
    const created = createRoundFromNewRoundForm({
      roundId,
      form: {
        ...DEFAULT_NEW_ROUND_FORM,
        width: 12,
        height: 7,
        seed: 'loaded-seed',
        warnOnDeadEnd: false,
      },
      themeCatalog: [],
    });

    expect(newRoundFormFromRound(created.round)).toEqual({
      themeId: DEFAULT_NEW_ROUND_FORM.themeId,
      width: 12,
      height: 7,
      seed: 'loaded-seed',
      warnOnDeadEnd: false,
    });
  });
});
