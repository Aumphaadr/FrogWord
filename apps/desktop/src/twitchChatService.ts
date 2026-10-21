import type { PlayerIdentity } from '@frogword/core';

export interface TwitchChatMessage {
  channel: string;
  login: string;
  displayName: string;
  userId?: string;
  color?: string;
  text: string;
  raw: string;
  tags: Record<string, string>;
}

export interface TwitchIrcMessage {
  raw: string;
  tags: Record<string, string>;
  prefix?: string;
  command: string;
  params: string[];
  trailing?: string;
}

export type TwitchChatStatusEvent =
  | { status: 'connecting'; channel: string }
  | { status: 'connected'; channel: string; message?: string }
  | { status: 'reconnecting'; channel: string; attempt: number; delayMs: number; message: string }
  | { status: 'disconnected'; channel?: string; message?: string }
  | { status: 'error'; channel?: string; message: string };

export interface TwitchChatClientOptions {
  accessToken: string;
  login: string;
  channel: string;
  onMessage: (message: TwitchChatMessage) => void;
  onStatus?: (event: TwitchChatStatusEvent) => void;
  reconnect?: TwitchChatReconnectOptions;
  WebSocketCtor?: TwitchWebSocketConstructor;
  timers?: TwitchChatTimers;
}

export interface AnonymousTwitchChatClientOptions {
  channel: string;
  onMessage: (message: TwitchChatMessage) => void;
  onStatus?: (event: TwitchChatStatusEvent) => void;
  reconnect?: TwitchChatReconnectOptions;
  WebSocketCtor?: TwitchWebSocketConstructor;
  timers?: TwitchChatTimers;
  login?: string;
}

export interface TwitchChatReconnectOptions {
  enabled?: boolean;
  delaysMs?: readonly number[];
}

export interface TwitchChatTimers {
  setTimeout: (handler: () => void, timeout: number) => unknown;
  clearTimeout: (handle: unknown) => void;
}

export interface TwitchChatClient {
  connect: () => void;
  disconnect: () => void;
  sendRaw: (line: string) => void;
}

export interface TwitchWebSocketLike {
  onclose: ((event: CloseEvent) => void) | null;
  onerror: ((event: Event) => void) | null;
  onmessage: ((event: MessageEvent) => void) | null;
  onopen: ((event: Event) => void) | null;
  close: (code?: number, reason?: string) => void;
  send: (data: string) => void;
}

export type TwitchWebSocketConstructor = new (url: string) => TwitchWebSocketLike;

const TWITCH_IRC_WS_URL = 'wss://irc-ws.chat.twitch.tv:443';
const TWITCH_CAPABILITIES = 'twitch.tv/tags twitch.tv/commands';
const TWITCH_CHANNEL_PATTERN = /^[a-z0-9_]{3,25}$/;
const DEFAULT_RECONNECT_DELAYS_MS = [1000, 2000, 5000, 10000, 30000] as const;

export function createTwitchChatClient(options: TwitchChatClientOptions): TwitchChatClient {
  const login = normalizeTwitchLogin(options.login);
  if (!login) {
    throw new Error('Twitch reader login is required');
  }

  const accessToken = stripOAuthPrefix(options.accessToken.trim());
  if (!accessToken) {
    throw new Error('Twitch access token is required');
  }

  return createTwitchIrcClient({
    ...options,
    credentials: {
      kind: 'oauth',
      login,
      accessToken,
    },
  });
}

export function createAnonymousTwitchChatClient(options: AnonymousTwitchChatClientOptions): TwitchChatClient {
  const login = normalizeTwitchLogin(options.login ?? createAnonymousTwitchLogin());
  if (!login) {
    throw new Error('Twitch anonymous login is required');
  }

  return createTwitchIrcClient({
    ...options,
    credentials: {
      kind: 'anonymous',
      login,
    },
  });
}

function createTwitchIrcClient(options: (TwitchChatClientOptions | AnonymousTwitchChatClientOptions) & {
  credentials:
    | { kind: 'oauth'; login: string; accessToken: string }
    | { kind: 'anonymous'; login: string };
}): TwitchChatClient {
  const channel = normalizeTwitchChannel(options.channel);
  if (!channel) {
    throw new Error('Twitch channel login is required');
  }

  const WebSocketCtor = options.WebSocketCtor ?? globalThis.WebSocket;
  if (!WebSocketCtor) {
    throw new Error('WebSocket is not available in this environment');
  }

  let socket: TwitchWebSocketLike | undefined;
  let disconnectedByUser = false;
  let reconnectAttempt = 0;
  let reconnectTimeout: unknown;
  const reconnectEnabled = options.reconnect?.enabled ?? true;
  const reconnectDelays = options.reconnect?.delaysMs?.length
    ? [...options.reconnect.delaysMs]
    : [...DEFAULT_RECONNECT_DELAYS_MS];
  const timers = options.timers ?? {
    setTimeout: (handler, timeout) => globalThis.setTimeout(handler, timeout),
    clearTimeout: (handle) => globalThis.clearTimeout(handle as ReturnType<typeof globalThis.setTimeout>),
  };

  function sendRaw(line: string): void {
    socket?.send(line);
  }

  function connect(): void {
    disconnectedByUser = false;
    clearReconnectTimer();
    reconnectAttempt = 0;
    openSocket('manual');
  }

  function openSocket(mode: 'manual' | 'reconnect'): void {
    options.onStatus?.(mode === 'reconnect'
      ? {
        status: 'reconnecting',
        channel,
        attempt: reconnectAttempt,
        delayMs: 0,
        message: 'Reconnecting now',
      }
      : { status: 'connecting', channel });
    socket = new WebSocketCtor(TWITCH_IRC_WS_URL);

    socket.onopen = () => {
      reconnectAttempt = 0;
      sendRaw(`CAP REQ :${TWITCH_CAPABILITIES}`);
      if (options.credentials.kind === 'oauth') {
        sendRaw(`PASS oauth:${options.credentials.accessToken}`);
      }
      sendRaw(`NICK ${options.credentials.login}`);
      sendRaw(`JOIN #${channel}`);
      options.onStatus?.({ status: 'connected', channel, message: 'Socket opened' });
    };

    socket.onmessage = (event) => {
      handleSocketPayload(String(event.data ?? ''), sendRaw, options.onMessage, options.onStatus);
    };

    socket.onerror = () => {
      options.onStatus?.({ status: 'error', channel, message: 'Twitch chat socket error' });
    };

    socket.onclose = () => {
      socket = undefined;
      if (!disconnectedByUser && reconnectEnabled) {
        scheduleReconnect('Twitch chat socket closed');
        return;
      }

      options.onStatus?.({
        status: 'disconnected',
        channel,
        message: disconnectedByUser ? 'Disconnected by host' : 'Twitch chat socket closed',
      });
    };
  }

  function disconnect(): void {
    disconnectedByUser = true;
    clearReconnectTimer();
    socket?.close(1000, 'host disconnect');
    socket = undefined;
  }

  function scheduleReconnect(message: string): void {
    reconnectAttempt += 1;
    const delayMs = reconnectDelays[Math.min(reconnectAttempt - 1, reconnectDelays.length - 1)] ?? 30000;
    options.onStatus?.({
      status: 'reconnecting',
      channel,
      attempt: reconnectAttempt,
      delayMs,
      message,
    });
    clearReconnectTimer();
    reconnectTimeout = timers.setTimeout(() => {
      reconnectTimeout = undefined;
      if (!disconnectedByUser) {
        openSocket('reconnect');
      }
    }, delayMs);
  }

  function clearReconnectTimer(): void {
    if (reconnectTimeout !== undefined) {
      timers.clearTimeout(reconnectTimeout);
      reconnectTimeout = undefined;
    }
  }

  return {
    connect,
    disconnect,
    sendRaw,
  };
}

function createAnonymousTwitchLogin(): string {
  return `justinfan${Math.floor(Math.random() * 90000) + 10000}`;
}

export function normalizeTwitchChannel(value: string): string {
  const trimmed = value.trim();
  const urlMatch = /(?:https?:\/\/)?(?:www\.)?twitch\.tv\/([a-z0-9_]+)/i.exec(trimmed);
  const candidate = (urlMatch?.[1] ?? trimmed)
    .replace(/^[@#]+/, '')
    .trim()
    .toLocaleLowerCase();

  return TWITCH_CHANNEL_PATTERN.test(candidate) ? candidate : '';
}

export function twitchIdentityFromChatMessage(message: TwitchChatMessage): PlayerIdentity {
  return {
    provider: 'twitch',
    providerUserId: message.userId ?? message.login,
    login: message.login,
    displayName: message.displayName,
    ...(message.color ? { color: message.color } : {}),
  };
}

export function parseTwitchPrivmsg(line: string): TwitchChatMessage | undefined {
  const parsed = parseTwitchIrcLine(line);
  if (!parsed || parsed.command !== 'PRIVMSG') {
    return undefined;
  }

  const channel = normalizeTwitchChannel(parsed.params[0] ?? '');
  const text = parsed.trailing ?? '';
  const login = normalizeTwitchLogin(extractLoginFromPrefix(parsed.prefix ?? ''));
  if (!channel || !text || !login) {
    return undefined;
  }

  const displayName = parsed.tags['display-name'] || login;
  const userId = parsed.tags['user-id'];
  const color = normalizeTwitchColor(parsed.tags.color);

  return {
    channel,
    login,
    displayName,
    ...(userId ? { userId } : {}),
    ...(color ? { color } : {}),
    text,
    raw: line,
    tags: parsed.tags,
  };
}

export function parseTwitchIrcLine(line: string): TwitchIrcMessage | undefined {
  const raw = line.replace(/\r?\n$/u, '');
  let rest = raw.trim();
  if (!rest) {
    return undefined;
  }

  let tags: Record<string, string> = {};
  let prefix: string | undefined;

  if (rest.startsWith('@')) {
    const tagEnd = rest.indexOf(' ');
    if (tagEnd < 0) {
      return undefined;
    }
    tags = parseTwitchTags(rest.slice(1, tagEnd));
    rest = rest.slice(tagEnd + 1).trimStart();
  }

  if (rest.startsWith(':')) {
    const prefixEnd = rest.indexOf(' ');
    if (prefixEnd < 0) {
      return undefined;
    }
    prefix = rest.slice(1, prefixEnd);
    rest = rest.slice(prefixEnd + 1).trimStart();
  }

  let trailing: string | undefined;
  const trailingIndex = rest.indexOf(' :');
  if (trailingIndex >= 0) {
    trailing = rest.slice(trailingIndex + 2);
    rest = rest.slice(0, trailingIndex).trimEnd();
  }

  const parts = rest.split(/\s+/u).filter(Boolean);
  const command = parts.shift();
  if (!command) {
    return undefined;
  }

  return {
    raw,
    tags,
    ...(prefix ? { prefix } : {}),
    command,
    params: parts,
    ...(trailing !== undefined ? { trailing } : {}),
  };
}

function handleSocketPayload(
  payload: string,
  sendRaw: (line: string) => void,
  onMessage: (message: TwitchChatMessage) => void,
  onStatus: ((event: TwitchChatStatusEvent) => void) | undefined,
): void {
  const lines = payload.split(/\r\n|\n/u).filter(Boolean);
  for (const line of lines) {
    if (line.startsWith('PING ')) {
      sendRaw(`PONG ${line.slice('PING '.length)}`);
      continue;
    }

    const parsed = parseTwitchIrcLine(line);
    if (!parsed) {
      continue;
    }

    if (parsed.command === 'NOTICE' && parsed.trailing) {
      onStatus?.({ status: 'error', message: parsed.trailing });
      continue;
    }

    const message = parseTwitchPrivmsg(line);
    if (message) {
      onMessage(message);
    }
  }
}

function parseTwitchTags(input: string): Record<string, string> {
  const tags: Record<string, string> = {};
  for (const entry of input.split(';')) {
    const separator = entry.indexOf('=');
    if (separator < 0) {
      tags[entry] = '';
      continue;
    }
    tags[entry.slice(0, separator)] = unescapeTwitchTag(entry.slice(separator + 1));
  }
  return tags;
}

function unescapeTwitchTag(value: string): string {
  return value.replace(/\\([s:\\rn])/gu, (_, token: string) => {
    switch (token) {
      case 's':
        return ' ';
      case ':':
        return ';';
      case '\\':
        return '\\';
      case 'r':
        return '\r';
      case 'n':
        return '\n';
      default:
        return token;
    }
  });
}

function normalizeTwitchLogin(value: string): string {
  const login = value.trim().toLocaleLowerCase();
  return TWITCH_CHANNEL_PATTERN.test(login) ? login : '';
}

function extractLoginFromPrefix(prefix: string): string {
  return prefix.split('!', 1)[0] ?? '';
}

function normalizeTwitchColor(value: string | undefined): string | undefined {
  return value && /^#[0-9a-f]{6}$/iu.test(value) ? value : undefined;
}

function stripOAuthPrefix(value: string): string {
  return value.replace(/^oauth:/iu, '');
}
