import { SCHEMA_MIGRATIONS_TABLE_SQL } from './migrations.js';
import type { Migration, MigrationRecord, MigrationResult, SqlDatabase } from './types.js';

interface AppliedMigrationRow {
  id: string;
  title: string;
  applied_at: string;
}

export async function runMigrations(
  database: SqlDatabase,
  migrations: readonly Migration[],
  now: () => string = () => new Date().toISOString(),
): Promise<MigrationResult> {
  assertUniqueMigrationIds(migrations);
  await initializeMigrationStore(database);

  const appliedRows = await loadAppliedMigrations(database);
  const appliedIds = new Set(appliedRows.map((row) => row.id));
  const result: MigrationResult = {
    applied: [],
    skipped: appliedRows.map(toMigrationRecord),
  };

  for (const migration of migrations) {
    if (appliedIds.has(migration.id)) {
      continue;
    }

    const appliedAt = now();
    await applyMigration(database, migration, appliedAt);
    result.applied.push({
      id: migration.id,
      title: migration.title,
      appliedAt,
    });
    appliedIds.add(migration.id);
  }

  return result;
}

export async function initializeMigrationStore(database: SqlDatabase): Promise<void> {
  await database.execute('PRAGMA foreign_keys = ON');
  await database.execute(SCHEMA_MIGRATIONS_TABLE_SQL);
}

async function loadAppliedMigrations(database: SqlDatabase): Promise<AppliedMigrationRow[]> {
  return database.query<AppliedMigrationRow>(
    'SELECT id, title, applied_at FROM schema_migrations ORDER BY id',
  );
}

async function applyMigration(database: SqlDatabase, migration: Migration, appliedAt: string): Promise<void> {
  await database.execute('BEGIN');
  try {
    for (const statement of migration.statements) {
      const trimmed = statement.trim();
      if (trimmed.length > 0) {
        await database.execute(trimmed);
      }
    }

    await database.execute(
      'INSERT INTO schema_migrations (id, title, applied_at) VALUES (?, ?, ?)',
      [migration.id, migration.title, appliedAt],
    );
    await database.execute('COMMIT');
  } catch (error) {
    await database.execute('ROLLBACK');
    throw error;
  }
}

function assertUniqueMigrationIds(migrations: readonly Migration[]): void {
  const seen = new Set<string>();
  for (const migration of migrations) {
    if (seen.has(migration.id)) {
      throw new Error(`Duplicate migration id: ${migration.id}`);
    }
    seen.add(migration.id);
  }
}

function toMigrationRecord(row: AppliedMigrationRow): MigrationRecord {
  return {
    id: row.id,
    title: row.title,
    appliedAt: row.applied_at,
  };
}
