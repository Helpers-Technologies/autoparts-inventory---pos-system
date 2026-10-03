import { createContext, useContext } from "react";

export const DEFERRED_COLLECTIONS = [
  "customers",
  "salesInvoices",
  "purchaseInvoices",
  "cashEntries",
  "salesReturns",
  "purchaseReturns",
  "quotations",
] as const;

export type DeferredCollection = (typeof DEFERRED_COLLECTIONS)[number];
export type CollectionHydrationState = "unloaded" | "loading" | "loaded" | "error";

export interface HydrationContextValue {
  collectionState: Readonly<Record<DeferredCollection, CollectionHydrationState>>;
  hydrateCollections: (collections: readonly DeferredCollection[]) => Promise<boolean>;
  areCollectionsLoaded: (collections: readonly DeferredCollection[]) => boolean;
}

export const HydrationContext = createContext<HydrationContextValue | null>(null);

export function useCollectionHydration(): HydrationContextValue {
  const value = useContext(HydrationContext);
  if (!value) throw new Error("useCollectionHydration must be used within AppProvider");
  return value;
}
