import type { Product } from "../types";
import { normalizePartLookup, productLookupValues } from "./partSearch";

export class ProductSearchIndex {
  private activeProducts: Product[] = [];
  private prepared: Array<{ product: Product; searchText: string }> = [];
  private trigrams = new Map<string, number[]>();

  constructor(products: Product[]) {
    this.buildIndex(products);
  }

  private buildIndex(products: Product[]) {
    for (const product of products) {
      if (product.archived) continue;
      this.activeProducts.push(product);
      const searchText = productLookupValues(product)
        .map(normalizePartLookup)
        .filter(Boolean)
        .join("\u0000");
      const index = this.prepared.length;
      this.prepared.push({
        product,
        searchText,
      });
      const seen = new Set<string>();
      for (let offset = 0; offset <= searchText.length - 3; offset += 1) {
        const gram = searchText.slice(offset, offset + 3);
        if (gram.includes("\u0000") || seen.has(gram)) continue;
        seen.add(gram);
        const posting = this.trigrams.get(gram);
        if (posting) posting.push(index);
        else this.trigrams.set(gram, [index]);
      }
    }
  }

  public search(rawQuery: string, _allProducts: Product[]): Product[] {
    const currentById = new Map(_allProducts.map((product) => [product.id, product]));
    const query = normalizePartLookup(rawQuery);
    if (!query) return this.activeProducts.map((product) => currentById.get(product.id) ?? product);
    let candidates = this.prepared;
    if (query.length >= 3) {
      let shortest: number[] | undefined;
      for (let offset = 0; offset <= query.length - 3; offset += 1) {
        const posting = this.trigrams.get(query.slice(offset, offset + 3));
        if (!posting) return [];
        if (!shortest || posting.length < shortest.length) shortest = posting;
      }
      if (shortest) candidates = shortest.map((index) => this.prepared[index]);
    }
    return candidates
      .filter((entry) => entry.searchText.includes(query))
      .map((entry) => currentById.get(entry.product.id) ?? entry.product);
  }
}

/** Stock-only sale patches keep the search document unchanged. */
export function canReuseProductSearchIndex(previous: readonly Product[], next: readonly Product[]): boolean {
  if (previous.length !== next.length) return false;
  for (let index = 0; index < next.length; index += 1) {
    const before = previous[index];
    const after = next[index];
    if (before === after) continue;
    if (before.id !== after.id || Boolean(before.archived) !== Boolean(after.archived)) return false;
    const beforeLookup = productLookupValues(before).map(normalizePartLookup).join("\u0000");
    const afterLookup = productLookupValues(after).map(normalizePartLookup).join("\u0000");
    if (beforeLookup !== afterLookup) return false;
  }
  return true;
}

export function buildProductSearchIndex(products: Product[]): ProductSearchIndex {
  return new ProductSearchIndex(products);
}

export function searchProductSearchIndex(
  index: ProductSearchIndex,
  query: string,
  allProducts: Product[]
): Product[] {
  return index.search(query, allProducts);
}
