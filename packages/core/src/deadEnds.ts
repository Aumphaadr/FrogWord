import type { PlayerState, RoundState, Theme, WordId } from './types.js';
import { normalizeWord } from './words.js';

export interface DeadEndCheckInput {
  theme: Theme;
  buffer: string;
  acceptedWordIds?: WordId[];
}

export function isPlayerAtDeadEnd(state: RoundState, player: PlayerState): boolean {
  return isBufferAtDeadEnd({
    theme: state.theme,
    buffer: player.buffer,
    acceptedWordIds: player.acceptedWordIds,
  });
}

export function isBufferAtDeadEnd(input: DeadEndCheckInput): boolean {
  const normalizedBuffer = normalizeWord(input.buffer, input.theme.language);
  if (normalizedBuffer.length === 0) {
    return false;
  }

  const acceptedWordIds = new Set(input.acceptedWordIds ?? []);

  return !input.theme.words.some((word) => {
    if (acceptedWordIds.has(word.id)) {
      return false;
    }

    return normalizedFormsForWord(input.theme, word).some((form) => form.startsWith(normalizedBuffer));
  });
}

function normalizedFormsForWord(theme: Theme, word: Theme['words'][number]): string[] {
  return [
    word.normalized,
    ...word.aliases.map((alias) => normalizeWord(alias, theme.language)),
  ];
}
