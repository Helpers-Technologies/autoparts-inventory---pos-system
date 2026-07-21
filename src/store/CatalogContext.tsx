import { createContext, useContext } from "react";
import type { CommissionTier, Customer, Driver, ID, OfflineEmployee, OfflineEmployeeTransaction, OfflineEmployeeTransactionType, Product, Stocktake, Supplier } from "../types";

export interface CatalogContextValue {
  products: Product[];
  suppliers: Supplier[];
  customers: Customer[];
  drivers: Driver[];
  stocktakes: Stocktake[];
  offlineEmployees: OfflineEmployee[];
  offlineTransactions: OfflineEmployeeTransaction[];
  addStocktake: (s: Omit<Stocktake, "id" | "createdAt" | "status">) => Stocktake;
  updateStocktakeItems: (stocktakeId: string, items: import("../types").StocktakeItem[]) => void;
  applyStocktake: (stocktakeId: string) => void;
  deleteStocktake: (stocktakeId: string) => void;
  nextProductCode: number;
  nextSupplierCode: number;
  nextCustomerCode: number;
  addProduct: (p: Omit<Product, "id" | "createdAt">) => Product;
  updateProduct: (id: string, patch: Partial<Product>) => void;
  deleteProduct: (id: string) => boolean;
  archiveProduct: (id: string, archived: boolean) => void;
  adjustStock: (productId: string, delta: number, reason: string, looseDelta?: number) => void;
  addSupplier: (s: Omit<Supplier, "id" | "createdAt">) => Supplier;
  updateSupplier: (id: string, patch: Partial<Supplier>) => void;
  deleteSupplier: (id: string) => boolean;
  archiveSupplier: (id: string, archived: boolean) => void;
  addCommissionTier: (supplierId: string, tier: Omit<CommissionTier, "id">) => void;
  updateCommissionTier: (supplierId: string, tierId: string, patch: Partial<CommissionTier>) => void;
  deleteCommissionTier: (supplierId: string, tierId: string) => void;
  addCustomer: (c: Omit<Customer, "id" | "createdAt">) => Customer;
  updateCustomer: (id: string, patch: Partial<Customer>) => void;
  deleteCustomer: (id: string) => boolean;
  archiveCustomer: (id: string, archived: boolean) => void;
  addDriver: (d: Omit<Driver, "id" | "createdAt">) => Driver;
  updateDriver: (id: string, patch: Partial<Driver>) => void;
  deleteDriver: (id: string) => boolean;
  addOfflineEmployee: (data: Omit<OfflineEmployee, "id" | "createdAt">) => OfflineEmployee;
  updateOfflineEmployee: (id: ID, patch: Partial<Omit<OfflineEmployee, "id" | "createdAt">>) => void;
  deleteOfflineEmployee: (id: ID) => void;
  addOfflineTransaction: (data: { employeeId: ID; type: OfflineEmployeeTransactionType; amount: number; month?: string; notes?: string; date: string }) => OfflineEmployeeTransaction;
  deleteOfflineTransaction: (id: ID) => void;
}

export const CatalogContext = createContext<CatalogContextValue | null>(null);

export function useCatalog(): CatalogContextValue {
  const ctx = useContext(CatalogContext);
  if (!ctx) throw new Error("useCatalog must be used within AppProvider");
  return ctx;
}
