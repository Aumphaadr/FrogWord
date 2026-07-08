import type { SqlDatabase } from './types.js';

export interface StoredCoord {
  row: number;
  col: number;
}

export interface StoredCell {
  kind: string;
  id: string;
  char?: string;
}

export interface StoredBoard {
  width: number;
  height: number;
  templateId: string;
  cells: readonly (readonly StoredCell[])[];
  seed: string;
}

export interface StoredThemeWord {
  id: string;
  canonical: string;
  normalized: string;
  language: 'ru' | 'en';
  expertiseTier: 1 | 2;
  scoreMultiplier: number;
  aliases: readonly string[];
}

export interface StoredTheme {
  id: string;
  language: 'ru' | 'en';
  title: string;
  minWordLength: number;
  words: readonly StoredThemeWord[];
}

export interface StoredPlayerIdentity {
  provider: string;
  providerUserId: string;
  login: string;
  displayName: string;
  color?: string;
}

export interface StoredPlayerState {
  id: string;
  identity: StoredPlayerIdentity;
  markerColor: string;
  status: string;
  position?: StoredCoord;
  buffer: string;
  path: readonly StoredCoord[];
  collectedLetterCellIds: readonly string[];
  acceptedWordIds: readonly string[];
  score: number;
  lastActionAt: string;
}

export interface StoredBlockedPlayer {
  playerId: string;
  identity?: StoredPlayerIdentity;
  blockedAt: string;
  reason?: string;
}

export interface StoredFoundWord {
  id: string;
  playerId: string;
  wordId: string;
  canonical: string;
  normalized: string;
  points: number;
  path: readonly StoredCoord[];
  acceptedAt: string;
  source: 'auto' | 'manual' | 'host';
}

export interface StoredRejectedSubmission {
  id: string;
  playerId: string;
  rawWord: string;
  normalizedWord: string;
  path: readonly StoredCoord[];
  reason: string;
  status: string;
  createdAt: string;
}

export interface StoredRoundState {
  id: string;
  status: string;
  theme: StoredTheme;
  board: StoredBoard;
  players: Record<string, StoredPlayerState>;
  blockedPlayers: Record<string, StoredBlockedPlayer>;
  foundWords: readonly StoredFoundWord[];
  rejectedSubmissions: readonly StoredRejectedSubmission[];
  settings: unknown;
  eventSeq: number;
  rngState: string;
}

export interface StoredDomainEvent {
  seq: number;
  type: string;
  [key: string]: unknown;
}

export interface SaveRoundSnapshotInput<TState extends StoredRoundState = StoredRoundState> {
  state: TState;
  events?: readonly StoredDomainEvent[];
  modeId?: string;
  savedAt?: string;
}

export interface RoundSnapshot<TState extends StoredRoundState = StoredRoundState> {
  state: TState;
  savedAt: string;
}

export interface RoundEventRecord<TEvent extends StoredDomainEvent = StoredDomainEvent> {
  event: TEvent;
  createdAt: string;
}

export interface LoadRoundEventsOptions {
  limit?: number;
}

interface RoundSummaryEnvelope<TState extends StoredRoundState = StoredRoundState> {
  version: 1;
  savedAt: string;
  state: TState;
}

interface RoundSnapshotRow {
  summary_json: string | null;
}

interface RoundEventRow {
  payload_json: string;
  created_at: string;
}

const DEFAULT_MODE_ID = 'local';
const SNAPSHOT_VERSION = 1;

export async function saveRoundSnapshot<TState extends StoredRoundState>(
  database: SqlDatabase,
  input: SaveRoundSnapshotInput<TState>,
  now: () => string = () => new Date().toISOString(),
): Promise<void> {
  const savedAt = input.savedAt ?? now();
  const modeId = input.modeId ?? DEFAULT_MODE_ID;

  await database.execute('BEGIN');
  try {
    await saveTheme(database, input.state.theme, savedAt);
    await saveBoardTemplate(database, input.state.board, savedAt);
    await savePlayers(database, Object.values(input.state.players), savedAt);
    await saveBlockedPlayers(database, Object.values(input.state.blockedPlayers), savedAt);
    await saveRound(database, input.state, modeId, savedAt);
    await saveFoundWords(database, input.state, savedAt);
    await saveSubmissions(database, input.state);
    await trimRoundEvents(database, input.state);
    await saveRoundEvents(database, input.state.id, input.events ?? [], savedAt);
    await database.execute('COMMIT');
  } catch (error) {
    await rollbackQuietly(database);
    throw error;
  }
}

export async function loadRoundSnapshot<TState extends StoredRoundState = StoredRoundState>(
  database: SqlDatabase,
  roundId: string,
): Promise<RoundSnapshot<TState> | undefined> {
  const rows = await database.query<RoundSnapshotRow>(
    'SELECT summary_json FROM rounds WHERE id = ? LIMIT 1',
    [roundId],
  );
  const summary = rows[0]?.summary_json;

  if (!summary) {
    return undefined;
  }

  return parseRoundSnapshot<TState>(summary);
}

export async function loadLatestRoundSnapshot<TState extends StoredRoundState = StoredRoundState>(
  database: SqlDatabase,
  modeId = DEFAULT_MODE_ID,
): Promise<RoundSnapshot<TState> | undefined> {
  const rows = await database.query<RoundSnapshotRow>(
    `
    SELECT summary_json
    FROM rounds
    WHERE mode_id = ? AND summary_json IS NOT NULL
    ORDER BY coalesce(started_at, '') DESC, id DESC
    LIMIT 1
    `,
    [modeId],
  );
  const summary = rows[0]?.summary_json;

  if (!summary) {
    return undefined;
  }

  return parseRoundSnapshot<TState>(summary);
}

export async function loadRoundEvents<TEvent extends StoredDomainEvent = StoredDomainEvent>(
  database: SqlDatabase,
  roundId: string,
  options: LoadRoundEventsOptions = {},
): Promise<RoundEventRecord<TEvent>[]> {
  const limit = normalizeLimit(options.limit);
  const rows = limit
    ? await database.query<RoundEventRow>(
      `
      SELECT payload_json, created_at
      FROM (
        SELECT payload_json, created_at, seq
        FROM round_events
        WHERE round_id = ?
        ORDER BY seq DESC
        LIMIT ?
      )
      ORDER BY seq ASC
      `,
      [roundId, limit],
    )
    : await database.query<RoundEventRow>(
      `
      SELECT payload_json, created_at
      FROM round_events
      WHERE round_id = ?
      ORDER BY seq ASC
      `,
      [roundId],
    );

  return rows.map((row) => ({
    event: JSON.parse(row.payload_json) as TEvent,
    createdAt: row.created_at,
  }));
}

function parseRoundSnapshot<TState extends StoredRoundState>(summaryJson: string): RoundSnapshot<TState> {
  const parsed = JSON.parse(summaryJson) as Partial<RoundSummaryEnvelope<TState>> | TState;

  if (isSnapshotEnvelope<TState>(parsed)) {
    return {
      state: parsed.state,
      savedAt: parsed.savedAt,
    };
  }

  return {
    state: parsed as TState,
    savedAt: '',
  };
}

function isSnapshotEnvelope<TState extends StoredRoundState>(
  value: Partial<RoundSummaryEnvelope<TState>> | TState,
): value is RoundSummaryEnvelope<TState> {
  return typeof value === 'object'
    && value !== null
    && 'version' in value
    && value.version === SNAPSHOT_VERSION
    && 'state' in value
    && typeof value.savedAt === 'string';
}

function normalizeLimit(value: number | undefined): number | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (!Number.isFinite(value)) {
    return undefined;
  }

  return Math.max(1, Math.floor(value));
}

async function saveTheme(database: SqlDatabase, theme: StoredTheme, savedAt: string): Promise<void> {
  await database.execute(
    `
    INSERT INTO themes (
      id, slug, language, title_json, description_json, tags_json, difficulty,
      min_word_length, safety_status, source, version, created_at, updated_at
    )
    VALUES (?, ?, ?, ?, NULL, NULL, NULL, ?, 'trusted', ?, 1, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      slug = excluded.slug,
      language = excluded.language,
      title_json = excluded.title_json,
      min_word_length = excluded.min_word_length,
      updated_at = excluded.updated_at
    `,
    [
      theme.id,
      theme.id,
      theme.language,
      json({ default: theme.title }),
      theme.minWordLength,
      sourceForTheme(theme.id),
      savedAt,
      savedAt,
    ],
  );

  for (const word of theme.words) {
    await database.execute(
      `
      INSERT INTO words (
        id, theme_id, canonical, normalized, language, expertise_tier,
        score_multiplier, aliases_json, notes, safety_status, source, created_at, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, 'trusted', ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        theme_id = excluded.theme_id,
        canonical = excluded.canonical,
        normalized = excluded.normalized,
        language = excluded.language,
        expertise_tier = excluded.expertise_tier,
        score_multiplier = excluded.score_multiplier,
        aliases_json = excluded.aliases_json,
        updated_at = excluded.updated_at
      `,
      [
        word.id,
        theme.id,
        word.canonical,
        word.normalized,
        word.language,
        word.expertiseTier,
        word.scoreMultiplier,
        json(word.aliases),
        sourceForTheme(theme.id),
        savedAt,
        savedAt,
      ],
    );
  }
}

async function saveBoardTemplate(database: SqlDatabase, board: StoredBoard, savedAt: string): Promise<void> {
  await database.execute(
    `
    INSERT INTO board_templates (
      id, slug, title_json, width, height, active_mask_json, source, created_at, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, 'user', ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      slug = excluded.slug,
      title_json = excluded.title_json,
      width = excluded.width,
      height = excluded.height,
      active_mask_json = excluded.active_mask_json,
      updated_at = excluded.updated_at
    `,
    [
      board.templateId,
      board.templateId,
      json({ default: board.templateId }),
      board.width,
      board.height,
      json(board.cells.map((row) => row.map((cell) => cell.kind !== 'blocked'))),
      savedAt,
      savedAt,
    ],
  );
}

async function savePlayers(
  database: SqlDatabase,
  players: readonly StoredPlayerState[],
  savedAt: string,
): Promise<void> {
  for (const player of players) {
    await database.execute(
      `
      INSERT INTO players (
        id, provider, provider_user_id, login, display_name, first_seen_at, last_seen_at, local_flags_json
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(provider, provider_user_id) DO UPDATE SET
        id = excluded.id,
        login = excluded.login,
        display_name = excluded.display_name,
        last_seen_at = excluded.last_seen_at,
        local_flags_json = excluded.local_flags_json
      `,
      [
        player.id,
        player.identity.provider,
        player.identity.providerUserId,
        player.identity.login,
        player.identity.displayName,
        savedAt,
        player.lastActionAt || savedAt,
        json({
          markerColor: player.markerColor,
          status: player.status,
        }),
      ],
    );
  }
}

async function saveBlockedPlayers(
  database: SqlDatabase,
  blockedPlayers: readonly StoredBlockedPlayer[],
  savedAt: string,
): Promise<void> {
  for (const blockedPlayer of blockedPlayers) {
    const identity = blockedIdentity(blockedPlayer);
    await database.execute(
      `
      INSERT INTO player_blocks (
        id, provider, provider_user_id, login, display_name, reason, created_at, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(provider, provider_user_id) DO UPDATE SET
        login = excluded.login,
        display_name = excluded.display_name,
        reason = excluded.reason,
        updated_at = excluded.updated_at
      `,
      [
        blockedPlayer.playerId,
        identity.provider,
        identity.providerUserId,
        identity.login,
        identity.displayName,
        blockedPlayer.reason ?? null,
        blockedPlayer.blockedAt,
        savedAt,
      ],
    );
  }
}

async function saveRound(
  database: SqlDatabase,
  state: StoredRoundState,
  modeId: string,
  savedAt: string,
): Promise<void> {
  const summary: RoundSummaryEnvelope<typeof state> = {
    version: SNAPSHOT_VERSION,
    savedAt,
    state,
  };

  await database.execute(
    `
    INSERT INTO rounds (
      id, theme_id, board_template_id, mode_id, seed, settings_json,
      started_at, ended_at, status, summary_json
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      theme_id = excluded.theme_id,
      board_template_id = excluded.board_template_id,
      mode_id = excluded.mode_id,
      seed = excluded.seed,
      settings_json = excluded.settings_json,
      ended_at = excluded.ended_at,
      status = excluded.status,
      summary_json = excluded.summary_json
    `,
    [
      state.id,
      state.theme.id,
      state.board.templateId,
      modeId,
      state.board.seed,
      json(state.settings),
      savedAt,
      state.status === 'ended' ? savedAt : null,
      state.status,
      json(summary),
    ],
  );
}

async function saveFoundWords(
  database: SqlDatabase,
  state: StoredRoundState,
  savedAt: string,
): Promise<void> {
  await database.execute('DELETE FROM found_words WHERE round_id = ?', [state.id]);

  for (const foundWord of state.foundWords) {
    await database.execute(
      `
      INSERT INTO found_words (
        id, round_id, player_id, word_id, canonical, normalized,
        points, path_json, accepted_at, source
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        foundWord.id,
        state.id,
        foundWord.playerId,
        foundWord.wordId,
        foundWord.canonical,
        foundWord.normalized,
        foundWord.points,
        json(foundWord.path),
        foundWord.acceptedAt || savedAt,
        foundWord.source,
      ],
    );
  }
}

async function saveSubmissions(database: SqlDatabase, state: StoredRoundState): Promise<void> {
  await database.execute('DELETE FROM submissions WHERE round_id = ?', [state.id]);

  for (const submission of state.rejectedSubmissions) {
    await database.execute(
      `
      INSERT INTO submissions (
        id, round_id, player_id, theme_id, raw_word, normalized_word,
        status, word_id, points, path_json, created_at, reviewed_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?, ?)
      `,
      [
        submission.id,
        state.id,
        submission.playerId,
        state.theme.id,
        submission.rawWord,
        submission.normalizedWord,
        submission.status,
        json(submission.path),
        submission.createdAt,
        submission.status === 'pending' ? null : submission.createdAt,
      ],
    );
  }
}

async function trimRoundEvents(database: SqlDatabase, state: StoredRoundState): Promise<void> {
  await database.execute(
    'DELETE FROM round_events WHERE round_id = ? AND seq > ?',
    [state.id, state.eventSeq],
  );
}

async function saveRoundEvents(
  database: SqlDatabase,
  roundId: string,
  events: readonly StoredDomainEvent[],
  savedAt: string,
): Promise<void> {
  for (const event of events) {
    await database.execute(
      `
      INSERT INTO round_events (id, round_id, seq, type, payload_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(round_id, seq) DO UPDATE SET
        type = excluded.type,
        payload_json = excluded.payload_json,
        created_at = excluded.created_at
      `,
      [
        `${roundId}:event:${event.seq}`,
        roundId,
        event.seq,
        event.type,
        json(event),
        savedAt,
      ],
    );
  }
}

async function rollbackQuietly(database: SqlDatabase): Promise<void> {
  try {
    await database.execute('ROLLBACK');
  } catch {
    // Preserve the original storage error.
  }
}

function blockedIdentity(blockedPlayer: StoredBlockedPlayer): StoredPlayerIdentity {
  if (blockedPlayer.identity) {
    return blockedPlayer.identity;
  }

  const [provider = 'unknown', ...rest] = blockedPlayer.playerId.split(':');
  const providerUserId = rest.join(':') || blockedPlayer.playerId;

  return {
    provider,
    providerUserId,
    login: providerUserId,
    displayName: providerUserId,
  };
}

function sourceForTheme(themeId: string): 'built_in' | 'user' {
  return themeId.startsWith('starter-') ? 'built_in' : 'user';
}

function json(value: unknown): string {
  return JSON.stringify(value);
}
