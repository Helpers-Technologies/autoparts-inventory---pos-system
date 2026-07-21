import { useMemo } from "react";
import { useParams } from "react-router-dom";
import { useInvoicing } from "../store/InvoicingContext";
import { useCatalog } from "../store/CatalogContext";
import { useAuth } from "../store/AuthContext";
import { hasPermission } from "../lib/permissions";
import { StatementPrintLayout, type StatementRow } from "../features/invoices/StatementPrintLayout";

export function CustomerStatementPrintPage() {
  const { id } = useParams<{ id: string }>();
  const { salesInvoices, salesReturns, cashEntries } = useInvoicing();
  const { customers } = useCatalog();
  const { currentUser, auth } = useAuth();

  const customer = customers.find((c) => c.id === id);

  const rows = useMemo<StatementRow[]>(() => {
    if (!id) return [];
    const invoices = salesInvoices.filter((inv) => inv.customerId === id && !inv.cancelled);
    const invoiceIds = new Set(invoices.map((inv) => inv.id));
    const partyReturns = salesReturns.filter(
      (r) => r.customerId === id && invoiceIds.has(r.originalInvoiceId)
    );
    // BUG-05: refunds reference the RETURN id, and the store caps them at the
    // amount actually paid — so the statement must use the real refund entries
    // (madin) plus the full return value (daen) instead of assuming a net-zero
    // cash return. Credit settlements (settleAllDues) move money between
    // invoices with no cash entry at all, so they are reconstructed per invoice.
    const returnIdsByInvoice = new Map<string, Set<string>>();
    partyReturns.forEach((r) => {
      const set = returnIdsByInvoice.get(r.originalInvoiceId) ?? new Set<string>();
      set.add(r.id);
      returnIdsByInvoice.set(r.originalInvoiceId, set);
    });
    const allReturnIds = new Set(partyReturns.map((r) => r.id));
    const cashNetByRef = new Map<string, number>();
    cashEntries.forEach((ce) => {
      if (ce.referenceId == null) return;
      if (!invoiceIds.has(ce.referenceId) && !allReturnIds.has(ce.referenceId)) return;
      cashNetByRef.set(ce.referenceId, (cashNetByRef.get(ce.referenceId) ?? 0) + ce.amount);
    });
    const cancelledWithCredit = salesInvoices.filter(
      (inv) => inv.customerId === id && inv.cancelled && (inv.overpayment ?? 0) > 0
    );

    const raw: Omit<StatementRow, "balance">[] = [
      // Debit: invoices
      ...invoices.map((inv) => ({
        key: `inv-${inv.id}`,
        date: inv.date,
        sortKey: `${inv.date}-0-${inv.invoiceNumber}`,
        description: `فاتورة ${inv.invoiceNumber}`,
        madin: inv.total,
        daen: 0,
      })),
      // Credit: cash entries linked to invoices (payments / update-deltas)
      ...cashEntries
        .filter((ce) => ce.referenceId != null && invoiceIds.has(ce.referenceId))
        .map((ce) => ({
          key: `cash-${ce.id}`,
          date: ce.date,
          sortKey: `${ce.date}-5-${ce.id}`,
          description: ce.description,
          madin: ce.amount < 0 ? Math.abs(ce.amount) : 0,
          daen: ce.amount > 0 ? ce.amount : 0,
        })),
      // Returns: full value credited back (goods returned)
      ...partyReturns.map((r) => ({
        key: `ret-${r.id}`,
        date: r.date,
        sortKey: `${r.date}-3-${r.returnNumber}`,
        description: r.refundCash ? `مرتجع كاش ${r.returnNumber}` : `مرتجع ${r.returnNumber}`,
        madin: 0,
        daen: r.total,
      })),
      // Actual cash refunds for returns (negative entries, capped by the store)
      ...cashEntries
        .filter((ce) => ce.referenceId != null && allReturnIds.has(ce.referenceId))
        .map((ce) => ({
          key: `ret-refund-${ce.id}`,
          date: ce.date,
          sortKey: `${ce.date}-4-${ce.id}`,
          description: ce.description,
          madin: ce.amount < 0 ? Math.abs(ce.amount) : 0,
          daen: ce.amount > 0 ? ce.amount : 0,
        })),
      // Credit settlements: recognized money with no cash entry (settleAllDues)
      ...invoices.flatMap((inv) => {
        const cashNet = cashNetByRef.get(inv.id) ?? 0;
        const refundsNet = [...(returnIdsByInvoice.get(inv.id) ?? [])].reduce(
          (sum, retId) => sum + (cashNetByRef.get(retId) ?? 0),
          0
        );
        const creditDelta =
          inv.amountReceived + (inv.overpayment ?? 0) - cashNet - refundsNet;
        if (Math.abs(creditDelta) < 0.005) return [];
        return [{
          key: `credit-${inv.id}`,
          date: inv.date,
          sortKey: `${inv.date}-7-${inv.invoiceNumber}`,
          description:
            creditDelta > 0
              ? `سداد من الرصيد الدائن — فاتورة ${inv.invoiceNumber}`
              : `تحويل رصيد دائن — فاتورة ${inv.invoiceNumber}`,
          madin: creditDelta < 0 ? -creditDelta : 0,
          daen: creditDelta > 0 ? creditDelta : 0,
        }];
      }),
      // Remaining credit held on cancelled invoices (cancel-with-credit)
      ...cancelledWithCredit.map((inv) => ({
        key: `cancelled-credit-${inv.id}`,
        date: inv.date,
        sortKey: `${inv.date}-8-${inv.invoiceNumber}`,
        description: `رصيد دائن — فاتورة ملغاة ${inv.invoiceNumber}`,
        madin: 0,
        daen: inv.overpayment ?? 0,
      })),
    ].sort((a, b) => a.sortKey.localeCompare(b.sortKey));

    let balance = 0;
    return raw.map((r) => {
      balance += r.madin - r.daen;
      return { ...r, balance };
    });
  }, [id, salesInvoices, salesReturns, cashEntries]);

  if (!auth.isAuthenticated || !hasPermission(currentUser, "salesInvoices")) {
    return (
      <div className="min-h-screen grid place-items-center text-sm text-ink-faint" dir="rtl">
        ليس لديك صلاحية لعرض هذا التقرير
      </div>
    );
  }
  if (!customer) {
    return (
      <div className="min-h-screen grid place-items-center text-sm text-ink-faint" dir="rtl">
        العميل غير موجود
      </div>
    );
  }

  return (
    <StatementPrintLayout
      kind="customer"
      partyName={customer.name}
      partyCode={customer.code}
      partyPhone={customer.phone}
      rows={rows}
    />
  );
}
