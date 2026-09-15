// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook } from "@testing-library/react";
import { seedProducts } from "../../../src/data/seed";
import { useMobileStockOps } from "../../../src/features/mobile/useMobileStockOps";
import type { Product } from "../../../src/types";
import type { MobileStockOp } from "../../../src/features/mobile/mobileStockOps";
import { commitMobileStockOperations } from "../../../electron/mobile-stock-transaction.cjs";

const fixture = vi.hoisted(() => ({
  products: [] as Product[],
  adjustStock: vi.fn(),
  applyMobileStockOps: vi.fn(),
  toast: { info: vi.fn(), success: vi.fn(), error: vi.fn() },
}));
let rows: Map<string, string>;
let failAfter: number;
vi.mock("../../../src/store/CatalogContext", () => ({ useCatalog: () => fixture }));
vi.mock("../../../src/components/ui/Toast", () => ({ useToast: () => fixture.toast }));
vi.mock("../../../src/lib/useFeatures", () => ({ useFeatures: () => ({ isEnabled: () => true }) }));

beforeEach(() => {
  vi.useFakeTimers();
  fixture.products = [{ ...seedProducts[0]!, id: "part", quantity: 10 }];
  fixture.adjustStock.mockReset().mockImplementation((_id, delta: number) => {
    fixture.products[0]!.quantity += delta;
  });
  failAfter = 0;
  rows = new Map([["autoparts_inventory_v1::products", JSON.stringify(fixture.products)]]);
  fixture.applyMobileStockOps.mockReset().mockImplementation(async (ops: MobileStockOp[]) => {
    try {
      const result = commitMobileStockOperations({
        ops, user: { id: "owner", name: "Owner" }, failAfter,
        read: (key: string) => rows.get(key) ?? null,
        write: (key: string, value: string) => rows.set(key, value),
        transaction: (action: () => unknown) => {
          const before = new Map(rows);
          try { return action(); } catch (error) { rows = before; throw error; }
        },
      });
      if (result.products) fixture.products = result.products;
      return result;
    } catch { return { ok: false, error: "commit_failed" }; }
  });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  (window as unknown as { desktopAPI?: unknown }).desktopAPI = undefined;
});

describe("mobile delivery acknowledgement", () => {
  it("applies a redelivered operation only once when acknowledgement fails", async () => {
    const op = { clientOpId: "same-operation", productId: "part", kind: "add", quantityMilli: 2000 };
    const resolve = vi.fn(async () => ({ ok: false, error: "offline" }));
    (window as unknown as { desktopAPI?: unknown }).desktopAPI = {
      license: { fetchMobileStockOps: vi.fn(async () => ({ ok: true, ops: [op] })), resolveMobileStockOps: resolve },
    };
    const { result, unmount } = renderHook(() => useMobileStockOps());
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(fixture.products[0]!.quantity).toBe(12);
    await act(async () => { window.dispatchEvent(new Event("focus")); await vi.advanceTimersByTimeAsync(0); });
    expect(fixture.products[0]!.quantity).toBe(12);
    expect(resolve).toHaveBeenCalledTimes(2);
    expect(resolve.mock.calls[1]).toEqual(resolve.mock.calls[0]);
    expect(result.current.appliedCount).toBe(1);
    expect(result.current.lastError).toBe("offline");
    unmount();
    renderHook(() => useMobileStockOps());
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(fixture.products[0]!.quantity).toBe(12);
    expect(resolve).toHaveBeenCalledTimes(3);
    expect(resolve.mock.calls[2]).toEqual(resolve.mock.calls[0]);
  });

  it("does not acknowledge an operation whose transaction failed, then retries safely", async () => {
    const op = { clientOpId: "retry", productId: "part", kind: "add", quantityMilli: 2000 };
    const resolve = vi.fn(async () => ({ ok: true }));
    (window as unknown as { desktopAPI?: unknown }).desktopAPI = {
      license: { fetchMobileStockOps: vi.fn(async () => ({ ok: true, ops: [op] })), resolveMobileStockOps: resolve },
    };
    failAfter = 1;
    const { result } = renderHook(() => useMobileStockOps());
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(fixture.products[0]!.quantity).toBe(10);
    expect(resolve).not.toHaveBeenCalled();
    expect(result.current.lastError).toBe("commit_failed");
    failAfter = 0;
    await act(async () => { window.dispatchEvent(new Event("focus")); await vi.advanceTimersByTimeAsync(0); });
    expect(fixture.products[0]!.quantity).toBe(12);
    expect(resolve).toHaveBeenCalledTimes(1);
    expect(result.current.lastError).toBeNull();
  });

  it("retains the application count when acknowledgement throws and clears its error after retry", async () => {
    const op = { clientOpId: "throwing-ack", productId: "part", kind: "add", quantityMilli: 2000 };
    const resolve = vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValue({ ok: true });
    (window as unknown as { desktopAPI?: unknown }).desktopAPI = {
      license: { fetchMobileStockOps: vi.fn(async () => ({ ok: true, ops: [op] })), resolveMobileStockOps: resolve },
    };
    const { result } = renderHook(() => useMobileStockOps());
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(result.current.appliedCount).toBe(1);
    expect(result.current.lastError).toBe("offline");
    await act(async () => { window.dispatchEvent(new Event("focus")); await vi.advanceTimersByTimeAsync(0); });
    expect(fixture.products[0]!.quantity).toBe(12);
    expect(result.current.appliedCount).toBe(1);
    expect(result.current.lastError).toBeNull();
    expect(resolve.mock.calls[1]).toEqual(resolve.mock.calls[0]);
  });
});
