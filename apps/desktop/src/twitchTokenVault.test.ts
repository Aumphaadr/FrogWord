import { describe, expect, it } from 'vitest';
import type { SqlDatabase, SqlValue } from '@frogword/storage';
import {
  clearStoredTwitchAuthRole,
  loadStoredTwitchAuthVault,
  saveStoredTwitchAuthRole,
} from './twitchTokenVault';

class FakeMetadataDatabase implements SqlDatabase {
  readonly metadata = new Map<string, { valueJson: string; updatedAt: string }>();

  async execute(sql: string, params: readonly SqlValue[] = []): Promise<void> {
    if (!sql.includes('INSERT INTO app_metadata')) {
      return;
    }

    const [key, valueJson, updatedAt] = params;
    this.metadata.set(String(key), {
      valueJson: String(valueJson),
      updatedAt: String(updatedAt),
    });
  }

  async query<T>(sql: string, params: readonly SqlValue[] = []): Promise<T[]> {
    if (!sql.includes('FROM app_metadata')) {
      return [];
    }

    const key = String(params[0]);
    const row = this.metadata.get(key);
    return row
      ? [{ value_json: row.valueJson, updated_at: row.updatedAt } as T]
      : [];
  }
}

const token = {
  accessToken: 'access-token',
  refreshToken: 'refresh-token',
  expiresIn: 14400,
  scopes: ['chat:read'],
  tokenType: 'bearer',
  receivedAt: '2026-07-07T02:00:00.000Z',
};

const validation = {
  clientId: 'client-id',
  login: 'streamer',
  userId: '42',
  scopes: ['chat:read'],
  expiresIn: 14000,
};

describe('twitch token vault', () => {
  it('saves and loads Twitch auth roles from app metadata', async () => {
    const database = new FakeMetadataDatabase();

    await saveStoredTwitchAuthRole({
      role: 'chatReader',
      clientId: 'client-id',
      token,
      validation,
    }, {
      database,
      now: () => '2026-07-07T03:00:00.000Z',
    });

    const vault = await loadStoredTwitchAuthVault({ database });

    expect(vault?.roles.chatReader).toEqual({
      role: 'chatReader',
      clientId: 'client-id',
      token,
      validation,
      savedAt: '2026-07-07T03:00:00.000Z',
    });
  });

  it('updates one role without dropping the other role', async () => {
    const database = new FakeMetadataDatabase();

    await saveStoredTwitchAuthRole({
      role: 'chatReader',
      clientId: 'client-id',
      token,
    }, {
      database,
      now: () => '2026-07-07T03:00:00.000Z',
    });
    await saveStoredTwitchAuthRole({
      role: 'chatSender',
      clientId: 'client-id',
      token: {
        ...token,
        accessToken: 'sender-access',
        scopes: ['chat:read', 'chat:edit'],
      },
    }, {
      database,
      now: () => '2026-07-07T03:05:00.000Z',
    });

    const vault = await loadStoredTwitchAuthVault({ database });

    expect(vault?.roles.chatReader?.token.accessToken).toBe('access-token');
    expect(vault?.roles.chatSender?.token.accessToken).toBe('sender-access');
  });

  it('clears a single stored role', async () => {
    const database = new FakeMetadataDatabase();

    await saveStoredTwitchAuthRole({
      role: 'chatReader',
      clientId: 'client-id',
      token,
    }, { database });
    await saveStoredTwitchAuthRole({
      role: 'chatSender',
      clientId: 'client-id',
      token,
    }, { database });
    await clearStoredTwitchAuthRole('chatReader', { database });

    const vault = await loadStoredTwitchAuthVault({ database });

    expect(vault?.roles.chatReader).toBeUndefined();
    expect(vault?.roles.chatSender).toBeDefined();
  });
});
