import { describe, it, expect } from "vitest";
import { recomputePurchaseInvoiceAfterEdit } from "../../../src/store/_pure";

/**
 * تعديل فاتورة الشراء يجب أن يحمل المدفوع الكامل (incl. أي رصيد دائن سابق) ويعيد
 * توزيعه على المتبقي/الفائض حسب الإجمالي الجديد. مرتجعات الشراء مدموجة في البنود
 * أصلاً (settlePurchaseInvoiceReturn يقلّل lines/total)، فلا يوجد returnsTotal هنا.
 */
describe("recomputePurchaseInvoiceAfterEdit", () => {
  it("زيادة بنود على فاتورة مدفوعة جزئياً (مدفوع 600، تعديل لـ 1500)", () => {
    const fin = recomputePurchaseInvoiceAfterEdit({ linesTotal: 1500, paidSoFar: 600 });
    expect(fin).toEqual({
      total: 1500, amountPaid: 600, overpayment: 0, remaining: 900, status: "partial",
    });
  });

  it("تقليل البنود تحت المدفوع يحوّل الزيادة لرصيد دائن للمورد (مدفوع 1000، تعديل لـ 800)", () => {
    const fin = recomputePurchaseInvoiceAfterEdit({ linesTotal: 800, paidSoFar: 1000 });
    expect(fin).toEqual({
      total: 800, amountPaid: 800, overpayment: 200, remaining: 0, status: "paid",
    });
  });

  it("[الإصلاح] الرصيد الدائن السابق لا يضيع عند التعديل (مدفوع فعلي 1000 = 700 + فائض 300، تعديل لـ 1200)", () => {
    // paidSoFar = amountPaid(700) + overpayment(300) = 1000
    const fin = recomputePurchaseInvoiceAfterEdit({ linesTotal: 1200, paidSoFar: 1000 });
    // المتبقي الصح = 1200 − 1000 = 200 (الكود القديم كان يحسب 500 بتجاهل الـ 300).
    expect(fin).toEqual({
      total: 1200, amountPaid: 1000, overpayment: 0, remaining: 200, status: "partial",
    });
  });

  it("مدفوعة بالكامل بالظبط بعد التعديل", () => {
    const fin = recomputePurchaseInvoiceAfterEdit({ linesTotal: 1000, paidSoFar: 1000 });
    expect(fin).toEqual({
      total: 1000, amountPaid: 1000, overpayment: 0, remaining: 0, status: "paid",
    });
  });

  it("غير مدفوعة", () => {
    const fin = recomputePurchaseInvoiceAfterEdit({ linesTotal: 1000, paidSoFar: 0 });
    expect(fin).toEqual({
      total: 1000, amountPaid: 0, overpayment: 0, remaining: 1000, status: "unpaid",
    });
  });
});
