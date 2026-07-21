import { useParams } from "react-router-dom";
import { useInvoicing } from "../store/InvoicingContext";
import { useAuth } from "../store/AuthContext";
import { useReporting } from "../store/ReportingContext";
import { InvoicePrintLayout } from "../features/invoices/InvoicePrintLayout";
import { hasPermission } from "../lib/permissions";
import { resolvePaymentLabel } from "../lib/format";
import { salesInvoicePriceTypeLabel } from "../lib/salesPrice";

export function SalesInvoicePrintPage() {
  const { id } = useParams();
  const { salesInvoices, salesReturns } = useInvoicing();
  const { currentUser, auth } = useAuth();
  const { customerBalance } = useReporting();
  // The internal PDF-export window is pre-authorized by the main process, so it
  // renders without an interactive session; every other context must be an
  // authenticated user holding the salesInvoices "view" permission.
  const isInternalPrint = Boolean(window.desktopAPI?.isInternalPrint);
  if (!isInternalPrint && (!auth.isAuthenticated || !hasPermission(currentUser, "salesInvoices"))) {
    return (
      <div className="min-h-screen grid place-items-center text-sm text-ink-faint">
        ليس لديك صلاحية لعرض الفاتورة
      </div>
    );
  }
  const inv = salesInvoices.find((s) => s.id === id);
  if (!inv) {
    return (
      <div className="min-h-screen grid place-items-center text-sm text-ink-faint">
        الفاتورة غير موجودة
      </div>
    );
  }
  const invoiceReturns = salesReturns.filter((r) => r.originalInvoiceId === inv.id);
  const effectiveRemaining = inv.remaining;
  const totalBalance = customerBalance(inv.customerId);
  const paymentLabel = salesPaymentDisplay(inv);
  return (
    <InvoicePrintLayout
      kind="sales"
      invoiceNumber={inv.invoiceNumber}
      date={inv.date}
      partyLabel="العميل"
      partyName={inv.customerName}
      driverName={inv.driverName}
      lines={inv.lines}
      total={inv.total}
      discount={inv.discount}
      amountPaid={inv.amountReceived}
      remaining={effectiveRemaining}
      notes={inv.notes}
      paymentLabel={paymentLabel}
      priceTypeLabel={salesInvoicePriceTypeLabel(inv)}
      returns={invoiceReturns.length > 0 ? invoiceReturns : undefined}
      paymentDueDate={inv.paymentDueDate}
      customerBalance={totalBalance}
      customerName={inv.customerName}
      paymentLog={inv.paymentLog}
      overpayment={inv.overpayment}
      vehicleLabel={inv.vehicleLabel}
      branchName={inv.branchName}
      priceTierName={inv.priceTierName}
    />
  );
}

function salesPaymentDisplay(invoice: {
  paymentType: "cash" | "account";
  paymentMethod?: string;
  paymentMethodLabel?: string;
  amountReceived: number;
}) {
  const methodLabel =
    invoice.paymentMethod === "other" && invoice.paymentMethodLabel
      ? invoice.paymentMethodLabel
      : resolvePaymentLabel(invoice.paymentMethod ?? "cash");

  if (invoice.paymentType === "account") {
    return invoice.amountReceived > 0 ? `آجل / ${methodLabel}` : "آجل";
  }

  return methodLabel;
}
