import type { InvoiceLine, Product, SalesInvoice, SalesPriceType } from "../types";

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

/**
 * The unit price a sales line takes for a given tier.
 *
 * A piece-enabled product sold at retail is priced per PIECE, and its
 * retailPrice already carries that; everything else is the tier's own price.
 * This lived inside SalesInvoiceNewPage, where the only way to test it was to
 * copy it into the test — and the copy drifted while still claiming to be
 * identical. Shared, so there is exactly one rule.
 */
export function salesLinePrice(
  product: Pick<Product, "retailPrice" | "wholesalePrice" | "piecesPerUnit">,
  priceType: SalesPriceType,
): number {
  if (priceType === "retail" && product.piecesPerUnit) return product.retailPrice;
  return priceType === "retail" ? product.retailPrice : product.wholesalePrice;
}
