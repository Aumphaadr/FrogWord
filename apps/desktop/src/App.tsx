import { useEffect, useMemo, useRef, useState, type CSSProperties, type Dispatch, type RefObject, type SetStateAction } from 'react';
import {
  applyCommand,
  applyHostAction,
  approveRejectedSubmission,
  createAdminGameProjection,
  createPublicGameProjection,
  createRectTemplate,
  createRouteAwareBoard,
  createRound,
  createRng,
  createThemesFromThemeBank,
  parseChatCommand,
  playerIdFromIdentity,
  type ApplyResult,
  type AdminBlockedPlayer,
  type DomainEvent,
  type Coord,
  type PlayerId,
  type PlayerIdentity,
  type PublicGameProjection,
  type RoundState,
  type Theme,
} from '@frogword/core';
import {
  loadFallbackSnapshotPayload,
  publishRendererSnapshot,
  requestRendererSnapshot,
  subscribeRendererSnapshotRequests,
  subscribeRendererSnapshots,
} from './stateBridge';
import { Icon, type IconName } from './Icon.js';
import { FrogMascot } from './mascot/FrogMascot.js';
import {
  createLocalRoundService,
  LOCAL_ROUND_ID,
  type LocalRoundHydrationResult,
} from './localRoundService';
import {
  ThemeBankImportError,
  importThemeBank,
  previewThemeBankImport,
  type ThemeBankImportPreview,
} from './themeBankImportService';
import {
  createStarterThemeCatalogEntries,
  loadDesktopThemeCatalog,
  type ThemeCatalogEntry,
} from './themeCatalogService';
import {
  DEFAULT_NEW_ROUND_FORM,
  MAX_BOARD_HEIGHT,
  MAX_BOARD_WIDTH,
  MIN_BOARD_HEIGHT,
  MIN_BOARD_WIDTH,
  createDefaultLocalRound,
  createRoundFromNewRoundForm,
  newRoundFormFromRound,
  updateNewRoundForm,
} from './newRoundService';
import {
  AUDIT_LOG_FILTERS,
  createDomainAuditEntries,
  createSystemAuditEntry,
  filterAuditEntries,
  summarizeDomainEvent,
  type AuditLogEntry,
  type AuditLogFilter,
  type AuditLogSource,
  type AuditLogTone,
} from './auditLogService';
import {
  TWITCH_AUTH_ROLES,
  TwitchAuthError,
  pollTwitchDeviceToken,
  requestTwitchDeviceAuthorization,
  twitchAuthClipboardText,
  type TwitchAuthRole,
  type TwitchDeviceAuthorization,
  type TwitchTokenSet,
  type TwitchValidatedToken,
  validateTwitchToken,
} from './twitchAuthService';
import {
  createAnonymousTwitchChatClient,
  createTwitchChatClient,
  normalizeTwitchChannel,
  twitchIdentityFromChatMessage,
  type TwitchChatClient,
  type TwitchChatMessage,
  type TwitchChatStatusEvent,
} from './twitchChatService';
import {
  loadStoredTwitchAuthVault,
  saveStoredTwitchAuthRole,
  type StoredTwitchAuthRole,
} from './twitchTokenVault';
import { maintainStoredTwitchAuthRole, type TwitchAuthSessionResult } from './twitchAuthSessionService';

const PUBLIC_ROUTE_TOKEN = 'game-view';
const WEB_PLAY_ROUTE_TOKEN = 'web-play';
const MAX_NOTIFICATIONS = 6;
const MAX_PUBLIC_NOTIFICATIONS = 3;
const MAX_WEB_CHAT_ENTRIES = 8;
const MAX_AUDIT_ENTRIES = 120;
const MAX_SAFE_RAW_LENGTH = 24;
const TWITCH_AUTH_MAINTENANCE_INTERVAL_MS = 60 * 60 * 1000;
const WEB_THEME_BANK_URL = `${import.meta.env.BASE_URL}theme-bank/main.json`;
const WEB_SETTINGS_STORAGE_KEY = 'frogword:web-play:v1';
const WEB_BLOCKLIST_STORAGE_KEY = 'frogword:web-blocklist:v1';
const IS_PAGES_BUILD = import.meta.env.VITE_FROGWORD_TARGET === 'pages';
const WEB_DEFAULT_BOARD_WIDTH = 25;
const WEB_DEFAULT_BOARD_HEIGHT = 15;
const WEB_MIN_BOARD_WIDTH = 8;
const WEB_MIN_BOARD_HEIGHT = 8;
const WEB_MAX_BOARD_WIDTH = 60;
const WEB_MAX_BOARD_HEIGHT = 40;
const WEB_PLAYER_MARKER_LABEL_LENGTH = 2;
const WEB_MARKER_STEP_MS = 280;
const WEB_MARKER_ANIMATION_SETTLE_MS = 90;
const WEB_LANGUAGES = ['ru', 'en'] as const;
const WEB_RANDOM_THEME_ID = '__random__';
const SAFE_GAMEPLAY_COMMAND_TOKENS = new Set([
  'play',
  'играть',
  'word',
  'слово',
  'reset',
  'сброс',
  'quit',
  'уйти',
  'frogword',
  'фрогворд',
]);

const nowIso = () => new Date().toISOString();
const localRoundService = createLocalRoundService({ now: nowIso });

const demoPlayers: PlayerIdentity[] = [
  {
    provider: 'fake',
    providerUserId: 'mortikon',
    login: 'mortikon',
    displayName: 'Mortikon',
    color: '#2c9f6f',
  },
  {
    provider: 'fake',
    providerUserId: 'eugene',
    login: 'eugene',
    displayName: 'Eugene_80286',
    color: '#d08a2e',
  },
  {
    provider: 'fake',
    providerUserId: 'krya',
    login: 'kryapatcher',
    displayName: 'KryaPatcher',
    color: '#4f82c9',
  },
];

const quickCommands: Array<{ label: string; command: string; icon: IconName }> = [
  { label: 'Join', command: '!играть', icon: 'log-in' },
  { label: 'Right', command: '!п1', icon: 'flag' },
  { label: 'Left', command: '!л1', icon: 'flag' },
  { label: 'Down', command: '!н1', icon: 'flag' },
  { label: 'Word', command: '!слово', icon: 'check' },
  { label: 'Reset', command: '!сброс', icon: 'rotate-ccw' },
];

interface ChatEntry {
  id: string;
  playerId: PlayerId;
  displayName: string;
  text: string;
  createdAt: string;
  source: 'fake' | 'twitch';
  channel?: string;
  events: string[];
}

type GameNotificationKind = 'error' | 'warning';

interface GameNotification {
  id: string;
  kind: GameNotificationKind;
  visibility: 'public' | 'host';
  title: string;
  message: string;
  createdAt: string;
  playerId?: PlayerId;
  raw?: string;
}

interface RendererSnapshot {
  version: 1;
  round: RoundState;
  notifications: GameNotification[];
}

type ThemeBankImportState =
  | { status: 'idle' }
  | { status: 'ready'; fileName: string; rawJson: string; preview: ThemeBankImportPreview }
  | { status: 'importing'; fileName: string; rawJson: string; preview: ThemeBankImportPreview }
  | { status: 'imported'; fileName: string; preview: ThemeBankImportPreview }
  | { status: 'error'; fileName?: string; issues: readonly string[] };

type TwitchAuthRoleState =
  | { status: 'idle' }
  | { status: 'requesting' }
  | { status: 'device'; device: TwitchDeviceAuthorization; copiedAt?: string; message?: string }
  | { status: 'checking'; device: TwitchDeviceAuthorization }
  | { status: 'authorized'; token: TwitchTokenSet; validation?: TwitchValidatedToken }
  | { status: 'error'; message: string; code?: string; device?: TwitchDeviceAuthorization };

type TwitchAuthStates = Record<TwitchAuthRole, TwitchAuthRoleState>;
type AuthorizedTwitchAuthRoleState = Extract<TwitchAuthRoleState, { status: 'authorized' }>;

const INITIAL_TWITCH_AUTH_STATES: TwitchAuthStates = {
  chatReader: { status: 'idle' },
  chatSender: { status: 'idle' },
};

type TwitchChatUiState =
  | { status: 'idle' }
  | { status: 'connecting'; channel: string }
  | { status: 'reconnecting'; channel: string; attempt: number; delayMs: number; message: string }
  | {
    status: 'connected';
    channel: string;
    connectedAt: string;
    message?: string;
    lastMessageAt?: string;
    lastMessageFrom?: string;
  }
  | { status: 'disconnected'; channel?: string; message?: string }
  | { status: 'error'; channel?: string; message: string };

type StartupRoundChoiceState =
  | { status: 'checking' }
  | { status: 'none' }
  | { status: 'choosing'; hydration: LocalRoundHydrationResult }
  | { status: 'applying'; choice: 'continue' | 'new'; hydration?: LocalRoundHydrationResult };

export function App() {
  if (IS_PAGES_BUILD || isAnonymousWebPlayRoute()) {
    return <AnonymousWebGameApp />;
  }

  if (isPublicGameViewRoute()) {
    return <PublicGameWindow />;
  }

  return <HostControlApp />;
}

function HostControlApp() {
  const [round, setRound] = useState(() => createDefaultLocalRound(LOCAL_ROUND_ID));
  const [newRoundForm, setNewRoundForm] = useState(DEFAULT_NEW_ROUND_FORM);
  const [selectedPlayerId, setSelectedPlayerId] = useState(playerIdFromIdentity(demoPlayers[0]!));
  const [draftMessage, setDraftMessage] = useState('!играть');
  const [chatEntries, setChatEntries] = useState<ChatEntry[]>([]);
  const [eventEntries, setEventEntries] = useState<string[]>([]);
  const [auditEntries, setAuditEntries] = useState<AuditLogEntry[]>([]);
  const [auditFilter, setAuditFilter] = useState<AuditLogFilter>('all');
  const [notifications, setNotifications] = useState<GameNotification[]>([]);
  const [twitchClientId, setTwitchClientId] = useState('');
  const [twitchAuthStates, setTwitchAuthStates] = useState<TwitchAuthStates>(INITIAL_TWITCH_AUTH_STATES);
  const [twitchChannel, setTwitchChannel] = useState('');
  const [twitchChatState, setTwitchChatState] = useState<TwitchChatUiState>({ status: 'idle' });
  const [themeCatalog, setThemeCatalog] = useState<ThemeCatalogEntry[]>(createStarterThemeCatalogEntries);
  const [themeBankImportState, setThemeBankImportState] = useState<ThemeBankImportState>({ status: 'idle' });
  const [startupRoundChoice, setStartupRoundChoice] = useState<StartupRoundChoiceState>({ status: 'checking' });
  const roundRef = useRef(round);
  const startupChoicePendingRef = useRef(false);
  const twitchAuthStatesRef = useRef(twitchAuthStates);
  const twitchClientIdRef = useRef(twitchClientId);
  const twitchChatClientRef = useRef<TwitchChatClient | undefined>(undefined);
  const themeBankInputRef = useRef<HTMLInputElement>(null);
  const storageErrorShownRef = useRef(false);
  roundRef.current = round;
  twitchAuthStatesRef.current = twitchAuthStates;
  twitchClientIdRef.current = twitchClientId;

  const selectedPlayer = demoPlayers.find((player) => playerIdFromIdentity(player) === selectedPlayerId)
    ?? demoPlayers[0]!;
  const selectedThemeEntry = themeCatalog.find((theme) => theme.id === newRoundForm.themeId);
  const selectedThemeWordCount = selectedThemeEntry?.wordCount
    ?? (round.theme.id === newRoundForm.themeId ? round.theme.words.length : 0);
  const adminProjection = useMemo(() => createAdminGameProjection(round, { locale: 'ru' }), [round]);
  const publicSnapshot = useMemo(
    () => createRendererSnapshot(round, publicNotificationsForGameView(notifications)),
    [round, notifications],
  );
  const latestSnapshotRef = useRef(publicSnapshot);
  latestSnapshotRef.current = publicSnapshot;

  function appendAuditEntries(entries: readonly AuditLogEntry[]): void {
    if (entries.length === 0) {
      return;
    }

    setAuditEntries((current) => [...entries, ...current].slice(0, MAX_AUDIT_ENTRIES));
  }

  function appendSystemAudit(input: {
    title: string;
    detail?: string;
    source: AuditLogSource;
    tone?: AuditLogTone;
    chips?: readonly string[];
  }): void {
    appendAuditEntries([
      createSystemAuditEntry({
        id: `system:${input.source}:${Date.now()}:${Math.random().toString(36).slice(2)}`,
        occurredAt: nowIso(),
        source: input.source,
        title: input.title,
        ...(input.detail ? { detail: input.detail } : {}),
        ...(input.tone ? { tone: input.tone } : {}),
        ...(input.chips ? { chips: input.chips } : {}),
      }),
    ]);
  }

  function refreshThemeCatalog(logMessage?: string, isDisposed: () => boolean = () => false): void {
    void loadDesktopThemeCatalog()
      .then((catalog) => {
        if (isDisposed()) {
          return;
        }

        setThemeCatalog(catalog.entries);
        const message = logMessage
          ?? (catalog.storageAvailable && catalog.storedCount > 0
            ? `Theme catalog loaded: ${catalog.entries.length} themes, ${catalog.storedCount} from SQLite`
            : undefined);
        if (message) {
          setEventEntries((current) => [message, ...current].slice(0, 24));
          appendSystemAudit({
            title: 'Theme catalog',
            detail: message,
            source: 'theme-bank',
            chips: [`${catalog.entries.length} themes`],
          });
        }
      })
      .catch((error: unknown) => {
        if (isDisposed()) {
          return;
        }

        reportStorageError('theme catalog', error);
      });
  }

  useEffect(() => {
    let cleanup: (() => void) | undefined;
    let disposed = false;

    void subscribeRendererSnapshotRequests(() => {
      void publishRendererSnapshot(latestSnapshotRef.current);
    }).then((unsubscribe) => {
      if (disposed) {
        unsubscribe();
        return;
      }

      cleanup = unsubscribe;
    });

    return () => {
      disposed = true;
      cleanup?.();
    };
  }, []);

  useEffect(() => {
    return () => {
      twitchChatClientRef.current?.disconnect();
      twitchChatClientRef.current = undefined;
    };
  }, []);

  useEffect(() => {
    let disposed = false;

    void restoreStoredTwitchAuth(() => disposed);

    return () => {
      disposed = true;
    };
  }, []);

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      void maintainActiveTwitchAuthSessions();
    }, TWITCH_AUTH_MAINTENANCE_INTERVAL_MS);

    return () => {
      window.clearInterval(intervalId);
    };
  }, []);

  useEffect(() => {
    void publishRendererSnapshot(publicSnapshot);
  }, [publicSnapshot]);

  useEffect(() => {
    let disposed = false;

    refreshThemeCatalog(undefined, () => disposed);

    return () => {
      disposed = true;
    };
  }, []);

  useEffect(() => {
    let disposed = false;

    void localRoundService.hydrate(() => roundRef.current)
      .then((result) => {
        if (disposed) {
          return;
        }

        if (result.pendingStoredRound) {
          startupChoicePendingRef.current = true;
          setStartupRoundChoice({ status: 'choosing', hydration: result });
        } else {
          startupChoicePendingRef.current = false;
          setStartupRoundChoice({ status: 'none' });
        }

        if (result.logEntries.length > 0) {
          setEventEntries((current) => [...result.logEntries, ...current].slice(0, 24));
          appendAuditEntries(result.logEntries.map((entry, index) => createSystemAuditEntry({
            id: `startup:${index}:${Date.now()}`,
            occurredAt: nowIso(),
            source: 'storage',
            title: 'Storage',
            detail: entry,
            chips: ['startup'],
          })));
        }
      })
      .catch((error: unknown) => {
        if (disposed) {
          return;
        }

        startupChoicePendingRef.current = false;
        setStartupRoundChoice({ status: 'none' });
        reportStorageError('startup', error);
      });

    return () => {
      disposed = true;
    };
  }, []);

  function commitResult(result: ApplyResult, label: string): void {
    setRound(result.state);
    const summaries = result.events.map((event) => summarizeDomainEvent(result.state, event));
    setEventEntries((current) => [...summaries, ...current].slice(0, 24));
    appendAuditEntries(createDomainAuditEntries(result.state, result.events, 'host', nowIso()));

    if (summaries.length === 0) {
      setEventEntries((current) => [`${label}: no domain events`, ...current].slice(0, 24));
      appendSystemAudit({
        title: label,
        detail: 'No domain events',
        source: 'host',
      });
    }

    appendNotifications(result.state, result.events, setNotifications);
    persistRoundSnapshot(result.state, result.events);
  }

  function continueStoredRound(hydration: LocalRoundHydrationResult): void {
    const stored = hydration.pendingStoredRound;
    if (!stored) {
      startupChoicePendingRef.current = false;
      setStartupRoundChoice({ status: 'none' });
      return;
    }

    setStartupRoundChoice({ status: 'applying', choice: 'continue', hydration });
    startupChoicePendingRef.current = false;
    roundRef.current = stored.state;
    setRound(stored.state);
    setNewRoundForm(newRoundFormFromRound(stored.state));
    setChatEntries([]);
    setNotifications([]);
    setEventEntries((current) => [
      `Continued saved local round: ${formatStorageTime(stored.savedAt)}`,
      ...current,
    ].slice(0, 24));
    appendSystemAudit({
      title: 'Continued saved round',
      detail: stored.state.theme.title,
      source: 'storage',
      tone: 'success',
      chips: [
        `${Object.keys(stored.state.players).length} players`,
        `${stored.state.foundWords.length} words`,
      ],
    });
    appendRestoredRoundAuditEntries(hydration, stored.state);
    setStartupRoundChoice({ status: 'none' });
  }

  function startFreshRoundOverStored(hydration: LocalRoundHydrationResult): void {
    setStartupRoundChoice({ status: 'applying', choice: 'new', hydration });
    startupChoicePendingRef.current = false;
    setChatEntries([]);
    setEventEntries((current) => ['Started fresh local round', ...current].slice(0, 24));
    appendSystemAudit({
      title: 'Started fresh round',
      detail: roundRef.current.theme.title,
      source: 'storage',
      tone: 'success',
      chips: [
        `${roundRef.current.board.width}x${roundRef.current.board.height}`,
        roundRef.current.theme.language.toUpperCase(),
      ],
    });

    const replaceResult = localRoundService.replaceWithCurrent(roundRef.current);
    if (replaceResult) {
      void replaceResult
        .then(() => {
          setStartupRoundChoice({ status: 'none' });
        })
        .catch((error: unknown) => {
          setStartupRoundChoice({ status: 'none' });
          reportStorageError('new round startup', error);
        });
    } else {
      setStartupRoundChoice({ status: 'none' });
    }
  }

  function appendRestoredRoundAuditEntries(hydration: LocalRoundHydrationResult, restoredRound: RoundState): void {
    if (hydration.domainEvents.length === 0) {
      return;
    }

    appendAuditEntries([
      ...hydration.domainEvents.flatMap((record) => (
        createDomainAuditEntries(restoredRound, [record.event], 'storage', record.createdAt)
      )),
      createSystemAuditEntry({
        id: `startup:audit-restored:${Date.now()}`,
        occurredAt: nowIso(),
        source: 'storage',
        title: 'Audit restored',
        detail: `${hydration.domainEvents.length} saved events`,
        chips: ['startup', 'round_events'],
      }),
    ]);
  }

  function processChatMessage(input: {
    player: PlayerIdentity;
    text: string;
    receivedAt: string;
    source: 'fake' | 'twitch';
    channel?: string;
  }): void {
    const { player, receivedAt, source, text } = input;
    const trimmed = text.trim();
    if (!trimmed) {
      return;
    }

    if (startupChoicePendingRef.current) {
      appendSystemAudit({
        title: 'Chat ignored',
        detail: 'Choose Continue or New round first',
        source: 'chat',
        tone: 'warning',
        chips: [source],
      });
      return;
    }

    const activeRound = roundRef.current;
    const command = parseChatCommand(trimmed, activeRound.settings.maxMovesPerMessage);
    const result = applyCommand(activeRound, {
      player,
      command,
      receivedAt,
    });
    const summaries = result.events.map((event) => summarizeDomainEvent(result.state, event));

    roundRef.current = result.state;
    setRound(result.state);
    setChatEntries((current) => [
      {
        id: `${receivedAt}:${source}:${Math.random().toString(36).slice(2)}`,
        playerId: playerIdFromIdentity(player),
        displayName: player.displayName,
        text: trimmed,
        createdAt: receivedAt,
        source,
        ...(input.channel ? { channel: input.channel } : {}),
        events: summaries,
      },
      ...current,
    ].slice(0, 18));
    setEventEntries((current) => [
      ...(summaries.length > 0 ? summaries : [`${player.displayName}: command accepted without events`]),
      ...current,
    ].slice(0, 24));
    appendAuditEntries(createDomainAuditEntries(result.state, result.events, 'chat', receivedAt));
    if (summaries.length === 0) {
      appendSystemAudit({
        title: `${player.displayName} chat`,
        detail: 'Command accepted without events',
        source: 'chat',
      });
    }
    appendNotifications(result.state, result.events, setNotifications);
    persistRoundSnapshot(result.state, result.events);
  }

  function sendFakeChat(text: string): void {
    processChatMessage({
      player: selectedPlayer,
      text,
      receivedAt: nowIso(),
      source: 'fake',
    });
    setDraftMessage('');
  }

  function resetRound(): void {
    const result = createRoundFromNewRoundForm({
      roundId: LOCAL_ROUND_ID,
      form: newRoundForm,
      themeCatalog,
      currentRound: round,
    });
    setRound(result.round);
    setNewRoundForm(result.form);
    setChatEntries([]);
    setEventEntries(['New local round started']);
    appendSystemAudit({
      title: 'New local round',
      detail: result.round.theme.title,
      source: 'round',
      chips: [
        `${result.round.board.width}x${result.round.board.height}`,
        result.round.theme.language.toUpperCase(),
      ],
    });
    setNotifications([]);
    persistRoundSnapshot(result.round, []);
  }

  function kickPlayer(playerId: PlayerId): void {
    commitResult(
      applyHostAction(round, { kind: 'kickPlayer', playerId, actedAt: nowIso() }),
      'kick',
    );
  }

  function banPlayer(playerId: PlayerId): void {
    commitResult(
      applyHostAction(round, { kind: 'banPlayer', playerId, actedAt: nowIso(), reason: 'fake chat moderation' }),
      'ban',
    );
  }

  function unbanPlayer(playerId: PlayerId): void {
    commitResult(
      applyHostAction(round, { kind: 'unbanPlayer', playerId, actedAt: nowIso() }),
      'unban',
    );
  }

  function approvePending(rejectedId: string, expertiseTier: 1 | 2): void {
    commitResult(
      approveRejectedSubmission(round, { rejectedId, expertiseTier, actedAt: nowIso() }),
      'approve',
    );
  }

  function setTwitchRoleState(role: TwitchAuthRole, state: TwitchAuthRoleState): void {
    setTwitchAuthStates((current) => ({
      ...current,
      [role]: state,
    }));
  }

  async function restoreStoredTwitchAuth(isDisposed: () => boolean): Promise<void> {
    try {
      const vault = await loadStoredTwitchAuthVault();
      if (isDisposed() || !vault) {
        return;
      }

      const storedRoles = TWITCH_AUTH_ROLES
        .map((definition) => vault.roles[definition.role])
        .filter((role): role is StoredTwitchAuthRole => Boolean(role));
      if (storedRoles.length === 0) {
        return;
      }

      const firstClientId = storedRoles[0]?.clientId;
      if (firstClientId) {
        setTwitchClientId(firstClientId);
      }

      for (const stored of storedRoles) {
        const restored = await restoreStoredTwitchRole(stored);
        if (isDisposed()) {
          return;
        }

        setTwitchRoleState(stored.role, restored);
        if (restored.status === 'authorized') {
          appendSystemAudit({
            title: 'Twitch auth restored',
            detail: restored.validation?.login ?? roleTitle(stored.role),
            source: 'system',
            tone: 'success',
            chips: [roleTitle(stored.role)],
          });

          if (stored.role === 'chatReader' && restored.validation?.login) {
            const channel = restored.validation.login;
            setTwitchChannel(channel);
            connectTwitchChatWithReader(restored, channel, 'auto');
          }
        } else if (restored.status === 'error') {
          appendSystemAudit({
            title: 'Twitch auth restore failed',
            detail: restored.message,
            source: 'system',
            tone: 'warning',
            chips: [roleTitle(stored.role)],
          });
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (isDisposed()) {
        return;
      }

      appendSystemAudit({
        title: 'Twitch vault failed',
        detail: message,
        source: 'storage',
        tone: 'warning',
      });
    }
  }

  async function restoreStoredTwitchRole(stored: StoredTwitchAuthRole): Promise<TwitchAuthRoleState> {
    const result = await maintainStoredTwitchAuthRole(stored);
    return twitchAuthStateFromSessionResult(result, 'Stored auth expired');
  }

  async function maintainActiveTwitchAuthSessions(): Promise<void> {
    const clientId = twitchClientIdRef.current.trim();
    if (!clientId) {
      return;
    }

    for (const definition of TWITCH_AUTH_ROLES) {
      const role = definition.role;
      const state = twitchAuthStatesRef.current[role];
      if (state.status !== 'authorized') {
        continue;
      }

      const result = await maintainStoredTwitchAuthRole({
        role,
        clientId,
        token: state.token,
        ...(state.validation ? { validation: state.validation } : {}),
        savedAt: nowIso(),
      });
      applyTwitchAuthSessionResult(result);
    }
  }

  function applyTwitchAuthSessionResult(result: TwitchAuthSessionResult): void {
    if (result.status === 'valid') {
      setTwitchRoleState(result.role, {
        status: 'authorized',
        token: result.token,
        validation: result.validation,
      });
      return;
    }

    if (result.status === 'refreshed') {
      const nextState: AuthorizedTwitchAuthRoleState = {
        status: 'authorized',
        token: result.token,
        validation: result.validation,
      };
      setTwitchRoleState(result.role, nextState);
      appendSystemAudit({
        title: 'Twitch token refreshed',
        detail: result.validation.login,
        source: 'system',
        tone: 'success',
        chips: [roleTitle(result.role)],
      });

      if (result.role === 'chatReader') {
        setTwitchChannel(result.validation.login);
        connectTwitchChatWithReader(nextState, result.validation.login, 'auto');
      }
      return;
    }

    setTwitchRoleState(result.role, twitchAuthStateFromSessionResult(result, 'Stored auth expired'));
    appendSystemAudit({
      title: 'Twitch auth expired',
      detail: result.message,
      source: 'system',
      tone: 'danger',
      chips: [roleTitle(result.role)],
    });

    if (result.role === 'chatReader') {
      twitchChatClientRef.current?.disconnect();
      twitchChatClientRef.current = undefined;
      setTwitchChatState({
        status: 'error',
        message: 'Chat reader auth expired',
      });
    }
  }

  function twitchAuthStateFromSessionResult(
    result: TwitchAuthSessionResult,
    expiredPrefix: string,
  ): TwitchAuthRoleState {
    if (result.status === 'valid' || result.status === 'refreshed') {
      return {
        status: 'authorized',
        token: result.token,
        validation: result.validation,
      };
    }

    return {
      status: 'error',
      message: `${expiredPrefix}: ${result.message}`,
      ...(result.code ? { code: result.code } : {}),
    };
  }

  async function startTwitchAuth(role: TwitchAuthRole): Promise<void> {
    setTwitchRoleState(role, { status: 'requesting' });

    try {
      const device = await requestTwitchDeviceAuthorization({
        clientId: twitchClientId,
        role,
      });
      const copiedAt = await copyTextToClipboard(twitchAuthClipboardText(device))
        ? nowIso()
        : undefined;
      const nextState: TwitchAuthRoleState = copiedAt
        ? { status: 'device', device, copiedAt }
        : { status: 'device', device, message: 'Copy failed; copy the link manually' };
      setTwitchRoleState(role, nextState);
      appendSystemAudit({
        title: 'Twitch device code',
        detail: roleTitle(role),
        source: 'system',
        tone: copiedAt ? 'success' : 'warning',
        chips: [device.userCode, copiedAt ? 'copied' : 'copy failed'],
      });
    } catch (error) {
      const authError = twitchAuthErrorInfo(error);
      setTwitchRoleState(role, {
        status: 'error',
        message: authError.message,
        ...(authError.code ? { code: authError.code } : {}),
      });
      appendSystemAudit({
        title: 'Twitch auth failed',
        detail: authError.message,
        source: 'system',
        tone: 'danger',
        chips: [roleTitle(role)],
      });
    }
  }

  async function checkTwitchAuth(role: TwitchAuthRole): Promise<void> {
    const current = twitchAuthStates[role];
    const device = current.status === 'device' || current.status === 'checking' || current.status === 'error'
      ? current.device
      : undefined;
    if (!device) {
      return;
    }

    setTwitchRoleState(role, { status: 'checking', device });

    try {
      const token = await pollTwitchDeviceToken({
        clientId: twitchClientId,
        device,
      });
      let validation: TwitchValidatedToken | undefined;
      try {
        validation = await validateTwitchToken({ accessToken: token.accessToken });
      } catch {
        validation = undefined;
      }

      const authorizedState: AuthorizedTwitchAuthRoleState = validation
        ? { status: 'authorized', token, validation }
        : { status: 'authorized', token };
      setTwitchRoleState(role, authorizedState);
      void saveStoredTwitchAuthRole({
        role,
        clientId: twitchClientId,
        token,
        ...(validation ? { validation } : {}),
      }).catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        appendSystemAudit({
          title: 'Twitch token save failed',
          detail: message,
          source: 'storage',
          tone: 'warning',
          chips: [roleTitle(role)],
        });
      });
      if (role === 'chatReader' && validation?.login) {
        setTwitchChannel(validation.login);
        connectTwitchChatWithReader(authorizedState, validation.login, 'auto');
      }
      appendSystemAudit({
        title: 'Twitch authorized',
        detail: validation?.login ?? roleTitle(role),
        source: 'system',
        tone: 'success',
        chips: [roleTitle(role), ...token.scopes],
      });
    } catch (error) {
      const authError = twitchAuthErrorInfo(error);
      if (authError.retryable) {
        setTwitchRoleState(role, {
          status: 'device',
          device,
          message: 'Waiting for Twitch authorization',
        });
        return;
      }

      setTwitchRoleState(role, {
        status: 'error',
        message: authError.message,
        ...(authError.code ? { code: authError.code } : {}),
        device,
      });
      appendSystemAudit({
        title: 'Twitch check failed',
        detail: authError.message,
        source: 'system',
        tone: 'danger',
        chips: [roleTitle(role)],
      });
    }
  }

  function connectTwitchChat(): void {
    const readerState = twitchAuthStates.chatReader;
    if (readerState.status !== 'authorized') {
      setTwitchChatState({ status: 'error', message: 'Authorize Chat reader first' });
      return;
    }

    const channel = readerState.validation?.login ?? normalizeTwitchChannel(twitchChannel);
    if (!channel) {
      setTwitchChatState({ status: 'error', message: 'Chat reader login is missing; run Check again' });
      return;
    }

    setTwitchChannel(channel);
    connectTwitchChatWithReader(readerState, channel, 'manual');
  }

  function connectTwitchChatWithReader(
    readerState: AuthorizedTwitchAuthRoleState,
    channel: string,
    mode: 'auto' | 'manual',
  ): void {
    const normalizedChannel = normalizeTwitchChannel(channel);
    if (!normalizedChannel) {
      setTwitchChatState({ status: 'error', message: 'Twitch channel login is required' });
      return;
    }

    const readerLogin = readerState.validation?.login;
    if (!readerLogin) {
      setTwitchChatState({
        status: 'error',
        channel: normalizedChannel,
        message: 'Chat reader login is missing; run Check again',
      });
      return;
    }

    try {
      twitchChatClientRef.current?.disconnect();
      const client = createTwitchChatClient({
        accessToken: readerState.token.accessToken,
        login: readerLogin,
        channel: normalizedChannel,
        onMessage: handleTwitchChatMessage,
        onStatus: handleTwitchChatStatus,
      });
      twitchChatClientRef.current = client;
      setTwitchChatState({ status: 'connecting', channel: normalizedChannel });
      appendSystemAudit({
        title: mode === 'auto' ? 'Twitch chat auto-connect' : 'Twitch chat connecting',
        detail: `#${normalizedChannel}`,
        source: 'chat',
        chips: [readerLogin],
      });
      client.connect();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setTwitchChatState({ status: 'error', channel: normalizedChannel, message });
      appendSystemAudit({
        title: 'Twitch chat failed',
        detail: message,
        source: 'chat',
        tone: 'danger',
        chips: [`#${normalizedChannel}`],
      });
    }
  }

  function disconnectTwitchChat(): void {
    const channel = 'channel' in twitchChatState ? twitchChatState.channel : undefined;
    twitchChatClientRef.current?.disconnect();
    twitchChatClientRef.current = undefined;
    setTwitchChatState({
      status: 'disconnected',
      ...(channel ? { channel } : {}),
      message: 'Disconnected by host',
    });
    appendSystemAudit({
      title: 'Twitch chat disconnected',
      source: 'chat',
      ...(channel ? { detail: `#${channel}` } : {}),
    });
  }

  function handleTwitchChatStatus(event: TwitchChatStatusEvent): void {
    switch (event.status) {
      case 'connecting':
        setTwitchChatState({ status: 'connecting', channel: event.channel });
        return;
      case 'connected':
        setTwitchChatState((current) => ({
          status: 'connected',
          channel: event.channel,
          connectedAt: current.status === 'connected' ? current.connectedAt : nowIso(),
          ...(event.message ? { message: event.message } : {}),
          ...(current.status === 'connected' && current.lastMessageAt
            ? { lastMessageAt: current.lastMessageAt }
            : {}),
          ...(current.status === 'connected' && current.lastMessageFrom
            ? { lastMessageFrom: current.lastMessageFrom }
            : {}),
        }));
        return;
      case 'reconnecting':
        setTwitchChatState({
          status: 'reconnecting',
          channel: event.channel,
          attempt: event.attempt,
          delayMs: event.delayMs,
          message: event.message,
        });
        return;
      case 'disconnected':
        setTwitchChatState({
          status: 'disconnected',
          ...(event.channel ? { channel: event.channel } : {}),
          ...(event.message ? { message: event.message } : {}),
        });
        return;
      case 'error':
        setTwitchChatState({
          status: 'error',
          ...(event.channel ? { channel: event.channel } : {}),
          message: event.message,
        });
        appendSystemAudit({
          title: 'Twitch chat error',
          detail: event.message,
          source: 'chat',
          tone: 'danger',
          chips: event.channel ? [`#${event.channel}`] : [],
        });
        return;
    }
  }

  function handleTwitchChatMessage(message: TwitchChatMessage): void {
    const receivedAt = nowIso();
    setTwitchChatState((current) => ({
      status: 'connected',
      channel: message.channel,
      connectedAt: current.status === 'connected' ? current.connectedAt : receivedAt,
      lastMessageAt: receivedAt,
      lastMessageFrom: message.displayName,
    }));
    processChatMessage({
      player: twitchIdentityFromChatMessage(message),
      text: message.text,
      receivedAt,
      source: 'twitch',
      channel: message.channel,
    });
  }

  async function previewThemeBankFile(file: File | undefined): Promise<void> {
    if (!file) {
      return;
    }

    try {
      const rawJson = await file.text();
      const draft = previewThemeBankImport(rawJson);
      setThemeBankImportState({
        status: 'ready',
        fileName: file.name,
        rawJson,
        preview: draft.preview,
      });
      setEventEntries((current) => [
        `Theme bank ready: ${draft.preview.themeCount} themes, ${draft.preview.wordCount} words`,
        ...current,
      ].slice(0, 24));
      appendSystemAudit({
        title: 'Theme bank ready',
        detail: draft.preview.packId,
        source: 'theme-bank',
        chips: [`${draft.preview.themeCount} themes`, `${draft.preview.wordCount} words`],
      });
    } catch (error) {
      const issues = themeBankImportIssues(error);
      setThemeBankImportState({ status: 'error', fileName: file.name, issues });
      showThemeBankImportError(issues);
    }
  }

  function importSelectedThemeBank(): void {
    if (themeBankImportState.status !== 'ready') {
      return;
    }

    const { fileName, preview, rawJson } = themeBankImportState;
    setThemeBankImportState({
      status: 'importing',
      fileName,
      rawJson,
      preview,
    });

    void importThemeBank(rawJson)
      .then((result) => {
        setThemeBankImportState({
          status: 'imported',
          fileName,
          preview: result.preview,
        });
        setEventEntries((current) => [
          `Imported theme bank ${result.storage.packId}: ${result.storage.themeCount} themes, ${result.storage.wordCount} words`,
          ...current,
        ].slice(0, 24));
        appendSystemAudit({
          title: 'Theme bank imported',
          detail: result.storage.packId,
          source: 'theme-bank',
          tone: 'success',
          chips: [`${result.storage.themeCount} themes`, `${result.storage.wordCount} words`],
        });
        refreshThemeCatalog(`Theme catalog refreshed: ${result.storage.themeCount} imported themes available`);
      })
      .catch((error: unknown) => {
        const issues = themeBankImportIssues(error);
        setThemeBankImportState({
          status: 'error',
          fileName,
          issues,
        });
        showThemeBankImportError(issues);
      });
  }

  function persistRoundSnapshot(nextRound: RoundState, events: DomainEvent[]): void {
    const persistResult = localRoundService.persist(nextRound, events);
    if (!persistResult) {
      return;
    }

    void persistResult.catch((error: unknown) => {
      reportStorageError('save', error);
    });
  }

  function reportStorageError(context: string, error: unknown): void {
    const message = error instanceof Error ? error.message : String(error);
    setEventEntries((current) => [
      `SQLite ${context} failed: ${message}`,
      ...current,
    ].slice(0, 24));
    appendSystemAudit({
      title: 'SQLite failed',
      detail: `${context}: ${message}`,
      source: 'storage',
      tone: 'danger',
    });

    if (storageErrorShownRef.current) {
      return;
    }

    storageErrorShownRef.current = true;
    const notification: GameNotification = {
      id: `storage:${Date.now()}`,
      kind: 'warning',
      visibility: 'host',
      title: 'Storage',
      message: 'SQLite persistence failed',
      createdAt: nowIso(),
    };
    setNotifications((current) => [notification, ...current].slice(0, MAX_NOTIFICATIONS));
  }

  function showThemeBankImportError(issues: readonly string[]): void {
    setEventEntries((current) => [
      `Theme bank import failed: ${issues[0] ?? 'unknown error'}`,
      ...current,
    ].slice(0, 24));
    appendSystemAudit({
      title: 'Theme bank failed',
      detail: issues[0] ?? 'unknown error',
      source: 'theme-bank',
      tone: 'danger',
      chips: issues.length > 1 ? [`${issues.length} issues`] : [],
    });
    const notification: GameNotification = {
      id: `theme-bank:${Date.now()}`,
      kind: 'warning',
      visibility: 'host',
      title: 'Theme bank',
      message: 'Import failed',
      createdAt: nowIso(),
    };
    setNotifications((current) => [notification, ...current].slice(0, MAX_NOTIFICATIONS));
  }

  const pendingSubmissions = adminProjection.rejectedSubmissions.filter((submission) => submission.status === 'pending');
  const playerIds = new Set(adminProjection.playersAdmin.map((player) => player.playerId));
  const blockedOnlyPlayers = adminProjection.blockedPlayers.filter((player) => !playerIds.has(player.playerId));

  return (
    <main className="app-shell">
      <StartupRoundChoiceOverlay
        state={startupRoundChoice}
        onContinue={continueStoredRound}
        onNew={startFreshRoundOverStored}
      />

      <PublicGameView
        round={round}
        notifications={publicNotificationsForGameView(notifications)}
        mode="embedded"
        onReset={resetRound}
      />

      <aside className="control-panel" aria-label="Host controls">
        <section className="panel control-section">
          <div className="panel-title">
            <Icon name="book-open" size={17} />
            <h2>Theme</h2>
          </div>
          <div className="theme-control-row">
            <select
              aria-label="Theme"
              value={newRoundForm.themeId}
              onChange={(event) => {
                const themeId = event.currentTarget.value;
                setNewRoundForm((current) => updateNewRoundForm(current, { themeId }));
              }}
            >
              {themeCatalogOptionGroups(themeCatalog).map((group) => (
                <optgroup key={group.key} label={group.label}>
                  {group.entries.map((theme) => (
                    <option key={theme.id} value={theme.id}>{theme.title}</option>
                  ))}
                </optgroup>
              ))}
            </select>
            <button className="primary-button" type="button" onClick={resetRound}>
              <Icon name="refresh" size={17} />
              New
            </button>
          </div>
          <div className="theme-meta">
            <span>{selectedThemeEntry?.language.toUpperCase() ?? round.theme.language.toUpperCase()}</span>
            <span>{selectedThemeWordCount} words</span>
            <span>{themeSourceLabel(selectedThemeEntry?.source)}</span>
            <span>{selectedThemeEntry?.tags.slice(0, 2).join(' · ') || 'loaded'}</span>
          </div>
          <div className="round-settings-grid">
            <label>
              <span>Width</span>
              <input
                aria-label="Board width"
                min={MIN_BOARD_WIDTH}
                max={MAX_BOARD_WIDTH}
                type="number"
                value={newRoundForm.width}
                onChange={(event) => {
                  const width = event.currentTarget.valueAsNumber;
                  setNewRoundForm((current) => updateNewRoundForm(current, {
                    width,
                  }));
                }}
              />
            </label>
            <label>
              <span>Height</span>
              <input
                aria-label="Board height"
                min={MIN_BOARD_HEIGHT}
                max={MAX_BOARD_HEIGHT}
                type="number"
                value={newRoundForm.height}
                onChange={(event) => {
                  const height = event.currentTarget.valueAsNumber;
                  setNewRoundForm((current) => updateNewRoundForm(current, {
                    height,
                  }));
                }}
              />
            </label>
            <label className="round-seed-field">
              <span>Seed</span>
              <input
                aria-label="Round seed"
                value={newRoundForm.seed}
                onChange={(event) => {
                  const seed = event.currentTarget.value;
                  setNewRoundForm((current) => updateNewRoundForm(current, { seed }));
                }}
              />
            </label>
            <label className="toggle-field">
              <input
                aria-label="Warn on dead end"
                checked={newRoundForm.warnOnDeadEnd}
                type="checkbox"
                onChange={(event) => {
                  const warnOnDeadEnd = event.currentTarget.checked;
                  setNewRoundForm((current) => updateNewRoundForm(current, {
                    warnOnDeadEnd,
                  }));
                }}
              />
              <span>Warn dead-end</span>
            </label>
          </div>
        </section>

        <section className="panel control-section">
          <div className="panel-title">
            <Icon name="database" size={17} />
            <h2>Theme bank</h2>
          </div>
          <div className="theme-bank-actions">
            <input
              accept="application/json,.json"
              ref={themeBankInputRef}
              type="file"
              onChange={(event) => {
                const file = event.currentTarget.files?.[0];
                event.currentTarget.value = '';
                void previewThemeBankFile(file);
              }}
            />
            <button
              className="secondary-button"
              disabled={themeBankImportState.status === 'importing'}
              type="button"
              onClick={() => themeBankInputRef.current?.click()}
            >
              <Icon name="file-json" size={17} />
              Choose
            </button>
            <button
              className="primary-button"
              disabled={themeBankImportState.status !== 'ready'}
              type="button"
              onClick={importSelectedThemeBank}
            >
              <Icon name="download" size={17} />
              {themeBankImportState.status === 'importing' ? 'Importing' : 'Import'}
            </button>
          </div>
          <ThemeBankImportSummary state={themeBankImportState} />
        </section>

        <TwitchAuthPanel
          clientId={twitchClientId}
          states={twitchAuthStates}
          onCheck={(role) => void checkTwitchAuth(role)}
          onClientIdChange={setTwitchClientId}
          onStart={(role) => void startTwitchAuth(role)}
        />

        <TwitchChatPanel
          channel={twitchChannel}
          readerState={twitchAuthStates.chatReader}
          state={twitchChatState}
          onChannelChange={setTwitchChannel}
          onConnect={connectTwitchChat}
          onDisconnect={disconnectTwitchChat}
        />

        <section className="panel control-section">
          <div className="panel-title">
            <Icon name="message" size={17} />
            <h2>Fake chat</h2>
          </div>
          <div className="player-select">
            {demoPlayers.map((player) => {
              const playerId = playerIdFromIdentity(player);
              return (
                <button
                  className={playerId === selectedPlayerId ? 'player-chip player-chip-active' : 'player-chip'}
                  key={playerId}
                  type="button"
                  onClick={() => setSelectedPlayerId(playerId)}
                >
                  <span className="marker-dot" style={markerStyle(player.color)} />
                  {player.displayName}
                </button>
              );
            })}
          </div>

          <form
            className="chat-form"
            onSubmit={(event) => {
              event.preventDefault();
              sendFakeChat(draftMessage);
            }}
          >
            <input
              aria-label="Fake chat command"
              value={draftMessage}
              onChange={(event) => setDraftMessage(event.target.value)}
              placeholder="!играть"
            />
            <button className="primary-button" type="submit">
              <Icon name="send" size={17} />
              Send
            </button>
          </form>

          <div className="quick-command-grid">
            {quickCommands.map(({ command, icon, label }) => (
              <button key={command} type="button" title={label} onClick={() => sendFakeChat(command)}>
                <Icon name={icon} size={16} />
                {command}
              </button>
            ))}
          </div>
        </section>

        <NotificationPanel
          notifications={notifications}
          onClear={() => setNotifications([])}
          onDismiss={(id) => setNotifications((current) => current.filter((notification) => notification.id !== id))}
        />

        <section className="panel control-section">
          <div className="panel-title">
            <Icon name="shield" size={17} />
            <h2>Players</h2>
          </div>
          <div className="admin-player-list">
            {adminProjection.playersAdmin.length === 0 && blockedOnlyPlayers.length === 0 ? (
              <div className="empty-state">No players yet</div>
            ) : (
              <>
                {adminProjection.playersAdmin.map((row) => {
                  const canSelect = isDemoPlayerId(row.playerId);
                  const canKick = row.status === 'active' || row.status === 'idle';
                  const canBan = row.status !== 'blocked';
                  const canUnban = row.status === 'blocked'
                    || adminProjection.blockedPlayers.some((player) => player.playerId === row.playerId);
                  const isSelected = row.playerId === selectedPlayerId;

                  return (
                    <div
                      className={isSelected ? 'admin-player-row admin-player-row-active' : 'admin-player-row'}
                      key={row.playerId}
                    >
                      <div className="admin-player-top">
                        <div className="admin-player-identity">
                          <span className="marker-dot" style={markerStyle(row.markerColor)} />
                          <div className="admin-player-name">
                            <strong>{row.displayName}</strong>
                            <span>{row.login}</span>
                          </div>
                        </div>
                        <span className={`status-badge status-${row.status}`}>{row.status}</span>
                      </div>

                      <div className="admin-player-stats">
                        <div className="player-stat">
                          <span>Score</span>
                          <strong>{row.score}</strong>
                        </div>
                        <div className="player-stat">
                          <span>Buffer</span>
                          <strong className="mono-value">{row.buffer || '...'}</strong>
                        </div>
                        <div className="player-stat">
                          <span>Cell</span>
                          <strong>{formatCoord(row.position)}</strong>
                        </div>
                      </div>

                      <div className="row-actions">
                        <button
                          type="button"
                          title="Select for fake chat"
                          aria-label="Select for fake chat"
                          aria-pressed={isSelected}
                          disabled={!canSelect}
                          onClick={() => setSelectedPlayerId(row.playerId)}
                        >
                          <Icon name="log-in" size={15} />
                        </button>
                        <button
                          type="button"
                          title="Kick"
                          aria-label="Kick"
                          disabled={!canKick}
                          onClick={() => kickPlayer(row.playerId)}
                        >
                          <Icon name="user-minus" size={15} />
                        </button>
                        <button
                          type="button"
                          title="Ban"
                          aria-label="Ban"
                          disabled={!canBan}
                          onClick={() => banPlayer(row.playerId)}
                        >
                          <Icon name="ban" size={15} />
                        </button>
                        {canUnban ? (
                          <button type="button" title="Unban" aria-label="Unban" onClick={() => unbanPlayer(row.playerId)}>
                            <Icon name="check" size={15} />
                          </button>
                        ) : null}
                      </div>
                    </div>
                  );
                })}

                {blockedOnlyPlayers.map((player) => (
                  <div className="admin-player-row admin-player-row-blocked" key={player.playerId}>
                    <div className="admin-player-top">
                      <div className="admin-player-identity">
                        <span className="marker-dot" style={markerStyle()} />
                        <div className="admin-player-name">
                          <strong>{blockedPlayerDisplayName(player)}</strong>
                          <span>{blockedPlayerSubtitle(player)}</span>
                        </div>
                      </div>
                      <span className="status-badge status-blocked">blocked</span>
                    </div>

                    <div className="admin-player-stats">
                      <div className="player-stat player-stat-wide">
                        <span>Reason</span>
                        <strong>{player.reason ?? 'manual'}</strong>
                      </div>
                      <div className="player-stat">
                        <span>Since</span>
                        <strong>{formatTime(player.blockedAt)}</strong>
                      </div>
                    </div>

                    <div className="row-actions">
                      <button type="button" title="Unban" aria-label="Unban" onClick={() => unbanPlayer(player.playerId)}>
                        <Icon name="check" size={15} />
                      </button>
                    </div>
                  </div>
                ))}
              </>
            )}
          </div>
        </section>

        <section className="panel control-section">
          <div className="panel-title">
            <Icon name="flag" size={17} />
            <h2>Pending words</h2>
          </div>
          <div className="pending-list">
            {pendingSubmissions.length === 0 ? (
              <div className="empty-state">No pending words</div>
            ) : pendingSubmissions.map((submission) => (
              <div className="pending-row" key={submission.id}>
                <div>
                  <strong>{submission.rawWord}</strong>
                  <span>{submission.playerDisplayName}</span>
                </div>
                <div className="row-actions">
                  <button type="button" title="Approve common" onClick={() => approvePending(submission.id, 1)}>
                    <Icon name="check" size={15} />
                    T1
                  </button>
                  <button type="button" title="Approve exotic" onClick={() => approvePending(submission.id, 2)}>
                    <Icon name="check" size={15} />
                    T2
                  </button>
                </div>
              </div>
            ))}
          </div>
        </section>

        <AuditLogPanel
          entries={auditEntries}
          filter={auditFilter}
          onClear={() => setAuditEntries([])}
          onFilterChange={setAuditFilter}
        />

        <section className="panel chat-history-panel">
          <div className="panel-title">
            <Icon name="message" size={17} />
            <h2>Chat log</h2>
          </div>
          <div className="chat-history">
            {chatEntries.length === 0 ? (
              <div className="empty-state">No chat yet</div>
            ) : chatEntries.map((entry) => (
              <div className="chat-entry" key={entry.id}>
                <div>
                  <strong>{entry.displayName}</strong>
                  <span className="chat-entry-source">{entry.source === 'twitch' ? `#${entry.channel ?? 'twitch'}` : 'fake'}</span>
                  <time>{new Date(entry.createdAt).toLocaleTimeString()}</time>
                </div>
                <p>{entry.text}</p>
                {entry.events.length > 0 ? <span>{entry.events[0]}</span> : null}
              </div>
            ))}
          </div>
        </section>
      </aside>
    </main>
  );
}

function PublicGameWindow() {
  const snapshot = useSyncedPublicSnapshot();

  return (
    <main className="public-window">
      <PublicGameView
        round={snapshot.round}
        notifications={snapshot.notifications}
        mode="standalone"
      />
    </main>
  );
}

type WebThemeLoadState =
  | { status: 'loading' }
  | { status: 'ready'; count: number }
  | { status: 'error'; message: string };

type WebLanguage = (typeof WEB_LANGUAGES)[number];
type WebRoute = 'home' | 'game';

interface WebChatEntry {
  id: string;
  displayName: string;
  text: string;
  createdAt: string;
  summaries: string[];
}

interface WebPlaySettings {
  channel: string;
  themeId: string;
  language: WebLanguage;
  boardWidth: number;
  boardHeight: number;
}

interface ElementSize {
  width: number;
  height: number;
}

interface WebBlockedPlayer {
  playerId: PlayerId;
  login: string;
  displayName: string;
  blockedAt: string;
}

interface WebMarkerAnimation {
  id: string;
  playerId: PlayerId;
  steps: Coord[];
}

interface WebNotice {
  kind: 'error' | 'warning' | 'info';
  message: string;
}

interface WebTexts {
  appKicker: string;
  appTitle: string;
  homeLead: string;
  homeText: string;
  startRound: string;
  loadingThemes: string;
  channel: string;
  channelPlaceholder: string;
  theme: string;
  themeSearch: string;
  randomTheme: string;
  randomThemeHint: string;
  selectedTheme: string;
  noThemeMatches: string;
  boardWidth: string;
  boardHeight: string;
  howToPlay: string;
  howToPlayTitle: string;
  howToPlayIntro: string;
  commandJoin: string;
  commandMove: string;
  commandSubmit: string;
  commandReset: string;
  commandQuit: string;
  commandDemo: string;
  launch: string;
  cancel: string;
  newGame: string;
  disconnect: string;
  openPanel: string;
  close: string;
  language: string;
  russian: string;
  english: string;
  leaderboard: string;
  players: string;
  kickPlayer: string;
  banPlayer: string;
  blocklist: string;
  blockedPlayers: string;
  noBlockedPlayers: string;
  unblockPlayer: string;
  localBanHint: string;
  found: string;
  events: string;
  commands: string;
  noLeaders: string;
  noPlayers: string;
  noWords: string;
  noEvents: string;
  latest: string;
  board: string;
  channelRequired: string;
  themeRequired: string;
  chatNotConnected: string;
  chatConnecting: string;
  chatDisconnected: string;
  chatError: string;
  loadedThemes: (count: number) => string;
  boardSize: (width: number, height: number) => string;
  chatConnected: (channel: string) => string;
  chatReconnecting: (attempt: number) => string;
  wordsCount: (count: number) => string;
  playersCount: (count: number) => string;
}

const WEB_TEXT: Record<WebLanguage, WebTexts> = {
  ru: {
    appKicker: 'Онлайн-игра для Twitch-чата',
    appTitle: 'FrogWord',
    homeLead: 'Зрители прыгают по буквам прямо из чата и собирают слова выбранной темы.',
    homeText: 'Без установки и без авторизации: укажите канал, выберите тему и размер поля, затем запустите раунд.',
    startRound: 'Начать игру',
    loadingThemes: 'Загружаю темы',
    channel: 'Twitch-канал',
    channelPlaceholder: 'ник стримера',
    theme: 'Тема',
    themeSearch: 'Поиск темы',
    randomTheme: 'Случайная тема',
    randomThemeHint: 'Каждый запуск выберет одну из загруженных тем',
    selectedTheme: 'Выбранная тема',
    noThemeMatches: 'Темы не найдены',
    boardWidth: 'Ширина',
    boardHeight: 'Высота',
    howToPlay: 'Как играть',
    howToPlayTitle: 'Как играть',
    howToPlayIntro: 'Пишите команды в Twitch-чат, чтобы прыгать по полю и собирать слова.',
    commandJoin: 'войти в раунд',
    commandMove: 'прыгнуть вправо на 3 клетки; также работают !л, !в и !н',
    commandSubmit: 'проверить текущий набор как слово',
    commandReset: 'сбросить набор и вернуться на пустую клетку',
    commandQuit: 'выйти из раунда',
    commandDemo: 'Пример: лягушка собирает слово "муха"',
    launch: 'Запустить',
    cancel: 'Отмена',
    newGame: 'Новая игра',
    disconnect: 'Отключить чат',
    openPanel: 'Панель',
    close: 'Закрыть',
    language: 'Язык',
    russian: 'Русский',
    english: 'English',
    leaderboard: 'Лидеры',
    players: 'Игроки',
    kickPlayer: 'Кикнуть',
    banPlayer: 'Заблокировать',
    blocklist: 'Чёрный список',
    blockedPlayers: 'Заблокированные игроки',
    noBlockedPlayers: 'Чёрный список пуст',
    unblockPlayer: 'Разблокировать',
    localBanHint: 'Это блокировка только внутри FrogWord в этом браузере.',
    found: 'Найдено',
    events: 'События',
    commands: 'Команды',
    noLeaders: 'Очков пока нет',
    noPlayers: 'Игроки появятся после команды !играть',
    noWords: 'Слова ещё не найдены',
    noEvents: 'Пока тихо',
    latest: 'Последнее',
    board: 'Игровое поле',
    channelRequired: 'Введите ник Twitch-канала',
    themeRequired: 'Тема ещё не загружена',
    chatNotConnected: 'Чат ждёт запуска',
    chatConnecting: 'Подключаю чат',
    chatDisconnected: 'Чат отключён',
    chatError: 'Ошибка чата',
    loadedThemes: (count) => `${count} тем загружено`,
    boardSize: (width, height) => `${width}x${height}`,
    chatConnected: (channel) => `Чат #${channel} подключён`,
    chatReconnecting: (attempt) => `Переподключение ${attempt}`,
    wordsCount: (count) => `${count} слов`,
    playersCount: (count) => `${count} игроков`,
  },
  en: {
    appKicker: 'Online Twitch chat game',
    appTitle: 'FrogWord',
    homeLead: 'Viewers hop across letters from chat and collect words from the selected theme.',
    homeText: 'No install and no OAuth: choose a channel, theme and board size, then start the round.',
    startRound: 'Start game',
    loadingThemes: 'Loading themes',
    channel: 'Twitch channel',
    channelPlaceholder: 'streamer login',
    theme: 'Theme',
    themeSearch: 'Theme search',
    randomTheme: 'Random theme',
    randomThemeHint: 'Each launch picks one of the loaded themes',
    selectedTheme: 'Selected theme',
    noThemeMatches: 'No matching themes',
    boardWidth: 'Width',
    boardHeight: 'Height',
    howToPlay: 'How to play',
    howToPlayTitle: 'How to play',
    howToPlayIntro: 'Type commands in Twitch chat to hop across the board and collect words.',
    commandJoin: 'join the round',
    commandMove: 'hop 3 cells right; !l, !u and !d work too',
    commandSubmit: 'submit the current letters as a word',
    commandReset: 'clear letters and respawn on an empty cell',
    commandQuit: 'leave the round',
    commandDemo: 'Example: the frog collects "муха"',
    launch: 'Launch',
    cancel: 'Cancel',
    newGame: 'New game',
    disconnect: 'Disconnect chat',
    openPanel: 'Panel',
    close: 'Close',
    language: 'Language',
    russian: 'Русский',
    english: 'English',
    leaderboard: 'Leaders',
    players: 'Players',
    kickPlayer: 'Kick',
    banPlayer: 'Ban',
    blocklist: 'Blocklist',
    blockedPlayers: 'Blocked players',
    noBlockedPlayers: 'Blocklist is empty',
    unblockPlayer: 'Unblock',
    localBanHint: 'This block only affects FrogWord in this browser.',
    found: 'Found',
    events: 'Events',
    commands: 'Commands',
    noLeaders: 'No scores yet',
    noPlayers: 'Players appear after !play',
    noWords: 'No words found yet',
    noEvents: 'Nothing yet',
    latest: 'Latest',
    board: 'Game board',
    channelRequired: 'Enter a Twitch channel login',
    themeRequired: 'Theme is not loaded yet',
    chatNotConnected: 'Chat is ready',
    chatConnecting: 'Connecting chat',
    chatDisconnected: 'Chat disconnected',
    chatError: 'Chat error',
    loadedThemes: (count) => `${count} themes loaded`,
    boardSize: (width, height) => `${width}x${height}`,
    chatConnected: (channel) => `Chat #${channel} connected`,
    chatReconnecting: (attempt) => `Reconnect ${attempt}`,
    wordsCount: (count) => `${count} words`,
    playersCount: (count) => `${count} players`,
  },
};

function AnonymousWebGameApp() {
  const initialSettings = useMemo(() => loadWebPlaySettings(), []);
  const [webRoute, setWebRouteState] = useState<WebRoute>(() => webRouteFromLocation());
  const [themes, setThemes] = useState<Theme[]>([]);
  const [themeLoadState, setThemeLoadState] = useState<WebThemeLoadState>({ status: 'loading' });
  const [settings, setSettings] = useState<WebPlaySettings>(initialSettings);
  const [setupDraft, setSetupDraft] = useState<WebPlaySettings>(initialSettings);
  const [isSetupOpen, setIsSetupOpen] = useState(false);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [isBlocklistOpen, setIsBlocklistOpen] = useState(false);
  const [isHowToPlayOpen, setIsHowToPlayOpen] = useState(false);
  const [round, setRound] = useState<RoundState | undefined>();
  const [chatState, setChatState] = useState<TwitchChatUiState>({ status: 'idle' });
  const [chatEntries, setChatEntries] = useState<WebChatEntry[]>([]);
  const [blockedPlayers, setBlockedPlayers] = useState<WebBlockedPlayer[]>(() => loadWebBlocklist(initialSettings.channel));
  const [markerAnimations, setMarkerAnimations] = useState<Record<string, WebMarkerAnimation>>({});
  const [webNotice, setWebNotice] = useState<WebNotice | undefined>();
  const chatClientRef = useRef<TwitchChatClient | undefined>(undefined);
  const roundRef = useRef(round);
  const blockedPlayersRef = useRef(blockedPlayers);

  useEffect(() => {
    roundRef.current = round;
  }, [round]);

  useEffect(() => {
    blockedPlayersRef.current = blockedPlayers;
  }, [blockedPlayers]);

  useEffect(() => {
    function handleRouteChange(): void {
      const nextRoute = webRouteFromLocation();
      setWebRouteState(nextRoute);
      if (nextRoute === 'home' && roundRef.current) {
        returnToWebHome(false);
      }
    }

    window.addEventListener('hashchange', handleRouteChange);
    window.addEventListener('popstate', handleRouteChange);
    return () => {
      window.removeEventListener('hashchange', handleRouteChange);
      window.removeEventListener('popstate', handleRouteChange);
    };
  }, []);

  useEffect(() => {
    let disposed = false;

    async function loadThemes(): Promise<void> {
      try {
        const response = await fetch(WEB_THEME_BANK_URL);
        if (!response.ok) {
          throw new Error(`Theme bank request failed: ${response.status}`);
        }

        const loadedThemes = createThemesFromThemeBank(await response.json());
        if (loadedThemes.length === 0) {
          throw new Error('Theme bank has no themes');
        }

        if (disposed) {
          return;
        }

        const nextSettings = normalizeWebPlaySettings(loadWebPlaySettings(), loadedThemes);
        setThemes(loadedThemes);
        setSettings(nextSettings);
        setSetupDraft(nextSettings);
        setBlockedPlayers(loadWebBlocklist(nextSettings.channel));
        setThemeLoadState({ status: 'ready', count: loadedThemes.length });
      } catch (error) {
        if (!disposed) {
          const message = error instanceof Error ? error.message : String(error);
          setThemeLoadState({
            status: 'error',
            message,
          });
          setWebNotice({ kind: 'error', message });
        }
      }
    }

    void loadThemes();

    return () => {
      disposed = true;
      chatClientRef.current?.disconnect();
    };
  }, []);

  const publicProjection = useMemo(
    () => round ? createPublicGameProjection(round, { locale: round.theme.language }) : undefined,
    [round],
  );
  const language = normalizeWebLanguage(settings.language);
  const text = WEB_TEXT[language];
  const isConnected = chatState.status === 'connected' || chatState.status === 'reconnecting';
  const hasActiveRound = webRoute === 'game' && Boolean(round && publicProjection);

  function openSetupModal(): void {
    setSetupDraft(settings);
    setIsSetupOpen(true);
  }

  function startNewWebRound(draft = setupDraft): void {
    const normalizedDraft = normalizeWebPlaySettings(draft, themes);
    const draftText = WEB_TEXT[normalizedDraft.language];
    const normalizedChannel = normalizeTwitchChannel(normalizedDraft.channel);
    if (!normalizedChannel) {
      setWebNotice({ kind: 'error', message: draftText.channelRequired });
      setIsSetupOpen(true);
      return;
    }

    const theme = pickWebThemeForRound(normalizedDraft.themeId, themes);
    if (!theme) {
      setWebNotice({ kind: 'error', message: draftText.themeRequired });
      return;
    }

    const nextSettings = normalizeWebPlaySettings({
      ...normalizedDraft,
      channel: normalizedChannel,
      themeId: normalizedDraft.themeId === WEB_RANDOM_THEME_ID ? WEB_RANDOM_THEME_ID : theme.id,
    }, themes);
    const nextRound = createWebPlayRound(theme, nextSettings);
    roundRef.current = nextRound;
    setSettings(nextSettings);
    setSetupDraft(nextSettings);
    setBlockedPlayers(loadWebBlocklist(normalizedChannel));
    setRound(nextRound);
    setChatEntries([]);
    setMarkerAnimations({});
    setIsSidebarOpen(false);
    setIsSetupOpen(false);
    setWebRouteState('game');
    writeWebRoute('game');
    saveWebPlaySettings(nextSettings);
    connectAnonymousChat(normalizedChannel, nextSettings.language);
  }

  function connectAnonymousChat(channel: string, language = settings.language): void {
    const labels = WEB_TEXT[language];
    const normalizedChannel = normalizeTwitchChannel(channel);
    if (!normalizedChannel) {
      const message = labels.channelRequired;
      setChatState({ status: 'error', message });
      setWebNotice({ kind: 'error', message });
      return;
    }

    try {
      chatClientRef.current?.disconnect();
      const client = createAnonymousTwitchChatClient({
        channel: normalizedChannel,
        onMessage: handleAnonymousTwitchMessage,
        onStatus: handleAnonymousTwitchStatus,
      });
      chatClientRef.current = client;
      setChatState({ status: 'connecting', channel: normalizedChannel });
      client.connect();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setChatState({
        status: 'error',
        channel: normalizedChannel,
        message,
      });
      setWebNotice({ kind: 'error', message });
    }
  }

  function disconnectAnonymousChat(): void {
    const channel = 'channel' in chatState ? chatState.channel : undefined;
    chatClientRef.current?.disconnect();
    chatClientRef.current = undefined;
    setChatState({
      status: 'disconnected',
      ...(channel ? { channel } : {}),
      message: 'Отключено',
    });
  }

  function returnToWebHome(updateUrl = true): void {
    chatClientRef.current?.disconnect();
    chatClientRef.current = undefined;
    roundRef.current = undefined;
    setRound(undefined);
    setChatEntries([]);
    setMarkerAnimations({});
    setIsSidebarOpen(false);
    setIsBlocklistOpen(false);
    setIsHowToPlayOpen(false);
    setChatState({ status: 'idle' });
    setWebRouteState('home');
    if (updateUrl) {
      writeWebRoute('home');
    }
  }

  function handleAnonymousTwitchStatus(event: TwitchChatStatusEvent): void {
    switch (event.status) {
      case 'connecting':
        setChatState({ status: 'connecting', channel: event.channel });
        break;
      case 'connected':
        setWebNotice(undefined);
        setChatState((current) => ({
          status: 'connected',
          channel: event.channel,
          connectedAt: current.status === 'connected' ? current.connectedAt : nowIso(),
          ...(event.message ? { message: event.message } : {}),
        }));
        break;
      case 'reconnecting':
        setChatState({
          status: 'reconnecting',
          channel: event.channel,
          attempt: event.attempt,
          delayMs: event.delayMs,
          message: event.message,
        });
        break;
      case 'disconnected':
        setChatState({
          status: 'disconnected',
          ...(event.channel ? { channel: event.channel } : {}),
          ...(event.message ? { message: event.message } : {}),
        });
        break;
      case 'error':
        setWebNotice({ kind: 'error', message: event.message });
        setChatState({
          status: 'error',
          ...(event.channel ? { channel: event.channel } : {}),
          message: event.message,
        });
        break;
    }
  }

  function handleAnonymousTwitchMessage(message: TwitchChatMessage): void {
    setChatState((current) => (
      current.status === 'connected'
        ? {
          ...current,
          lastMessageAt: nowIso(),
          lastMessageFrom: message.displayName,
        }
        : current
    ));

    if (!message.text.trim().startsWith('!')) {
      return;
    }

    const currentRound = roundRef.current;
    if (!currentRound) {
      return;
    }

    const receivedAt = nowIso();
    const identity = {
      ...twitchIdentityFromChatMessage(message),
      color: message.color ?? webColorFromString(message.login),
    };
    const playerId = playerIdFromIdentity(identity);
    if (
      isWebPlayerBlocked(blockedPlayersRef.current, identity.login, playerId)
      || currentRound.players[playerId]?.status === 'kicked'
      || currentRound.players[playerId]?.status === 'blocked'
    ) {
      return;
    }

    const result = applyCommand(currentRound, {
      player: identity,
      command: parseChatCommand(message.text, currentRound.settings.maxMovesPerMessage),
      receivedAt,
    });
    roundRef.current = result.state;
    setRound(result.state);
    const markerMovement = webMarkerAnimationsFromEvents(result.events, `${receivedAt}:${message.login}`);
    if (markerMovement.length > 0) {
      setMarkerAnimations((current) => ({
        ...current,
        ...Object.fromEntries(markerMovement.map((animation) => [animation.playerId, animation])),
      }));
    }
    const notice = webNoticeForDomainEvents(
      result.state,
      result.events,
      normalizeWebLanguage(settings.language),
    );
    if (notice) {
      setWebNotice(notice);
    }
    setChatEntries((current) => [
      {
        id: `${receivedAt}:${message.login}:${message.tags.id ?? message.raw.length}`,
        displayName: message.displayName,
        text: message.text,
        createdAt: receivedAt,
        summaries: result.events.map((event) => summarizeDomainEvent(result.state, event)),
      },
      ...current,
    ].slice(0, MAX_WEB_CHAT_ENTRIES));
  }

  function changeLanguage(language: WebLanguage): void {
    const nextSettings = { ...settings, language };
    setSettings(nextSettings);
    setSetupDraft((current) => ({ ...current, language }));
    saveWebPlaySettings(nextSettings);
  }

  function applyWebModeration(action: 'kickPlayer' | 'banPlayer', playerId: PlayerId): void {
    const currentRound = roundRef.current;
    if (!currentRound) {
      return;
    }
    const player = currentRound.players[playerId];

    const result = applyHostAction(currentRound, {
      kind: action,
      playerId,
      actedAt: nowIso(),
      ...(action === 'banPlayer' ? { reason: 'web round moderation' } : {}),
    });
    roundRef.current = result.state;
    setRound(result.state);
    const notice = webNoticeForDomainEvents(
      result.state,
      result.events,
      normalizeWebLanguage(settings.language),
    );
    if (notice) {
      setWebNotice(notice);
    }

    if (action === 'banPlayer') {
      const blocked: WebBlockedPlayer = {
        playerId,
        login: player?.identity.login ?? playerId,
        displayName: player?.identity.displayName ?? playerId,
        blockedAt: nowIso(),
      };
      setBlockedPlayers((current) => saveWebBlocklist(settings.channel, upsertWebBlockedPlayer(current, blocked)));
    }
  }

  function clearMarkerAnimation(playerId: PlayerId, animationId: string): void {
    setMarkerAnimations((current) => {
      if (current[playerId]?.id !== animationId) {
        return current;
      }

      const next = { ...current };
      delete next[playerId];
      return next;
    });
  }

  function unblockWebPlayer(playerId: PlayerId): void {
    setBlockedPlayers((current) => saveWebBlocklist(
      settings.channel,
      current.filter((entry) => entry.playerId !== playerId),
    ));

    const currentRound = roundRef.current;
    if (currentRound?.blockedPlayers[playerId] || currentRound?.players[playerId]?.status === 'blocked') {
      const result = applyHostAction(currentRound, { kind: 'unbanPlayer', playerId, actedAt: nowIso() });
      roundRef.current = result.state;
      setRound(result.state);
      const notice = webNoticeForDomainEvents(
        result.state,
        result.events,
        normalizeWebLanguage(settings.language),
      );
      if (notice) {
        setWebNotice(notice);
      }
    }
  }

  return (
    <>
      <main className={`web-play-shell ${hasActiveRound ? 'web-game-shell' : 'web-home-shell'}`}>
        <FrogBackgroundMark />
        <FrogBackgroundMarkAlt />
        {hasActiveRound && publicProjection ? (
          <WebGameView
            chatEntries={chatEntries}
            chatState={chatState}
            isConnected={isConnected}
            isSidebarOpen={isSidebarOpen}
            markerAnimations={markerAnimations}
            blockedPlayers={blockedPlayers}
            projection={publicProjection}
            settings={settings}
            text={text}
            onDisconnect={disconnectAnonymousChat}
            onOpenHome={() => returnToWebHome()}
            onModeratePlayer={applyWebModeration}
            onMarkerAnimationComplete={clearMarkerAnimation}
            onLanguageChange={changeLanguage}
            onOpenBlocklist={() => setIsBlocklistOpen(true)}
            onOpenHowToPlay={() => setIsHowToPlayOpen(true)}
            onOpenSetup={openSetupModal}
            onSidebarToggle={() => setIsSidebarOpen((current) => !current)}
          />
        ) : (
          <WebHome
            language={language}
            text={text}
            themeLoadState={themeLoadState}
            onLanguageChange={changeLanguage}
            onStart={() => setIsSetupOpen(true)}
          />
        )}
      </main>

      {isSetupOpen ? (
        <WebSetupModal
          draft={setupDraft}
          text={WEB_TEXT[normalizeWebLanguage(setupDraft.language)]}
          themeLoadState={themeLoadState}
          themes={themes}
          onChange={setSetupDraft}
          onClose={() => setIsSetupOpen(false)}
          onSubmit={() => startNewWebRound(setupDraft)}
        />
      ) : null}

      {webNotice ? (
        <WebNoticeToast notice={webNotice} onDismiss={() => setWebNotice(undefined)} />
      ) : null}

      {isBlocklistOpen ? (
        <WebBlocklistModal
          blockedPlayers={blockedPlayers}
          text={text}
          onClose={() => setIsBlocklistOpen(false)}
          onUnblock={unblockWebPlayer}
        />
      ) : null}

      {isHowToPlayOpen ? (
        <WebHowToPlayModal text={text} onClose={() => setIsHowToPlayOpen(false)} />
      ) : null}
    </>
  );
}

interface WebHomeProps {
  language: WebLanguage;
  text: WebTexts;
  themeLoadState: WebThemeLoadState;
  onLanguageChange: (language: WebLanguage) => void;
  onStart: () => void;
}

function WebHome({ language, text, themeLoadState, onLanguageChange, onStart }: WebHomeProps) {
  const canStart = themeLoadState.status === 'ready';

  return (
    <section className="web-home" aria-label="FrogWord">
      <header className="web-home-top">
        <span>FrogWord</span>
        <WebLanguageMenu language={language} text={text} onChange={onLanguageChange} />
      </header>

      <div className="web-home-content">
        <p className="web-play-kicker">{text.appKicker}</p>
        <h1>{text.appTitle}</h1>
        <p className="web-home-lead">{text.homeLead}</p>
        <p className="web-home-copy">{text.homeText}</p>
        <div className="web-home-actions">
          <button className="web-primary-button web-launch-button" type="button" disabled={!canStart} onClick={onStart}>
            <Icon name="radio" size={20} />
            {canStart ? text.startRound : text.loadingThemes}
          </button>
          <span>
            {themeLoadState.status === 'ready'
              ? text.loadedThemes(themeLoadState.count)
              : themeLoadState.status === 'error'
                ? themeLoadState.message
                : text.loadingThemes}
          </span>
        </div>
      </div>

      <WebMiniBoardDemo word="комар" variant="home" />
    </section>
  );
}

interface WebSetupModalProps {
  draft: WebPlaySettings;
  text: WebTexts;
  themeLoadState: WebThemeLoadState;
  themes: Theme[];
  onChange: Dispatch<SetStateAction<WebPlaySettings>>;
  onClose: () => void;
  onSubmit: () => void;
}

function WebSetupModal({ draft, text, themeLoadState, themes, onChange, onClose, onSubmit }: WebSetupModalProps) {
  const safeDraft = normalizeWebPlaySettings(draft, themes);
  const [themeQuery, setThemeQuery] = useState('');
  const filteredThemes = useMemo(() => {
    const query = themeQuery.trim().toLocaleLowerCase();
    if (!query) {
      return themes;
    }

    return themes.filter((theme) => theme.title.toLocaleLowerCase().includes(query));
  }, [themeQuery, themes]);
  const selectedThemeTitle = safeDraft.themeId === WEB_RANDOM_THEME_ID
    ? text.randomTheme
    : themes.find((theme) => theme.id === safeDraft.themeId)?.title ?? text.themeRequired;

  return (
    <div className="web-modal-backdrop" role="presentation">
      <form
        className="web-setup-modal"
        aria-label={text.startRound}
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit();
        }}
      >
        <header>
          <div>
            <p className="web-play-kicker">{text.startRound}</p>
            <h2>{text.appTitle}</h2>
          </div>
          <button className="web-icon-button" type="button" title={text.close} onClick={onClose}>
            <Icon name="x" size={18} />
          </button>
        </header>

        <label className="web-field web-field-wide">
          <span>{text.channel}</span>
          <input
            autoFocus
            value={safeDraft.channel}
            placeholder={text.channelPlaceholder}
            onChange={(event) => {
              const channel = event.currentTarget.value;
              onChange((current) => ({ ...current, channel }));
            }}
          />
        </label>

        <section className="web-theme-picker web-field-wide" aria-label={text.theme}>
          <div className="web-theme-picker-top">
            <span>{text.selectedTheme}</span>
            <strong>{selectedThemeTitle}</strong>
          </div>

          <button
            aria-pressed={safeDraft.themeId === WEB_RANDOM_THEME_ID}
            className={safeDraft.themeId === WEB_RANDOM_THEME_ID ? 'web-theme-random web-theme-selected' : 'web-theme-random'}
            disabled={themeLoadState.status !== 'ready'}
            type="button"
            onClick={() => onChange((current) => ({ ...current, themeId: WEB_RANDOM_THEME_ID }))}
          >
            <strong>{text.randomTheme}</strong>
            <span>{text.randomThemeHint}</span>
          </button>

          <label className="web-field">
            <span>{text.themeSearch}</span>
            <input
              value={themeQuery}
              placeholder={text.theme}
              onChange={(event) => setThemeQuery(event.currentTarget.value)}
            />
          </label>

          <div className="web-theme-grid" aria-label={text.theme}>
            {filteredThemes.length === 0 ? (
              <div className="web-theme-empty">{text.noThemeMatches}</div>
            ) : filteredThemes.map((theme) => (
              <button
                aria-pressed={safeDraft.themeId === theme.id}
                className={safeDraft.themeId === theme.id ? 'web-theme-option web-theme-selected' : 'web-theme-option'}
                key={theme.id}
                type="button"
                onClick={() => onChange((current) => ({ ...current, themeId: theme.id }))}
              >
                {theme.title}
              </button>
            ))}
          </div>
        </section>

        <div className="web-field-row">
          <label className="web-field">
            <span>{text.boardWidth}</span>
            <input
              inputMode="numeric"
              max={WEB_MAX_BOARD_WIDTH}
              min={WEB_MIN_BOARD_WIDTH}
              type="number"
              value={safeDraft.boardWidth}
              onChange={(event) => {
                const boardWidth = clampWebDimension(
                  event.currentTarget.value,
                  WEB_MIN_BOARD_WIDTH,
                  WEB_MAX_BOARD_WIDTH,
                  safeDraft.boardWidth,
                );
                onChange((current) => ({ ...current, boardWidth }));
              }}
            />
          </label>
          <label className="web-field">
            <span>{text.boardHeight}</span>
            <input
              inputMode="numeric"
              max={WEB_MAX_BOARD_HEIGHT}
              min={WEB_MIN_BOARD_HEIGHT}
              type="number"
              value={safeDraft.boardHeight}
              onChange={(event) => {
                const boardHeight = clampWebDimension(
                  event.currentTarget.value,
                  WEB_MIN_BOARD_HEIGHT,
                  WEB_MAX_BOARD_HEIGHT,
                  safeDraft.boardHeight,
                );
                onChange((current) => ({ ...current, boardHeight }));
              }}
            />
          </label>
        </div>

        <div className="web-modal-bottom">
          <WebLanguageMenu language={safeDraft.language} text={text} onChange={(language) => onChange((current) => ({ ...current, language }))} />
          <button className="web-primary-button" type="submit" disabled={themeLoadState.status !== 'ready'}>
            <Icon name="radio" size={18} />
            {text.launch}
          </button>
        </div>
      </form>
    </div>
  );
}

interface WebGameViewProps {
  blockedPlayers: WebBlockedPlayer[];
  chatEntries: WebChatEntry[];
  chatState: TwitchChatUiState;
  isConnected: boolean;
  isSidebarOpen: boolean;
  markerAnimations: Record<string, WebMarkerAnimation>;
  projection: PublicGameProjection;
  settings: WebPlaySettings;
  text: WebTexts;
  onDisconnect: () => void;
  onLanguageChange: (language: WebLanguage) => void;
  onMarkerAnimationComplete: (playerId: PlayerId, animationId: string) => void;
  onModeratePlayer: (action: 'kickPlayer' | 'banPlayer', playerId: PlayerId) => void;
  onOpenBlocklist: () => void;
  onOpenHowToPlay: () => void;
  onOpenHome: () => void;
  onOpenSetup: () => void;
  onSidebarToggle: () => void;
}

function WebGameView({
  blockedPlayers,
  chatEntries,
  chatState,
  isConnected,
  isSidebarOpen,
  markerAnimations,
  projection,
  settings,
  text,
  onDisconnect,
  onLanguageChange,
  onMarkerAnimationComplete,
  onModeratePlayer,
  onOpenBlocklist,
  onOpenHowToPlay,
  onOpenHome,
  onOpenSetup,
  onSidebarToggle,
}: WebGameViewProps) {
  const markerStackIndexes = useMemo(() => markerStackIndexByPlayer(projection), [projection]);
  const language = normalizeWebLanguage(settings.language);
  const hasMarkerAnimations = Object.keys(markerAnimations).length > 0;
  const [displayBoardProjection, setDisplayBoardProjection] = useState(projection);
  const boardZoneRef = useRef<HTMLElement | null>(null);
  const boardZoneSize = useElementSize(boardZoneRef);
  const boardProjection = hasMarkerAnimations ? displayBoardProjection : projection;

  useEffect(() => {
    if (!hasMarkerAnimations) {
      setDisplayBoardProjection(projection);
    }
  }, [hasMarkerAnimations, projection]);

  return (
    <section className="web-game" aria-label="FrogWord web play">
      <header className="web-game-topbar">
        <div className="web-game-left-actions">
          <button className="web-game-brand" type="button" title="FrogWord" onClick={onOpenHome}>
            <span>FrogWord</span>
            <small>{text.boardSize(projection.board.width, projection.board.height)}</small>
          </button>
          <button className="web-icon-button" type="button" title={text.openPanel} onClick={onSidebarToggle}>
            <Icon name="message" size={18} />
          </button>
          <button className="web-icon-button" type="button" title={text.blocklist} onClick={onOpenBlocklist}>
            <Icon name="ban" size={18} />
          </button>
          <button className="web-text-button" type="button" onClick={onOpenHowToPlay}>
            {text.howToPlay}
          </button>
        </div>

        <strong className="web-game-theme-title">{projection.themeTitle}</strong>

        <div className="web-top-actions">
          <span className={`web-chat-state web-chat-state-${chatState.status}`}>
            {webChatStatusCopy(chatState, text)}
          </span>
          <button className="web-icon-button" type="button" title={text.newGame} onClick={onOpenSetup}>
            <Icon name="refresh" size={18} />
          </button>
          <button className="web-icon-button" type="button" disabled={!isConnected} title={text.disconnect} onClick={onDisconnect}>
            <Icon name="radio-off" size={18} />
          </button>
          <WebLanguageMenu language={language} text={text} onChange={onLanguageChange} />
        </div>
      </header>

      <div className="web-game-body">
        <WebRoundRoster
          blockedPlayers={blockedPlayers}
          projection={projection}
          text={text}
          onModeratePlayer={onModeratePlayer}
        />

        <section className="web-board-zone" aria-label={text.board} ref={boardZoneRef}>
          <div
            className="board-grid web-board-grid"
            style={webBoardGridStyle(boardProjection.board.width, boardProjection.board.height, boardZoneSize)}
          >
            {boardProjection.board.cells.flatMap((row) => (
              row.map((cell) => {
                return (
                  <div className={`board-cell board-cell-${cell.kind}`} key={cell.id}>
                    {cell.kind === 'letter' ? <span>{cell.char}</span> : null}
                  </div>
                );
              })
            ))}
            <div className="web-marker-layer">
              {projection.players.map((marker) => (
                <PlayerFrogMarker
                  animation={markerAnimations[marker.playerId]}
                  key={marker.playerId}
                  marker={marker}
                  stackIndex={markerStackIndexes.get(marker.playerId) ?? 0}
                  onAnimationComplete={onMarkerAnimationComplete}
                />
              ))}
            </div>
          </div>
        </section>
      </div>

      <WebGameSidebar
        blockedPlayers={blockedPlayers}
        entries={chatEntries}
        isOpen={isSidebarOpen}
        projection={projection}
        language={language}
        text={text}
        onClose={onSidebarToggle}
      />
    </section>
  );
}

function PlayerFrogMarker({
  animation,
  marker,
  stackIndex = 0,
  onAnimationComplete,
}: {
  animation: WebMarkerAnimation | undefined;
  marker: PublicGameProjection['players'][number];
  stackIndex?: number;
  onAnimationComplete?: (playerId: PlayerId, animationId: string) => void;
}) {
  const coord = useAnimatedMarkerCoord(marker, animation, onAnimationComplete);
  const label = marker.displayName.slice(0, WEB_PLAYER_MARKER_LABEL_LENGTH).toUpperCase();

  return (
    <div
      className="player-marker player-frog-marker"
      style={frogMarkerStyle(marker.markerColor, coord, stackIndex)}
      title={marker.displayName}
    >
      <FrogMascot />
      <span>{label}</span>
    </div>
  );
}

function WebRoundRoster({
  blockedPlayers,
  projection,
  text,
  onModeratePlayer,
}: {
  blockedPlayers: WebBlockedPlayer[];
  projection: PublicGameProjection;
  text: WebTexts;
  onModeratePlayer: (action: 'kickPlayer' | 'banPlayer', playerId: PlayerId) => void;
}) {
  const participantById = new Map(projection.participantPanel.map((row) => [row.playerId, row]));
  const blockedPlayerIds = new Set(blockedPlayers.map((entry) => entry.playerId));
  const visibleRows = projection.leaderboard.filter((row) => (
    row.status !== 'blocked'
    && row.status !== 'kicked'
    && !blockedPlayerIds.has(row.playerId)
  ));

  return (
    <aside className="web-round-roster" aria-label={text.leaderboard}>
      <header>
        <Icon name="award" size={16} />
        <strong>{text.leaderboard}</strong>
      </header>

      <div className="web-roster-list">
        {visibleRows.length === 0 ? (
          <span className="web-roster-empty">{text.noPlayers}</span>
        ) : visibleRows.slice(0, 18).map((row) => {
          const participant = participantById.get(row.playerId);
          const isActive = row.status === 'active' || row.status === 'idle';
          const canKick = row.status === 'active' || row.status === 'idle';
          const canBan = row.status !== 'blocked';
          return (
            <article
              className={isActive ? 'web-roster-row' : 'web-roster-row web-roster-row-inactive'}
              key={row.playerId}
            >
              <span className="web-roster-rank">#{row.rank}</span>
              <span className="marker-dot" style={markerStyle(participant?.markerColor)} />
              <div>
                <strong>{row.displayName}</strong>
                <small>{participant?.buffer || '...'}</small>
              </div>
              <b>{row.score}</b>
              <div className="web-roster-actions">
                <button
                  type="button"
                  disabled={!canKick}
                  title={text.kickPlayer}
                  onClick={() => onModeratePlayer('kickPlayer', row.playerId)}
                >
                  <Icon name="user-minus" size={13} />
                </button>
                <button
                  type="button"
                  disabled={!canBan}
                  title={text.banPlayer}
                  onClick={() => onModeratePlayer('banPlayer', row.playerId)}
                >
                  <Icon name="ban" size={13} />
                </button>
              </div>
            </article>
          );
        })}
      </div>
    </aside>
  );
}

interface WebGameSidebarProps {
  blockedPlayers: WebBlockedPlayer[];
  entries: WebChatEntry[];
  isOpen: boolean;
  language: WebLanguage;
  projection: PublicGameProjection;
  text: WebTexts;
  onClose: () => void;
}

function WebGameSidebar({ blockedPlayers, entries, isOpen, language, projection, text, onClose }: WebGameSidebarProps) {
  const blockedPlayerIds = new Set(blockedPlayers.map((entry) => entry.playerId));
  const sidebarCommands = webSidebarCommands(language);
  const visibleLeaderboard = projection.leaderboard.filter((row) => (
    row.status !== 'blocked'
    && row.status !== 'kicked'
    && !blockedPlayerIds.has(row.playerId)
  ));
  const visibleParticipants = projection.participantPanel.filter((row) => (
    row.status !== 'blocked'
    && row.status !== 'kicked'
    && !blockedPlayerIds.has(row.playerId)
  ));

  return (
    <aside className={`web-game-sidebar ${isOpen ? 'web-game-sidebar-open' : ''}`} aria-hidden={!isOpen}>
      <header>
        <strong>{text.openPanel}</strong>
        <button className="web-icon-button" type="button" title={text.close} onClick={onClose}>
          <Icon name="x" size={18} />
        </button>
      </header>

      <section>
        <h2>{text.commands}</h2>
        <div className="web-command-grid" aria-label={text.commands}>
          {sidebarCommands.map((command) => (
            <code key={command}>{command}</code>
          ))}
        </div>
      </section>

      <section>
        <h2>{text.leaderboard}</h2>
        <div className="web-sidebar-list">
          {visibleLeaderboard.length === 0 ? (
            <span>{text.noLeaders}</span>
          ) : visibleLeaderboard.slice(0, 12).map((row) => (
            <div className="web-sidebar-row" key={row.playerId}>
              <span>#{row.rank} {row.displayName}</span>
              <strong>{row.score}</strong>
            </div>
          ))}
        </div>
      </section>

      <section>
        <h2>{text.players}</h2>
        <div className="web-sidebar-list">
          {visibleParticipants.length === 0 ? (
            <span>{text.noPlayers}</span>
          ) : visibleParticipants.slice(0, 16).map((row) => (
            <div className="web-sidebar-row" key={row.playerId}>
              <span>{row.displayName}</span>
              <strong>{row.buffer || '...'}</strong>
            </div>
          ))}
        </div>
      </section>

      <section>
        <h2>{text.found}</h2>
        <div className="web-sidebar-list">
          {projection.foundWords.length === 0 ? (
            <span>{text.noWords}</span>
          ) : projection.foundWords.slice(0, 16).map((word) => (
            <div className="web-sidebar-row" key={word.id}>
              <span>{word.canonical}</span>
              <strong>{word.points}</strong>
            </div>
          ))}
        </div>
      </section>

      <section>
        <h2>{text.events}</h2>
        <div className="web-sidebar-list">
          {entries.length === 0 ? (
            <span>{text.noEvents}</span>
          ) : entries.map((entry) => (
            <article className="web-chat-entry" key={entry.id}>
              <div>
                <strong>{entry.displayName}</strong>
                <time>{formatTime(entry.createdAt)}</time>
              </div>
              <code>{entry.text}</code>
              {entry.summaries.slice(0, 2).map((summary) => (
                <span key={summary}>{summary}</span>
              ))}
            </article>
          ))}
        </div>
      </section>
    </aside>
  );
}

function WebBlocklistModal({
  blockedPlayers,
  text,
  onClose,
  onUnblock,
}: {
  blockedPlayers: WebBlockedPlayer[];
  text: WebTexts;
  onClose: () => void;
  onUnblock: (playerId: PlayerId) => void;
}) {
  return (
    <div className="web-modal-backdrop" role="presentation">
      <section className="web-blocklist-modal" aria-label={text.blockedPlayers}>
        <header>
          <div>
            <h2>{text.blockedPlayers}</h2>
          </div>
          <button className="web-icon-button" type="button" title={text.close} onClick={onClose}>
            <Icon name="x" size={18} />
          </button>
        </header>

        <p>{text.localBanHint}</p>

        <div className="web-blocklist-list">
          {blockedPlayers.length === 0 ? (
            <span>{text.noBlockedPlayers}</span>
          ) : blockedPlayers.map((player) => (
            <article className="web-blocklist-row" key={player.playerId}>
              <div>
                <strong>{player.displayName}</strong>
                {isDifferentTwitchLogin(player.displayName, player.login) ? <small>{player.login}</small> : null}
              </div>
              <button className="web-secondary-button" type="button" onClick={() => onUnblock(player.playerId)}>
                {text.unblockPlayer}
              </button>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}

function WebHowToPlayModal({ text, onClose }: { text: WebTexts; onClose: () => void }) {
  return (
    <div className="web-modal-backdrop" role="presentation">
      <section className="web-how-modal" aria-label={text.howToPlayTitle}>
        <header>
          <div>
            <h2>{text.howToPlayTitle}</h2>
          </div>
          <button className="web-icon-button" type="button" title={text.close} onClick={onClose}>
            <Icon name="x" size={18} />
          </button>
        </header>

        <p>{text.howToPlayIntro}</p>

        <div className="web-how-content">
          <div className="web-command-list">
            <div><code>!играть</code><span>{text.commandJoin}</span></div>
            <div><code>!п3</code><span>{text.commandMove}</span></div>
            <div><code>!слово</code><span>{text.commandSubmit}</span></div>
            <div><code>!сброс</code><span>{text.commandReset}</span></div>
            <div><code>!уйти</code><span>{text.commandQuit}</span></div>
          </div>

          <div className="web-how-demo">
            <strong>{text.commandDemo}</strong>
            <WebMiniBoardDemo word="муха" variant="how" />
          </div>
        </div>
      </section>
    </div>
  );
}

function WebMiniBoardDemo({ word, variant }: { word: 'комар' | 'муха'; variant: 'home' | 'how' }) {
  const letters = variant === 'home'
    ? [' ', 'Л', 'Е', 'К', 'С', 'Т', 'Ж', 'И', 'Н', 'П', 'У', 'В', 'Д', 'М', 'Г', 'О', 'Ч', 'Б', 'Ц', 'А', 'Ш', 'Э', 'Ю', 'Р']
    : [' ', 'Р', 'М', 'С', 'О', 'Л', 'К', 'Е', 'Т', 'Н', 'И', 'В', 'Ж', 'Б', 'У', 'Д', 'Г', 'Х', 'Ф', 'Ц', 'П', 'Ш', 'З', 'А'];
  const commands = word === 'муха' ? ['!п2', '!н2', '!п3', '!н1'] : [];
  const collectedLetters = word === 'комар' ? ['К', 'О', 'М', 'А', 'Р'] : [];
  const visitedIndexes = word === 'комар' ? [3, 15, 13, 19, 23] : [2, 14, 17, 23];

  return (
    <div className={`web-mini-demo web-mini-demo-${variant}`} aria-hidden="true">
      <div className="web-mini-board">
        {letters.map((letter, index) => (
          <span
            className={webMiniCellClassName(letter, index, visitedIndexes)}
            key={`${letter}:${index}`}
          >
            {letter}
          </span>
        ))}
        <i className={`web-mini-frog web-mini-frog-${word}`}>
          <FrogMascot detail="simple" />
        </i>
      </div>
      {collectedLetters.length > 0 ? (
        <div className="web-mini-word">
          {collectedLetters.map((letter, index) => (
            <span className={`web-mini-word-letter web-mini-word-letter-${index}`} key={`${letter}:${index}`}>
              {letter}
            </span>
          ))}
        </div>
      ) : null}
      <div className="web-mini-commands">
        {commands.map((command, index) => (
          <code className={`web-mini-command web-mini-command-${index}`} key={`${command}:${index}`}>
            {command}
          </code>
        ))}
      </div>
    </div>
  );
}

function webMiniCellClassName(letter: string, index: number, visitedIndexes: number[]): string {
  const classes = [letter === ' ' ? 'web-mini-empty' : ''];
  const visitedIndex = visitedIndexes.indexOf(index);
  if (visitedIndex >= 0) {
    classes.push('web-mini-visited', `web-mini-visited-${visitedIndex}`);
  }

  return classes.filter(Boolean).join(' ');
}

function isDifferentTwitchLogin(displayName: string, login: string): boolean {
  return displayName.trim().toLocaleLowerCase() !== login.trim().toLocaleLowerCase();
}

interface WebLanguageMenuProps {
  language: WebLanguage;
  text: WebTexts;
  onChange: (language: WebLanguage) => void;
}

function WebLanguageMenu({ language, text, onChange }: WebLanguageMenuProps) {
  const [isOpen, setIsOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    function handlePointerDown(event: PointerEvent): void {
      if (!menuRef.current?.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }

    document.addEventListener('pointerdown', handlePointerDown);
    return () => document.removeEventListener('pointerdown', handlePointerDown);
  }, [isOpen]);

  function chooseLanguage(nextLanguage: WebLanguage): void {
    onChange(nextLanguage);
    setIsOpen(false);
  }

  return (
    <div className={isOpen ? 'web-language-menu web-language-menu-open' : 'web-language-menu'} ref={menuRef}>
      <button
        aria-expanded={isOpen}
        aria-label={text.language}
        className="web-language-trigger"
        type="button"
        onClick={() => setIsOpen((current) => !current)}
      >
        {language.toUpperCase()}
      </button>
      {isOpen ? (
        <div className="web-language-popover">
          <button type="button" onClick={() => chooseLanguage('ru')}>{text.russian}</button>
          <button type="button" onClick={() => chooseLanguage('en')}>{text.english}</button>
        </div>
      ) : null}
    </div>
  );
}

function WebNoticeToast({ notice, onDismiss }: { notice: WebNotice; onDismiss: () => void }) {
  const onDismissRef = useRef(onDismiss);

  useEffect(() => {
    onDismissRef.current = onDismiss;
  }, [onDismiss]);

  useEffect(() => {
    const timeout = window.setTimeout(() => onDismissRef.current(), notice.kind === 'error' ? 6500 : 5200);
    return () => window.clearTimeout(timeout);
  }, [notice.kind, notice.message]);

  return (
    <div className={`web-notice web-notice-${notice.kind}`} role={notice.kind === 'error' ? 'alert' : 'status'}>
      <span>{notice.message}</span>
      <button className="web-icon-button" type="button" title="Dismiss" onClick={onDismiss}>
        <Icon name="x" size={16} />
      </button>
    </div>
  );
}

interface PublicGameViewProps {
  round: RoundState;
  notifications?: GameNotification[];
  mode: 'embedded' | 'standalone';
  onReset?: () => void;
  eyebrow?: string;
}

function PublicGameView({ round, notifications = [], mode, onReset, eyebrow }: PublicGameViewProps) {
  const publicProjection = useMemo(() => createPublicGameProjection(round, { locale: 'ru' }), [round]);
  const markersByCell = useMemo(() => groupMarkersByCell(publicProjection), [publicProjection]);
  const surfaceClassName = mode === 'standalone' ? 'game-view-surface' : 'game-surface';
  const publicNotifications = notifications.slice(0, MAX_PUBLIC_NOTIFICATIONS);

  return (
    <section className={surfaceClassName} aria-label={mode === 'standalone' ? 'Public game view' : 'Public game preview'}>
      <header className="round-header">
        <div>
          <p className="eyebrow">{eyebrow ?? (mode === 'standalone' ? 'FrogWord game view' : 'FrogWord local round')}</p>
          <h1>{publicProjection.themeTitle}</h1>
        </div>
        <div className="round-actions">
          <div className="status-pill">{publicProjection.roundStatus}</div>
          {onReset ? (
            <button className="icon-button" type="button" title="New local round" onClick={onReset}>
              <Icon name="refresh" size={18} />
            </button>
          ) : null}
        </div>
      </header>

      <PublicNotificationStack notifications={publicNotifications} />

      <div className="play-layout">
        <section className="board-zone" aria-label="Board">
          <div
            className="board-grid"
            style={boardGridStyle(publicProjection.board.width, publicProjection.board.height)}
          >
            {publicProjection.board.cells.flatMap((row) => (
              row.map((cell) => {
                const markers = markersByCell.get(coordKey(cell.row, cell.col)) ?? [];
                return (
                  <div className={`board-cell board-cell-${cell.kind}`} key={cell.id}>
                    {cell.kind === 'letter' ? <span>{cell.char}</span> : null}
                    {markers.length > 0 ? (
                      <div className="marker-stack">
                        {markers.slice(0, 3).map((marker) => (
                          <div
                            className="player-marker"
                            key={marker.playerId}
                            style={markerStyle(marker.markerColor)}
                            title={marker.displayName}
                          >
                            {marker.displayName.slice(0, 1).toUpperCase()}
                          </div>
                        ))}
                      </div>
                    ) : null}
                  </div>
                );
              })
            ))}
          </div>
        </section>

        <aside className="score-column" aria-label="Public score panel">
          <section className="panel">
            <div className="panel-title">
              <Icon name="award" size={17} />
              <h2>Leaderboard</h2>
            </div>
            <div className="leaderboard-list">
              {publicProjection.leaderboard.slice(0, 6).map((row) => (
                <div className="leaderboard-row" key={row.playerId}>
                  <span className="rank">#{row.rank}</span>
                  <span className="name">{row.displayName}</span>
                  <strong>{row.score}</strong>
                </div>
              ))}
            </div>
          </section>

          <section className="panel">
            <div className="panel-title">
              <Icon name="message" size={17} />
              <h2>Players</h2>
            </div>
            <div className="participant-list">
              {publicProjection.participantPanel.map((row) => (
                <div className="participant-row" key={row.playerId}>
                  <div className="participant-main">
                    <span className="marker-dot" style={markerStyle(row.markerColor)} />
                    <span>{row.displayName}</span>
                    {row.flags.includes('deadEnd') ? <Icon name="octagon-alert" className="flag-icon" size={15} /> : null}
                  </div>
                  <div className="buffer">{row.buffer || '...'}</div>
                </div>
              ))}
            </div>
          </section>

          <section className="panel">
            <div className="panel-title">
              <Icon name="crown" size={17} />
              <h2>Found</h2>
            </div>
            <div className="found-list">
              {publicProjection.foundWords.length === 0 ? (
                <div className="empty-state">No words yet</div>
              ) : publicProjection.foundWords.map((word) => (
                <div className="found-row" key={word.id}>
                  <span>{word.canonical}</span>
                  <strong>{word.points}</strong>
                </div>
              ))}
            </div>
          </section>
        </aside>
      </div>
    </section>
  );
}

interface NotificationPanelProps {
  notifications: GameNotification[];
  onClear: () => void;
  onDismiss: (id: string) => void;
}

function NotificationPanel({ notifications, onClear, onDismiss }: NotificationPanelProps) {
  return (
    <section className="panel control-section notification-panel" aria-label="Notifications">
      <div className="panel-title panel-title-spread">
        <div className="panel-title-main">
          <Icon name="triangle-alert" size={17} />
          <h2>Notifications</h2>
        </div>
        <button
          className="icon-button compact-icon-button"
          type="button"
          title="Clear notifications"
          aria-label="Clear notifications"
          disabled={notifications.length === 0}
          onClick={onClear}
        >
          <Icon name="x" size={15} />
        </button>
      </div>

      <div className="notification-list">
        {notifications.length === 0 ? (
          <div className="empty-state">No alerts</div>
        ) : notifications.map((notification) => (
          <article
            className={`notification-card notification-card-${notification.kind}`}
            key={notification.id}
          >
            <div className="notification-main">
              <strong>{notification.title}</strong>
              <time>{formatTime(notification.createdAt)}</time>
            </div>
            <p>{notification.message}</p>
            {notification.raw ? <code>{notification.raw}</code> : null}
            <button
              className="icon-button compact-icon-button notification-dismiss"
              type="button"
              title="Dismiss"
              aria-label="Dismiss"
              onClick={() => onDismiss(notification.id)}
            >
              <Icon name="x" size={14} />
            </button>
          </article>
        ))}
      </div>
    </section>
  );
}

interface StartupRoundChoiceOverlayProps {
  state: StartupRoundChoiceState;
  onContinue: (hydration: LocalRoundHydrationResult) => void;
  onNew: (hydration: LocalRoundHydrationResult) => void;
}

function StartupRoundChoiceOverlay({ state, onContinue, onNew }: StartupRoundChoiceOverlayProps) {
  if (state.status !== 'choosing' && state.status !== 'applying') {
    return null;
  }

  const hydration = state.hydration;
  const stored = hydration?.pendingStoredRound;
  if (!hydration || !stored) {
    return null;
  }

  const isApplying = state.status === 'applying';
  const playerCount = Object.keys(stored.state.players).length;
  const foundCount = stored.state.foundWords.length;
  const scoreTotal = Object.values(stored.state.players).reduce((sum, player) => sum + player.score, 0);

  return (
    <div className="startup-choice-overlay" role="dialog" aria-modal="true" aria-label="Startup round choice">
      <section className="startup-choice-card">
        <div className="panel-title">
          <Icon name="rotate-ccw" size={17} />
          <h2>Saved round</h2>
        </div>

        <div className="startup-choice-main">
          <strong>{stored.state.theme.title}</strong>
          <span>{formatStorageTime(stored.savedAt)}</span>
        </div>

        <div className="startup-choice-stats">
          <span>{playerCount} players</span>
          <span>{foundCount} words</span>
          <span>{scoreTotal} points</span>
          <span>{stored.state.board.width}x{stored.state.board.height}</span>
        </div>

        <div className="startup-choice-actions">
          <button
            className="secondary-button"
            disabled={isApplying}
            type="button"
            onClick={() => onNew(hydration)}
          >
            <Icon name="refresh" size={16} />
            New round
          </button>
          <button
            className="primary-button"
            disabled={isApplying}
            type="button"
            onClick={() => onContinue(hydration)}
          >
            <Icon name="check" size={16} />
            Continue
          </button>
        </div>
      </section>
    </div>
  );
}

interface TwitchAuthPanelProps {
  clientId: string;
  states: TwitchAuthStates;
  onCheck: (role: TwitchAuthRole) => void;
  onClientIdChange: (value: string) => void;
  onStart: (role: TwitchAuthRole) => void;
}

function TwitchAuthPanel({ clientId, states, onCheck, onClientIdChange, onStart }: TwitchAuthPanelProps) {
  return (
    <section className="panel control-section twitch-auth-panel" aria-label="Twitch authorization">
      <div className="panel-title">
        <Icon name="key" size={17} />
        <h2>Twitch auth</h2>
      </div>

      <label className="twitch-client-field">
        <span>Client ID</span>
        <input
          aria-label="Twitch Client ID"
          value={clientId}
          onChange={(event) => onClientIdChange(event.currentTarget.value)}
        />
      </label>

      <div className="twitch-role-list">
        {TWITCH_AUTH_ROLES.map((definition) => (
          <TwitchAuthRoleCard
            definition={definition}
            key={definition.role}
            state={states[definition.role]}
            clientId={clientId}
            onCheck={() => onCheck(definition.role)}
            onStart={() => onStart(definition.role)}
          />
        ))}
      </div>
    </section>
  );
}

interface TwitchAuthRoleCardProps {
  clientId: string;
  definition: typeof TWITCH_AUTH_ROLES[number];
  state: TwitchAuthRoleState;
  onCheck: () => void;
  onStart: () => void;
}

function TwitchAuthRoleCard({ clientId, definition, state, onCheck, onStart }: TwitchAuthRoleCardProps) {
  const hasDevice = state.status === 'device' || state.status === 'checking' || state.status === 'error';
  const device = hasDevice ? state.device : undefined;
  const canCheck = Boolean(device) && state.status !== 'checking';
  const canStart = Boolean(clientId.trim()) && state.status !== 'requesting' && state.status !== 'checking';

  return (
    <article className={`twitch-role-card twitch-role-${state.status}`}>
      <div className="twitch-role-main">
        <div>
          <strong>{definition.title}</strong>
          <span>{definition.description}</span>
        </div>
        <span className={`twitch-status twitch-status-${state.status}`}>{twitchRoleStatusLabel(state)}</span>
      </div>

      <div className="twitch-scope-row">
        {definition.scopes.map((scope) => <span key={scope}>{scope}</span>)}
      </div>

      {device ? (
        <div className="twitch-device-box">
          <code>{device.userCode}</code>
          <span>{device.verificationUri}</span>
          {'message' in state && state.message ? <em>{state.message}</em> : null}
        </div>
      ) : null}

      {state.status === 'authorized' ? (
        <div className="twitch-token-summary">
          <span>{state.validation?.login ?? 'authorized'}</span>
          <span>{state.token.expiresIn}s</span>
        </div>
      ) : null}

      {state.status === 'error' ? (
        <div className="twitch-error-text">{state.message}</div>
      ) : null}

      <div className="twitch-role-actions">
        <button
          className="secondary-button"
          disabled={!canStart}
          type="button"
          onClick={onStart}
        >
          <Icon name="copy" size={16} />
          {state.status === 'requesting' ? 'Starting' : 'Start'}
        </button>
        <button
          className="primary-button"
          disabled={!canCheck}
          type="button"
          onClick={onCheck}
        >
          <Icon name="check" size={16} />
          {state.status === 'checking' ? 'Checking' : 'Check'}
        </button>
      </div>
    </article>
  );
}

interface TwitchChatPanelProps {
  channel: string;
  readerState: TwitchAuthRoleState;
  state: TwitchChatUiState;
  onChannelChange: (value: string) => void;
  onConnect: () => void;
  onDisconnect: () => void;
}

function TwitchChatPanel({
  channel,
  readerState,
  state,
  onChannelChange,
  onConnect,
  onDisconnect,
}: TwitchChatPanelProps) {
  const normalizedChannel = normalizeTwitchChannel(channel);
  const readerLogin = readerState.status === 'authorized'
    ? readerState.validation?.login ?? ''
    : '';
  const displayedChannel = readerLogin || channel;
  const canConnect = readerState.status === 'authorized'
    && Boolean(readerLogin || normalizedChannel)
    && state.status !== 'connecting'
    && state.status !== 'reconnecting';
  const canDisconnect = state.status === 'connecting' || state.status === 'connected' || state.status === 'reconnecting';
  const readerLabel = readerState.status === 'authorized'
    ? readerLogin || 'authorized'
    : 'not authorized';
  const channelLabel = readerLogin
    ? `#${readerLogin}`
    : normalizedChannel
      ? `#${normalizedChannel}`
      : 'reader auth required';

  return (
    <section className="panel control-section twitch-chat-panel" aria-label="Twitch chat">
      <div className="panel-title panel-title-spread">
        <div className="panel-title-main">
          <Icon name="radio" size={17} />
          <h2>Twitch chat</h2>
        </div>
        <span className={`twitch-chat-status twitch-chat-status-${state.status}`}>
          {twitchChatStatusLabel(state)}
        </span>
      </div>

      <label className="twitch-channel-field">
        <span>Streamer channel</span>
        <input
          aria-label="Twitch channel"
          disabled={Boolean(readerLogin)}
          placeholder="from Chat reader"
          value={displayedChannel}
          onChange={(event) => onChannelChange(event.currentTarget.value)}
        />
      </label>

      <div className="twitch-chat-meta">
        <span>Reader: {readerLabel}</span>
        <span>{channelLabel}</span>
      </div>

      <div className="twitch-chat-actions">
        <button
          className="primary-button"
          disabled={!canConnect}
          type="button"
          onClick={onConnect}
        >
          <Icon name="radio" size={16} />
          {state.status === 'connecting' ? 'Connecting' : 'Reconnect'}
        </button>
        <button
          className="secondary-button"
          disabled={!canDisconnect}
          type="button"
          onClick={onDisconnect}
        >
          <Icon name="radio-off" size={16} />
          Disconnect
        </button>
      </div>

      <TwitchChatSummary state={state} />
    </section>
  );
}

function TwitchChatSummary({ state }: { state: TwitchChatUiState }) {
  if (state.status === 'idle') {
    return <div className="empty-state twitch-chat-empty">No chat connection</div>;
  }

  if (state.status === 'error') {
    return <div className="twitch-chat-summary twitch-chat-summary-error">{state.message}</div>;
  }

  if (state.status === 'connected') {
    return (
      <div className="twitch-chat-summary twitch-chat-summary-connected">
        <span>#{state.channel}</span>
        {state.lastMessageFrom && state.lastMessageAt ? (
          <span>{state.lastMessageFrom} · {formatTime(state.lastMessageAt)}</span>
        ) : (
          <span>{state.message ?? 'Connected'}</span>
        )}
      </div>
    );
  }

  if (state.status === 'reconnecting') {
    return (
      <div className="twitch-chat-summary twitch-chat-summary-reconnecting">
        <span>#{state.channel}</span>
        <span>Retry {state.attempt}</span>
        <span>{formatDelay(state.delayMs)}</span>
      </div>
    );
  }

  return (
    <div className="twitch-chat-summary">
      {'channel' in state && state.channel ? <span>#{state.channel}</span> : null}
      {'message' in state && state.message ? <span>{state.message}</span> : <span>{twitchChatStatusLabel(state)}</span>}
    </div>
  );
}

function twitchRoleStatusLabel(state: TwitchAuthRoleState): string {
  switch (state.status) {
    case 'idle':
      return 'idle';
    case 'requesting':
      return 'starting';
    case 'device':
      return 'code ready';
    case 'checking':
      return 'checking';
    case 'authorized':
      return 'authorized';
    case 'error':
      return 'error';
  }
}

function twitchChatStatusLabel(state: TwitchChatUiState): string {
  switch (state.status) {
    case 'idle':
      return 'idle';
    case 'connecting':
      return 'connecting';
    case 'reconnecting':
      return 'reconnecting';
    case 'connected':
      return 'connected';
    case 'disconnected':
      return 'disconnected';
    case 'error':
      return 'error';
  }
}

interface AuditLogPanelProps {
  entries: AuditLogEntry[];
  filter: AuditLogFilter;
  onClear: () => void;
  onFilterChange: (filter: AuditLogFilter) => void;
}

function AuditLogPanel({ entries, filter, onClear, onFilterChange }: AuditLogPanelProps) {
  const filteredEntries = filterAuditEntries(entries, filter);

  return (
    <section className="panel audit-panel" aria-label="Audit log">
      <div className="panel-title panel-title-spread">
        <div className="panel-title-main">
          <Icon name="message" size={17} />
          <h2>Audit log</h2>
        </div>
        <button
          className="icon-button compact-icon-button"
          type="button"
          title="Clear audit log"
          aria-label="Clear audit log"
          disabled={entries.length === 0}
          onClick={onClear}
        >
          <Icon name="x" size={15} />
        </button>
      </div>

      <div className="audit-filter-row" aria-label="Audit filters">
        {AUDIT_LOG_FILTERS.map((item) => (
          <button
            aria-pressed={filter === item.value}
            className={filter === item.value ? 'audit-filter audit-filter-active' : 'audit-filter'}
            key={item.value}
            type="button"
            onClick={() => onFilterChange(item.value)}
          >
            {item.label}
          </button>
        ))}
      </div>

      <div className="audit-list">
        {filteredEntries.length === 0 ? (
          <div className="empty-state">No audit entries</div>
        ) : filteredEntries.map((entry) => (
          <article
            className={`audit-entry audit-entry-${entry.category} audit-entry-${entry.tone}`}
            key={entry.id}
          >
            <div className="audit-entry-top">
              <strong>{entry.title}</strong>
              <time>{formatTime(entry.occurredAt)}</time>
            </div>
            {entry.detail ? <p>{entry.detail}</p> : null}
            <div className="audit-entry-meta">
              <span>{entry.source}</span>
              <span>{entry.type}</span>
              {entry.playerDisplayName ? <span>{entry.playerDisplayName}</span> : null}
              {entry.chips.slice(0, 4).map((chip) => (
                <span key={chip}>{chip}</span>
              ))}
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

interface ThemeBankImportSummaryProps {
  state: ThemeBankImportState;
}

interface ThemeCatalogOptionGroup {
  key: string;
  label: string;
  entries: ThemeCatalogEntry[];
}

function themeCatalogOptionGroups(entries: readonly ThemeCatalogEntry[]): ThemeCatalogOptionGroup[] {
  const specs: { source: ThemeCatalogEntry['source']; language: 'ru' | 'en'; label: string }[] = [
    { source: 'starter', language: 'ru', label: 'Starter RU' },
    { source: 'starter', language: 'en', label: 'Starter EN' },
    { source: 'imported', language: 'ru', label: 'Imported RU' },
    { source: 'imported', language: 'en', label: 'Imported EN' },
    { source: 'user', language: 'ru', label: 'User RU' },
    { source: 'user', language: 'en', label: 'User EN' },
  ];

  return specs.flatMap((spec) => {
    const groupEntries = entries.filter((entry) => entry.source === spec.source && entry.language === spec.language);
    return groupEntries.length > 0
      ? [{
        key: `${spec.source}:${spec.language}`,
        label: spec.label,
        entries: groupEntries,
      }]
      : [];
  });
}

function themeSourceLabel(source: ThemeCatalogEntry['source'] | undefined): string {
  switch (source) {
    case 'starter':
      return 'starter';
    case 'imported':
      return 'imported';
    case 'user':
      return 'user';
    default:
      return 'loaded';
  }
}

function ThemeBankImportSummary({ state }: ThemeBankImportSummaryProps) {
  if (state.status === 'idle') {
    return <div className="empty-state theme-bank-empty">No file selected</div>;
  }

  if (state.status === 'error') {
    return (
      <div className="theme-bank-summary theme-bank-summary-error">
        <strong>{state.fileName ?? 'Theme bank'}</strong>
        <div className="theme-bank-issues">
          {state.issues.slice(0, 4).map((issue, index) => (
            <span key={`${issue}:${index}`}>{issue}</span>
          ))}
          {state.issues.length > 4 ? <span>{state.issues.length - 4} more errors</span> : null}
        </div>
      </div>
    );
  }

  const statusLabel = state.status === 'imported'
    ? 'Imported'
    : state.status === 'importing'
      ? 'Importing'
      : 'Ready';

  return (
    <div className={`theme-bank-summary theme-bank-summary-${state.status}`}>
      <div className="theme-bank-summary-main">
        <strong>{state.preview.packId}</strong>
        <span>{state.fileName}</span>
      </div>
      <div className="theme-bank-kpis">
        <span>{statusLabel}</span>
        <span>{state.preview.themeCount} themes</span>
        <span>{state.preview.wordCount} words</span>
        <span>{state.preview.languageCounts.ru} RU / {state.preview.languageCounts.en} EN</span>
      </div>
      {state.preview.sampleThemes.length > 0 ? (
        <div className="theme-bank-samples">
          {state.preview.sampleThemes.map((title) => (
            <span key={title}>{title}</span>
          ))}
        </div>
      ) : null}
    </div>
  );
}

interface PublicNotificationStackProps {
  notifications: GameNotification[];
}

function PublicNotificationStack({ notifications }: PublicNotificationStackProps) {
  if (notifications.length === 0) {
    return null;
  }

  return (
    <section className="notification-stack" aria-label="Game notifications">
      {notifications.map((notification) => (
        <article className={`notification-toast notification-toast-${notification.kind}`} key={notification.id}>
          <div>
            <strong>{notification.title}</strong>
            <span>{notification.message}</span>
          </div>
          {notification.raw ? <code>{notification.raw}</code> : null}
        </article>
      ))}
    </section>
  );
}

function useSyncedPublicSnapshot(): RendererSnapshot {
  const [snapshot, setSnapshot] = useState(
    () => loadFallbackSnapshot() ?? createRendererSnapshot(createDefaultLocalRound(LOCAL_ROUND_ID), []),
  );

  useEffect(() => {
    let cleanup: (() => void) | undefined;
    let disposed = false;
    const retryIds: number[] = [];

    function applySnapshot(payload: unknown): void {
      const nextSnapshot = coerceRendererSnapshot(payload);
      if (!nextSnapshot) {
        return;
      }

      setSnapshot(nextSnapshot);
    }

    const fallbackSnapshot = loadFallbackSnapshot();
    if (fallbackSnapshot) {
      setSnapshot(fallbackSnapshot);
    }

    void subscribeRendererSnapshots(applySnapshot).then((unsubscribe) => {
      if (disposed) {
        unsubscribe();
        return;
      }

      cleanup = unsubscribe;
      void requestRendererSnapshot();
    });

    if (typeof window !== 'undefined') {
      retryIds.push(window.setTimeout(() => void requestRendererSnapshot(), 250));
      retryIds.push(window.setTimeout(() => void requestRendererSnapshot(), 1000));
    }

    return () => {
      disposed = true;
      cleanup?.();
      for (const retryId of retryIds) {
        window.clearTimeout(retryId);
      }
    };
  }, []);

  return snapshot;
}

function isPublicGameViewRoute(): boolean {
  if (typeof window === 'undefined') {
    return false;
  }

  return window.location.pathname.includes(PUBLIC_ROUTE_TOKEN)
    || window.location.hash.includes(PUBLIC_ROUTE_TOKEN);
}

function isAnonymousWebPlayRoute(): boolean {
  if (typeof window === 'undefined') {
    return false;
  }

  return window.location.pathname.includes(WEB_PLAY_ROUTE_TOKEN)
    || window.location.hash.includes(WEB_PLAY_ROUTE_TOKEN);
}

function webRouteFromLocation(): WebRoute {
  if (typeof window === 'undefined') {
    return 'home';
  }

  return /(?:^#\/?|\/)(?:play|game)(?:$|[/?#])/u.test(window.location.hash)
    ? 'game'
    : 'home';
}

function writeWebRoute(route: WebRoute): void {
  if (typeof window === 'undefined') {
    return;
  }

  const hash = IS_PAGES_BUILD
    ? (route === 'game' ? '#/play' : '#/')
    : (route === 'game' ? '#/web-play/play' : '#/web-play');
  const nextUrl = `${window.location.pathname}${window.location.search}${hash}`;
  window.history.pushState(null, '', nextUrl);
}

function useElementSize(ref: RefObject<HTMLElement | null>): ElementSize | undefined {
  const [size, setSize] = useState<ElementSize | undefined>();

  useEffect(() => {
    const element = ref.current;
    if (!element) {
      return undefined;
    }

    function updateSize(width: number, height: number): void {
      setSize((current) => (
        current?.width === width && current.height === height
          ? current
          : { width, height }
      ));
    }

    const rect = element.getBoundingClientRect();
    updateSize(rect.width, rect.height);

    if (typeof ResizeObserver === 'undefined') {
      return undefined;
    }

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) {
        return;
      }

      updateSize(entry.contentRect.width, entry.contentRect.height);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref]);

  return size;
}

function useAnimatedMarkerCoord(
  marker: PublicGameProjection['players'][number],
  animation: WebMarkerAnimation | undefined,
  onAnimationComplete: ((playerId: PlayerId, animationId: string) => void) | undefined,
): Coord {
  const [coord, setCoord] = useState<Coord>({ row: marker.row, col: marker.col });
  const onAnimationCompleteRef = useRef(onAnimationComplete);

  useEffect(() => {
    onAnimationCompleteRef.current = onAnimationComplete;
  }, [onAnimationComplete]);

  useEffect(() => {
    if (!animation || animation.steps.length === 0) {
      setCoord((current) => (
        current.row === marker.row && current.col === marker.col
          ? current
          : { row: marker.row, col: marker.col }
      ));
      return undefined;
    }

    const timers = animation.steps.map((step, index) => (
      window.setTimeout(() => setCoord(step), index * WEB_MARKER_STEP_MS)
    ));
    timers.push(window.setTimeout(() => {
      onAnimationCompleteRef.current?.(marker.playerId, animation.id);
    }, animation.steps.length * WEB_MARKER_STEP_MS + WEB_MARKER_ANIMATION_SETTLE_MS));

    return () => {
      for (const timer of timers) {
        window.clearTimeout(timer);
      }
    };
  }, [animation?.id, marker.col, marker.playerId, marker.row]);

  return coord;
}

function createWebPlayRound(theme: Theme, settings: WebPlaySettings): RoundState {
  const seed = `web-${theme.id}-${Date.now()}`;
  const boardTemplate = createRectTemplate(
    settings.boardWidth,
    settings.boardHeight,
    `web-play-${settings.boardWidth}x${settings.boardHeight}`,
  );
  const board = createRouteAwareBoard({
    template: boardTemplate,
    theme,
    rng: createRng(`${seed}:board`),
    seed,
  });

  return createRound({
    id: seed,
    theme,
    boardTemplate,
    board,
    seed,
    settings: {
      maxJumpDistance: 'unlimited',
      warnOnDeadEnd: true,
    },
  });
}

function defaultWebPlaySettings(): WebPlaySettings {
  return {
    channel: '',
    themeId: '',
    language: 'ru',
    boardWidth: WEB_DEFAULT_BOARD_WIDTH,
    boardHeight: WEB_DEFAULT_BOARD_HEIGHT,
  };
}

function loadWebPlaySettings(): WebPlaySettings {
  if (typeof window === 'undefined') {
    return defaultWebPlaySettings();
  }

  try {
    const parsed = JSON.parse(window.localStorage.getItem(WEB_SETTINGS_STORAGE_KEY) ?? '{}') as Partial<WebPlaySettings>;
    const storedSettings: Partial<WebPlaySettings> = {
      channel: typeof parsed.channel === 'string' ? parsed.channel : '',
      themeId: typeof parsed.themeId === 'string' ? parsed.themeId : '',
      language: normalizeWebLanguage(parsed.language),
    };
    if (typeof parsed.boardWidth === 'number') {
      storedSettings.boardWidth = parsed.boardWidth;
    }
    if (typeof parsed.boardHeight === 'number') {
      storedSettings.boardHeight = parsed.boardHeight;
    }
    return normalizeWebPlaySettings(storedSettings);
  } catch {
    return defaultWebPlaySettings();
  }
}

function normalizeWebPlaySettings(settings: Partial<WebPlaySettings>, themes: readonly Theme[] = []): WebPlaySettings {
  const defaults = defaultWebPlaySettings();
  const themeId = typeof settings.themeId === 'string' ? settings.themeId : defaults.themeId;
  const resolvedThemeId = themeId === WEB_RANDOM_THEME_ID
    ? WEB_RANDOM_THEME_ID
    : themes.length > 0 && !themes.some((theme) => theme.id === themeId)
    ? themes[0]!.id
    : themeId;

  return {
    channel: typeof settings.channel === 'string' ? settings.channel : defaults.channel,
    themeId: resolvedThemeId,
    language: normalizeWebLanguage(settings.language),
    boardWidth: clampWebDimension(
      settings.boardWidth,
      WEB_MIN_BOARD_WIDTH,
      WEB_MAX_BOARD_WIDTH,
      defaults.boardWidth,
    ),
    boardHeight: clampWebDimension(
      settings.boardHeight,
      WEB_MIN_BOARD_HEIGHT,
      WEB_MAX_BOARD_HEIGHT,
      defaults.boardHeight,
    ),
  };
}

function pickWebThemeForRound(themeId: string, themes: readonly Theme[]): Theme | undefined {
  if (themes.length === 0) {
    return undefined;
  }

  if (themeId === WEB_RANDOM_THEME_ID) {
    return themes[Math.floor(Math.random() * themes.length)] ?? themes[0];
  }

  return themes.find((theme) => theme.id === themeId) ?? themes[0];
}

function normalizeWebLanguage(value: unknown): WebLanguage {
  return WEB_LANGUAGES.includes(value as WebLanguage) ? value as WebLanguage : 'ru';
}

function clampWebDimension(value: unknown, min: number, max: number, fallback: number): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  return Math.max(min, Math.min(max, Math.round(parsed)));
}

function saveWebPlaySettings(settings: WebPlaySettings): void {
  if (typeof window === 'undefined') {
    return;
  }

  window.localStorage.setItem(WEB_SETTINGS_STORAGE_KEY, JSON.stringify(settings));
}

function loadWebBlocklist(channel: string): WebBlockedPlayer[] {
  if (typeof window === 'undefined') {
    return [];
  }

  try {
    const parsed = JSON.parse(window.localStorage.getItem(webBlocklistStorageKey(channel)) ?? '[]') as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed.flatMap((entry): WebBlockedPlayer[] => {
      if (!entry || typeof entry !== 'object') {
        return [];
      }
      const candidate = entry as Partial<WebBlockedPlayer>;
      if (
        typeof candidate.playerId !== 'string'
        || typeof candidate.login !== 'string'
        || typeof candidate.displayName !== 'string'
        || typeof candidate.blockedAt !== 'string'
      ) {
        return [];
      }

      return [{
        playerId: candidate.playerId,
        login: candidate.login,
        displayName: candidate.displayName,
        blockedAt: candidate.blockedAt,
      }];
    });
  } catch {
    return [];
  }
}

function saveWebBlocklist(channel: string, players: WebBlockedPlayer[]): WebBlockedPlayer[] {
  if (typeof window !== 'undefined') {
    window.localStorage.setItem(webBlocklistStorageKey(channel), JSON.stringify(players));
  }

  return players;
}

function webBlocklistStorageKey(channel: string): string {
  return `${WEB_BLOCKLIST_STORAGE_KEY}:${normalizeTwitchChannel(channel) || 'default'}`;
}

function upsertWebBlockedPlayer(players: WebBlockedPlayer[], player: WebBlockedPlayer): WebBlockedPlayer[] {
  const normalizedLogin = player.login.toLocaleLowerCase();
  return [
    player,
    ...players.filter((entry) => (
      entry.playerId !== player.playerId
      && entry.login.toLocaleLowerCase() !== normalizedLogin
    )),
  ];
}

function isWebPlayerBlocked(players: readonly WebBlockedPlayer[], login: string, playerId: PlayerId): boolean {
  const normalizedLogin = login.toLocaleLowerCase();
  return players.some((entry) => (
    entry.playerId === playerId
    || entry.login.toLocaleLowerCase() === normalizedLogin
  ));
}

function webBoardGridStyle(width: number, height: number, containerSize: ElementSize | undefined): CSSProperties {
  const density = Math.max(width / WEB_DEFAULT_BOARD_WIDTH, height / WEB_DEFAULT_BOARD_HEIGHT, 1);
  const gap = Math.max(1, Math.min(5, Math.round(4 / Math.sqrt(density))));
  const radius = Math.max(2, Math.min(12, Math.round(10 / Math.sqrt(density))));
  const measuredWidth = Math.max(0, Math.floor(containerSize?.width ?? 0));
  const measuredHeight = Math.max(0, Math.floor(containerSize?.height ?? 0));
  const horizontalGaps = gap * Math.max(0, width - 1);
  const verticalGaps = gap * Math.max(0, height - 1);
  const measuredCellSize = measuredWidth > 0 && measuredHeight > 0
    ? Math.max(1, Math.floor(Math.min(
      (measuredWidth - horizontalGaps) / width,
      (measuredHeight - verticalGaps) / height,
    )))
    : undefined;
  const measuredGridWidth = measuredCellSize
    ? measuredCellSize * width + horizontalGaps
    : undefined;
  const measuredGridHeight = measuredCellSize
    ? measuredCellSize * height + verticalGaps
    : undefined;
  const fallbackCellSize = `min(calc((100vw - 36px) / ${width}), calc((100dvh - 82px) / ${height}))`;

  return {
    ...boardGridStyle(width, height),
    '--web-board-cols': width,
    '--web-board-rows': height,
    '--web-board-gap': `${gap}px`,
    '--web-cell-radius': `${radius}px`,
    '--web-cell-px': measuredCellSize ? `${measuredCellSize}px` : fallbackCellSize,
    '--web-cell-font': `clamp(7px, calc(var(--web-cell-px) * 0.52), 38px)`,
    '--web-marker-size': `clamp(12px, calc(var(--web-cell-px) * 0.82), 46px)`,
    ...(measuredGridWidth ? { width: `${measuredGridWidth}px` } : {}),
    ...(measuredGridHeight ? { height: `${measuredGridHeight}px` } : {}),
  } as CSSProperties;
}

function webChatStatusCopy(state: TwitchChatUiState, text: WebTexts): string {
  switch (state.status) {
    case 'connected':
      return text.chatConnected(state.channel);
    case 'connecting':
      return text.chatConnecting;
    case 'reconnecting':
      return text.chatReconnecting(state.attempt);
    case 'disconnected':
      return text.chatDisconnected;
    case 'error':
      return text.chatError;
    case 'idle':
      return text.chatNotConnected;
  }
}

function webSidebarCommands(language: WebLanguage): string[] {
  return language === 'ru'
    ? ['!играть', '!п3', '!л2', '!в2', '!н2', '!слово', '!сброс', '!уйти']
    : ['!play', '!r3', '!l2', '!u2', '!d2', '!word', '!reset', '!quit'];
}

function webNoticeForDomainEvents(
  state: RoundState,
  events: DomainEvent[],
  language: WebLanguage,
): WebNotice | undefined {
  for (const event of events) {
    switch (event.type) {
      case 'command.rejected': {
        const name = displayName(state, event.playerId);
        const raw = sanitizeGameplayRaw(event.raw);
        const reason = webCommandRejectionMessage(event.reason, language);
        return {
          kind: 'error',
          message: language === 'ru'
            ? `${name}: команда не выполнена (${reason})${raw ? `: ${raw}` : ''}`
            : `${name}: command rejected (${reason})${raw ? `: ${raw}` : ''}`,
        };
      }
      case 'submission.rejected': {
        const name = displayName(state, event.playerId);
        const submission = state.rejectedSubmissions.find((entry) => entry.id === event.rejectedId);
        const raw = sanitizeWordFragment(submission?.rawWord);
        const reason = webSubmissionRejectionMessage(event.reason, language);
        return {
          kind: 'warning',
          message: language === 'ru'
            ? `${name}: ${raw ? `"${raw}" ` : 'слово '}не принято (${reason})`
            : `${name}: ${raw ? `"${raw}" ` : 'word '}not accepted (${reason})`,
        };
      }
      case 'player.deadEndDetected': {
        const name = displayName(state, event.playerId);
        const raw = sanitizeWordFragment(event.buffer);
        return {
          kind: 'warning',
          message: language === 'ru'
            ? `${name}: набор${raw ? ` "${raw}"` : ''} не ведёт ни к одному слову`
            : `${name}: ${raw ? `"${raw}" ` : 'this letter chain '}does not lead to any word`,
        };
      }
      case 'hostAction.rejected':
        return {
          kind: 'error',
          message: language === 'ru'
            ? `Действие не выполнено (${webHostActionRejectionMessage(event.reason, language)})`
            : `Action rejected (${webHostActionRejectionMessage(event.reason, language)})`,
        };
      default:
        break;
    }
  }

  return undefined;
}

function webCommandRejectionMessage(reason: string, language: WebLanguage): string {
  if (language !== 'ru') {
    return commandRejectionMessage(reason);
  }

  const messages: Record<string, string> = {
    blocked_path: 'прыжок пересекает заблокированную клетку',
    help_not_implemented: 'команда помощи пока не готова',
    invalid_distance: 'неверная дистанция прыжка',
    jump_too_far: 'слишком дальний прыжок',
    missing_bang: 'сообщение не похоже на команду',
    no_spawn_available: 'нет свободной клетки для входа',
    occupied_cell: 'целевая клетка занята',
    out_of_bounds: 'прыжок выходит за поле',
    player_blocked: 'игрок заблокирован',
    player_kicked: 'игрок кикнут до конца раунда',
    player_not_active: 'игрок не в раунде',
    round_not_running: 'раунд не запущен',
    too_many_moves: 'слишком много прыжков в одном сообщении',
    unknown_command: 'неизвестная команда',
  };
  return messages[reason] ?? humanizeReason(reason);
}

function webSubmissionRejectionMessage(reason: string, language: WebLanguage): string {
  if (language !== 'ru') {
    return submissionRejectionMessage(reason);
  }

  const messages: Record<string, string> = {
    too_short: 'слишком короткое слово',
    word_not_found: 'слова нет в выбранной теме',
  };
  return messages[reason] ?? humanizeReason(reason);
}

function webHostActionRejectionMessage(reason: string, language: WebLanguage): string {
  if (language !== 'ru') {
    return hostActionRejectionMessage(reason);
  }

  const messages: Record<string, string> = {
    player_already_blocked: 'игрок уже заблокирован',
    player_blocked: 'игрок заблокирован',
    player_not_blocked: 'игрок не заблокирован',
    player_not_found: 'игрок не найден',
    player_already_credited: 'игрок уже получил очки за это слово',
    submission_not_found: 'слово не найдено',
    submission_not_pending: 'слово уже обработано',
    word_too_short_for_theme: 'слово слишком короткое для темы',
  };
  return messages[reason] ?? humanizeReason(reason);
}

function webColorFromString(value: string): string {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }

  const palette = [
    '#287f56',
    '#5b9f3a',
    '#d59c2c',
    '#3d8c72',
    '#8a9f35',
    '#2f9d8c',
    '#c27b34',
  ];
  return palette[hash % palette.length]!;
}

function frogMarkerColors(color: string): { markerColor: string; labelColor: string; labelOutline: string } {
  const rgb = parseHexColor(color);
  if (!rgb) {
    return {
      markerColor: 'hsl(142 58% 34%)',
      labelColor: 'hsl(142 38% 92%)',
      labelOutline: 'hsl(142 35% 12% / 0.78)',
    };
  }

  const { hue, saturation, lightness } = rgbToHsl(rgb.r, rgb.g, rgb.b);
  const markerSaturation = Math.max(42, Math.min(84, saturation + 6));
  const markerLightness = normalizedFrogMarkerLightness(hue, lightness);
  const labelSaturation = markerLightness < 50
    ? Math.max(24, Math.min(54, markerSaturation - 18))
    : Math.max(34, Math.min(72, markerSaturation + 4));
  const labelLightness = markerLightness < 50 ? 92 : 16;
  const labelOutlineLightness = markerLightness < 50 ? 12 : 94;
  const labelOutlineAlpha = markerLightness < 50 ? 0.78 : 0.84;

  return {
    markerColor: `hsl(${Math.round(hue)} ${Math.round(markerSaturation)}% ${Math.round(markerLightness)}%)`,
    labelColor: `hsl(${Math.round(hue)} ${Math.round(labelSaturation)}% ${Math.round(labelLightness)}%)`,
    labelOutline: `hsl(${Math.round(hue)} ${Math.round(Math.max(24, labelSaturation - 8))}% ${labelOutlineLightness}% / ${labelOutlineAlpha})`,
  };
}

function normalizedFrogMarkerLightness(hue: number, lightness: number): number {
  if (lightness <= 30) {
    return 34;
  }

  if (lightness >= 70) {
    return 66;
  }

  if (lightness > 40 && lightness < 60) {
    return isWarmHue(hue) ? 66 : 34;
  }

  return lightness < 50 ? 34 : 66;
}

function isWarmHue(hue: number): boolean {
  return hue >= 15 && hue <= 72;
}

function parseHexColor(color: string): { r: number; g: number; b: number } | undefined {
  const normalized = color.trim().replace(/^#/u, '');
  if (!/^[0-9a-f]{6}$/iu.test(normalized)) {
    return undefined;
  }

  return {
    r: Number.parseInt(normalized.slice(0, 2), 16),
    g: Number.parseInt(normalized.slice(2, 4), 16),
    b: Number.parseInt(normalized.slice(4, 6), 16),
  };
}

function rgbToHsl(r: number, g: number, b: number): { hue: number; saturation: number; lightness: number } {
  const red = r / 255;
  const green = g / 255;
  const blue = b / 255;
  const max = Math.max(red, green, blue);
  const min = Math.min(red, green, blue);
  const delta = max - min;
  const lightness = (max + min) / 2;

  if (delta === 0) {
    return { hue: 140, saturation: 0, lightness: lightness * 100 };
  }

  const saturation = delta / (1 - Math.abs(2 * lightness - 1));
  let hue = 0;
  if (max === red) {
    hue = 60 * (((green - blue) / delta) % 6);
  } else if (max === green) {
    hue = 60 * ((blue - red) / delta + 2);
  } else {
    hue = 60 * ((red - green) / delta + 4);
  }

  return {
    hue: hue < 0 ? hue + 360 : hue,
    saturation: saturation * 100,
    lightness: lightness * 100,
  };
}

function FrogBackgroundMark() {
  return <Icon name="frog-sitting" className="web-frog-mark" />;
}

function FrogBackgroundMarkAlt() {
  return <Icon name="frog-top" className="web-frog-mark-alt" />;
}

function createRendererSnapshot(round: RoundState, notifications: GameNotification[]): RendererSnapshot {
  return {
    version: 1,
    round,
    notifications,
  };
}

function loadFallbackSnapshot(): RendererSnapshot | undefined {
  return coerceRendererSnapshot(loadFallbackSnapshotPayload());
}

function coerceRendererSnapshot(payload: unknown): RendererSnapshot | undefined {
  if (isRecord(payload) && isRecord(payload.round)) {
    return createRendererSnapshot(
      payload.round as unknown as RoundState,
      Array.isArray(payload.notifications) ? payload.notifications as GameNotification[] : [],
    );
  }

  if (isRecord(payload) && typeof payload.id === 'string' && isRecord(payload.board)) {
    return createRendererSnapshot(payload as unknown as RoundState, []);
  }

  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

type NotificationSetter = Dispatch<SetStateAction<GameNotification[]>>;

function appendNotifications(
  state: RoundState,
  events: DomainEvent[],
  setNotifications: NotificationSetter,
): void {
  const nextNotifications = events
    .map((event) => createNotificationFromEvent(state, event))
    .filter((notification): notification is GameNotification => Boolean(notification));

  if (nextNotifications.length === 0) {
    return;
  }

  setNotifications((current) => [...nextNotifications, ...current].slice(0, MAX_NOTIFICATIONS));
}

function createNotificationFromEvent(state: RoundState, event: DomainEvent): GameNotification | undefined {
  switch (event.type) {
    case 'command.rejected': {
      const raw = sanitizeGameplayRaw(event.raw);
      return {
        id: notificationId(state, event),
        kind: 'error',
        visibility: 'public',
        title: `${displayName(state, event.playerId)} · command`,
        message: commandRejectionMessage(event.reason),
        createdAt: nowIso(),
        playerId: event.playerId,
        ...(raw ? { raw } : {}),
      };
    }
    case 'submission.rejected': {
      const submission = state.rejectedSubmissions.find((entry) => entry.id === event.rejectedId);
      const raw = sanitizeWordFragment(submission?.rawWord);
      return {
        id: notificationId(state, event),
        kind: 'warning',
        visibility: 'public',
        title: `${displayName(state, event.playerId)} · word`,
        message: submissionRejectionMessage(event.reason),
        createdAt: nowIso(),
        playerId: event.playerId,
        ...(raw ? { raw } : {}),
      };
    }
    case 'player.deadEndDetected': {
      const raw = sanitizeWordFragment(event.buffer);
      return {
        id: notificationId(state, event),
        kind: 'warning',
        visibility: 'public',
        title: `${displayName(state, event.playerId)} · dead end`,
        message: 'No available word starts with this buffer',
        createdAt: nowIso(),
        playerId: event.playerId,
        ...(raw ? { raw } : {}),
      };
    }
    case 'hostAction.rejected':
      return {
        id: notificationId(state, event),
        kind: 'warning',
        visibility: 'host',
        title: 'Host action',
        message: hostActionRejectionMessage(event.reason),
        createdAt: nowIso(),
        ...(event.playerId ? { playerId: event.playerId } : {}),
      };
    default:
      return undefined;
  }
}

function publicNotificationsForGameView(notifications: GameNotification[]): GameNotification[] {
  return notifications
    .filter((notification) => notification.visibility === 'public')
    .slice(0, MAX_NOTIFICATIONS);
}

function themeBankImportIssues(error: unknown): string[] {
  if (error instanceof ThemeBankImportError) {
    return [...error.issues];
  }

  if (error instanceof Error) {
    return [error.message];
  }

  return [String(error)];
}

function notificationId(state: RoundState, event: DomainEvent): string {
  return `${state.id}:${event.seq}:${event.type}`;
}

function commandRejectionMessage(reason: string): string {
  const messages: Record<string, string> = {
    blocked_path: 'Jump crosses a blocked cell',
    help_not_implemented: 'Help command is not ready yet',
    invalid_distance: 'Invalid jump distance',
    jump_too_far: 'Jump is too far',
    missing_bang: 'Message is not a command',
    no_spawn_available: 'No spawn cell is available',
    occupied_cell: 'Target cell is occupied',
    out_of_bounds: 'Jump leaves the board',
    player_blocked: 'Player is blocked',
    player_kicked: 'Player was kicked for this round',
    player_not_active: 'Player is not active',
    round_not_running: 'Round is not running',
    too_many_moves: 'Too many moves in one message',
    unknown_command: 'Unknown command',
  };

  return messages[reason] ?? humanizeReason(reason);
}

function submissionRejectionMessage(reason: string): string {
  const messages: Record<string, string> = {
    too_short: 'Word is too short',
    word_not_found: 'Word is not in the theme',
  };

  return messages[reason] ?? humanizeReason(reason);
}

function hostActionRejectionMessage(reason: string): string {
  const messages: Record<string, string> = {
    player_already_blocked: 'Player is already blocked',
    player_blocked: 'Player is blocked',
    player_not_blocked: 'Player is not blocked',
    player_not_found: 'Player not found',
    player_already_credited: 'Player already has this word',
    submission_not_found: 'Pending word not found',
    submission_not_pending: 'Pending word is already resolved',
    word_too_short_for_theme: 'Word is too short for this theme',
  };

  return messages[reason] ?? humanizeReason(reason);
}

function humanizeReason(reason: string): string {
  return reason.replaceAll('_', ' ');
}

function sanitizeGameplayRaw(raw: string | undefined): string | undefined {
  const cleaned = cleanRawFragment(raw);
  if (!cleaned || cleaned.length > MAX_SAFE_RAW_LENGTH) {
    return undefined;
  }

  if (isSafeGameplayCommand(cleaned)) {
    return cleaned;
  }

  if (isSafeMoveToken(cleaned)) {
    return `!${cleaned}`;
  }

  return undefined;
}

function sanitizeWordFragment(raw: string | undefined): string | undefined {
  const cleaned = cleanRawFragment(raw);
  if (!cleaned || cleaned.length > MAX_SAFE_RAW_LENGTH) {
    return undefined;
  }

  return /^[\p{L}\p{N}\s-]+$/u.test(cleaned) ? cleaned : undefined;
}

function cleanRawFragment(raw: string | undefined): string | undefined {
  if (!raw) {
    return undefined;
  }

  const cleaned = raw
    .normalize('NFKC')
    .replace(/[\u0000-\u001F\u007F-\u009F]/g, '')
    .trim()
    .replace(/\s+/g, ' ');

  return cleaned.length > 0 ? cleaned : undefined;
}

function isSafeGameplayCommand(value: string): boolean {
  if (!value.startsWith('!')) {
    return false;
  }

  const tokens = value.slice(1).split(/\s+/).filter(Boolean);
  return tokens.length > 0 && tokens.every(isSafeGameplayToken);
}

function isSafeGameplayToken(value: string): boolean {
  const lowerValue = value.toLocaleLowerCase();
  return SAFE_GAMEPLAY_COMMAND_TOKENS.has(lowerValue)
    || isSafeMoveToken(lowerValue)
    || /^[\p{L}\p{N}]{1,4}$/u.test(lowerValue);
}

function isSafeMoveToken(value: string): boolean {
  return /^[\p{L}][\p{N}]{1,4}$/u.test(value);
}

function groupMarkersByCell(publicProjection: PublicGameProjection): Map<string, PublicGameProjection['players']> {
  const markers = new Map<string, PublicGameProjection['players']>();
  for (const marker of publicProjection.players) {
    const key = coordKey(marker.row, marker.col);
    markers.set(key, [...(markers.get(key) ?? []), marker]);
  }
  return markers;
}

function markerStackIndexByPlayer(publicProjection: PublicGameProjection): Map<PlayerId, number> {
  const indexByPlayer = new Map<PlayerId, number>();
  const countByCell = new Map<string, number>();
  for (const marker of publicProjection.players) {
    const key = coordKey(marker.row, marker.col);
    const index = countByCell.get(key) ?? 0;
    countByCell.set(key, index + 1);
    indexByPlayer.set(marker.playerId, index);
  }
  return indexByPlayer;
}

function webMarkerAnimationsFromEvents(events: DomainEvent[], idPrefix: string): WebMarkerAnimation[] {
  const stepsByPlayer = new Map<PlayerId, Coord[]>();
  for (const event of events) {
    if (event.type !== 'player.moved') {
      continue;
    }

    stepsByPlayer.set(event.playerId, [...(stepsByPlayer.get(event.playerId) ?? []), event.to]);
  }

  return [...stepsByPlayer.entries()].map(([playerId, steps]) => ({
    id: `${idPrefix}:${playerId}:${steps.map((step) => coordKey(step.row, step.col)).join('|')}`,
    playerId,
    steps,
  }));
}

function coordKey(row: number, col: number): string {
  return `${row}:${col}`;
}

function boardGridStyle(width: number, height: number): CSSProperties {
  return {
    '--board-cols': width,
    '--board-rows': height,
  } as CSSProperties;
}

function markerStyle(color?: string): CSSProperties {
  return { '--marker-color': color ?? '#2c9f6f' } as CSSProperties;
}

function frogMarkerStyle(color: string | undefined, coord?: Coord, stackIndex = 0): CSSProperties {
  const { labelColor, labelOutline, markerColor } = frogMarkerColors(color ?? '#2c9f6f');
  return {
    '--marker-color': markerColor,
    '--frog-label-color': labelColor,
    '--frog-label-outline': labelOutline,
    ...(coord ? {
      '--marker-col': coord.col,
      '--marker-row': coord.row,
      '--marker-stack-offset-x': `${Math.min(stackIndex, 2) * 6}px`,
      '--marker-stack-offset-y': `${Math.min(stackIndex, 2) * -5}px`,
    } : {}),
  } as CSSProperties;
}

function isDemoPlayerId(playerId: PlayerId): boolean {
  return demoPlayers.some((player) => playerIdFromIdentity(player) === playerId);
}

function formatCoord(coord: Coord | undefined): string {
  return coord ? `${coord.row}:${coord.col}` : '...';
}

function formatTime(isoDate: string): string {
  return new Date(isoDate).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatStorageTime(value: string): string {
  if (!value) {
    return 'unknown time';
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : `${date.toLocaleDateString()} ${formatTime(value)}`;
}

function formatDelay(delayMs: number): string {
  if (delayMs <= 0) {
    return 'now';
  }

  return `${Math.ceil(delayMs / 1000)}s`;
}

async function copyTextToClipboard(value: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(value);
    return true;
  } catch {
    return false;
  }
}

function roleTitle(role: TwitchAuthRole): string {
  return TWITCH_AUTH_ROLES.find((definition) => definition.role === role)?.title ?? role;
}

function twitchAuthErrorInfo(error: unknown): { code?: string; message: string; retryable: boolean } {
  if (error instanceof TwitchAuthError) {
    return {
      code: error.code,
      message: error.message,
      retryable: error.retryable,
    };
  }

  if (error instanceof Error) {
    return {
      message: error.message,
      retryable: false,
    };
  }

  return {
    message: String(error),
    retryable: false,
  };
}

function blockedPlayerDisplayName(player: AdminBlockedPlayer): string {
  return player.displayName ?? player.login ?? player.playerId;
}

function blockedPlayerSubtitle(player: AdminBlockedPlayer): string {
  return player.login ?? player.providerUserId ?? player.playerId;
}

function displayName(state: RoundState, playerId: PlayerId): string {
  return state.players[playerId]?.identity.displayName ?? playerId;
}
