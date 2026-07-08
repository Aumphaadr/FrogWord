export type SqlValue = string | number | bigint | boolean | null | Uint8Array;

export interface SqlDatabase {
  execute(sql: string, params?: readonly SqlValue[]): Promise<void>;
  query<T>(sql: string, params?: readonly SqlValue[]): Promise<T[]>;
}

export interface Migration {
  id: string;
  title: string;
  statements: readonly string[];
}

export interface MigrationRecord {
  id: string;
  title: string;
  appliedAt: string;
}

export interface MigrationResult {
  applied: MigrationRecord[];
  skipped: MigrationRecord[];
}
