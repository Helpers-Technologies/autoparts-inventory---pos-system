import { useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Link, useNavigate } from "react-router-dom";
import { Eye, FileDown, Filter, MessageCircle, Plus, ShoppingBag, Search, Printer, Trash2 } from "lucide-react";
import { PageHeader } from "../components/layout/AppLayout";
import { Card, CardBody, CardHeader } from "../components/ui/Card";
import { Button } from "../components/ui/Button";
import { Badge } from "../components/ui/Badge";
import { Input, Select } from "../components/ui/Input";
import { Table, TBody, TD, TH, THead, TR } from "../components/ui/Table";
import { EmptyState } from "../components/ui/EmptyState";
import { ConfirmDialog } from "../components/ui/Dialog";
import { useInvoicing } from "../store/InvoicingContext";
import { useCatalog } from "../store/CatalogContext";
import { useAuth } from "../store/AuthContext";
import { useSettings } from "../store/SettingsContext";
import { useToast } from "../components/ui/Toast";
import { formatCurrency, formatDate } from "../lib/format";
import { inRange } from "../lib/utils";
import { savePdfAppRoute } from "../lib/print";
import { usePrintPreviewMode } from "../lib/usePrintPreviewMode";
import { hasPermission } from "../lib/permissions";
import { buildWhatsappUrl, renderInvoiceWhatsappTemplate } from "../lib/whatsappTemplate";
import type { PurchaseInvoice } from "../types";
import { InvoicePrintLayout } from "../features/invoices/InvoicePrintLayout";
import { useFeatures } from "../lib/useFeatures";

export function PurchaseInvoicesPage() {
  const { purchaseInvoices, purchaseReturns, deletePurchaseInvoice } = useInvoicing();
  const { suppliers } = useCatalog();
  const { currentUser } = useAuth();
  const { settings } = useSettings();
  const { isEnabled } = useFeatures();
  const whatsappEnabled = isEnabled("whatsappIntegration");
  const navigate = useNavigate();
  const toast = useToast();
  const canAddPurchaseInvoice = hasPermission(currentUser, "purchaseInvoices", "add");
  const canDeletePurchase = hasPermission(currentUser, "purchaseInvoices", "delete");
  const [q, setQ] = useState("");
  const [supplierId, setSupplierId] = useState("");
  const [status, setStatus] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [toDelete, setToDelete] = useState<PurchaseInvoice | null>(null);
  const [previewInv, setPreviewInv] = useState<PurchaseInvoice | null>(null);
  usePrintPreviewMode(!!previewInv);

  const supplierCodeMap = useMemo(
    () => new Map(suppliers.map((s) => [s.id, (s.code ?? "").toLowerCase()])),
    [suppliers]
  );

  const supplierPhoneMap = useMemo(
    () => new Map(suppliers.map((s) => [s.id, (s.phone ?? "").toLowerCase()])),
    [suppliers]
  );

  const filtered = useMemo(() => {
    let list = purchaseInvoices;
    if (q.trim()) {
      const t = q.trim().toLowerCase();
      list = list.filter(
        (s) =>
          s.invoiceNumber.toLowerCase().includes(t) ||
          s.supplierName.toLowerCase().includes(t) ||
          (supplierCodeMap.get(s.supplierId) ?? "").includes(t) ||
          (supplierPhoneMap.get(s.supplierId) ?? "").includes(t)
      );
    }
    if (supplierId) list = list.filter((s) => s.supplierId === supplierId);
    if (status) list = list.filter((s) => s.status === status);
    list = list.filter((s) => inRange(s.date, from, to));
    return [...list].sort((a, b) => (a.date < b.date ? 1 : -1));
  }, [purchaseInvoices, supplierCodeMap, supplierPhoneMap, q, supplierId, status, from, to]);

  const totals = useMemo(() => {
    const total = filtered.reduce((a, s) => a + s.total, 0);
    const paid = filtered.reduce((a, s) => a + s.amountPaid, 0);
    const remaining = filtered.reduce((a, s) => a + s.remaining, 0);
    return { total, paid, remaining };
  }, [filtered]);

  return (
    <>
      <PageHeader
        title="فواتير المشتريات"
        description={`إدارة فواتير الموردين (${purchaseInvoices.length})`}
        actions={
          canAddPurchaseInvoice ? (
            <Button onClick={() => navigate("/purchases/new")}>
              <Plus className="w-4 h-4" />
              فاتورة جديدة
            </Button>
          ) : null
        }
      />

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <Stat label="إجمالي المشتريات" value={formatCurrency(totals.total, settings.currency)} tone="blue" />
        <Stat label="المدفوع" value={formatCurrency(totals.paid, settings.currency)} tone="green" />
        <Stat label="المتبقي للموردين" value={formatCurrency(totals.remaining, settings.currency)} tone="amber" />
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
                placeholder="بحث برقم الفاتورة أو المورد..."
                className="pe-9"
              />
            </div>
            <Select value={supplierId} onChange={(e) => setSupplierId(e.target.value)} className="w-52">
              <option value="">كل الموردين</option>
              {suppliers.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </Select>
            <Select value={status} onChange={(e) => setStatus(e.target.value)} className="w-36">
              <option value="">كل الحالات</option>
              <option value="paid">مسدد</option>
              <option value="partial">جزئي</option>
              <option value="unpaid">غير مسدد</option>
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
                setSupplierId("");
                setStatus("");
                setFrom("");
                setTo("");
              }}
            >
              مسح الفلاتر
            </Button>
          </div>
          {filtered.length === 0 ? (
            <EmptyState
              icon={<ShoppingBag className="w-5 h-5" />}
              title="لا توجد فواتير"
              description="لم تُنشَأ أي فاتورة مشتريات بعد."
              action={
                canAddPurchaseInvoice ? (
                  <Button onClick={() => navigate("/purchases/new")}>
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
                  <TH>المورد</TH>
                  <TH className="text-end">الإجمالي</TH>
                  <TH className="text-end">المدفوع</TH>
                  <TH className="text-end">المتبقي</TH>
                  <TH>الحالة</TH>
                  <TH className="text-end">إجراءات</TH>
                </TR>
              </THead>
              <TBody>
                {filtered.map((s) => (
                  <TR key={s.id}>
                    <TD className="font-mono text-xs">
                      <Link to={`/purchases/${s.id}`} className="text-brand-700 hover:underline">
                        {s.invoiceNumber}
                      </Link>
                    </TD>
                    <TD>{formatDate(s.date)}</TD>
                    <TD className="font-medium text-ink">{s.supplierName}</TD>
                    <TD className="text-end">{formatCurrency(s.total, settings.currency)}</TD>
                    <TD className="text-end text-emerald-700 dark:text-emerald-400">
                      {formatCurrency(s.amountPaid, settings.currency)}
                    </TD>
                    <TD className="text-end">
                      {s.overpayment && s.overpayment > 0 ? (
                        <span className="text-emerald-700 dark:text-emerald-400">
                          لنا رصيد {formatCurrency(s.overpayment, settings.currency)}
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
                      {s.status === "paid" ? (
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
                          onClick={() => navigate(`/purchases/${s.id}`)}
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
                        {canDeletePurchase && (
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
          const ok = deletePurchaseInvoice(toDelete.id);
          if (ok) toast.success("تم حذف الفاتورة");
          else toast.error("تعذر الحذف", "لا يمكن حذف الفاتورة");
          setToDelete(null);
        }}
        title="حذف فاتورة المشتريات"
        message={`هل أنت متأكد من حذف الفاتورة ${toDelete?.invoiceNumber ?? ""}؟ لا يمكن التراجع عن هذا الإجراء.`}
        confirmText="حذف"
        variant="danger"
      />

      {previewInv && (() => {
        const inv = previewInv;
        const linkedReturns = purchaseReturns.filter((r) => r.originalInvoiceId === inv.id);
        const supplier = suppliers.find((s) => s.id === inv.supplierId);
        const msg = renderInvoiceWhatsappTemplate(settings.whatsappInvoiceTemplate, {
          partyName: inv.supplierName,
          partyLabel: "المورد",
          invoiceType: "فاتورة مشتريات",
          invoiceNumber: inv.invoiceNumber,
          date: formatDate(inv.date),
          total: formatCurrency(inv.total, settings.currency),
          paid: formatCurrency(inv.amountPaid, settings.currency),
          remaining: formatCurrency(inv.remaining, settings.currency),
          status: inv.remaining > 0 ? "غير مسددة بالكامل" : "مسددة بالكامل",
          paymentMethod: "",
          priceType: "",
          driverName: "",
          phone: supplier?.phone ?? "",
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
                    onClick={() => window.open(buildWhatsappUrl(supplier?.phone, msg))}
                    className="flex items-center gap-2 bg-green-600 hover:bg-green-700 text-white text-sm font-medium px-4 h-9 rounded-lg"
                  >
                    <MessageCircle className="w-4 h-4" /> واتساب
                  </button>
                )}
                <button
                  onClick={async () => {
                    const result = await savePdfAppRoute(`/purchases/${inv.id}/print`);
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
                returns={linkedReturns.length > 0 ? linkedReturns : undefined}
                paymentLog={inv.paymentLog}
              />
            </div>
          </div>,
          document.body
        );
      })()}
    </>
  );
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
        <ShoppingBag className="w-5 h-5" />
      </div>
      <div>
        <div className="text-xs text-ink-muted">{label}</div>
        <div className="font-semibold text-ink text-lg">{value}</div>
      </div>
    </div>
  );
}
