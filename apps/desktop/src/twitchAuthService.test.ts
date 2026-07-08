import { describe, expect, it } from 'vitest';
import {
  pollTwitchDeviceToken,
  requestTwitchDeviceAuthorization,
  scopesForTwitchRole,
  twitchAuthClipboardText,
  type TwitchAuthTransport,
} from './twitchAuthService';

function createTransport(response: unknown): TwitchAuthTransport {
  return {
    async postForm() {
      return response;
    },
    async getJson() {
      return response;
    },
  };
}

const now = () => '2026-07-07T02:00:00.000Z';

describe('twitch auth service', () => {
  it('defines separate chat reader and sender scopes', () => {
    expect(scopesForTwitchRole('chatReader')).toEqual(['chat:read']);
    expect(scopesForTwitchRole('chatSender')).toEqual(['chat:read', 'chat:edit']);
  });

  it('requests device authorization and formats clipboard text', async () => {
    const device = await requestTwitchDeviceAuthorization({
      clientId: ' client-id ',
      role: 'chatSender',
      now,
      transport: createTransport({
        device_code: 'device-code',
        user_code: 'ABCDEFGH',
        verification_uri: 'https://www.twitch.tv/activate?public=true&device-code=ABCDEFGH',
        expires_in: 1800,
        interval: 5,
      }),
    });

    expect(device).toEqual({
      deviceCode: 'device-code',
      userCode: 'ABCDEFGH',
      verificationUri: 'https://www.twitch.tv/activate?public=true&device-code=ABCDEFGH',
      expiresIn: 1800,
      interval: 5,
      requestedAt: '2026-07-07T02:00:00.000Z',
      scopes: ['chat:read', 'chat:edit'],
    });
    expect(twitchAuthClipboardText(device)).toBe(
      'https://www.twitch.tv/activate?public=true&device-code=ABCDEFGH\nCode: ABCDEFGH',
    );
  });

  it('polls a device token response', async () => {
    const token = await pollTwitchDeviceToken({
      clientId: 'client-id',
      device: {
        deviceCode: 'device-code',
        userCode: 'ABCDEFGH',
        verificationUri: 'https://www.twitch.tv/activate?public=true&device-code=ABCDEFGH',
        expiresIn: 1800,
        interval: 5,
        requestedAt: '2026-07-07T01:59:00.000Z',
        scopes: ['chat:read'],
      },
      now,
      transport: createTransport({
        access_token: 'access-token',
        refresh_token: 'refresh-token',
        expires_in: 14400,
        scope: ['chat:read'],
        token_type: 'bearer',
      }),
    });

    expect(token).toEqual({
      accessToken: 'access-token',
      refreshToken: 'refresh-token',
      expiresIn: 14400,
      scopes: ['chat:read'],
      tokenType: 'bearer',
      receivedAt: '2026-07-07T02:00:00.000Z',
    });
  });

  it('marks authorization_pending as retryable', async () => {
    await expect(pollTwitchDeviceToken({
      clientId: 'client-id',
      device: {
        deviceCode: 'device-code',
        userCode: 'ABCDEFGH',
        verificationUri: 'https://www.twitch.tv/activate?public=true&device-code=ABCDEFGH',
        expiresIn: 1800,
        interval: 5,
        requestedAt: '2026-07-07T01:59:00.000Z',
        scopes: ['chat:read'],
      },
      transport: createTransport({
        status: 400,
        message: 'authorization_pending',
      }),
    })).rejects.toMatchObject({
      code: 'authorization_pending',
      retryable: true,
    });
  });

  it('requires a client id before making requests', async () => {
    await expect(requestTwitchDeviceAuthorization({
      clientId: ' ',
      role: 'chatReader',
      transport: createTransport({}),
    })).rejects.toMatchObject({
      code: 'missing_client_id',
    });
  });
});
