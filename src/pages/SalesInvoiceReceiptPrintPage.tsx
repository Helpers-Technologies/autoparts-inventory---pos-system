import { useParams } from "react-router-dom";
import { useInvoicing } from "../store/InvoicingContext";
import { useAuth } from "../store/AuthContext";
import { useUsers } from "../store/UsersContext";
import { useReporting } from "../store/ReportingContext";
import { ReceiptPrintLayout } from "../features/invoices/ReceiptPrintLayout";
import { hasPermission } from "../lib/permissions";
import { resolvePaymentLabel } from "../lib/format";

export function SalesInvoiceReceiptPrintPage() {
  const { id } = useParams();
  const { salesInvoices } = useInvoicing();
  const { users } = useUsers();
  const { currentUser, auth } = useAuth();
  const { customerBalance } = useReporting();

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

  const cashier = users.find((u) => u.id === inv.createdByUserId);
  const cashierName = cashier?.name ?? "المدير";

  const totalBalance = customerBalance(inv.customerId);
  const paymentLabel = salesPaymentDisplay(inv);

  return (
    <ReceiptPrintLayout
      invoiceNumber={inv.invoiceNumber}
      date={inv.date}
      partyName={inv.customerName}
      driverName={inv.driverName}
      lines={inv.lines}
      total={inv.total}
      discount={inv.discount}
      amountPaid={inv.amountReceived}
      remaining={inv.remaining}
      notes={inv.notes}
      paymentLabel={paymentLabel}
      customerBalance={totalBalance}
      customerName={inv.customerName}
      overpayment={inv.overpayment}
      cashierName={cashierName}
      vehicleLabel={inv.vehicleLabel}
      branchName={inv.branchName}
      collectOnDelivery={inv.collectOnDelivery}
      deliveryMethod={inv.deliveryMethod}
      deliveryAddress={inv.deliveryAddress}
      shippingProviderName={inv.shippingProviderName}
      shippingFee={inv.shippingFee}
    />
  );
}

function salesPaymentDisplay(invoice: {
  paymentType: "cash" | "account";
  paymentMethod?: string;
  paymentMethodLabel?: string;
  amountReceived: number;
  collectOnDelivery?: boolean;
}) {
  if (invoice.collectOnDelivery) return "دفع عند الاستلام";

  const methodLabel =
    invoice.paymentMethod === "other" && invoice.paymentMethodLabel
      ? invoice.paymentMethodLabel
      : resolvePaymentLabel(invoice.paymentMethod ?? "cash");

  if (invoice.paymentType === "account") {
    return invoice.amountReceived > 0 ? `آجل / ${methodLabel}` : "آجل";
  }

  return methodLabel;
}
