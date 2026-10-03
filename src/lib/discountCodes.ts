import type { DiscountCode, SalesInvoice, SalesPriceType } from "../types";

export type DiscountCodeResult =
  | { ok: true; code: DiscountCode; discount: number }
  | { ok: false; error: string };

export function normalizeDiscountCode(value: string): string {
  return value.trim().toUpperCase().replace(/\s+/g, "");
}

export function discountCodeUsage(invoices: SalesInvoice[], codeId: string, customerId?: string): number {
  return invoices.filter((invoice) =>
    !invoice.cancelled &&
    invoice.discountCodeId === codeId &&
    (!customerId || invoice.customerId === customerId)
  ).length;
}

export function evaluateDiscountCode(args: {
  codes: DiscountCode[];
  input: string;
  subtotal: number;
  customerId?: string;
  priceType: SalesPriceType;
  invoices: SalesInvoice[];
  date?: string;
}): DiscountCodeResult {
  const normalized = normalizeDiscountCode(args.input);
  const code = args.codes.find((item) => normalizeDiscountCode(item.code) === normalized);
  if (!code) return { ok: false, error: "كود الخصم غير موجود" };
  if (!code.active) return { ok: false, error: "كود الخصم موقوف" };

  const today = args.date ?? new Date().toISOString().slice(0, 10);
  if (code.startsAt && today < code.startsAt) return { ok: false, error: "كود الخصم لم يبدأ بعد" };
  if (code.expiresAt && today > code.expiresAt) return { ok: false, error: "كود الخصم منتهي" };
  if (args.subtotal <= 0) return { ok: false, error: "أضف منتجات أولًا" };
  if (code.minOrderTotal && args.subtotal < code.minOrderTotal) {
    return { ok: false, error: `الحد الأدنى للفاتورة ${code.minOrderTotal}` };
  }
  if (code.allowedPriceTypes?.length && !code.allowedPriceTypes.includes(args.priceType)) {
    return { ok: false, error: "الكود غير متاح لشريحة السعر الحالية" };
  }
  if (code.usageLimit && discountCodeUsage(args.invoices, code.id) >= code.usageLimit) {
    return { ok: false, error: "تم استنفاد عدد استخدامات الكود" };
  }
  if (code.perCustomerLimit && !args.customerId) {
    return { ok: false, error: "اختر العميل أولًا لاستخدام هذا الكود" };
  }
  if (code.perCustomerLimit && args.customerId && discountCodeUsage(args.invoices, code.id, args.customerId) >= code.perCustomerLimit) {
    return { ok: false, error: "العميل استخدم الكود بالحد الأقصى" };
  }

  const raw = code.type === "percentage" ? args.subtotal * code.value / 100 : code.value;
  const capped = code.maxDiscount ? Math.min(raw, code.maxDiscount) : raw;
  return { ok: true, code, discount: Math.round(Math.min(args.subtotal, Math.max(0, capped)) * 100) / 100 };
}
