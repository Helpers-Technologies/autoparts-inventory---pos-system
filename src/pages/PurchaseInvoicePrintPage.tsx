import { useParams } from "react-router-dom";
import { useInvoicing } from "../store/InvoicingContext";
import { useAuth } from "../store/AuthContext";
import { InvoicePrintLayout } from "../features/invoices/InvoicePrintLayout";
import { hasPermission } from "../lib/permissions";

export function PurchaseInvoicePrintPage() {
  const { id } = useParams();
  const { purchaseInvoices, purchaseReturns } = useInvoicing();
  const { currentUser, auth } = useAuth();
  // The internal PDF-export window is pre-authorized by the main process; any
  // other context requires an authenticated user with purchaseInvoices "view".
  const isInternalPrint = Boolean(window.desktopAPI?.isInternalPrint);
  if (!isInternalPrint && (!auth.isAuthenticated || !hasPermission(currentUser, "purchaseInvoices"))) {
    return (
      <div className="min-h-screen grid place-items-center text-sm text-ink-faint">
        ليس لديك صلاحية لعرض الفاتورة
      </div>
    );
  }
  const inv = purchaseInvoices.find((s) => s.id === id);
  if (!inv) {
    return (
      <div className="min-h-screen grid place-items-center text-sm text-ink-faint">
        الفاتورة غير موجودة
      </div>
    );
  }
  const invoiceReturns = purchaseReturns.filter((r) => r.originalInvoiceId === inv.id);
  return (
    <InvoicePrintLayout
      kind="purchase"
      invoiceNumber={inv.invoiceNumber}
      date={inv.date}
      partyLabel="المورد"
      partyName={inv.supplierName}
      lines={inv.lines}
      total={inv.total}
      amountPaid={inv.amountPaid}
      remaining={inv.remaining}
      notes={inv.notes}
      paymentLabel={inv.status === "paid" ? "مسدد" : inv.status === "partial" ? "جزئي" : "آجل"}
      returns={invoiceReturns.length > 0 ? invoiceReturns : undefined}
      paymentLog={inv.paymentLog}
    />
  );
}
