import type { CashEntry } from "../types";
import { CASH_PAYMENT_METHODS } from "./format";

export interface CashMethodBalance {
  method: string;
  inflow: number;
  outflow: number;
  net: number;
}

/**
 * The cashbox balance, split by how the money arrived.
 *
 * "الرصيد الحالي" is one number covering money that lives in five different
 * places — the drawer, the card machine's pending settlement, an InstaPay
 * account, a wallet and the bank. A shop cannot reconcile against a total:
 * counting the till proves nothing when the figure includes last week's Visa
 * settlement.
 *
 * Two rules decide where an entry lands:
 *
 *   - The opening balance is drawer cash by definition. It is the float
 *     counted into the till before any entry existed.
 *   - An entry saved before the payment-method field existed carries no
 *     method, and those were all drawer cash, so they go there too.
 *
 * Methods with no movement at all are dropped, so a shop that has never taken
 * a bank transfer does not read a row of zeros.
 */
export function cashBalanceByMethod(
  entries: CashEntry[],
  openingBalance: number,
): CashMethodBalance[] {
  const totals = new Map<string, { inflow: number; outflow: number }>();
  const bucket = (method: string) => {
    let entry = totals.get(method);
    if (!entry) {
      entry = { inflow: 0, outflow: 0 };
      totals.set(method, entry);
    }
    return entry;
  };

  bucket("cash").inflow += openingBalance;
  for (const entry of entries) {
    const target = bucket(entry.paymentMethod ?? "cash");
    if (entry.amount >= 0) target.inflow += entry.amount;
    else target.outflow += -entry.amount;
  }

  const rows: CashMethodBalance[] = [];
  // A fixed order, so the breakdown does not reshuffle between two openings
  // of the same screen.
  for (const method of CASH_PAYMENT_METHODS) {
    const entry = totals.get(method);
    if (!entry) continue;
    const inflow = Math.round(entry.inflow * 100) / 100;
    const outflow = Math.round(entry.outflow * 100) / 100;
    if (inflow === 0 && outflow === 0) continue;
    rows.push({ method, inflow, outflow, net: Math.round((inflow - outflow) * 100) / 100 });
  }

  // Anything stored under a method this build does not know about — a future
  // method, or a corrupted row — is still money and still has to be shown,
  // rather than quietly vanishing from a total the shop reconciles against.
  for (const [method, entry] of totals) {
    if ((CASH_PAYMENT_METHODS as readonly string[]).includes(method)) continue;
    const inflow = Math.round(entry.inflow * 100) / 100;
    const outflow = Math.round(entry.outflow * 100) / 100;
    if (inflow === 0 && outflow === 0) continue;
    rows.push({ method, inflow, outflow, net: Math.round((inflow - outflow) * 100) / 100 });
  }

  return rows;
}

/** Cash that should physically be in the drawer right now. */
export function drawerCashFrom(rows: CashMethodBalance[]): number {
  return rows.find((row) => row.method === "cash")?.net ?? 0;
}
