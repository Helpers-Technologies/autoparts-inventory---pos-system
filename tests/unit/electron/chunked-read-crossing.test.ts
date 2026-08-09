import { describe, it, expect, beforeEach, vi } from "vitest";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  STORE_PREFIX,
  CHUNKED_TOMBSTONE,
  readChunkedCollection,
  isChunkedTombstone,
  isRendererStorageKey,
  chunkRowKeys,
} = require("../../../electron/storage-security.cjs");

/**
 * The renderer writes the chunked format; the MAIN PROCESS reads it back
 * independently when it builds the commerce snapshot that the phone and the
 * portal see.
 *
 * Those are two separate implementations of one format, in two languages'
 * worth of module systems, that never call each other. When only the renderer
 * knew about chunking, the snapshot read the tombstone string, failed to treat
 * it as an array, and quietly uploaded an empty shop — no products, no
 * customers, no orders on the phone, and nothing logged to say why.
 *
 * These tests write with the renderer's code and read with the main process's,
 * so the two cannot drift apart unnoticed.
 */

const desktopRows = new Map<string, string>();

async function rendererStorage() {
  vi.resetModules();
  desktopRows.clear();
  (globalThis as unknown as { window: unknown }).window = {
    desktopAPI: {
      storage: {
        get: (k: string) => (desktopRows.has(k) ? desktopRows.get(k)! : null),
        getBatch: async () => Object.fromEntries(desktopRows),
        set: (k: string, v: string) => { desktopRows.set(k, v); return true; },
        setBatch: async (batch: Record<string, string>) => {
          for (const [k, v] of Object.entries(batch)) desktopRows.set(k, v);
          return true;
        },
        remove: (k: string) => { desktopRows.delete(k); return true; },
        clearPrefix: () => true,
      },
    },
  };
  return import("../../../src/lib/storage");
}

/** What electron/main.cjs's readJsonKey does, using only main-process code. */
function mainProcessRead(key: string, fallback: unknown) {
  const full = `${STORE_PREFIX}${key}`;
  const raw = desktopRows.has(full) ? desktopRows.get(full)! : null;
  if (!raw) return fallback;
  if (isChunkedTombstone(raw)) {
    const rebuilt = readChunkedCollection(full, (rowKey: string) =>
      desktopRows.has(rowKey) ? desktopRows.get(rowKey)! : null);
    return rebuilt === null ? fallback : rebuilt;
  }
  try {
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

const invoices = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ id: `inv-${i}`, total: i * 10 }));

beforeEach(() => { desktopRows.clear(); });

describe("main process reads what the renderer wrote", () => {
  it("reassembles a multi-chunk collection identically", async () => {
    const storage = await rendererStorage();
    const data = invoices(2300);
    storage.lsSetBatch({ salesInvoices: data });

    expect(mainProcessRead("salesInvoices", [])).toEqual(data);
  });

  it("does NOT return an empty array for a chunked collection", async () => {
    // The exact regression: the snapshot silently uploaded an empty shop.
    const storage = await rendererStorage();
    storage.lsSetBatch({ products: invoices(1500), customers: invoices(900) });

    expect(mainProcessRead("products", [])).toHaveLength(1500);
    expect(mainProcessRead("customers", [])).toHaveLength(900);
  });

  it("still reads a pre-chunking single blob", () => {
    const legacy = invoices(12);
    desktopRows.set(`${STORE_PREFIX}salesInvoices`, JSON.stringify(legacy));
    expect(mainProcessRead("salesInvoices", [])).toEqual(legacy);
  });

  it("returns the fallback instead of a partial shop when a chunk is missing", async () => {
    const storage = await rendererStorage();
    storage.lsSetBatch({ salesInvoices: invoices(2300) });
    desktopRows.delete(`${STORE_PREFIX}salesInvoices#0002`);

    // Uploading the 2000 records that did load would tell the portal the shop
    // had lost 300 invoices, and the phone would show that as truth.
    expect(mainProcessRead("salesInvoices", "FALLBACK")).toBe("FALLBACK");
  });
});

describe("chunk rows pass the renderer-key gate", () => {
  it("accepts chunk and manifest keys, or the main process would reject every write", () => {
    expect(isRendererStorageKey(`${STORE_PREFIX}salesInvoices#0000`)).toBe(true);
    expect(isRendererStorageKey(`${STORE_PREFIX}salesInvoices#meta`)).toBe(true);
  });

  it("still refuses protected and unprefixed keys", () => {
    expect(isRendererStorageKey("__license_token")).toBe(false);
    expect(isRendererStorageKey(`${STORE_PREFIX}auth`)).toBe(false);
    expect(isRendererStorageKey("salesInvoices#0000")).toBe(false);
  });
});

describe("change detection sees every physical row", () => {
  it("lists the manifest and all live chunks", async () => {
    const storage = await rendererStorage();
    storage.lsSetBatch({ salesInvoices: invoices(1100) });

    const keys = chunkRowKeys(`${STORE_PREFIX}salesInvoices`, (k: string) =>
      desktopRows.has(k) ? desktopRows.get(k)! : null);

    // Watching only the base row would freeze the snapshot forever: the base
    // row is a tombstone that never changes again once written.
    expect(keys).toContain(`${STORE_PREFIX}salesInvoices#meta`);
    expect(keys).toContain(`${STORE_PREFIX}salesInvoices#0000`);
    expect(keys).toContain(`${STORE_PREFIX}salesInvoices#0002`);
    expect(keys).toHaveLength(4);
  });
});

describe("the tombstone is not mistaken for data", () => {
  it("is a JSON string, so a naive parse yields a string and not an array", () => {
    expect(JSON.parse(CHUNKED_TOMBSTONE)).toBe("__partflow_chunked__");
    expect(Array.isArray(JSON.parse(CHUNKED_TOMBSTONE))).toBe(false);
  });
});
