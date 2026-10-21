import { describe, expect, it } from 'vitest';
import {
  createAnonymousTwitchChatClient,
  createTwitchChatClient,
  normalizeTwitchChannel,
  parseTwitchIrcLine,
  parseTwitchPrivmsg,
  twitchIdentityFromChatMessage,
  type TwitchChatMessage,
  type TwitchWebSocketConstructor,
} from './twitchChatService';

class FakeWebSocket {
  static instances: FakeWebSocket[] = [];

  onclose: ((event: CloseEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onopen: ((event: Event) => void) | null = null;
  readonly sent: string[] = [];
  readonly url: string;

  constructor(url: string) {
    this.url = url;
    FakeWebSocket.instances.push(this);
  }

  close(): void {
    this.onclose?.({} as CloseEvent);
  }

  send(data: string): void {
    this.sent.push(data);
  }

  emitOpen(): void {
    this.onopen?.({} as Event);
  }

  emitMessage(data: string): void {
    this.onmessage?.({ data } as MessageEvent);
  }
}

function createManualTimers() {
  const scheduled: { handler: () => void; timeout: number }[] = [];

  return {
    scheduled,
    timers: {
      setTimeout(handler: () => void, timeout: number): number {
        const entry = {
          handler: () => {
            const index = scheduled.indexOf(entry);
            if (index >= 0) {
              scheduled.splice(index, 1);
            }
            handler();
          },
          timeout,
        };
        scheduled.push(entry);
        return scheduled.length;
      },
      clearTimeout(handle: unknown): void {
        const index = Number(handle) - 1;
        if (scheduled[index]) {
          scheduled.splice(index, 1);
        }
      },
    },
  };
}

describe('twitch chat service', () => {
  it('normalizes channel inputs', () => {
    expect(normalizeTwitchChannel(' #FrogWord ')).toBe('frogword');
    expect(normalizeTwitchChannel('@Broadcaster_42')).toBe('broadcaster_42');
    expect(normalizeTwitchChannel('https://www.twitch.tv/Aumphaadr')).toBe('aumphaadr');
    expect(normalizeTwitchChannel('not valid')).toBe('');
  });

  it('parses tagged Twitch PRIVMSG lines', () => {
    const message = parseTwitchPrivmsg(
      '@badge-info=;badges=;color=#1E90FF;display-name=Viewer\\sName;user-id=42'
      + ' :viewer!viewer@viewer.tmi.twitch.tv PRIVMSG #frogword :!играть',
    );

    expect(message).toMatchObject({
      channel: 'frogword',
      login: 'viewer',
      displayName: 'Viewer Name',
      userId: '42',
      color: '#1E90FF',
      text: '!играть',
    });
    expect(twitchIdentityFromChatMessage(message as TwitchChatMessage)).toEqual({
      provider: 'twitch',
      providerUserId: '42',
      login: 'viewer',
      displayName: 'Viewer Name',
      color: '#1E90FF',
    });
  });

  it('parses non-message IRC lines without treating them as chat', () => {
    expect(parseTwitchIrcLine('PING :tmi.twitch.tv')).toMatchObject({
      command: 'PING',
      trailing: 'tmi.twitch.tv',
    });
    expect(parseTwitchPrivmsg(':tmi.twitch.tv 001 bot :Welcome, GLHF!')).toBeUndefined();
  });

  it('sends IRC handshake, replies to PING and emits chat messages', () => {
    FakeWebSocket.instances = [];
    const messages: TwitchChatMessage[] = [];
    const statuses: string[] = [];
    const client = createTwitchChatClient({
      accessToken: 'oauth:reader-token',
      login: 'BotAccount',
      channel: '#FrogWord',
      WebSocketCtor: FakeWebSocket as unknown as TwitchWebSocketConstructor,
      onMessage: (message) => messages.push(message),
      onStatus: (event) => statuses.push(event.status),
    });

    client.connect();
    const socket = FakeWebSocket.instances[0]!;
    expect(socket.url).toBe('wss://irc-ws.chat.twitch.tv:443');

    socket.emitOpen();
    expect(socket.sent).toEqual([
      'CAP REQ :twitch.tv/tags twitch.tv/commands',
      'PASS oauth:reader-token',
      'NICK botaccount',
      'JOIN #frogword',
    ]);

    socket.emitMessage(
      'PING :tmi.twitch.tv\r\n'
      + '@display-name=Viewer;user-id=7 :viewer!viewer@viewer.tmi.twitch.tv PRIVMSG #frogword :!играть\r\n',
    );

    expect(socket.sent.at(-1)).toBe('PONG :tmi.twitch.tv');
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({
      channel: 'frogword',
      login: 'viewer',
      displayName: 'Viewer',
      userId: '7',
      text: '!играть',
    });
    expect(statuses).toEqual(['connecting', 'connected']);
  });

  it('connects anonymously without OAuth for read-only public chat', () => {
    FakeWebSocket.instances = [];
    const messages: TwitchChatMessage[] = [];
    const client = createAnonymousTwitchChatClient({
      channel: 'frogword',
      login: 'justinfan12345',
      WebSocketCtor: FakeWebSocket as unknown as TwitchWebSocketConstructor,
      onMessage: (message) => messages.push(message),
    });

    client.connect();
    const socket = FakeWebSocket.instances[0]!;
    socket.emitOpen();

    expect(socket.sent).toEqual([
      'CAP REQ :twitch.tv/tags twitch.tv/commands',
      'NICK justinfan12345',
      'JOIN #frogword',
    ]);
    expect(socket.sent.some((line) => line.startsWith('PASS '))).toBe(false);

    socket.emitMessage(
      '@display-name=Viewer;user-id=7 :viewer!viewer@viewer.tmi.twitch.tv PRIVMSG #frogword :!играть\r\n',
    );

    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({
      channel: 'frogword',
      displayName: 'Viewer',
      text: '!играть',
    });
  });

  it('reconnects after unexpected close and stops reconnecting after manual disconnect', () => {
    FakeWebSocket.instances = [];
    const timerHarness = createManualTimers();
    const statuses: string[] = [];
    const client = createTwitchChatClient({
      accessToken: 'reader-token',
      login: 'streamer',
      channel: 'streamer',
      WebSocketCtor: FakeWebSocket as unknown as TwitchWebSocketConstructor,
      timers: timerHarness.timers,
      reconnect: { delaysMs: [25, 50] },
      onMessage: () => {},
      onStatus: (event) => statuses.push(event.status),
    });

    client.connect();
    FakeWebSocket.instances[0]!.emitOpen();
    FakeWebSocket.instances[0]!.close();

    expect(statuses).toEqual(['connecting', 'connected', 'reconnecting']);
    expect(timerHarness.scheduled).toHaveLength(1);
    expect(timerHarness.scheduled[0]?.timeout).toBe(25);

    timerHarness.scheduled[0]?.handler();
    expect(FakeWebSocket.instances).toHaveLength(2);
    expect(statuses.at(-1)).toBe('reconnecting');

    FakeWebSocket.instances[1]!.emitOpen();
    client.disconnect();

    expect(statuses.at(-1)).toBe('disconnected');
    expect(timerHarness.scheduled).toHaveLength(0);
  });
});
