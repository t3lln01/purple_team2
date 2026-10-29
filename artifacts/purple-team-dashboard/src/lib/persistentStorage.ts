const STATE_ENDPOINT = "/api/state";
const PERSISTED_PREFIXES = ["pt_", "ds_", "tm-"] as const;

const nativeSetItem = Storage.prototype.setItem;
const nativeRemoveItem = Storage.prototype.removeItem;
let initialized = false;
const pendingWrites = new Map<string, Promise<void>>();

export function isPersistentKey(key: string): boolean {
  return PERSISTED_PREFIXES.some((prefix) => key.startsWith(prefix));
}

async function saveRemote(key: string, value: string): Promise<void> {
  const response = await fetch(`${STATE_ENDPOINT}/${encodeURIComponent(key)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ value }),
  });
  if (!response.ok) throw new Error(`State save failed (${response.status})`);
}

async function removeRemote(key: string): Promise<void> {
  const response = await fetch(`${STATE_ENDPOINT}/${encodeURIComponent(key)}`, {
    method: "DELETE",
  });
  if (!response.ok) throw new Error(`State removal failed (${response.status})`);
}

function warn(operation: string, key: string, error: unknown): void {
  console.warn(`Could not ${operation} persistent state "${key}".`, error);
}

function enqueueWrite(key: string, operation: () => Promise<void>): void {
  const previous = pendingWrites.get(key) ?? Promise.resolve();
  const current = previous
    .catch(() => undefined)
    .then(operation)
    .catch((error) => warn("synchronize", key, error))
    .finally(() => {
      if (pendingWrites.get(key) === current) pendingWrites.delete(key);
    });
  pendingWrites.set(key, current);
}

function installPersistenceHooks(): void {
  Storage.prototype.setItem = function setItem(key: string, value: string): void {
    nativeSetItem.call(this, key, value);
    if (this === window.localStorage && isPersistentKey(key)) {
      enqueueWrite(key, () => saveRemote(key, value));
    }
  };

  Storage.prototype.removeItem = function removeItem(key: string): void {
    nativeRemoveItem.call(this, key);
    if (this === window.localStorage && isPersistentKey(key)) {
      enqueueWrite(key, () => removeRemote(key));
    }
  };
}

export async function initializePersistentStorage(): Promise<void> {
  if (initialized) return;
  initialized = true;

  try {
    const response = await fetch(STATE_ENDPOINT);
    if (!response.ok) throw new Error(`State hydration failed (${response.status})`);
    const payload = await response.json() as { state?: Record<string, unknown> };
    const remoteState = payload.state ?? {};

    for (const [key, value] of Object.entries(remoteState)) {
      if (isPersistentKey(key) && typeof value === "string") {
        nativeSetItem.call(window.localStorage, key, value);
      }
    }

    const migrations: Promise<void>[] = [];
    for (let index = 0; index < window.localStorage.length; index += 1) {
      const key = window.localStorage.key(index);
      if (key && isPersistentKey(key) && !(key in remoteState)) {
        migrations.push(
          saveRemote(key, window.localStorage.getItem(key) ?? "")
            .catch((error) => warn("migrate", key, error)),
        );
      }
    }
    await Promise.all(migrations);
  } catch (error) {
    console.warn("Persistent state is unavailable; using this browser's cached data.", error);
  }

  installPersistenceHooks();
}
