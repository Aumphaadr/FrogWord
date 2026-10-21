import { describe, expect, it } from 'vitest';
import { TwitchAuthError, type TwitchTokenSet, type TwitchValidatedToken } from './twitchAuthService';
import { maintainStoredTwitchAuthRole } from './twitchAuthSessionService';
import type { StoredTwitchAuthRole } from './twitchTokenVault';

const token: TwitchTokenSet = {
  accessToken: 'access-token',
  refreshToken: 'refresh-token',
  expiresIn: 14400,
  scopes: ['chat:read'],
  tokenType: 'bearer',
  receivedAt: '2026-07-07T02:00:00.000Z',
};

const validation: TwitchValidatedToken = {
  clientId: 'client-id',
  login: 'streamer',
  userId: '42',
  scopes: ['chat:read'],
  expiresIn: 14000,
};

const stored: StoredTwitchAuthRole = {
  role: 'chatReader',
  clientId: 'client-id',
  token,
  validation,
  savedAt: '2026-07-07T03:00:00.000Z',
};

describe('twitch auth session service', () => {
  it('keeps a stored role when validation succeeds with required scopes', async () => {
    const result = await maintainStoredTwitchAuthRole(stored, {
      async validate() {
        return validation;
      },
      async refresh() {
        throw new Error('refresh should not be called');
      },
      async save() {
        throw new Error('save should not be called');
      },
      async clear() {
        throw new Error('clear should not be called');
      },
    });

    expect(result).toEqual({
      status: 'valid',
      role: 'chatReader',
      clientId: 'client-id',
      token,
      validation,
    });
  });

  it('refreshes and saves a role when access token validation fails', async () => {
    const saved: unknown[] = [];
    const refreshedToken = {
      ...token,
      accessToken: 'fresh-access-token',
      refreshToken: 'fresh-refresh-token',
    };

    const result = await maintainStoredTwitchAuthRole(stored, {
      async validate(input) {
        if (input.accessToken === 'access-token') {
          throw new TwitchAuthError('invalid_access_token', 'invalid access token');
        }

        return {
          ...validation,
          expiresIn: 14400,
        };
      },
      async refresh() {
        return refreshedToken;
      },
      async save(record) {
        saved.push(record);
        return undefined;
      },
      async clear() {
        throw new Error('clear should not be called');
      },
    });

    expect(result).toMatchObject({
      status: 'refreshed',
      token: refreshedToken,
    });
    expect(saved).toHaveLength(1);
  });

  it('clears a role when refresh cannot produce a usable token', async () => {
    const cleared: string[] = [];

    const result = await maintainStoredTwitchAuthRole(stored, {
      async validate() {
        throw new TwitchAuthError('invalid_access_token', 'invalid access token');
      },
      async refresh() {
        throw new TwitchAuthError('invalid_refresh_token', 'Invalid refresh token');
      },
      async save() {
        throw new Error('save should not be called');
      },
      async clear(role) {
        cleared.push(role);
        return undefined;
      },
    });

    expect(result).toEqual({
      status: 'expired',
      role: 'chatReader',
      message: 'Invalid refresh token',
      code: 'invalid_refresh_token',
    });
    expect(cleared).toEqual(['chatReader']);
  });
});
