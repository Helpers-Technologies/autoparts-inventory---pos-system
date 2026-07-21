import type { Product } from "../types";

/**
 * Normalise a scanned/typed barcode for comparison.
 *
 * USB barcode scanners emulate a keyboard and often append a carriage return or
 * surrounding whitespace; trimming makes the stored value and the scanned value
 * compare reliably. The raw code is otherwise preserved (barcodes can be
 * alphanumeric for Code-128), so matching stays exact and case-sensitive.
 */
export function normalizeBarcode(raw: string): string {
  return raw.trim().toLowerCase();
}

/**
 * Find the product whose barcode matches the scanned/typed code.
 *
 * Returns the first product with an exact (trimmed, case-insensitive) barcode
 * match, or `undefined` when the code is empty or no product carries it.
 * Barcodes are expected to be unique per product; if duplicates exist the
 * earliest in the list wins.
 */
export function findProductByBarcode(products: Product[], raw: string): Product | undefined {
  const code = normalizeBarcode(raw);
  if (!code) return undefined;
  return products.find((p) => normalizeBarcode(p.barcode ?? "") === code);
}
