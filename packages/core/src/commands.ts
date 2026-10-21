import type { Direction, MoveToken, ParsedCommand } from './types.js';

const COMMAND_ALIASES: Record<string, ParsedCommand> = {
  play: { kind: 'join' },
  играть: { kind: 'join' },
  word: { kind: 'submitCurrentBuffer' },
  слово: { kind: 'submitCurrentBuffer' },
  reset: { kind: 'reset' },
  сброс: { kind: 'reset' },
  quit: { kind: 'quit' },
  уйти: { kind: 'quit' },
  frogword: { kind: 'help' },
  фрогворд: { kind: 'help' },
};

const DIRECTION_ALIASES: Record<string, Direction> = {
  u: 'up',
  в: 'up',
  d: 'down',
  н: 'down',
  l: 'left',
  л: 'left',
  r: 'right',
  п: 'right',
};

export function parseChatCommand(text: string, maxMovesPerMessage = 15): ParsedCommand {
  const trimmed = text.trim().toLocaleLowerCase();
  if (!trimmed.startsWith('!')) {
    return { kind: 'unknown', reason: 'missing_bang', raw: text };
  }

  const parts = trimmed.split(/\s+/);
  const first = parts[0]!.slice(1);
  const command = COMMAND_ALIASES[first];

  if (command && parts.length === 1) {
    return command;
  }

  const moveParts = [first, ...parts.slice(1)];
  const moves: MoveToken[] = [];

  for (const part of moveParts) {
    const move = parseMoveToken(part);
    if (!move) {
      return { kind: 'unknown', reason: 'unknown_command', raw: `!${part}` };
    }
    moves.push(move);
  }

  if (moves.length > maxMovesPerMessage) {
    return { kind: 'unknown', reason: 'too_many_moves', raw: text };
  }

  return { kind: 'moveSequence', moves };
}

function parseMoveToken(raw: string): MoveToken | undefined {
  const match = /^([udlrвнлп])([1-9]\d*)$/u.exec(raw);
  if (!match) {
    return undefined;
  }

  const direction = DIRECTION_ALIASES[match[1]!];
  if (!direction) {
    return undefined;
  }

  return {
    direction,
    distance: Number(match[2]),
    raw,
  };
}
