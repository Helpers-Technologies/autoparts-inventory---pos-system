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
  return `${formatDate(iso)} ${String(d.getHours()).padStart(2, "0")}:${String(
    d.getMinutes()
  ).padStart(2, "0")}`;
}

export const PAYMENT_METHOD_LABELS: Record<string, string> = {
  cash: "كاش",
  bank: "تحويل بنكي",
  vodafone: "فودافون كاش",
  instapay: "انستاباي",
  other: "أخرى",
  credit: "رصيد",
};

export function formatQualityGradeLabel(code?: string): string {
  if (!code) return "";
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

