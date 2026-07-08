import {
  TwitchAuthError,
  refreshTwitchToken,
  scopesForTwitchRole,
  validateTwitchToken,
  type TwitchAuthRole,
  type TwitchTokenSet,
  type TwitchValidatedToken,
} from './twitchAuthService';
import {
  clearStoredTwitchAuthRole,
  saveStoredTwitchAuthRole,
  type StoredTwitchAuthRole,
} from './twitchTokenVault';

export type TwitchAuthSessionResult =
  | {
    status: 'valid';
    role: TwitchAuthRole;
    clientId: string;
    token: TwitchTokenSet;
    validation: TwitchValidatedToken;
  }
  | {
    status: 'refreshed';
    role: TwitchAuthRole;
    clientId: string;
    token: TwitchTokenSet;
    validation: TwitchValidatedToken;
  }
  | {
    status: 'expired';
    role: TwitchAuthRole;
    message: string;
    code?: string;
  };

export interface TwitchAuthSessionDependencies {
  validate?: typeof validateTwitchToken;
  refresh?: typeof refreshTwitchToken;
  save?: typeof saveStoredTwitchAuthRole;
  clear?: typeof clearStoredTwitchAuthRole;
}

export async function maintainStoredTwitchAuthRole(
  stored: StoredTwitchAuthRole,
  dependencies: TwitchAuthSessionDependencies = {},
): Promise<TwitchAuthSessionResult> {
  const validate = dependencies.validate ?? validateTwitchToken;
  const refresh = dependencies.refresh ?? refreshTwitchToken;
  const save = dependencies.save ?? saveStoredTwitchAuthRole;
  const clear = dependencies.clear ?? clearStoredTwitchAuthRole;

  try {
    const validation = await validate({ accessToken: stored.token.accessToken });
    if (hasRequiredScopes(stored.role, validation)) {
      return {
        status: 'valid',
        role: stored.role,
        clientId: stored.clientId,
        token: stored.token,
        validation,
      };
    }

    throw new TwitchAuthError('insufficient_scopes', 'Stored token has insufficient scopes');
  } catch {
    return refreshStoredTwitchAuthRole(stored, { validate, refresh, save, clear });
  }
}

async function refreshStoredTwitchAuthRole(
  stored: StoredTwitchAuthRole,
  dependencies: Required<TwitchAuthSessionDependencies>,
): Promise<TwitchAuthSessionResult> {
  try {
    const token = await dependencies.refresh({
      clientId: stored.clientId,
      refreshToken: stored.token.refreshToken,
    });
    const validation = await dependencies.validate({ accessToken: token.accessToken });
    if (!hasRequiredScopes(stored.role, validation)) {
      throw new TwitchAuthError('insufficient_scopes', 'Refreshed token has insufficient scopes');
    }

    await dependencies.save({
      role: stored.role,
      clientId: stored.clientId,
      token,
      validation,
    });

    return {
      status: 'refreshed',
      role: stored.role,
      clientId: stored.clientId,
      token,
      validation,
    };
  } catch (error) {
    await dependencies.clear(stored.role);
    return expiredResult(stored.role, error);
  }
}

function hasRequiredScopes(role: TwitchAuthRole, validation: TwitchValidatedToken): boolean {
  return scopesForTwitchRole(role).every((scope) => validation.scopes.includes(scope));
}

function expiredResult(role: TwitchAuthRole, error: unknown): TwitchAuthSessionResult {
  if (error instanceof TwitchAuthError) {
    return {
      status: 'expired',
      role,
      message: error.message,
      code: error.code,
    };
  }

  if (error instanceof Error) {
    return {
      status: 'expired',
      role,
      message: error.message,
    };
  }

  return {
    status: 'expired',
    role,
    message: String(error),
  };
}
