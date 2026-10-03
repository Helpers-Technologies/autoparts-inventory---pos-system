import { assertMoney } from "./moneySafety";
import { phase9Mark } from "./phase9Profile";

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
  "branchStocks",
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

/**
 * Versioned marker for a ledger that was validated and sorted by date + id.
 *
 * The old `"oldest-first"` marker only meant that `reverse()` had run. Some
 * generated and imported ledgers were neither newest-first nor oldest-first,
 * so trusting that marker could preserve tens of thousands of inversions.
 */
const ORDER_OLDEST_FIRST = '"oldest-first-v2-date-id"';

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
export async function reloadStorageCache(): Promise<boolean> {
  if (!window.desktopAPI?.storage?.getBatch) return true;
  try {
    phase9Mark("storage-reload-start");
    const batch: Record<string, string> = await window.desktopAPI.storage.getBatch();
    phase9Mark("storage-reload-ipc-complete", {
      rows: Object.keys(batch).length,
      valueBytes: Object.values(batch).reduce((sum, value) => sum + value.length, 0),
    });
    // Replace the authoritative snapshot instead of merging it. A key that was
    // removed/restored between sessions must not survive in the renderer cache
    // merely because the new batch does not contain it. Build the replacement
    // only after IPC succeeds so a transient read failure never destroys the
    // last known-good cache.
    _cache.clear();
    for (const [key, value] of Object.entries(batch)) {
      _cache.set(key, value);
    }
    rememberChunkCounts();
    _cacheReady = true;
    phase9Mark("storage-reload-cache-complete");
    return true;
  } catch {
    // Keep the existing cache on failure.
    return false;
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

/**
 * Pulls one collection's rows into the cache in a single call.
 *
 * Collections held back from the startup payload have none of their chunks
 * cached, and reading them through the per-row fallback would mean one
 * synchronous IPC round-trip per chunk — 633 of them on a five-year ledger,
 * which costs more than loading it at startup ever did.
 */
export async function lsLoadCollection(key: string): Promise<void> {
  const getCollection = window.desktopAPI?.storage?.getCollection;
  if (!getCollection) return;
  try {
    const rows = await getCollection(key);
    for (const [rowKey, value] of Object.entries(rows)) _cache.set(rowKey, value);
    rememberChunkCounts();
  } catch {
    // Leave the cache as it was; the per-row fallback still works.
  }
}

/** Records an array as the currently-persisted state of `key`, so a later flush
 *  can skip chunks whose elements are still the very same objects. */
function rememberPersistedArray(key: string, value: readonly unknown[]): void {
  _lastArray.set(key, value);
  _lastChunkCount.set(key, Math.ceil(value.length / CHUNK_SIZE));
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
      if (chunked !== null) {
        // Remember what was just handed out, so the first flush after startup
        // can tell that nothing has changed.
        //
        // Without this, a fresh process knows nothing about the previous array
        // and therefore treats every chunk as dirty: measured on a five-year
        // shop, the first debounced flush after signing in re-serialized
        // 185 MB across 953 rows and wrote all of it back, several seconds of
        // work to persist data identical to what was just read off disk.
        //
        // Only helps where the caller uses the array as handed out. Collections
        // that get mapped on load (products, salesInvoices — normalised through
        // .map) produce new element objects and are legitimately rewritten;
        // the large append-only ones like stockMovements are not.
        rememberPersistedArray(key, chunked);
        return chunked as unknown as T;
      }
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

/**
 * Puts a collection into oldest-first order once, and records that it is done.
 *
 * The ledger has always been kept newest-first in memory: every new movement
 * was put at the front. That is the one order an append-only chunked store
 * cannot maintain cheaply — prepending shifts every record and dirties every
 * chunk, which is exactly the cost being removed here. So the on-disk order
 * becomes oldest-first, and readers reverse.
 *
 * Runs at most once per shop. The marker is written in the SAME batch as the
 * reordered data, so a crash midway leaves the old order and the migration
 * simply runs again — never a half-reversed ledger.
 *
 * Returns the records in oldest-first order, or null if there was nothing to
 * do and the caller should read normally.
 */
type ChronologicalRecord = { date: string; id?: string };

export function compareOldestFirstByDateAndId(
  left: ChronologicalRecord,
  right: ChronologicalRecord,
): number {
  const leftTime = Date.parse(left.date);
  const rightTime = Date.parse(right.date);
  if (!Number.isFinite(leftTime) || !Number.isFinite(rightTime)) {
    throw new Error("invalid_chronological_record");
  }
  if (leftTime !== rightTime) return leftTime - rightTime;
  return String(left.id ?? "").localeCompare(String(right.id ?? ""), "en");
}

export function lsMigrateToOldestFirst<T extends ChronologicalRecord>(key: string): T[] | null {
  if (!CHUNKED_KEYS.has(key)) return null;
  const markerKey = `${PREFIX}${key}#order`;
  if (readRow(markerKey) === ORDER_OLDEST_FIRST) return null;

  // Read whatever is there, in whichever form.
  const legacy = readRow(PREFIX + key);
  let existing: T[] | null = null;
  if (legacy !== null && legacy !== CHUNKED_TOMBSTONE) {
    try {
      const parsed = JSON.parse(legacy);
      existing = Array.isArray(parsed) ? (parsed as T[]) : null;
    } catch {
      existing = null;
    }
  } else {
    existing = readChunked<T>(key);
  }
  // Nothing readable — a brand-new shop. Establish the empty chunked form
  // (manifest and tombstone), not just the marker: without a manifest the very
  // first append has nothing to extend, refuses, and the record is lost.
  if (existing === null) {
    writeRows({
      [metaKey(key)]: JSON.stringify({ chunks: 0, size: CHUNK_SIZE, total: 0 }),
      [PREFIX + key]: CHUNKED_TOMBSTONE,
      [markerKey]: ORDER_OLDEST_FIRST,
    });
    _lastChunkCount.set(key, 0);
    return [];
  }

  let reordered: T[];
  try {
    // Sorting is required: real imports and the stress generator can interleave
    // purchases, sales and returns, so reversing the array merely changes one
    // invalid order into another. The id tie-breaker makes repeated migrations
    // deterministic even when hundreds of movements share one timestamp.
    reordered = existing.slice().sort(compareOldestFirstByDateAndId);
  } catch {
    // Never stamp an unverifiable ledger as migrated. Callers can block the
    // operation or surface recovery guidance while the original rows remain
    // untouched.
    return null;
  }

  const rows: Record<string, string> = {};
  const chunks = Math.ceil(reordered.length / CHUNK_SIZE);
  for (let i = 0; i < chunks; i++) {
    rows[chunkKey(key, i)] = JSON.stringify(reordered.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE));
  }
  rows[metaKey(key)] = JSON.stringify({ chunks, size: CHUNK_SIZE, total: reordered.length });
  rows[PREFIX + key] = CHUNKED_TOMBSTONE;
  // Blank any chunk left over from a longer previous layout.
  const previousChunks = Math.max(_lastChunkCount.get(key) ?? 0, chunks);
  for (let i = chunks; i < previousChunks; i++) rows[chunkKey(key, i)] = "[]";
  rows[markerKey] = ORDER_OLDEST_FIRST;

  writeRows(rows);
  _lastChunkCount.set(key, chunks);
  _lastArray.delete(key);
  _lastFlushedRef.delete(key);
  return reordered;
}

/** True once {@link lsMigrateToOldestFirst} has run for this collection. */
export function lsIsOldestFirst(key: string): boolean {
  return readRow(`${PREFIX}${key}#order`) === ORDER_OLDEST_FIRST;
}

/** Writes rows to the cache and through to storage in one batch. */
function writeRows(rows: Record<string, string>): void {
  for (const [rowKey, rowJson] of Object.entries(rows)) _cache.set(rowKey, rowJson);
  if (window.desktopAPI?.storage?.setBatch) {
    window.desktopAPI.storage.setBatch(rows);
    return;
  }
  if (window.desktopAPI?.storage) {
    for (const [rowKey, rowJson] of Object.entries(rows)) {
      window.desktopAPI.storage.set(rowKey, rowJson);
    }
    return;
  }
  for (const [rowKey, rowJson] of Object.entries(rows)) {
    localStorage.setItem(rowKey, rowJson);
  }
}

/**
 * How many records a chunked collection holds, without reading any of them.
 *
 * Reads one small manifest row. Screens use this to show a count and decide on
 * paging before committing to loading anything.
 */
export function lsCount(key: string): number {
  if (!CHUNKED_KEYS.has(key)) {
    const raw = readRow(PREFIX + key);
    if (raw === null) return 0;
    try {
      const value = JSON.parse(raw);
      return Array.isArray(value) ? value.length : 0;
    } catch {
      return 0;
    }
  }
  const legacy = readRow(PREFIX + key);
  if (legacy !== null && legacy !== CHUNKED_TOMBSTONE) {
    try {
      const value = JSON.parse(legacy);
      return Array.isArray(value) ? value.length : 0;
    } catch {
      return 0;
    }
  }
  const rawMeta = readRow(metaKey(key));
  if (rawMeta === null) return 0;
  try {
    const total = Number(JSON.parse(rawMeta)?.total);
    return Number.isInteger(total) && total >= 0 ? total : 0;
  } catch {
    return 0;
  }
}

/**
 * Appends to a chunked collection WITHOUT loading it.
 *
 * This is what lets an append-only log — stock movements, audit entries — stay
 * out of memory entirely. Only the last chunk and the manifest are touched, so
 * the cost is the size of one chunk, not the size of the history: recording a
 * movement against 300,000 existing ones costs the same as against 30.
 *
 * Returns false when the collection is not in chunked form (an un-migrated shop,
 * or a restored pre-chunking backup), so the caller can fall back to the
 * load-modify-save path rather than silently dropping the record. Losing a
 * stock movement means the inventory ledger no longer reconciles.
 */
export function lsAppend<T>(key: string, items: readonly T[]): boolean {
  if (!CHUNKED_KEYS.has(key) || items.length === 0) return false;

  const legacy = readRow(PREFIX + key);
  // Not chunked yet: the caller must migrate it the normal way first.
  if (legacy !== null && legacy !== CHUNKED_TOMBSTONE) return false;

  const rawMeta = readRow(metaKey(key));
  if (rawMeta === null) return false;
  let meta: { chunks?: number; total?: number };
  try {
    meta = JSON.parse(rawMeta);
  } catch {
    return false;
  }
  let chunkCount = Number(meta?.chunks);
  let total = Number(meta?.total);
  if (!Number.isInteger(chunkCount) || chunkCount < 0) return false;
  if (!Number.isInteger(total) || total < 0) return false;

  const batch: Record<string, string> = {};
  // Start from the last chunk if it has room; otherwise begin a new one.
  let index = chunkCount === 0 ? 0 : chunkCount - 1;
  let current: T[] = [];
  if (chunkCount > 0) {
    const raw = readRow(chunkKey(key, index));
    if (raw === null) return false;
    try {
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return false;
      current = parsed as T[];
    } catch {
      return false;
    }
    if (current.length >= CHUNK_SIZE) {
      index = chunkCount;
      current = [];
    }
  }

  for (const item of items) {
    if (current.length >= CHUNK_SIZE) {
      batch[chunkKey(key, index)] = JSON.stringify(current);
      index += 1;
      current = [];
    }
    current.push(item);
  }
  batch[chunkKey(key, index)] = JSON.stringify(current);

  chunkCount = index + 1;
  total += items.length;
  batch[metaKey(key)] = JSON.stringify({ chunks: chunkCount, size: CHUNK_SIZE, total });

  for (const [rowKey, rowJson] of Object.entries(batch)) _cache.set(rowKey, rowJson);
  _lastChunkCount.set(key, chunkCount);
  // The in-memory array is no longer what is on disk, and this path does not
  // hold one. Dropping it stops a later full-array flush from skipping chunks
  // by comparing against a snapshot that predates these appends.
  _lastArray.delete(key);
  _lastFlushedRef.delete(key);

  if (window.desktopAPI?.storage?.setBatch) {
    window.desktopAPI.storage.setBatch(batch);
  } else if (window.desktopAPI?.storage) {
    for (const [rowKey, rowJson] of Object.entries(batch)) {
      window.desktopAPI.storage.set(rowKey, rowJson);
    }
  } else {
    for (const [rowKey, rowJson] of Object.entries(batch)) {
      localStorage.setItem(rowKey, rowJson);
    }
  }
  return true;
}

/**
 * Reads a chunked collection newest-first, at most `limit` records, skipping
 * `offset` — without parsing chunks outside that window.
 *
 * Records are appended in chronological order, so a screen showing the most
 * recent movements reads the LAST chunks. Walking backwards means the common
 * case (first page) parses one chunk instead of six hundred.
 */
export function lsSliceReversed<T>(key: string, offset: number, limit: number): T[] {
  if (!CHUNKED_KEYS.has(key) || limit <= 0) return [];

  const legacy = readRow(PREFIX + key);
  if (legacy !== null && legacy !== CHUNKED_TOMBSTONE) {
    try {
      const value = JSON.parse(legacy);
      if (!Array.isArray(value)) return [];
      return value.slice().reverse().slice(offset, offset + limit) as T[];
    } catch {
      return [];
    }
  }

  const rawMeta = readRow(metaKey(key));
  if (rawMeta === null) return [];
  let chunkCount = 0;
  try {
    chunkCount = Number(JSON.parse(rawMeta)?.chunks) || 0;
  } catch {
    return [];
  }

  const out: T[] = [];
  let skipped = 0;
  for (let i = chunkCount - 1; i >= 0 && out.length < limit; i--) {
    const raw = readRow(chunkKey(key, i));
    if (raw === null) continue;
    let part: unknown;
    try {
      part = JSON.parse(raw);
    } catch {
      continue;
    }
    if (!Array.isArray(part)) continue;
    for (let j = part.length - 1; j >= 0 && out.length < limit; j--) {
      if (skipped < offset) {
        skipped += 1;
        continue;
      }
      out.push(part[j] as T);
    }
  }
  return out;
}

/**
 * Removes every record matching `predicate`, rewriting only the chunks that
 * actually contained one, and returns what was removed.
 *
 * Returning the removed records is what lets a caller take an undo snapshot
 * without a second full scan — deleting an invoice has to record the exact
 * movements it erased so the delete can be reversed.
 *
 * Chunks are left under-full rather than re-packed. Re-packing would shift
 * every following record and turn a one-invoice delete back into a rewrite of
 * the whole ledger, which is the cost this design exists to avoid. Readers
 * concatenate chunks and never assume a fixed length, so gaps are harmless.
 *
 * Returns null — changing nothing — when the collection is not in chunked
 * form, so the caller can fall back rather than believe a delete happened.
 */
export function lsRemoveWhere<T>(
  key: string,
  predicate: (item: T) => boolean,
): T[] | null {
  if (!CHUNKED_KEYS.has(key)) return null;

  const legacy = readRow(PREFIX + key);
  if (legacy !== null && legacy !== CHUNKED_TOMBSTONE) return null;

  const rawMeta = readRow(metaKey(key));
  if (rawMeta === null) return null;
  let chunkCount = 0;
  let total = 0;
  try {
    const meta = JSON.parse(rawMeta);
    chunkCount = Number(meta?.chunks);
    total = Number(meta?.total);
  } catch {
    return null;
  }
  if (!Number.isInteger(chunkCount) || !Number.isInteger(total)) return null;

  const removed: T[] = [];
  const batch: Record<string, string> = {};
  for (let i = 0; i < chunkCount; i++) {
    const raw = readRow(chunkKey(key, i));
    if (raw === null) return null;
    let part: unknown;
    try {
      part = JSON.parse(raw);
    } catch {
      return null;
    }
    if (!Array.isArray(part)) return null;

    const kept: T[] = [];
    let touched = false;
    for (const item of part as T[]) {
      if (predicate(item)) {
        removed.push(item);
        touched = true;
      } else {
        kept.push(item);
      }
    }
    if (touched) batch[chunkKey(key, i)] = JSON.stringify(kept);
  }

  if (removed.length === 0) return [];

  batch[metaKey(key)] = JSON.stringify({
    chunks: chunkCount,
    size: CHUNK_SIZE,
    total: total - removed.length,
  });

  for (const [rowKey, rowJson] of Object.entries(batch)) _cache.set(rowKey, rowJson);
  _lastArray.delete(key);
  _lastFlushedRef.delete(key);

  if (window.desktopAPI?.storage?.setBatch) {
    window.desktopAPI.storage.setBatch(batch);
  } else if (window.desktopAPI?.storage) {
    for (const [rowKey, rowJson] of Object.entries(batch)) {
      window.desktopAPI.storage.set(rowKey, rowJson);
    }
  } else {
    for (const [rowKey, rowJson] of Object.entries(batch)) {
      localStorage.setItem(rowKey, rowJson);
    }
  }
  return removed;
}

/**
 * Walks a chunked collection one chunk at a time, keeping only what `select`
 * returns — so a screen can filter three hundred thousand records without ever
 * holding them all at once.
 */
export function lsFilterChunked<T>(key: string, select: (item: T) => boolean): T[] {
  if (!CHUNKED_KEYS.has(key)) return [];

  const legacy = readRow(PREFIX + key);
  if (legacy !== null && legacy !== CHUNKED_TOMBSTONE) {
    try {
      const value = JSON.parse(legacy);
      return Array.isArray(value) ? (value as T[]).filter(select) : [];
    } catch {
      return [];
    }
  }

  const rawMeta = readRow(metaKey(key));
  if (rawMeta === null) return [];
  let chunkCount = 0;
  try {
    chunkCount = Number(JSON.parse(rawMeta)?.chunks) || 0;
  } catch {
    return [];
  }

  const out: T[] = [];
  for (let i = 0; i < chunkCount; i++) {
    const raw = readRow(chunkKey(key, i));
    if (raw === null) continue;
    try {
      const part = JSON.parse(raw);
      if (!Array.isArray(part)) continue;
      for (const item of part as T[]) if (select(item)) out.push(item);
    } catch {
      /* a damaged chunk is skipped rather than failing the whole screen */
    }
  }
  return out;
}

export function lsSet<T>(key: string, value: T): void {
  assertMoney(value, key);
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
const _pendingBusinessKeys = new Set<string>();

/**
 * True when the chunk at [start,end) would serialize to exactly what is already
 * stored — same elements AND same length.
 *
 * The length check is not redundant. A collection that shrinks keeps its
 * leading elements identical, so comparing only those said "unchanged" and
 * skipped the write, leaving the chunk on disk at its old, longer size while
 * the manifest recorded the new count. The read then found more records than
 * the manifest promised, correctly refused to serve a shop it could not
 * verify, and the collection came back as the empty fallback.
 *
 * Found by the property tests, not by hand: it needs a shrink that lands
 * inside a chunk rather than removing whole chunks, which is a narrow target
 * to aim at deliberately.
 */
function unchangedRange(
  previous: readonly unknown[],
  next: readonly unknown[],
  start: number,
  end: number,
): boolean {
  const previousEnd = Math.min(start + CHUNK_SIZE, previous.length);
  if (previousEnd !== end) return false;
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
  // An existing empty manifest with one empty chunk is semantically identical
  // to zero chunks. Rewriting its shape alone invalidates financial queries.
  if (value.length === 0 && _cache.get(PREFIX + key) === CHUNKED_TOMBSTONE) {
    const existingMeta = _cache.get(metaKey(key));
    if (existingMeta && JSON.parse(existingMeta).total === 0) return;
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
  assertMoney(entries);
  const batch: Record<string, string> = {};
  let changeCount = 0;
  for (const [key, value] of Object.entries(entries)) {
    // A timer prepared before checkout must not enqueue an old snapshot
    // while a durable business transaction is awaiting its acknowledgment.
    if (_pendingBusinessKeys.has(key)) continue;
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
export async function lsSetBatchAwait(entries: Record<string, unknown>, pendingOnly = false): Promise<boolean> {
  assertMoney(entries);
  if (pendingOnly) {
    const rows: Record<string, string> = {};
    for (const [key, value] of Object.entries(entries)) {
      if (_lastFlushedRef.get(key) === value) continue;
      if (CHUNKED_KEYS.has(key)) chunkRowsFor(key, value, rows);
      else if (_cache.get(PREFIX + key) !== JSON.stringify(value)) rows[PREFIX + key] = JSON.stringify(value);
    }
    if (!Object.keys(rows).length) return true;
    if (!window.desktopAPI?.storage?.setBatch) throw new Error("durable_storage_unavailable");
    const ok = await window.desktopAPI.storage.setBatch(rows);
    if (ok === false) return false;
    adoptCommittedStorageRows(rows, entries);
    return true;
  }
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

/**
 * Persists every row that makes up one completed sale in a single desktop
 * transaction. Collection rows are prepared without touching the optimistic
 * cache; the cache advances only after the main process acknowledges commit.
 * That keeps a rejected sale invisible both after restart and in the current
 * renderer.
 */
export async function lsCommitSaleAwait<T extends ChronologicalRecord>(
  entries: Record<string, unknown>,
  stockMovementsToAppend: readonly T[],
): Promise<boolean> {
  const rows: Record<string, string> = {};
  const entryArrays = new Map<string, readonly unknown[]>();
  let appendedChunkCount: number | null = null;

  try {
    for (const [key, value] of Object.entries(entries)) {
      if (!CHUNKED_KEYS.has(key) || !Array.isArray(value)) {
        rows[PREFIX + key] = JSON.stringify(value);
        continue;
      }

      const chunks = Math.ceil(value.length / CHUNK_SIZE);
      for (let i = 0; i < chunks; i++) {
        rows[chunkKey(key, i)] = JSON.stringify(
          value.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE),
        );
      }
      rows[metaKey(key)] = JSON.stringify({
        chunks,
        size: CHUNK_SIZE,
        total: value.length,
      });
      rows[PREFIX + key] = CHUNKED_TOMBSTONE;
      const previousChunks = Math.max(_lastChunkCount.get(key) ?? 0, chunks);
      for (let i = chunks; i < previousChunks; i++) {
        rows[chunkKey(key, i)] = "[]";
      }
      entryArrays.set(key, value);
    }

    if (stockMovementsToAppend.length > 0) {
      const key = "stockMovements";
      const legacy = readRow(PREFIX + key);
      if (legacy !== null && legacy !== CHUNKED_TOMBSTONE) {
        const parsed = JSON.parse(legacy);
        if (!Array.isArray(parsed)) return false;
        const all = [...parsed, ...stockMovementsToAppend].sort(
          compareOldestFirstByDateAndId,
        );
        const chunks = Math.ceil(all.length / CHUNK_SIZE);
        for (let i = 0; i < chunks; i++) {
          rows[chunkKey(key, i)] = JSON.stringify(
            all.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE),
          );
        }
        rows[metaKey(key)] = JSON.stringify({
          chunks,
          size: CHUNK_SIZE,
          total: all.length,
        });
        rows[PREFIX + key] = CHUNKED_TOMBSTONE;
        rows[`${PREFIX}${key}#order`] = ORDER_OLDEST_FIRST;
        appendedChunkCount = chunks;
      } else {
        const rawMeta = readRow(metaKey(key));
        if (rawMeta === null) {
          // A tombstone says historical chunks are authoritative. A missing
          // manifest is corruption, never permission to replace that history
          // with a new empty ledger.
          if (legacy === CHUNKED_TOMBSTONE) return false;
          // Brand-new shops have no ledger rows yet. Establish the empty
          // chunked representation and the first append inside this sale's
          // transaction instead of requiring a separate initialization write.
          const all = [...stockMovementsToAppend].sort(
            compareOldestFirstByDateAndId,
          );
          const chunks = Math.ceil(all.length / CHUNK_SIZE);
          for (let i = 0; i < chunks; i++) {
            rows[chunkKey(key, i)] = JSON.stringify(
              all.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE),
            );
          }
          rows[metaKey(key)] = JSON.stringify({
            chunks,
            size: CHUNK_SIZE,
            total: all.length,
          });
          rows[PREFIX + key] = CHUNKED_TOMBSTONE;
          rows[`${PREFIX}${key}#order`] = ORDER_OLDEST_FIRST;
          appendedChunkCount = chunks;
        } else {
          const meta = JSON.parse(rawMeta) as { chunks?: number; total?: number };
          let chunkCount = Number(meta.chunks);
          let total = Number(meta.total);
          if (!Number.isInteger(chunkCount) || chunkCount < 0) return false;
          if (!Number.isInteger(total) || total < 0) return false;

          let index = chunkCount === 0 ? 0 : chunkCount - 1;
          let current: T[] = [];
          if (chunkCount > 0) {
            const raw = readRow(chunkKey(key, index));
            if (raw === null) return false;
            const parsed = JSON.parse(raw);
            if (!Array.isArray(parsed)) return false;
            current = parsed as T[];
            if (current.length >= CHUNK_SIZE) {
              index = chunkCount;
              current = [];
            }
          }
          for (const item of stockMovementsToAppend) {
            if (current.length >= CHUNK_SIZE) {
              rows[chunkKey(key, index)] = JSON.stringify(current);
              index += 1;
              current = [];
            }
            current.push(item);
          }
          rows[chunkKey(key, index)] = JSON.stringify(current);
          chunkCount = index + 1;
          total += stockMovementsToAppend.length;
          rows[metaKey(key)] = JSON.stringify({
            chunks: chunkCount,
            size: CHUNK_SIZE,
            total,
          });
          appendedChunkCount = chunkCount;
        }
      }
    }
  } catch (error) {
    console.error("[storage] Failed to prepare sale transaction:", error);
    return false;
  }

  if (Object.keys(rows).length === 0) return false;
  const businessKeys = [...Object.keys(entries), "stockMovements"];
  for (const key of businessKeys) _pendingBusinessKeys.add(key);
  try {
    let committed = false;
    if (window.desktopAPI?.storage?.commitSale) {
      committed = (await window.desktopAPI.storage.commitSale(rows)) !== false;
    } else if (!window.desktopAPI?.storage) {
      for (const [rowKey, json] of Object.entries(rows)) {
        localStorage.setItem(rowKey, json);
      }
      committed = true;
    }
    if (!committed) return false;

    for (const [rowKey, json] of Object.entries(rows)) _cache.set(rowKey, json);
    for (const [key, value] of Object.entries(entries)) {
      _lastFlushedRef.set(key, value);
    }
    for (const [key, value] of entryArrays) rememberPersistedArray(key, value);
    if (appendedChunkCount !== null) {
      _lastChunkCount.set("stockMovements", appendedChunkCount);
      _lastArray.delete("stockMovements");
      _lastFlushedRef.delete("stockMovements");
    }
    return true;
  } catch {
    return false;
  } finally {
    for (const key of businessKeys) _pendingBusinessKeys.delete(key);
  }
}


/** Prevent stale debounce writes until an external business commit is adopted. */
export async function withPendingPersistenceCollections<T>(keys: readonly string[], action: () => Promise<T>): Promise<T> {
  for (const key of keys) _pendingBusinessKeys.add(key);
  try { return await action(); }
  finally { for (const key of keys) _pendingBusinessKeys.delete(key); }
}

/** Adopt acknowledged main-process rows, without fetching historical ledgers. */
export function adoptCommittedStorageRows(
  rows: Record<string, string>,
  persistedValues: Record<string, unknown> = {},
): void {
  const changedKeys = new Set<string>();
  for (const [key, json] of Object.entries(rows)) {
    if (!key.startsWith(PREFIX)) throw new Error("invalid_committed_storage_key");
    _cache.set(key, json);
    changedKeys.add(key.slice(PREFIX.length).split("#")[0]);
  }
  for (const key of changedKeys) {
    _lastArray.delete(key);
    _lastFlushedRef.delete(key);
  }
  for (const [key, value] of Object.entries(persistedValues)) {
    _lastFlushedRef.set(key, value);
    if (Array.isArray(value)) rememberPersistedArray(key, value);
  }
  rememberChunkCounts();
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
