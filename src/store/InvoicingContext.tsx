import { createContext, useContext } from "react";
import type {
  CashEntry,
  CashierShift,
  ID,
  InvoiceLine,
  PaymentMethod,
  PurchaseInvoice,
  PurchaseReturn,
  Quotation,
  SalesInvoice,
  SalesReturn,
  StockMovement,
} from "../types";

export interface InvoicingContextValue {
  quotations: Quotation[];
  addQuotation: (q: Omit<Quotation, "id" | "createdAt" | "status">) => Quotation;
  updateQuotation: (
    id: string,
    patch: Pick<
      Quotation,
      | "date"
      | "validUntil"
      | "customerId"
      | "customerName"
      | "customerVehicleId"
      | "vehicleLabel"
      | "branchId"
      | "branchName"
      | "priceTierId"
      | "priceTierName"
      | "lines"
      | "total"
      | "discount"
      | "notes"
    >
  ) => void;
  convertQuotation: (
    quotationId: string,
    opts: {
      invoiceNumber: string;
      date: string;
      paymentType: import("../types").SalesPaymentType;
      priceType: import("../types").SalesPriceType;
      amountReceived: number;
      paymentDueDate?: string;
      driverId?: string;
      driverName?: string;
    }
  ) => SalesInvoice;
  deleteQuotation: (id: string) => void;
  salesInvoices: SalesInvoice[];
  purchaseInvoices: PurchaseInvoice[];
  salesReturns: SalesReturn[];
  purchaseReturns: PurchaseReturn[];
  cashEntries: CashEntry[];
  stockMovements: StockMovement[];
  shifts: CashierShift[];
  activeShift: CashierShift | null;
  openShift: (opts: { openingCash: number; note?: string }) => CashierShift;
  closeShift: (shiftId: ID, closingCashActual: number, note?: string) => CashierShift;
  getShiftSummary: (shiftId: ID) => CashierShift;
  addSalesInvoice: (
    inv: Omit<SalesInvoice, "id" | "createdAt" | "status" | "remaining">
  ) => SalesInvoice;
  updateSalesInvoice: (
    id: string,
    patch: Omit<SalesInvoice, "id" | "createdAt" | "customerId" | "customerName" | "status" | "remaining">
  ) => void;
  recordSalesReceipt: (id: string, amount: number, paymentMethod?: PaymentMethod, notes?: string) => void;
  cancelSalesInvoice: (id: string, refundMode?: "cash" | "credit") => void;
  deleteSalesInvoice: (id: string) => boolean;
  applyCustomerCredit: (customerId: string, invoiceId: string, amount: number) => void;
  settleAllDues: (customerId: ID) => number;
  settleSupplierDues: (supplierId: string) => number;
  addPurchaseInvoice: (
    inv: Omit<PurchaseInvoice, "id" | "createdAt" | "status" | "remaining">
  ) => PurchaseInvoice;
  updatePurchaseInvoice: (
    id: string,
    patch: { lines: InvoiceLine[]; date: string; notes?: string }
  ) => void;
  recordPurchasePayment: (id: string, amount: number, paymentMethod?: PaymentMethod, notes?: string) => void;
  deletePurchaseInvoice: (id: string) => boolean;
  addSalesReturn: (
    r: Omit<SalesReturn, "id" | "createdAt" | "returnNumber">
  ) => SalesReturn;
  addPurchaseReturn: (
    r: Omit<PurchaseReturn, "id" | "createdAt" | "returnNumber">
  ) => PurchaseReturn;
  addCashEntry: (entry: Omit<CashEntry, "id"> & { id?: string }) => CashEntry;
  currentCashBalance: () => number;
}

export const InvoicingContext = createContext<InvoicingContextValue | null>(null);

export function useInvoicing(): InvoicingContextValue {
  const ctx = useContext(InvoicingContext);
  if (!ctx) throw new Error("useInvoicing must be used within AppProvider");
  return ctx;
}
