import type { InvoiceLine, SalesInvoice, SalesPriceType } from "../types";

export function salesPriceTypeLabel(priceType: SalesPriceType) {
  return priceType === "retail" ? "تجزئة" : "جملة";
}

export function resolveSalesLinePriceType(
  line: Pick<InvoiceLine, "priceType" | "isRetailUnit">,
  fallback: SalesPriceType
): SalesPriceType {
  return line.priceType ?? (line.isRetailUnit ? "retail" : fallback);
}

export function salesInvoicePriceTypeLabel(
  invoice: Pick<SalesInvoice, "priceType" | "lines">
) {
  const types = new Set(
    invoice.lines.map((line) => resolveSalesLinePriceType(line, invoice.priceType))
  );
  if (types.size > 1) return "متعدد";
  return salesPriceTypeLabel(types.values().next().value ?? invoice.priceType);
}

export function aggregateSalesPriceType(lines: Pick<InvoiceLine, "priceType" | "isRetailUnit">[]) {
  return lines.length > 0 && lines.every((line) => resolveSalesLinePriceType(line, "wholesale") === "retail")
    ? "retail"
    : "wholesale";
}
