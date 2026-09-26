import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const policy = require("../../../electron/storage-mutation-policy.cjs");
const P = policy.PREFIX as string;

type User = { id: string; role: "owner" | "employee"; permissions?: Record<string, Record<string, boolean>> };
const employee = (permissions: User["permissions"] = {}): User => ({ id: "employee-1", role: "employee", permissions });
const owner: User = { id: "owner-1", role: "owner" };
const store = (rows: Record<string, unknown> = {}) => {
  const data = new Map(Object.entries(rows).map(([key, value]) => [P + key, JSON.stringify(value)]));
  return { read: (key: string) => data.get(key) ?? null };
};
const authorize = (entries: Record<string, unknown>, user: User, rows: Record<string, unknown> = {}) =>
  policy.authorizeStorageBatch(
    Object.fromEntries(Object.entries(entries).map(([key, value]) => [P + key, JSON.stringify(value)])),
    { user, read: store(rows).read },
  );

const product = (quantity = 10) => ({ id: "p1", name: "Filter", quantity, looseQuantity: 0 });
const invoice = (id = "s1") => ({
  id, invoiceNumber: id, customerId: "c1", customerName: "Customer",
  date: "2026-09-26", total: 20, amountReceived: 20, remaining: 0,
  lines: [{ id: "l1", productId: "p1", productName: "Filter", quantity: 1, price: 20 }],
});

describe("renderer storage mutation policy", () => {
  it("rejects unknown prefixed keys even for an authenticated owner", () => {
    expect(() => authorize({ arbitraryInjectedKey: { owned: true } }, owner)).toThrow("unknown_storage_key");
  });

  it("rejects a zero-permission employee instead of reporting a skipped write as success", () => {
    expect(() => authorize({ auditPermissionProbe: { owned: true } }, employee())).toThrow("unknown_storage_key");
    expect(() => authorize({ products: [product()] }, employee(), { products: [] })).toThrow("no_authorized_storage_changes");
  });

  it("allows a scoped product create and rejects delete without its distinct permission", () => {
    const addUser = employee({ products: { add: true } });
    expect(authorize({ products: [product()] }, addUser, { products: [] })[P + "products"]).toBeTruthy();
    expect(() => authorize({ products: [] }, addUser, { products: [product()] })).toThrow("permission_denied:products:delete");
  });

  it("does not let sales permission masquerade as an arbitrary inventory adjustment", () => {
    const salesUser = employee({ salesInvoices: { add: true } });
    expect(() => authorize({ products: [product(9)] }, salesUser, { products: [product(10)] })).toThrow("permission_denied:inventory:adjust");
  });

  it("allows a stock delta only when coupled to a permitted new sale", () => {
    const salesUser = employee({ salesInvoices: { add: true } });
    const result = authorize(
      { products: [product(9)], salesInvoices: [invoice()] },
      salesUser,
      { products: [product(10)], salesInvoices: [] },
    );
    expect(Object.keys(result).sort()).toEqual([P + "products", P + "salesInvoices"].sort());
  });

  it("permits deterministic legacy product normalization but no arbitrary field edit", () => {
    const before = { ...product(10), code: "1", barcode: " ABC ", sellingPrice: 100 };
    const normalized = { ...product(9), code: "1", barcode: " ABC ", partNumber: "ABC", oemNumbers: [], condition: "new", wholesalePrice: 100, retailPrice: 112 };
    const salesUser = employee({ salesInvoices: { add: true } });
    expect(authorize({ products: [normalized], salesInvoices: [invoice()] }, salesUser, { products: [before], salesInvoices: [] })[P + "products"]).toBeTruthy();
    expect(() => authorize({ products: [{ ...normalized, name: "Forged" }], salesInvoices: [invoice()] }, salesUser, { products: [before], salesInvoices: [] })).toThrow("permission_denied:products:edit");
  });

  it("keeps historical stock movements immutable", () => {
    const movement = { id: "m1", productId: "p1", productName: "Filter", type: "adjustment-in", quantity: 1, referenceType: "manual", date: "2026-09-26" };
    const user = employee({ inventory: { adjust: true } });
    expect(() => authorize({ stockMovements: [{ ...movement, quantity: 999 }] }, user, { stockMovements: [movement] })).toThrow("stock_movement_history_immutable");
  });

  it("scopes audit entries to the session identity and action permission", () => {
    const base = { id: "a1", action: "stock_adjusted", entityLabel: "Filter", timestamp: "2026-09-26T10:00:00Z", userId: "employee-1" };
    expect(() => authorize({ auditLogs: [base] }, employee(), { auditLogs: [] })).toThrow("audit_action_denied");
    expect(() => authorize({ auditLogs: [{ ...base, userId: "other" }] }, employee({ inventory: { adjust: true } }), { auditLogs: [] })).toThrow("audit_action_denied");
    expect(authorize({ auditLogs: [base] }, employee({ inventory: { adjust: true } }), { auditLogs: [] })[P + "auditLogs"]).toBeTruthy();
  });

  it("recognizes suppliers as a real collection and applies supplier permissions", () => {
    const supplier = { id: "sup1", name: "Supplier" };
    expect(authorize({ suppliers: [supplier] }, employee({ suppliers: { add: true } }), { suppliers: [] })[P + "suppliers"]).toBeTruthy();
    expect(() => authorize({ suppliers: [supplier] }, employee(), { suppliers: [] })).toThrow("no_authorized_storage_changes");
  });

  it("validates every row before an owner batch can commit", () => {
    expect(() => authorize({ products: [{ id: "p1", quantity: -1 }] }, owner, { products: [] })).toThrow("invalid_product_quantity");
  });

  it("treats the whats-new release marker as a string preference", () => {
    expect(authorize({ whatsNew_lastSeenVersion: "10.5.0" }, employee())[P + "whatsNew_lastSeenVersion"]).toBe(JSON.stringify("10.5.0"));
  });
});
