import type { Product } from "../types";

export function normalizePartLookup(value: string): string {
  return value.trim().toLocaleLowerCase().replace(/[\s_./-]+/g, "");
}

export function productLookupValues(product: Product): string[] {
  return [
    product.barcode,
    product.code,
    product.partNumber,
    product.name,
    product.partBrand,
    product.manufacturer,
    product.rackLocation,
    ...(product.oemNumbers ?? []),
  ].filter((value): value is string => Boolean(value?.trim()));
}

export function productMatchesSearch(product: Product, raw: string): boolean {
  const query = normalizePartLookup(raw);
  if (!query) return true;
  return productLookupValues(product).some((value) => normalizePartLookup(value).includes(query));
}

export type ProductLookupMatch = {
  product: Product;
  matchedBy: "barcode" | "part-number" | "oem" | "internal-code" | "name";
};

export function findProductScanCandidates(products: Product[], raw: string): ProductLookupMatch[] {
  const query = normalizePartLookup(raw);
  if (!query) return [];
  const active = products.filter((product) => !product.archived);
  const exact = (value?: string) => normalizePartLookup(value ?? "") === query;

  const barcode = active.filter((product) => exact(product.barcode));
  if (barcode.length) return barcode.map((product) => ({ product, matchedBy: "barcode" }));
  const partNumbers = active.filter((product) => exact(product.partNumber));
  if (partNumbers.length) return partNumbers.map((product) => ({ product, matchedBy: "part-number" }));
  const oem = active.filter((product) => product.oemNumbers?.some(exact));
  if (oem.length) return oem.map((product) => ({ product, matchedBy: "oem" }));
  const internalCodes = active.filter((product) => exact(product.code));
  if (internalCodes.length) return internalCodes.map((product) => ({ product, matchedBy: "internal-code" }));
  const names = active.filter((product) => exact(product.name));
  return names.map((product) => ({ product, matchedBy: "name" }));
}

export function findProductByScan(products: Product[], raw: string): ProductLookupMatch | undefined {
  return findProductScanCandidates(products, raw)[0];
}
