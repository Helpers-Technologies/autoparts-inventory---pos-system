/**
 * quotationConversionFields — fixes V3-B01/B02 (Reports V2/08)
 *
 * A quotation's `total` is stored already net of its discount
 * (QuotationNewPage: total = max(0, subtotal − discount)), so converting
 * to an invoice must NOT subtract the discount again (V3-B01), and any
 * excess received during conversion must become overpayment (customer
 * credit) instead of vanishing into the cashbox (V3-B02).
 *
 * TC-UNIT-QCONV-001 through TC-UNIT-QCONV-007
 */
import { describe, it, expect } from "vitest";
import { quotationConversionFields } from "../../../src/store/_pure";

describe("quotationConversionFields", () => {
  it("TC-UNIT-QCONV-001 — invoice total equals quotation net total (no double discount)", () => {
    // subtotal 10,000 − discount 500 → quot.total = 9,500
    const result = quotationConversionFields({ total: 9500 }, 0);
    expect(result.total).toBe(9500); // was 9,000 before the fix
  });

  it("TC-UNIT-QCONV-002 — exact payment: fully received, no overpayment", () => {
    const result = quotationConversionFields({ total: 9500 }, 9500);
    expect(result).toEqual({ total: 9500, amountReceived: 9500, overpayment: 0 });
  });

  it("TC-UNIT-QCONV-003 — partial payment passes through unchanged", () => {
    const result = quotationConversionFields({ total: 9500 }, 4000);
    expect(result).toEqual({ total: 9500, amountReceived: 4000, overpayment: 0 });
  });

  it("TC-UNIT-QCONV-004 — excess payment is capped and tracked as overpayment", () => {
    const result = quotationConversionFields({ total: 9500 }, 10000);
    expect(result).toEqual({ total: 9500, amountReceived: 9500, overpayment: 500 });
  });

  it("TC-UNIT-QCONV-005 — cash conservation: received + overpayment = paid in", () => {
    const paidIn = 12345.67;
    const result = quotationConversionFields({ total: 9500 }, paidIn);
    expect(result.amountReceived + result.overpayment).toBeCloseTo(paidIn);
  });

  it("TC-UNIT-QCONV-006 — negative input is clamped to zero", () => {
    const result = quotationConversionFields({ total: 9500 }, -100);
    expect(result).toEqual({ total: 9500, amountReceived: 0, overpayment: 0 });
  });

  it("TC-UNIT-QCONV-007 — zero-total quotation: everything received becomes overpayment", () => {
    const result = quotationConversionFields({ total: 0 }, 250);
    expect(result).toEqual({ total: 0, amountReceived: 0, overpayment: 250 });
  });
});
