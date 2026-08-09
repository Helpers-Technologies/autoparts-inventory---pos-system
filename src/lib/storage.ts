const PREFIX = "autoparts_inventory_v1::";

// ── Chunked collections ───────────────────────────────────────────────────
//
// Every collection used to be one JSON blob in one row, so appending a single
// invoice re-serialized and re-encrypted the shop's entire history. Measured on
// a generated three-year shop (29k invoices, 105k stock movements): one sale
// cost 300 ms of JSON.stringify on the thread that paints the POS plus 505 ms
// of encrypted write — 806 ms, against 11 ms at 500 invoices. It grew linearly
// with history, which is the one direction a shop only ever moves in.
//
// These collections are now stored as fixed-size chunks: `salesInvoices#0000`,
// `#0001`, ... plus a `#meta` row recording how many are live. Appending
// touches only the last chunk, so the cost stops depending on how long the shop
// has been open.
//
// Chosen for the in-memory model to stay EXACTLY as it was — plain arrays in
// React state, same lsGet/lsSetBatch signatures — so no feature code changes
// and no screen has to learn about chunks.
const CHUNKED_KEYS = new Set([
  "salesInvoices",
  "purchaseInvoices",
  "stockMovements",
  "auditLogs",
  "customers",
  "products",
  "salesReturns",
  "purchaseReturns",
  "quotations",
  "shifts",
  "cashEntries",
]);

// Deliberately NOT chunked, and each for a reason:
//   users     — the main process redacts password hashes by matching the exact
//               key `${PREFIX}users`; a chunked key would slip past that and
//               export credential hashes. A security regression, not a perf one.
//   settings  — a single small object, nothing to chunk.
//   next*Code — scalars.

// 500 records lands each chunk near half a megabyte for invoices, which
// serializes in a couple of milliseconds. Smaller chunks would mean more rows
// per full read; larger ones bring back the cost this exists to remove.
const CHUNK_SIZE = 500;

/** Marks a legacy single-blob row as superseded by chunks. Written in the SAME
 *  transaction as the chunks, rather than deleting the row, so there is no
 *  window where both forms look authoritative — and no reliance on a second
 *  IPC round-trip landing. */
const CHUNKED_TOMBSTONE = '"__partflow_chunked__"';

const metaKey = (key: string) => `${PREFIX}${key}#meta`;
const chunkKey = (key: string, index: number) =>
  `${PREFIX}${key}#${String(index).padStart(4, "0")}`;

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
    rememberChunkCounts();
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
    rememberChunkCounts();
    _cacheReady = true;
  } catch {
    // Keep the existing cache on failure.
  }
}

/**
 * Seeds `_lastChunkCount` from what is actually on disk.
 *
 * Without this a restart forgets how many chunks each collection had, so the
 * first flush after launch would not know which higher-numbered chunks to
 * blank — and a collection that shrank in the previous session could leave
 * live stale records behind the manifest's end.
 */
function rememberChunkCounts(): void {
  for (const key of CHUNKED_KEYS) {
    const raw = _cache.get(metaKey(key));
    if (raw === undefined) continue;
    try {
      const count = Number(JSON.parse(raw)?.chunks);
      if (Number.isInteger(count) && count >= 0) _lastChunkCount.set(key, count);
    } catch {
      /* unreadable manifest — leave it to the read path to reject */
    }
  }
}

/** Reads one physical row, cache first, then sync IPC / localStorage. */
function readRow(fullKey: string): string | null {
  if (_cacheReady && _cache.has(fullKey)) return _cache.get(fullKey)!;
  if (window.desktopAPI?.storage) return window.desktopAPI.storage.get(fullKey);
  return localStorage.getItem(fullKey);
}

/**
 * Reassembles a chunked collection, or returns null when this key is not (or is
 * no longer) stored in chunks and the caller should read the plain row.
 *
 * A partial read is treated as no read at all. Returning the chunks that
 * happened to load would look like a shop that lost half its invoices, and the
 * app would then cheerfully persist that truncated array back over the good
 * data. Better to fall through and let the caller use the legacy row or the
 * seed than to hand back a plausible-looking lie.
 */
function readChunked<T>(key: string): T[] | null {
  const rawMeta = readRow(metaKey(key));
  if (rawMeta === null) return null;
  let meta: { chunks?: number; total?: number };
  try {
    meta = JSON.parse(rawMeta);
  } catch {
    return null;
  }
  const count = Number(meta?.chunks);
  if (!Number.isInteger(count) || count < 0) return null;

  const out: T[] = [];
  for (let i = 0; i < count; i++) {
    const raw = readRow(chunkKey(key, i));
    if (raw === null) return null;
    let part: unknown;
    try {
      part = JSON.parse(raw);
    } catch {
      return null;
    }
    if (!Array.isArray(part)) return null;
    for (const item of part) out.push(item as T);
  }
  // The manifest records the expected length, so a chunk that was written
  // short cannot pass silently.
  if (Number.isInteger(meta?.total) && meta.total !== out.length) return null;
  return out;
}

export function lsGet<T>(key: string, fallback: T): T {
  try {
    const fullKey = PREFIX + key;

    if (CHUNKED_KEYS.has(key)) {
      const legacy = readRow(fullKey);
      // A legacy row that is NOT the tombstone wins: it means either this shop
      // has never been chunked, or a backup taken before chunking existed was
      // just restored over the top. Trusting the chunks there would silently
      // serve the pre-restore data.
      if (legacy !== null && legacy !== CHUNKED_TOMBSTONE) {
        return JSON.parse(legacy) as T;
      }
      const chunked = readChunked<unknown>(key);
      if (chunked !== null) return chunked as unknown as T;
      // Tombstone present but chunks unreadable: refuse to invent data.
      if (legacy === CHUNKED_TOMBSTONE) return fallback;
      return fallback;
    }

    const raw = readRow(fullKey);
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

/** How many chunks each collection was last written with. Survives cache
 *  pruning, which is why orphan cleanup consults this and not `_cache`. */
const _lastChunkCount = new Map<string, number>();

/** The array as last persisted, kept so a chunk can be skipped by element
 *  identity instead of by re-serializing it. Holds references to objects the
 *  app already has in state, so it costs one pointer per record, not a copy. */
const _lastArray = new Map<string, readonly unknown[]>();

/** True when [start,end) is element-for-element the same in both arrays. */
function unchangedRange(
  previous: readonly unknown[],
  next: readonly unknown[],
  start: number,
  end: number,
): boolean {
  if (previous.length < end) return false;
  for (let i = start; i < end; i++) {
    if (previous[i] !== next[i]) return false;
  }
  return true;
}

/**
 * Expands one logical collection into the physical rows that need writing.
 *
 * Only chunks whose serialized text actually changed are emitted, which is the
 * whole point: appending an invoice dirties the last chunk and nothing else, so
 * the work stops scaling with the length of the history.
 *
 * Rows that must be written together are returned together — the caller sends
 * them in a single transaction, so chunks and the manifest that describes them
 * can never land separately.
 */
function chunkRowsFor(key: string, value: unknown, out: Record<string, string>): void {
  if (!Array.isArray(value)) {
    // Defensive: a chunked key holding a non-array is a bug elsewhere, but
    // writing it as a plain row keeps the data rather than dropping it.
    out[PREFIX + key] = JSON.stringify(value);
    return;
  }
  const chunks = Math.ceil(value.length / CHUNK_SIZE);
  const previous = _lastArray.get(key);

  for (let i = 0; i < chunks; i++) {
    const start = i * CHUNK_SIZE;
    const end = Math.min(start + CHUNK_SIZE, value.length);
    const full = chunkKey(key, i);

    // Skip untouched chunks WITHOUT serializing them.
    //
    // Comparing serialized text would mean JSON.stringify over the whole
    // history on every save just to discover that 58 of 59 chunks are
    // unchanged — 151 ms at three years, which is most of the cost this whole
    // change exists to remove. Element identity answers the same question in
    // microseconds.
    //
    // This assumes state updates are immutable (`[...prev, item]`,
    // `.map(x => x.id === id ? {...x} : x)`), which the app already relies on:
    // lsSetBatch's own `_lastFlushedRef` reference check would drop an
    // in-place mutation before reaching here. No new assumption is introduced.
    if (previous && _cache.has(full) && unchangedRange(previous, value, start, end)) continue;

    out[full] = JSON.stringify(value.slice(start, end));
  }
  const meta = JSON.stringify({ chunks, size: CHUNK_SIZE, total: value.length });
  if (_cache.get(metaKey(key)) !== meta) out[metaKey(key)] = meta;

  // Supersede the legacy single-blob row in the same transaction. Deleting it
  // instead would leave a window where a crash could strand the shop with
  // neither form authoritative.
  if (_cache.get(PREFIX + key) !== CHUNKED_TOMBSTONE) {
    out[PREFIX + key] = CHUNKED_TOMBSTONE;
  }

  // A collection that SHRANK (invoice deleted, backup restored over a longer
  // history) leaves higher-numbered chunks behind. Reads are bounded by the
  // manifest so they are already inert, but they are overwritten with an empty
  // array so they cannot resurrect if a later manifest grows past them again.
  //
  // Bounded by a remembered count rather than by cache membership:
  // pruneStorageMemoryCache can evict chunk rows at any time, and a cleanup
  // loop that stopped at the first evicted key would leave live stale records
  // sitting between the manifest's end and the real end.
  const previousChunkCount = Math.max(_lastChunkCount.get(key) ?? 0, chunks);
  for (let i = chunks; i < previousChunkCount; i++) {
    const full = chunkKey(key, i);
    if (_cache.get(full) === "[]") continue;
    out[full] = "[]";
  }
  _lastChunkCount.set(key, chunks);
  _lastArray.set(key, value);
}

export function lsSetBatch(entries: Record<string, unknown>): void {
  const batch: Record<string, string> = {};
  let changeCount = 0;
  for (const [key, value] of Object.entries(entries)) {
    const fullKey = PREFIX + key;
    // Skip keys whose object reference hasn't changed since last flush
    if (_lastFlushedRef.get(key) === value) continue;
    _lastFlushedRef.set(key, value);
    try {
      if (CHUNKED_KEYS.has(key)) {
        const rows: Record<string, string> = {};
        chunkRowsFor(key, value, rows);
        for (const [rowKey, rowJson] of Object.entries(rows)) {
          _cache.set(rowKey, rowJson);
          batch[rowKey] = rowJson;
          changeCount++;
        }
        continue;
      }
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
      if (CHUNKED_KEYS.has(key)) {
        // Same expansion as the debounced path, but every chunk is emitted
        // rather than only the changed ones: a restore must land completely
        // even where the cache happens to agree with what is already on disk.
        const rows: Record<string, string> = {};
        if (Array.isArray(value)) {
          const chunks = Math.ceil(value.length / CHUNK_SIZE);
          for (let i = 0; i < chunks; i++) {
            rows[chunkKey(key, i)] =
              JSON.stringify(value.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE));
          }
          rows[metaKey(key)] = JSON.stringify({ chunks, size: CHUNK_SIZE, total: value.length });
          rows[PREFIX + key] = CHUNKED_TOMBSTONE;
          for (let i = chunks; ; i++) {
            const full = chunkKey(key, i);
            if (!_cache.has(full) || _cache.get(full) === "[]") break;
            rows[full] = "[]";
          }
        } else {
          rows[fullKey] = JSON.stringify(value);
        }
        for (const [rowKey, rowJson] of Object.entries(rows)) {
          _cache.set(rowKey, rowJson);
          batch[rowKey] = rowJson;
        }
        _lastFlushedRef.set(key, value);
        continue;
      }
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
  const remove = (k: string) => {
    _cache.delete(k);
    _lastFlushedRef.delete(key);
    if (window.desktopAPI?.storage) window.desktopAPI.storage.remove(k);
    else localStorage.removeItem(k);
  };
  // Removing only the base row of a chunked collection would leave the chunks
  // and manifest behind, and the next read would resurrect the data that was
  // just deleted.
  if (CHUNKED_KEYS.has(key)) {
    for (const cached of [..._cache.keys()]) {
      if (cached.startsWith(`${fullKey}#`)) remove(cached);
    }
  }
  remove(fullKey);
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

/**
 * Prunes the in-memory cache to release memory if key count exceeds target limit.
 */
export function pruneStorageMemoryCache(maxKeys = 1000): void {
  if (_cache.size <= maxKeys) return;
  // Retain prefixed active keys and remove extraneous entries
  const keys = [..._cache.keys()];
  const excess = _cache.size - maxKeys;
  for (let i = 0; i < excess; i++) {
    const k = keys[i];
    if (k && !k.includes("settings") && !k.includes("currentUser")) {
      _cache.delete(k);
    }
  }
}
