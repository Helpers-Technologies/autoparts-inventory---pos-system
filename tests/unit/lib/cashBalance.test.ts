/**
 * The cashbox balance, split by how the money arrived.
 *
 * One number covering the drawer, the card machine, InstaPay, a wallet and the
 * bank cannot be reconciled against anything — counting the till proves nothing
 * when the figure also holds last week's Visa settlement.
 *
 * TC-CASHSPLIT-001 through TC-CASHSPLIT-007
 */
import { describe, it, expect } from "vitest";
import { cashBalanceByMethod, drawerCashFrom } from "../../../src/lib/cashBalance";
import { PAYMENT_METHOD_LABELS } from "../../../src/lib/format";
import type { CashEntry } from "../../../src/types";

function entry(partial: Partial<CashEntry> & { amount: number }): CashEntry {
  return {
    id: `cash-${Math.random().toString(36).slice(2)}`,
    type: "sales-receipt",
    description: "حركة",
    date: "2026-08-01T10:00:00.000Z",
    ...partial,
  } as CashEntry;
}

describe("cashbox balance by method — TC-CASHSPLIT", () => {
  it("TC-CASHSPLIT-001: the opening balance is drawer cash", () => {
    const rows = cashBalanceByMethod([], 5_000);
    expect(rows).toEqual([{ method: "cash", inflow: 5_000, outflow: 0, net: 5_000 }]);
    expect(drawerCashFrom(rows)).toBe(5_000);
  });

  it("TC-CASHSPLIT-002: each method keeps its own inflow, outflow and net", () => {
    const rows = cashBalanceByMethod(
      [
        entry({ amount: 1_000, paymentMethod: "cash" }),
        entry({ amount: 2_500, paymentMethod: "card" }),
        entry({ amount: 400, paymentMethod: "instapay" }),
        entry({ amount: -300, paymentMethod: "cash", type: "manual-remove" }),
        entry({ amount: -100, paymentMethod: "instapay", type: "adjustment" }),
      ],
      0,
    );
    expect(rows).toEqual([
      { method: "cash", inflow: 1_000, outflow: 300, net: 700 },
      { method: "card", inflow: 2_500, outflow: 0, net: 2_500 },
      { method: "instapay", inflow: 400, outflow: 100, net: 300 },
    ]);
  });

  it("TC-CASHSPLIT-003: an entry from before the method field existed is drawer cash", () => {
    const rows = cashBalanceByMethod([entry({ amount: 750 })], 0);
    expect(rows).toEqual([{ method: "cash", inflow: 750, outflow: 0, net: 750 }]);
  });

  it("TC-CASHSPLIT-004: the split always adds back up to the single total", () => {
    const entries = [
      entry({ amount: 1_000, paymentMethod: "cash" }),
      entry({ amount: 2_500, paymentMethod: "card" }),
      entry({ amount: 400.55, paymentMethod: "instapay" }),
      entry({ amount: 120.45, paymentMethod: "vodafone" }),
      entry({ amount: -900, paymentMethod: "bank", type: "purchase-payment" }),
      entry({ amount: -300, type: "manual-remove" }),
    ];
    const opening = 5_000;
    const rows = cashBalanceByMethod(entries, opening);
    const split = rows.reduce((sum, row) => sum + row.net, 0);
    const total = opening + entries.reduce((sum, item) => sum + item.amount, 0);
    expect(Math.round(split * 100) / 100).toBe(Math.round(total * 100) / 100);
  });

  it("TC-CASHSPLIT-005: methods with no movement are not shown as rows of zeros", () => {
    // A card-only shop with no float should see one row, not six.
    const cardOnly = cashBalanceByMethod([entry({ amount: 100, paymentMethod: "card" })], 0);
    expect(cardOnly.map((row) => row.method)).toEqual(["card"]);

    // A float alone is enough to make the drawer row real.
    const withFloat = cashBalanceByMethod([entry({ amount: 100, paymentMethod: "card" })], 2_000);
    expect(withFloat.map((row) => row.method)).toEqual(["cash", "card"]);
  });

  it("TC-CASHSPLIT-006: money under an unknown method is still counted", () => {
    // A row written by a future build, or a corrupted one. Dropping it would
    // silently change a total the shop reconciles against.
    const rows = cashBalanceByMethod(
      [entry({ amount: 640, paymentMethod: "crypto" as CashEntry["paymentMethod"] })],
      0,
    );
    expect(rows).toEqual([{ method: "crypto", inflow: 640, outflow: 0, net: 640 }]);
  });

  it("TC-CASHSPLIT-007: every shown method has a label, including card", () => {
    // The shift report used a private label table with no "card" key and
    // printed the raw English word on a Z-report.
    const rows = cashBalanceByMethod(
      [
        entry({ amount: 1, paymentMethod: "cash" }),
        entry({ amount: 1, paymentMethod: "card" }),
        entry({ amount: 1, paymentMethod: "instapay" }),
        entry({ amount: 1, paymentMethod: "vodafone" }),
        entry({ amount: 1, paymentMethod: "bank" }),
        entry({ amount: 1, paymentMethod: "other" }),
      ],
      0,
    );
    for (const row of rows) {
      expect(PAYMENT_METHOD_LABELS[row.method], row.method).toBeTruthy();
      expect(/^[a-z]+$/.test(PAYMENT_METHOD_LABELS[row.method]), row.method).toBe(false);
    }
    // The wallet bucket is named after what it is, not after one operator.
    expect(PAYMENT_METHOD_LABELS.vodafone).toBe("محفظة إلكترونية");
    expect(PAYMENT_METHOD_LABELS.instapay).toBe("إنستاباي");
  });
});
