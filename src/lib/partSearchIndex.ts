import type { Product } from "../types";
import { normalizePartLookup, productLookupValues } from "./partSearch";

export class ProductSearchIndex {
  private tokenToProductIds = new Map<string, Set<string>>();
  private productMap = new Map<string, Product>();

  constructor(products: Product[]) {
    this.buildIndex(products);
  }

  private buildIndex(products: Product[]) {
    for (const product of products) {
      if (product.archived) continue;
      this.productMap.set(product.id, product);

      const lookupValues = productLookupValues(product);
      for (const val of lookupValues) {
        const normalized = normalizePartLookup(val);
        if (!normalized) continue;

        // Index full normalized string
        this.addToken(normalized, product.id);

        // Index sub-words / tokens if original had spaces/dashes
        const words = val.split(/[\s_./-]+/).filter(Boolean);
        for (const word of words) {
          const normWord = normalizePartLookup(word);
          if (normWord) {
            this.addToken(normWord, product.id);
          }
        }
      }
    }
  }

  private addToken(token: string, productId: string) {
    let set = this.tokenToProductIds.get(token);
    if (!set) {
      set = new Set<string>();
      this.tokenToProductIds.set(token, set);
    }
    set.add(productId);
  }

  public search(rawQuery: string, allProducts: Product[]): Product[] {
    const query = normalizePartLookup(rawQuery);
    if (!query) return allProducts.filter((p) => !p.archived);

    // 1. Direct match on indexed token keys
    const directMatches = new Set<string>();
    for (const [token, ids] of this.tokenToProductIds.entries()) {
      if (token.includes(query)) {
        for (const id of ids) {
          directMatches.add(id);
        }
      }
    }

    const results: Product[] = [];
    for (const id of directMatches) {
      const prod = this.productMap.get(id);
      if (prod) {
        results.push(prod);
      }
    }
    return results;
  }
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
