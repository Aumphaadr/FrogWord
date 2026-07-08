import { useEffect, useMemo, useRef, useState, type CSSProperties, type Dispatch, type SetStateAction } from 'react';
import {
  AlertTriangle,
  Ban,
  BookOpen,
  Check,
  Copy,
  Crown,
  Flag,
  FileUp,
  HardDriveDownload,
  KeyRound,
  LogIn,
  MessageSquare,
  Radio,
  RefreshCcw,
  RotateCcw,
  Send,
  ShieldAlert,
  Trophy,
  UserMinus,
  Unplug,
  X,
} from 'lucide-react';
import {
  applyCommand,
  applyHostAction,
  approveRejectedSubmission,
  createAdminGameProjection,
  createPublicGameProjection,
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
} from '@frogword/core';
import {
  loadFallbackSnapshotPayload,
  publishRendererSnapshot,
  requestRendererSnapshot,
  subscribeRendererSnapshotRequests,
  subscribeRendererSnapshots,
} from './stateBridge';
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
const MAX_NOTIFICATIONS = 6;
const MAX_PUBLIC_NOTIFICATIONS = 3;
const MAX_AUDIT_ENTRIES = 120;
const MAX_SAFE_RAW_LENGTH = 24;
const TWITCH_AUTH_MAINTENANCE_INTERVAL_MS = 60 * 60 * 1000;
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

const quickCommands = [
  { label: 'Join', command: '!играть', icon: LogIn },
  { label: 'Right', command: '!п1', icon: Flag },
  { label: 'Left', command: '!л1', icon: Flag },
  { label: 'Down', command: '!н1', icon: Flag },
  { label: 'Word', command: '!слово', icon: Check },
  { label: 'Reset', command: '!сброс', icon: RotateCcw },
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
            <BookOpen size={17} />
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
              <RefreshCcw size={17} />
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
            <HardDriveDownload size={17} />
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
              <FileUp size={17} />
              Choose
            </button>
            <button
              className="primary-button"
              disabled={themeBankImportState.status !== 'ready'}
              type="button"
              onClick={importSelectedThemeBank}
            >
              <HardDriveDownload size={17} />
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
            <MessageSquare size={17} />
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
              <Send size={17} />
              Send
            </button>
          </form>

          <div className="quick-command-grid">
            {quickCommands.map(({ command, icon: Icon, label }) => (
              <button key={command} type="button" title={label} onClick={() => sendFakeChat(command)}>
                <Icon size={16} />
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
            <ShieldAlert size={17} />
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
                          <LogIn size={15} />
                        </button>
                        <button
                          type="button"
                          title="Kick"
                          aria-label="Kick"
                          disabled={!canKick}
                          onClick={() => kickPlayer(row.playerId)}
                        >
                          <UserMinus size={15} />
                        </button>
                        <button
                          type="button"
                          title="Ban"
                          aria-label="Ban"
                          disabled={!canBan}
                          onClick={() => banPlayer(row.playerId)}
                        >
                          <Ban size={15} />
                        </button>
                        {canUnban ? (
                          <button type="button" title="Unban" aria-label="Unban" onClick={() => unbanPlayer(row.playerId)}>
                            <Check size={15} />
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
                        <Check size={15} />
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
            <Flag size={17} />
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
                    <Check size={15} />
                    T1
                  </button>
                  <button type="button" title="Approve exotic" onClick={() => approvePending(submission.id, 2)}>
                    <Check size={15} />
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
            <MessageSquare size={17} />
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

interface PublicGameViewProps {
  round: RoundState;
  notifications?: GameNotification[];
  mode: 'embedded' | 'standalone';
  onReset?: () => void;
}

function PublicGameView({ round, notifications = [], mode, onReset }: PublicGameViewProps) {
  const publicProjection = useMemo(() => createPublicGameProjection(round, { locale: 'ru' }), [round]);
  const markersByCell = useMemo(() => groupMarkersByCell(publicProjection), [publicProjection]);
  const surfaceClassName = mode === 'standalone' ? 'game-view-surface' : 'game-surface';
  const publicNotifications = notifications.slice(0, MAX_PUBLIC_NOTIFICATIONS);

  return (
    <section className={surfaceClassName} aria-label={mode === 'standalone' ? 'Public game view' : 'Public game preview'}>
      <header className="round-header">
        <div>
          <p className="eyebrow">{mode === 'standalone' ? 'FrogWord game view' : 'FrogWord local round'}</p>
          <h1>{publicProjection.themeTitle}</h1>
        </div>
        <div className="round-actions">
          <div className="status-pill">{publicProjection.roundStatus}</div>
          {onReset ? (
            <button className="icon-button" type="button" title="New local round" onClick={onReset}>
              <RefreshCcw size={18} />
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
              <Trophy size={17} />
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
              <MessageSquare size={17} />
              <h2>Players</h2>
            </div>
            <div className="participant-list">
              {publicProjection.participantPanel.map((row) => (
                <div className="participant-row" key={row.playerId}>
                  <div className="participant-main">
                    <span className="marker-dot" style={markerStyle(row.markerColor)} />
                    <span>{row.displayName}</span>
                    {row.flags.includes('deadEnd') ? <ShieldAlert className="flag-icon" size={15} /> : null}
                  </div>
                  <div className="buffer">{row.buffer || '...'}</div>
                </div>
              ))}
            </div>
          </section>

          <section className="panel">
            <div className="panel-title">
              <Crown size={17} />
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
          <AlertTriangle size={17} />
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
          <X size={15} />
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
              <X size={14} />
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
          <RotateCcw size={17} />
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
            <RefreshCcw size={16} />
            New round
          </button>
          <button
            className="primary-button"
            disabled={isApplying}
            type="button"
            onClick={() => onContinue(hydration)}
          >
            <Check size={16} />
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
        <KeyRound size={17} />
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
          <Copy size={16} />
          {state.status === 'requesting' ? 'Starting' : 'Start'}
        </button>
        <button
          className="primary-button"
          disabled={!canCheck}
          type="button"
          onClick={onCheck}
        >
          <Check size={16} />
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
          <Radio size={17} />
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
          <Radio size={16} />
          {state.status === 'connecting' ? 'Connecting' : 'Reconnect'}
        </button>
        <button
          className="secondary-button"
          disabled={!canDisconnect}
          type="button"
          onClick={onDisconnect}
        >
          <Unplug size={16} />
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
          <MessageSquare size={17} />
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
          <X size={15} />
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
