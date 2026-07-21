import { describe, it, expect } from "vitest";
import {
  aggregateProductSales,
  computeAbc,
  computeTurnover,
  computeMovement,
  computeCustomerProfitability,
  computeSalesTrend,
  productStockValue,
  productStockUnits,
} from "../../../src/lib/analytics";
import type { SalesInvoice, SalesReturn, Product, Customer, InvoiceLine, ReturnLine } from "../../../src/types";

// ── fixture factories ────────────────────────────────────────────────────────
function product(over: Partial<Product> & { id: string; name: string }): Product {
  return {
    code: over.id, category: "عام", unit: "كرتونة", purchasePrice: 10, wholesalePrice: 15,
    retailPrice: 1, quantity: 0, minStock: 0, hasExpiry: false, createdAt: "2026-01-01",
    ...over,
  };
}
function line(over: Partial<InvoiceLine> & { productId: string; quantity: number; price: number }): InvoiceLine {
  const subtotal = over.subtotal ?? over.quantity * over.price;
  return {
    id: over.id ?? `${over.productId}-l`, productName: over.productId, unit: "كرتونة", subtotal,
    ...over,
  };
}
function invoice(over: Partial<SalesInvoice> & { id: string; date: string; customerId: string; lines: InvoiceLine[] }): SalesInvoice {
  const total = over.total ?? over.lines.reduce((s, l) => s + l.subtotal, 0);
  return {
    invoiceNumber: over.id, customerName: over.customerId, total, amountReceived: total,
    remaining: 0, paymentType: "cash", priceType: "wholesale", status: "paid", createdAt: over.date,
    ...over,
  };
}
function retLine(over: Partial<ReturnLine> & { productId: string; quantity: number; price: number }): ReturnLine {
  return {
    id: over.id ?? `${over.productId}-rl`, productName: over.productId, unit: "كرتونة",
    subtotal: over.subtotal ?? over.quantity * over.price, ...over,
  };
}
function salesReturn(over: Partial<SalesReturn> & { id: string; date: string; originalInvoiceId: string; customerId: string; lines: ReturnLine[] }): SalesReturn {
  return {
    returnNumber: over.id, originalInvoiceNumber: over.originalInvoiceId, customerName: over.customerId,
    total: over.total ?? over.lines.reduce((s, l) => s + l.subtotal, 0), refundCash: false, createdAt: over.date,
    ...over,
  };
}
function customer(id: string, name: string): Customer {
  return { id, name, createdAt: "2026-01-01" };
}

// ── shared scenario ──────────────────────────────────────────────────────────
const P1 = product({ id: "P1", name: "صنف أ", purchasePrice: 10, quantity: 100 });
const P2 = product({ id: "P2", name: "صنف ب", purchasePrice: 5, quantity: 0 }); // sold out
const P3 = product({ id: "P3", name: "صنف راكد", purchasePrice: 8, quantity: 50 }); // never sold
const products = [P1, P2, P3];

const INV1 = invoice({
  id: "INV1", date: "2026-01-10", customerId: "C1",
  lines: [line({ id: "INV1-P1", productId: "P1", quantity: 10, price: 20, costPrice: 10 })],
});
const INV2 = invoice({
  id: "INV2", date: "2026-02-15", customerId: "C2",
  lines: [
    line({ id: "INV2-P2", productId: "P2", quantity: 20, price: 8, costPrice: 5 }),
    line({ id: "INV2-P1", productId: "P1", quantity: 5, price: 20, costPrice: 10 }),
  ],
});
const INV3 = invoice({
  id: "INV3", date: "2026-02-20", customerId: "C1", cancelled: true,
  lines: [line({ id: "INV3-P1", productId: "P1", quantity: 999, price: 20, costPrice: 10 })],
});
const sales = [INV1, INV2, INV3];

const R1 = salesReturn({
  id: "R1", date: "2026-01-20", originalInvoiceId: "INV1", customerId: "C1",
  lines: [retLine({ productId: "P1", quantity: 2, price: 20, sourceLineId: "INV1-P1" })],
});
const returns = [R1];
const customers = [customer("C1", "أحمد"), customer("C2", "محمد")];

const FROM = "2026-01-01";
const TO = "2026-02-28";

describe("productStockValue / productStockUnits", () => {
  it("carton-only product", () => {
    expect(productStockValue(product({ id: "X", name: "X", purchasePrice: 10, quantity: 5 }))).toBe(50);
    expect(productStockUnits(product({ id: "X", name: "X", quantity: 5 }))).toBe(5);
  });
  it("piece-enabled product pro-rates loose pieces", () => {
    const p = product({ id: "X", name: "X", purchasePrice: 24, quantity: 2, piecesPerUnit: 24, looseQuantity: 12 });
    expect(productStockValue(p)).toBe(2 * 24 + 12 * (24 / 24)); // 48 + 12 = 60
    expect(productStockUnits(p)).toBe(2 + 12 / 24); // 2.5
  });
});

describe("aggregateProductSales", () => {
  const aggs = aggregateProductSales(sales, returns, FROM, TO);
  it("ignores cancelled invoices and nets returns out of revenue/qty/cost", () => {
    const p1 = aggs.find((a) => a.productId === "P1")!;
    // sales: qty 15, revenue 300, cost 150 → avg cost 10. return 2 units:
    expect(p1.qtySold).toBe(13);
    expect(p1.revenue).toBe(260);
    expect(p1.cost).toBe(130);
    expect(p1.profit).toBe(130);
    expect(p1.margin).toBeCloseTo(0.5, 6);
  });
  it("aggregates a single-invoice product", () => {
    const p2 = aggs.find((a) => a.productId === "P2")!;
    expect(p2).toMatchObject({ qtySold: 20, revenue: 160, cost: 100, profit: 60 });
    expect(p2.margin).toBeCloseTo(0.375, 6);
  });
  it("excludes the cancelled invoice's product line entirely", () => {
    const p1 = aggs.find((a) => a.productId === "P1")!;
    expect(p1.qtySold).toBeLessThan(999);
  });
});

describe("computeAbc", () => {
  it("ranks by revenue and assigns cumulative Pareto classes", () => {
    const rows = computeAbc(aggregateProductSales(sales, returns, FROM, TO));
    expect(rows.map((r) => r.productId)).toEqual(["P1", "P2"]); // 260 then 160
    expect(rows[0].revenueShare).toBeCloseTo(260 / 420, 6);
    expect(rows[0].cumulativeShare).toBeCloseTo(260 / 420, 6);
    expect(rows[0].abcClass).toBe("A");
    expect(rows[1].cumulativeShare).toBeCloseTo(1, 6);
    expect(rows[1].abcClass).toBe("C"); // crosses 0.95
  });
  it("returns [] when there is no positive revenue", () => {
    expect(computeAbc([])).toEqual([]);
  });
  it("respects custom thresholds", () => {
    const aggs = [
      { productId: "A", productName: "A", qtySold: 1, revenue: 50, cost: 0, profit: 50, margin: 1 },
      { productId: "B", productName: "B", qtySold: 1, revenue: 30, cost: 0, profit: 30, margin: 1 },
      { productId: "C", productName: "C", qtySold: 1, revenue: 20, cost: 0, profit: 20, margin: 1 },
    ];
    const rows = computeAbc(aggs, 0.5, 0.8);
    // shares: 0.5, 0.3, 0.2 → cumulative 0.5(A), 0.8(B), 1.0(C)
    expect(rows.map((r) => r.abcClass)).toEqual(["A", "B", "C"]);
  });
});

describe("computeTurnover", () => {
  it("computes COGS ÷ current stock value, null when sold out with COGS", () => {
    const rows = computeTurnover(aggregateProductSales(sales, returns, FROM, TO), products);
    expect(rows.map((r) => r.productId)).toEqual(["P1", "P2"]); // by cogs desc: 130, 100
    const p1 = rows.find((r) => r.productId === "P1")!;
    expect(p1.stockValue).toBe(1000); // 100 × 10
    expect(p1.turnover).toBeCloseTo(0.13, 6);
    const p2 = rows.find((r) => r.productId === "P2")!;
    expect(p2.stockValue).toBe(0);
    expect(p2.turnover).toBeNull(); // sold out but had COGS → ∞
  });
});

describe("computeMovement", () => {
  const report = computeMovement(sales, products, FROM, TO, "2026-02-28");
  it("fast movers ranked by qty (ignoring returns/cancellations)", () => {
    expect(report.fastMovers.map((r) => r.productId)).toEqual(["P2", "P1"]); // 20, 15
  });
  it("dead stock = in stock but zero sales", () => {
    expect(report.deadStock.map((r) => r.productId)).toEqual(["P3"]);
    expect(report.deadStock[0].daysSinceLastSale).toBeNull();
  });
  it("slow movers = sold but still hold stock (P2 is sold out, excluded)", () => {
    expect(report.slowMovers.map((r) => r.productId)).toEqual(["P1"]);
  });
  it("days since last sale measured from asOf", () => {
    const p1 = report.fastMovers.find((r) => r.productId === "P1")!;
    expect(p1.daysSinceLastSale).toBe(13); // 2026-02-15 → 2026-02-28
  });
});

describe("computeCustomerProfitability", () => {
  const rows = computeCustomerProfitability(sales, returns, customers, FROM, TO);
  it("nets returns and discounts, sorts by profit desc, resolves names", () => {
    expect(rows.map((r) => r.customerId)).toEqual(["C2", "C1"]); // 110 then 80
    const c1 = rows.find((r) => r.customerId === "C1")!;
    expect(c1.customerName).toBe("أحمد");
    expect(c1.revenue).toBe(160); // 200 − 40 return
    expect(c1.cost).toBe(80); // 100 − 20 return cost
    expect(c1.profit).toBe(80);
    expect(c1.invoiceCount).toBe(1);
  });
  it("subtracts invoice-level discount from profit", () => {
    const disc = invoice({
      id: "D1", date: "2026-01-05", customerId: "C9", discount: 30,
      lines: [line({ productId: "P1", quantity: 1, price: 100, costPrice: 40 })],
    });
    const rows = computeCustomerProfitability([disc], [], [customer("C9", "خصم")], FROM, TO);
    expect(rows[0].profit).toBe(100 - 40 - 30); // 30
  });

  it("resolves a return's cost by productId when the return line has no sourceLineId", () => {
    // No sourceLineId → falls back to matching the original line by productId.
    const ret = salesReturn({
      id: "R2", date: "2026-01-22", originalInvoiceId: "INV1", customerId: "C1",
      lines: [retLine({ productId: "P1", quantity: 1, price: 20 })],
    });
    const rows = computeCustomerProfitability([INV1], [ret], [customer("C1", "أحمد")], FROM, TO);
    const c1 = rows.find((r) => r.customerId === "C1")!;
    expect(c1.revenue).toBe(180); // 200 − 20
    expect(c1.cost).toBe(90);     // 100 − (costPrice 10 × 1)
    expect(c1.profit).toBe(90);
  });

  it("treats a return for a product absent from the invoice as zero cost", () => {
    // No matching original line at all → cost contribution is 0 (the ?? 0 branch).
    const ret = salesReturn({
      id: "R3", date: "2026-01-23", originalInvoiceId: "INV1", customerId: "C1",
      lines: [retLine({ productId: "P_GHOST", quantity: 1, price: 20 })],
    });
    const rows = computeCustomerProfitability([INV1], [ret], [customer("C1", "أحمد")], FROM, TO);
    const c1 = rows.find((r) => r.customerId === "C1")!;
    expect(c1.cost).toBe(100); // unchanged — no cost matched for the ghost product
  });
});

describe("computeSalesTrend", () => {
  it("zero-fills every month and computes MoM revenue growth", () => {
    const trend = computeSalesTrend(sales, returns, FROM, TO);
    expect(trend.map((t) => t.month)).toEqual(["2026-01", "2026-02"]);
    expect(trend[0]).toMatchObject({ month: "2026-01", revenue: 160, profit: 80, growthPct: null });
    expect(trend[1].revenue).toBe(260);
    expect(trend[1].profit).toBe(110);
    expect(trend[1].growthPct).toBeCloseTo(62.5, 6); // (260−160)/160
  });
  it("first month always has null growth", () => {
    const trend = computeSalesTrend([INV2], [], "2026-02-01", "2026-02-28");
    expect(trend[0].growthPct).toBeNull();
  });

  it("nets a return cost resolved by productId when the return line has no sourceLineId", () => {
    const ret = salesReturn({
      id: "RT", date: "2026-01-25", originalInvoiceId: "INV1", customerId: "C1",
      lines: [retLine({ productId: "P1", quantity: 1, price: 20 })], // no sourceLineId
    });
    const trend = computeSalesTrend([INV1], [ret], "2026-01-01", "2026-01-31");
    // Jan revenue 200 − 20 = 180; profit (200−100) − (20−10) = 90.
    expect(trend[0].revenue).toBe(180);
    expect(trend[0].profit).toBe(90);
  });
});
