import { describe, it, expect } from "vitest";
import { adjustStockCartonDelta, recomputePurchaseInvoiceAfterEdit } from "../../../src/store/_pure";

/**
 * اختبارات الإصلاحات الثلاثة الصغيرة:
 *  1. addPurchaseInvoice — overpayment عند الإنشاء المباشر (نفس منطق recomputePurchaseInvoiceAfterEdit)
 *  2. adjustStock — الكمية في حركة المخزون تكون صحيحة (integer) لا كسرية
 *  3. paymentLog — initPaid = amountReceived + overpayment (المبلغ الكامل المدفوع فعلياً)
 */

// ─── الإصلاح 1: addPurchaseInvoice — overpayment عند الإنشاء ──────────────────
// المنطق مطابق لـ recomputePurchaseInvoiceAfterEdit (paidSoFar = amountPaid)
describe("addPurchaseInvoice — overpayment on creation", () => {
  it("دفع أكثر من الإجمالي يُنتج رصيداً دائناً (amountPaid مقيّد بالإجمالي)", () => {
    const fin = recomputePurchaseInvoiceAfterEdit({ linesTotal: 800, paidSoFar: 1000 });
    expect(fin.amountPaid).toBe(800);
    expect(fin.overpayment).toBe(200);
    expect(fin.remaining).toBe(0);
    expect(fin.status).toBe("paid");
  });

  it("دفع بالضبط مساوٍ للإجمالي → لا رصيد دائن", () => {
    const fin = recomputePurchaseInvoiceAfterEdit({ linesTotal: 500, paidSoFar: 500 });
    expect(fin.amountPaid).toBe(500);
    expect(fin.overpayment).toBe(0);
    expect(fin.remaining).toBe(0);
    expect(fin.status).toBe("paid");
  });

  it("دفع جزئي → لا رصيد دائن، المتبقي موجب", () => {
    const fin = recomputePurchaseInvoiceAfterEdit({ linesTotal: 1000, paidSoFar: 400 });
    expect(fin.amountPaid).toBe(400);
    expect(fin.overpayment).toBe(0);
    expect(fin.remaining).toBe(600);
    expect(fin.status).toBe("partial");
  });

  it("صفر مدفوع عند الإنشاء → unpaid", () => {
    const fin = recomputePurchaseInvoiceAfterEdit({ linesTotal: 600, paidSoFar: 0 });
    expect(fin.amountPaid).toBe(0);
    expect(fin.overpayment).toBe(0);
    expect(fin.remaining).toBe(600);
    expect(fin.status).toBe("unpaid");
  });
});

// ─── الإصلاح 2: adjustStock — كمية حركة المخزون integer لا كسرية ─────────────
describe("adjustStockCartonDelta — integer movement quantity", () => {
  it("بدون looseDelta: يُعيد delta كما هو", () => {
    expect(adjustStockCartonDelta(3, undefined, 0, 24)).toBe(3);
    expect(adjustStockCartonDelta(-2, undefined, 10, 24)).toBe(-2);
    expect(adjustStockCartonDelta(0, undefined, 5, 24)).toBe(0);
  });

  it("looseDelta=0: يُعيد delta كما هو (تجاهل 0)", () => {
    expect(adjustStockCartonDelta(2, 0, 15, 24)).toBe(2);
  });

  it("بدون piecesPerUnit: يُعيد delta كما هو (منتج غير مزدوج)", () => {
    expect(adjustStockCartonDelta(0, 5, 0, undefined)).toBe(0);
  });

  it("قطع لا تُكمّل كرتونة: delta = 0 (رقم صحيح لا كسري)", () => {
    // كان الكود القديم يُنتج 5/24 = 0.208...
    expect(adjustStockCartonDelta(0, 5, 15, 24)).toBe(0);
  });

  it("قطع تكمل كرتونة واحدة: delta = 1", () => {
    // looseQuantity=20، looseDelta=+5 → newLoose=25 → extraCartons=1
    expect(adjustStockCartonDelta(0, 5, 20, 24)).toBe(1);
  });

  it("كراتين وقطع في نفس الوقت", () => {
    // delta=2 كرتون، looseDelta=+6، currentLoose=20، ppu=24
    // newLoose=26, extraCartons=1 → totalDelta=2+1=3
    expect(adjustStockCartonDelta(2, 6, 20, 24)).toBe(3);
  });

  it("تقليل قطع بدون تغيير كراتين: delta = 0", () => {
    // currentLoose=10، looseDelta=-3 → newLoose=7, extraCartons=0 → delta=0
    expect(adjustStockCartonDelta(0, -3, 10, 24)).toBe(0);
  });

  it("تقليل قطع يكسر كرتونة (currentLoose=3, looseDelta=-10, ppu=12)", () => {
    // newLoose = max(0, 3-10) = 0, extraCartons=0, totalDelta = -2+0 = -2
    // (delta=-2 = المستدعي طلب تقليل 2 كرتون بسبب الكسر من setProducts)
    expect(adjustStockCartonDelta(-2, -10, 3, 12)).toBe(-2);
  });

  it("النتيجة دائماً integer", () => {
    const result = adjustStockCartonDelta(0, 7, 18, 24);
    expect(Number.isInteger(result)).toBe(true);
  });
});

// ─── الإصلاح 3: paymentLog — initPaid يشمل الفائض ──────────────────────────
//
// This block used to define `computeInitPaid` locally, three lines above the
// assertions, and then assert that the local one-liner added correctly. It
// could not fail no matter what the production code did. The real rule lives
// in addSalesInvoice, which is exercised end to end by
// tests/integration/flows/sales-invoice-lifecycle.test.ts — the assertions
// that actually cover initPaid belong there, against the real store, and are
// not restated here.

