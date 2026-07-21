import { describe, it, expect } from "vitest";
import { recomputeSalesInvoiceAfterEdit } from "../../../src/store/_pure";

/**
 * يثبّت قاعدتي تعديل فاتورة البيع بعد "الفصل الكامل" بين التعديل والتحصيل:
 *  1) التعديل لا يحرّك أي فلوس — cashDelta = 0 طالما المدفوع المحمول = المدفوع السابق.
 *  2) المرتجعات المطبّقة على الفاتورة تُخصم من المستحق (effectiveTotal) قبل حساب
 *     المتبقي/الحالة، فلا يرجع التعديل ويضيف قيمة المرتجع للرصيد من جديد.
 */
describe("recomputeSalesInvoiceAfterEdit", () => {
  describe("التعديل لا يحرّك فلوس (cashDelta = 0)", () => {
    it("زيادة بنود على فاتورة آجل مدفوعة جزئياً (1000→1500، مدفوع 600)", () => {
      const fin = recomputeSalesInvoiceAfterEdit({
        linesTotal: 1500, discount: 0, carriedPaid: 600, prevCash: 600, returnsTotal: 0,
      });
      expect(fin).toEqual({
        total: 1500, effectiveTotal: 1500, amountReceived: 600,
        overpayment: 0, remaining: 900, status: "partial", cashDelta: 0,
      });
    });

    it("زيادة بنود على فاتورة نقدي مدفوعة بالكامل (1000→1500، مدفوع 1000)", () => {
      const fin = recomputeSalesInvoiceAfterEdit({
        linesTotal: 1500, discount: 0, carriedPaid: 1000, prevCash: 1000, returnsTotal: 0,
      });
      expect(fin).toEqual({
        total: 1500, effectiveTotal: 1500, amountReceived: 1000,
        overpayment: 0, remaining: 500, status: "partial", cashDelta: 0,
      });
    });

    it("تقليل البنود تحت المدفوع يحوّل الزيادة لرصيد دائن (1000→800، مدفوع 1000)", () => {
      const fin = recomputeSalesInvoiceAfterEdit({
        linesTotal: 800, discount: 0, carriedPaid: 1000, prevCash: 1000, returnsTotal: 0,
      });
      expect(fin).toEqual({
        total: 800, effectiveTotal: 800, amountReceived: 800,
        overpayment: 200, remaining: 0, status: "paid", cashDelta: 0,
      });
    });

    it("فاتورة بها فائض سابق يُحمَل كما هو (مدفوع 1050، تعديل لـ 1500)", () => {
      const fin = recomputeSalesInvoiceAfterEdit({
        linesTotal: 1500, discount: 0, carriedPaid: 1050, prevCash: 1050, returnsTotal: 0,
      });
      expect(fin).toEqual({
        total: 1500, effectiveTotal: 1500, amountReceived: 1050,
        overpayment: 0, remaining: 450, status: "partial", cashDelta: 0,
      });
    });

    it("الخصم يُطرح من الإجمالي قبل الحساب", () => {
      const fin = recomputeSalesInvoiceAfterEdit({
        linesTotal: 1000, discount: 100, carriedPaid: 900, prevCash: 900, returnsTotal: 0,
      });
      expect(fin).toEqual({
        total: 900, effectiveTotal: 900, amountReceived: 900,
        overpayment: 0, remaining: 0, status: "paid", cashDelta: 0,
      });
    });
  });

  describe("احتساب المرتجعات (إصلاح)", () => {
    it("تعديل فاتورة عليها مرتجع يخصم المرتجع من المستحق (إجمالي 1100، مرتجع 200، مدفوع 600)", () => {
      const fin = recomputeSalesInvoiceAfterEdit({
        linesTotal: 1100, discount: 0, carriedPaid: 600, prevCash: 600, returnsTotal: 200,
      });
      // المستحق الصافي = 1100 − 200 = 900، مدفوع 600 ⇒ متبقي 300 (وليس 500).
      expect(fin).toEqual({
        total: 1100, effectiveTotal: 900, amountReceived: 600,
        overpayment: 0, remaining: 300, status: "partial", cashDelta: 0,
      });
    });

    it("مرتجع يساوي/يتجاوز الإجمالي الجديد ⇒ لا مستحق", () => {
      const fin = recomputeSalesInvoiceAfterEdit({
        linesTotal: 500, discount: 0, carriedPaid: 0, prevCash: 0, returnsTotal: 800,
      });
      expect(fin).toEqual({
        total: 500, effectiveTotal: 0, amountReceived: 0,
        overpayment: 0, remaining: 0, status: "paid", cashDelta: 0,
      });
    });
  });

  describe("عندما يتغيّر المدفوع فعلاً (cashDelta ≠ 0)", () => {
    it("دفع 200 إضافية ضمن التعديل يُنتج cashDelta موجب", () => {
      const fin = recomputeSalesInvoiceAfterEdit({
        linesTotal: 1000, discount: 0, carriedPaid: 800, prevCash: 600, returnsTotal: 0,
      });
      expect(fin.cashDelta).toBe(200);
      expect(fin.amountReceived).toBe(800);
      expect(fin.remaining).toBe(200);
    });
  });
});
