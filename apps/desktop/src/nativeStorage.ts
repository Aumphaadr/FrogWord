import {
  SQLITE_MIGRATIONS,
  runMigrations,
  type MigrationResult,
  type SqlDatabase,
  type SqlValue,
} from '@frogword/storage';

interface TauriInternals {
  invoke?: unknown;
}

type WindowWithTauri = Window & {
  __TAURI_INTERNALS__?: TauriInternals;
};

export interface NativeStorageStatus {
  databasePath: string;
  exists: boolean;
}

export interface NativeStorageInitResult {
  status: NativeStorageStatus;
  migrations: MigrationResult;
  database: SqlDatabase;
}

let initializationPromise: Promise<NativeStorageInitResult | undefined> | undefined;

export function initializeNativeStorage(): Promise<NativeStorageInitResult | undefined> {
  initializationPromise ??= initializeNativeStorageOnce();
  return initializationPromise;
}

function createTauriSqlDatabase(): SqlDatabase {
  return {
    async execute(sql, params = []) {
      const { invoke } = await import('@tauri-apps/api/core');
      await invoke('frogword_execute_sql', {
        sql,
        params: serializeSqlParams(params),
      });
    },
    async query<T>(sql: string, params: readonly SqlValue[] = []): Promise<T[]> {
      const { invoke } = await import('@tauri-apps/api/core');
      return invoke<T[]>('frogword_query_sql', {
        sql,
        params: serializeSqlParams(params),
      });
    },
  };
}

async function initializeNativeStorageOnce(): Promise<NativeStorageInitResult | undefined> {
  if (!isTauriRuntime()) {
    return undefined;
  }

  const { invoke } = await import('@tauri-apps/api/core');
  const database = createTauriSqlDatabase();
  const migrations = await runMigrations(database, SQLITE_MIGRATIONS);
  const status = await invoke<NativeStorageStatus>('frogword_storage_status');

  return {
    status,
    migrations,
    database,
  };
}

function serializeSqlParams(params: readonly SqlValue[]): unknown[] {
  return params.map((param) => {
    if (param instanceof Uint8Array) {
      return [...param];
    }

    return param;
  });
}

function isTauriRuntime(): boolean {
  if (typeof window === 'undefined') {
    return false;
  }

  return typeof (window as WindowWithTauri).__TAURI_INTERNALS__?.invoke === 'function';
}
