import { useState } from "react";
import { createPortal } from "react-dom";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ArrowRight, Eye, FileDown, HandCoins, MessageCircle, Pencil, Printer, Trash2 } from "lucide-react";
import { PageHeader } from "../components/layout/AppLayout";
import { Card, CardBody, CardHeader } from "../components/ui/Card";
import { Button } from "../components/ui/Button";
import { Badge } from "../components/ui/Badge";
import { Table, TBody, TD, TH, THead, TR } from "../components/ui/Table";
import { useInvoicing } from "../store/InvoicingContext";
import { useCatalog } from "../store/CatalogContext";
import { useAuth } from "../store/AuthContext";
import { useSettings } from "../store/SettingsContext";
import { useToast } from "../components/ui/Toast";
import { formatCurrency, formatDate, PAYMENT_METHOD_LABELS } from "../lib/format";
import { ConfirmDialog, Dialog } from "../components/ui/Dialog";
import { Field, Input, Select, Textarea } from "../components/ui/Input";
import type { PaymentMethod } from "../types";
import { PurchaseReturnDialog } from "../features/returns/PurchaseReturnDialog";
import { savePdfAppRoute } from "../lib/print";
import { usePrintPreviewMode } from "../lib/usePrintPreviewMode";
import { hasPermission } from "../lib/permissions";
import { InvoicePrintLayout } from "../features/invoices/InvoicePrintLayout";
import { buildWhatsappUrl, renderInvoiceWhatsappTemplate } from "../lib/whatsappTemplate";
import { useFeatures } from "../lib/useFeatures";

export function PurchaseInvoiceDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const { purchaseInvoices, purchaseReturns, recordPurchasePayment, deletePurchaseInvoice } = useInvoicing();
  const { suppliers } = useCatalog();
  const { currentUser } = useAuth();
  const { settings } = useSettings();
  const { isEnabled } = useFeatures();
  const whatsappEnabled = isEnabled("whatsappIntegration");
  const expiryTrackingEnabled = isEnabled("expiryTracking");
  const inv = purchaseInvoices.find((s) => s.id === id);
  const canEditPurchase = hasPermission(currentUser, "purchaseInvoices", "edit");
  const canPayPurchase = hasPermission(currentUser, "purchaseInvoices", "pay");
  const canDeletePurchase = hasPermission(currentUser, "purchaseInvoices", "delete");
  const canAddReturn = hasPermission(currentUser, "returns", "add");
  const [payOpen, setPayOpen] = useState(false);
  const [payAmount, setPayAmount] = useState(0);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("cash");
  const [payNotes, setPayNotes] = useState("");
  const [delOpen, setDelOpen] = useState(false);
  const [returnOpen, setReturnOpen] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  usePrintPreviewMode(previewOpen);

  if (!inv) {
    return (
      <Card>
        <CardBody>
          <div className="text-center py-8">
            <div className="text-ink font-medium">الفاتورة غير موجودة</div>
            <Button className="mt-4" onClick={() => navigate("/purchases")}>
              العودة للقائمة
            </Button>
          </div>
        </CardBody>
      </Card>
    );
  }

  const supplier = suppliers.find((s) => s.id === inv.supplierId);
  const linkedReturns = purchaseReturns.filter((r) => r.originalInvoiceId === inv.id);
  // inv.total holds the NET (after returns). Reconstruct the original order total.
  const returnsTotal = linkedReturns.reduce((sum, r) => sum + r.total, 0);
  const originalTotal = inv.total + returnsTotal;
  const canCreateReturn = canAddReturn && inv.lines.some((line) => line.quantity > 0);
  const whatsappMessage = renderInvoiceWhatsappTemplate(settings.whatsappInvoiceTemplate, {
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

  return (
    <>
      <PageHeader
        title={`فاتورة مشتريات ${inv.invoiceNumber}`}
        description={`${inv.supplierName} • ${formatDate(inv.date)}`}
        actions={
          <>
            <Button variant="outline" onClick={() => navigate("/purchases")}>
              <ArrowRight className="w-4 h-4" />
              رجوع
            </Button>
            <Button variant="outline" onClick={() => setPreviewOpen(true)}>
              <Eye className="w-4 h-4" /> معاينة
            </Button>
            {whatsappEnabled && supplier?.phone ? (
              <Button
                variant="outline"
                onClick={() => {
                  window.open(buildWhatsappUrl(supplier.phone, whatsappMessage), "_blank");
                }}
              >
                <MessageCircle className="w-4 h-4" /> واتساب
              </Button>
            ) : null}
            {canEditPurchase ? (
              <Link to={`/purchases/${inv.id}/edit`}>
                <Button variant="outline">
                  <Pencil className="w-4 h-4" /> تعديل
                </Button>
              </Link>
            ) : null}
            {inv.remaining > 0 && canPayPurchase ? (
              <Button onClick={() => { setPayAmount(inv.remaining); setPayOpen(true); }}>
                <HandCoins className="w-4 h-4" /> تسجيل دفعة
              </Button>
            ) : null}
            {canCreateReturn ? (
              <Button variant="outline" onClick={() => setReturnOpen(true)}>
                <ArrowRight className="w-4 h-4" /> إنشاء مرتجع
              </Button>
            ) : null}
            {canDeletePurchase ? (
              <Button variant="danger" onClick={() => setDelOpen(true)}>
                <Trash2 className="w-4 h-4" /> حذف
              </Button>
            ) : null}
          </>
        }
      />

      <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
        {returnsTotal > 0 ? (
          <>
            <Stat label="إجمالي الفاتورة" value={formatCurrency(originalTotal, settings.currency)} />
            <Stat label="الإجمالي بعد المرتجعات" value={formatCurrency(inv.total, settings.currency)} tone="amber" />
          </>
        ) : (
          <Stat label="الإجمالي" value={formatCurrency(inv.total, settings.currency)} />
        )}
        <Stat label="المدفوع" value={formatCurrency(inv.amountPaid, settings.currency)} tone="green" />
        <Stat label="المتبقي" value={formatCurrency(inv.remaining, settings.currency)} tone={inv.remaining > 0 ? "amber" : "slate"} />
        {inv.overpayment && inv.overpayment > 0 ? (
          <Stat label="رصيد دائن لدى المورد" value={formatCurrency(inv.overpayment, settings.currency)} tone="green" />
        ) : null}
        <Stat label="الحالة" value={inv.status === "paid" ? "مسددة" : inv.status === "partial" ? "جزئي" : "غير مسددة"} tone={inv.status === "paid" ? "green" : inv.status === "partial" ? "amber" : "red"} />
      </div>

      <Card>
        <CardHeader title="تفاصيل المورد والفاتورة" />
        <CardBody className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Info label="المورد">{inv.supplierName}</Info>
          <Info label="هاتف المورد">{supplier?.phone ?? "—"}</Info>
          <Info label="عدد البنود">{inv.lines.length}</Info>
          <Info label="الحالة">
            <Badge
              tone={inv.status === "paid" ? "green" : inv.status === "partial" ? "amber" : "red"}
            >
              {inv.status === "paid" ? "مسدد" : inv.status === "partial" ? "جزئي" : "غير مسدد"}
            </Badge>
          </Info>
          {inv.notes ? (
            <Info label="ملاحظات" className="col-span-2 md:col-span-4">
              {inv.notes}
            </Info>
          ) : null}
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="بنود الفاتورة" />
        <CardBody>
          <Table>
            <THead>
              <TR>
                <TH className="w-10">#</TH>
                <TH>المنتج</TH>
                <TH>الوحدة</TH>
                <TH className="text-end">الكمية</TH>
                <TH className="text-end">السعر</TH>
                {expiryTrackingEnabled && <TH>الصلاحية</TH>}
                <TH className="text-end">الإجمالي</TH>
              </TR>
            </THead>
            <TBody>
              {inv.lines.map((l, idx) => (
                <TR key={l.id}>
                  <TD>{idx + 1}</TD>
                  <TD className="font-medium text-ink">{l.productName}</TD>
                  <TD>{l.unit}</TD>
                  <TD className="text-end">{l.quantity}</TD>
                  <TD className="text-end">{formatCurrency(l.price, settings.currency)}</TD>
                  {expiryTrackingEnabled && (
                    <TD className="text-xs text-ink-muted">{l.expiryDate ? formatDate(l.expiryDate) : "—"}</TD>
                  )}
                  <TD className="text-end font-medium">
                    {formatCurrency(l.subtotal, settings.currency)}
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </CardBody>
      </Card>

      {linkedReturns.length > 0 ? (
        <Card>
          <CardHeader title="المرتجعات المرتبطة بهذه الفاتورة" />
          <CardBody>
            <Table>
              <THead>
                <TR>
                  <TH>رقم المرتجع</TH>
                  <TH>التاريخ</TH>
                  <TH>الأصناف</TH>
                  <TH className="text-end">قيمة المرتجع</TH>
                </TR>
              </THead>
              <TBody>
                {linkedReturns.map((r) => (
                  <TR key={r.id}>
                    <TD className="font-mono text-xs text-ink-muted">{r.returnNumber}</TD>
                    <TD>{formatDate(r.date)}</TD>
                    <TD>
                      <ul className="space-y-0.5">
                        {r.lines.map((l) => (
                          <li key={l.id} className="text-xs text-ink-muted">
                            {l.productName} × {l.quantity} {l.unit}
                          </li>
                        ))}
                      </ul>
                    </TD>
                    <TD className="text-end font-semibold text-rose-700 dark:text-rose-400">
                      {formatCurrency(r.total, settings.currency)}
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </CardBody>
        </Card>
      ) : null}

      {inv.paymentLog && inv.paymentLog.length > 0 ? (
        <Card>
          <CardHeader title="سجل سداد الدفعات" />
          <CardBody>
            <Table>
              <THead>
                <TR>
                  <TH className="w-10">#</TH>
                  <TH>التاريخ</TH>
                  <TH>وسيلة الدفع</TH>
                  <TH className="text-end">المبلغ</TH>
                  <TH>ملاحظات</TH>
                </TR>
              </THead>
              <TBody>
                {inv.paymentLog.map((entry, idx) => (
                  <TR key={entry.id}>
                    <TD>{idx + 1}</TD>
                    <TD>{formatDate(entry.date)}</TD>
                    <TD>{PAYMENT_METHOD_LABELS[entry.paymentMethod] ?? entry.paymentMethod}</TD>
                    <TD className="text-end font-semibold text-emerald-700 dark:text-emerald-400">
                      {formatCurrency(entry.amount, settings.currency)}
                    </TD>
                    <TD className="text-xs text-ink-muted">{entry.notes ?? "—"}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </CardBody>
        </Card>
      ) : null}

      <Dialog
        open={payOpen}
        onClose={() => setPayOpen(false)}
        title="تسجيل دفعة للمورد"
        subtitle={`المتبقي: ${formatCurrency(inv.remaining, settings.currency)}`}
        footer={
          <>
            <Button variant="outline" onClick={() => setPayOpen(false)}>إلغاء</Button>
            <Button
              onClick={() => {
                if (payAmount <= 0 || payAmount > inv.remaining) {
                  toast.error("المبلغ غير صحيح");
                  return;
                }
                recordPurchasePayment(inv.id, payAmount, paymentMethod, payNotes);
                toast.success("تم تسجيل الدفعة");
                setPayOpen(false);
                setPayAmount(0);
                setPaymentMethod("cash");
                setPayNotes("");
              }}
            >
              تسجيل
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <Field label="المبلغ" required>
            <Input
              type="number"
              min={0.01}
              max={inv.remaining}
              step="0.01"
              value={payAmount}
              onChange={(e) => setPayAmount(Number(e.target.value))}
            />
          </Field>
          <Field label="وسيلة الدفع">
            <Select value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value as PaymentMethod)}>
              {Object.entries(PAYMENT_METHOD_LABELS).filter(([k]) => k !== "credit").map(([k, v]) => (
                <option key={k} value={k}>{v}</option>
              ))}
            </Select>
          </Field>
          <Field label="ملاحظات (اختياري)">
            <Textarea
              rows={2}
              value={payNotes}
              onChange={(e) => setPayNotes(e.target.value)}
              placeholder="مثل: تحويل بنكي رقم ..."
            />
          </Field>
        </div>
      </Dialog>

      <ConfirmDialog
        open={delOpen}
        onClose={() => setDelOpen(false)}
        onConfirm={() => {
          const ok = deletePurchaseInvoice(inv.id);
          if (ok) {
            toast.success("تم الحذف", "وتم عكس الكميات من المخزون");
            navigate("/purchases");
          } else toast.error("تعذر الحذف");
        }}
        title="حذف نهائي"
        message="سيتم حذف الفاتورة وعكس تأثيرها على المخزون. متابعة؟"
        variant="danger"
        confirmText="حذف نهائي"
      />

      {returnOpen && (
        <PurchaseReturnDialog
          open={returnOpen}
          onClose={() => setReturnOpen(false)}
          invoice={inv}
        />
      )}

      {/* ── Invoice Preview Modal ── */}
      {previewOpen && createPortal(
        <div
          className="fixed inset-0 z-50 bg-black/60 flex flex-col items-center overflow-y-auto py-8 px-4 print-preview-backdrop"
          onClick={(e) => { if (e.target === e.currentTarget) setPreviewOpen(false); }}
        >
          <div className="w-full max-w-[820px] mb-4 flex items-center justify-between no-print">
            <div className="flex gap-2">
              <button
                onClick={() => window.print()}
                className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium px-4 h-9 rounded-lg"
              >
                <Printer className="w-4 h-4" /> طباعة
              </button>
              {whatsappEnabled && (
                <button
                  onClick={() => {
                    window.open(buildWhatsappUrl(supplier?.phone, whatsappMessage));
                  }}
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
            <button
              onClick={() => setPreviewOpen(false)}
              className="text-white/80 hover:text-white text-sm flex items-center gap-1.5 bg-white/10 hover:bg-white/20 px-3 h-9 rounded-lg"
            >
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
      )}
    </>
  );
}

function Info({
  label,
  children,
  className,
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`bg-surface-muted border border-line rounded-lg p-3 ${className ?? ""}`}>
      <div className="text-[11px] text-ink-faint">{label}</div>
      <div className="text-sm text-ink mt-1">{children}</div>
    </div>
  );
}

function Stat({
  label,
  value,
  tone = "slate",
}: {
  label: string;
  value: string;
  tone?: "slate" | "green" | "amber" | "red";
}) {
  const colors: Record<string, string> = {
    slate: "text-ink",
    green: "text-emerald-700 dark:text-emerald-400",
    amber: "text-amber-700 dark:text-amber-400",
    red: "text-rose-700 dark:text-rose-400",
  };
  return (
    <div className="bg-surface rounded-xl border border-line p-4">
      <div className="text-xs text-ink-muted">{label}</div>
      <div className={`text-lg font-semibold mt-1 ${colors[tone]}`}>{value}</div>
    </div>
  );
}
