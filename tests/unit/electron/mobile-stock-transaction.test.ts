import { beforeEach, describe, expect, it } from "vitest";
import { commitMobileStockOperations, receiptKey } from "../../../electron/mobile-stock-transaction.cjs";
import { planStockOps, resultForChange, type MobileStockOp } from "../../../src/features/mobile/mobileStockOps";
import { seedProducts } from "../../../src/data/seed";

const prefix = "autoparts_inventory_v1::";
const product = { ...seedProducts[0]!, id: "part", quantity: 10 };
let rows: Map<string, string>;
let sequence: number;
const user = { id: "owner", name: "Owner" };
const op = (clientOpId: string, kind: MobileStockOp["kind"], quantity: number): MobileStockOp => ({ clientOpId, productId: "part", kind, quantityMilli: quantity * 1000 });
const commit = (ops: MobileStockOp[], failAfter = 0) => commitMobileStockOperations({
  ops, user, now: new Date("2026-09-15T10:00:00Z"), createId: () => String(sequence++), failAfter,
  read: (key: string) => rows.get(key) ?? null,
  write: (key: string, json: string) => rows.set(key, json),
  transaction: (action: () => unknown) => {
    const before = new Map(rows);
    try { return action(); }
    catch (error) { rows = before; throw error; }
  },
});
const collection = (name: string) => {
  const raw = JSON.parse(rows.get(prefix + name) ?? "[]");
  if (raw !== "__partflow_chunked__") return raw;
  const meta = JSON.parse(rows.get(prefix + name + "#meta")!);
  return Array.from({ length: meta.chunks }, (_, i) => JSON.parse(rows.get(prefix + name + "#" + String(i).padStart(4, "0"))!)).flat();
};
beforeEach(() => {
  sequence = 1;
  rows = new Map([
    [prefix + "products", JSON.stringify([product])],
    [prefix + "branches", JSON.stringify([{ id: "main", isMain: true }, { id: "other" }])],
    [prefix + "branchStocks", JSON.stringify([{ branchId: "main", productId: "part", quantity: 3 }, { branchId: "other", productId: "part", quantity: 7 }])],
  ]);
});
describe("durable mobile inventory transactions", () => {
  it.each(["add", "remove", "count"] as const)("applies %s once, including duplicate delivery after reopening storage", kind => {
    const operation = op("same", kind, kind === "count" ? 15 : 2);
    const plan = planStockOps([operation], [product]);
    const first = commit([operation]);
    expect(first.results).toEqual([resultForChange(plan.changes[0]!)]);
    const persisted = new Map(rows);
    const duplicate = commit([operation]);
    expect(duplicate.results).toEqual(first.results);
    expect(duplicate.newResults).toEqual([]);
    expect(rows).toEqual(persisted);
    rows = new Map(JSON.parse(JSON.stringify([...rows])));
    expect(commit([operation]).results).toEqual(first.results);
    expect(rows).toEqual(persisted);
    expect(collection("stockMovements")).toHaveLength(1);
    expect(collection("auditLogs")).toHaveLength(1);
    expect(collection("branchStocks").map((row: { quantity: number }) => row.quantity)).toEqual(kind === "add" ? [5, 7] : kind === "remove" ? [1, 7] : [8, 7]);
  });
  it("deduplicates within a single delivery batch and plans sequential stock correctly", () => {
    const result = commit([op("a", "add", 2), op("a", "add", 2), op("b", "remove", 4)]);
    expect(result.results.map((row: { resultingQuantityMilli: number }) => row.resultingQuantityMilli)).toEqual([12000, 12000, 8000]);
    expect(result.newResults).toHaveLength(2);
    expect(collection("products")[0].quantity).toBe(8);
    expect(collection("stockMovements")).toHaveLength(2);
  });
  it("returns the original result after an unrelated later quantity change", () => {
    const first = commit([op("old", "add", 2)]);
    rows.set(prefix + "products", JSON.stringify([{ ...product, quantity: 20 }]));
    const before = new Map(rows);
    expect(commit([op("old", "add", 99)]).results).toEqual(first.results);
    expect(rows).toEqual(before);
  });
  it("rejects malformed branch balances without committing an operation receipt", () => {
    rows.set(prefix + "branchStocks", JSON.stringify([{ branchId: "main", productId: "part", quantity: "10" }]));
    const before = new Map(rows);
    expect(() => commit([op("bad-branch", "add", 2)])).toThrow("invalid_branch_quantity");
    expect(rows).toEqual(before);
  });
  it("stores rejections and zero-delta counts without movements", () => {
    const operations = [op("too-many", "remove", 20), op("same-count", "count", 10), { ...op("missing", "add", 1), productId: "unknown" }];
    const first = commit(operations);
    expect(first.results.map((row: { status: string }) => row.status)).toEqual(["rejected", "applied", "rejected"]);
    expect(collection("stockMovements")).toEqual([]);
    expect(commit(operations).results).toEqual(first.results);
    expect(commit(operations).newResults).toEqual([]);
  });
  it.each([1, 2, 4, 5, 7, 9])("rolls back inventory and receipts when write %i fails", stage => {
    const before = new Map(rows);
    expect(() => commit([op("failure", "add", 2)], stage)).toThrow("injected_mobile_commit_failure");
    expect(rows).toEqual(before);
    expect(rows.has(receiptKey("failure"))).toBe(false);
    expect(commit([op("failure", "add", 2)]).results[0].resultingQuantityMilli).toBe(12000);
  });
  it("refuses a corrupt ledger without committing its receipt or product changes", () => {
    rows.set(prefix + "stockMovements", '"__partflow_chunked__"');
    rows.set(prefix + "stockMovements#order", '"oldest-first-v2-date-id"');
    const before = new Map(rows);
    expect(() => commit([op("corrupt", "add", 2)])).toThrow();
    expect(rows).toEqual(before);
  });
  it("rejects invalid legacy ledger chronology without replacing historical rows", () => {
    rows.set(prefix + "stockMovements", JSON.stringify([{ id: "historic", date: "invalid-date" }]));
    const before = new Map(rows);
    expect(() => commit([op("bad-date", "add", 2)])).toThrow("invalid_chronological_record");
    expect(rows).toEqual(before);
  });
  it("appends only the tail of an existing lazy ledger", () => {
    rows.set(prefix + "stockMovements", '"__partflow_chunked__"');
    rows.set(prefix + "stockMovements#order", '"oldest-first-v2-date-id"');
    rows.set(prefix + "stockMovements#meta", JSON.stringify({ chunks: 2, size: 500, total: 501 }));
    rows.set(prefix + "stockMovements#0000", JSON.stringify(Array.from({ length: 500 }, (_, id) => ({ id }))));
    rows.set(prefix + "stockMovements#0001", JSON.stringify([{ id: "tail" }]));
    const firstChunk = rows.get(prefix + "stockMovements#0000");
    const result = commit([op("append", "add", 2)]);
    expect(result.storageRows).not.toHaveProperty(prefix + "stockMovements#0000");
    expect(rows.get(prefix + "stockMovements#0000")).toBe(firstChunk);
    expect(collection("stockMovements")).toHaveLength(502);
  });
  it.each([NaN, -1, 100000001, 1.5])("rejects invalid wire quantity %s before any write", quantityMilli => {
    const before = new Map(rows);
    expect(() => commit([{ ...op("bad", "add", 1), quantityMilli }])).toThrow("invalid_operation");
    expect(rows).toEqual(before);
  });
});
