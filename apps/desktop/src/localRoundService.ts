import type { DomainEvent, RoundState } from '@frogword/core';
import {
  loadRoundEvents,
  loadRoundSnapshot,
  type RoundSnapshot,
  saveRoundSnapshot,
  type MigrationResult,
  type RoundEventRecord,
  type SqlDatabase,
} from '@frogword/storage';
import { initializeNativeStorage } from './nativeStorage';

export const LOCAL_ROUND_ID = 'local-demo';
const MAX_RESTORED_AUDIT_EVENTS = 80;

export interface LocalRoundServiceOptions {
  now?: () => string;
}

export interface LocalRoundHydrationResult {
  pendingStoredRound?: RoundSnapshot<RoundState>;
  domainEvents: RoundEventRecord<DomainEvent>[];
  logEntries: string[];
}

export interface LocalRoundService {
  hydrate(getCurrentRound: () => RoundState): Promise<LocalRoundHydrationResult>;
  replaceWithCurrent(round: RoundState): Promise<void> | undefined;
  persist(round: RoundState, events?: readonly DomainEvent[]): Promise<void> | undefined;
}

export function createLocalRoundService(options: LocalRoundServiceOptions = {}): LocalRoundService {
  const now = options.now ?? (() => new Date().toISOString());
  let database: SqlDatabase | undefined;
  let mutationVersion = 0;

  return {
    async hydrate(getCurrentRound) {
      const hydrationMutationVersion = mutationVersion;
      const result = await initializeNativeStorage();
      if (!result) {
        return { domainEvents: [], logEntries: [] };
      }

      database = result.database;
      const stored = await loadRoundSnapshot<RoundState>(database, LOCAL_ROUND_ID);
      const logEntries = storageLogEntries(result.migrations);

      if (stored && mutationVersion === hydrationMutationVersion) {
        const domainEvents = await loadRoundEvents<DomainEvent>(database, LOCAL_ROUND_ID, {
          limit: MAX_RESTORED_AUDIT_EVENTS,
        });

        return {
          domainEvents,
          pendingStoredRound: stored,
          logEntries: [
            `Saved local round available: ${formatStorageTime(stored.savedAt)}`,
            ...logEntries,
          ],
        };
      }

      if (stored) {
        await saveRoundSnapshot(database, {
          state: getCurrentRound(),
          savedAt: now(),
        });
        return {
          domainEvents: [],
          logEntries: [
            'Kept current local round and refreshed stored snapshot',
            ...logEntries,
          ],
        };
      }

      await saveRoundSnapshot(database, {
        state: getCurrentRound(),
        savedAt: now(),
      });
      return {
        domainEvents: [],
        logEntries: [
          'Created initial local round snapshot',
          ...logEntries,
        ],
      };
    },

    replaceWithCurrent(round) {
      mutationVersion += 1;
      if (!database) {
        return undefined;
      }

      return saveRoundSnapshot(database, {
        state: round,
        savedAt: now(),
      });
    },

    persist(round, events = []) {
      mutationVersion += 1;
      if (!database) {
        return undefined;
      }

      return saveRoundSnapshot(database, {
        state: round,
        events,
        savedAt: now(),
      });
    },
  };
}

function storageLogEntries(migrations: MigrationResult): string[] {
  return [
    `SQLite ready: ${migrations.applied.length} applied, ${migrations.skipped.length} already present`,
  ];
}

function formatStorageTime(value: string): string {
  if (!value) {
    return 'unknown time';
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleTimeString();
}
