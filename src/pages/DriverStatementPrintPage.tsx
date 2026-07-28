import { useMemo } from "react";
import { useParams } from "react-router-dom";
import { StatementPrintLayout, type StatementRow } from "../features/invoices/StatementPrintLayout";
import { hasPermission } from "../lib/permissions";
import { useFeatures } from "../lib/useFeatures";
import { useAuth } from "../store/AuthContext";
import { useCatalog } from "../store/CatalogContext";
import { useInvoicing } from "../store/InvoicingContext";

export function DriverStatementPrintPage() {
  const { id } = useParams<{ id: string }>();
  const { drivers } = useCatalog();
  const { salesInvoices } = useInvoicing();
  const { currentUser, auth } = useAuth();
  const { isEnabled } = useFeatures();
  const driver = drivers.find((item) => item.id === id);

  const rows = useMemo<StatementRow[]>(() => {
    if (!id) return [];
    const trips = salesInvoices
      .filter((invoice) => invoice.driverId === id && !invoice.cancelled)
      .sort((a, b) => a.date.localeCompare(b.date) || a.invoiceNumber.localeCompare(b.invoiceNumber));

    let balance = 0;
    return trips.map((invoice) => {
      balance += invoice.total - invoice.amountReceived;
      return {
        key: invoice.id,
        date: invoice.date,
        sortKey: `${invoice.date}-${invoice.invoiceNumber}`,
        description: `رحلة ${invoice.invoiceNumber} — ${invoice.customerName} — ${invoice.paymentType === "cash" ? "كاش" : "آجل"}`,
        madin: invoice.total,
        daen: invoice.amountReceived,
        balance,
      };
    });
  }, [id, salesInvoices]);

  if (
    !auth.isAuthenticated ||
    !hasPermission(currentUser, "drivers") ||
    !isEnabled("drivers") ||
    !isEnabled("shippingManagement")
  ) {
    return <div className="min-h-screen grid place-items-center text-sm text-ink-faint" dir="rtl">ليس لديك صلاحية لعرض هذا التقرير</div>;
  }

  if (!driver) {
    return <div className="min-h-screen grid place-items-center text-sm text-ink-faint" dir="rtl">السائق غير موجود</div>;
  }

  return (
    <StatementPrintLayout
      kind="driver"
      partyName={driver.name}
      partyCode={driver.licenseNumber}
      partyPhone={driver.phone}
      rows={rows}
    />
  );
}
