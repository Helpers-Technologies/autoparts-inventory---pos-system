import { describe, expect, it } from "vitest";
import { stateOwnedPersistenceEntries } from "../../../src/store/persistenceBoundaries";

describe("renderer persistence ownership", () => {
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
        }),
      ).toEqual({
        products: [{ id: "product-1" }],
        salesInvoices: [{ id: "invoice-1" }],
      });
    },
  );
});
