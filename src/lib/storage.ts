const PREFIX = "autoparts_inventory_v1::";

// ── In-memory cache: populated once at startup via loadStorageCache() ──
// After that, lsGet reads from cache instantly (no IPC), eliminating the
// synchronous IPC bottleneck that caused UI freezes.
const _cache = new Map<string, string>();
let _cacheReady = false;

/**
 * Call once at app startup (before rendering) to pre-populate the cache
 * with all storage keys from the main process in a single async IPC call.
 * This replaces the per-key sendSync reads that blocked the renderer.
 */
export async function loadStorageCache(): Promise<void> {
  if (!window.desktopAPI?.storage?.getBatch) {
    _cacheReady = true;
    return;
  }
  try {
    const batch: Record<string, string> = await window.desktopAPI.storage.getBatch();
    for (const [key, value] of Object.entries(batch)) {
      _cache.set(key, value);
    }
  } catch {
    // Fallback: cache stays empty, lsGet falls back to sync reads (old behaviour).
  }
  _cacheReady = true;
}

/**
 * Re-fetch authoritative values from the DB and overwrite the in-memory cache.
 * Call this right AFTER a successful login: the initial loadStorageCache() runs
 * before any session exists, so the main process returns {} and — worse — the
 * debounced flush can poison the cache with empty arrays (writes are rejected
 * by the main process but the optimistic cache update still happens). Refreshing
 * here guarantees post-login reads reflect the real, on-disk data.
 */
export async function reloadStorageCache(): Promise<void> {
  if (!window.desktopAPI?.storage?.getBatch) return;
  try {
    const batch: Record<string, string> = await window.desktopAPI.storage.getBatch();
    for (const [key, value] of Object.entries(batch)) {
      _cache.set(key, value);
    }
    _cacheReady = true;
  } catch {
    // Keep the existing cache on failure.
  }
}

export function lsGet<T>(key: string, fallback: T): T {
  try {
    if (window.desktopAPI?.storage) {
      const fullKey = PREFIX + key;

      // Read from in-memory cache (instant — no IPC)
      if (_cacheReady && _cache.has(fullKey)) {
        const raw = _cache.get(fullKey)!;
        return JSON.parse(raw) as T;
      }

      // Cache miss or not yet loaded: fall back to sync IPC (legacy path)
      const raw = window.desktopAPI.storage.get(PREFIX + key);
      if (raw === null) return fallback;
      return JSON.parse(raw) as T;
    }
    const raw = localStorage.getItem(PREFIX + key);
    if (raw === null) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function lsSet<T>(key: string, value: T): void {
  const fullKey = PREFIX + key;
  try {
    const json = JSON.stringify(value);
    // Always update the in-memory cache so subsequent lsGet calls see
    // the new value immediately (no round-trip needed).
    _cache.set(fullKey, json);

    if (window.desktopAPI?.storage) {
      window.desktopAPI.storage.set(fullKey, json);
      return;
    }
    localStorage.setItem(fullKey, json);
  } catch {
    /* ignore quota / serialization errors */
  }
}

/**
 * Write all keys to persistent storage in a single IPC + SQLite transaction.
 * Only serializes and sends keys whose reference has actually changed since
 * the last flush — avoids re-serializing megabytes of unchanged data.
 * Falls back to per-key writes if the batch API is unavailable.
 */
const _lastFlushedRef = new Map<string, unknown>();

export function lsSetBatch(entries: Record<string, unknown>): void {
  const batch: Record<string, string> = {};
  let changeCount = 0;
  for (const [key, value] of Object.entries(entries)) {
    const fullKey = PREFIX + key;
    // Skip keys whose object reference hasn't changed since last flush
    if (_lastFlushedRef.get(key) === value) continue;
    _lastFlushedRef.set(key, value);
    try {
      const json = JSON.stringify(value);
      // Update in-memory cache immediately
      _cache.set(fullKey, json);
      batch[fullKey] = json;
      changeCount++;
    } catch (e) {
      // JSON.stringify can throw on very large arrays (RangeError) or
      // circular references. Log and skip the key instead of crashing.
      console.error(`[storage] Failed to serialize key "${key}":`, e);
    }
  }
  // Nothing changed — skip the IPC call entirely
  if (changeCount === 0) return;
  try {
    if (window.desktopAPI?.storage?.setBatch) {
      window.desktopAPI.storage.setBatch(batch);
      return;
    }
    // Fallback: per-key writes (web mode or old Electron)
    if (window.desktopAPI?.storage) {
      for (const [fullKey, json] of Object.entries(batch)) {
        window.desktopAPI.storage.set(fullKey, json);
      }
      return;
    }
    for (const [fullKey, json] of Object.entries(batch)) {
      localStorage.setItem(fullKey, json);
    }
  } catch {
    /* ignore */
  }
}

/**
 * Like {@link lsSetBatch} but RESOLVES only once the data is durably written to
 * SQLite (awaits the IPC round-trip). Use this before a hard `location.reload()`
 * — e.g. restoring a backup — so the reloaded renderer reads the new data
 * instead of racing the fire-and-forget write. Returns false if the main
 * process rejected the write. Updates the in-memory cache immediately like the
 * sync variant. Does NOT use the unchanged-ref skip: a restore must persist
 * every key even if a reference happens to match.
 */
export async function lsSetBatchAwait(entries: Record<string, unknown>): Promise<boolean> {
  const batch: Record<string, string> = {};
  for (const [key, value] of Object.entries(entries)) {
    const fullKey = PREFIX + key;
    try {
      const json = JSON.stringify(value);
      _cache.set(fullKey, json);
      _lastFlushedRef.set(key, value);
      batch[fullKey] = json;
    } catch (e) {
      console.error(`[storage] Failed to serialize key "${key}":`, e);
    }
  }
  if (Object.keys(batch).length === 0) return true;
  try {
    if (window.desktopAPI?.storage?.setBatch) {
      const ok = await window.desktopAPI.storage.setBatch(batch);
      return ok !== false;
    }
    if (window.desktopAPI?.storage) {
      await Promise.all(
        Object.entries(batch).map(([fullKey, json]) => window.desktopAPI!.storage!.set(fullKey, json))
      );
      return true;
    }
    for (const [fullKey, json] of Object.entries(batch)) {
      localStorage.setItem(fullKey, json);
    }
    return true;
  } catch {
    return false;
  }
}


export function lsRemove(key: string): void {
  const fullKey = PREFIX + key;
  _cache.delete(fullKey);
  if (window.desktopAPI?.storage) {
    window.desktopAPI.storage.remove(fullKey);
    return;
  }
  localStorage.removeItem(fullKey);
}

export function lsClearAll(): void {
  // Clear the in-memory cache for all app keys
  for (const key of [..._cache.keys()]) {
    if (key.startsWith(PREFIX)) _cache.delete(key);
  }
  if (window.desktopAPI?.storage) {
    window.desktopAPI.storage.clearPrefix(PREFIX);
    return;
  }
  const keys: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k && k.startsWith(PREFIX)) keys.push(k);
  }
  keys.forEach((k) => localStorage.removeItem(k));
}
