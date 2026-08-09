import { describe, it, expect, beforeEach, vi } from "vitest";
import fc from "fast-check";

/**
 * The ledger operations: one-time reordering, selective removal, and filtered
 * scans.
 *
 * This is the stock-movement ledger, which has to reconcile with the invoices
 * that produced it. A movement lost here does not announce itself — it surfaces
 * as an unexplained discrepancy at a stocktake months later, by which point
 * nobody can tell which of a year's invoices was wrong. The migration is the
 * sharpest edge: it rewrites every existing shop's ledger exactly once.
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

type Mv = { id: string; referenceId?: string; productId: string; quantity: number };
const mv = (i: number, ref?: string): Mv =>
  ({ id: `mv-${i}`, referenceId: ref, productId: `p-${i % 5}`, quantity: i });

beforeEach(async () => {
  await freshModule();
});

describe("migrating an existing shop to oldest-first", () => {
  it("reverses a newest-first ledger exactly once", async () => {
    // How every shop's ledger looks today: newest at the front.
    const newestFirst = Array.from({ length: 1250 }, (_, i) => mv(1249 - i));
    storage.lsSetBatch({ stockMovements: newestFirst });
    await freshModule(new Map(desktop.rows));

    expect(storage.lsIsOldestFirst("stockMovements")).toBe(false);
    const migrated = storage.lsMigrateToOldestFirst<Mv>("stockMovements");

    expect(migrated).not.toBeNull();
    expect(migrated!.map((m) => m.id)).toEqual(
      Array.from({ length: 1250 }, (_, i) => `mv-${i}`));
    expect(storage.lsIsOldestFirst("stockMovements")).toBe(true);

    await storage.reloadStorageCache();
    expect(storage.lsGet<Mv[]>("stockMovements", []).map((m) => m.id))
      .toEqual(migrated!.map((m) => m.id));
  });

  it("does nothing on a second run, even across a restart", async () => {
    storage.lsSetBatch({ stockMovements: Array.from({ length: 700 }, (_, i) => mv(i)) });
    await freshModule(new Map(desktop.rows));
    const first = storage.lsMigrateToOldestFirst<Mv>("stockMovements");
    expect(first).not.toBeNull();

    // Running twice must not reverse it back.
    expect(storage.lsMigrateToOldestFirst<Mv>("stockMovements")).toBeNull();

    await freshModule(new Map(desktop.rows));
    expect(storage.lsMigrateToOldestFirst<Mv>("stockMovements")).toBeNull();
    expect(storage.lsGet<Mv[]>("stockMovements", []).map((m) => m.id))
      .toEqual(first!.map((m) => m.id));
  });

  it("migrates a shop still on the pre-chunking single blob", async () => {
    const newestFirst = Array.from({ length: 40 }, (_, i) => mv(39 - i));
    desktop.rows.set(`${PREFIX}stockMovements`, JSON.stringify(newestFirst));
    await storage.reloadStorageCache();

    const migrated = storage.lsMigrateToOldestFirst<Mv>("stockMovements");
    expect(migrated!.map((m) => m.id)).toEqual(
      Array.from({ length: 40 }, (_, i) => `mv-${i}`));
    expect(desktop.rows.get(`${PREFIX}stockMovements`)).toBe(TOMBSTONE);
  });

  it("establishes the empty chunked form on a brand-new shop", async () => {
    // Writing only the marker here was a real bug: without a manifest the very
    // first append has nothing to extend, refuses, and the movement is lost —
    // while the invoice that caused it is filed as normal.
    expect(storage.lsMigrateToOldestFirst<Mv>("stockMovements")).toEqual([]);
    expect(storage.lsIsOldestFirst("stockMovements")).toBe(true);
    expect(storage.lsGet<Mv[]>("stockMovements", [])).toEqual([]);

    expect(storage.lsAppend("stockMovements", [mv(0)])).toBe(true);
    await storage.reloadStorageCache();
    expect(storage.lsGet<Mv[]>("stockMovements", [])).toHaveLength(1);
  });

  it("loses nothing at any size", { timeout: 120_000 }, async () => {
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 0, max: 2600 }), async (size) => {
        await freshModule();
        const newestFirst = Array.from({ length: size }, (_, i) => mv(size - 1 - i));
        storage.lsSetBatch({ stockMovements: newestFirst });
        await freshModule(new Map(desktop.rows));

        storage.lsMigrateToOldestFirst<Mv>("stockMovements");
        await freshModule(new Map(desktop.rows));

        const after = storage.lsGet<Mv[]>("stockMovements", []);
        expect(after).toHaveLength(size);
        expect(after.map((m) => m.id)).toEqual(
          newestFirst.slice().reverse().map((m) => m.id));
      }),
      { numRuns: 120 },
    );
  });
});

describe("removing an invoice's movements", () => {
  it("removes exactly the matching records and returns them", async () => {
    const data = [
      ...Array.from({ length: 400 }, (_, i) => mv(i, "inv-A")),
      ...Array.from({ length: 400 }, (_, i) => mv(400 + i, "inv-B")),
      ...Array.from({ length: 400 }, (_, i) => mv(800 + i, "inv-C")),
    ];
    storage.lsSetBatch({ stockMovements: data });
    await freshModule(new Map(desktop.rows));

    const removed = storage.lsRemoveWhere<Mv>("stockMovements", (m) => m.referenceId === "inv-B");
    expect(removed).toHaveLength(400);
    expect(removed!.every((m) => m.referenceId === "inv-B")).toBe(true);

    await freshModule(new Map(desktop.rows));
    const left = storage.lsGet<Mv[]>("stockMovements", []);
    expect(left).toHaveLength(800);
    expect(left.some((m) => m.referenceId === "inv-B")).toBe(false);
    expect(storage.lsCount("stockMovements")).toBe(800);
  });

  it("rewrites only the chunks that held a match", async () => {
    const data = Array.from({ length: 2500 }, (_, i) =>
      mv(i, i >= 1000 && i < 1100 ? "inv-X" : "inv-other"));
    storage.lsSetBatch({ stockMovements: data });
    await freshModule(new Map(desktop.rows));

    const writes: string[] = [];
    desktop.api.storage.setBatch = (batch: Record<string, string>) => {
      writes.push(...Object.keys(batch));
      for (const [k, v] of Object.entries(batch)) desktop.rows.set(k, v);
      return Promise.resolve(true);
    };

    storage.lsRemoveWhere<Mv>("stockMovements", (m) => m.referenceId === "inv-X");

    // At 500 per chunk, records 1000-1099 sit entirely inside chunk 2. The
    // other four chunks are never rewritten — that is the whole point.
    expect(writes.sort()).toEqual([
      `${PREFIX}stockMovements#0002`,
      `${PREFIX}stockMovements#meta`,
    ]);
  });

  it("returns an empty array and writes nothing when nothing matches", async () => {
    storage.lsSetBatch({ stockMovements: Array.from({ length: 600 }, (_, i) => mv(i, "keep")) });
    await freshModule(new Map(desktop.rows));

    const writes: string[] = [];
    desktop.api.storage.setBatch = (batch: Record<string, string>) => {
      writes.push(...Object.keys(batch));
      return Promise.resolve(true);
    };

    expect(storage.lsRemoveWhere<Mv>("stockMovements", (m) => m.referenceId === "absent"))
      .toEqual([]);
    expect(writes).toEqual([]);
  });

  it("leaves the collection readable after repeated partial deletes", async () => {
    const data = Array.from({ length: 2000 }, (_, i) => mv(i, `inv-${i % 20}`));
    storage.lsSetBatch({ stockMovements: data });
    await freshModule(new Map(desktop.rows));

    let expected = 2000;
    for (let ref = 0; ref < 8; ref++) {
      const removed = storage.lsRemoveWhere<Mv>("stockMovements", (m) => m.referenceId === `inv-${ref}`);
      expected -= removed!.length;
      await freshModule(new Map(desktop.rows));
      const left = storage.lsGet<Mv[]>("stockMovements", []);
      expect(left).toHaveLength(expected);
      expect(storage.lsCount("stockMovements")).toBe(expected);
    }
  });

  it("can still be appended to after records were removed", async () => {
    storage.lsSetBatch({ stockMovements: Array.from({ length: 1200 }, (_, i) => mv(i, "old")) });
    await freshModule(new Map(desktop.rows));

    storage.lsRemoveWhere<Mv>("stockMovements", (m) => m.quantity < 600);
    expect(storage.lsAppend("stockMovements", [mv(9999, "new")])).toBe(true);

    await freshModule(new Map(desktop.rows));
    const left = storage.lsGet<Mv[]>("stockMovements", []);
    expect(left).toHaveLength(601);
    expect(left[left.length - 1].id).toBe("mv-9999");
  });

  it("refuses on an un-migrated collection rather than pretending to delete", async () => {
    desktop.rows.set(`${PREFIX}stockMovements`, JSON.stringify([mv(0, "a")]));
    await storage.reloadStorageCache();
    expect(storage.lsRemoveWhere<Mv>("stockMovements", () => true)).toBeNull();
    expect(storage.lsGet<Mv[]>("stockMovements", [])).toHaveLength(1);
  });

  it("refuses when a chunk cannot be read, rather than deleting a partial set", async () => {
    storage.lsSetBatch({ stockMovements: Array.from({ length: 1200 }, (_, i) => mv(i, "x")) });
    const onDisk = new Map(desktop.rows);
    onDisk.delete(`${PREFIX}stockMovements#0001`);
    await freshModule(onDisk);

    expect(storage.lsRemoveWhere<Mv>("stockMovements", () => true)).toBeNull();
  });
});

describe("scanning without loading everything", () => {
  it("filters across all chunks", async () => {
    storage.lsSetBatch({ stockMovements: Array.from({ length: 3000 }, (_, i) => mv(i)) });
    await freshModule(new Map(desktop.rows));

    const forProduct = storage.lsFilterChunked<Mv>("stockMovements", (m) => m.productId === "p-3");
    expect(forProduct).toHaveLength(600);
    expect(forProduct.every((m) => m.productId === "p-3")).toBe(true);
  });

  it("agrees with filtering the fully-loaded array", { timeout: 120_000 }, async () => {
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 0, max: 2200 }), async (size) => {
        await freshModule();
        const data = Array.from({ length: size }, (_, i) => mv(i));
        storage.lsSetBatch({ stockMovements: data });
        await freshModule(new Map(desktop.rows));

        const scanned = storage.lsFilterChunked<Mv>("stockMovements", (m) => m.quantity % 3 === 0);
        const loaded = storage.lsGet<Mv[]>("stockMovements", []).filter((m) => m.quantity % 3 === 0);
        expect(scanned.map((m) => m.id)).toEqual(loaded.map((m) => m.id));
      }),
      { numRuns: 80 },
    );
  });

  it("works on a legacy single blob", async () => {
    desktop.rows.set(`${PREFIX}stockMovements`,
      JSON.stringify([mv(0), mv(1), mv(2)]));
    await storage.reloadStorageCache();
    expect(storage.lsFilterChunked<Mv>("stockMovements", (m) => m.quantity > 0)).toHaveLength(2);
  });
});

describe("the whole ledger lifecycle", () => {
  it("migrate, append, delete an invoice, append again — nothing is lost or duplicated", async () => {
    // A shop upgrading with existing newest-first history.
    const history = Array.from({ length: 900 }, (_, i) => mv(899 - i, `inv-${(899 - i) % 30}`));
    storage.lsSetBatch({ stockMovements: history });
    await freshModule(new Map(desktop.rows));

    storage.lsMigrateToOldestFirst<Mv>("stockMovements");
    expect(storage.lsCount("stockMovements")).toBe(900);

    // Two sales.
    storage.lsAppend("stockMovements", [mv(1000, "inv-new"), mv(1001, "inv-new")]);
    expect(storage.lsCount("stockMovements")).toBe(902);

    // One old invoice deleted.
    const removed = storage.lsRemoveWhere<Mv>("stockMovements", (m) => m.referenceId === "inv-7");
    expect(removed!.length).toBeGreaterThan(0);
    const afterDelete = 902 - removed!.length;
    expect(storage.lsCount("stockMovements")).toBe(afterDelete);

    // Another sale.
    storage.lsAppend("stockMovements", [mv(1002, "inv-newer")]);

    await freshModule(new Map(desktop.rows));
    const final = storage.lsGet<Mv[]>("stockMovements", []);
    expect(final).toHaveLength(afterDelete + 1);
    expect(final.some((m) => m.referenceId === "inv-7")).toBe(false);
    expect(final[final.length - 1].id).toBe("mv-1002");
    // No duplicates anywhere.
    expect(new Set(final.map((m) => m.id)).size).toBe(final.length);
    // Newest-first paging still agrees with the stored order.
    expect(storage.lsSliceReversed<Mv>("stockMovements", 0, 3).map((m) => m.id))
      .toEqual(final.slice(-3).reverse().map((m) => m.id));
  });
});
