import { useMemo } from "react";
import { useParams } from "react-router-dom";
import { useInvoicing } from "../store/InvoicingContext";
import { useCatalog } from "../store/CatalogContext";
import { useAuth } from "../store/AuthContext";
import { hasPermission } from "../lib/permissions";
import { useFeatures } from "../lib/useFeatures";
import { StatementPrintLayout, type StatementRow } from "../features/invoices/StatementPrintLayout";

export function SupplierStatementPrintPage() {
  const { id } = useParams<{ id: string }>();
  const { purchaseInvoices, purchaseReturns, cashEntries } = useInvoicing();
  const { suppliers } = useCatalog();
  const { currentUser, auth } = useAuth();
  const { isEnabled } = useFeatures();

  const supplier = suppliers.find((s) => s.id === id);

  const rows = useMemo<StatementRow[]>(() => {
    if (!id) return [];
    const invoices = purchaseInvoices.filter((inv) => inv.supplierId === id);
    const invoiceIds = new Set(invoices.map((inv) => inv.id));
    const partyReturns = purchaseReturns.filter(
      (r) => r.supplierId === id && invoiceIds.has(r.originalInvoiceId)
    );

    // Purchase returns mutate invoice.total so reconstruct original total per invoice
    const returnSumByInvoice = new Map<string, number>();
    for (const r of partyReturns) {
      returnSumByInvoice.set(r.originalInvoiceId, (returnSumByInvoice.get(r.originalInvoiceId) ?? 0) + r.total);
    }

    const raw: Omit<StatementRow, "balance">[] = [
      // Debit: invoices (original total = current + returns for that invoice)
      ...invoices.map((inv) => ({
        key: `inv-${inv.id}`,
        date: inv.date,
        sortKey: `${inv.date}-0-${inv.invoiceNumber}`,
        description: `فاتورة ${inv.invoiceNumber}`,
        madin: inv.total + (returnSumByInvoice.get(inv.id) ?? 0),
        daen: 0,
      })),
      // Credit: payments. BUG-02: supplier payments are stored as NEGATIVE cash
      // amounts, and paying the supplier must REDUCE what we owe — so negative
      // entries are daen here (the inverse of the customer statement mapping).
      ...cashEntries
        .filter((ce) => ce.referenceId != null && invoiceIds.has(ce.referenceId))
        .map((ce) => ({
          key: `cash-${ce.id}`,
          date: ce.date,
          sortKey: `${ce.date}-5-${ce.id}`,
          description: ce.description,
          madin: ce.amount > 0 ? ce.amount : 0,
          daen: ce.amount < 0 ? Math.abs(ce.amount) : 0,
        })),
      // Credit: purchase returns
      ...partyReturns.map((r) => ({
        key: `ret-${r.id}`,
        date: r.date,
        sortKey: `${r.date}-3-${r.returnNumber}`,
        description: `مرتجع ${r.returnNumber}`,
        madin: 0,
        daen: r.total,
      })),
    ].sort((a, b) => a.sortKey.localeCompare(b.sortKey));

    let balance = 0;
    return raw.map((r) => {
      balance += r.madin - r.daen;
      return { ...r, balance };
    });
  }, [id, purchaseInvoices, purchaseReturns, cashEntries]);

  if (!auth.isAuthenticated || !hasPermission(currentUser, "purchaseInvoices") || !isEnabled("suppliers")) {
    return (
      <div className="min-h-screen grid place-items-center text-sm text-ink-faint" dir="rtl">
        ليس لديك صلاحية لعرض هذا التقرير
      </div>
    );
  }
  if (!supplier) {
    return (
      <div className="min-h-screen grid place-items-center text-sm text-ink-faint" dir="rtl">
        المورد غير موجود
      </div>
    );
  }

  return (
    <StatementPrintLayout
      kind="supplier"
      partyName={supplier.name}
      partyCode={supplier.code}
      partyPhone={supplier.phone}
      rows={rows}
    />
  );
}
