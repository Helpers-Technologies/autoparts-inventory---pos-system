import type {
  PurchaseInvoice,
  PurchaseReturn,
  SalesInvoice,
  SalesReturn,
  StockMovement,
} from "../types";

type StockMovementReferenceLists = {
  salesInvoices?: SalesInvoice[];
  purchaseInvoices?: PurchaseInvoice[];
  salesReturns?: SalesReturn[];
  purchaseReturns?: PurchaseReturn[];
};

export function formatStockMovementReference(
  movement: StockMovement,
  lists: StockMovementReferenceLists
) {
  if (movement.reason?.trim()) return movement.reason;

  if (!movement.referenceId) return "—";

  if (movement.type === "return") {
    const salesReturn = lists.salesReturns?.find((item) => item.id === movement.referenceId);
    if (salesReturn) return `مرتجع مبيعات ${salesReturn.returnNumber}`;

    const purchaseReturn = lists.purchaseReturns?.find((item) => item.id === movement.referenceId);
    if (purchaseReturn) return `مرتجع توريد ${purchaseReturn.returnNumber}`;
  }

  if (movement.referenceType === "sale" || movement.type === "sale") {
    const invoice = lists.salesInvoices?.find((item) => item.id === movement.referenceId);
    if (invoice) return `فاتورة مبيعات ${invoice.invoiceNumber}`;
    if (movement.referenceId.startsWith("sr_")) return "مرتجع مبيعات";
    if (movement.referenceId.startsWith("sal_")) return "فاتورة مبيعات";
  }

  if (movement.referenceType === "purchase" || movement.type === "purchase") {
    const invoice = lists.purchaseInvoices?.find((item) => item.id === movement.referenceId);
    if (invoice) return `فاتورة مشتريات ${invoice.invoiceNumber}`;
    if (movement.referenceId.startsWith("pr_")) return "مرتجع توريد";
    if (movement.referenceId.startsWith("pur_")) return "فاتورة مشتريات";
  }

  return "—";
}
