"use strict";

/**
 * Validate the referential and quantity invariants of the effective branch
 * stock collection. The caller supplies the post-mutation collections, so this
 * is usable at every authoritative write boundary (including partial chunks).
 */
function assertBranchStockIntegrity(branchStocks, products, branches) {
  if (!Array.isArray(branchStocks) || !Array.isArray(products) || !Array.isArray(branches)) {
    throw new Error("invalid_branch_stock_collections");
  }
  const productIds = new Set(products.map((row) => String(row?.id || "")).filter(Boolean));
  const branchIds = new Set(branches.map((row) => String(row?.id || "")).filter(Boolean));
  const keys = new Set();
  for (const row of branchStocks) {
    const productId = String(row?.productId || "");
    const branchId = String(row?.branchId || "");
    const quantity = Number(row?.quantity);
    if (!productIds.has(productId)) throw new Error(`orphan_branch_stock_product:${productId || "missing"}`);
    if (!branchIds.has(branchId)) throw new Error(`orphan_branch_stock_branch:${branchId || "missing"}`);
    if (!Number.isFinite(quantity) || quantity < 0) throw new Error("invalid_branch_stock_quantity");
    const key = `${branchId}:${productId}`;
    if (keys.has(key)) throw new Error(`duplicate_branch_stock:${key}`);
    keys.add(key);
  }
  return true;
}

module.exports = { assertBranchStockIntegrity };
