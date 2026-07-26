import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useInvoicing } from "../store/InvoicingContext";
import { useAuth } from "../store/AuthContext";
import { useSettings } from "../store/SettingsContext";
import { PageHeader } from "../components/layout/AppLayout";
import { Button } from "../components/ui/Button";
import { Input, Select } from "../components/ui/Input";
import { Dialog } from "../components/ui/Dialog";
import { Badge } from "../components/ui/Badge";
import { Filter, Receipt, Search, ShoppingBag, Plus, AlertTriangle, CheckCircle2 } from "lucide-react";
import { formatCurrency, formatDate } from "../lib/format";
import { hasPermission } from "../lib/permissions";
import { inRange } from "../lib/utils";
import { SalesReturnDialog } from "../features/returns/SalesReturnDialog";
import type { SalesInvoice } from "../types";

export function ReturnsPage() {
  const { salesReturns, purchaseReturns, salesInvoices } = useInvoicing();
  const { currentUser } = useAuth();
  const { settings } = useSettings();

  const canViewSales = hasPermission(currentUser, "returns");
  const canViewPurchases = hasPermission(currentUser, "returns");
  const canCreateReturn = hasPermission(currentUser, "returns", "add");

  const [tab, setTab] = useState<"sales" | "purchases">(canViewSales ? "sales" : "purchases");
  const [q, setQ] = useState("");
  const [partyId, setPartyId] = useState("");
  const [refundMode, setRefundMode] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  // Modal for initiating a return by searching invoice / receipt number
  const [isInvoiceSearchOpen, setIsInvoiceSearchOpen] = useState(false);
  const [invoiceQuery, setInvoiceQuery] = useState("");
  const [selectedInvoiceForReturn, setSelectedInvoiceForReturn] = useState<SalesInvoice | null>(null);
  const [isReturnDialogOpen, setIsReturnDialogOpen] = useState(false);

  const maxReturnDays = settings.maxReturnDays ?? 14;

  function changeTab(nextTab: "sales" | "purchases") {
    setTab(nextTab);
    setPartyId("");
    setRefundMode("");
  }

  function clearFilters() {
    setQ("");
    setPartyId("");
    setRefundMode("");
    setFrom("");
    setTo("");
  }

  const salesParties = useMemo(() => {
    const map = new Map<string, string>();
    salesReturns.forEach((r) => map.set(r.customerId, r.customerName));
    return [...map.entries()]
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name, "ar"));
  }, [salesReturns]);

  const purchaseParties = useMemo(() => {
    const map = new Map<string, string>();
    purchaseReturns.forEach((r) => map.set(r.supplierId, r.supplierName));
    return [...map.entries()]
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name, "ar"));
  }, [purchaseReturns]);

  const filteredSalesReturns = useMemo(() => {
    const term = q.trim().toLowerCase();
    let list = salesReturns.filter((r) => inRange(r.date, from, to));

    if (partyId) list = list.filter((r) => r.customerId === partyId);
    if (refundMode === "cash") list = list.filter((r) => r.refundCash);
    if (refundMode === "credit") list = list.filter((r) => !r.refundCash);
    if (term) {
      list = list.filter((r) =>
        r.returnNumber.toLowerCase().includes(term) ||
        r.originalInvoiceNumber.toLowerCase().includes(term) ||
        r.customerName.toLowerCase().includes(term) ||
        (r.notes ?? "").toLowerCase().includes(term) ||
        r.lines.some((line) => line.productName.toLowerCase().includes(term))
      );
    }

    return [...list].sort((a, b) => (a.date < b.date ? 1 : -1));
  }, [salesReturns, q, partyId, refundMode, from, to]);

  const filteredPurchaseReturns = useMemo(() => {
    const term = q.trim().toLowerCase();
    let list = purchaseReturns.filter((r) => inRange(r.date, from, to));

    if (partyId) list = list.filter((r) => r.supplierId === partyId);
    if (term) {
      list = list.filter((r) =>
        r.returnNumber.toLowerCase().includes(term) ||
        r.originalInvoiceNumber.toLowerCase().includes(term) ||
        r.supplierName.toLowerCase().includes(term) ||
        (r.notes ?? "").toLowerCase().includes(term) ||
        r.lines.some((line) => line.productName.toLowerCase().includes(term))
      );
    }

    return [...list].sort((a, b) => (a.date < b.date ? 1 : -1));
  }, [purchaseReturns, q, partyId, from, to]);

  const matchingInvoices = useMemo(() => {
    const term = invoiceQuery.trim().toLowerCase();
    if (!term) return salesInvoices.slice(0, 10);
    return salesInvoices.filter(
      (inv) =>
        inv.invoiceNumber.toLowerCase().includes(term) ||
        inv.customerName.toLowerCase().includes(term) ||
        inv.date.includes(term)
    ).slice(0, 15);
  }, [salesInvoices, invoiceQuery]);

  const activeParties = tab === "sales" ? salesParties : purchaseParties;
  const activeCount = tab === "sales" ? filteredSalesReturns.length : filteredPurchaseReturns.length;

  return (
    <>
      <PageHeader
        title="المرتجعات"
        description={`إدارة مرتجعات الشراء والبيع والتحقق من سياسة المرتجعات (${maxReturnDays} يوماً)`}
        actions={
          canCreateReturn && (
            <Button
              variant="primary"
              onClick={() => {
                setInvoiceQuery("");
                setIsInvoiceSearchOpen(true);
              }}
            >
              <Plus className="w-4 h-4 ml-1.5" />
              إنشاء مرتجع مبيعات (برقم الفاتورة/الريسيت)
            </Button>
          )
        }
      />

      <div className="bg-surface border border-line rounded-xl overflow-hidden shadow-sm">
        <div className="flex border-b border-line">
          {canViewSales && (
            <button
              onClick={() => changeTab("sales")}
              className={`flex-1 flex items-center justify-center gap-2 py-4 font-medium text-sm transition-colors ${
                tab === "sales"
                  ? "border-b-2 border-brand-500 text-brand-400 bg-surface-muted"
                  : "text-ink-muted hover:bg-surface-muted"
              }`}
            >
              <Receipt className="w-4 h-4" /> مرتجعات مبيعات
            </button>
          )}
          {canViewPurchases && (
            <button
              onClick={() => changeTab("purchases")}
              className={`flex-1 flex items-center justify-center gap-2 py-4 font-medium text-sm transition-colors ${
                tab === "purchases"
                  ? "border-b-2 border-brand-500 text-brand-400 bg-surface-muted"
                  : "text-ink-muted hover:bg-surface-muted"
              }`}
            >
              <ShoppingBag className="w-4 h-4" /> مرتجعات مشتريات
            </button>
          )}
        </div>

        <div className="border-b border-line p-4">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div className="flex items-center gap-1.5 text-xs text-ink-muted">
              <Filter className="w-3.5 h-3.5" />
              فلاتر المرتجعات
            </div>
            <div className="text-xs text-ink-faint">النتائج: {activeCount}</div>
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <div className="relative w-72">
              <Search className="w-4 h-4 absolute top-1/2 -translate-y-1/2 end-3 text-ink-faint" />
              <Input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="بحث برقم المرتجع أو الفاتورة أو المنتج..."
                className="pe-9"
              />
            </div>
            <Select value={partyId} onChange={(e) => setPartyId(e.target.value)} className="w-52">
              <option value="">{tab === "sales" ? "كل العملاء" : "كل الموردين"}</option>
              {activeParties.map((party) => (
                <option key={party.id} value={party.id}>{party.name}</option>
              ))}
            </Select>
            {tab === "sales" && (
              <Select value={refundMode} onChange={(e) => setRefundMode(e.target.value)} className="w-44">
                <option value="">كل طرق الرد</option>
                <option value="cash">رد كاش</option>
                <option value="credit">خصم من الرصيد</option>
              </Select>
            )}
            <div className="flex flex-col gap-0.5">
              <span className="text-xs font-medium text-ink-muted">من تاريخ</span>
              <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="w-40" />
            </div>
            <div className="flex flex-col gap-0.5">
              <span className="text-xs font-medium text-ink-muted">إلى تاريخ</span>
              <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="w-40" />
            </div>
            <Button variant="outline" size="sm" onClick={clearFilters}>
              مسح الفلاتر
            </Button>
          </div>
        </div>

        {tab === "sales" && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-right">
              <thead className="bg-surface-muted border-b border-line text-ink-muted">
                <tr>
                  <th className="px-4 py-3 font-medium">رقم المرتجع</th>
                  <th className="px-4 py-3 font-medium">التاريخ</th>
                  <th className="px-4 py-3 font-medium">الفاتورة الأصلية</th>
                  <th className="px-4 py-3 font-medium">العميل</th>
                  <th className="px-4 py-3 font-medium">الإجمالي</th>
                  <th className="px-4 py-3 font-medium">طريقة الرد</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {filteredSalesReturns.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-8 text-center text-ink-muted">
                      لا توجد مرتجعات مبيعات مطابقة للفلاتر
                    </td>
                  </tr>
                ) : (
                  filteredSalesReturns.map((r) => (
                    <tr key={r.id} className="hover:bg-surface-muted">
                      <td className="px-4 py-3 font-medium text-brand-700">{r.returnNumber}</td>
                      <td className="px-4 py-3 text-ink-muted">{formatDate(r.date)}</td>
                      <td className="px-4 py-3 text-ink-muted">
                        <Link to={`/sales/${r.originalInvoiceId}`} className="text-brand-600 hover:text-brand-700 underline underline-offset-2">
                          {r.originalInvoiceNumber}
                        </Link>
                      </td>
                      <td className="px-4 py-3 text-ink">{r.customerName}</td>
                      <td className="px-4 py-3 font-bold text-ink">{formatCurrency(r.total, settings.currency)}</td>
                      <td className="px-4 py-3 text-ink-muted">
                        {r.refundCash ? "رد كاش" : "خصم من الرصيد"}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}

        {tab === "purchases" && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-right">
              <thead className="bg-surface-muted border-b border-line text-ink-muted">
                <tr>
                  <th className="px-4 py-3 font-medium">رقم المرتجع</th>
                  <th className="px-4 py-3 font-medium">التاريخ</th>
                  <th className="px-4 py-3 font-medium">الفاتورة الأصلية</th>
                  <th className="px-4 py-3 font-medium">المورد</th>
                  <th className="px-4 py-3 font-medium">الإجمالي</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {filteredPurchaseReturns.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-4 py-8 text-center text-ink-faint">
                      لا توجد مرتجعات مشتريات مطابقة للفلاتر
                    </td>
                  </tr>
                ) : (
                  filteredPurchaseReturns.map((r) => (
                    <tr key={r.id} className="hover:bg-surface-muted">
                      <td className="px-4 py-3 font-medium text-brand-700">{r.returnNumber}</td>
                      <td className="px-4 py-3 text-ink-muted">{formatDate(r.date)}</td>
                      <td className="px-4 py-3 text-ink-muted">
                        <Link to={`/purchases/${r.originalInvoiceId}`} className="text-brand-600 hover:text-brand-700 underline underline-offset-2">
                          {r.originalInvoiceNumber}
                        </Link>
                      </td>
                      <td className="px-4 py-3 text-ink">{r.supplierName}</td>
                      <td className="px-4 py-3 font-bold text-ink">{formatCurrency(r.total, settings.currency)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Invoice Search Modal to Initiate Return */}
      <Dialog
        open={isInvoiceSearchOpen}
        onClose={() => setIsInvoiceSearchOpen(false)}
        title="تحديد فاتورة أو ريسيت الشراء المُراد إرجاعه"
        width="md"
      >
        <div className="space-y-4" dir="rtl">
          <div className="p-3 rounded-lg border border-brand-200 dark:border-brand-500/20 bg-brand-50/50 dark:bg-brand-500/10 text-xs text-brand-900 dark:text-brand-300">
            أدخل رقم الفاتورة أو الريسيت الموجود مع العميل لاستكمال إجراء المرتجع.
            حد الاسترجاع المسموح به في النظام هو <strong>{maxReturnDays === 999 ? "مفتوح" : `${maxReturnDays} يوماً`}</strong> من تاريخ الفاتورة.
          </div>

          <div className="relative">
            <Search className="w-4 h-4 absolute top-1/2 -translate-y-1/2 end-3 text-ink-faint" />
            <Input
              value={invoiceQuery}
              onChange={(e) => setInvoiceQuery(e.target.value)}
              placeholder="اكتب رقم الفاتورة أو الريسيت (مثال: INV-001) أو اسم العميل..."
              className="pe-9 text-base"
              autoFocus
            />
          </div>

          <div className="space-y-2 max-h-72 overflow-y-auto pe-1">
            {matchingInvoices.length === 0 ? (
              <div className="text-center py-6 text-sm text-ink-muted">
                لم يتم العثور على فاتورة أو ريسيت بهذا الرقم
              </div>
            ) : (
              matchingInvoices.map((inv) => {
                const invDateMs = new Date(inv.date).getTime();
                const todayMs = new Date().getTime();
                const diffDays = Math.max(0, Math.floor((todayMs - invDateMs) / (1000 * 60 * 60 * 24)));
                const isExpired = maxReturnDays !== 999 && diffDays > maxReturnDays;

                return (
                  <div
                    key={inv.id}
                    onClick={() => {
                      setSelectedInvoiceForReturn(inv);
                      setIsInvoiceSearchOpen(false);
                      setIsReturnDialogOpen(true);
                    }}
                    className="p-3 rounded-lg border border-line hover:border-brand-500/50 bg-surface hover:bg-surface-muted transition-all cursor-pointer flex items-center justify-between gap-3"
                  >
                    <div>
                      <div className="font-bold text-sm text-ink flex items-center gap-2">
                        <span>{inv.invoiceNumber}</span>
                        <span className="text-xs font-normal text-ink-muted">({inv.customerName})</span>
                      </div>
                      <div className="text-xs text-ink-faint mt-1">
                        تاريخ الشراء: {formatDate(inv.date)} ({diffDays} يوماً)
                      </div>
                    </div>

                    <div className="text-left flex flex-col items-end gap-1">
                      <div className="font-bold text-sm text-brand-600">
                        {formatCurrency(inv.total, settings.currency)}
                      </div>
                      {isExpired ? (
                        <Badge tone="red">
                          <AlertTriangle className="w-3 h-3 ml-1" />
                          تجاوزت {maxReturnDays} يوم (ممنوع)
                        </Badge>
                      ) : (
                        <Badge tone="emerald">
                          <CheckCircle2 className="w-3 h-3 ml-1" />
                          متاح للاسترجاع
                        </Badge>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </Dialog>

      {/* Sales Return Dialog */}
      {selectedInvoiceForReturn && (
        <SalesReturnDialog
          open={isReturnDialogOpen}
          onClose={() => {
            setIsReturnDialogOpen(false);
            setSelectedInvoiceForReturn(null);
          }}
          invoice={selectedInvoiceForReturn}
        />
      )}
    </>
  );
}
