import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const { assertBranchStockIntegrity } = require("../../../electron/branch-stock-integrity.cjs");

describe("branch-stock authoritative invariant", () => {
  const products = [{ id: "product-1" }, { id: "product-2" }];
  const branches = [{ id: "branch-main" }, { id: "branch-west" }];

  it("accepts canonical product/branch references", () => {
    expect(assertBranchStockIntegrity([
      { productId: "product-1", branchId: "branch-main", quantity: 3 },
      { productId: "product-2", branchId: "branch-west", quantity: 0 },
    ], products, branches)).toBe(true);
  });

  it("rejects orphan product and branch references", () => {
    expect(() => assertBranchStockIntegrity([
      { productId: "runtime-seed-id", branchId: "branch-main", quantity: 5 },
    ], products, branches)).toThrow("orphan_branch_stock_product:runtime-seed-id");
    expect(() => assertBranchStockIntegrity([
      { productId: "product-1", branchId: "missing-branch", quantity: 5 },
    ], products, branches)).toThrow("orphan_branch_stock_branch:missing-branch");
  });

  it("rejects duplicates, negative quantities, and non-finite quantities", () => {
    expect(() => assertBranchStockIntegrity([
      { productId: "product-1", branchId: "branch-main", quantity: 1 },
      { productId: "product-1", branchId: "branch-main", quantity: 2 },
    ], products, branches)).toThrow("duplicate_branch_stock");
    expect(() => assertBranchStockIntegrity([
      { productId: "product-1", branchId: "branch-main", quantity: -1 },
    ], products, branches)).toThrow("invalid_branch_stock_quantity");
  });
});
