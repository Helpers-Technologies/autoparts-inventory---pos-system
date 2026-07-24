import { describe, it, expect } from "vitest";
import { applyWeightedAverageCostDelta } from "../../../src/store/_pure";

/**
 * قبل هذا الإصلاح، تكلفة البيع كانت تُؤخذ من purchasePrice الثابت المُدخل يدويًا،
 * فمثال تقرير الأمن (10@100 + 10@150 → صافي التكلفة يجب أن يكون 125، لا 100) كان
 * ينتج ربحًا خاطئًا (400 بدل 275) كلما تغيّر سعر المورد. applyWeightedAverageCostDelta
 * هو ما يحرّك avgCost فعليًا عند كل فاتورة شراء/تعديل/حذف/مرتجع.
 */
describe("applyWeightedAverageCostDelta", () => {
  it("[مثال تقرير الأمن] شراء 10@100 ثم 10@150 → متوسط 125، ربح بيع 5@180 = 275 لا 400", () => {
    // أول فاتورة شراء: 10 وحدات بسعر 100 على منتج جديد (currentAvgCost = purchasePrice الأولي).
    const afterFirstPurchase = applyWeightedAverageCostDelta({
      currentQty: 0,
      currentAvgCost: 100,
      addQty: 10,
      addValue: 10 * 100,
    });
    expect(afterFirstPurchase).toBe(100);

    // فاتورة شراء ثانية: 10 وحدات إضافية بسعر مورد جديد 150.
    const afterSecondPurchase = applyWeightedAverageCostDelta({
      currentQty: 10,
      currentAvgCost: afterFirstPurchase,
      addQty: 10,
      addValue: 10 * 150,
    });
    expect(afterSecondPurchase).toBe(125); // (10*100 + 10*150) / 20

    // بيع 5 وحدات بسعر 180 → الربح الصحيح = (180-125)*5 = 275، وليس (180-100)*5 = 400.
    const costPerUnit = afterSecondPurchase;
    const saleRevenue = 5 * 180;
    const correctProfit = saleRevenue - costPerUnit * 5;
    expect(correctProfit).toBe(275);
  });

  it("تعديل فاتورة شراء يعكس البند القديم ويطبّق الجديد (نفس نمط عكس الكمية الموجود)", () => {
    // منتج عنده 10 وحدات بمتوسط تكلفة 100 (من فاتورة شراء أصلية بسعر 100).
    // تعديل الفاتورة ليصبح السعر 120 لنفس الـ10 وحدات.
    const afterEdit = applyWeightedAverageCostDelta({
      currentQty: 10,
      currentAvgCost: 100,
      removeQty: 10,
      removeValue: 10 * 100,
      addQty: 10,
      addValue: 10 * 120,
    });
    expect(afterEdit).toBe(120);
  });

  it("حذف فاتورة شراء يعكس مساهمتها في المتوسط", () => {
    // 20 وحدة بمتوسط 125 (10@100 + 10@150). حذف فاتورة الـ10@150 يرجّع المتوسط لـ100.
    const afterDelete = applyWeightedAverageCostDelta({
      currentQty: 20,
      currentAvgCost: 125,
      removeQty: 10,
      removeValue: 10 * 150,
    });
    expect(afterDelete).toBe(100);
  });

  it("مرتجع توريد يعكس بنفس منطق الحذف باستخدام سعر السطر الأصلي", () => {
    const afterReturn = applyWeightedAverageCostDelta({
      currentQty: 20,
      currentAvgCost: 125,
      removeQty: 5,
      removeValue: 5 * 150, // سعر السطر الأصلي في فاتورة الشراء، لا purchasePrice الحالي
    });
    // القيمة المتبقية: (20*125 - 5*150) / 15 = (2500-750)/15 = 116.666...
    expect(afterReturn).toBeCloseTo(116.6667, 3);
  });

  it("لا يسمح للقيمة المتبقية أو الكمية بأن تصبح سالبة عند انحراف التقريب", () => {
    const result = applyWeightedAverageCostDelta({
      currentQty: 5,
      currentAvgCost: 100,
      removeQty: 999, // أكبر من المتاح فعليًا — لا يجب أن ينتج قيمة سالبة أو NaN
      removeValue: 999 * 100,
    });
    expect(result).toBe(100); // finalQty=0 → يحتفظ بآخر تكلفة معروفة بدل الانهيار لصفر
    expect(Number.isFinite(result)).toBe(true);
  });

  it("يحتفظ بآخر تكلفة معروفة عند نفاد المخزون تمامًا بدل الانهيار لصفر", () => {
    const result = applyWeightedAverageCostDelta({
      currentQty: 10,
      currentAvgCost: 100,
      removeQty: 10,
      removeValue: 10 * 100,
    });
    expect(result).toBe(100);
  });
});
