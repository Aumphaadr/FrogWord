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

export function createRouteAwareBoard(input: {
  template: BoardTemplate;
  theme: Theme;
  rng: Rng;
  seed: string;
  emptyCellRatio?: number;
  guaranteedWordCount?: number;
  maxRouteWordLength?: number;
  maxRouteHopDistance?: number;
}): Board {
  const board = createBoard(input);
  const active = activeCoords(board);
  const targetWordCount = Math.min(
    input.guaranteedWordCount ?? defaultGuaranteedWordCount(active.length),
    Math.max(1, Math.floor(active.length / 3)),
  );
  const maxWordLength = input.maxRouteWordLength ?? Math.max(
    5,
    Math.min(10, Math.floor(Math.sqrt(active.length))),
  );
  const maxHopDistance = input.maxRouteHopDistance ?? Math.max(
    3,
    Math.min(9, Math.ceil(Math.sqrt(active.length) / 3)),
  );
  const candidates = routeCandidateWords(input.theme, maxWordLength, input.rng);
  if (candidates.length < targetWordCount) {
    // Small boards clamp the preferred word length hard enough that a theme of
    // long words can end up with no candidates at all; fall back to longer
    // words rather than shipping a board with nothing guaranteed on it.
    const extendedWordLength = Math.max(maxWordLength, Math.min(14, Math.floor(active.length / 2)));
    for (const word of routeCandidateWords(input.theme, extendedWordLength, input.rng)) {
      if (!candidates.includes(word)) {
        candidates.push(word);
      }
    }
  }
  const reserved = new Set<string>();
  let embedded = 0;

  for (const word of candidates) {
    if (embedded >= targetWordCount) {
      break;
    }

    const route = createWordRoute(board, word, {
      maxHopDistance,
      reserved,
      rng: input.rng,
    });

    if (!route) {
      continue;
    }

    setCell(board, route.start, { kind: 'empty', id: cellId(route.start) });
    reserved.add(coordKey(route.start));

    for (const step of route.steps) {
      setCell(board, step.coord, { kind: 'letter', id: cellId(step.coord), char: step.char });
      reserved.add(coordKey(step.coord));
    }

    embedded += 1;
  }

  return board;
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

export function refillPathCells(
  board: Board,
  path: Coord[],
  theme: Theme,
  rng: Rng,
  options?: { keepEmpty?: Coord[] },
): Coord[] {
  const uniquePath = uniqueCoords(path).filter((coord) => getCell(board, coord)?.kind !== 'blocked');
  const emptyCount = uniquePath.filter((coord) => getCell(board, coord)?.kind === 'empty').length;
  const pathKeys = new Set(uniquePath.map(coordKey));
  const keepEmptyKeys = new Set(
    (options?.keepEmpty ?? []).map(coordKey).filter((key) => pathKeys.has(key)),
  );
  const shuffled = shuffleInPlace(
    uniquePath.filter((coord) => !keepEmptyKeys.has(coordKey(coord))),
    rng,
  );
  const randomEmptyCount = Math.max(0, emptyCount - keepEmptyKeys.size);
  const emptyKeys = new Set([...keepEmptyKeys, ...shuffled.slice(0, randomEmptyCount).map(coordKey)]);

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

function defaultGuaranteedWordCount(activeCellCount: number): number {
  return Math.max(5, Math.min(14, Math.floor(activeCellCount / 70)));
}

function routeCandidateWords(theme: Theme, maxWordLength: number, rng: Rng): string[] {
  const byNormalized = new Map<string, { normalized: string; expertiseTier: 1 | 2 }>();

  for (const word of theme.words) {
    if (
      word.normalized.length < theme.minWordLength
      || word.normalized.length > maxWordLength
      || !/^\p{L}+$/u.test(word.normalized)
    ) {
      continue;
    }

    byNormalized.set(word.normalized, {
      normalized: word.normalized,
      expertiseTier: word.expertiseTier,
    });
  }

  const candidates = [...byNormalized.values()].sort((left, right) => (
    left.expertiseTier - right.expertiseTier
    || left.normalized.length - right.normalized.length
    || left.normalized.localeCompare(right.normalized)
  ));

  const casual = candidates.filter((candidate) => candidate.expertiseTier === 1);
  const expert = candidates.filter((candidate) => candidate.expertiseTier !== 1);
  return [
    ...shuffleInPlace(casual, rng),
    ...shuffleInPlace(expert, rng),
  ].map((candidate) => candidate.normalized);
}

function createWordRoute(
  board: Board,
  word: string,
  input: {
    maxHopDistance: number;
    reserved: Set<string>;
    rng: Rng;
  },
): { start: Coord; steps: RouteStep[] } | undefined {
  const starts = shuffleInPlace(
    activeCoords(board).filter((coord) => !input.reserved.has(coordKey(coord))),
    input.rng,
  );
  const letters = Array.from(word);

  for (const start of starts.slice(0, 96)) {
    for (let attempt = 0; attempt < 18; attempt += 1) {
      const path = createRoutePath(board, start, letters.length, input);
      if (path) {
        return {
          start,
          steps: path.map((coord, index) => ({ coord, char: letters[index]! })),
        };
      }
    }
  }

  return undefined;
}

// Guaranteed routes are chains of direct letter-to-letter jumps: each next
// letter is reachable from the previous one in a single move, so a player
// never has to plan turns through intermediate empty cells. Relay routes via
// empty waypoints can still emerge naturally, but are never required.
function createRoutePath(
  board: Board,
  start: Coord,
  length: number,
  input: {
    maxHopDistance: number;
    reserved: Set<string>;
    rng: Rng;
  },
): Coord[] | undefined {
  const path: Coord[] = [];
  const used = new Set<string>([coordKey(start)]);
  let current = start;

  for (let index = 0; index < length; index += 1) {
    const targets = routeTargetsFrom(board, current, {
      maxHopDistance: input.maxHopDistance,
      reserved: input.reserved,
      used,
    });

    if (targets.length === 0) {
      return undefined;
    }

    const target = targets[input.rng.int(targets.length)]!;
    path.push(target);
    used.add(coordKey(target));
    current = target;
  }

  return path;
}

type RouteStep = { coord: Coord; char: string };

function routeTargetsFrom(
  board: Board,
  from: Coord,
  input: {
    maxHopDistance: number;
    reserved: Set<string>;
    used: Set<string>;
  },
): Coord[] {
  const targets: Coord[] = [];
  const add = (coord: Coord): void => {
    const key = coordKey(coord);
    if (
      !inBounds(board, coord)
      || input.reserved.has(key)
      || input.used.has(key)
      || getCell(board, coord)?.kind === 'blocked'
      || hasBlockedCellBetween(board, from, coord)
    ) {
      return;
    }

    targets.push(coord);
  };

  for (let distance = 1; distance <= input.maxHopDistance; distance += 1) {
    add({ row: from.row - distance, col: from.col });
    add({ row: from.row + distance, col: from.col });
    add({ row: from.row, col: from.col - distance });
    add({ row: from.row, col: from.col + distance });
  }

  return targets;
}
