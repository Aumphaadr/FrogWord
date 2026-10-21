export interface Rng {
  next(): number;
  int(maxExclusive: number): number;
  state(): string;
}

function xmur3(input: string): () => number {
  let h = 1779033703 ^ input.length;
  for (let i = 0; i < input.length; i += 1) {
    h = Math.imul(h ^ input.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }

  return () => {
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return (h ^= h >>> 16) >>> 0;
  };
}

export function createRng(seed: string): Rng {
  const seedFn = xmur3(seed);
  let value = seedFn();

  const next = () => {
    value |= 0;
    value = (value + 0x6d2b79f5) | 0;
    let t = Math.imul(value ^ (value >>> 15), 1 | value);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  return {
    next,
    int(maxExclusive: number) {
      if (!Number.isInteger(maxExclusive) || maxExclusive <= 0) {
        throw new Error(`maxExclusive must be a positive integer, got ${maxExclusive}`);
      }

      return Math.floor(next() * maxExclusive);
    },
    state() {
      return String(value >>> 0);
    },
  };
}

export function shuffleInPlace<T>(items: T[], rng: Rng): T[] {
  for (let index = items.length - 1; index > 0; index -= 1) {
    const swapIndex = rng.int(index + 1);
    const value = items[index];
    items[index] = items[swapIndex] as T;
    items[swapIndex] = value as T;
  }

  return items;
}
