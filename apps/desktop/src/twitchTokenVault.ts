import type { SqlDatabase } from '@frogword/storage';
import { initializeNativeStorage } from './nativeStorage';
import type { TwitchAuthRole, TwitchTokenSet, TwitchValidatedToken } from './twitchAuthService';

export interface StoredTwitchAuthRole {
  role: TwitchAuthRole;
  clientId: string;
  token: TwitchTokenSet;
  validation?: TwitchValidatedToken;
  savedAt: string;
}

export interface StoredTwitchAuthVault {
  formatVersion: 1;
  updatedAt: string;
  roles: Partial<Record<TwitchAuthRole, StoredTwitchAuthRole>>;
}

export interface TwitchTokenVaultOptions {
  database?: SqlDatabase;
  now?: () => string;
}

const TWITCH_AUTH_METADATA_KEY = 'twitch_auth:v1';

export async function loadStoredTwitchAuthVault(
  options: Pick<TwitchTokenVaultOptions, 'database'> = {},
): Promise<StoredTwitchAuthVault | undefined> {
  const database = await resolveDatabase(options.database);
  if (!database) {
    return undefined;
  }

  const rows = await database.query<{ value_json: string; updated_at: string }>(
    'SELECT value_json, updated_at FROM app_metadata WHERE key = ?',
    [TWITCH_AUTH_METADATA_KEY],
  );
  const row = rows[0];
  if (!row) {
    return emptyVault('');
  }

  const parsed = readVaultPayload(row.value_json);
  return parsed ?? emptyVault(row.updated_at);
}

export async function saveStoredTwitchAuthRole(
  record: Omit<StoredTwitchAuthRole, 'savedAt'>,
  options: TwitchTokenVaultOptions = {},
): Promise<StoredTwitchAuthVault | undefined> {
  const database = await resolveDatabase(options.database);
  if (!database) {
    return undefined;
  }

  const now = options.now ?? (() => new Date().toISOString());
  const updatedAt = now();
  const current = await loadStoredTwitchAuthVault({ database }) ?? emptyVault(updatedAt);
  const next: StoredTwitchAuthVault = {
    formatVersion: 1,
    updatedAt,
    roles: {
      ...current.roles,
      [record.role]: {
        ...record,
        savedAt: updatedAt,
      },
    },
  };

  await writeVault(database, next);
  return next;
}

export async function clearStoredTwitchAuthRole(
  role: TwitchAuthRole,
  options: TwitchTokenVaultOptions = {},
): Promise<StoredTwitchAuthVault | undefined> {
  const database = await resolveDatabase(options.database);
  if (!database) {
    return undefined;
  }

  const now = options.now ?? (() => new Date().toISOString());
  const current = await loadStoredTwitchAuthVault({ database }) ?? emptyVault(now());
  const roles = { ...current.roles };
  delete roles[role];
  const next: StoredTwitchAuthVault = {
    formatVersion: 1,
    updatedAt: now(),
    roles,
  };

  await writeVault(database, next);
  return next;
}

async function resolveDatabase(database: SqlDatabase | undefined): Promise<SqlDatabase | undefined> {
  if (database) {
    return database;
  }

  return (await initializeNativeStorage())?.database;
}

async function writeVault(database: SqlDatabase, vault: StoredTwitchAuthVault): Promise<void> {
  await database.execute(
    `
    INSERT INTO app_metadata (key, value_json, updated_at)
    VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET
      value_json = excluded.value_json,
      updated_at = excluded.updated_at
    `,
    [TWITCH_AUTH_METADATA_KEY, JSON.stringify(vault), vault.updatedAt],
  );
}

function emptyVault(updatedAt: string): StoredTwitchAuthVault {
  return {
    formatVersion: 1,
    updatedAt,
    roles: {},
  };
}

function readVaultPayload(rawJson: string): StoredTwitchAuthVault | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawJson);
  } catch {
    return undefined;
  }

  if (!isRecord(parsed) || parsed.formatVersion !== 1 || !isRecord(parsed.roles)) {
    return undefined;
  }

  const updatedAt = typeof parsed.updatedAt === 'string' ? parsed.updatedAt : '';
  const roles: Partial<Record<TwitchAuthRole, StoredTwitchAuthRole>> = {};
  for (const role of ['chatReader', 'chatSender'] as const) {
    const value = parsed.roles[role];
    if (isStoredRole(role, value)) {
      roles[role] = value;
    }
  }

  return {
    formatVersion: 1,
    updatedAt,
    roles,
  };
}

function isStoredRole(role: TwitchAuthRole, value: unknown): value is StoredTwitchAuthRole {
  return isRecord(value)
    && value.role === role
    && typeof value.clientId === 'string'
    && isRecord(value.token)
    && typeof value.token.accessToken === 'string'
    && typeof value.token.refreshToken === 'string'
    && typeof value.savedAt === 'string';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
