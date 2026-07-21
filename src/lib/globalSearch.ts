/**
 * Pure, framework-agnostic global search logic.
 * Searched against all entity types the current user has permission to view.
 * Kept in src/lib/ so it can be tested without DOM or React.
 */

export type SearchResultKind =
  | "product"
  | "customer"
  | "supplier"
  | "salesInvoice"
  | "purchaseInvoice"
  | "quotation";

export interface SearchResult {
  id: string;
  kind: SearchResultKind;
  title: string;
  subtitle: string;
  /** React Router path to navigate to on selection. */
  to: string;
  /** When set, pass as { initialSearch } in navigate location.state so the
   *  destination page pre-fills its own search field. */
  initialSearch?: string;
}

export interface SearchCatalog {
  products: {
    id: string;
    name: string;
    code: string;
    barcode?: string;
    partNumber?: string;
    oemNumbers?: string[];
    partBrand?: string;
  }[];
  customers: {
    id: string;
    name: string;
    code?: string;
    phone?: string;
  }[];
  suppliers: {
    id: string;
    name: string;
    code?: string;
    phone?: string;
  }[];
  salesInvoices: {
    id: string;
    invoiceNumber: string;
    customerName: string;
    vehicleLabel?: string;
    branchName?: string;
    partTerms?: string[];
  }[];
  purchaseInvoices: {
    id: string;
    invoiceNumber: string;
    supplierName: string;
    branchName?: string;
    partTerms?: string[];
  }[];
  quotations: {
    id: string;
    quotationNumber: string;
    customerName: string;
    vehicleLabel?: string;
    branchName?: string;
    partTerms?: string[];
  }[];
}

export interface SearchPermissions {
  products: boolean;
  customers: boolean;
  suppliers: boolean;
  salesInvoices: boolean;
  purchaseInvoices: boolean;
  quotations: boolean;
}

/** Maximum results returned per entity kind. */
export const MAX_PER_KIND = 5;

/** Minimum query length before search activates (avoids flooding results on 1 char). */
export const MIN_QUERY_LENGTH = 2;

const ARABIC_DIGITS = "٠١٢٣٤٥٦٧٨٩";
const PERSIAN_DIGITS = "۰۱۲۳۴۵۶۷۸۹";

/**
 * Produces a search-friendly representation while keeping words readable.
 *
 * - Arabic diacritics and tatweel are ignored.
 * - Common Arabic letter variants are unified.
 * - Arabic/Persian digits are converted to ASCII digits.
 * - Dashes, slashes and other punctuation become spaces, so a part number such
 *   as `26300-35505` also matches `26300 35505` and `2630035505`.
 */
export function normalizeGlobalSearchText(value: string): string {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[٠-٩]/g, (digit) => String(ARABIC_DIGITS.indexOf(digit)))
    .replace(/[۰-۹]/g, (digit) => String(PERSIAN_DIGITS.indexOf(digit)))
    .replace(/[\u0610-\u061a\u064b-\u065f\u0670\u06d6-\u06ed]/g, "")
    .replace(/ـ/g, "")
    .replace(/[إأآٱ]/g, "ا")
    .replace(/ؤ/g, "و")
    .replace(/ئ/g, "ي")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}

interface PreparedQuery {
  normalized: string;
  compact: string;
  tokens: string[];
}

interface MatchWeights {
  exact: number;
  prefix: number;
  contains: number;
  tokens: number;
}

function prepareQuery(query: string): PreparedQuery {
  const normalized = normalizeGlobalSearchText(query);
  return {
    normalized,
    compact: normalized.replace(/\s/g, ""),
    tokens: normalized.split(" ").filter(Boolean),
  };
}

function fieldScore(
  value: string | undefined,
  query: PreparedQuery,
  weights: MatchWeights
): number {
  if (!value) return 0;

  const normalized = normalizeGlobalSearchText(value);
  const compact = normalized.replace(/\s/g, "");
  if (!compact) return 0;

  if (compact === query.compact) return weights.exact;
  if (normalized.startsWith(query.normalized) || compact.startsWith(query.compact)) {
    return weights.prefix;
  }
  if (normalized.includes(query.normalized) || compact.includes(query.compact)) {
    return weights.contains;
  }
  if (query.tokens.length > 1 && query.tokens.every((token) => normalized.includes(token))) {
    return weights.tokens;
  }
  return 0;
}

function listScore(
  values: string[] | undefined,
  query: PreparedQuery,
  weights: MatchWeights
): number {
  return values?.reduce((best, value) => Math.max(best, fieldScore(value, query, weights)), 0) ?? 0;
}

function rankedMatches<T>(
  items: T[],
  score: (item: T) => number
): T[] {
  return items
    .map((item, index) => ({ item, index, score: score(item) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, MAX_PER_KIND)
    .map((entry) => entry.item);
}

/**
 * Returns search results across all entities in {@param catalog}, filtered by
 * {@param permissions}. Returns [] when query is shorter than {@link MIN_QUERY_LENGTH}.
 */
export function globalSearch(
  query: string,
  catalog: SearchCatalog,
  permissions: SearchPermissions
): SearchResult[] {
  const term = prepareQuery(query);
  if (term.compact.length < MIN_QUERY_LENGTH) return [];

  const results: SearchResult[] = [];

  if (permissions.products) {
    const identifierWeights = { exact: 6_000, prefix: 2_600, contains: 2_300, tokens: 2_100 };
    const partNumberWeights = { ...identifierWeights, exact: 5_900 };
    const oemWeights = { ...identifierWeights, exact: 5_800 };
    const codeWeights = { ...identifierWeights, exact: 5_600 };
    const nameWeights = { exact: 1_600, prefix: 1_500, contains: 1_300, tokens: 1_200 };
    const brandWeights = { exact: 1_100, prefix: 1_000, contains: 900, tokens: 800 };

    for (const p of rankedMatches(catalog.products, (product) => Math.max(
      fieldScore(product.barcode, term, identifierWeights),
      fieldScore(product.partNumber, term, partNumberWeights),
      listScore(product.oemNumbers, term, oemWeights),
      fieldScore(product.code, term, codeWeights),
      fieldScore(product.name, term, nameWeights),
      fieldScore(product.partBrand, term, brandWeights)
    ))) {
      const primaryOem = p.oemNumbers?.[0];
      results.push({
        id: p.id,
        kind: "product",
        title: p.name,
        subtitle: [
          p.partNumber || p.code,
          primaryOem ? `OEM ${primaryOem}` : undefined,
          p.partBrand,
          p.barcode,
        ].filter(Boolean).join(" · "),
        to: "/products",
        initialSearch: p.partNumber || p.name,
      });
    }
  }

  if (permissions.customers) {
    const codeWeights = { exact: 4_500, prefix: 2_200, contains: 2_000, tokens: 1_800 };
    const nameWeights = { exact: 1_600, prefix: 1_500, contains: 1_300, tokens: 1_200 };
    for (const c of rankedMatches(catalog.customers, (customer) => Math.max(
      fieldScore(customer.phone, term, codeWeights),
      fieldScore(customer.code, term, codeWeights),
      fieldScore(customer.name, term, nameWeights)
    ))) {
      results.push({
        id: c.id,
        kind: "customer",
        title: c.name,
        subtitle: [c.code, c.phone].filter(Boolean).join(" · ") || "عميل",
        to: "/customers",
        initialSearch: c.name,
      });
    }
  }

  if (permissions.suppliers) {
    const codeWeights = { exact: 4_500, prefix: 2_200, contains: 2_000, tokens: 1_800 };
    const nameWeights = { exact: 1_600, prefix: 1_500, contains: 1_300, tokens: 1_200 };
    for (const s of rankedMatches(catalog.suppliers, (supplier) => Math.max(
      fieldScore(supplier.phone, term, codeWeights),
      fieldScore(supplier.code, term, codeWeights),
      fieldScore(supplier.name, term, nameWeights)
    ))) {
      results.push({
        id: s.id,
        kind: "supplier",
        title: s.name,
        subtitle: [s.code, s.phone].filter(Boolean).join(" · ") || "مورد قطع غيار",
        to: "/suppliers",
        initialSearch: s.name,
      });
    }
  }

  if (permissions.salesInvoices) {
    const numberWeights = { exact: 5_000, prefix: 2_500, contains: 2_200, tokens: 2_000 };
    const contextWeights = { exact: 1_700, prefix: 1_500, contains: 1_300, tokens: 1_200 };
    const partWeights = { exact: 4_700, prefix: 2_400, contains: 2_100, tokens: 1_900 };
    for (const inv of rankedMatches(catalog.salesInvoices, (invoice) => Math.max(
      fieldScore(invoice.invoiceNumber, term, numberWeights),
      fieldScore(invoice.customerName, term, contextWeights),
      fieldScore(invoice.vehicleLabel, term, contextWeights),
      fieldScore(invoice.branchName, term, contextWeights),
      listScore(invoice.partTerms, term, partWeights)
    ))) {
      const context = [inv.vehicleLabel, inv.branchName, inv.partTerms?.[0]].filter(Boolean).join(" · ");
      results.push({
        id: inv.id,
        kind: "salesInvoice",
        title: inv.invoiceNumber,
        subtitle: `مبيعات · ${inv.customerName}${context ? ` · ${context}` : ""}`,
        to: `/sales/${inv.id}`,
      });
    }
  }

  if (permissions.purchaseInvoices) {
    const numberWeights = { exact: 5_000, prefix: 2_500, contains: 2_200, tokens: 2_000 };
    const contextWeights = { exact: 1_700, prefix: 1_500, contains: 1_300, tokens: 1_200 };
    const partWeights = { exact: 4_700, prefix: 2_400, contains: 2_100, tokens: 1_900 };
    for (const inv of rankedMatches(catalog.purchaseInvoices, (invoice) => Math.max(
      fieldScore(invoice.invoiceNumber, term, numberWeights),
      fieldScore(invoice.supplierName, term, contextWeights),
      fieldScore(invoice.branchName, term, contextWeights),
      listScore(invoice.partTerms, term, partWeights)
    ))) {
      const context = [inv.branchName, inv.partTerms?.[0]].filter(Boolean).join(" · ");
      results.push({
        id: inv.id,
        kind: "purchaseInvoice",
        title: inv.invoiceNumber,
        subtitle: `مشتريات قطع · ${inv.supplierName}${context ? ` · ${context}` : ""}`,
        to: `/purchases/${inv.id}`,
      });
    }
  }

  if (permissions.quotations) {
    const numberWeights = { exact: 5_000, prefix: 2_500, contains: 2_200, tokens: 2_000 };
    const contextWeights = { exact: 1_700, prefix: 1_500, contains: 1_300, tokens: 1_200 };
    const partWeights = { exact: 4_700, prefix: 2_400, contains: 2_100, tokens: 1_900 };
    for (const q of rankedMatches(catalog.quotations, (quotation) => Math.max(
      fieldScore(quotation.quotationNumber, term, numberWeights),
      fieldScore(quotation.customerName, term, contextWeights),
      fieldScore(quotation.vehicleLabel, term, contextWeights),
      fieldScore(quotation.branchName, term, contextWeights),
      listScore(quotation.partTerms, term, partWeights)
    ))) {
      const context = [q.vehicleLabel, q.branchName, q.partTerms?.[0]].filter(Boolean).join(" · ");
      results.push({
        id: q.id,
        kind: "quotation",
        title: q.quotationNumber,
        subtitle: `عرض سعر قطع غيار · ${q.customerName}${context ? ` · ${context}` : ""}`,
        to: `/quotations/${q.id}`,
      });
    }
  }

  return results;
}

export const KIND_LABELS: Record<SearchResultKind, string> = {
  product: "قطع الغيار",
  customer: "عملاء",
  supplier: "موردو قطع الغيار",
  salesInvoice: "فواتير بيع قطع الغيار",
  purchaseInvoice: "فواتير توريد القطع",
  quotation: "عروض أسعار قطع الغيار",
};
