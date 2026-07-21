import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useBlocker, useNavigate } from "react-router-dom";
import { ArrowRight, Plus, Save, Trash2 } from "lucide-react";
import { PageHeader } from "../components/layout/AppLayout";
import { Card, CardBody, CardHeader } from "../components/ui/Card";
import { Button } from "../components/ui/Button";
import { Field, Input, Select, Textarea } from "../components/ui/Input";
import { Table, TBody, TD, TH, THead, TR } from "../components/ui/Table";
import { useCatalog } from "../store/CatalogContext";
import { useInvoicing } from "../store/InvoicingContext";
import { useSettings } from "../store/SettingsContext";
import { useReporting } from "../store/ReportingContext";
import { useToast } from "../components/ui/Toast";
import { todayISO, uid } from "../lib/utils";
import type { InvoiceLine, PaymentMethod, Product, SalesPaymentType, SalesPriceType } from "../types";
import { formatCurrency, PAYMENT_METHOD_LABELS } from "../lib/format";
import { Badge } from "../components/ui/Badge";
import { ConfirmDialog } from "../components/ui/Dialog";
import { DriverDialog } from "../features/drivers/DriverDialog";
import { BarcodeScanInput } from "../features/products/BarcodeScanInput";
import { CustomerFormDialog } from "../features/customers/CustomerFormDialog";
import { useAuth } from "../store/AuthContext";
import { computeCreditPaymentView } from "../store/_pure";
import { useFeatures } from "../lib/useFeatures";
import { hasPermission } from "../lib/permissions";
import { parseNumericInput } from "../lib/numberInput";
import { findProductScanCandidates } from "../lib/partSearch";
import { aggregateSalesPriceType } from "../lib/salesPrice";

interface LineDraft {
  id: string;
  productId: string;
  quantity: number;
  price: number;
  priceType: SalesPriceType;
  expiryDate?: string;
}

const DRAFT_KEY = "sales_invoice_new_draft";
const DEFAULT_PRICE_TYPE: SalesPriceType = "wholesale";

interface DraftState {
  invoiceNumber: string;
  date: string;
  customerId: string;
  driverId: string;
  paymentType: SalesPaymentType;
  paymentMethod: PaymentMethod;
  paymentMethodLabel: string;
  priceType?: SalesPriceType;
  paymentDueDate: string;
  discount: number;
  amountReceived: number;
  notes: string;
  lines: LineDraft[];
}

function normalizePriceType(value: unknown): SalesPriceType {
  return value === "retail" ? "retail" : "wholesale";
}

function normalizeDraft(state: DraftState): DraftState {
  const fallback = normalizePriceType(state.priceType);
  return {
    ...state,
    priceType: fallback,
    lines: state.lines.map((line) => ({
      ...line,
      priceType: normalizePriceType(line.priceType ?? fallback),
    })),
  };
}

function loadDraft(): DraftState | null {
  try {
    const raw = sessionStorage.getItem(DRAFT_KEY);
    return raw ? normalizeDraft(JSON.parse(raw) as DraftState) : null;
  } catch {
    return null;
  }
}

function saveDraft(state: DraftState) {
  sessionStorage.setItem(DRAFT_KEY, JSON.stringify(state));
}

function clearDraft() {
  sessionStorage.removeItem(DRAFT_KEY);
}

function quantityAsBaseUnits(
  product: Product | undefined,
  quantity: number,
  priceType: SalesPriceType
) {
  if (!product?.piecesPerUnit) return quantity;
  return priceType === "retail" ? quantity : quantity * product.piecesPerUnit;
}

function productStockAsBaseUnits(product: Product) {
  return product.piecesPerUnit
    ? product.quantity * product.piecesPerUnit + (product.looseQuantity ?? 0)
    : product.quantity;
}

function availableFromBaseUnits(
  product: Product,
  baseUnits: number,
  priceType: SalesPriceType
) {
  if (!product.piecesPerUnit) return baseUnits;
  return priceType === "retail" ? baseUnits : Math.floor(baseUnits / product.piecesPerUnit);
}

function nextInvoiceNumber(existing: string[]): string {
  const nums = existing
    .map((x) => parseInt(x.replace(/\D/g, ""), 10))
    .filter((n) => !Number.isNaN(n));
  const currentMax = nums.length ? Math.max(...nums) : 1000;
  const storedMax = parseInt(localStorage.getItem("seq_sales_invoice") || "0", 10);
  const absoluteMax = Math.max(currentMax, storedMax);
  return `INV-${absoluteMax + 1}`;
}

export function SalesInvoiceNewPage() {
  const { products: allProducts, customers: allCustomers, drivers } = useCatalog();
  const { currentUser } = useAuth();
  const canAddCustomer = hasPermission(currentUser, "customers", "add");
  const products = useMemo(() => allProducts.filter((p) => !p.archived), [allProducts]);
  const customers = useMemo(() => allCustomers.filter((c) => !c.archived), [allCustomers]);
  const { salesInvoices, addSalesInvoice, applyCustomerCredit } = useInvoicing();
  const { settings } = useSettings();
  const { customerBalance } = useReporting();
  const { isEnabled } = useFeatures();
  const multiSalePricesEnabled = isEnabled("multiSalePrices");
  const creditPaymentEnabled = isEnabled("creditPayment");
  const creditSalesEnabled = isEnabled("creditSales");
  const navigate = useNavigate();
  const toast = useToast();

  const [draftRestored, setDraftRestored] = useState(() => !!loadDraft());
  const [invoiceNumber, setInvoiceNumber] = useState(() =>
    loadDraft()?.invoiceNumber ?? nextInvoiceNumber(salesInvoices.map((s) => s.invoiceNumber))
  );
  const [date, setDate] = useState(() => loadDraft()?.date ?? todayISO());
  const [customerId, setCustomerId] = useState(() => loadDraft()?.customerId ?? customers[0]?.id ?? "");
  const [driverId, setDriverId] = useState(() => loadDraft()?.driverId ?? "");
  const [paymentType, setPaymentType] = useState<SalesPaymentType>(() => loadDraft()?.paymentType ?? "cash");
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>(() => loadDraft()?.paymentMethod ?? "cash");
  const [paymentMethodLabel, setPaymentMethodLabel] = useState(() => loadDraft()?.paymentMethodLabel ?? "");
  const [useCredit, setUseCredit] = useState(false);
  const [invoicePriceType, setInvoicePriceType] = useState<SalesPriceType>(() =>
    loadDraft()?.priceType ?? DEFAULT_PRICE_TYPE
  );
  const [paymentDueDate, setPaymentDueDate] = useState(() => loadDraft()?.paymentDueDate ?? "");
  const [discount, setDiscount] = useState<number>(() => loadDraft()?.discount ?? 0);
  const [amountReceived, setAmountReceived] = useState<number>(() => loadDraft()?.amountReceived ?? 0);
  const [notes, setNotes] = useState(() => loadDraft()?.notes ?? "");
  const [lines, setLines] = useState<LineDraft[]>(() =>
    (loadDraft()?.lines ?? []).map((line) => ({
      ...line,
      priceType: multiSalePricesEnabled ? line.priceType : invoicePriceType,
    }))
  );
  const [newDriverOpen, setNewDriverOpen] = useState(false);
  const [customerDialogOpen, setCustomerDialogOpen] = useState(false);
  const isDirtyRef = useRef(false);
  useEffect(() => { isDirtyRef.current = lines.length > 0; }, [lines]);
  const blocker = useBlocker(useCallback(() => isDirtyRef.current, []));

  useEffect(() => {
    if (!customerId && customers[0]) setCustomerId(customers[0].id);
  }, [customers, customerId]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      saveDraft({ invoiceNumber, date, customerId, driverId, paymentType, paymentMethod, paymentMethodLabel, priceType: invoicePriceType, paymentDueDate, discount, amountReceived, notes, lines });
    }, 150);
    return () => window.clearTimeout(timer);
  }, [invoiceNumber, date, customerId, driverId, paymentType, paymentMethod, paymentMethodLabel, invoicePriceType, paymentDueDate, discount, amountReceived, notes, lines]);

  function handleClearDraft() {
    clearDraft();
    setDraftRestored(false);
    setInvoiceNumber(nextInvoiceNumber(salesInvoices.map((s) => s.invoiceNumber)));
    setDate(todayISO());
    setCustomerId(customers[0]?.id ?? "");
    setDriverId("");
    setPaymentType("cash");
    setPaymentMethod("cash");
    setPaymentMethodLabel("");
    setUseCredit(false);
    setInvoicePriceType(DEFAULT_PRICE_TYPE);
    setPaymentDueDate("");
    setAmountReceived(0);
    setNotes("");
    setLines([]);
  }

  const gross = useMemo(
    () => lines.reduce((a, l) => a + (l.quantity || 0) * (l.price || 0), 0),
    [lines]
  );
  const invoiceNet = Math.max(0, gross - (discount || 0));
  // Net available credit = overpayment surplus after netting out any open balances on other invoices
  const creditAvailable = customerId ? Math.max(0, -customerBalance(customerId)) : 0;
  const { creditApplied, totalEffective, remainingDue, customerChange } = computeCreditPaymentView({
    invoiceNet,
    amountReceived,
    creditAvailable,
    useCredit,
  });

  useEffect(() => {
    if (paymentType !== "cash") { setAmountReceived(0); return; }
    const cr = useCredit ? Math.min(creditAvailable, invoiceNet) : 0;
    setAmountReceived(Math.max(0, invoiceNet - cr));
  }, [paymentType, invoiceNet, useCredit, customerId, creditAvailable]);

  useEffect(() => {
    if (paymentType === "cash") setPaymentDueDate("");
  }, [paymentType]);

  // A draft saved while the add-on was available must not silently create a
  // deferred sale after the license/package changes.
  useEffect(() => {
    if (!creditSalesEnabled && paymentType === "account") setPaymentType("cash");
  }, [creditSalesEnabled, paymentType]);

  useEffect(() => {
    setUseCredit(false);
  }, [customerId]);

  const stockWarnings = useMemo(() => {
    const out: { productId: string; requested: number; available: number; name: string; unit: string }[] = [];
    const byProduct = new Map<string, number>();
    lines.forEach((l) => {
      if (!l.productId) return;
      const product = products.find((x) => x.id === l.productId);
      const ept = multiSalePricesEnabled ? l.priceType : invoicePriceType;
      byProduct.set(
        l.productId,
        (byProduct.get(l.productId) ?? 0) + quantityAsBaseUnits(product, l.quantity, ept)
      );
    });
    byProduct.forEach((requestedBase, pid) => {
      const p = products.find((x) => x.id === pid);
      if (!p) return;
      const availableBase = productStockAsBaseUnits(p);
      if (requestedBase > availableBase) {
        out.push({
          productId: pid,
          requested: requestedBase,
          available: availableBase,
          name: p.name,
          unit: p.piecesPerUnit ? (p.retailUnit ?? "قطعة") : p.unit,
        });
      }
    });
    return out;
  }, [lines, products, multiSalePricesEnabled, invoicePriceType]);

  function productPrice(product: Product, selectedPriceType: SalesPriceType = DEFAULT_PRICE_TYPE) {
    const effectivePriceType = selectedPriceType;
    if (effectivePriceType === "retail" && product.piecesPerUnit) return product.retailPrice;
    return effectivePriceType === "retail" ? product.retailPrice : product.wholesalePrice;
  }

  function addLine(productId?: string) {
    const p = productId ? products.find((x) => x.id === productId) : undefined;
    const priceType = multiSalePricesEnabled ? DEFAULT_PRICE_TYPE : invoicePriceType;
    setLines((l) => [
      ...l,
      {
        id: uid("line"),
        productId: p?.id ?? "",
        quantity: 1,
        price: p ? productPrice(p, priceType) : 0,
        priceType,
      },
    ]);
  }

  function handleScan(code: string) {
    const candidates = findProductScanCandidates(products, code);
    if (candidates.length > 1) {
      toast.info(`يوجد ${candidates.length} بدائل لهذا الرقم`, "استخدم رقم القطعة أو باركود العبوة لتحديد الصنف");
      return;
    }
    const product = candidates[0]?.product;
    if (!product) {
      toast.error("الكود غير معروف", `لا يوجد باركود أو Part Number أو OEM مطابق: ${code}`);
      return;
    }
    const defaultPriceType = multiSalePricesEnabled ? DEFAULT_PRICE_TYPE : invoicePriceType;
    const wasExisting = lines.some((l) => l.productId === product.id && l.priceType === defaultPriceType);
    // Functional update keeps rapid consecutive scans of the same item accurate.
    setLines((arr) => {
      const existing = arr.find((l) => l.productId === product.id && l.priceType === defaultPriceType);
      if (existing) {
        return arr.map((l) =>
          l.id === existing.id ? { ...l, quantity: l.quantity + 1 } : l
        );
      }
      return [
        ...arr,
        { id: uid("line"), productId: product.id, quantity: 1, price: productPrice(product, defaultPriceType), priceType: defaultPriceType },
      ];
    });
    toast.success(wasExisting ? "تم تحديث الكمية" : "تمت إضافة المنتج", product.name);
  }

  function updateLine(id: string, patch: Partial<LineDraft>) {
    setLines((arr) =>
      arr.map((l) => {
        if (l.id !== id) return l;
        const next = { ...l, ...patch };
        next.priceType = multiSalePricesEnabled ? (next.priceType ?? DEFAULT_PRICE_TYPE) : invoicePriceType;
        if (patch.productId !== undefined || patch.priceType !== undefined) {
          const p = products.find((x) => x.id === next.productId);
          if (p) next.price = productPrice(p, next.priceType);
        }
        return next;
      })
    );
  }

  function removeLine(id: string) {
    setLines((arr) => arr.filter((l) => l.id !== id));
  }

  function changeInvoicePriceType(nextPriceType: SalesPriceType) {
    if (nextPriceType === invoicePriceType) return;
    setInvoicePriceType(nextPriceType);
    setLines((arr) =>
      arr.map((line) => {
        const product = products.find((p) => p.id === line.productId);
        return {
          ...line,
          priceType: nextPriceType,
          price: product ? productPrice(product, nextPriceType) : line.price,
        };
      })
    );
  }

  function submit() {
    if (!customerId) {
      toast.error("اختر العميل");
      return;
    }
    if (lines.length === 0) {
      toast.error("أضف بنود الفاتورة");
      return;
    }
    const invalidIdx = lines.findIndex((l) => !l.productId || l.quantity <= 0);
    if (invalidIdx >= 0) {
      toast.error(`السطر ${invalidIdx + 1}: تأكد من اختيار المنتج وإدخال كمية صحيحة`);
      return;
    }
    if (stockWarnings.length > 0) {
      toast.error(
        "الكمية المطلوبة تتجاوز المخزون",
        stockWarnings
          .map((w) => `${w.name}: متاح ${w.available} / مطلوب ${w.requested}`)
          .join(" • ")
      );
      return;
    }
    if (discount < 0 || discount > gross) {
      toast.error("قيمة الخصم غير صحيحة");
      return;
    }
    if (amountReceived < 0) {
      toast.error("المبلغ المستلم غير صحيح");
      return;
    }
    if (paymentType === "cash" && totalEffective <= 0 && invoiceNet > 0) {
      toast.error("أدخل المبلغ المستلم أو استخدم الرصيد الدائن");
      return;
    }
    // Cash with partial payment → auto-convert to account and require due date
    if (paymentType === "cash" && remainingDue > 0) {
      if (!creditSalesEnabled) {
        toast.error("ميزة البيع الآجل غير مفعّلة في ترخيصك", "سدّد إجمالي الفاتورة أو فعّل الميزة من الباقة.");
        return;
      }
      setPaymentType("account");
      if (!paymentDueDate) {
        toast.error("المبلغ أقل من الإجمالي — تم التحويل لآجل، أضف تاريخ الاستحقاق");
        return;
      }
    }
    if (paymentType === "account" && !creditSalesEnabled) {
      toast.error("ميزة البيع الآجل غير مفعّلة في ترخيصك");
      return;
    }
    if ((paymentType === "account" || remainingDue > 0) && !paymentDueDate) {
      toast.error("أدخل تاريخ الاستحقاق");
      return;
    }

    const customer = customers.find((c) => c.id === customerId)!;
    const invLines: InvoiceLine[] = lines.map((l) => {
      const p = products.find((x) => x.id === l.productId)!;
      const ept = multiSalePricesEnabled ? l.priceType : invoicePriceType;
      const isRetailUnit = ept === "retail" && !!p.piecesPerUnit;
      return {
        id: l.id,
        productId: p.id,
        productName: p.name,
        partNumber: p.partNumber,
        partBrand: p.partBrand,
        warrantyMonths: p.warrantyMonths,
        unit: isRetailUnit ? (p.retailUnit ?? "قطعة") : p.unit,
        quantity: l.quantity,
        price: l.price,
        priceType: ept,
        expiryDate: l.expiryDate,
        subtotal: l.quantity * l.price,
        isRetailUnit: isRetailUnit || undefined,
      };
    });

    // If cash payment was partial it was converted to account above
    const effectivePaymentType: SalesPaymentType = remainingDue > 0 ? "account" : paymentType;
    const effectiveDueDate = (effectivePaymentType === "account" || remainingDue > 0) && paymentDueDate ? paymentDueDate : undefined;

    const actualCashReceived = Math.min(amountReceived, invoiceNet);
    const cashOverpayment = Math.max(0, amountReceived - invoiceNet);

    const inv = addSalesInvoice({
      invoiceNumber,
      date,
      customerId,
      customerName: customer.name,
      driverId: driverId || undefined,
      driverName: driverId ? drivers.find(d => d.id === driverId)?.name : undefined,
      lines: invLines,
      total: invoiceNet,
      discount: discount > 0 ? discount : undefined,
      amountReceived: actualCashReceived,
      overpayment: cashOverpayment > 0 ? cashOverpayment : undefined,
      paymentType: effectivePaymentType,
      paymentMethod,
      paymentMethodLabel: paymentMethod === "other" && paymentMethodLabel.trim() ? paymentMethodLabel.trim() : undefined,
      priceType: aggregateSalesPriceType(invLines),
      paymentDueDate: effectiveDueDate,
      notes: notes.trim() || undefined,
    });

    if (creditApplied > 0) {
      applyCustomerCredit(customerId, inv.id, creditApplied);
    }

    const issuedNum = parseInt(inv.invoiceNumber.replace(/\D/g, ""), 10);
    if (!Number.isNaN(issuedNum)) {
      const storedMax = parseInt(localStorage.getItem("seq_sales_invoice") || "0", 10);
      localStorage.setItem("seq_sales_invoice", Math.max(storedMax, issuedNum).toString());
    }

    isDirtyRef.current = false;
    clearDraft();
    toast.success("تم حفظ الفاتورة", `رقم ${inv.invoiceNumber}`);
    navigate(`/sales/${inv.id}`);
  }

  const customer = customers.find((c) => c.id === customerId);

  return (
    <>
      <PageHeader
        title="فاتورة مبيعات جديدة"
        description="أدخل بنود الفاتورة — يتم خصم الكميات من المخزون تلقائياً عند الحفظ."
        actions={
          <>
            <Button variant="outline" onClick={() => navigate("/sales")}>
              <ArrowRight className="w-4 h-4" />
              رجوع
            </Button>
            <Button onClick={submit}>
              <Save className="w-4 h-4" />
              حفظ الفاتورة
            </Button>
          </>
        }
      />

      {draftRestored ? (
        <div className="bg-blue-50 dark:bg-blue-500/10 border border-blue-200 dark:border-blue-500/30 text-blue-900 dark:text-blue-300 rounded-lg px-4 py-2.5 text-sm flex items-center justify-between">
          <span>تم استعادة مسودة محفوظة تلقائياً.</span>
          <Button size="sm" variant="outline" onClick={handleClearDraft}>
            مسح المسودة
          </Button>
        </div>
      ) : null}

      {stockWarnings.length > 0 ? (
        <div className="bg-rose-50 dark:bg-rose-500/10 border border-rose-200 dark:border-rose-500/30 text-rose-900 dark:text-rose-300 rounded-lg p-3 text-sm">
          <div className="font-semibold mb-1">⚠ تحذير: الكمية تتجاوز المخزون</div>
          <ul className="list-disc ps-5 space-y-0.5 text-xs">
            {stockWarnings.map((w) => (
              <li key={w.productId}>
                {w.name}: المتاح {w.available} {w.unit} / المطلوب {w.requested} {w.unit}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <Card>
        <CardHeader title="بيانات الفاتورة" />
        <CardBody>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Field label="رقم الفاتورة" required>
              <Input
                value={invoiceNumber}
                readOnly
                className="bg-surface-muted cursor-not-allowed text-ink-faint opacity-70 font-mono"
              />
            </Field>
            <Field label="التاريخ" required>
              <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </Field>
            <Field label="العميل" required>
              <div className="flex items-center gap-1.5">
                <Select aria-label="العميل" value={customerId} onChange={(e) => setCustomerId(e.target.value)} className="flex-1">
                  {customers.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </Select>
                {canAddCustomer && (
                  <Button size="icon" variant="outline" className="shrink-0"
                    onClick={() => setCustomerDialogOpen(true)} title="إضافة عميل جديد">
                    <Plus className="w-4 h-4" />
                  </Button>
                )}
              </div>
            </Field>
            <Field label="السائق (اختياري)">
              <div className="flex items-center gap-2">
                <Select value={driverId} onChange={(e) => setDriverId(e.target.value)} className="flex-1">
                  <option value="">— اختر سائقاً —</option>
                  {drivers.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                    </option>
                  ))}
                </Select>
                <Button variant="outline" size="icon" onClick={() => setNewDriverOpen(true)}>
                  <Plus className="w-4 h-4" />
                </Button>
              </div>
            </Field>
          </div>
          {customer ? (
            <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-ink-faint">
              <span>الهاتف: {customer.phone ?? "—"}</span>
              <span>العنوان: {customer.address ?? "—"}</span>
              {(() => {
                const bal = customerBalance(customerId);
                if (bal === 0) return null;
                return (
                  <span className={`font-semibold ${bal > 0 ? "text-rose-600 dark:text-rose-400" : "text-emerald-700 dark:text-emerald-400"}`}>
                    {bal > 0
                      ? `مديون: ${formatCurrency(bal, settings.currency)}`
                      : `رصيد دائن: ${formatCurrency(-bal, settings.currency)}`}
                  </span>
                );
              })()}
            </div>
          ) : null}
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="بنود الفاتورة"
          actions={
            <Button onClick={() => addLine()} size="sm">
              <Plus className="w-3.5 h-3.5" /> إضافة بند
            </Button>
          }
        />
        <CardBody>
          <div className="mb-4">
            <BarcodeScanInput onScan={handleScan} disabled={products.length === 0} />
          </div>
          {!multiSalePricesEnabled && (
            <div className="mb-4 rounded-lg border border-line bg-surface-muted p-3">
              <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                <div>
                  <div className="text-xs font-medium text-ink-muted">نوع السعر</div>
                </div>
                <div className="grid grid-cols-2 gap-2 md:w-[450px]">
                  <PriceTypeOption
                    label="جملة"
                    hint="الفاتورة كلها بسعر الجملة"
                    active={invoicePriceType === "wholesale"}
                    onClick={() => changeInvoicePriceType("wholesale")}
                  />
                  <PriceTypeOption
                    label="تجزئة"
                    hint="الفاتورة كلها بسعر التجزئة"
                    active={invoicePriceType === "retail"}
                    onClick={() => changeInvoicePriceType("retail")}
                  />
                </div>
              </div>
            </div>
          )}
          {lines.length === 0 ? (
            <div className="text-center py-8 text-sm text-ink-faint">
              لا توجد بنود — ابدأ بإضافة منتج.
              <div className="mt-3">
                <Button onClick={() => addLine()}>
                  <Plus className="w-4 h-4" /> إضافة بند
                </Button>
              </div>
            </div>
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH className="w-96">المنتج</TH>
                  {multiSalePricesEnabled && <TH className="w-32">نوع السعر</TH>}
                  <TH className="w-20 text-center">متاح</TH>
                  <TH className="w-24">الكمية</TH>
                  <TH className="w-28">السعر</TH>
                  <TH className="w-28 text-end">الإجمالي</TH>
                  <TH className="w-10"></TH>
                </TR>
              </THead>
              <TBody>
                {lines.map((l) => {
                  const p = products.find((x) => x.id === l.productId);
                  const ept = multiSalePricesEnabled ? l.priceType : invoicePriceType;
                  const currentBaseQty = quantityAsBaseUnits(p, l.quantity, ept);
                  const availableBase = p ? productStockAsBaseUnits(p) : 0;
                  const otherDraftBaseQty = lines
                    .filter((ol) => ol.id !== l.id && ol.productId === l.productId)
                    .reduce((sum, ol) => {
                      const otherProduct = products.find((x) => x.id === ol.productId);
                      const otherPriceType = multiSalePricesEnabled ? ol.priceType : invoicePriceType;
                      return sum + quantityAsBaseUnits(otherProduct, ol.quantity, otherPriceType);
                    }, 0);
                  const remainingBaseForLine = Math.max(0, availableBase - otherDraftBaseQty);
                  const available = p ? availableFromBaseUnits(p, remainingBaseForLine, ept) : 0;
                  const availUnit = p
                    ? ept === "retail" && p.piecesPerUnit
                      ? (p.retailUnit ?? "قطعة")
                      : p.unit
                    : "";
                  const exceeds = !!p && currentBaseQty > remainingBaseForLine;
                  return (
                    <TR key={l.id}>
                      <TD className="w-96">
                        <ProductCombo
                          products={products}
                          value={l.productId}
                          onChange={(pid) => updateLine(l.id, { productId: pid })}
                        />
                      </TD>
                      {multiSalePricesEnabled && (
                        <TD>
                          <Select
                            value={l.priceType}
                            onChange={(e) => updateLine(l.id, { priceType: e.target.value as SalesPriceType })}
                          >
                            <option value="wholesale">جملة</option>
                            <option value="retail">تجزئة</option>
                          </Select>
                        </TD>
                      )}
                      <TD className="text-center text-xs">
                        {p ? (
                          <Badge tone={available <= p.minStock ? "amber" : "slate"}>
                            {available} {availUnit}
                          </Badge>
                        ) : (
                          "—"
                        )}
                      </TD>
                      <TD>
                        <Input
                          type="number"
                          min={1}
                          value={l.quantity}
                          onChange={(e) =>
                            updateLine(l.id, {
                              quantity: Math.max(0, parseNumericInput(e.target.value, l.quantity)),
                            })
                          }
                          className={exceeds ? "border-rose-400" : ""}
                        />
                      </TD>
                      <TD>
                        <Input
                          type="number"
                          step="0.01"
                          min={0}
                          value={l.price}
                          onChange={(e) =>
                            updateLine(l.id, {
                              price: Math.max(0, parseNumericInput(e.target.value, l.price)),
                            })
                          }
                        />
                      </TD>
                      <TD className="text-end font-medium">
                        {formatCurrency(l.quantity * l.price, settings.currency)}
                      </TD>
                      <TD>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="text-red-600 dark:text-red-400 hover:bg-red-50 dark:bg-red-500/10"
                          onClick={() => removeLine(l.id)}
                        >
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </TD>
                    </TR>
                  );
                })}
              </TBody>
            </Table>
          )}
        </CardBody>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card>
          <CardHeader title="الدفع" />
          <CardBody className="space-y-3">
            <Field label="طريقة الدفع" required>
              <div className="flex items-center gap-2">
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="radio"
                    checked={paymentType === "cash"}
                    onChange={() => setPaymentType("cash")}
                  />
                  كاش
                </label>
                {creditSalesEnabled && (
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="radio"
                      checked={paymentType === "account"}
                      onChange={() => setPaymentType("account")}
                    />
                    آجل (حساب)
                  </label>
                )}
              </div>
            </Field>
            <Field label="وسيلة الدفع">
              <div className="flex flex-wrap gap-1.5">
                {(Object.entries(PAYMENT_METHOD_LABELS).filter(([k]) => k !== "credit" && k !== "other") as [PaymentMethod, string][]).map(([key, label]) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setPaymentMethod(key)}
                    className={`px-3 h-8 rounded-lg border text-xs font-medium transition-colors ${
                      paymentMethod === key
                        ? "border-brand-600 bg-brand-50 text-brand-700"
                        : "border-line bg-surface text-ink-muted hover:border-brand-300"
                    }`}
                  >
                    {label}
                  </button>
                ))}
                {/* الرصيد الدائن كوسيلة دفع مباشرة (يظهر فقط لو الميزة مفعّلة والعميل له رصيد) */}
                {creditPaymentEnabled && creditAvailable > 0 ? (
                  <button
                    type="button"
                    onClick={() => setUseCredit((v) => !v)}
                    title={`رصيد دائن متاح: ${formatCurrency(creditAvailable, settings.currency)}`}
                    className={`px-3 h-8 rounded-lg border text-xs font-medium transition-colors ${
                      useCredit
                        ? "border-emerald-600 bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400"
                        : "border-emerald-300 bg-surface text-emerald-600 hover:border-emerald-400 dark:border-emerald-500/40"
                    }`}
                  >
                    رصيد دائن ({formatCurrency(creditAvailable, settings.currency)})
                  </button>
                ) : null}
              </div>
              {paymentMethod === "other" ? (
                <Input
                  className="mt-2"
                  value={paymentMethodLabel}
                  onChange={(e) => setPaymentMethodLabel(e.target.value)}
                  placeholder="اكتب وسيلة الدفع..."
                />
              ) : null}
            </Field>
            {paymentType === "account" ? (
              <Field label="تاريخ الاستحقاق" required>
                <Input
                  type="date"
                  value={paymentDueDate}
                  onChange={(e) => setPaymentDueDate(e.target.value)}
                  required
                />
              </Field>
            ) : null}
            {creditPaymentEnabled && creditAvailable > 0 && useCredit ? (
              <div className="rounded-lg border border-emerald-200 dark:border-emerald-500/30 bg-emerald-50 dark:bg-emerald-500/10 px-3 py-2 text-sm">
                <span className="font-medium text-emerald-700 dark:text-emerald-400">
                  سيُخصم {formatCurrency(creditApplied, settings.currency)} من رصيد العميل الدائن
                </span>
                <span className="block text-xs text-emerald-600 mt-0.5">
                  المتاح: {formatCurrency(creditAvailable, settings.currency)} — اضغط زر «رصيد دائن» بالأعلى للإلغاء
                </span>
              </div>
            ) : null}
            <Field label="المبلغ المستلم" required>
              <Input
                type="text"
                inputMode="decimal"
                value={amountReceived === 0 ? "" : amountReceived.toLocaleString("en-US", { maximumFractionDigits: 2 })}
                onFocus={(e) => e.currentTarget.select()}
                onChange={(e) =>
                  setAmountReceived(Math.max(0, parseNumericInput(e.target.value, amountReceived)))
                }
              />
            </Field>
            <Field label="ملاحظات">
              <Textarea
                rows={2}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="ملاحظات اختيارية..."
              />
            </Field>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="الملخص" />
          <CardBody className="p-0">
            <div className="divide-y divide-line">
              <SummaryRow label="إجمالي" value={formatCurrency(gross, settings.currency)} />
              <div className="flex items-center justify-between px-4 py-2.5 gap-2">
                <span className="text-sm text-ink-muted">خصم</span>
                <Input
                  type="text"
                  inputMode="decimal"
                  value={discount === 0 ? "" : discount.toLocaleString("en-US", { maximumFractionDigits: 2 })}
                  onFocus={(e) => e.currentTarget.select()}
                  onChange={(e) =>
                    setDiscount(Math.max(0, parseNumericInput(e.target.value, discount)))
                  }
                  placeholder="0.00"
                  className="w-28 h-8 text-sm"
                />
              </div>
              <SummaryRow label="مستحق" value={formatCurrency(invoiceNet, settings.currency)} bold />
              {creditApplied > 0 && (
                <SummaryRow label="رصيد دائن مستخدم" value={`- ${formatCurrency(creditApplied, settings.currency)}`} valueClass="text-emerald-700 dark:text-emerald-400" />
              )}
              <SummaryRow
                label="إجمالي المسدّد"
                value={formatCurrency(totalEffective, settings.currency)}
                valueClass="text-emerald-700 dark:text-emerald-400"
                bold
              />
              <div className={`flex items-center justify-between px-4 py-3 rounded-b-xl ${remainingDue > 0 ? "bg-amber-50 dark:bg-amber-500/10" : "bg-emerald-50 dark:bg-emerald-500/10"}`}>
                <span className={`text-base font-bold ${remainingDue > 0 ? "text-amber-800 dark:text-amber-300" : "text-emerald-800 dark:text-emerald-300"}`}>
                  {customerChange > 0 ? "باقي للعميل" : "المتبقي"}
                </span>
                <span className={`text-xl font-bold ${remainingDue > 0 ? "text-amber-700 dark:text-amber-400" : "text-emerald-700 dark:text-emerald-400"}`}>
                  {formatCurrency(customerChange > 0 ? customerChange : remainingDue, settings.currency)}
                </span>
              </div>
            </div>
            <div className="p-4">
              <Button onClick={submit} size="lg" className="w-full">
                <Save className="w-4 h-4" /> حفظ الفاتورة
              </Button>
            </div>
          </CardBody>
        </Card>
      </div>

      <DriverDialog
        open={newDriverOpen}
        onClose={() => setNewDriverOpen(false)}
        onSaved={(drv) => setDriverId(drv.id)}
      />
      <CustomerFormDialog
        open={customerDialogOpen}
        onClose={() => setCustomerDialogOpen(false)}
        onCreated={(created) => setCustomerId(created.id)}
      />
      <ConfirmDialog
        open={blocker.state === "blocked"}
        onClose={() => blocker.reset?.()}
        onConfirm={() => blocker.proceed?.()}
        title="الخروج بدون حفظ؟"
        message="لديك بنود غير محفوظة. هل تريد الخروج وفقدان التغييرات؟"
        confirmText="خروج"
        variant="danger"
      />
    </>
  );
}

function ProductCombo({
  products,
  value,
  onChange,
}: {
  products: Product[];
  value: string;
  onChange: (id: string) => void;
}) {
  return (
    <Select value={value} onChange={(e) => onChange(e.target.value)} className="w-full">
      <option value="">— اختر منتجاً —</option>
      {products.map((p) => (
        <option key={p.id} value={p.id}>
          {p.partNumber || p.code} — {p.name}{p.partBrand ? ` (${p.partBrand})` : ""}
        </option>
      ))}
    </Select>
  );
}

function PriceTypeOption({
  label,
  hint,
  active,
  onClick,
}: {
  label: string;
  hint: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`h-14 rounded-lg border px-3 text-right transition-colors ${
        active
          ? "border-brand-600 bg-brand-50 text-brand-800 dark:bg-brand-500/20 dark:text-brand-300 shadow-sm"
          : "border-line bg-surface text-ink-muted hover:border-brand-200 hover:bg-surface"
      }`}
    >
      <span className="flex items-center justify-between gap-2">
        <span>
          <span className="block text-sm font-semibold">{label}</span>
          <span className="block text-[11px] text-ink-faint mt-0.5">{hint}</span>
        </span>
        <span
          className={`grid h-5 w-5 place-items-center rounded-full border ${
            active ? "border-brand-600 bg-brand-600" : "border-line bg-surface"
          }`}
        >
          {active ? <span className="h-2 w-2 rounded-full bg-surface" /> : null}
        </span>
      </span>
    </button>
  );
}

function SummaryRow({ label, value, bold, valueClass }: { label: string; value: string; bold?: boolean; valueClass?: string }) {
  return (
    <div className="flex items-center justify-between px-4 py-2.5 gap-2">
      <span className={`text-sm ${bold ? "font-semibold text-ink" : "text-ink-muted"}`}>{label}</span>
      <span className={`text-sm font-mono ${bold ? "font-bold text-ink" : ""} ${valueClass ?? ""}`}>{value}</span>
    </div>
  );
}
