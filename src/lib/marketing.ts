import type { Customer, Product, SalesInvoice, SalesReturn } from "../types";

const DAY_MS = 86_400_000;

export type MarketingSegmentId =
  | "vip"
  | "loyal"
  | "new"
  | "active"
  | "at_risk"
  | "dormant"
  | "lead";

export type MarketingAudienceFilter = "all" | MarketingSegmentId;

export const MARKETING_SEGMENTS: Record<
  MarketingSegmentId,
  { label: string; description: string; action: string }
> = {
  vip: {
    label: "كبار العملاء VIP",
    description: "أعلى العملاء قيمةً مع تكرار شراء واضح.",
    action: "كافئهم بعرض حصري أو أولوية حجز القطع.",
  },
  loyal: {
    label: "عملاء أوفياء",
    description: "يشترون بصورة متكررة وما زالوا نشطين.",
    action: "قدّم عرض إحالة أو تجميع مشتريات.",
  },
  new: {
    label: "عملاء جدد",
    description: "أول تعامل لهم كان خلال آخر 30 يومًا.",
    action: "أرسل ترحيبًا وسببًا واضحًا للزيارة الثانية.",
  },
  active: {
    label: "عملاء نشطون",
    description: "لديهم تعامل حديث لكن لم يدخلوا شريحة متخصصة.",
    action: "اعرض منتجات مكملة لمشترياتهم الأخيرة.",
  },
  at_risk: {
    label: "معرضون للتوقف",
    description: "كانوا متكررين ولم يشتروا منذ 61–120 يومًا.",
    action: "نفّذ حملة استعادة محدودة المدة.",
  },
  dormant: {
    label: "عملاء متوقفون",
    description: "مرّ أكثر من 120 يومًا على آخر شراء.",
    action: "اسأل عن احتياجهم وقدّم حافز عودة بسيطًا.",
  },
  lead: {
    label: "عملاء محتملون",
    description: "مسجلون في قاعدة العملاء بدون فاتورة شراء.",
    action: "عرّفهم بخدمة المحل واطلب بيانات السيارة.",
  },
};

export interface CustomerMarketingProfile {
  customer: Customer;
  segment: MarketingSegmentId;
  invoiceCount: number;
  netRevenue: number;
  averageOrderValue: number;
  firstPurchaseDate?: string;
  lastPurchaseDate?: string;
  daysSinceLastPurchase?: number;
  topCategory?: string;
  topProduct?: string;
  vehicleLabels: string[];
  branchNames: string[];
  normalizedPhone?: string;
  hasReachablePhone: boolean;
}

export interface MarketingDashboardSummary {
  customerCount: number;
  purchasingCustomerCount: number;
  invoiceCount: number;
  netRevenue: number;
  averageOrderValue: number;
  repeatCustomerRate: number;
  reachableOptedIn: number;
  unknownConsent: number;
  optedOut: number;
  atRiskRevenue: number;
  segmentCounts: Record<MarketingSegmentId, number>;
}

export interface MarketingCategoryInsight {
  category: string;
  revenue: number;
  units: number;
  customers: number;
}

function dateValue(value?: string): number | undefined {
  if (!value) return undefined;
  const timestamp = new Date(`${value.slice(0, 10)}T00:00:00`).getTime();
  return Number.isFinite(timestamp) ? timestamp : undefined;
}

function daysBetween(referenceDate: string, value?: string): number | undefined {
  const reference = dateValue(referenceDate);
  const target = dateValue(value);
  if (reference === undefined || target === undefined) return undefined;
  return Math.max(0, Math.floor((reference - target) / DAY_MS));
}

function percentile(values: number[], ratio: number): number {
  if (values.length === 0) return Number.POSITIVE_INFINITY;
  const ordered = [...values].sort((a, b) => a - b);
  const index = Math.min(ordered.length - 1, Math.max(0, Math.ceil(ordered.length * ratio) - 1));
  return ordered[index] ?? Number.POSITIVE_INFINITY;
}

export function normalizeMarketingPhone(phone?: string): string | undefined {
  const digits = String(phone ?? "").replace(/\D/g, "");
  if (!digits) return undefined;
  const international = digits.startsWith("00") ? digits.slice(2) : digits;
  if (international.startsWith("0") && international.length === 11) return `20${international.slice(1)}`;
  if (international.length >= 10 && international.length <= 15) return international;
  return undefined;
}

export function buildCustomerMarketingProfiles(
  customers: Customer[],
  salesInvoices: SalesInvoice[],
  salesReturns: SalesReturn[],
  products: Product[],
  referenceDate: string,
): CustomerMarketingProfile[] {
  const activeCustomers = customers.filter((customer) => !customer.archived);
  const activeInvoices = salesInvoices.filter((invoice) => !invoice.cancelled);
  const activeInvoiceIds = new Set(activeInvoices.map((invoice) => invoice.id));
  const productById = new Map(products.map((product) => [product.id, product]));
  const returnsByCustomer = new Map<string, number>();
  const returnLinesByCustomer = new Map<string, SalesReturn[]>();
  const invoicesByCustomer = new Map<string, SalesInvoice[]>();

  for (const invoice of activeInvoices) {
    const invoices = invoicesByCustomer.get(invoice.customerId) ?? [];
    invoices.push(invoice);
    invoicesByCustomer.set(invoice.customerId, invoices);
  }
  for (const invoices of invoicesByCustomer.values()) {
    invoices.sort((a, b) => a.date.localeCompare(b.date));
  }

  for (const item of salesReturns) {
    if (!activeInvoiceIds.has(item.originalInvoiceId)) continue;
    returnsByCustomer.set(item.customerId, (returnsByCustomer.get(item.customerId) ?? 0) + item.total);
    const customerReturns = returnLinesByCustomer.get(item.customerId) ?? [];
    customerReturns.push(item);
    returnLinesByCustomer.set(item.customerId, customerReturns);
  }

  const provisional = activeCustomers.map((customer) => {
    const invoices = invoicesByCustomer.get(customer.id) ?? [];
    const grossRevenue = invoices.reduce((sum, invoice) => sum + invoice.total, 0);
    const netRevenue = Math.max(0, grossRevenue - (returnsByCustomer.get(customer.id) ?? 0));
    const categoryValue = new Map<string, number>();
    const productValue = new Map<string, number>();

    for (const invoice of invoices) {
      const grossLines = invoice.lines.reduce((sum, line) => sum + line.subtotal, 0);
      const netFactor = grossLines > 0 ? Math.max(0, invoice.total) / grossLines : 0;
      for (const line of invoice.lines) {
        const category = productById.get(line.productId)?.category || "غير مصنف";
        const lineValue = line.subtotal * netFactor;
        categoryValue.set(category, (categoryValue.get(category) ?? 0) + lineValue);
        productValue.set(line.productName, (productValue.get(line.productName) ?? 0) + lineValue);
      }
    }
    for (const item of returnLinesByCustomer.get(customer.id) ?? []) {
      const grossLines = item.lines.reduce((sum, line) => sum + line.subtotal, 0);
      const netFactor = grossLines > 0 ? Math.max(0, item.total) / grossLines : 0;
      for (const line of item.lines) {
        const category = productById.get(line.productId)?.category || "غير مصنف";
        const lineValue = line.subtotal * netFactor;
        categoryValue.set(category, Math.max(0, (categoryValue.get(category) ?? 0) - lineValue));
        productValue.set(line.productName, Math.max(0, (productValue.get(line.productName) ?? 0) - lineValue));
      }
    }

    const bestKey = (values: Map<string, number>) =>
      [...values.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
    const firstPurchaseDate = invoices[0]?.date;
    const lastPurchaseDate = invoices.at(-1)?.date;
    const normalizedPhone = normalizeMarketingPhone(customer.phone);

    return {
      customer,
      invoiceCount: invoices.length,
      netRevenue,
      averageOrderValue: invoices.length > 0 ? netRevenue / invoices.length : 0,
      firstPurchaseDate,
      lastPurchaseDate,
      daysSinceLastPurchase: daysBetween(referenceDate, lastPurchaseDate),
      topCategory: bestKey(categoryValue),
      topProduct: bestKey(productValue),
      vehicleLabels: [...new Set(invoices.map((invoice) => invoice.vehicleLabel).filter((value): value is string => Boolean(value)))],
      branchNames: [...new Set(invoices.map((invoice) => invoice.branchName).filter((value): value is string => Boolean(value)))],
      normalizedPhone,
      hasReachablePhone: Boolean(normalizedPhone),
    };
  });

  const vipThreshold = percentile(
    provisional
      .filter((profile) => profile.invoiceCount > 0 && profile.daysSinceLastPurchase !== undefined && profile.daysSinceLastPurchase <= 60)
      .map((profile) => profile.netRevenue),
    0.8,
  );

  return provisional.map((profile): CustomerMarketingProfile => {
    const recency = profile.daysSinceLastPurchase;
    const daysSinceFirstPurchase = daysBetween(referenceDate, profile.firstPurchaseDate);
    let segment: MarketingSegmentId;
    if (profile.invoiceCount === 0) segment = "lead";
    else if (daysSinceFirstPurchase !== undefined && daysSinceFirstPurchase <= 30 && profile.invoiceCount <= 2) segment = "new";
    else if (recency !== undefined && recency > 120) segment = "dormant";
    else if (profile.invoiceCount >= 2 && recency !== undefined && recency > 60 && recency <= 120) segment = "at_risk";
    else if (profile.invoiceCount >= 3 && profile.netRevenue >= vipThreshold && recency !== undefined && recency <= 60) segment = "vip";
    else if (profile.invoiceCount >= 3 && recency !== undefined && recency <= 60) segment = "loyal";
    else segment = "active";
    return { ...profile, segment };
  });
}

export function summarizeMarketingProfiles(
  profiles: CustomerMarketingProfile[],
): MarketingDashboardSummary {
  const segmentCounts = Object.fromEntries(
    (Object.keys(MARKETING_SEGMENTS) as MarketingSegmentId[]).map((segment) => [segment, 0]),
  ) as Record<MarketingSegmentId, number>;
  let invoiceCount = 0;
  let netRevenue = 0;
  let purchasingCustomerCount = 0;
  let repeatCustomers = 0;
  let reachableOptedIn = 0;
  let unknownConsent = 0;
  let optedOut = 0;
  let atRiskRevenue = 0;

  for (const profile of profiles) {
    segmentCounts[profile.segment] += 1;
    invoiceCount += profile.invoiceCount;
    netRevenue += profile.netRevenue;
    if (profile.invoiceCount > 0) purchasingCustomerCount += 1;
    if (profile.invoiceCount >= 2) repeatCustomers += 1;
    if (profile.customer.marketingConsent === "opted_in" && profile.hasReachablePhone) reachableOptedIn += 1;
    if (!profile.customer.marketingConsent || profile.customer.marketingConsent === "unknown") unknownConsent += 1;
    if (profile.customer.marketingConsent === "opted_out") optedOut += 1;
    if (profile.segment === "at_risk" || profile.segment === "dormant") atRiskRevenue += profile.netRevenue;
  }

  return {
    customerCount: profiles.length,
    purchasingCustomerCount,
    invoiceCount,
    netRevenue,
    averageOrderValue: invoiceCount > 0 ? netRevenue / invoiceCount : 0,
    repeatCustomerRate: purchasingCustomerCount > 0 ? repeatCustomers / purchasingCustomerCount : 0,
    reachableOptedIn,
    unknownConsent,
    optedOut,
    atRiskRevenue,
    segmentCounts,
  };
}

export function buildCategoryInsights(
  salesInvoices: SalesInvoice[],
  salesReturns: SalesReturn[],
  products: Product[],
): MarketingCategoryInsight[] {
  const productById = new Map(products.map((product) => [product.id, product]));
  const activeInvoiceIds = new Set(salesInvoices.filter((invoice) => !invoice.cancelled).map((invoice) => invoice.id));
  const data = new Map<string, { revenue: number; units: number; customers: Set<string> }>();
  for (const invoice of salesInvoices) {
    if (invoice.cancelled) continue;
    const grossLines = invoice.lines.reduce((sum, line) => sum + line.subtotal, 0);
    const netFactor = grossLines > 0 ? Math.max(0, invoice.total) / grossLines : 0;
    for (const line of invoice.lines) {
      const category = productById.get(line.productId)?.category || "غير مصنف";
      const row = data.get(category) ?? { revenue: 0, units: 0, customers: new Set<string>() };
      row.revenue += line.subtotal * netFactor;
      row.units += line.quantity;
      row.customers.add(invoice.customerId);
      data.set(category, row);
    }
  }
  for (const item of salesReturns) {
    if (!activeInvoiceIds.has(item.originalInvoiceId)) continue;
    const grossLines = item.lines.reduce((sum, line) => sum + line.subtotal, 0);
    const netFactor = grossLines > 0 ? Math.max(0, item.total) / grossLines : 0;
    for (const line of item.lines) {
      const category = productById.get(line.productId)?.category || "غير مصنف";
      const row = data.get(category);
      if (!row) continue;
      row.revenue = Math.max(0, row.revenue - line.subtotal * netFactor);
      row.units = Math.max(0, row.units - line.quantity);
    }
  }
  return [...data.entries()]
    .map(([category, row]) => ({ category, revenue: row.revenue, units: row.units, customers: row.customers.size }))
    .sort((a, b) => b.revenue - a.revenue);
}

export function selectMarketingAudience(
  profiles: CustomerMarketingProfile[],
  segment: MarketingAudienceFilter,
  includeUnknownConsent: boolean,
): CustomerMarketingProfile[] {
  return profiles.filter((profile) => {
    if (segment !== "all" && profile.segment !== segment) return false;
    if (!profile.hasReachablePhone) return false;
    if (profile.customer.marketingConsent === "opted_out") return false;
    if (profile.customer.marketingConsent === "opted_in") return true;
    return includeUnknownConsent;
  });
}

export function renderMarketingMessage(
  template: string,
  profile: CustomerMarketingProfile,
  options: { companyName: string; currency: string },
): string {
  const formatMoney = (value: number) => `${value.toLocaleString("ar-EG", { maximumFractionDigits: 2 })} ${options.currency}`;
  const replacements: Record<string, string> = {
    "{customerName}": profile.customer.name,
    "{companyName}": options.companyName,
    "{lastPurchase}": profile.lastPurchaseDate ?? "لا يوجد",
    "{totalPurchases}": formatMoney(profile.netRevenue),
    "{topCategory}": profile.topCategory ?? "قطع الغيار",
    "{topProduct}": profile.topProduct ?? "قطع الغيار",
    "{vehicle}": profile.vehicleLabels[0] ?? "سيارتك",
  };
  return Object.entries(replacements).reduce(
    (message, [token, value]) => message.split(token).join(value),
    template,
  );
}
