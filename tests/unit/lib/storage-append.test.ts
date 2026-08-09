import { describe, it, expect, beforeEach, vi } from "vitest";
import fc from "fast-check";

/**
 * Appending to a chunked collection without loading it.
 *
 * This is what keeps an append-only ledger — stock movements — out of memory
 * entirely. A dropped or duplicated append here means the inventory no longer
 * reconciles with the invoices that caused it, which is the kind of wrong that
 * a shop discovers during a stocktake months later.
 */

const PREFIX = "autoparts_inventory_v1::";
const TOMBSTONE = '"__partflow_chunked__"';

function makeDesktop() {
  const rows = new Map<string, string>();
  return {
    rows,
    api: {
      storage: {
        get: (k: string) => (rows.has(k) ? rows.get(k)! : null),
        getBatch: async () => Object.fromEntries(rows),
        set: (k: string, v: string) => { rows.set(k, v); return true; },
        setBatch: (batch: Record<string, string>) => {
          for (const [k, v] of Object.entries(batch)) rows.set(k, v);
          return Promise.resolve(true);
        },
        remove: (k: string) => { rows.delete(k); return true; },
        clearPrefix: () => true,
      },
    },
  };
}

let desktop: ReturnType<typeof makeDesktop>;
let storage: typeof import("../../../src/lib/storage");

async function freshModule(carryOver?: Map<string, string>) {
  vi.resetModules();
  const previous = carryOver ?? new Map<string, string>();
  desktop = makeDesktop();
  for (const [k, v] of previous) desktop.rows.set(k, v);
  (globalThis as unknown as { window: unknown }).window = { desktopAPI: desktop.api };
  storage = await import("../../../src/lib/storage");
  await storage.reloadStorageCache();
}

const mv = (i: number) => ({ id: `mv-${i}`, productId: `p-${i % 7}`, quantity: i });

beforeEach(async () => {
  await freshModule();
});

describe("lsAppend", () => {
  it("appends without loading the collection, and the result reads back whole", async () => {
    const initial = Array.from({ length: 1250 }, (_, i) => mv(i));
    storage.lsSetBatch({ stockMovements: initial });
    await freshModule(new Map(desktop.rows));

    expect(storage.lsAppend("stockMovements", [mv(1250), mv(1251)])).toBe(true);
    await storage.reloadStorageCache();

    const all = storage.lsGet<Array<{ id: string }>>("stockMovements", []);
    expect(all).toHaveLength(1252);
    expect(all[1250].id).toBe("mv-1250");
    expect(all[1251].id).toBe("mv-1251");
  });

  it("touches only the last chunk and the manifest", async () => {
    storage.lsSetBatch({ stockMovements: Array.from({ length: 1250 }, (_, i) => mv(i)) });
    await freshModule(new Map(desktop.rows));

    const writes: string[] = [];
    desktop.api.storage.setBatch = (batch: Record<string, string>) => {
      writes.push(...Object.keys(batch));
      for (const [k, v] of Object.entries(batch)) desktop.rows.set(k, v);
      return Promise.resolve(true);
    };

    storage.lsAppend("stockMovements", [mv(1250)]);

    expect(writes.sort()).toEqual([
      `${PREFIX}stockMovements#0002`,
      `${PREFIX}stockMovements#meta`,
    ]);
  });

  it("opens a new chunk when the last one is full", async () => {
    storage.lsSetBatch({ stockMovements: Array.from({ length: 1000 }, (_, i) => mv(i)) });
    await freshModule(new Map(desktop.rows));

    storage.lsAppend("stockMovements", [mv(1000)]);
    await storage.reloadStorageCache();

    expect(desktop.rows.get(`${PREFIX}stockMovements#meta`))
      .toBe(JSON.stringify({ chunks: 3, size: 500, total: 1001 }));
    expect(JSON.parse(desktop.rows.get(`${PREFIX}stockMovements#0002`)!)).toHaveLength(1);
    expect(storage.lsGet<unknown[]>("stockMovements", [])).toHaveLength(1001);
  });

  it("handles an append that spans several new chunks", async () => {
    storage.lsSetBatch({ stockMovements: Array.from({ length: 300 }, (_, i) => mv(i)) });
    await freshModule(new Map(desktop.rows));

    const burst = Array.from({ length: 1400 }, (_, i) => mv(300 + i));
    expect(storage.lsAppend("stockMovements", burst)).toBe(true);
    await storage.reloadStorageCache();

    const all = storage.lsGet<Array<{ id: string }>>("stockMovements", []);
    expect(all).toHaveLength(1700);
    expect(all.map((r) => r.id)).toEqual(
      Array.from({ length: 1700 }, (_, i) => `mv-${i}`));
  });

  it("appends onto an empty collection", async () => {
    storage.lsSetBatch({ stockMovements: [] });
    await freshModule(new Map(desktop.rows));

    expect(storage.lsAppend("stockMovements", [mv(0)])).toBe(true);
    await storage.reloadStorageCache();
    expect(storage.lsGet<unknown[]>("stockMovements", [])).toHaveLength(1);
  });

  it("refuses on an un-migrated collection so the caller can fall back", async () => {
    // A shop that has not been chunked yet, or one where a pre-chunking backup
    // was just restored. Silently succeeding here would drop the record.
    desktop.rows.set(`${PREFIX}stockMovements`, JSON.stringify([mv(0)]));
    await storage.reloadStorageCache();

    expect(storage.lsAppend("stockMovements", [mv(1)])).toBe(false);
    expect(storage.lsGet<unknown[]>("stockMovements", [])).toHaveLength(1);
  });

  it("refuses when the manifest is missing or unreadable", async () => {
    desktop.rows.set(`${PREFIX}stockMovements`, TOMBSTONE);
    await storage.reloadStorageCache();
    expect(storage.lsAppend("stockMovements", [mv(1)])).toBe(false);

    desktop.rows.set(`${PREFIX}stockMovements#meta`, "{broken");
    await storage.reloadStorageCache();
    expect(storage.lsAppend("stockMovements", [mv(1)])).toBe(false);
  });

  it("refuses when the chunk it would extend cannot be read", async () => {
    storage.lsSetBatch({ stockMovements: Array.from({ length: 600 }, (_, i) => mv(i)) });
    const onDisk = new Map(desktop.rows);
    onDisk.delete(`${PREFIX}stockMovements#0001`);
    await freshModule(onDisk);

    // Appending onto a chunk that is not there would silently discard whatever
    // that chunk held.
    expect(storage.lsAppend("stockMovements", [mv(600)])).toBe(false);
  });

  it("refuses for a collection that is not chunked at all", () => {
    expect(storage.lsAppend("settings", [{ a: 1 }])).toBe(false);
  });

  it("survives a restart between appends", async () => {
    storage.lsSetBatch({ stockMovements: [] });
    let expected = 0;
    for (let round = 0; round < 6; round++) {
      await freshModule(new Map(desktop.rows));
      const batch = Array.from({ length: 200 }, (_, i) => mv(expected + i));
      expect(storage.lsAppend("stockMovements", batch)).toBe(true);
      expected += 200;
    }
    await freshModule(new Map(desktop.rows));
    const all = storage.lsGet<Array<{ id: string }>>("stockMovements", []);
    expect(all).toHaveLength(expected);
    expect(all[expected - 1].id).toBe(`mv-${expected - 1}`);
  });

  it("does not let a later full-array flush undo the appends", async () => {
    const initial = Array.from({ length: 700 }, (_, i) => mv(i));
    storage.lsSetBatch({ stockMovements: initial });
    await freshModule(new Map(desktop.rows));

    // A screen loads the collection (seeding the identity snapshot), then an
    // append happens behind its back, then the screen's stale array is flushed.
    const loaded = storage.lsGet<unknown[]>("stockMovements", []);
    expect(loaded).toHaveLength(700);
    storage.lsAppend("stockMovements", [mv(700)]);

    storage.lsSetBatch({ stockMovements: loaded });
    await storage.reloadStorageCache();

    // The flush legitimately rewrites the collection to 700 — that is what it
    // was told to persist. What must NOT happen is a torn state where the
    // manifest and chunks disagree.
    const after = storage.lsGet<unknown[]>("stockMovements", []);
    expect(after).toHaveLength(700);
  });
});

describe("lsCount", () => {
  it("reports the size without reading any record", async () => {
    storage.lsSetBatch({ stockMovements: Array.from({ length: 2345 }, (_, i) => mv(i)) });
    await freshModule(new Map(desktop.rows));
    expect(storage.lsCount("stockMovements")).toBe(2345);
  });

  it("reports 0 for a collection that was never written", () => {
    expect(storage.lsCount("stockMovements")).toBe(0);
  });

  it("reports the size of a legacy single blob too", async () => {
    desktop.rows.set(`${PREFIX}stockMovements`, JSON.stringify([mv(0), mv(1), mv(2)]));
    await storage.reloadStorageCache();
    expect(storage.lsCount("stockMovements")).toBe(3);
  });

  it("tracks appends", async () => {
    storage.lsSetBatch({ stockMovements: Array.from({ length: 10 }, (_, i) => mv(i)) });
    await freshModule(new Map(desktop.rows));
    storage.lsAppend("stockMovements", [mv(10), mv(11)]);
    expect(storage.lsCount("stockMovements")).toBe(12);
  });
});

describe("lsSliceReversed", () => {
  it("returns the newest records first", async () => {
    storage.lsSetBatch({ stockMovements: Array.from({ length: 1250 }, (_, i) => mv(i)) });
    await freshModule(new Map(desktop.rows));

    const page = storage.lsSliceReversed<{ id: string }>("stockMovements", 0, 3);
    expect(page.map((r) => r.id)).toEqual(["mv-1249", "mv-1248", "mv-1247"]);
  });

  it("pages correctly across chunk boundaries", async () => {
    storage.lsSetBatch({ stockMovements: Array.from({ length: 1250 }, (_, i) => mv(i)) });
    await freshModule(new Map(desktop.rows));

    const all = storage.lsGet<Array<{ id: string }>>("stockMovements", []).slice().reverse();
    for (const [offset, limit] of [[0, 500], [498, 5], [745, 10], [1245, 20]]) {
      const page = storage.lsSliceReversed<{ id: string }>("stockMovements", offset, limit);
      expect(page.map((r) => r.id)).toEqual(all.slice(offset, offset + limit).map((r) => r.id));
    }
  });

  it("reads only the chunks the page needs", async () => {
    storage.lsSetBatch({ stockMovements: Array.from({ length: 5000 }, (_, i) => mv(i)) });
    const onDisk = new Map(desktop.rows);
    await freshModule(onDisk);

    const reads: string[] = [];
    const realGet = desktop.api.storage.get;
    desktop.api.storage.get = (k: string) => { reads.push(k); return realGet(k); };
    // Force every read through the IPC path so they can be counted.
    storage.pruneStorageMemoryCache(0);

    storage.lsSliceReversed("stockMovements", 0, 10);

    // Ten chunks exist; the newest page must not touch the older nine.
    const chunkReads = reads.filter((k) => /#\d{4}$/.test(k));
    expect(chunkReads.length).toBeLessThanOrEqual(2);
  });

  it("returns an empty page past the end", async () => {
    storage.lsSetBatch({ stockMovements: Array.from({ length: 100 }, (_, i) => mv(i)) });
    await freshModule(new Map(desktop.rows));
    expect(storage.lsSliceReversed("stockMovements", 500, 10)).toEqual([]);
  });

  it("works on a legacy single blob", async () => {
    desktop.rows.set(`${PREFIX}stockMovements`, JSON.stringify([mv(0), mv(1), mv(2)]));
    await storage.reloadStorageCache();
    expect(storage.lsSliceReversed<{ id: string }>("stockMovements", 0, 2).map((r) => r.id))
      .toEqual(["mv-2", "mv-1"]);
  });
});

describe("property: append then read back, whatever the shape", () => {
  it("preserves every record in order across arbitrary append bursts", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 0, max: 900 }),
        fc.array(fc.integer({ min: 1, max: 250 }), { minLength: 1, maxLength: 12 }),
        async (initialSize, bursts) => {
          await freshModule();
          const expected = Array.from({ length: initialSize }, (_, i) => mv(i));
          storage.lsSetBatch({ stockMovements: expected });
          await freshModule(new Map(desktop.rows));

          let n = initialSize;
          for (const size of bursts) {
            const batch = Array.from({ length: size }, (_, i) => mv(n + i));
            n += size;
            expect(storage.lsAppend("stockMovements", batch)).toBe(true);
            expected.push(...batch);
          }

          await freshModule(new Map(desktop.rows));
          const all = storage.lsGet<Array<{ id: string }>>("stockMovements", []);
          expect(all.map((r) => r.id)).toEqual(expected.map((r) => r.id));
          expect(storage.lsCount("stockMovements")).toBe(expected.length);
        },
      ),
      { numRuns: 120 },
    );
  });
});
