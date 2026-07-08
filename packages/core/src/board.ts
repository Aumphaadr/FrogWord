import type { Board, BoardTemplate, Cell, Coord, Theme } from './types.js';
import type { Rng } from './rng.js';
import { shuffleInPlace } from './rng.js';

const RUSSIAN_LETTERS = Array.from('аеинортслвкмдпуяызьгчбзйжшхюцщэфъ');
const ENGLISH_LETTERS = Array.from('etaoinshrdlcumwfgypbvkjxqz');

export function coordKey(coord: Coord): string {
  return `${coord.row}:${coord.col}`;
}

export function sameCoord(left: Coord, right: Coord): boolean {
  return left.row === right.row && left.col === right.col;
}

export function cellId(coord: Coord): string {
  return coordKey(coord);
}

export function createRectTemplate(width: number, height: number, id = `${width}x${height}`): BoardTemplate {
  return {
    id,
    title: id,
    width,
    height,
    activeMask: Array.from({ length: height }, () => Array.from({ length: width }, () => true)),
  };
}

export function validateTemplate(template: BoardTemplate): void {
  if (template.activeMask.length !== template.height) {
    throw new Error(`Template ${template.id} activeMask height mismatch`);
  }

  for (const row of template.activeMask) {
    if (row.length !== template.width) {
      throw new Error(`Template ${template.id} activeMask width mismatch`);
    }
  }
}

export function inBounds(board: Board, coord: Coord): boolean {
  return coord.row >= 0 && coord.row < board.height && coord.col >= 0 && coord.col < board.width;
}

export function getCell(board: Board, coord: Coord): Cell | undefined {
  return inBounds(board, coord) ? board.cells[coord.row]?.[coord.col] : undefined;
}

export function setCell(board: Board, coord: Coord, cell: Cell): void {
  if (!inBounds(board, coord)) {
    throw new Error(`Cannot set out-of-bounds cell ${coordKey(coord)}`);
  }

  board.cells[coord.row]![coord.col] = cell;
}

export function activeCoords(board: Board): Coord[] {
  const coords: Coord[] = [];

  for (let row = 0; row < board.height; row += 1) {
    for (let col = 0; col < board.width; col += 1) {
      if (board.cells[row]![col]!.kind !== 'blocked') {
        coords.push({ row, col });
      }
    }
  }

  return coords;
}

export function emptyCoords(board: Board): Coord[] {
  return activeCoords(board).filter((coord) => getCell(board, coord)?.kind === 'empty');
}

export function createBoard(input: {
  template: BoardTemplate;
  theme: Theme;
  rng: Rng;
  seed: string;
  emptyCellRatio?: number;
}): Board {
  validateTemplate(input.template);

  const active: Coord[] = [];
  const cells: Cell[][] = [];

  for (let row = 0; row < input.template.height; row += 1) {
    const cellRow: Cell[] = [];
    for (let col = 0; col < input.template.width; col += 1) {
      const coord = { row, col };
      if (input.template.activeMask[row]![col]) {
        active.push(coord);
        cellRow.push({ kind: 'letter', id: cellId(coord), char: pickLetter(input.theme, input.rng) });
      } else {
        cellRow.push({ kind: 'blocked', id: cellId(coord) });
      }
    }
    cells.push(cellRow);
  }

  const emptyCount = Math.max(1, Math.round(active.length * (input.emptyCellRatio ?? 0.15)));
  const shuffled = shuffleInPlace([...active], input.rng);
  for (const coord of shuffled.slice(0, emptyCount)) {
    cells[coord.row]![coord.col] = { kind: 'empty', id: cellId(coord) };
  }

  return {
    width: input.template.width,
    height: input.template.height,
    templateId: input.template.id,
    cells,
    seed: input.seed,
  };
}

export function createBoardFromRows(rows: string[], seed = 'test-board'): Board {
  if (rows.length === 0) {
    throw new Error('Board rows cannot be empty');
  }

  const width = rows[0]!.length;
  const cells: Cell[][] = rows.map((rowValue, row) => {
    if (rowValue.length !== width) {
      throw new Error('All board rows must have the same width');
    }

    return Array.from(rowValue).map((char, col): Cell => {
      const id = cellId({ row, col });
      if (char === '#') {
        return { kind: 'blocked', id };
      }
      if (char === '.') {
        return { kind: 'empty', id };
      }
      return { kind: 'letter', id, char: char.toLocaleLowerCase() };
    });
  });

  return {
    width,
    height: rows.length,
    templateId: 'rows',
    cells,
    seed,
  };
}

export function refillPathCells(board: Board, path: Coord[], theme: Theme, rng: Rng): Coord[] {
  const uniquePath = uniqueCoords(path).filter((coord) => getCell(board, coord)?.kind !== 'blocked');
  const emptyCount = uniquePath.filter((coord) => getCell(board, coord)?.kind === 'empty').length;
  const shuffled = shuffleInPlace([...uniquePath], rng);
  const emptyKeys = new Set(shuffled.slice(0, emptyCount).map(coordKey));

  for (const coord of uniquePath) {
    if (emptyKeys.has(coordKey(coord))) {
      setCell(board, coord, { kind: 'empty', id: cellId(coord) });
    } else {
      setCell(board, coord, { kind: 'letter', id: cellId(coord), char: pickLetter(theme, rng) });
    }
  }

  return uniquePath;
}

export function hasBlockedCellBetween(board: Board, from: Coord, to: Coord): boolean {
  if (from.row !== to.row && from.col !== to.col) {
    return true;
  }

  const rowStep = Math.sign(to.row - from.row);
  const colStep = Math.sign(to.col - from.col);
  let row = from.row + rowStep;
  let col = from.col + colStep;

  while (row !== to.row || col !== to.col) {
    if (getCell(board, { row, col })?.kind === 'blocked') {
      return true;
    }
    row += rowStep;
    col += colStep;
  }

  return getCell(board, to)?.kind === 'blocked';
}

function uniqueCoords(coords: Coord[]): Coord[] {
  const seen = new Set<string>();
  const result: Coord[] = [];

  for (const coord of coords) {
    const key = coordKey(coord);
    if (!seen.has(key)) {
      seen.add(key);
      result.push(coord);
    }
  }

  return result;
}

function pickLetter(theme: Theme, rng: Rng): string {
  const alphabet = theme.language === 'ru' ? RUSSIAN_LETTERS : ENGLISH_LETTERS;
  return alphabet[rng.int(alphabet.length)]!;
}
