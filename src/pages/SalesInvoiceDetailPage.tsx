import { useState } from "react";
import { createPortal } from "react-dom";
import { useNavigate, useParams } from "react-router-dom";
import { ArrowRight, Ban, Eye, FileDown, HandCoins, MessageCircle, Pencil, Printer, Trash2 } from "lucide-react";
import { PageHeader } from "../components/layout/AppLayout";
import { Card, CardBody, CardHeader } from "../components/ui/Card";
import { Button } from "../components/ui/Button";
import { Badge } from "../components/ui/Badge";
import { Table, TBody, TD, TH, THead, TR } from "../components/ui/Table";
import { useInvoicing } from "../store/InvoicingContext";
import { useCatalog } from "../store/CatalogContext";
import { useAuth } from "../store/AuthContext";
import { useSettings } from "../store/SettingsContext";
import { useReporting } from "../store/ReportingContext";
import { useToast } from "../components/ui/Toast";
import { formatCurrency, formatDate, PAYMENT_METHOD_LABELS, resolvePaymentLabel } from "../lib/format";
import { ConfirmDialog, Dialog } from "../components/ui/Dialog";
import { Field, Input, Select, Textarea } from "../components/ui/Input";
import type { PaymentMethod } from "../types";
import { SalesReturnDialog } from "../features/returns/SalesReturnDialog";
import { savePdfAppRoute } from "../lib/print";
import { usePrintPreviewMode } from "../lib/usePrintPreviewMode";
import { hasPermission } from "../lib/permissions";
import { InvoicePrintLayout } from "../features/invoices/InvoicePrintLayout";
import { buildWhatsappUrl, renderInvoiceWhatsappTemplate } from "../lib/whatsappTemplate";
import { useFeatures } from "../lib/useFeatures";
import { resolveSalesLinePriceType, salesInvoicePriceTypeLabel, salesPriceTypeLabel } from "../lib/salesPrice";

export function SalesInvoiceDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const { salesInvoices, salesReturns, recordSalesReceipt, cancelSalesInvoice, deleteSalesInvoice } = useInvoicing();
  const { customers } = useCatalog();
  const { currentUser } = useAuth();
  const { settings } = useSettings();
  const { customerBalance } = useReporting();
  const { isEnabled } = useFeatures();
  const whatsappEnabled = isEnabled("whatsappIntegration");
  const multiSalePricesEnabled = isEnabled("multiSalePrices");
  const inv = salesInvoices.find((s) => s.id === id);
  const canEditSales = hasPermission(currentUser, "salesInvoices", "edit");
  const canReceiveSales = hasPermission(currentUser, "salesInvoices", "receive");
  const canCancelSales = hasPermission(currentUser, "salesInvoices", "cancel");
  const canDeleteSales = hasPermission(currentUser, "salesInvoices", "delete");
  const canAddReturn = hasPermission(currentUser, "returns", "add");
  const [payOpen, setPayOpen] = useState(false);
  const [payAmount, setPayAmount] = useState(0);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("cash");
  const [payNotes, setPayNotes] = useState("");
  const [cancelOpen, setCancelOpen] = useState(false);
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
            <Button className="mt-4" onClick={() => navigate("/sales")}>
              العودة للقائمة
            </Button>
          </div>
        </CardBody>
      </Card>
    );
  }

  const customer = customers.find((c) => c.id === inv.customerId);
  const totalCustomerBalance = customerBalance(inv.customerId);
  const totalCollected = inv.amountReceived + (inv.overpayment ?? 0);
  const linkedReturns = salesReturns.filter((r) => r.originalInvoiceId === inv.id);
  const totalReturns = linkedReturns.reduce((a, r) => a + r.total, 0);
  const cashReturnTotal = linkedReturns.filter((r) => r.refundCash).reduce((a, r) => a + r.total, 0);
  const creditReturnTotal = linkedReturns.filter((r) => !r.refundCash).reduce((a, r) => a + r.total, 0);
  const canCreateReturn = canAddReturn && !inv.cancelled && totalReturns < inv.total;
  const priceTypeLabel = salesInvoicePriceTypeLabel(inv);
  const paymentDisplay = salesPaymentDisplay(inv);
  const grossBeforeDiscount = inv.discount && inv.discount > 0 ? inv.total + inv.discount : inv.total;
  const dueDatePassed = (() => {
    if (!inv.paymentDueDate || inv.remaining <= 0) return false;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const due = new Date(inv.paymentDueDate);
    due.setHours(0, 0, 0, 0);
    return due.getTime() < today.getTime();
  })();
  const whatsappMessage = renderInvoiceWhatsappTemplate(settings.whatsappInvoiceTemplate, {
    partyName: inv.customerName,
    partyLabel: "العميل",
    invoiceType: "فاتورة مبيعات",
    invoiceNumber: inv.invoiceNumber,
    date: formatDate(inv.date),
    total: formatCurrency(inv.total, settings.currency),
    paid: formatCurrency(totalCollected, settings.currency),
    remaining: formatCurrency(inv.remaining, settings.currency),
    status: inv.remaining > 0 ? "غير مسددة بالكامل" : "مسددة بالكامل",
    paymentMethod: paymentDisplay,
    priceType: priceTypeLabel,
    driverName: inv.driverName ?? "",
    phone: customer?.phone ?? "",
    companyName: settings.companyNameAr || settings.companyName,
  });

  return (
    <>
      <PageHeader
        title={`فاتورة مبيعات ${inv.invoiceNumber}`}
        description={`${inv.customerName} • ${formatDate(inv.date)}`}
        actions={
          <>
            <Button variant="outline" onClick={() => navigate("/sales")}>
              <ArrowRight className="w-4 h-4" />
              رجوع
            </Button>
            {!inv.cancelled && canEditSales ? (
              <Button variant="outline" onClick={() => navigate(`/sales/${inv.id}/edit`)}>
                <Pencil className="w-4 h-4" /> تعديل
              </Button>
            ) : null}
            <Button variant="outline" onClick={() => setPreviewOpen(true)}>
              <Eye className="w-4 h-4" /> معاينة
            </Button>
            {whatsappEnabled && customer?.phone ? (
              <Button
                variant="outline"
                onClick={() => {
                  window.open(buildWhatsappUrl(customer.phone, whatsappMessage), "_blank");
                }}
              >
                <MessageCircle className="w-4 h-4" /> واتساب
              </Button>
            ) : null}
            {!inv.cancelled && inv.remaining > 0 && canReceiveSales ? (
              <Button onClick={() => { setPayAmount(inv.remaining); setPayOpen(true); }}>
                <HandCoins className="w-4 h-4" /> تسجيل دفعة
              </Button>
            ) : null}
            {!inv.cancelled && (canAddReturn || canCancelSales) ? (
              <>
                {canCreateReturn ? (
                  <Button variant="outline" onClick={() => setReturnOpen(true)}>
                    <ArrowRight className="w-4 h-4" /> إنشاء مرتجع
                  </Button>
                ) : null}
                {canCancelSales ? (
                  <Button variant="outline" onClick={() => setCancelOpen(true)}>
                    <Ban className="w-4 h-4" /> إلغاء
                  </Button>
                ) : null}
              </>
            ) : null}
            {canDeleteSales ? (
              <Button variant="danger" onClick={() => setDelOpen(true)}>
                <Trash2 className="w-4 h-4" /> حذف
              </Button>
            ) : null}
          </>
        }
      />

      {inv.cancelled ? (
        <div className="bg-surface-muted border border-line rounded-lg p-3 text-sm text-ink-muted">
          هذه الفاتورة ملغاة — تم إرجاع الكميات إلى المخزون.
        </div>
      ) : null}

      {/* ── بوكس المبالغ ── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* المبالغ التفصيلية */}
        <div className="lg:col-span-2 bg-surface border border-line rounded-xl overflow-hidden">
          <div className="bg-surface-muted border-b border-line px-4 py-2.5 flex items-center justify-between">
            <span className="text-sm font-semibold text-ink">تفاصيل المبالغ</span>
            <Badge tone={inv.cancelled ? "slate" : inv.status === "paid" && (inv.overpayment ?? 0) > 0 ? "blue" : inv.status === "paid" ? "emerald" : inv.status === "partial" ? "amber" : "red"}>
              {inv.cancelled ? "ملغاة" : inv.status === "paid" && (inv.overpayment ?? 0) > 0 ? "مسددة بزيادة" : inv.status === "paid" ? "مسددة" : inv.status === "partial" ? "جزئي" : "غير مسددة"}
            </Badge>
          </div>
          <div className="divide-y divide-line">
            <AmountRow label="إجمالي البنود" value={formatCurrency(grossBeforeDiscount, settings.currency)} />
            {(inv.discount ?? 0) > 0 && (
              <AmountRow label="خصم" value={`- ${formatCurrency(inv.discount!, settings.currency)}`} valueClass="text-emerald-700 dark:text-emerald-400" />
            )}
            {(inv.discount ?? 0) > 0 && (
              <AmountRow label="مستحق (بعد الخصم)" value={formatCurrency(inv.total, settings.currency)} bold />
            )}
            {creditReturnTotal > 0 && (
              <AmountRow label="خصم مرتجع (معفو من الرصيد)" value={`- ${formatCurrency(creditReturnTotal, settings.currency)}`} valueClass="text-rose-600 dark:text-rose-400" />
            )}
            {cashReturnTotal > 0 && (
              <AmountRow label="مرتجع نقدي / مسترد كاش" value={`- ${formatCurrency(cashReturnTotal, settings.currency)}`} valueClass="text-rose-600 dark:text-rose-400" />
            )}
            {/* دفعات من سجل الدفع */}
            {(inv.paymentLog ?? []).length > 0 ? (
              (inv.paymentLog ?? []).map((entry, idx) => (
                <AmountRow
                  key={entry.id}
                  label={`دفعة ${idx + 1} — ${formatDate(entry.date)} — ${resolvePaymentLabel(entry.paymentMethod, entry.notes)}`}
                  value={`+ ${formatCurrency(entry.amount, settings.currency)}`}
                  valueClass="text-emerald-700 dark:text-emerald-400"
                />
              ))
            ) : inv.amountReceived > 0 ? (
              <AmountRow label="دفعة 1 — عند الإنشاء" value={`+ ${formatCurrency(inv.amountReceived, settings.currency)}`} valueClass="text-emerald-700 dark:text-emerald-400" />
            ) : null}
            {(inv.overpayment ?? 0) > 0 && (
              <AmountRow label="رصيد للعميل من هذه الفاتورة" value={`له ${formatCurrency(inv.overpayment!, settings.currency)}`} valueClass="text-blue-700 dark:text-blue-400" />
            )}
            <AmountRow
              label="إجمالي المسدّد"
              value={formatCurrency(totalCollected, settings.currency)}
              valueClass="text-emerald-700 dark:text-emerald-400"
              bold
            />
            <div className={`flex items-center justify-between px-4 py-3 ${inv.remaining > 0 ? "bg-amber-50 dark:bg-amber-500/10" : "bg-emerald-50 dark:bg-emerald-500/10"}`}>
              <span className={`text-base font-bold ${inv.remaining > 0 ? "text-amber-800 dark:text-amber-300" : "text-emerald-800 dark:text-emerald-300"}`}>
                المتبقي على العميل
              </span>
              <span className={`text-xl font-bold ${inv.remaining > 0 ? "text-amber-700 dark:text-amber-400" : "text-emerald-700 dark:text-emerald-400"}`}>
                {formatCurrency(inv.remaining, settings.currency)}
              </span>
            </div>
          </div>
        </div>

        {/* معلومات الفاتورة والعميل */}
        <div className="space-y-3">
          <div className="bg-surface border border-line rounded-xl p-4 space-y-2">
            <div className="text-xs font-semibold text-ink-muted uppercase tracking-wide mb-3">معلومات الفاتورة</div>
            {multiSalePricesEnabled && <InfoRow label="نوع السعر" value={priceTypeLabel} />}
            {inv.vehicleLabel && <InfoRow label="سيارة العميل" value={inv.vehicleLabel} />}
            {inv.branchName && <InfoRow label="الفرع" value={inv.branchName} />}
            {inv.priceTierName && <InfoRow label="شريحة التسعير" value={inv.priceTierName} />}
            {inv.paymentDueDate && (
              <InfoRow label="تاريخ الاستحقاق" value={formatDate(inv.paymentDueDate)} valueClass={dueDatePassed ? "text-rose-600 dark:text-rose-400 font-semibold" : ""} />
            )}
            <InfoRow label="طريقة الدفع" value={paymentDisplay} />
          </div>
          <div className={`bg-surface border rounded-xl p-4 ${totalCustomerBalance > 0 ? "border-rose-200 dark:border-rose-500/30" : totalCustomerBalance < 0 ? "border-blue-200 dark:border-blue-500/30" : "border-line"}`}>
            <div className="text-xs font-semibold text-ink-muted mb-1">إجمالي رصيد {inv.customerName}</div>
            <div className={`text-base font-bold ${totalCustomerBalance > 0 ? "text-rose-700 dark:text-rose-400" : totalCustomerBalance < 0 ? "text-blue-700 dark:text-blue-400" : "text-emerald-700 dark:text-emerald-400"}`}>
              {totalCustomerBalance > 0
                ? `مديون: ${formatCurrency(totalCustomerBalance, settings.currency)}`
                : totalCustomerBalance < 0
                  ? `رصيد دائن: ${formatCurrency(-totalCustomerBalance, settings.currency)}`
                  : "لا يوجد مستحق"}
            </div>
          </div>
        </div>
      </div>

      {(inv.overpayment ?? 0) > 0 && !inv.cancelled && (
        <div className="bg-blue-50 dark:bg-blue-500/10 border border-blue-200 dark:border-blue-500/30 rounded-lg p-3 text-sm text-blue-900 dark:text-blue-300">
          <span className="font-semibold">رصيد دائن: </span>
          للعميل <strong>{inv.customerName}</strong> رصيد دائن من هذه الفاتورة بقيمة{" "}
          <strong>{formatCurrency(inv.overpayment!, settings.currency)}</strong> — يمكن استخدامه في فواتير قادمة أو استرداده كاش.
        </div>
      )}

      <Card>
        <CardHeader title="تفاصيل العميل والفاتورة" />
        <CardBody className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Info label="العميل">{inv.customerName}</Info>
          <Info label="هاتف العميل">{customer?.phone ?? "—"}</Info>
          <Info label="السائق">{inv.driverName ?? "—"}</Info>
          <Info label="سيارة العميل">{inv.vehicleLabel ?? "غير مرتبطة"}</Info>
          <Info label="الفرع">{inv.branchName ?? "الفرع الرئيسي"}</Info>
          <Info label="شريحة التسعير">{inv.priceTierName ?? "السعر الافتراضي"}</Info>
          <Info label="طريقة الدفع">
            <Badge tone={inv.paymentType === "cash" ? "emerald" : "indigo"}>
              {paymentDisplay}
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
                {multiSalePricesEnabled && <TH>نوع السعر</TH>}
                <TH>الوحدة</TH>
                <TH className="text-end">الكمية</TH>
                <TH className="text-end">السعر</TH>
                <TH className="text-end">الإجمالي</TH>
              </TR>
            </THead>
            <TBody>
              {inv.lines.map((l, idx) => (
                <TR key={l.id}>
                  <TD>{idx + 1}</TD>
                  <TD className="font-medium text-ink">{l.productName}</TD>
                  {multiSalePricesEnabled && (
                    <TD>
                      {(() => {
                        const linePriceType = resolveSalesLinePriceType(l, inv.priceType);
                        return (
                          <Badge tone={linePriceType === "retail" ? "blue" : "slate"}>
                            {salesPriceTypeLabel(linePriceType)}
                          </Badge>
                        );
                      })()}
                    </TD>
                  )}
                  <TD>{l.unit}</TD>
                  <TD className="text-end">{l.quantity}</TD>
                  <TD className="text-end">{formatCurrency(l.price, settings.currency)}</TD>
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
                  <TH>طريقة الرد</TH>
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
                    <TD>
                      <Badge tone={r.refundCash ? "emerald" : "indigo"}>
                        {r.refundCash ? "رد كاش" : "خصم من الرصيد"}
                      </Badge>
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
            <div className="mt-3 flex justify-end">
              <div className="text-sm font-semibold text-rose-700 dark:text-rose-400">
                إجمالي المرتجعات: {formatCurrency(linkedReturns.reduce((a, r) => a + r.total, 0), settings.currency)}
              </div>
            </div>
          </CardBody>
        </Card>
      ) : null}

      {inv.paymentLog && inv.paymentLog.length > 0 ? (
        <Card>
          <CardHeader title="سجل الدفع" />
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
                    <TD>{resolvePaymentLabel(entry.paymentMethod, entry.notes)}</TD>
                    <TD className="text-end font-semibold text-emerald-700 dark:text-emerald-400">{formatCurrency(entry.amount, settings.currency)}</TD>
                    <TD className="text-xs text-ink-muted">{entry.notes && entry.notes !== "رصيد دائن مستخدم" ? entry.notes : "—"}</TD>
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
        title="تسجيل دفعة"
        subtitle={`المتبقي على العميل: ${formatCurrency(inv.remaining, settings.currency)} — الدفع الزائد يُسجَّل رصيداً للعميل`}
        footer={
          <>
            <Button variant="outline" onClick={() => setPayOpen(false)}>إلغاء</Button>
            <Button
              onClick={() => {
                if (payAmount <= 0) {
                  toast.error("المبلغ يجب أن يكون أكبر من صفر");
                  return;
                }
                recordSalesReceipt(inv.id, payAmount, paymentMethod, payNotes);
                const msg = payAmount > inv.remaining
                  ? `تم التسجيل — رصيد دائن: ${formatCurrency(payAmount - inv.remaining, settings.currency)}`
                  : "تم تسجيل الدفعة";
                toast.success(msg);
                setPayOpen(false);
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
              step="0.01"
              value={payAmount}
              onChange={(e) => setPayAmount(Number(e.target.value))}
            />
          </Field>
          <Field label="وسيلة الدفع">
            <Select value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value as PaymentMethod)}>
              {Object.entries(PAYMENT_METHOD_LABELS).filter(([k]) => k !== "credit" && k !== "other").map(([k, v]) => (
                <option key={k} value={k}>{v}</option>
              ))}
            </Select>
          </Field>
          <Field label="ملاحظات (اختياري)">
            <Textarea rows={2} value={payNotes} onChange={(e) => setPayNotes(e.target.value)} placeholder="مثل: تحويل بنكي رقم ..." />
          </Field>
        </div>
      </Dialog>

      {totalCollected > 0 ? (
        <Dialog
          open={cancelOpen}
          onClose={() => setCancelOpen(false)}
          title="إلغاء الفاتورة"
          subtitle={`المُحصَّل: ${formatCurrency(totalCollected, settings.currency)}`}
          width="sm"
          footer={
            <>
              <Button variant="outline" onClick={() => setCancelOpen(false)}>
                تراجع
              </Button>
              <Button
                variant="outline"
                onClick={() => {
                  cancelSalesInvoice(inv.id, "credit");
                  setCancelOpen(false);
                  toast.success("تم إلغاء الفاتورة", "تم تحويل المبلغ رصيداً دائناً للعميل");
                }}
              >
                تحويل رصيد دائن
              </Button>
              <Button
                variant="danger"
                onClick={() => {
                  cancelSalesInvoice(inv.id, "cash");
                  setCancelOpen(false);
                  toast.success("تم إلغاء الفاتورة", "تمت إعادة الكميات للمخزون وردّ الكاش");
                }}
              >
                ردّ كاش
              </Button>
            </>
          }
        >
          <div className="text-sm text-ink-muted mb-3">
            هذه الفاتورة عليها مبلغ مُحصَّل. كيف تريد معالجة المبلغ؟
          </div>
          <div className="space-y-2">
            <div className="p-3 rounded-lg border border-line text-sm">
              <div className="font-medium text-ink">ردّ كاش</div>
              <div className="text-ink-muted text-xs mt-0.5">يُخصم المبلغ من الخزنة فوراً ويُسجَّل قيد ردّ كاش</div>
            </div>
            <div className="p-3 rounded-lg border border-line text-sm">
              <div className="font-medium text-ink">تحويل رصيد دائن</div>
              <div className="text-ink-muted text-xs mt-0.5">يبقى المبلغ بالخزنة كرصيد للعميل يُستخدم في الفواتير القادمة</div>
            </div>
          </div>
        </Dialog>
      ) : (
        <ConfirmDialog
          open={cancelOpen}
          onClose={() => setCancelOpen(false)}
          onConfirm={() => {
            cancelSalesInvoice(inv.id);
            setCancelOpen(false);
            toast.success("تم إلغاء الفاتورة", "تمت إعادة الكميات للمخزون");
          }}
          title="إلغاء الفاتورة"
          message="هل أنت متأكد من إلغاء الفاتورة؟ ستُعاد الكميات إلى المخزون."
          variant="danger"
          confirmText="تأكيد الإلغاء"
        />
      )}

      <ConfirmDialog
        open={delOpen}
        onClose={() => setDelOpen(false)}
        onConfirm={() => {
          const ok = deleteSalesInvoice(inv.id);
          if (ok) {
            toast.success("تم الحذف");
            navigate("/sales");
          } else toast.error("تعذر الحذف", "الفواتير المرتبطة بمرتجعات لا يمكن حذفها");
        }}
        title="حذف نهائي"
        message="هذا الإجراء لا يمكن التراجع عنه. متابعة؟"
        variant="danger"
        confirmText="حذف نهائي"
      />

      {returnOpen && (
        <SalesReturnDialog
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
                    window.open(buildWhatsappUrl(customer?.phone, whatsappMessage));
                  }}
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
            <button
              onClick={() => setPreviewOpen(false)}
              className="text-white/80 hover:text-white text-sm flex items-center gap-1.5 bg-white/10 hover:bg-white/20 px-3 h-9 rounded-lg"
            >
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
              paymentLabel={paymentDisplay}
              priceTypeLabel={priceTypeLabel}
              returns={linkedReturns.length > 0 ? linkedReturns : undefined}
              paymentDueDate={inv.paymentDueDate}
              customerBalance={totalCustomerBalance}
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
      )}
    </>
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

function AmountRow({ label, value, bold, valueClass }: { label: string; value: string; bold?: boolean; valueClass?: string }) {
  return (
    <div className="flex items-center justify-between px-4 py-2.5 gap-2">
      <span className={`text-sm ${bold ? "font-semibold text-ink" : "text-ink-muted"}`}>{label}</span>
      <span className={`text-sm font-mono ${bold ? "font-bold text-ink" : ""} ${valueClass ?? ""}`}>{value}</span>
    </div>
  );
}

function InfoRow({ label, value, valueClass }: { label: string; value: string; valueClass?: string }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-xs text-ink-muted">{label}</span>
      <span className={`text-sm font-medium text-ink ${valueClass ?? ""}`}>{value}</span>
    </div>
  );
}
