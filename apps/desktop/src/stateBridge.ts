const STATE_SNAPSHOT_EVENT = 'frogword:renderer-snapshot';
const STATE_REQUEST_EVENT = 'frogword:renderer-snapshot-request';
const WEB_FALLBACK_STORAGE_KEY = 'frogword.desktop.roundState.v1';

type Unsubscribe = () => void;
type SnapshotHandler = (payload: unknown) => void;

interface TauriInternals {
  invoke?: unknown;
}

type WindowWithTauri = Window & {
  __TAURI_INTERNALS__?: TauriInternals;
};

export async function publishRendererSnapshot(snapshot: unknown): Promise<void> {
  const tauri = await getTauriEventApi();
  if (tauri) {
    await tauri.emit(STATE_SNAPSHOT_EVENT, snapshot);
    return;
  }

  publishWebFallbackSnapshot(snapshot);
}

export async function requestRendererSnapshot(): Promise<void> {
  const tauri = await getTauriEventApi();
  if (tauri) {
    await tauri.emit(STATE_REQUEST_EVENT);
    return;
  }

  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(STATE_REQUEST_EVENT));
  }
}

export async function subscribeRendererSnapshots(handler: SnapshotHandler): Promise<Unsubscribe> {
  const tauri = await getTauriEventApi();
  if (tauri) {
    return tauri.listen<unknown>(STATE_SNAPSHOT_EVENT, (event) => handler(event.payload));
  }

  return subscribeWebFallbackSnapshots(handler);
}

export async function subscribeRendererSnapshotRequests(handler: () => void): Promise<Unsubscribe> {
  const tauri = await getTauriEventApi();
  if (tauri) {
    return tauri.listen<void>(STATE_REQUEST_EVENT, () => handler());
  }

  if (typeof window === 'undefined') {
    return () => {};
  }

  window.addEventListener(STATE_REQUEST_EVENT, handler);
  return () => window.removeEventListener(STATE_REQUEST_EVENT, handler);
}

export function loadFallbackSnapshotPayload(): unknown | undefined {
  if (typeof window === 'undefined') {
    return undefined;
  }

  try {
    const snapshot = window.localStorage.getItem(WEB_FALLBACK_STORAGE_KEY);
    return snapshot ? JSON.parse(snapshot) as unknown : undefined;
  } catch {
    return undefined;
  }
}

async function getTauriEventApi(): Promise<typeof import('@tauri-apps/api/event') | undefined> {
  if (!isTauriRuntime()) {
    return undefined;
  }

  try {
    return await import('@tauri-apps/api/event');
  } catch {
    return undefined;
  }
}

function isTauriRuntime(): boolean {
  if (typeof window === 'undefined') {
    return false;
  }

  return typeof (window as WindowWithTauri).__TAURI_INTERNALS__?.invoke === 'function';
}

function publishWebFallbackSnapshot(snapshot: unknown): void {
  if (typeof window === 'undefined') {
    return;
  }

  try {
    window.localStorage.setItem(WEB_FALLBACK_STORAGE_KEY, JSON.stringify(snapshot));
    window.dispatchEvent(new CustomEvent(STATE_SNAPSHOT_EVENT, { detail: snapshot }));
  } catch {
    // Browser fallback can fail in restricted storage contexts; native Tauri sync does not use it.
  }
}

function subscribeWebFallbackSnapshots(handler: SnapshotHandler): Unsubscribe {
  if (typeof window === 'undefined') {
    return () => {};
  }

  const handleStorage = (event: StorageEvent) => {
    if (event.key !== WEB_FALLBACK_STORAGE_KEY || !event.newValue) {
      return;
    }

    try {
      handler(JSON.parse(event.newValue) as unknown);
    } catch {
      // Ignore malformed snapshots from stale browser storage.
    }
  };
  const handleCustomEvent = (event: Event) => {
    handler((event as CustomEvent<unknown>).detail);
  };

  window.addEventListener('storage', handleStorage);
  window.addEventListener(STATE_SNAPSHOT_EVENT, handleCustomEvent);

  return () => {
    window.removeEventListener('storage', handleStorage);
    window.removeEventListener(STATE_SNAPSHOT_EVENT, handleCustomEvent);
  };
}
