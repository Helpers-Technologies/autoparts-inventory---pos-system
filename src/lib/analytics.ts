/**
 * Advanced analytics — pure, side-effect-free computations over the sales/stock
 * data. Premium "advancedAnalytics" feature (see lib/features.ts). Kept separate
 * from store/_pure.ts because these are reporting derivations, not store actions,
 * and every function here is unit-tested in tests/unit/lib/analytics.test.ts.
 *
 * Conventions:
 *  - All functions filter out cancelled sales invoices and only count returns
 *    whose original invoice is NOT cancelled (a cancellation already reverses
 *    the whole invoice), mirroring ReportsPage.
 *  - Returns reduce revenue and quantity; their cost is removed at the product's
 *    own average unit cost so margins stay internally consistent without having
 *    to walk back to each original invoice line.
 *  - "Mixed units": a product can sell by carton or by piece. Monetary figures
 *    (revenue/cost/profit) are always exact; raw quantity counts mix the two and
 *    are surfaced only as a movement indicator, never as a physical stock figure.
 */
import type { SalesInvoice, SalesReturn, Product, Customer } from "../types";
import { inRange, getMonthsInRange } from "./utils";

export interface ProductSalesAgg {
  productId: string;
  productName: string;
  /** Net units sold (sales − returns); mixes carton/piece units — movement only. */
  qtySold: number;
  /** Net revenue after returns. */
  revenue: number;
  /** Cost of goods sold (net of returns at average unit cost). */
  cost: number;
  /** revenue − cost. */
  profit: number;
  /** profit / revenue as a fraction (0..1). 0 when revenue is 0. */
  margin: number;
}

/** Current on-hand stock value at purchase price (loose pieces pro-rated). */
export function productStockValue(p: Product): number {
  const piecePrice = p.piecesPerUnit ? p.purchasePrice / p.piecesPerUnit : 0;
  return p.quantity * p.purchasePrice + (p.looseQuantity ?? 0) * piecePrice;
}

/** On-hand units, loose pieces converted to fractional cartons. */
export function productStockUnits(p: Product): number {
  return p.quantity + (p.piecesPerUnit ? (p.looseQuantity ?? 0) / p.piecesPerUnit : 0);
}

/**
 * Aggregate net sales per product over [from, to]. Returns are subtracted from
 * revenue/qty and their cost is removed at the product's average unit cost.
 * Products that net out to zero revenue AND zero qty are dropped.
 */
export function aggregateProductSales(
  sales: SalesInvoice[],
  returns: SalesReturn[],
  from: string,
  to: string,
): ProductSalesAgg[] {
  const map = new Map<
    string,
    { productId: string; productName: string; qty: number; revenue: number; cost: number }
  >();

  for (const inv of sales) {
    if (inv.cancelled || !inRange(inv.date, from, to)) continue;
    for (const l of inv.lines) {
      const e =
        map.get(l.productId) ??
        { productId: l.productId, productName: l.productName, qty: 0, revenue: 0, cost: 0 };
      e.qty += l.quantity;
      e.revenue += l.subtotal;
      e.cost += (l.costPrice ?? 0) * l.quantity;
      map.set(l.productId, e);
    }
  }

  // Average unit cost per product, used to back out the cost of returned units.
  const avgUnitCost = new Map<string, number>();
  for (const e of map.values()) {
    avgUnitCost.set(e.productId, e.qty > 0 ? e.cost / e.qty : 0);
  }

  // A return counts only if it falls in range and its original invoice exists
  // and was not cancelled. We don't require the original to be in-range: a
  // return dated inside the window reverses revenue recognised in the window.
  const nonCancelledOriginal = (id: string) => {
    const orig = sales.find((s) => s.id === id);
    return !!orig && !orig.cancelled;
  };
  for (const r of returns) {
    if (!inRange(r.date, from, to)) continue;
    if (!nonCancelledOriginal(r.originalInvoiceId)) continue;
    for (const l of r.lines) {
      const e = map.get(l.productId);
      if (!e) continue; // return for a product with no in-range sale — ignore
      e.qty -= l.quantity;
      e.revenue -= l.subtotal;
      e.cost -= (avgUnitCost.get(l.productId) ?? 0) * l.quantity;
    }
  }

  const out: ProductSalesAgg[] = [];
  for (const e of map.values()) {
    if (e.revenue === 0 && e.qty === 0) continue;
    const revenue = e.revenue;
    const cost = e.cost;
    const profit = revenue - cost;
    out.push({
      productId: e.productId,
      productName: e.productName,
      qtySold: e.qty,
      revenue,
      cost,
      profit,
      margin: revenue !== 0 ? profit / revenue : 0,
    });
  }
  return out;
}

export interface AbcRow extends ProductSalesAgg {
  /** Share of total revenue this product alone represents (0..1). */
  revenueShare: number;
  /** Running cumulative share up to and including this product (0..1). */
  cumulativeShare: number;
  abcClass: "A" | "B" | "C";
}

/**
 * Pareto/ABC classification by revenue. Products are ranked high→low; the
 * cumulative-revenue cut-offs default to 80% (A) and 95% (B), the rest C.
 * Only positive-revenue products are classified (returns-dominated rows drop out).
 */
export function computeAbc(
  aggs: ProductSalesAgg[],
  aThreshold = 0.8,
  bThreshold = 0.95,
): AbcRow[] {
  const positive = aggs.filter((a) => a.revenue > 0).sort((x, y) => y.revenue - x.revenue);
  const totalRevenue = positive.reduce((s, a) => s + a.revenue, 0);
  if (totalRevenue <= 0) return [];

  let cumulative = 0;
  return positive.map((a) => {
    const revenueShare = a.revenue / totalRevenue;
    cumulative += revenueShare;
    const abcClass: "A" | "B" | "C" =
      cumulative <= aThreshold + 1e-9 ? "A" : cumulative <= bThreshold + 1e-9 ? "B" : "C";
    return { ...a, revenueShare, cumulativeShare: cumulative, abcClass };
  });
}

export interface TurnoverRow {
  productId: string;
  productName: string;
  /** Cost of goods sold in the period. */
  cogs: number;
  /** Current on-hand stock value (purchase price). */
  stockValue: number;
  /**
   * Approximate turnover ratio = COGS ÷ current stock value. Uses CURRENT stock
   * as a proxy for average stock (no historical snapshots), so it's directional,
   * not an audited ratio. null when there is stock-less COGS (sold out) — shown
   * as "∞" in the UI.
   */
  turnover: number | null;
}

/** Inventory turnover per product, highest COGS first. */
export function computeTurnover(aggs: ProductSalesAgg[], products: Product[]): TurnoverRow[] {
  const byId = new Map(products.map((p) => [p.id, p]));
  return aggs
    .map((a) => {
      const p = byId.get(a.productId);
      const stockValue = p ? productStockValue(p) : 0;
      const cogs = a.cost;
      const turnover = stockValue > 0 ? cogs / stockValue : cogs > 0 ? null : 0;
      return { productId: a.productId, productName: a.productName, cogs, stockValue, turnover };
    })
    .sort((x, y) => y.cogs - x.cogs);
}

export interface MovementRow {
  productId: string;
  productName: string;
  qtySold: number;
  stockUnits: number;
  /** Days since the most recent sale of this product, or null if never sold. */
  daysSinceLastSale: number | null;
}

export interface MovementReport {
  /** Top movers by net quantity sold (descending). */
  fastMovers: MovementRow[];
  /** In-stock products with zero sales in the period (capital tied up). */
  deadStock: MovementRow[];
  /** Slowest in-stock movers that DID sell at least once (ascending qty). */
  slowMovers: MovementRow[];
}

const dayDiff = (fromISO: string, toISO: string): number =>
  Math.round((new Date(toISO).getTime() - new Date(fromISO).getTime()) / 86_400_000);

/**
 * Movement report: fast movers, dead stock (in stock but unsold), and slow
 * movers. `asOf` (default today's caller-supplied `to`) anchors the
 * days-since-last-sale calculation.
 */
export function computeMovement(
  sales: SalesInvoice[],
  products: Product[],
  from: string,
  to: string,
  asOf: string,
  topN = 10,
): MovementReport {
  const qtyByProduct = new Map<string, number>();
  const lastSaleByProduct = new Map<string, string>();
  for (const inv of sales) {
    if (inv.cancelled) continue;
    const within = inRange(inv.date, from, to);
    for (const l of inv.lines) {
      if (within) qtyByProduct.set(l.productId, (qtyByProduct.get(l.productId) ?? 0) + l.quantity);
      const prev = lastSaleByProduct.get(l.productId);
      if (!prev || inv.date > prev) lastSaleByProduct.set(l.productId, inv.date);
    }
  }

  const rows: MovementRow[] = products
    .filter((p) => !p.archived)
    .map((p) => {
      const last = lastSaleByProduct.get(p.id);
      return {
        productId: p.id,
        productName: p.name,
        qtySold: qtyByProduct.get(p.id) ?? 0,
        stockUnits: productStockUnits(p),
        daysSinceLastSale: last ? Math.max(0, dayDiff(last, asOf)) : null,
      };
    });

  const fastMovers = [...rows]
    .filter((r) => r.qtySold > 0)
    .sort((a, b) => b.qtySold - a.qtySold)
    .slice(0, topN);

  const deadStock = rows
    .filter((r) => r.qtySold === 0 && r.stockUnits > 0)
    .sort((a, b) => (b.daysSinceLastSale ?? Infinity) - (a.daysSinceLastSale ?? Infinity))
    .slice(0, topN);

  const slowMovers = rows
    .filter((r) => r.qtySold > 0 && r.stockUnits > 0)
    .sort((a, b) => a.qtySold - b.qtySold)
    .slice(0, topN);

  return { fastMovers, deadStock, slowMovers };
}

export interface CustomerProfitRow {
  customerId: string;
  customerName: string;
  revenue: number;
  cost: number;
  /** revenue − cost − invoice-level discounts (net of returns). */
  profit: number;
  margin: number;
  invoiceCount: number;
}

/**
 * Profitability per customer over [from, to]. Invoice-level discounts reduce
 * profit; returns reduce revenue/cost at the line's recorded cost. Sorted by
 * profit descending.
 */
export function computeCustomerProfitability(
  sales: SalesInvoice[],
  returns: SalesReturn[],
  customers: Customer[],
  from: string,
  to: string,
): CustomerProfitRow[] {
  const nameById = new Map(customers.map((c) => [c.id, c.name]));
  const map = new Map<
    string,
    { customerId: string; customerName: string; revenue: number; cost: number; discount: number; invoices: Set<string> }
  >();

  const get = (id: string, name: string) => {
    let e = map.get(id);
    if (!e) {
      e = { customerId: id, customerName: nameById.get(id) ?? name, revenue: 0, cost: 0, discount: 0, invoices: new Set() };
      map.set(id, e);
    }
    return e;
  };

  for (const inv of sales) {
    if (inv.cancelled || !inRange(inv.date, from, to)) continue;
    const e = get(inv.customerId, inv.customerName);
    e.invoices.add(inv.id);
    e.discount += inv.discount ?? 0;
    for (const l of inv.lines) {
      e.revenue += l.subtotal;
      e.cost += (l.costPrice ?? 0) * l.quantity;
    }
  }

  const invoiceCustomer = new Map(sales.map((s) => [s.id, s]));
  for (const r of returns) {
    if (!inRange(r.date, from, to)) continue;
    const orig = invoiceCustomer.get(r.originalInvoiceId);
    if (!orig || orig.cancelled) continue;
    const e = get(orig.customerId, orig.customerName);
    for (const l of r.lines) {
      e.revenue -= l.subtotal;
      // Cost of a returned line: match the original invoice line, else 0.
      const origLine = orig.lines.find((ol) => ol.id === l.sourceLineId) ??
        orig.lines.find((ol) => ol.productId === l.productId);
      e.cost -= (origLine?.costPrice ?? 0) * l.quantity;
    }
  }

  const out: CustomerProfitRow[] = [];
  for (const e of map.values()) {
    const profit = e.revenue - e.cost - e.discount;
    out.push({
      customerId: e.customerId,
      customerName: e.customerName,
      revenue: e.revenue,
      cost: e.cost,
      profit,
      margin: e.revenue !== 0 ? profit / e.revenue : 0,
      invoiceCount: e.invoices.size,
    });
  }
  return out.sort((a, b) => b.profit - a.profit);
}

export interface TrendPoint {
  /** YYYY-MM. */
  month: string;
  revenue: number;
  profit: number;
  /** % change in revenue vs the previous month, or null for the first month. */
  growthPct: number | null;
}

/**
 * Monthly revenue/profit trend across [from, to] with month-over-month revenue
 * growth. Every month in the range is present (zero-filled), so the series is
 * continuous for charting.
 */
export function computeSalesTrend(
  sales: SalesInvoice[],
  returns: SalesReturn[],
  from: string,
  to: string,
): TrendPoint[] {
  const months = getMonthsInRange(from, to);
  const revByMonth = new Map<string, number>();
  const profitByMonth = new Map<string, number>();
  for (const m of months) {
    revByMonth.set(m, 0);
    profitByMonth.set(m, 0);
  }

  for (const inv of sales) {
    if (inv.cancelled || !inRange(inv.date, from, to)) continue;
    const m = inv.date.slice(0, 7);
    if (!revByMonth.has(m)) continue;
    let rev = 0;
    let cost = 0;
    for (const l of inv.lines) {
      rev += l.subtotal;
      cost += (l.costPrice ?? 0) * l.quantity;
    }
    rev -= inv.discount ?? 0;
    revByMonth.set(m, (revByMonth.get(m) ?? 0) + rev);
    profitByMonth.set(m, (profitByMonth.get(m) ?? 0) + (rev - cost));
  }

  const invoiceById = new Map(sales.map((s) => [s.id, s]));
  for (const r of returns) {
    if (!inRange(r.date, from, to)) continue;
    const orig = invoiceById.get(r.originalInvoiceId);
    if (!orig || orig.cancelled) continue;
    const m = r.date.slice(0, 7);
    if (!revByMonth.has(m)) continue;
    let rev = 0;
    let cost = 0;
    for (const l of r.lines) {
      rev += l.subtotal;
      const origLine = orig.lines.find((ol) => ol.id === l.sourceLineId) ??
        orig.lines.find((ol) => ol.productId === l.productId);
      cost += (origLine?.costPrice ?? 0) * l.quantity;
    }
    revByMonth.set(m, (revByMonth.get(m) ?? 0) - rev);
    profitByMonth.set(m, (profitByMonth.get(m) ?? 0) - (rev - cost));
  }

  let prevRev: number | null = null;
  return months.map((m) => {
    const revenue = revByMonth.get(m) ?? 0;
    const profit = profitByMonth.get(m) ?? 0;
    const growthPct =
      prevRev === null ? null : prevRev === 0 ? (revenue === 0 ? 0 : null) : ((revenue - prevRev) / prevRev) * 100;
    prevRev = revenue;
    return { month: m, revenue, profit, growthPct };
  });
}
