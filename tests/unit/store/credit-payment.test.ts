import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { computeCreditPaymentView } from "../../../src/store/_pure";

/**
 * الدفع بالرصيد الدائن — customer settles an invoice (partly/wholly) from their
 * own credit balance, as one of the payment options on SalesInvoiceNewPage.
 * computeCreditPaymentView derives creditApplied / remainingDue / change.
 */
describe("computeCreditPaymentView — الدفع بالرصيد الدائن", () => {
  it("credit toggle OFF → no credit applied, full amount still due (cash only)", () => {
    const v = computeCreditPaymentView({ invoiceNet: 100, amountReceived: 0, creditAvailable: 80, useCredit: false });
    expect(v.creditApplied).toBe(0);
    expect(v.remainingDue).toBe(100);
  });

  it("credit fully covers the invoice → nothing due, no cash needed", () => {
    const v = computeCreditPaymentView({ invoiceNet: 100, amountReceived: 0, creditAvailable: 150, useCredit: true });
    expect(v.creditApplied).toBe(100); // capped at invoice net, not the full 150
    expect(v.remainingDue).toBe(0);
    expect(v.customerChange).toBe(0);
  });

  it("credit partially covers → remainder still due", () => {
    const v = computeCreditPaymentView({ invoiceNet: 100, amountReceived: 0, creditAvailable: 30, useCredit: true });
    expect(v.creditApplied).toBe(30);
    expect(v.remainingDue).toBe(70);
  });

  it("credit + cash together settle the invoice exactly", () => {
    // 30 credit + 70 cash = 100
    const v = computeCreditPaymentView({ invoiceNet: 100, amountReceived: 70, creditAvailable: 30, useCredit: true });
    expect(v.creditApplied).toBe(30);
    expect(v.totalEffective).toBe(100);
    expect(v.remainingDue).toBe(0);
  });

  it("credit applied is never more than the invoice is worth", () => {
    const v = computeCreditPaymentView({ invoiceNet: 40, amountReceived: 0, creditAvailable: 1000, useCredit: true });
    expect(v.creditApplied).toBe(40);
    expect(v.remainingDue).toBe(0);
    expect(v.customerChange).toBe(0); // surplus credit is NOT consumed, so no change here
  });

  it("cash exceeds the net → surplus shows as customer change", () => {
    const v = computeCreditPaymentView({ invoiceNet: 100, amountReceived: 130, creditAvailable: 0, useCredit: false });
    expect(v.remainingDue).toBe(0);
    expect(v.customerChange).toBe(30);
  });

  it("a customer with ZERO credit toggling 'use credit' changes nothing", () => {
    const v = computeCreditPaymentView({ invoiceNet: 100, amountReceived: 100, creditAvailable: 0, useCredit: true });
    expect(v.creditApplied).toBe(0);
    expect(v.remainingDue).toBe(0);
  });

  it("credit covers everything AND cash is also paid → cash becomes change", () => {
    // credit 100 covers the 100 invoice; an extra 20 cash is pure change
    const v = computeCreditPaymentView({ invoiceNet: 100, amountReceived: 20, creditAvailable: 100, useCredit: true });
    expect(v.creditApplied).toBe(100);
    expect(v.totalEffective).toBe(120);
    expect(v.remainingDue).toBe(0);
    expect(v.customerChange).toBe(20);
  });

  it("a zero-value invoice owes nothing regardless of credit", () => {
    const v = computeCreditPaymentView({ invoiceNet: 0, amountReceived: 0, creditAvailable: 50, useCredit: true });
    expect(v.creditApplied).toBe(0);
    expect(v.remainingDue).toBe(0);
  });

  it("defensive: negative inputs are clamped, never produce negative dues", () => {
    const v = computeCreditPaymentView({ invoiceNet: -10, amountReceived: -5, creditAvailable: -20, useCredit: true });
    expect(v.creditApplied).toBe(0);
    expect(v.remainingDue).toBe(0);
    expect(v.customerChange).toBe(0);
  });

  it("property: remainingDue + totalEffective always covers the net, never negative", () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0, max: 100000, noNaN: true }),
        fc.double({ min: 0, max: 100000, noNaN: true }),
        fc.double({ min: 0, max: 100000, noNaN: true }),
        fc.boolean(),
        (invoiceNet, amountReceived, creditAvailable, useCredit) => {
          const v = computeCreditPaymentView({ invoiceNet, amountReceived, creditAvailable, useCredit });
          const nonNeg = v.creditApplied >= 0 && v.remainingDue >= 0 && v.customerChange >= 0;
          const creditCapped = v.creditApplied <= invoiceNet + 1e-6;
          const balances = Math.abs((v.totalEffective - invoiceNet) - (v.customerChange - v.remainingDue)) < 1e-6;
          return nonNeg && creditCapped && balances;
        },
      ),
    );
  });
});
