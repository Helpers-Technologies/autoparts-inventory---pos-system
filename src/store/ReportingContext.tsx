import { createContext, useContext } from "react";
import type { CommissionType, ID } from "../types";

export interface ReportingContextValue {
  customerBalance: (customerId: string) => number;
  customerCredit: (customerId: string) => number;
  supplierBalance: (supplierId: string) => number;
  supplierCredit: (supplierId: string) => number;
  calculateSupplierCommission: (supplierId: string) => {
    tierId: string;
    threshold: number;
    periodDays: number;
    totalPurchases: number;
    earned: number;
    commissionType: CommissionType;
    commissionValue: number;
  }[];
  employeeSalesStats: (
    userId: ID,
    month: string
  ) => {
    totalCollected: number;
    commissionEarned: number;
    commissionPct: number;
    target: number;
    salary: number;
    totalEarnings: number;
    monthLabel: string;
  };
  employeeSalesStatsBatch: (userIds: ID[], month: string) => Map<ID, {
    totalCollected: number;
    commissionEarned: number;
    commissionPct: number;
    target: number;
    salary: number;
    totalEarnings: number;
    monthLabel: string;
  }>;
  exportToExcel: (
    dataType:
      | "products"
      | "customers"
      | "suppliers"
      | "sales"
      | "purchases"
      | "stock"
      | "supplierDues"
      | "customerDues"
      | "commissions"
  ) => void;
}

export const ReportingContext = createContext<ReportingContextValue | null>(null);

export function useReporting(): ReportingContextValue {
  const ctx = useContext(ReportingContext);
  if (!ctx) throw new Error("useReporting must be used within AppProvider");
  return ctx;
}
