import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { lsGet, lsSet, lsRemove, lsClearAll, lsSetBatch, lsSetBatchAwait } from "../../../src/lib/storage";

const PREFIX = "autoparts_inventory_v1::";

// ── localStorage path ──────────────────────────────────────────────────────────

function makeLocalStorage() {
  const store: Record<string, string> = {};
  return {
    getItem: vi.fn((key: string) => store[key] ?? null),
    setItem: vi.fn((key: string, value: string) => { store[key] = value; }),
    removeItem: vi.fn((key: string) => { delete store[key]; }),
    key: vi.fn((i: number) => Object.keys(store)[i] ?? null),
    get length() { return Object.keys(store).length; },
    _store: store,
  };
}

describe("storage — localStorage path (no desktopAPI)", () => {
  let ls: ReturnType<typeof makeLocalStorage>;

  beforeEach(() => {
    ls = makeLocalStorage();
    vi.stubGlobal("window", { desktopAPI: undefined });
    vi.stubGlobal("localStorage", ls);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe("lsGet", () => {
    it("returns the parsed value when key exists", () => {
      ls._store[PREFIX + "products"] = JSON.stringify([{ id: "p1" }]);
      expect(lsGet("products", [])).toEqual([{ id: "p1" }]);
    });

    it("returns the fallback when key is absent", () => {
      expect(lsGet("missing", "default")).toBe("default");
    });

    it("returns the fallback when stored value is corrupt JSON", () => {
      ls._store[PREFIX + "broken"] = "{not-json}";
      expect(lsGet("broken", null)).toBeNull();
    });

    it("returns the fallback for null stored values", () => {
      expect(lsGet("nokey", 42)).toBe(42);
    });
  });

  describe("lsSet", () => {
    it("stores a JSON-serialised value under the prefixed key", () => {
      lsSet("products", [{ id: "p1" }]);
      expect(ls.setItem).toHaveBeenCalledWith(
        PREFIX + "products",
        JSON.stringify([{ id: "p1" }]),
      );
    });

    it("stores numbers and booleans correctly", () => {
      lsSet("count", 7);
      expect(ls._store[PREFIX + "count"]).toBe("7");
      lsSet("flag", false);
      expect(ls._store[PREFIX + "flag"]).toBe("false");
    });
  });

  describe("lsRemove", () => {
    it("removes the prefixed key from localStorage", () => {
      ls._store[PREFIX + "old"] = "x";
      lsRemove("old");
      expect(ls.removeItem).toHaveBeenCalledWith(PREFIX + "old");
      expect(ls._store[PREFIX + "old"]).toBeUndefined();
    });
  });

  describe("lsClearAll", () => {
    it("removes all prefixed keys and leaves others untouched", () => {
      ls._store[PREFIX + "products"] = "[]";
      ls._store[PREFIX + "customers"] = "[]";
      ls._store["other_key"] = "keep";
      lsClearAll();
      expect(ls._store[PREFIX + "products"]).toBeUndefined();
      expect(ls._store[PREFIX + "customers"]).toBeUndefined();
      expect(ls._store["other_key"]).toBe("keep");
    });

    it("does not throw when no prefixed keys exist", () => {
      expect(() => lsClearAll()).not.toThrow();
    });
  });
});

// ── desktopAPI (IPC) path ─────────────────────────────────────────────────────

describe("storage — desktopAPI (IPC) path", () => {
  const mockStorage = {
    get: vi.fn(),
    set: vi.fn(),
    remove: vi.fn(),
    clearPrefix: vi.fn(),
  };

  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubGlobal("window", { desktopAPI: { storage: mockStorage } });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe("lsGet", () => {
    it("reads from desktopAPI.storage.get and parses JSON", () => {
      mockStorage.get.mockReturnValue(JSON.stringify({ id: "p1" }));
      expect(lsGet("item", null)).toEqual({ id: "p1" });
      expect(mockStorage.get).toHaveBeenCalledWith(PREFIX + "item");
    });

    it("returns fallback when desktopAPI.storage.get returns null", () => {
      mockStorage.get.mockReturnValue(null);
      expect(lsGet("item", "fallback")).toBe("fallback");
    });
  });

  describe("lsSet", () => {
    it("calls desktopAPI.storage.set with prefixed key and JSON value", () => {
      lsSet("products", [1, 2, 3]);
      expect(mockStorage.set).toHaveBeenCalledWith(PREFIX + "products", "[1,2,3]");
    });
  });

  describe("lsRemove", () => {
    it("calls desktopAPI.storage.remove with prefixed key", () => {
      lsRemove("old");
      expect(mockStorage.remove).toHaveBeenCalledWith(PREFIX + "old");
    });
  });

  describe("lsClearAll", () => {
    it("calls desktopAPI.storage.clearPrefix with the correct prefix", () => {
      lsClearAll();
      expect(mockStorage.clearPrefix).toHaveBeenCalledWith(PREFIX);
    });
  });
});

// ── lsSetBatch (debounced multi-key flush) ────────────────────────────────────

describe("storage — lsSetBatch", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("uses desktopAPI.storage.setBatch in ONE call when available", () => {
    const setBatch = vi.fn();
    vi.stubGlobal("window", { desktopAPI: { storage: { setBatch, set: vi.fn() } } });
    lsSetBatch({ batch_products: [{ id: "p1" }], batch_count: 5 });
    expect(setBatch).toHaveBeenCalledOnce();
    const arg = setBatch.mock.calls[0][0] as Record<string, string>;
    expect(arg[PREFIX + "batch_products"]).toBe(JSON.stringify([{ id: "p1" }]));
    expect(arg[PREFIX + "batch_count"]).toBe("5");
  });

  it("falls back to per-key set() when setBatch is absent", () => {
    const set = vi.fn();
    vi.stubGlobal("window", { desktopAPI: { storage: { set } } });
    lsSetBatch({ perkey_a: 1, perkey_b: 2 });
    expect(set).toHaveBeenCalledWith(PREFIX + "perkey_a", "1");
    expect(set).toHaveBeenCalledWith(PREFIX + "perkey_b", "2");
  });

  it("falls back to localStorage in web mode (no desktopAPI)", () => {
    const ls = makeLocalStorage();
    vi.stubGlobal("window", { desktopAPI: undefined });
    vi.stubGlobal("localStorage", ls);
    lsSetBatch({ web_x: "hello" });
    expect(ls._store[PREFIX + "web_x"]).toBe('"hello"');
  });

  it("skips the IPC call entirely when nothing changed (same object reference)", () => {
    const setBatch = vi.fn();
    vi.stubGlobal("window", { desktopAPI: { storage: { setBatch } } });
    const sameRef = [{ id: "p1" }];
    lsSetBatch({ batch_skip: sameRef });
    expect(setBatch).toHaveBeenCalledOnce();
    setBatch.mockClear();
    lsSetBatch({ batch_skip: sameRef }); // identical reference → optimisation skips it
    expect(setBatch).not.toHaveBeenCalled();
  });
});

// ── lsSetBatchAwait (durable flush before reload — the restore white-screen fix) ──

describe("storage — lsSetBatchAwait", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("RESOLVES true only after awaiting the SQLite write (no race before reload)", async () => {
    let resolved = false;
    const setBatch = vi.fn().mockImplementation(
      () => new Promise((res) => setTimeout(() => { resolved = true; res(true); }, 5))
    );
    vi.stubGlobal("window", { desktopAPI: { storage: { setBatch } } });
    const ok = await lsSetBatchAwait({ await_products: [{ id: "p1" }] });
    // The promise only settled after the IPC write completed.
    expect(resolved).toBe(true);
    expect(ok).toBe(true);
    expect(setBatch).toHaveBeenCalledOnce();
  });

  it("returns false when the main process rejects the write", async () => {
    const setBatch = vi.fn().mockResolvedValue(false);
    vi.stubGlobal("window", { desktopAPI: { storage: { setBatch } } });
    expect(await lsSetBatchAwait({ await_x: 1 })).toBe(false);
  });

  it("persists EVERY key even on a repeated identical reference (no skip optimisation)", async () => {
    const setBatch = vi.fn().mockResolvedValue(true);
    vi.stubGlobal("window", { desktopAPI: { storage: { setBatch } } });
    const sameRef = [{ id: "p1" }];
    await lsSetBatchAwait({ await_repeat: sameRef });
    await lsSetBatchAwait({ await_repeat: sameRef }); // must still write — restore can't skip
    expect(setBatch).toHaveBeenCalledTimes(2);
  });

  it("awaits per-key set() when the batch API is unavailable", async () => {
    const set = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("window", { desktopAPI: { storage: { set } } });
    await lsSetBatchAwait({ await_a: 1, await_b: 2 });
    expect(set).toHaveBeenCalledWith(PREFIX + "await_a", "1");
    expect(set).toHaveBeenCalledWith(PREFIX + "await_b", "2");
  });

  it("falls back to localStorage in web mode and resolves true", async () => {
    const ls = makeLocalStorage();
    vi.stubGlobal("window", { desktopAPI: undefined });
    vi.stubGlobal("localStorage", ls);
    const ok = await lsSetBatchAwait({ await_web: "hi" });
    expect(ok).toBe(true);
    expect(ls._store[PREFIX + "await_web"]).toBe('"hi"');
  });
});
