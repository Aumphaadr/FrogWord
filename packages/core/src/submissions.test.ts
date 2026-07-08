import { describe, expect, it } from 'vitest';
import {
  applyCommand,
  approveRejectedSubmission,
  createAdminGameProjection,
  createBoardFromRows,
  createRectTemplate,
  createRound,
  createTheme,
  parseChatCommand,
  playerIdFromIdentity,
  type PlayerIdentity,
  type RoundState,
} from './index.js';

const player: PlayerIdentity = {
  provider: 'fake',
  providerUserId: 'mortikon',
  login: 'mortikon',
  displayName: 'Mortikon',
};

const now = '2026-07-06T00:00:00.000Z';
const later = '2026-07-06T00:01:00.000Z';

describe('rejected submission approval', () => {
  it('adds an approved pending word to the theme and backfills score', () => {
    const state = createSubmissionRound();
    const submitted = submitUnknownWord(state, 'protazan');
    const rejected = submitted.rejectedSubmissions[0]!;
    const playerId = playerIdFromIdentity(player);

    const result = approveRejectedSubmission(submitted, {
      rejectedId: rejected.id,
      actedAt: later,
      expertiseTier: 2,
    });
    const playerState = result.state.players[playerId]!;
    const approvedWord = result.state.theme.words.find((word) => word.canonical === 'protazan')!;

    expect(approvedWord).toMatchObject({
      normalized: 'protazan',
      expertiseTier: 2,
      scoreMultiplier: 1.5,
    });
    expect(result.state.rejectedSubmissions[0]).toMatchObject({
      id: rejected.id,
      status: 'approved',
    });
    expect(playerState.score).toBe(120);
    expect(playerState.acceptedWordIds).toContain(approvedWord.id);
    expect(result.state.foundWords[0]).toMatchObject({
      playerId,
      wordId: approvedWord.id,
      canonical: 'protazan',
      points: 120,
      source: 'host',
      acceptedAt: later,
    });
    expect(result.events).toContainEqual(expect.objectContaining({
      type: 'submission.accepted',
      playerId,
      wordId: approvedWord.id,
      points: 120,
      source: 'host',
    }));
    expect(result.events).toContainEqual(expect.objectContaining({
      type: 'submission.approvedByHost',
      playerId,
      rejectedId: rejected.id,
      wordId: approvedWord.id,
      points: 120,
    }));
  });

  it('keeps current player presence intact while backfilling approval', () => {
    const state = createSubmissionRound();
    const submitted = submitUnknownWord(state, 'protazan');
    const playerId = playerIdFromIdentity(player);
    submitted.players[playerId]!.position = { row: 0, col: 1 };
    submitted.players[playerId]!.buffer = 'next';
    submitted.players[playerId]!.path = [{ row: 0, col: 1 }];

    const result = approveRejectedSubmission(submitted, {
      rejectedId: submitted.rejectedSubmissions[0]!.id,
      actedAt: later,
      expertiseTier: 1,
    });

    expect(result.state.players[playerId]).toMatchObject({
      status: 'active',
      position: { row: 0, col: 1 },
      buffer: 'next',
      path: [{ row: 0, col: 1 }],
    });
    expect(result.events).not.toContainEqual(expect.objectContaining({
      type: 'board.cellsRefilled',
    }));
    expect(result.events).not.toContainEqual(expect.objectContaining({
      type: 'player.bufferCleared',
    }));
  });

  it('uses edited canonical form and aliases when host approves', () => {
    const state = createSubmissionRound();
    const submitted = submitUnknownWord(state, 'jormungand');

    const result = approveRejectedSubmission(submitted, {
      rejectedId: submitted.rejectedSubmissions[0]!.id,
      actedAt: later,
      expertiseTier: 2,
      canonical: 'Jormungandr',
      aliases: ['Jormungand'],
    });
    const approvedWord = result.state.theme.words.find((word) => word.canonical === 'Jormungandr')!;

    expect(approvedWord).toMatchObject({
      normalized: 'jormungandr',
      aliases: ['Jormungand'],
      expertiseTier: 2,
    });
    expect(result.state.players[playerIdFromIdentity(player)]!.score).toBe(165);
  });

  it('rejects approval when submission is missing or no longer pending', () => {
    const state = createSubmissionRound();
    const missing = approveRejectedSubmission(state, {
      rejectedId: 'missing',
      actedAt: later,
      expertiseTier: 1,
    });

    expect(missing.events).toContainEqual(expect.objectContaining({
      type: 'hostAction.rejected',
      action: 'approveSubmission',
      rejectedId: 'missing',
      reason: 'submission_not_found',
    }));

    const submitted = submitUnknownWord(state, 'protazan');
    const approved = approveRejectedSubmission(submitted, {
      rejectedId: submitted.rejectedSubmissions[0]!.id,
      actedAt: later,
      expertiseTier: 1,
    }).state;

    const secondApproval = approveRejectedSubmission(approved, {
      rejectedId: approved.rejectedSubmissions[0]!.id,
      actedAt: later,
      expertiseTier: 1,
    });

    expect(secondApproval.events).toContainEqual(expect.objectContaining({
      type: 'hostAction.rejected',
      action: 'approveSubmission',
      rejectedId: approved.rejectedSubmissions[0]!.id,
      reason: 'submission_not_pending',
    }));
  });

  it('keeps approved pending words visible to admin with updated status', () => {
    const state = createSubmissionRound();
    const submitted = submitUnknownWord(state, 'protazan');
    const approved = approveRejectedSubmission(submitted, {
      rejectedId: submitted.rejectedSubmissions[0]!.id,
      actedAt: later,
      expertiseTier: 1,
    }).state;

    const projection = createAdminGameProjection(approved);

    expect(projection.rejectedSubmissions[0]).toMatchObject({
      rawWord: 'protazan',
      status: 'approved',
      playerDisplayName: 'Mortikon',
    });
    expect(projection.foundWords[0]).toMatchObject({
      canonical: 'protazan',
      source: 'host',
      points: 80,
    });
  });
});

function createSubmissionRound(): RoundState {
  return createRound({
    id: 'submissions',
    theme: createTheme({
      id: 'myths',
      language: 'en',
      title: 'Myths',
      minWordLength: 3,
      words: [
        { canonical: 'mars' },
      ],
    }),
    boardTemplate: createRectTemplate(2, 1),
    board: createBoardFromRows(['..']),
    seed: 'submissions',
  });
}

function submitUnknownWord(state: RoundState, buffer: string): RoundState {
  activateAt(state, player, { row: 0, col: 0 }, buffer);
  return apply(state, player, '!word').state;
}

function activateAt(
  state: RoundState,
  identity: PlayerIdentity,
  position: { row: number; col: number },
  buffer: string,
): void {
  const joined = apply(state, identity, '!play').state;
  Object.assign(state, joined);

  const playerState = state.players[playerIdFromIdentity(identity)]!;
  playerState.position = position;
  playerState.buffer = buffer;
  playerState.path = [position];
  playerState.collectedLetterCellIds = [];
}

function apply(state: RoundState, identity: PlayerIdentity, text: string) {
  return applyCommand(state, {
    player: identity,
    command: parseChatCommand(text),
    receivedAt: now,
  });
}
