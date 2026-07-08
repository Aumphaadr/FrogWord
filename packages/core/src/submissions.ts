import type {
  ApplyResult,
  DomainEvent,
  RejectedSubmission,
  RoundState,
  ThemeWord,
} from './types.js';
import { createThemeIndex, normalizeWord, scoreWord } from './words.js';

export interface ApproveRejectedSubmissionInput {
  rejectedId: string;
  actedAt: string;
  expertiseTier: 1 | 2;
  canonical?: string;
  aliases?: string[];
}

export function approveRejectedSubmission(
  state: RoundState,
  input: ApproveRejectedSubmissionInput,
): ApplyResult {
  const next = cloneState(state);
  const events: DomainEvent[] = [];
  const submission = next.rejectedSubmissions.find((entry) => entry.id === input.rejectedId);

  if (!submission) {
    events.push(rejectHostAction(next, input.rejectedId, 'submission_not_found'));
    return { state: next, events };
  }

  if (submission.status !== 'pending') {
    events.push(rejectHostAction(next, input.rejectedId, 'submission_not_pending', submission.playerId));
    return { state: next, events };
  }

  const player = next.players[submission.playerId];
  if (!player) {
    events.push(rejectHostAction(next, input.rejectedId, 'player_not_found', submission.playerId));
    return { state: next, events };
  }

  const canonical = (input.canonical ?? submission.rawWord).trim();
  const normalized = normalizeWord(canonical, next.theme.language);
  if (normalized.length < next.theme.minWordLength) {
    events.push(rejectHostAction(next, input.rejectedId, 'word_too_short_for_theme', submission.playerId));
    return { state: next, events };
  }

  const word = findOrCreateThemeWord(next, {
    canonical,
    normalized,
    expertiseTier: input.expertiseTier,
    aliases: input.aliases ?? [],
    submission,
  });

  if (player.acceptedWordIds.includes(word.id)) {
    events.push(rejectHostAction(next, input.rejectedId, 'player_already_credited', submission.playerId));
    return { state: next, events };
  }

  const points = scoreWord(word);
  player.score += points;
  player.acceptedWordIds.push(word.id);
  submission.status = 'approved';

  next.foundWords.push({
    id: `${next.id}:found:${next.foundWords.length + 1}`,
    playerId: submission.playerId,
    wordId: word.id,
    canonical: word.canonical,
    normalized: word.normalized,
    points,
    path: clonePath(submission.path),
    acceptedAt: input.actedAt,
    source: 'host',
  });

  events.push(nextEvent(next, {
    type: 'submission.accepted',
    playerId: submission.playerId,
    wordId: word.id,
    points,
    source: 'host',
  }));
  events.push(nextEvent(next, {
    type: 'submission.approvedByHost',
    playerId: submission.playerId,
    rejectedId: submission.id,
    wordId: word.id,
    points,
  }));

  return { state: next, events };
}

function findOrCreateThemeWord(
  state: RoundState,
  input: {
    canonical: string;
    normalized: string;
    expertiseTier: 1 | 2;
    aliases: string[];
    submission: RejectedSubmission;
  },
): ThemeWord {
  const existing = createThemeIndex(state.theme).byNormalized.get(input.normalized);
  if (existing) {
    return existing.word;
  }

  const word: ThemeWord = {
    id: createApprovedWordId(state, input.submission),
    canonical: input.canonical,
    normalized: input.normalized,
    language: state.theme.language,
    expertiseTier: input.expertiseTier,
    scoreMultiplier: input.expertiseTier === 1 ? 1 : 1.5,
    aliases: [...input.aliases],
  };
  state.theme.words.push(word);
  return word;
}

function createApprovedWordId(state: RoundState, submission: RejectedSubmission): string {
  const baseId = `${state.theme.id}:approved:${submission.id}`;
  const usedIds = new Set(state.theme.words.map((word) => word.id));
  if (!usedIds.has(baseId)) {
    return baseId;
  }

  let index = 2;
  while (usedIds.has(`${baseId}:${index}`)) {
    index += 1;
  }

  return `${baseId}:${index}`;
}

function rejectHostAction(
  state: RoundState,
  rejectedId: string,
  reason: string,
  playerId?: string,
): DomainEvent {
  return nextEvent(state, {
    type: 'hostAction.rejected',
    action: 'approveSubmission',
    reason,
    rejectedId,
    ...(playerId ? { playerId } : {}),
  });
}

function nextEvent<T extends Omit<DomainEvent, 'seq'>>(state: RoundState, event: T): T & { seq: number } {
  state.eventSeq += 1;
  return { ...event, seq: state.eventSeq };
}

function clonePath(path: RejectedSubmission['path']): RejectedSubmission['path'] {
  return path.map((coord) => ({ row: coord.row, col: coord.col }));
}

function cloneState(state: RoundState): RoundState {
  return JSON.parse(JSON.stringify(state)) as RoundState;
}
