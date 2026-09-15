// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import type { Branch, BranchStock, Product } from "../../../src/types";
import { seedProducts } from "../../../src/data/seed";
import {
  AutoPartsProProvider,
  useAutoPartsPro,
} from "../../../src/store/AutoPartsProContext";
import { loadStorageCache, reloadStorageCache, lsClearAll, lsSetBatch } from "../../../src/lib/storage";
import { shutdownPersistenceEntries } from "../../../src/store/persistenceBoundaries";

const session = vi.hoisted(() => ({
  auth: {
    auth: { isAuthenticated: false, userId: "owner", username: "owner" },
    isDesktop: true,
  },
  products: [] as Product[],
}));
vi.mock("../../../src/store/AuthContext", () => ({ useAuth: () => session.auth }));
vi.mock("../../../src/store/CatalogContext", () => ({
  useCatalog: () => ({ products: session.products }),
}));
vi.mock("../../../src/store/AuditLogContext", () => ({
  useAuditLog: () => ({ logAudit: vi.fn() }),
}));

const prefix = "autoparts_inventory_v1::";
const product: Product = { ...seedProducts[0]!, id: "audit-product", quantity: 10 };
const branches: Branch[] = [
  { id: "branch_main", code: "MAIN", name: "Main", isMain: true, active: true, createdAt: "2026-01-01" },
  { id: "branch_other", code: "OTHER", name: "Other", isMain: false, active: true, createdAt: "2026-01-01" },
];
const allocations: BranchStock[] = [
  { branchId: "branch_main", productId: product.id, quantity: 3, updatedAt: "2026-01-01" },
  { branchId: "branch_other", productId: product.id, quantity: 7, updatedAt: "2026-01-01" },
];
const wrapper = ({ children }: { children: ReactNode }) => (
  <AutoPartsProProvider>{children}</AutoPartsProProvider>
);
let rows: Map<string, string>;
let writes: ReturnType<typeof vi.fn>;

beforeEach(async () => {
  vi.useFakeTimers();
  session.auth.auth.isAuthenticated = false;
  session.products = [];
  localStorage.clear();
  (window as unknown as { desktopAPI?: unknown }).desktopAPI = undefined;
  lsClearAll();
  rows = new Map([
    [prefix + "branches", JSON.stringify(branches)],
    [prefix + "branchStocks", JSON.stringify(allocations)],
  ]);
  writes = vi.fn(async (entries: Record<string, string>) => {
    if (!session.auth.auth.isAuthenticated) return false;
    for (const [key, value] of Object.entries(entries)) rows.set(key, value);
    return true;
  });
  (window as unknown as { desktopAPI?: unknown }).desktopAPI = {
    storage: {
      get: (key: string) => session.auth.auth.isAuthenticated ? rows.get(key) ?? null : null,
      getBatch: async () => session.auth.auth.isAuthenticated ? Object.fromEntries(rows) : {},
      setBatch: writes,
    },
  };
  await loadStorageCache();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  (window as unknown as { desktopAPI?: unknown }).desktopAPI = undefined;
});

describe("desktop branch hydration", () => {
  it("does not attempt to persist unauthenticated fallback state", async () => {
    renderHook(() => useAutoPartsPro(), { wrapper });
    await act(async () => { await vi.advanceTimersByTimeAsync(1500); });
    expect(writes).not.toHaveBeenCalled();
    expect(shutdownPersistenceEntries({ products: [] })).toEqual({ products: [] });
    expect(JSON.parse(rows.get(prefix + "branchStocks")!)).toEqual(allocations);
  });

  it("preserves exact 3/7 allocations through authoritative login hydration", async () => {
    const { result, rerender } = renderHook(() => useAutoPartsPro(), { wrapper });
    await act(async () => { await vi.advanceTimersByTimeAsync(1500); });
    await act(async () => {
      session.auth.auth.isAuthenticated = true;
      session.products = [product];
      // AppProvider does this before publishing authenticated catalog state.
      expect(await reloadStorageCache()).toBe(true);
      rerender();
    });
    await act(async () => { await vi.advanceTimersByTimeAsync(1500); });
    const persisted = JSON.parse(rows.get(prefix + "branchStocks")!) as BranchStock[];
    expect(result.current.branchQuantity("branch_main", product.id)).toBe(3);
    expect(result.current.branchQuantity("branch_other", product.id)).toBe(7);
    expect(persisted.map(({ branchId, productId, quantity }) => ({ branchId, productId, quantity })))
      .toEqual(allocations.map(({ branchId, productId, quantity }) => ({ branchId, productId, quantity })));
  });

  it("includes a completed transfer before its debounce timer and unregisters on logout", async () => {
    session.auth.auth.isAuthenticated = true;
    session.products = [product];
    await reloadStorageCache();
    const { result, rerender } = renderHook(() => useAutoPartsPro(), { wrapper });
    await act(async () => {
      expect(result.current.transferStock({ fromBranchId: "branch_main", toBranchId: "branch_other", productId: product.id, productName: product.name, quantity: 2, date: "2026-09-15" })).not.toBeNull();
    });
    expect(writes).not.toHaveBeenCalled();
    const snapshot = shutdownPersistenceEntries({ products: [product], stockMovements: [] });
    expect((snapshot.branchStocks as BranchStock[]).map(row => row.quantity)).toEqual([1, 9]);
    expect(snapshot.stockTransfers).toHaveLength(1);
    expect(snapshot).not.toHaveProperty("stockMovements");
    await act(async () => { session.auth.auth.isAuthenticated = false; rerender(); });
    expect(shutdownPersistenceEntries({ products: [] })).toEqual({ products: [] });
  });

  it("reconciles an immediate stocktake against the catalog in the closing transaction", async () => {
    session.auth.auth.isAuthenticated = true;
    session.products = [product];
    await reloadStorageCache();
    renderHook(() => useAutoPartsPro(), { wrapper });
    const snapshot = shutdownPersistenceEntries({ products: [{ ...product, quantity: 13 }] });
    expect((snapshot.branchStocks as BranchStock[]).map(row => row.quantity)).toEqual([6, 7]);
    // The live provider snapshot remains unchanged until normal reconciliation.
    expect(JSON.parse(rows.get(prefix + "branchStocks")!)).toEqual(allocations);
  });

  it("keeps an unflushed transfer record when a subsequent sale publishes committed branch stock", async () => {
    session.auth.auth.isAuthenticated = true;
    session.products = [product];
    await reloadStorageCache();
    const { result } = renderHook(() => useAutoPartsPro(), { wrapper });
    await act(async () => {
      result.current.transferStock({ fromBranchId: "branch_main", toBranchId: "branch_other", productId: product.id, productName: product.name, quantity: 2, date: "2026-09-15" });
    });
    await act(async () => {
      lsSetBatch({ branchStocks: allocations.map((row, i) => ({ ...row, quantity: i ? 8 : 1 })) });
      window.dispatchEvent(new Event("autoparts:sale-committed"));
    });
    expect(result.current.stockTransfers).toHaveLength(1);
    expect((shutdownPersistenceEntries({ products: [{ ...product, quantity: 9 }] }).stockTransfers)).toHaveLength(1);
  });
});
