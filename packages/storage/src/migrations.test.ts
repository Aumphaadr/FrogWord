import { describe, expect, it } from 'vitest';
import { SQLITE_MIGRATIONS } from './migrations.js';

describe('SQLite migrations', () => {
  it('contains unique migration ids with executable statements', () => {
    const ids = SQLITE_MIGRATIONS.map((migration) => migration.id);

    expect(new Set(ids).size).toBe(ids.length);
    expect(SQLITE_MIGRATIONS.every((migration) => migration.statements.length > 0)).toBe(true);
  });

  it('creates the core application tables', () => {
    const sql = SQLITE_MIGRATIONS.flatMap((migration) => migration.statements).join('\n');

    expect(sql).toContain('CREATE TABLE IF NOT EXISTS themes');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS words');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS board_templates');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS rounds');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS round_events');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS found_words');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS submissions');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS players');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS player_blocks');
  });
});
