// Renderer formatting uses en-US (Western digits) for on-screen readability.
// electron/main.cjs has a SEPARATE ar-EG implementation for printed PDFs/receipts
// that produces Eastern Arabic numerals (١٬٢٣٤٫٥٦). The two cannot be shared:
// main process is CJS, renderer is ESM, and locale intent differs by design.
export function formatCurrency(amount: number, currency = "ج.م"): string {
  const n = Number.isFinite(amount) ? amount : 0;
  const fixed = n.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return `${fixed} ${currency}`;
}

export function formatNumber(n: number): string {
  return (Number.isFinite(n) ? n : 0).toLocaleString("en-US");
}

export function formatDate(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yyyy = d.getFullYear();
  return `${dd}/${mm}/${yyyy}`;
}

export function formatDateTime(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const period = d.getHours() >= 12 ? "م" : "ص";
  const hours = d.getHours() % 12 || 12;
  const dateTime = `${formatDate(iso)}\u00A0${String(hours).padStart(
    2,
    "0",
  )}:${String(d.getMinutes()).padStart(2, "0")}\u00A0${period}`;
  // Keep Arabic AM/PM next to the time inside RTL interfaces instead of
  // letting the bidi algorithm move it across the numeric date.
  return `\u2066${dateTime}\u2069`;
}

export const PAYMENT_METHOD_LABELS: Record<string, string> = {
  cash: "كاش",
  bank: "تحويل بنكي",
  card: "فيزا / ماكينة",
  // Was "فودافون كاش". The shop takes Etisalat Cash and Orange Cash on the
  // same line and they all settle the same way, so the bucket is named after
  // what it is rather than after one operator.
  vodafone: "محفظة إلكترونية",
  instapay: "إنستاباي",
  other: "أخرى",
  credit: "رصيد",
};

/**
 * The methods money can actually arrive by, in the order every breakdown
 * shows them (cashbox balance, shift close, shift report). "credit" is left
 * out on purpose: it moves an existing balance, it does not bring cash in.
 */
export const CASH_PAYMENT_METHODS = [
  "cash",
  "card",
  "instapay",
  "vodafone",
  "bank",
  "other",
] as const;

/**
 * Labels the shop has renamed or added, keyed `list:value`.
 *
 * The quality-grade, condition and warranty labels are read from a dozen
 * screens — the products table, the POS alternatives strip, the inventory
 * filter, the reports, the Excel export. Threading a settings object through
 * every one of those pure formatters would have meant touching all of them,
 * so the settings provider registers the resolved lists here once and every
 * existing call site becomes shop-aware unchanged.
 *
 * Nothing registered means the built-in labels below, which is exactly what a
 * unit test or a fresh install should see.
 */
let registeredOptionLabels: Record<string, string> = {};

export function registerProductOptionLabels(labels: Record<string, string>): void {
  registeredOptionLabels = labels;
}

function shopLabel(list: string, code: string): string | undefined {
  return registeredOptionLabels[`${list}:${code}`];
}

/** Months → the shop's own wording for that warranty term. */
export function formatWarrantyLabel(months?: number): string {
  const key = String(months ?? 0);
  const custom = shopLabel("warranties", key);
  if (custom) return custom;
  if (!months) return "بدون ضمان";
  if (months === 1) return "شهر واحد";
  if (months === 12) return "سنة واحدة (12 شهر)";
  if (months % 12 === 0) return `${months / 12} سنوات`;
  return `${months} شهور`;
}

export function formatPartConditionLabel(code?: string): string {
  if (!code) return "";
  const custom = shopLabel("conditions", code.toLowerCase());
  if (custom) return custom;
  switch (code.toLowerCase()) {
    case "new":
      return "جديدة";
    case "used":
      return "استيراد / مستعملة";
    case "remanufactured":
    case "refurbished":
      return "مجددة";
    default:
      return code;
  }
}

export function formatQualityGradeLabel(code?: string): string {
  if (!code) return "";
  const custom = shopLabel("qualityGrades", code.toLowerCase());
  if (custom) return custom;
  switch (code.toLowerCase()) {
    case "genuine":
      return "أصلي توكيل";
    case "oem":
      return "أصلية (OEM)";
    case "aftermarket-premium":
      return "بديل ممتاز";
    case "aftermarket-economy":
      return "بديل اقتصادي";
    case "used":
      return "استيراد / مستعملة";
    case "remanufactured":
      return "مجددة";
    default:
      return code;
  }
}


export function resolvePaymentLabel(paymentMethod: string, notes?: string): string {
  if (paymentMethod === "credit") return "رصيد";
  if (paymentMethod === "other" && notes === "رصيد دائن مستخدم") return "رصيد";
  return PAYMENT_METHOD_LABELS[paymentMethod] ?? paymentMethod;
}

