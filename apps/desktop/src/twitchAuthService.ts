export type TwitchAuthRole = 'chatReader' | 'chatSender';

export interface TwitchAuthRoleDefinition {
  role: TwitchAuthRole;
  title: string;
  description: string;
  scopes: readonly string[];
}

export interface TwitchDeviceAuthorization {
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  expiresIn: number;
  interval: number;
  requestedAt: string;
  scopes: readonly string[];
}

export interface TwitchTokenSet {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  scopes: readonly string[];
  tokenType: string;
  receivedAt: string;
}

export interface TwitchValidatedToken {
  clientId: string;
  login: string;
  userId: string;
  scopes: readonly string[];
  expiresIn: number;
}

export interface TwitchAuthTransport {
  postForm(url: string, fields: Record<string, string>): Promise<unknown>;
  getJson(url: string, headers?: Record<string, string>): Promise<unknown>;
}

export class TwitchAuthError extends Error {
  readonly code: string;
  readonly retryable: boolean;

  constructor(code: string, message: string, retryable = false) {
    super(message);
    this.name = 'TwitchAuthError';
    this.code = code;
    this.retryable = retryable;
  }
}

const TWITCH_DEVICE_URL = 'https://id.twitch.tv/oauth2/device';
const TWITCH_TOKEN_URL = 'https://id.twitch.tv/oauth2/token';
const TWITCH_VALIDATE_URL = 'https://id.twitch.tv/oauth2/validate';
const DEVICE_CODE_GRANT = 'urn:ietf:params:oauth:grant-type:device_code';

export const TWITCH_AUTH_ROLES: readonly TwitchAuthRoleDefinition[] = [
  {
    role: 'chatReader',
    title: 'Chat reader',
    description: 'Reads channel chat commands through Twitch IRC.',
    scopes: ['chat:read'],
  },
  {
    role: 'chatSender',
    title: 'Chat sender',
    description: 'Sends chat messages through Twitch IRC as the bot account.',
    scopes: ['chat:read', 'chat:edit'],
  },
];

export const defaultTwitchAuthTransport: TwitchAuthTransport = {
  async postForm(url, fields) {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams(fields),
    });
    return parseJsonResponse(response);
  },
  async getJson(url, headers = {}) {
    const response = await fetch(url, {
      headers,
    });
    return parseJsonResponse(response);
  },
};

export function scopesForTwitchRole(role: TwitchAuthRole): readonly string[] {
  const definition = TWITCH_AUTH_ROLES.find((entry) => entry.role === role);
  if (!definition) {
    throw new TwitchAuthError('unknown_role', `Unknown Twitch auth role: ${role}`);
  }

  return definition.scopes;
}

export function normalizeTwitchClientId(value: string): string {
  return value.trim();
}

export async function requestTwitchDeviceAuthorization(input: {
  clientId: string;
  role: TwitchAuthRole;
  transport?: TwitchAuthTransport;
  now?: () => string;
}): Promise<TwitchDeviceAuthorization> {
  const clientId = normalizeTwitchClientId(input.clientId);
  if (!clientId) {
    throw new TwitchAuthError('missing_client_id', 'Twitch Client ID is required');
  }

  const scopes = scopesForTwitchRole(input.role);
  const transport = input.transport ?? defaultTwitchAuthTransport;
  const response = await transport.postForm(TWITCH_DEVICE_URL, {
    client_id: clientId,
    scopes: scopes.join(' '),
  });
  const parsed = readDeviceAuthorizationResponse(response);

  return {
    ...parsed,
    requestedAt: (input.now ?? (() => new Date().toISOString()))(),
    scopes,
  };
}

export async function pollTwitchDeviceToken(input: {
  clientId: string;
  device: TwitchDeviceAuthorization;
  transport?: TwitchAuthTransport;
  now?: () => string;
}): Promise<TwitchTokenSet> {
  const clientId = normalizeTwitchClientId(input.clientId);
  if (!clientId) {
    throw new TwitchAuthError('missing_client_id', 'Twitch Client ID is required');
  }

  const transport = input.transport ?? defaultTwitchAuthTransport;
  const response = await transport.postForm(TWITCH_TOKEN_URL, {
    client_id: clientId,
    scopes: input.device.scopes.join(' '),
    device_code: input.device.deviceCode,
    grant_type: DEVICE_CODE_GRANT,
  });

  return readTokenResponse(response, input.now);
}

export async function refreshTwitchToken(input: {
  clientId: string;
  refreshToken: string;
  transport?: TwitchAuthTransport;
  now?: () => string;
}): Promise<TwitchTokenSet> {
  const clientId = normalizeTwitchClientId(input.clientId);
  if (!clientId) {
    throw new TwitchAuthError('missing_client_id', 'Twitch Client ID is required');
  }

  const transport = input.transport ?? defaultTwitchAuthTransport;
  const response = await transport.postForm(TWITCH_TOKEN_URL, {
    client_id: clientId,
    grant_type: 'refresh_token',
    refresh_token: input.refreshToken,
  });

  return readTokenResponse(response, input.now);
}

export async function validateTwitchToken(input: {
  accessToken: string;
  transport?: TwitchAuthTransport;
}): Promise<TwitchValidatedToken> {
  const transport = input.transport ?? defaultTwitchAuthTransport;
  const response = await transport.getJson(TWITCH_VALIDATE_URL, {
    Authorization: `OAuth ${input.accessToken}`,
  });

  return readValidateResponse(response);
}

export function twitchAuthClipboardText(device: TwitchDeviceAuthorization): string {
  return `${device.verificationUri}\nCode: ${device.userCode}`;
}

async function parseJsonResponse(response: Response): Promise<unknown> {
  const body = await response.json().catch(() => undefined) as unknown;
  if (!response.ok) {
    throw errorFromTwitchResponse(body, `http_${response.status}`);
  }

  return body;
}

function readDeviceAuthorizationResponse(value: unknown): Omit<TwitchDeviceAuthorization, 'requestedAt' | 'scopes'> {
  if (!isRecord(value)) {
    throw new TwitchAuthError('invalid_response', 'Twitch device response is not an object');
  }

  const deviceCode = readString(value.device_code, 'device_code');
  const userCode = readString(value.user_code, 'user_code');
  const verificationUri = readString(value.verification_uri, 'verification_uri');
  const expiresIn = readPositiveNumber(value.expires_in, 'expires_in');
  const interval = readPositiveNumber(value.interval, 'interval');

  return {
    deviceCode,
    userCode,
    verificationUri,
    expiresIn,
    interval,
  };
}

function readTokenResponse(value: unknown, now: (() => string) | undefined): TwitchTokenSet {
  if (isRecord(value) && typeof value.message === 'string' && !('access_token' in value)) {
    throw errorFromTwitchResponse(value, value.message);
  }

  if (!isRecord(value)) {
    throw new TwitchAuthError('invalid_response', 'Twitch token response is not an object');
  }

  return {
    accessToken: readString(value.access_token, 'access_token'),
    refreshToken: readString(value.refresh_token, 'refresh_token'),
    expiresIn: readPositiveNumber(value.expires_in, 'expires_in'),
    scopes: readStringArray(value.scope, 'scope'),
    tokenType: readString(value.token_type, 'token_type'),
    receivedAt: (now ?? (() => new Date().toISOString()))(),
  };
}

function readValidateResponse(value: unknown): TwitchValidatedToken {
  if (!isRecord(value)) {
    throw new TwitchAuthError('invalid_response', 'Twitch validate response is not an object');
  }

  return {
    clientId: readString(value.client_id, 'client_id'),
    login: readString(value.login, 'login'),
    userId: readString(value.user_id, 'user_id'),
    scopes: readStringArray(value.scopes, 'scopes'),
    expiresIn: readPositiveNumber(value.expires_in, 'expires_in'),
  };
}

function errorFromTwitchResponse(value: unknown, fallbackCode: string): TwitchAuthError {
  if (isRecord(value)) {
    const message = typeof value.message === 'string' ? value.message : fallbackCode;
    const code = normalizeErrorCode(message);
    return new TwitchAuthError(code, message, code === 'authorization_pending');
  }

  return new TwitchAuthError(fallbackCode, fallbackCode);
}

function normalizeErrorCode(message: string): string {
  return message.trim().toLocaleLowerCase().replaceAll(/\s+/g, '_');
}

function readString(value: unknown, field: string): string {
  if (typeof value === 'string' && value.length > 0) {
    return value;
  }

  throw new TwitchAuthError('invalid_response', `Missing Twitch field: ${field}`);
}

function readStringArray(value: unknown, field: string): string[] {
  if (Array.isArray(value) && value.every((entry) => typeof entry === 'string')) {
    return [...value];
  }

  if (typeof value === 'string' && value.trim()) {
    return value.split(/\s+/);
  }

  throw new TwitchAuthError('invalid_response', `Missing Twitch field: ${field}`);
}

function readPositiveNumber(value: unknown, field: string): number {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return value;
  }

  throw new TwitchAuthError('invalid_response', `Missing Twitch field: ${field}`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
