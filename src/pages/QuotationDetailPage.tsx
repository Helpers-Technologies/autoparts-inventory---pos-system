import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  ArrowRight,
  ArrowRightLeft,
  Building2,
  CarFront,
  MessageCircle,
  Printer,
  Tags,
  Trash2,
} from "lucide-react";
import { PageHeader } from "../components/layout/AppLayout";
import { Card, CardBody, CardHeader } from "../components/ui/Card";
import { Button } from "../components/ui/Button";
import { Badge } from "../components/ui/Badge";
import { Table, TBody, TD, TH, THead, TR } from "../components/ui/Table";
import { useInvoicing } from "../store/InvoicingContext";
import { useCatalog } from "../store/CatalogContext";
import { useSettings } from "../store/SettingsContext";
import { useAuth } from "../store/AuthContext";
import { useToast } from "../components/ui/Toast";
import { formatCurrency, formatDate } from "../lib/format";
import { ConfirmDialog, Dialog } from "../components/ui/Dialog";
import { Field, Input, Select } from "../components/ui/Input";
import type { SalesPaymentType } from "../types";
import { hasPermission } from "../lib/permissions";
import { printAppRoute } from "../lib/print";
import { todayISO } from "../lib/utils";
import { useFeatures } from "../lib/useFeatures";
import { aggregateSalesPriceType } from "../lib/salesPrice";
import { productVehicleFitmentStatus, useAutoPartsPro } from "../store/AutoPartsProContext";
import { useVehicleCatalog } from "../store/VehicleCatalogContext";

function nextInvoiceNumber(existing: string[]): string {
  const nums = existing
    .map((x) => parseInt(x.replace(/\D/g, ""), 10))
    .filter((n) => !Number.isNaN(n));
  const currentMax = nums.length ? Math.max(...nums) : 1000;
  const storedMax = parseInt(localStorage.getItem("seq_sales_invoice") || "0", 10);
  const absoluteMax = Math.max(currentMax, storedMax);
  return `INV-${absoluteMax + 1}`;
}

export function QuotationDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const { quotations, convertQuotation, deleteQuotation, salesInvoices } = useInvoicing();
  const { drivers, customers, products } = useCatalog();
  const pro = useAutoPartsPro();
  const vehicleCatalog = useVehicleCatalog();
  const { currentUser } = useAuth();
  const { settings } = useSettings();
  const { isEnabled } = useFeatures();
  const whatsappEnabled = isEnabled("whatsappIntegration");
  const creditSalesEnabled = isEnabled("creditSales");
  const driversEnabled = isEnabled("drivers");

  const quot = quotations.find((q) => q.id === id);
  const canAdd = hasPermission(currentUser, "salesInvoices", "add");
  const canDelete = hasPermission(currentUser, "salesInvoices", "delete");

  const [convertOpen, setConvertOpen] = useState(false);
  const [delOpen, setDelOpen] = useState(false);
  const [invoiceNumber, setInvoiceNumber] = useState(() =>
    nextInvoiceNumber(salesInvoices.map((s) => s.invoiceNumber))
  );
  const [invDate, setInvDate] = useState(() => todayISO());
  const [paymentType, setPaymentType] = useState<SalesPaymentType>("cash");
  const [amountReceived, setAmountReceived] = useState(0);
  const [paymentDueDate, setPaymentDueDate] = useState("");
  const [driverId, setDriverId] = useState("");

  if (!quot) {
    return (
      <Card>
        <CardBody>
          <div className="text-center py-8">
            <div className="text-ink font-medium">عرض السعر غير موجود</div>
            <Button className="mt-4" onClick={() => navigate("/quotations")}>
              العودة للقائمة
            </Button>
          </div>
        </CardBody>
      </Card>
    );
  }

  const linkedInvoice = quot.convertedInvoiceId
    ? salesInvoices.find((s) => s.id === quot.convertedInvoiceId)
    : undefined;
  const selectedVehicle = pro.customerVehicles.find((vehicle) => vehicle.id === quot.customerVehicleId);
  const selectedBranch = pro.branches.find((branch) => branch.id === quot.branchId);
  const isExpired = quot.status === "draft" && Boolean(quot.validUntil && quot.validUntil < todayISO());

  function branchStockShortages() {
    if (!quot?.branchId) return [];
    const requested = new Map<string, number>();
    for (const line of quot.lines) {
      const product = products.find((item) => item.id === line.productId);
      const quantity = line.isRetailUnit
        ? line.quantity
        : line.quantity * (product?.piecesPerUnit ?? 1);
      requested.set(line.productId, (requested.get(line.productId) ?? 0) + quantity);
    }
    return [...requested.entries()].flatMap(([productId, required]) => {
      const product = products.find((item) => item.id === productId);
      if (!product) return [{ name: productId, required, available: 0 }];
      const branchUnits = pro.branchQuantity(quot.branchId!, product.id);
      const available = product.piecesPerUnit ? branchUnits * product.piecesPerUnit : branchUnits;
      return required > available ? [{ name: product.name, required, available }] : [];
    });
  }

  function handleConvert() {
    if (!invoiceNumber.trim()) {
      toast.error("أدخل رقم الفاتورة");
      return;
    }
    if (paymentType === "account" && !creditSalesEnabled) {
      toast.error("ميزة البيع الآجل غير مفعّلة في ترخيصك");
      return;
    }
    if (isExpired) {
      toast.error("انتهت صلاحية عرض السعر", "عدّل تاريخ الصلاحية قبل تحويله إلى فاتورة.");
      return;
    }
    const shortages = branchStockShortages();
    if (shortages.length > 0) {
      toast.error(
        `رصيد ${selectedBranch?.name ?? quot!.branchName ?? "الفرع"} غير كافٍ`,
        shortages.map((item) => `${item.name}: متاح ${item.available} / مطلوب ${item.required}`).join(" • "),
      );
      return;
    }
    const driver = drivers.find((d) => d.id === driverId);
    try {
      const inv = convertQuotation(quot!.id, {
        invoiceNumber: invoiceNumber.trim(),
        date: invDate,
        paymentType,
        // The agreed tier is persisted per line, so conversion preserves the
        // correct retail/wholesale semantics without repricing the quotation.
        priceType: aggregateSalesPriceType(quot!.lines),
        amountReceived,
        paymentDueDate: paymentType === "account" && paymentDueDate ? paymentDueDate : undefined,
        driverId: driverId || undefined,
        driverName: driver?.name,
      });
      if (quot!.branchId) {
        pro.consumeBranchStock(quot!.branchId, quot!.lines.map((line) => {
          const product = products.find((item) => item.id === line.productId);
          return {
            productId: line.productId,
            quantity: line.isRetailUnit && product?.piecesPerUnit
              ? line.quantity / product.piecesPerUnit
              : line.quantity,
          };
        }));
      }
      const issuedNum = parseInt(inv.invoiceNumber.replace(/\D/g, ""), 10);
      if (!Number.isNaN(issuedNum)) {
        const storedMax = parseInt(localStorage.getItem("seq_sales_invoice") || "0", 10);
        localStorage.setItem("seq_sales_invoice", Math.max(storedMax, issuedNum).toString());
      }
      toast.success("تم تحويل العرض إلى فاتورة", `فاتورة رقم ${inv.invoiceNumber}`);
      setConvertOpen(false);
      navigate(`/sales/${inv.id}`);
    } catch (err) {
      // BUG-08: surface the store's stock-shortage detail instead of a generic message
      toast.error(
        "تعذر تحويل العرض",
        err instanceof Error && err.message.startsWith("المخزون") ? err.message : undefined
      );
    }
  }

  return (
    <>
      <PageHeader
        title={`عرض سعر ${quot.quotationNumber}`}
        description={`${quot.customerName}${quot.vehicleLabel ? ` • ${quot.vehicleLabel}` : ""} • ${formatDate(quot.date)}`}
        actions={
          <>
            <Button variant="outline" onClick={() => navigate("/quotations")}>
              <ArrowRight className="w-4 h-4" /> رجوع
            </Button>
            <Button
              variant="outline"
              onClick={async () => {
                const result = await printAppRoute(`/quotations/${quot.id}/print`);
                if (!result.ok && result.error !== "cancelled") {
                  toast.error("تعذر الطباعة");
                }
              }}
            >
              <Printer className="w-4 h-4" /> طباعة
            </Button>
            {(() => {
              const customer = customers.find((c) => c.id === quot.customerId);
              if (!whatsappEnabled || !customer?.phone) return null;
              return (
                <Button
                  variant="outline"
                  onClick={() => {
                    const phone = String(customer.phone ?? "").replace(/\D/g, "");
                    const normalized = phone.startsWith("0") ? `20${phone.slice(1)}` : phone;
                    const msg = [
                      `مرحباً ${quot.customerName}،`,
                      ``,
                      `نود تقديم عرض السعر رقم *${quot.quotationNumber}*:`,
                      `📅 التاريخ: ${formatDate(quot.date)}`,
                      quot.vehicleLabel ? `🚗 السيارة: ${quot.vehicleLabel}` : "",
                      quot.priceTierName ? `🏷️ شريحة السعر: ${quot.priceTierName}` : "",
                      quot.validUntil ? `⏳ صالح حتى: ${formatDate(quot.validUntil)}` : "",
                      `💰 الإجمالي: ${formatCurrency(quot.total, settings.currency)}`,
                      ``,
                      settings.companyNameAr || settings.companyName,
                    ].filter(Boolean).join("\n");
                    window.open(`https://wa.me/${normalized}?text=${encodeURIComponent(msg)}`, "_blank");
                  }}
                >
                  <MessageCircle className="w-4 h-4" /> واتساب
                </Button>
              );
            })()}
            {quot.status === "draft" && canAdd ? (
              <Button onClick={() => setConvertOpen(true)} disabled={isExpired} title={isExpired ? "انتهت صلاحية العرض" : undefined}>
                <ArrowRightLeft className="w-4 h-4" /> تحويل إلى فاتورة
              </Button>
            ) : null}
            {quot.status === "draft" && canDelete ? (
              <Button variant="danger" onClick={() => setDelOpen(true)}>
                <Trash2 className="w-4 h-4" /> حذف
              </Button>
            ) : null}
          </>
        }
      />

      {quot.status === "converted" && linkedInvoice ? (
        <div
          className="bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-200 dark:border-emerald-500/30 rounded-lg p-3 text-sm text-emerald-800 dark:text-emerald-400 flex items-center justify-between cursor-pointer hover:bg-emerald-100 dark:hover:bg-emerald-500/20"
          onClick={() => navigate(`/sales/${linkedInvoice.id}`)}
        >
          <span>هذا العرض تم تحويله إلى فاتورة رقم {linkedInvoice.invoiceNumber}</span>
          <ArrowRight className="w-4 h-4" />
        </div>
      ) : null}

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
        <Stat label="الإجمالي" value={formatCurrency(quot.total, settings.currency)} />
        {quot.discount && quot.discount > 0 ? (
          <Stat label="الخصم" value={`- ${formatCurrency(quot.discount, settings.currency)}`} tone="rose" />
        ) : null}
        {quot.validUntil ? (
          <Stat label="صالح حتى" value={formatDate(quot.validUntil)} />
        ) : null}
        <Stat
          label="الحالة"
          value={quot.status === "converted" ? "محولة" : isExpired ? "منتهية الصلاحية" : "مفتوحة"}
          tone={quot.status === "converted" ? "green" : isExpired ? "rose" : "amber"}
        />
      </div>

      <Card>
        <CardHeader title="بيانات عرض السعر" />
        <CardBody className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
          <Info label="العميل">{quot.customerName}</Info>
          <Info label="سيارة العميل">
            <span className="flex items-center gap-2"><CarFront className="h-4 w-4 text-cyan-600" /> {quot.vehicleLabel ?? "لم تحدد سيارة"}</span>
          </Info>
          <Info label="الفرع">
            <span className="flex items-center gap-2"><Building2 className="h-4 w-4 text-indigo-600" /> {quot.branchName ?? "غير محدد"}</span>
          </Info>
          <Info label="شريحة السعر">
            <span className="flex items-center gap-2"><Tags className="h-4 w-4 text-amber-600" /> {quot.priceTierName ?? "السعر الافتراضي"}</span>
          </Info>
          <Info label="التاريخ">{formatDate(quot.date)}</Info>
          <Info label="عدد البنود">{quot.lines.length}</Info>
          <Info label="الحالة">
            <Badge tone={quot.status === "converted" ? "green" : isExpired ? "red" : "amber"}>
              {quot.status === "converted" ? "محولة" : isExpired ? "منتهية الصلاحية" : "مفتوحة"}
            </Badge>
          </Info>
          {quot.notes ? (
            <Info label="ملاحظات" className="col-span-2 md:col-span-4">
              {quot.notes}
            </Info>
          ) : null}
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="بنود عرض السعر" />
        <CardBody>
          <Table>
            <THead>
              <TR>
                <TH className="w-10">#</TH>
                <TH>المنتج</TH>
                <TH>Part No. / الماركة</TH>
                {quot.customerVehicleId ? <TH>التوافق</TH> : null}
                {quot.branchId ? <TH>رصيد الفرع</TH> : null}
                <TH>الوحدة</TH>
                <TH className="text-end">الكمية</TH>
                <TH className="text-end">السعر</TH>
                <TH className="text-end">الإجمالي</TH>
              </TR>
            </THead>
            <TBody>
              {quot.lines.map((l, idx) => {
                const product = products.find((item) => item.id === l.productId);
                const compatibility = productVehicleFitmentStatus(l.productId, selectedVehicle, vehicleCatalog.productFitments);
                const branchUnits = quot.branchId ? pro.branchQuantity(quot.branchId, l.productId) : 0;
                const available = product?.piecesPerUnit ? branchUnits * product.piecesPerUnit : branchUnits;
                return (
                  <TR key={l.id}>
                    <TD>{idx + 1}</TD>
                    <TD className="font-medium text-ink">{l.productName}</TD>
                    <TD>
                      <div className="font-mono text-xs" dir="ltr">{l.partNumber ?? product?.partNumber ?? "—"}</div>
                      <div className="mt-0.5 text-xs text-ink-faint">{l.partBrand ?? product?.partBrand ?? "—"}</div>
                    </TD>
                    {quot.customerVehicleId ? (
                      <TD><CompatibilityBadge status={compatibility} /></TD>
                    ) : null}
                    {quot.branchId ? (
                      <TD><Badge tone={available > 0 ? "green" : "red"}>{available}</Badge></TD>
                    ) : null}
                    <TD>
                      {l.unit}
                      <div className="text-[10px] text-ink-faint">{l.priceType === "retail" ? "تجزئة" : "جملة"}</div>
                    </TD>
                    <TD className="text-end">{l.quantity}</TD>
                    <TD className="text-end">{formatCurrency(l.price, settings.currency)}</TD>
                    <TD className="text-end font-medium">
                      {formatCurrency(l.subtotal, settings.currency)}
                    </TD>
                  </TR>
                );
              })}
            </TBody>
          </Table>
          {quot.discount && quot.discount > 0 ? (
            <div className="mt-3 flex flex-col items-end gap-1 text-sm">
              <div className="flex gap-6">
                <span className="text-ink-faint">المجموع الفرعي</span>
                <span className="w-32 text-end">{formatCurrency(quot.total + quot.discount, settings.currency)}</span>
              </div>
              <div className="flex gap-6 text-rose-600 dark:text-rose-400">
                <span>الخصم</span>
                <span className="w-32 text-end">- {formatCurrency(quot.discount, settings.currency)}</span>
              </div>
              <div className="flex gap-6 font-bold text-lg">
                <span>الإجمالي</span>
                <span className="w-32 text-end">{formatCurrency(quot.total, settings.currency)}</span>
              </div>
            </div>
          ) : null}
        </CardBody>
      </Card>

      {/* Convert dialog */}
      <Dialog
        open={convertOpen}
        onClose={() => setConvertOpen(false)}
        title="تحويل عرض السعر إلى فاتورة"
        subtitle={`${quot.customerName}${quot.vehicleLabel ? ` — ${quot.vehicleLabel}` : ""} — ${formatCurrency(quot.total, settings.currency)}`}
        footer={
          <>
            <Button variant="outline" onClick={() => setConvertOpen(false)}>إلغاء</Button>
            <Button onClick={handleConvert}>تحويل وإنشاء فاتورة</Button>
          </>
        }
      >
        <div className="space-y-3">
          <Field label="رقم الفاتورة" required>
            <Input value={invoiceNumber} onChange={(e) => setInvoiceNumber(e.target.value)} />
          </Field>
          <Field label="تاريخ الفاتورة" required>
            <Input type="date" value={invDate} onChange={(e) => setInvDate(e.target.value)} />
          </Field>
          <Field label="طريقة الدفع">
            <Select value={paymentType} onChange={(e) => setPaymentType(e.target.value as SalesPaymentType)}>
              <option value="cash">كاش</option>
              {creditSalesEnabled && <option value="account">آجل</option>}
            </Select>
          </Field>
          {paymentType === "account" && (
            <Field label="تاريخ الاستحقاق">
              <Input type="date" value={paymentDueDate} onChange={(e) => setPaymentDueDate(e.target.value)} />
            </Field>
          )}
          <Field label="المبلغ المدفوع">
            <Input
              type="number"
              min={0}
              step="0.01"
              value={amountReceived || ""}
              onChange={(e) => setAmountReceived(Number(e.target.value))}
            />
          </Field>
          {driversEnabled && drivers.length > 0 && (
            <Field label="السائق">
              <Select value={driverId} onChange={(e) => setDriverId(e.target.value)}>
                <option value="">-- بدون سائق --</option>
                {drivers.map((d) => (
                  <option key={d.id} value={d.id}>{d.name}</option>
                ))}
              </Select>
            </Field>
          )}
        </div>
      </Dialog>

      <ConfirmDialog
        open={delOpen}
        onClose={() => setDelOpen(false)}
        onConfirm={() => {
          deleteQuotation(quot.id);
          toast.success("تم حذف عرض السعر");
          navigate("/quotations");
        }}
        title="حذف عرض السعر"
        message="هل أنت متأكد من حذف عرض السعر نهائياً؟"
        variant="danger"
        confirmText="حذف"
      />
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
    <div className={`bg-surface-muted border border-line-soft rounded-lg p-3 ${className ?? ""}`}>
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
  tone?: "slate" | "green" | "amber" | "rose";
}) {
  const colors: Record<string, string> = {
    slate: "text-ink",
    green: "text-emerald-700 dark:text-emerald-400",
    amber: "text-amber-700 dark:text-amber-400",
    rose: "text-rose-700 dark:text-rose-400",
  };
  return (
    <div className="bg-surface rounded-xl border border-line p-4">
      <div className="text-xs text-ink-faint">{label}</div>
      <div className={`text-lg font-semibold mt-1 ${colors[tone]}`}>{value}</div>
    </div>
  );
}

function CompatibilityBadge({ status }: { status: "compatible" | "incompatible" | "unknown" }) {
  if (status === "compatible") return <Badge tone="green">متوافق</Badge>;
  if (status === "incompatible") return <Badge tone="red">غير متوافق</Badge>;
  return <Badge tone="amber">يلزم مطابقة</Badge>;
}
