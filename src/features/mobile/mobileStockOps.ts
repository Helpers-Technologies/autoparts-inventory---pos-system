import type { Product } from "../../types";

/**
 * Turning a phone's scan into a stock change the desktop can defend.
 *
 * A storeman with a scanner records an INTENT — "I added six", "I took two",
 * "this shelf holds nine" — and the desktop decides what that means for the
 * ledger. Keeping the decision here, as a pure function, is what makes it
 * testable: the rules below are the ones that decide whether a shop's stock
 * stays explainable, and they are too important to live inside a polling
 * effect where they can only be exercised by running the whole app.
 */

/** Quantities cross the wire multiplied by 1,000 so they survive JSON as integers. */
export const MILLI = 1000;

export type MobileStockOpKind = "add" | "remove" | "count";

export interface MobileStockOp {
  clientOpId: string;
  kind: MobileStockOpKind;
  productId: string;
  productName?: string;
  scannedCode?: string;
  quantityMilli: number;
  note?: string;
  deviceLabel?: string;
  actorName?: string;
  createdAt?: string;
}

export interface MobileStockOpResult {
  clientOpId: string;
  status: "applied" | "rejected";
  rejectReason?: string;
  appliedDeltaMilli?: number;
  resultingQuantityMilli?: number;
}

export interface PlannedStockChange {
  op: MobileStockOp;
  /** Whole units to add (positive) or remove (negative). */
  delta: number;
  /** What the audit entry and the stock movement will say. */
  reason: string;
  product: Product;
  resultingQuantity: number;
}

export interface StockOpPlan {
  changes: PlannedStockChange[];
  /** Operations that will not be applied, with the reason the phone will show. */
  rejected: MobileStockOpResult[];
}

/** "جرد من هاتف المخزن — أحمد" — who did it, from where, in the ledger itself. */
function describeSource(op: MobileStockOp): string {
  const parts = [op.deviceLabel?.trim(), op.actorName?.trim()].filter(Boolean);
  return parts.length ? parts.join(" — ") : "تطبيق الموبايل";
}

function reasonFor(op: MobileStockOp, counted?: number): string {
  const source = describeSource(op);
  const note = op.note?.trim() ? ` · ${op.note.trim()}` : "";
  if (op.kind === "add") return `إضافة مخزون بالسكان — ${source}${note}`;
  if (op.kind === "remove") return `خصم مخزون بالسكان — ${source}${note}`;
  return `جرد بالسكان (العدّ: ${counted}) — ${source}${note}`;
}

/**
 * Decides what each queued operation does to the ledger.
 *
 * Three rules, each of which exists because the alternative silently corrupts
 * stock:
 *
 *  1. An unknown part is rejected, never guessed at. A scan that resolves to
 *     nothing means the phone and the desktop disagree about the catalogue,
 *     and applying it to "something similar" would be worse than doing nothing.
 *
 *  2. Removing more than is on hand is REJECTED, not clamped to zero. If the
 *     shelf holds five and the system says three, the system is wrong — and
 *     the honest fix is a count, not silently writing the stock to zero and
 *     losing the discrepancy that would have revealed the error.
 *
 *  3. A count is expressed as the DELTA from what the system currently holds,
 *     so it goes through the same adjustment path as everything else and
 *     leaves a movement explaining the difference. A count that happens to
 *     match is not an operation at all and is reported as applied with a delta
 *     of zero, which is the truthful answer.
 */
export function planStockOps(ops: MobileStockOp[], products: Product[]): StockOpPlan {
  const byId = new Map(products.map((product) => [product.id, product]));
  const changes: PlannedStockChange[] = [];
  const rejected: MobileStockOpResult[] = [];

  // Several operations can target the same part in one batch (a storeman
  // scanning the same bin twice). Each is planned against the quantity the
  // PREVIOUS one leaves behind, or the second would be validated against a
  // stock level that no longer exists by the time it is applied.
  const projected = new Map<string, number>();
  const currentQuantity = (product: Product) =>
    projected.get(product.id) ?? product.quantity;

  for (const op of ops) {
    const product = byId.get(op.productId);
    if (!product) {
      rejected.push({
        clientOpId: op.clientOpId,
        status: "rejected",
        rejectReason: "الصنف مش موجود في المخزون على الكمبيوتر",
      });
      continue;
    }

    const quantity = Math.round(op.quantityMilli / MILLI);
    const onHand = currentQuantity(product);

    let delta: number;
    let reason: string;
    if (op.kind === "add") {
      delta = quantity;
      reason = reasonFor(op);
    } else if (op.kind === "remove") {
      if (quantity > onHand) {
        rejected.push({
          clientOpId: op.clientOpId,
          status: "rejected",
          rejectReason: `المتاح ${onHand} ${product.unit} بس — اعمل جرد بدل الخصم`,
          resultingQuantityMilli: onHand * MILLI,
        });
        continue;
      }
      delta = -quantity;
      reason = reasonFor(op);
    } else {
      delta = quantity - onHand;
      reason = reasonFor(op, quantity);
    }

    const resultingQuantity = onHand + delta;
    projected.set(product.id, resultingQuantity);
    changes.push({ op, delta, reason, product, resultingQuantity });
  }

  return { changes, rejected };
}

/** What the portal is told once a planned change has been written to the store. */
export function resultForChange(change: PlannedStockChange): MobileStockOpResult {
  return {
    clientOpId: change.op.clientOpId,
    status: "applied",
    appliedDeltaMilli: change.delta * MILLI,
    resultingQuantityMilli: change.resultingQuantity * MILLI,
  };
}

/** One line summarising a batch, for the toast the shop actually reads. */
export function summarizeBatch(plan: StockOpPlan): string {
  const applied = plan.changes.length;
  const rejected = plan.rejected.length;
  const parts: string[] = [];
  if (applied) parts.push(`${applied} عملية اتطبّقت`);
  if (rejected) parts.push(`${rejected} اترفضت`);
  return parts.join(" · ") || "لا جديد";
}
