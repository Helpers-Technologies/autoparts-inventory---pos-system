import { describe, it, expect, beforeEach, vi } from "vitest";

/**
 * Chunked persistence for the large collections.
 *
 * These tests are deliberately paranoid. The failure mode being guarded against
 * is not "slow" — it is a shop opening the app one morning to find three years
 * of sales missing, which no amount of apologising fixes. Every test here
 * describes a way that could happen.
 */

const PREFIX = "autoparts_inventory_v1::";
const TOMBSTONE = '"__partflow_chunked__"';

/** A stand-in for the main process: one map of rows, plus the ability to
 *  simulate the transaction boundary and a dropped write. */
function makeDesktop() {
  const rows = new Map<string, string>();
  let rejectKey: string | null = null;
  return {
    rows,
    rejectWritesTo(key: string | null) { rejectKey = key; },
    api: {
      storage: {
        get: (key: string) => (rows.has(key) ? rows.get(key)! : null),
        getBatch: async () => Object.fromEntries(rows),
        set: (key: string, value: string) => { rows.set(key, value); return true; },
        setBatch: async (batch: Record<string, string>) => {
          // One transaction: either every row lands or none does.
          if (rejectKey && Object.keys(batch).some((k) => k === rejectKey)) return false;
          for (const [k, v] of Object.entries(batch)) rows.set(k, v);
          return true;
        },
        remove: (key: string) => { rows.delete(key); return true; },
        clearPrefix: () => true,
      },
    },
  };
}

let desktop: ReturnType<typeof makeDesktop>;
type StorageModule = typeof import("../../../src/lib/storage");
let storage: StorageModule;

async function freshModule() {
  vi.resetModules();
  desktop = makeDesktop();
  // The module reads `window.desktopAPI.storage`, so the fake has to sit at
  // that exact path — not stand in for `window` itself.
  (globalThis as unknown as { window: unknown }).window = { desktopAPI: desktop.api };
  storage = await import("../../../src/lib/storage");
  return storage;
}

const invoices = (n: number, tag = "v1") =>
  Array.from({ length: n }, (_, i) => ({ id: `inv-${i}`, total: i, tag }));

beforeEach(async () => {
  await freshModule();
});

describe("round-trip", () => {
  it("writes and reads back a collection larger than one chunk", async () => {
    const data = invoices(1250); // 3 chunks at 500
    storage.lsSetBatch({ salesInvoices: data });
    await storage.reloadStorageCache();
    expect(storage.lsGet("salesInvoices", [])).toEqual(data);
  });

  it("stores it as chunks plus a manifest, not one blob", () => {
    storage.lsSetBatch({ salesInvoices: invoices(1250) });
    expect(desktop.rows.get(`${PREFIX}salesInvoices#meta`))
      .toBe(JSON.stringify({ chunks: 3, size: 500, total: 1250 }));
    expect(desktop.rows.has(`${PREFIX}salesInvoices#0000`)).toBe(true);
    expect(desktop.rows.has(`${PREFIX}salesInvoices#0002`)).toBe(true);
    // The base row is a tombstone, not the data.
    expect(desktop.rows.get(`${PREFIX}salesInvoices`)).toBe(TOMBSTONE);
  });

  it("handles an empty collection", async () => {
    storage.lsSetBatch({ salesInvoices: [] });
    await storage.reloadStorageCache();
    expect(storage.lsGet("salesInvoices", [{ id: "seed" }])).toEqual([]);
  });

  it("handles a collection that exactly fills its chunks", async () => {
    const data = invoices(1000);
    storage.lsSetBatch({ salesInvoices: data });
    await storage.reloadStorageCache();
    expect(storage.lsGet("salesInvoices", [])).toEqual(data);
    expect(desktop.rows.has(`${PREFIX}salesInvoices#0002`)).toBe(false);
  });
});

describe("the point of the exercise: appending is cheap", () => {
  it("appending one record rewrites only the last chunk and the manifest", () => {
    const data = invoices(1250);
    storage.lsSetBatch({ salesInvoices: data });

    const writes: string[] = [];
    const realSetBatch = desktop.api.storage.setBatch.bind(desktop.api.storage);
    desktop.api.storage.setBatch = async (batch: Record<string, string>) => {
      writes.push(...Object.keys(batch));
      return realSetBatch(batch);
    };

    storage.lsSetBatch({ salesInvoices: [...data, { id: "inv-new", total: 9, tag: "v1" }] });

    // Chunk 2 is the one being appended to; 0 and 1 are untouched.
    expect(writes).toContain(`${PREFIX}salesInvoices#0002`);
    expect(writes).toContain(`${PREFIX}salesInvoices#meta`);
    expect(writes).not.toContain(`${PREFIX}salesInvoices#0000`);
    expect(writes).not.toContain(`${PREFIX}salesInvoices#0001`);
  });

  it("editing an old record rewrites only that record's chunk", () => {
    const data = invoices(1250);
    storage.lsSetBatch({ salesInvoices: data });

    const writes: string[] = [];
    const realSetBatch = desktop.api.storage.setBatch.bind(desktop.api.storage);
    desktop.api.storage.setBatch = async (batch: Record<string, string>) => {
      writes.push(...Object.keys(batch));
      return realSetBatch(batch);
    };

    const edited = data.slice();
    edited[10] = { ...edited[10], total: 999 };
    storage.lsSetBatch({ salesInvoices: edited });

    expect(writes).toContain(`${PREFIX}salesInvoices#0000`);
    expect(writes).not.toContain(`${PREFIX}salesInvoices#0001`);
    expect(writes).not.toContain(`${PREFIX}salesInvoices#0002`);
  });
});

describe("identity-based skipping does not miss real edits", () => {
  it("persists a record replaced in the middle of an early chunk", async () => {
    const data = invoices(1250);
    storage.lsSetBatch({ salesInvoices: data });
    await storage.reloadStorageCache();

    const edited = data.slice();
    edited[3] = { ...edited[3], total: 12345 };
    storage.lsSetBatch({ salesInvoices: edited });
    await storage.reloadStorageCache();

    const read = storage.lsGet<Array<{ total: number }>>("salesInvoices", []);
    expect(read[3].total).toBe(12345);
    expect(read).toHaveLength(1250);
  });

  it("persists a record removed from the middle, shifting everything after it", async () => {
    const data = invoices(1250);
    storage.lsSetBatch({ salesInvoices: data });
    await storage.reloadStorageCache();

    // Removing element 2 shifts every later element by one, so every chunk
    // from the first onwards genuinely changes and none may be skipped.
    const without = data.filter((_, i) => i !== 2);
    storage.lsSetBatch({ salesInvoices: without });
    await storage.reloadStorageCache();

    const read = storage.lsGet<Array<{ id: string }>>("salesInvoices", []);
    expect(read).toHaveLength(1249);
    expect(read.some((r) => r.id === "inv-2")).toBe(false);
    expect(read[read.length - 1].id).toBe("inv-1249");
  });

  it("persists a reordered collection", async () => {
    const data = invoices(1250);
    storage.lsSetBatch({ salesInvoices: data });
    await storage.reloadStorageCache();

    const reversed = data.slice().reverse();
    storage.lsSetBatch({ salesInvoices: reversed });
    await storage.reloadStorageCache();

    expect(storage.lsGet("salesInvoices", [])).toEqual(reversed);
  });

  it("rewrites everything after a cold start, when nothing is known about the previous array", async () => {
    storage.lsSetBatch({ salesInvoices: invoices(1250) });
    const onDisk = new Map(desktop.rows);

    await freshModule();
    for (const [k, v] of onDisk) desktop.rows.set(k, v);
    await storage.reloadStorageCache();

    // A fresh process has no previous array to compare against, so it must not
    // assume anything is unchanged.
    const edited = invoices(1250);
    edited[900] = { ...edited[900], total: 777 };
    storage.lsSetBatch({ salesInvoices: edited });
    await storage.reloadStorageCache();

    expect(storage.lsGet<Array<{ total: number }>>("salesInvoices", [])[900].total).toBe(777);
  });
});

describe("shrinking", () => {
  it("does not resurrect deleted records when the collection gets shorter", async () => {
    storage.lsSetBatch({ salesInvoices: invoices(1250) });
    await storage.reloadStorageCache();

    const shorter = invoices(600);
    storage.lsSetBatch({ salesInvoices: shorter });
    await storage.reloadStorageCache();

    const read = storage.lsGet<Array<{ id: string }>>("salesInvoices", []);
    expect(read).toHaveLength(600);
    expect(read.some((r) => r.id === "inv-1200")).toBe(false);
  });

  it("blanks the orphaned chunks rather than leaving stale records on disk", () => {
    storage.lsSetBatch({ salesInvoices: invoices(1250) });
    storage.lsSetBatch({ salesInvoices: invoices(600) });
    expect(desktop.rows.get(`${PREFIX}salesInvoices#0002`)).toBe("[]");
  });
});

describe("migrating a shop that predates chunking", () => {
  it("reads the legacy single blob when no chunks exist yet", async () => {
    const legacy = invoices(30, "legacy");
    desktop.rows.set(`${PREFIX}salesInvoices`, JSON.stringify(legacy));
    await storage.reloadStorageCache();
    expect(storage.lsGet("salesInvoices", [])).toEqual(legacy);
  });

  it("converts to chunks on the first write and keeps the data intact", async () => {
    const legacy = invoices(30, "legacy");
    desktop.rows.set(`${PREFIX}salesInvoices`, JSON.stringify(legacy));
    await storage.reloadStorageCache();

    const loaded = storage.lsGet<typeof legacy>("salesInvoices", []);
    storage.lsSetBatch({ salesInvoices: loaded });
    await storage.reloadStorageCache();

    expect(desktop.rows.get(`${PREFIX}salesInvoices`)).toBe(TOMBSTONE);
    expect(storage.lsGet("salesInvoices", [])).toEqual(legacy);
  });
});

describe("restoring a backup taken before chunking", () => {
  it("prefers the restored legacy blob over the chunks it replaced", async () => {
    // Shop has been running on chunks...
    storage.lsSetBatch({ salesInvoices: invoices(1250, "current") });
    await storage.reloadStorageCache();

    // ...then the owner restores a backup file from before the upgrade, which
    // writes the single-blob row straight into kv_store.
    const fromBackup = invoices(40, "from-backup");
    desktop.rows.set(`${PREFIX}salesInvoices`, JSON.stringify(fromBackup));
    await storage.reloadStorageCache();

    // Serving the chunks here would silently discard the restore and hand back
    // the very data the owner was trying to roll back from.
    expect(storage.lsGet("salesInvoices", [])).toEqual(fromBackup);
  });
});

describe("refusing to serve half a shop", () => {
  it("falls back rather than returning a truncated collection when a chunk is missing", async () => {
    // Written by a previous run, then one chunk row is lost on disk. Simulated
    // from a cold start, because the in-memory cache would otherwise still be
    // holding the row this test needs to be absent.
    storage.lsSetBatch({ salesInvoices: invoices(1250) });
    const onDisk = new Map(desktop.rows);
    onDisk.delete(`${PREFIX}salesInvoices#0001`);

    await freshModule();
    for (const [k, v] of onDisk) desktop.rows.set(k, v);
    await storage.reloadStorageCache();

    // 1000 records would look entirely believable, and the next flush would
    // write that truncation back over the good chunks.
    const seed = [{ id: "seed" }];
    expect(storage.lsGet("salesInvoices", seed)).toEqual(seed);
  });

  it("falls back when the manifest disagrees with what the chunks hold", async () => {
    storage.lsSetBatch({ salesInvoices: invoices(1250) });
    const onDisk = new Map(desktop.rows);
    onDisk.set(`${PREFIX}salesInvoices#meta`,
      JSON.stringify({ chunks: 3, size: 500, total: 9999 }));

    await freshModule();
    for (const [k, v] of onDisk) desktop.rows.set(k, v);
    await storage.reloadStorageCache();

    const seed = [{ id: "seed" }];
    expect(storage.lsGet("salesInvoices", seed)).toEqual(seed);
  });

  it("falls back on a corrupt manifest", async () => {
    storage.lsSetBatch({ salesInvoices: invoices(600) });
    const onDisk = new Map(desktop.rows);
    onDisk.set(`${PREFIX}salesInvoices#meta`, "{not json");

    await freshModule();
    for (const [k, v] of onDisk) desktop.rows.set(k, v);
    await storage.reloadStorageCache();

    const seed = [{ id: "seed" }];
    expect(storage.lsGet("salesInvoices", seed)).toEqual(seed);
  });
});

describe("atomicity", () => {
  it("sends chunks and their manifest in one batch, never separately", () => {
    let batches = 0;
    let sawMetaWithChunks = false;
    desktop.api.storage.setBatch = async (batch: Record<string, string>) => {
      batches++;
      const keys = Object.keys(batch);
      if (keys.includes(`${PREFIX}salesInvoices#meta`)) {
        sawMetaWithChunks = keys.some((k) => /#\d{4}$/.test(k));
      }
      for (const [k, v] of Object.entries(batch)) desktop.rows.set(k, v);
      return true;
    };
    storage.lsSetBatch({ salesInvoices: invoices(1250) });
    expect(batches).toBe(1);
    expect(sawMetaWithChunks).toBe(true);
  });
});

describe("keys that must NOT be chunked", () => {
  it("leaves users as a single row, because hash redaction matches that exact key", () => {
    storage.lsSetBatch({ users: [{ id: "u1", passwordHash: "secret" }] });
    expect(desktop.rows.has(`${PREFIX}users`)).toBe(true);
    expect(desktop.rows.get(`${PREFIX}users`)).not.toBe(TOMBSTONE);
    expect(desktop.rows.has(`${PREFIX}users#meta`)).toBe(false);
  });

  it("leaves settings and scalars alone", () => {
    storage.lsSetBatch({ settings: { shopName: "متجر" }, nextProductCode: 42 });
    expect(desktop.rows.get(`${PREFIX}nextProductCode`)).toBe("42");
    expect(desktop.rows.has(`${PREFIX}settings#meta`)).toBe(false);
  });
});

describe("lsRemove", () => {
  it("removes the chunks too, so a delete does not come back on next read", async () => {
    storage.lsSetBatch({ salesInvoices: invoices(1250) });
    await storage.reloadStorageCache();
    storage.lsRemove("salesInvoices");
    expect([...desktop.rows.keys()].filter((k) => k.startsWith(`${PREFIX}salesInvoices`)))
      .toEqual([]);
  });
});

describe("surviving a restart", () => {
  it("still blanks orphaned chunks after the app has been closed and reopened", async () => {
    storage.lsSetBatch({ salesInvoices: invoices(1250) });
    const onDisk = new Map(desktop.rows);

    // New process: the module has no memory of how many chunks there were.
    await freshModule();
    for (const [k, v] of onDisk) desktop.rows.set(k, v);
    await storage.reloadStorageCache();

    storage.lsSetBatch({ salesInvoices: invoices(600) });
    expect(desktop.rows.get(`${PREFIX}salesInvoices#0002`)).toBe("[]");

    await storage.reloadStorageCache();
    expect(storage.lsGet<Array<unknown>>("salesInvoices", [])).toHaveLength(600);
  });

  it("cleans up orphans even when the cache has been pruned", async () => {
    storage.lsSetBatch({ salesInvoices: invoices(1250) });
    // Simulate memory pressure evicting the chunk rows the cleanup used to
    // depend on being present.
    storage.pruneStorageMemoryCache(0);

    storage.lsSetBatch({ salesInvoices: invoices(600) });
    expect(desktop.rows.get(`${PREFIX}salesInvoices#0002`)).toBe("[]");
  });
});

describe("startup does not rewrite what it just read", () => {
  it("writes nothing when the loaded array is flushed back unchanged", async () => {
    storage.lsSetBatch({ salesInvoices: invoices(2300) });
    const onDisk = new Map(desktop.rows);

    // Cold start: read the collection the way AppContext does on mount.
    await freshModule();
    for (const [k, v] of onDisk) desktop.rows.set(k, v);
    await storage.reloadStorageCache();
    const loaded = storage.lsGet<Array<unknown>>("salesInvoices", []);
    expect(loaded).toHaveLength(2300);

    const writes: string[] = [];
    desktop.api.storage.setBatch = async (batch: Record<string, string>) => {
      writes.push(...Object.keys(batch));
      for (const [k, v] of Object.entries(batch)) desktop.rows.set(k, v);
      return true;
    };

    // The debounced flush fires with exactly what was loaded. Re-serializing
    // and re-writing all of it — 185 MB on a real five-year shop — is pure
    // waste, and it lands right after sign-in when the owner is waiting.
    storage.lsSetBatch({ salesInvoices: loaded });
    expect(writes).toEqual([]);
  });

  it("still writes when the loaded array is genuinely modified first", async () => {
    storage.lsSetBatch({ salesInvoices: invoices(2300) });
    const onDisk = new Map(desktop.rows);

    await freshModule();
    for (const [k, v] of onDisk) desktop.rows.set(k, v);
    await storage.reloadStorageCache();
    const loaded = storage.lsGet<Array<{ id: string }>>("salesInvoices", []);

    const writes: string[] = [];
    desktop.api.storage.setBatch = async (batch: Record<string, string>) => {
      writes.push(...Object.keys(batch));
      for (const [k, v] of Object.entries(batch)) desktop.rows.set(k, v);
      return true;
    };

    storage.lsSetBatch({ salesInvoices: [...loaded, { id: "inv-new" }] });
    expect(writes).toContain(`${PREFIX}salesInvoices#0004`);
    expect(writes).toContain(`${PREFIX}salesInvoices#meta`);
  });
});

describe("the durable flush used on quit and restore", () => {
  it("writes every chunk, not only the changed ones", async () => {
    storage.lsSetBatch({ salesInvoices: invoices(1250) });
    const writes: string[] = [];
    desktop.api.storage.setBatch = async (batch: Record<string, string>) => {
      writes.push(...Object.keys(batch));
      for (const [k, v] of Object.entries(batch)) desktop.rows.set(k, v);
      return true;
    };
    // Same data: the debounced path would write nothing, but a restore has to
    // land completely even where the cache agrees with disk.
    await storage.lsSetBatchAwait({ salesInvoices: invoices(1250) });
    expect(writes).toContain(`${PREFIX}salesInvoices#0000`);
    expect(writes).toContain(`${PREFIX}salesInvoices#0001`);
    expect(writes).toContain(`${PREFIX}salesInvoices#0002`);
    expect(writes).toContain(`${PREFIX}salesInvoices#meta`);
  });

  it("reports failure when the transaction is rejected", async () => {
    desktop.rejectWritesTo(`${PREFIX}salesInvoices#meta`);
    const ok = await storage.lsSetBatchAwait({ salesInvoices: invoices(600) });
    expect(ok).toBe(false);
  });
});
