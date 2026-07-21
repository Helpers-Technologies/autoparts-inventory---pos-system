import type { LicensePayload, Settings } from "../types";

/**
 * Optional/gateable modules of the system. Core surfaces (dashboard, settings,
 * users, audit log, import, profile) are intentionally NOT here — they are
 * always available and cannot be turned off.
 *
 * Feature state is resolved in two layers (see {@link isFeatureEnabled}):
 *   1. License cap  — the package the client paid for. Signed into the serial,
 *      so the client cannot widen it. Absent ⇒ everything allowed (old serials).
 *   2. Owner preference — Settings toggles let the owner hide an allowed module
 *      they don't use. Falls back to {@link FeatureDef.defaultEnabled}.
 */
export type FeatureKey =
  | "salesInvoices"
  | "purchaseInvoices"
  | "quotations"
  | "returns"
  | "products"
  | "inventory"
  | "stocktakes"
  | "alerts"
  | "customers"
  | "suppliers"
  | "drivers"
  | "cashbox"
  | "dues"
  | "dataImport"
  | "reports"
  | "excelExport"
  | "employeesReport"
  | "advancedAnalytics"
  | "whatsappIntegration"
  | "darkMode"
  | "activityLog"
  | "advancedAlerts"
  | "advancedSecurity"
  | "barcodeSystem"
  | "multiSalePrices"
  | "creditPayment"
  | "creditSales"
  | "expiryTracking"
  | "partAlternatives"
  | "pos";

export interface FeatureDef {
  key: FeatureKey;
  label: string;
  description: string;
  /** Effective state when the owner hasn't set an explicit toggle. */
  defaultEnabled: boolean;
}

export const FEATURES: FeatureDef[] = [
  { key: "pos", label: "نقطة البيع (POS)", description: "واجهة سريعة ومبسطة للمبيعات تدعم قارئ الباركود والطباعة الحرارية", defaultEnabled: true },
  { key: "salesInvoices", label: "فواتير المبيعات", description: "إنشاء وإدارة فواتير البيع للعملاء", defaultEnabled: true },
  { key: "purchaseInvoices", label: "فواتير المشتريات", description: "إنشاء وإدارة فواتير الشراء من الموردين", defaultEnabled: true },
  { key: "quotations", label: "عروض الأسعار", description: "إعداد عروض أسعار وتحويلها لفواتير", defaultEnabled: false },
  { key: "returns", label: "المرتجعات", description: "مرتجعات المبيعات والمشتريات", defaultEnabled: true },
  { key: "products", label: "المنتجات", description: "كتالوج المنتجات والأسعار", defaultEnabled: true },
  { key: "inventory", label: "المخزون", description: "متابعة الكميات وحركة المخزون", defaultEnabled: true },
  { key: "stocktakes", label: "الجرد الدوري", description: "جرد المخزون وتسوية الفروقات", defaultEnabled: false },
  { key: "alerts", label: "لوحة التنبيهات", description: "تنبيهات نفاد المخزون والمستحقات المتأخرة", defaultEnabled: true },
  { key: "customers", label: "العملاء", description: "إدارة بيانات العملاء وكشوف حساباتهم", defaultEnabled: true },
  { key: "suppliers", label: "الموردين", description: "إدارة الموردين والعمولات", defaultEnabled: true },
  { key: "drivers", label: "السائقين", description: "إدارة السائقين وربطهم بالفواتير", defaultEnabled: true },
  { key: "cashbox", label: "الخزينة", description: "حركة النقدية والرصيد", defaultEnabled: true },
  { key: "dues", label: "المستحقات", description: "متابعة مستحقات العملاء والموردين", defaultEnabled: true },
  { key: "dataImport", label: "استيراد البيانات", description: "استيراد المنتجات والعملاء من ملفات CSV", defaultEnabled: false },
  { key: "reports", label: "التقارير", description: "تقارير المبيعات والمشتريات والأرباح", defaultEnabled: true },
  { key: "excelExport", label: "تصدير Excel", description: "تصدير الجداول والتقارير وكشوف الحساب إلى ملفات Excel", defaultEnabled: false },
  { key: "employeesReport", label: "تقرير الموظفين", description: "متابعة المحصَّل والعمولات الشهرية للموظفين", defaultEnabled: false },
  { key: "advancedAnalytics", label: "التحليلات المتقدمة", description: "تصنيف ABC، دوران المخزون، المنتجات الراكدة، ربحية العملاء، واتجاه المبيعات", defaultEnabled: false },
  { key: "whatsappIntegration", label: "التكامل مع واتساب", description: "إرسال الفواتير وإيصالات الدفع عبر واتساب مع قوالب قابلة للتخصيص", defaultEnabled: false },
  { key: "darkMode", label: "الوضع المظلم (Dark Mode)", description: "تفعيل واجهة المستخدم المظلمة للعين", defaultEnabled: false },
  { key: "activityLog", label: "سجل النشاط", description: "تتبع كافة حركات وتعديلات المستخدمين على النظام", defaultEnabled: false },
  { key: "advancedAlerts", label: "لوحة التنبيهات المتقدمة", description: "كروت ذكية للفواتير المتأخرة والأرصدة والتنبيهات القابلة للتخصيص", defaultEnabled: false },
  { key: "advancedSecurity", label: "النسخ الاحتياطي والأمان المتقدم", description: "نسخ احتياطي تلقائي وقفل شاشة تلقائي وخيارات أمان إضافية", defaultEnabled: false },
  { key: "barcodeSystem", label: "نظام الباركود", description: "توليد وطباعة باركود المنتجات ودعم قارئ الباركود", defaultEnabled: false },
  { key: "multiSalePrices", label: "أسعار البيع المتعددة", description: "دعم سعر جملة وسعر تجزئة لنفس المنتج والبيع بأي منهما", defaultEnabled: false },
  { key: "creditPayment", label: "الدفع بالرصيد الدائن", description: "السماح للعميل بالدفع من رصيده الدائن ضمن وسائل الدفع", defaultEnabled: true },
  { key: "creditSales", label: "البيع الآجل", description: "السماح بإنشاء فواتير مبيعات آجلة وتحديد تاريخ الاستحقاق", defaultEnabled: false },
  { key: "expiryTracking", label: "متابعة صلاحية المنتجات", description: "تسجيل تواريخ الصلاحية والتنبيه قبل الانتهاء", defaultEnabled: false },
  { key: "partAlternatives", label: "بدائل وCross Reference قطع الغيار", description: "البحث عن وتجميع الأرقام البديلة والمتطابقة لقطع الغيار (Cross Reference)", defaultEnabled: false },
];

export const FEATURE_MAP: Record<FeatureKey, FeatureDef> = FEATURES.reduce(
  (acc, f) => {
    acc[f.key] = f;
    return acc;
  },
  {} as Record<FeatureKey, FeatureDef>
);

export const PAID_FEATURE_KEYS = new Set<FeatureKey>([
  "advancedAnalytics",
  "whatsappIntegration",
  "employeesReport",
  "activityLog",
  "dataImport",
  "excelExport",
  "advancedAlerts",
  "darkMode",
  "advancedSecurity",
  "barcodeSystem",
  "multiSalePrices",
  "creditSales",
  "expiryTracking",
  "partAlternatives",
]);

/**
 * License cap. When the serial carries an explicit feature whitelist, only those
 * keys are allowed. An absent/empty list means the license predates feature
 * packaging — allow everything so existing installs keep working.
 */
export function isAllowedByLicense(key: FeatureKey, license?: LicensePayload | null): boolean {
  const allowed = license?.features;
  if (!allowed || allowed.length === 0) return !PAID_FEATURE_KEYS.has(key);
  return allowed.includes(key);
}

/**
 * Effective module state before the owner's hide-toggle is applied.
 *
 * - If the serial carries an explicit package (`features` list), that list
 *   *drives* enablement: a module in the package is ON (so a client who paid
 *   for Quotations sees it without extra steps), one outside it is OFF.
 * - Otherwise (old/unpackaged serials) fall back to each module's built-in
 *   default — which is why Quotations/Stocktakes stay hidden until toggled.
 */
export function defaultFeatureState(key: FeatureKey, license?: LicensePayload | null): boolean {
  const licFeatures = license?.features;
  if (licFeatures && licFeatures.length > 0) return licFeatures.includes(key);
  return FEATURE_MAP[key].defaultEnabled;
}

/**
 * Effective module state = allowed by the license (hard cap) AND enabled by the
 * owner's settings (preference). When the owner hasn't set an explicit toggle it
 * falls back to {@link defaultFeatureState}.
 */
export function isFeatureEnabled(
  key: FeatureKey,
  settings?: Settings | null,
  license?: LicensePayload | null
): boolean {
  if (!isAllowedByLicense(key, license)) return false;
  const override = settings?.features?.[key];
  if (override !== undefined) return override;
  return defaultFeatureState(key, license);
}
