import { describe, expect, it } from "vitest";
import { registerAuxiliaryPersistenceOwner, shutdownPersistenceEntries, stateOwnedPersistenceEntries } from "../../../src/store/persistenceBoundaries";

describe("renderer persistence ownership", () => {
  it("restricts auxiliary snapshots to their collections and removes unmounted owners", () => {
    const unregister = registerAuxiliaryPersistenceOwner(() => ({ branchStocks: [1], products: ["stale"], stockMovements: [] }));
    try {
      expect(shutdownPersistenceEntries({ products: ["live"], stockMovements: [] })).toEqual({ branchStocks: [1], products: ["live"] });
    } finally { unregister(); }
    expect(shutdownPersistenceEntries({ products: ["live"] })).toEqual({ products: ["live"] });
  });
  it.each([
    { stockMovements: [] },
    { stockMovements: [{ id: "movement-already-loaded" }] },
  ])(
    "never includes the directly persisted stock ledger in a generic flush ($stockMovements)",
    ({ stockMovements }) => {
      expect(
        stateOwnedPersistenceEntries({
          products: [{ id: "product-1" }],
          salesInvoices: [{ id: "invoice-1" }],
          stockMovements,
          mobileStockOpReceipts: [],
        }),
      ).toEqual({
        products: [{ id: "product-1" }],
        salesInvoices: [{ id: "invoice-1" }],
      });
    },
  );

  it("omits unloaded history from debounce and graceful-close snapshots", () => {
    const unloaded = new Set(["customers", "salesInvoices", "cashEntries"]);
    const state = {
      products: [{ id: "product-1" }],
      customers: [],
      salesInvoices: [],
      cashEntries: [],
    };

    expect(stateOwnedPersistenceEntries(state, unloaded)).toEqual({
      products: [{ id: "product-1" }],
    });
    expect(shutdownPersistenceEntries(state, unloaded)).toEqual({
      products: [{ id: "product-1" }],
    });
  });
});
