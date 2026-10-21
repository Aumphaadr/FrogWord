import { describe, expect, it } from 'vitest';
import {
  createRectTemplate,
  createRouteAwareBoard,
  createRng,
  createTheme,
  emptyCoords,
  getCell,
  hasBlockedCellBetween,
  type Board,
  type Coord,
} from './index.js';

describe('route-aware board generation', () => {
  it('embeds several theme words as direct letter-to-letter jump routes from empty cells', () => {
    const theme = createTheme({
      id: 'animals',
      language: 'ru',
      title: 'Animals',
      minWordLength: 3,
      words: [
        { canonical: 'комар' },
        { canonical: 'пони' },
        { canonical: 'рысь' },
        { canonical: 'сова' },
        { canonical: 'лось' },
        { canonical: 'цапля' },
        { canonical: 'барсук' },
        { canonical: 'фазан' },
        { canonical: 'тюлень' },
        { canonical: 'ворона' },
      ],
    });

    const board = createRouteAwareBoard({
      template: createRectTemplate(12, 8),
      theme,
      rng: createRng('route-aware-test'),
      seed: 'route-aware-test',
      guaranteedWordCount: 5,
      maxRouteWordLength: 7,
      maxRouteHopDistance: 5,
    });

    const collectableWords = theme.words.filter((word) => isCollectable(board, word.normalized));

    expect(collectableWords.map((word) => word.canonical).length).toBeGreaterThanOrEqual(5);
  });
});

function isCollectable(board: Board, word: string): boolean {
  const letters = Array.from(word);
  const starts = emptyCoords(board);

  return starts.some((start) => canCollectFrom(board, start, letters, 0, new Map()));
}

function canCollectFrom(
  board: Board,
  from: Coord,
  letters: string[],
  index: number,
  memo: Map<string, boolean>,
): boolean {
  if (index >= letters.length) {
    return true;
  }

  const memoKey = `${from.row}:${from.col}:${index}`;
  const memoValue = memo.get(memoKey);
  if (memoValue !== undefined) {
    return memoValue;
  }

  for (let row = 0; row < board.height; row += 1) {
    for (let col = 0; col < board.width; col += 1) {
      const target = { row, col };
      const cell = getCell(board, target);
      if (
        cell?.kind === 'letter'
        && cell.char === letters[index]
        && isLegalJump(board, from, target)
        && canCollectFrom(board, target, letters, index + 1, memo)
      ) {
        memo.set(memoKey, true);
        return true;
      }
    }
  }

  memo.set(memoKey, false);
  return false;
}

function isLegalJump(board: Board, from: Coord, target: Coord): boolean {
  return (
    (from.row === target.row || from.col === target.col)
    && (from.row !== target.row || from.col !== target.col)
    && !hasBlockedCellBetween(board, from, target)
  );
}

function coordKey(coord: Coord): string {
  return `${coord.row}:${coord.col}`;
}
