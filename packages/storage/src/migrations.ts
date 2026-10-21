import type { Migration } from './types.js';

export const SCHEMA_MIGRATIONS_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS schema_migrations (
  id text primary key,
  title text not null,
  applied_at text not null
)`;

export const SQLITE_MIGRATIONS: readonly Migration[] = [
  {
    id: '001_app_schema',
    title: 'Create FrogWord application schema',
    statements: [
      `
      CREATE TABLE IF NOT EXISTS app_metadata (
        key text primary key,
        value_json text not null,
        updated_at text not null
      )
      `,
      `
      CREATE TABLE IF NOT EXISTS themes (
        id text primary key,
        slug text not null,
        language text not null check(language in ('ru', 'en')),
        title_json text not null,
        description_json text,
        tags_json text,
        difficulty text,
        min_word_length integer not null default 3 check(min_word_length > 0),
        safety_status text not null default 'trusted',
        source text not null check(source in ('built_in', 'user', 'imported')),
        version integer not null default 1 check(version > 0),
        created_at text not null,
        updated_at text not null,
        unique(slug, language)
      )
      `,
      `
      CREATE TABLE IF NOT EXISTS words (
        id text primary key,
        theme_id text not null references themes(id) on delete cascade,
        canonical text not null,
        normalized text not null,
        language text not null check(language in ('ru', 'en')),
        expertise_tier integer not null check(expertise_tier in (1, 2)),
        score_multiplier real not null default 1.0 check(score_multiplier > 0),
        aliases_json text,
        notes text,
        safety_status text not null default 'trusted',
        source text not null check(source in ('built_in', 'user', 'imported', 'host')),
        created_at text not null,
        updated_at text not null,
        unique(theme_id, normalized)
      )
      `,
      `
      CREATE TABLE IF NOT EXISTS board_templates (
        id text primary key,
        slug text not null,
        title_json text not null,
        width integer not null check(width > 0),
        height integer not null check(height > 0),
        active_mask_json text not null,
        source text not null check(source in ('built_in', 'user', 'imported')),
        created_at text not null,
        updated_at text not null,
        unique(slug)
      )
      `,
      `
      CREATE TABLE IF NOT EXISTS players (
        id text primary key,
        provider text not null,
        provider_user_id text not null,
        login text not null,
        display_name text not null,
        first_seen_at text not null,
        last_seen_at text not null,
        local_flags_json text,
        unique(provider, provider_user_id)
      )
      `,
      `
      CREATE TABLE IF NOT EXISTS player_blocks (
        id text primary key,
        provider text not null,
        provider_user_id text not null,
        login text not null,
        display_name text,
        reason text,
        created_at text not null,
        updated_at text not null,
        unique(provider, provider_user_id)
      )
      `,
      `
      CREATE TABLE IF NOT EXISTS rounds (
        id text primary key,
        theme_id text not null references themes(id),
        board_template_id text not null references board_templates(id),
        mode_id text not null,
        seed text not null,
        settings_json text not null,
        started_at text,
        ended_at text,
        status text not null,
        summary_json text
      )
      `,
      `
      CREATE TABLE IF NOT EXISTS round_events (
        id text primary key,
        round_id text not null references rounds(id) on delete cascade,
        seq integer not null,
        type text not null,
        payload_json text not null,
        created_at text not null,
        unique(round_id, seq)
      )
      `,
      `
      CREATE TABLE IF NOT EXISTS submissions (
        id text primary key,
        round_id text not null references rounds(id) on delete cascade,
        player_id text not null,
        theme_id text not null references themes(id),
        raw_word text not null,
        normalized_word text not null,
        status text not null,
        word_id text references words(id),
        points integer,
        path_json text not null,
        created_at text not null,
        reviewed_at text
      )
      `,
      'CREATE INDEX IF NOT EXISTS idx_words_theme_id ON words(theme_id)',
      'CREATE INDEX IF NOT EXISTS idx_round_events_round_seq ON round_events(round_id, seq)',
      'CREATE INDEX IF NOT EXISTS idx_submissions_round_status ON submissions(round_id, status)',
      'CREATE INDEX IF NOT EXISTS idx_submissions_theme_normalized ON submissions(theme_id, normalized_word)',
      'CREATE INDEX IF NOT EXISTS idx_players_provider_user ON players(provider, provider_user_id)',
    ],
  },
  {
    id: '002_found_words',
    title: 'Create found words table',
    statements: [
      `
      CREATE TABLE IF NOT EXISTS found_words (
        id text primary key,
        round_id text not null references rounds(id) on delete cascade,
        player_id text not null,
        word_id text not null references words(id),
        canonical text not null,
        normalized text not null,
        points integer not null,
        path_json text not null,
        accepted_at text not null,
        source text not null check(source in ('auto', 'manual', 'host')),
        unique(round_id, player_id, word_id)
      )
      `,
      'CREATE INDEX IF NOT EXISTS idx_found_words_round ON found_words(round_id, accepted_at)',
      'CREATE INDEX IF NOT EXISTS idx_found_words_player ON found_words(player_id)',
    ],
  },
];
