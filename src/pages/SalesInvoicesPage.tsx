import { useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Link, useNavigate } from "react-router-dom";
import { Eye, FileDown, Filter, MessageCircle, Plus, Receipt, Search, Printer, Trash2 } from "lucide-react";
import { PageHeader } from "../components/layout/AppLayout";
import { Card, CardBody, CardHeader } from "../components/ui/Card";
import { Button } from "../components/ui/Button";
import { Badge } from "../components/ui/Badge";
import { Input, Select } from "../components/ui/Input";
import { SearchableSelect } from "../components/ui/SearchableSelect";
import { Table, TBody, TD, TH, THead, TR } from "../components/ui/Table";
import { EmptyState } from "../components/ui/EmptyState";
import { ConfirmDialog } from "../components/ui/Dialog";
import { useInvoicing } from "../store/InvoicingContext";
import { useCatalog } from "../store/CatalogContext";
import { useAuth } from "../store/AuthContext";
import { useSettings } from "../store/SettingsContext";
import { useToast } from "../components/ui/Toast";
import { formatCurrency, formatDate, PAYMENT_METHOD_LABELS, resolvePaymentLabel } from "../lib/format";
import { inRange } from "../lib/utils";
import { savePdfAppRoute } from "../lib/print";
import { usePrintPreviewMode } from "../lib/usePrintPreviewMode";
import { hasPermission } from "../lib/permissions";
import { buildWhatsappUrl, renderInvoiceWhatsappTemplate } from "../lib/whatsappTemplate";
import type { SalesInvoice } from "../types";
import { InvoicePrintLayout } from "../features/invoices/InvoicePrintLayout";
import { useReporting } from "../store/ReportingContext";
import { useFeatures } from "../lib/useFeatures";
import { salesInvoicePriceTypeLabel } from "../lib/salesPrice";

export function SalesInvoicesPage() {
  const { salesInvoices, salesReturns, deleteSalesInvoice } = useInvoicing();
  const { customers } = useCatalog();
  const { currentUser } = useAuth();
  const { settings } = useSettings();
  const { customerBalance } = useReporting();
  const { isEnabled } = useFeatures();
  const whatsappEnabled = isEnabled("whatsappIntegration");
  const navigate = useNavigate();
  const toast = useToast();
  const canAddSalesInvoice = hasPermission(currentUser, "salesInvoices", "add");
  const canDeleteSales = hasPermission(currentUser, "salesInvoices", "delete");
  const [q, setQ] = useState("");
  const [customerId, setCustomerId] = useState("");
  const [status, setStatus] = useState("");
  const [payment, setPayment] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [toDelete, setToDelete] = useState<SalesInvoice | null>(null);
  const [previewInv, setPreviewInv] = useState<SalesInvoice | null>(null);
  usePrintPreviewMode(!!previewInv);

  const customerCodeMap = useMemo(
    () => new Map(customers.map((c) => [c.id, (c.code ?? "").toLowerCase()])),
    [customers]
  );

  const customerPhoneMap = useMemo(
    () => new Map(customers.map((c) => [c.id, (c.phone ?? "").toLowerCase()])),
    [customers]
  );

  const filtered = useMemo(() => {
    let list = salesInvoices;
    if (q.trim()) {
      const t = q.trim().toLowerCase();
      list = list.filter(
        (s) =>
          s.invoiceNumber.toLowerCase().includes(t) ||
          s.customerName.toLowerCase().includes(t) ||
          (s.driverName ?? "").toLowerCase().includes(t) ||
          (customerCodeMap.get(s.customerId) ?? "").includes(t) ||
          (customerPhoneMap.get(s.customerId) ?? "").includes(t)
      );
    }
    if (customerId) list = list.filter((s) => s.customerId === customerId);
    if (status === "overpaid") list = list.filter((s) => s.status === "paid" && (s.overpayment ?? 0) > 0);
    else if (status) list = list.filter((s) => s.status === status);
    if (payment === "account") {
      list = list.filter((s) => s.paymentType === "account");
    } else if (payment) {
      list = list.filter((s) => (s.paymentMethod ?? "cash") === payment);
    }
    list = list.filter((s) => inRange(s.date, from, to));
    return [...list].sort((a, b) => (a.date < b.date ? 1 : -1));
  }, [salesInvoices, customerCodeMap, customerPhoneMap, q, customerId, status, payment, from, to]);

  const totals = useMemo(() => {
    const total = filtered.reduce((a, s) => a + (s.cancelled ? 0 : s.total), 0);
    const received = filtered.reduce(
      (a, s) => a + (s.cancelled ? 0 : s.amountReceived),
      0
    );
    const remaining = filtered.reduce(
      (a, s) => a + (s.cancelled ? 0 : s.remaining),
      0
    );
    return { total, received, remaining };
  }, [filtered]);

  return (
    <>
      <PageHeader
        title="فواتير المبيعات"
        description={`إدارة فواتير العملاء (${salesInvoices.length})`}
        actions={
          canAddSalesInvoice ? (
            <Button onClick={() => navigate("/sales/new")}>
              <Plus className="w-4 h-4" />
              فاتورة جديدة
            </Button>
          ) : null
        }
      />

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <Stat label="إجمالي الفواتير" value={formatCurrency(totals.total, settings.currency)} tone="blue" />
        <Stat label="المحصل" value={formatCurrency(totals.received, settings.currency)} tone="green" />
        <Stat label="المتبقي" value={formatCurrency(totals.remaining, settings.currency)} tone="amber" />
      </div>

      <Card>
        <CardHeader
          title="قائمة الفواتير"
          actions={
            <div className="flex items-center gap-1 text-xs text-ink-muted">
              <Filter className="w-3.5 h-3.5" />
              فلاتر سريعة
            </div>
          }
        />
        <CardBody className="space-y-3">
          <div className="flex flex-wrap gap-2 items-end">
            <div className="relative w-64">
              <Search className="w-4 h-4 absolute top-1/2 -translate-y-1/2 end-3 text-ink-faint" />
              <Input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="بحث برقم الفاتورة أو العميل..."
                className="pe-9"
              />
            </div>
            <SearchableSelect
              value={customerId}
              onChange={setCustomerId}
              options={customers.map((c) => ({ value: c.id, label: c.name }))}
              placeholder="كل العملاء"
              minChars={3}
              className="w-52"
            />
            <Select value={status} onChange={(e) => setStatus(e.target.value)} className="w-40">
              <option value="">كل الحالات</option>
              <option value="paid">مسدد</option>
              <option value="overpaid">مسدد بزيادة</option>
              <option value="partial">جزئي</option>
              <option value="unpaid">غير مسدد</option>
            </Select>
            <Select value={payment} onChange={(e) => setPayment(e.target.value)} className="w-44">
              <option value="">كل وسائل الدفع</option>
              {Object.entries(PAYMENT_METHOD_LABELS)
                .filter(([key]) => key !== "credit")
                .map(([key, label]) => (
                  <option key={key} value={key}>{label}</option>
                ))}
              <option value="account">آجل</option>
            </Select>
            <div className="flex flex-col gap-0.5">
              <span className="text-xs font-medium text-ink-muted">من تاريخ</span>
              <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="w-40" />
            </div>
            <div className="flex flex-col gap-0.5">
              <span className="text-xs font-medium text-ink-muted">إلى تاريخ</span>
              <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="w-40" />
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setQ("");
                setCustomerId("");
                setStatus("");
                setPayment("");
                setFrom("");
                setTo("");
              }}
            >
              مسح الفلاتر
            </Button>
          </div>
          {filtered.length === 0 ? (
            <EmptyState
              icon={<Receipt className="w-5 h-5" />}
              title="لا توجد فواتير"
              description="لم تُنشَأ أي فاتورة مبيعات بعد."
              action={
                canAddSalesInvoice ? (
                  <Button onClick={() => navigate("/sales/new")}>
                    <Plus className="w-4 h-4" /> إنشاء فاتورة
                  </Button>
                ) : undefined
              }
            />
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>الرقم</TH>
                  <TH>التاريخ</TH>
                  <TH>العميل</TH>
                  <TH>السائق</TH>
                  <TH className="text-end">الإجمالي</TH>
                  <TH className="text-end">المستلم</TH>
                  <TH className="text-end">المتبقي</TH>
                  <TH>الدفع</TH>
                  <TH>الحالة</TH>
                  <TH className="text-end">إجراءات</TH>
                </TR>
              </THead>
              <TBody>
                {filtered.map((s) => (
                  <TR key={s.id}>
                    <TD className="font-mono text-xs">
                      <Link to={`/sales/${s.id}`} className="text-brand-700 hover:underline">
                        {s.invoiceNumber}
                      </Link>
                    </TD>
                    <TD>{formatDate(s.date)}</TD>
                    <TD className="font-medium text-ink">{s.customerName}</TD>
                    <TD className="text-ink-muted text-xs">{s.driverName ?? "—"}</TD>
                    <TD className="text-end">{formatCurrency(s.total, settings.currency)}</TD>
                    <TD className="text-end text-emerald-700 dark:text-emerald-400">
                      {formatCurrency(s.amountReceived, settings.currency)}
                    </TD>
                    <TD className="text-end">
                      {s.overpayment && s.overpayment > 0 ? (
                        <span className="text-emerald-700 dark:text-emerald-400">
                          رصيد دائن {formatCurrency(s.overpayment, settings.currency)}
                        </span>
                      ) : s.remaining > 0 ? (
                        <span className="text-rose-700 dark:text-rose-400">
                          {formatCurrency(s.remaining, settings.currency)}
                        </span>
                      ) : (
                        <span className="text-ink-faint">0</span>
                      )}
                    </TD>
                    <TD>
                      <Badge tone={s.paymentType === "cash" ? "emerald" : "indigo"}>
                        {salesPaymentDisplay(s)}
                      </Badge>
                    </TD>
                    <TD>
                      {s.cancelled ? (
                        <Badge tone="slate">ملغاة</Badge>
                      ) : s.status === "paid" && (s.overpayment ?? 0) > 0 ? (
                        <Badge tone="blue">مسدد بزيادة</Badge>
                      ) : s.status === "paid" ? (
                        <Badge tone="green">مسدد</Badge>
                      ) : s.status === "partial" ? (
                        <Badge tone="amber">جزئي</Badge>
                      ) : (
                        <Badge tone="red">غير مسدد</Badge>
                      )}
                    </TD>
                    <TD className="text-end">
                      <div className="inline-flex items-center gap-1">
                        <Button
                          size="icon"
                          variant="ghost"
                          title="عرض"
                          onClick={() => navigate(`/sales/${s.id}`)}
                        >
                          <Eye className="w-4 h-4" />
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          title="معاينة وطباعة"
                          onClick={() => setPreviewInv(s)}
                        >
                          <Printer className="w-4 h-4" />
                        </Button>
                        {canDeleteSales && (
                          <Button
                            size="icon"
                            variant="ghost"
                            title="حذف"
                            className="text-rose-500 hover:text-rose-700 dark:text-rose-400 hover:bg-rose-50 dark:bg-rose-500/10"
                            onClick={() => setToDelete(s)}
                          >
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        )}
                      </div>
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </CardBody>
      </Card>

      <ConfirmDialog
        open={!!toDelete}
        onClose={() => setToDelete(null)}
        onConfirm={() => {
          if (!toDelete) return;
          const ok = deleteSalesInvoice(toDelete.id);
          if (ok) toast.success("تم حذف الفاتورة");
          else toast.error("تعذر الحذف", "الفواتير المرتبطة بمرتجعات لا يمكن حذفها");
          setToDelete(null);
        }}
        title="حذف فاتورة المبيعات"
        message={`هل أنت متأكد من حذف الفاتورة ${toDelete?.invoiceNumber ?? ""}؟ لا يمكن التراجع عن هذا الإجراء.`}
        confirmText="حذف"
        variant="danger"
      />

      {previewInv && (() => {
        const inv = previewInv;
        const linkedReturns = salesReturns.filter((r) => r.originalInvoiceId === inv.id);
        const customer = customers.find((c) => c.id === inv.customerId);
        const totalBalance = customerBalance(inv.customerId);
        const priceTypeLabel = salesInvoicePriceTypeLabel(inv);
        const msg = renderInvoiceWhatsappTemplate(settings.whatsappInvoiceTemplate, {
          partyName: inv.customerName,
          partyLabel: "العميل",
          invoiceType: "فاتورة مبيعات",
          invoiceNumber: inv.invoiceNumber,
          date: formatDate(inv.date),
          total: formatCurrency(inv.total, settings.currency),
          paid: formatCurrency(inv.amountReceived, settings.currency),
          remaining: formatCurrency(inv.remaining, settings.currency),
          status: inv.remaining > 0 ? "غير مسددة بالكامل" : "مسددة بالكامل",
          paymentMethod: inv.paymentMethodLabel ?? "",
          priceType: priceTypeLabel,
          driverName: inv.driverName ?? "",
          phone: customer?.phone ?? "",
          companyName: settings.companyNameAr || settings.companyName,
        });
        return createPortal(
          <div
            className="fixed inset-0 z-50 bg-black/60 flex flex-col items-center overflow-y-auto py-8 px-4 print-preview-backdrop"
            onClick={(e) => { if (e.target === e.currentTarget) setPreviewInv(null); }}
          >
            <div className="w-full max-w-[820px] mb-4 flex items-center justify-between no-print">
              <div className="flex gap-2">
                <button onClick={() => window.print()} className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium px-4 h-9 rounded-lg">
                  <Printer className="w-4 h-4" /> طباعة
                </button>
                {whatsappEnabled && (
                  <button
                    onClick={() => window.open(buildWhatsappUrl(customer?.phone, msg))}
                    className="flex items-center gap-2 bg-green-600 hover:bg-green-700 text-white text-sm font-medium px-4 h-9 rounded-lg"
                  >
                    <MessageCircle className="w-4 h-4" /> واتساب
                  </button>
                )}
                <button
                  onClick={async () => {
                    const result = await savePdfAppRoute(`/sales/${inv.id}/print`);
                    if (result.ok) toast.success("تم حفظ PDF");
                    else if (result.error !== "cancelled") toast.error("تعذر حفظ PDF", result.error ?? "");
                  }}
                  className="flex items-center gap-2 bg-slate-600 hover:bg-slate-700 text-white text-sm font-medium px-4 h-9 rounded-lg"
                >
                  <FileDown className="w-4 h-4" /> حفظ PDF
                </button>
              </div>
              <button onClick={() => setPreviewInv(null)} className="text-white/80 hover:text-white text-sm flex items-center gap-1.5 bg-white/10 hover:bg-white/20 px-3 h-9 rounded-lg">
                ✕ إغلاق
              </button>
            </div>
            <div className="print-preview-area w-full max-w-[820px] bg-white rounded-xl shadow-2xl overflow-hidden force-light invoice-preview-modal">
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
                remaining={inv.remaining}
                notes={inv.notes}
                paymentLabel={salesPaymentDisplay(inv)}
                priceTypeLabel={priceTypeLabel}
                returns={linkedReturns.length > 0 ? linkedReturns : undefined}
                paymentDueDate={inv.paymentDueDate}
                customerBalance={totalBalance}
                customerName={inv.customerName}
                paymentLog={inv.paymentLog}
                overpayment={inv.overpayment}
                vehicleLabel={inv.vehicleLabel}
                branchName={inv.branchName}
                priceTierName={inv.priceTierName}
              />
            </div>
          </div>,
          document.body
        );
      })()}
    </>
  );
}

function salesPaymentDisplay(invoice: SalesInvoice) {
  const methodLabel =
    invoice.paymentMethod === "other" && invoice.paymentMethodLabel
      ? invoice.paymentMethodLabel
      : resolvePaymentLabel(invoice.paymentMethod ?? "cash");

  if (invoice.paymentType === "account") {
    return invoice.amountReceived > 0 ? `آجل / ${methodLabel}` : "آجل";
  }

  return methodLabel;
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: "blue" | "green" | "amber";
}) {
  const colors: Record<string, string> = {
    blue: "bg-blue-50 dark:bg-blue-500/10 text-blue-700 dark:text-blue-400 dark:bg-blue-500/15 dark:text-blue-300",
    green: "bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 dark:bg-emerald-500/15 dark:text-emerald-300",
    amber: "bg-amber-50 dark:bg-amber-500/10 text-amber-700 dark:text-amber-400 dark:bg-amber-500/15 dark:text-amber-300",
  };
  return (
    <div className="bg-surface rounded-xl border border-line p-4 flex items-center gap-3">
      <div className={`w-10 h-10 rounded-lg grid place-items-center ${colors[tone]}`}>
        <Receipt className="w-5 h-5" />
      </div>
      <div>
        <div className="text-xs text-ink-muted">{label}</div>
        <div className="font-semibold text-ink text-lg">{value}</div>
      </div>
    </div>
  );
}
