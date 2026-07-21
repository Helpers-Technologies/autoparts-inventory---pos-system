import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useBlocker, useNavigate, useParams } from "react-router-dom";
import { ArrowRight, Plus, Save, Trash2 } from "lucide-react";
import { PageHeader } from "../components/layout/AppLayout";
import { Card, CardBody, CardHeader } from "../components/ui/Card";
import { ConfirmDialog } from "../components/ui/Dialog";
import { Button } from "../components/ui/Button";
import { Badge } from "../components/ui/Badge";
import { Field, Input, Select, Textarea } from "../components/ui/Input";
import { Table, TBody, TD, TH, THead, TR } from "../components/ui/Table";
import { useInvoicing } from "../store/InvoicingContext";
import { useCatalog } from "../store/CatalogContext";
import { useSettings } from "../store/SettingsContext";
import { useReporting } from "../store/ReportingContext";
import { useToast } from "../components/ui/Toast";
import { uid } from "../lib/utils";
import type { InvoiceLine, Product, SalesPaymentType, SalesPriceType } from "../types";
import { formatCurrency } from "../lib/format";
import { parseNumericInput } from "../lib/numberInput";
import { aggregateSalesPriceType, resolveSalesLinePriceType } from "../lib/salesPrice";
import { useFeatures } from "../lib/useFeatures";

interface LineDraft {
  id: string;
  productId: string;
  quantity: number;
  price: number;
  priceType: SalesPriceType;
  expiryDate?: string;
}

const DEFAULT_PRICE_TYPE: SalesPriceType = "wholesale";

function quantityAsBaseUnits(
  product: Product | undefined,
  quantity: number,
  priceType: SalesPriceType
) {
  if (!product?.piecesPerUnit) return quantity;
  return priceType === "retail" ? quantity : quantity * product.piecesPerUnit;
}

function availableFromBaseUnits(
  product: Product,
  baseUnits: number,
  priceType: SalesPriceType
) {
  if (!product.piecesPerUnit) return baseUnits;
  return priceType === "retail" ? baseUnits : Math.floor(baseUnits / product.piecesPerUnit);
}

export function SalesInvoiceEditPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const { salesInvoices, salesReturns, updateSalesInvoice } = useInvoicing();
  const { products, drivers } = useCatalog();
  const { settings } = useSettings();
  const { customerBalance } = useReporting();
  const { isEnabled } = useFeatures();
  const multiSalePricesEnabled = isEnabled("multiSalePrices");
  const creditSalesEnabled = isEnabled("creditSales");

  const inv = salesInvoices.find((s) => s.id === id);
  const hasReturns = salesReturns.some((r) => r.originalInvoiceId === id);
  const invoicePriceType = inv?.priceType ?? DEFAULT_PRICE_TYPE;
  const [globalPriceType, setGlobalPriceType] = useState<SalesPriceType>(invoicePriceType);

  const [invoiceNumber] = useState(inv?.invoiceNumber ?? "");
  const [date, setDate] = useState(inv?.date ?? "");
  const [driverId, setDriverId] = useState(inv?.driverId ?? "");
  const [paymentType, setPaymentType] = useState<SalesPaymentType>(inv?.paymentType ?? "cash");
  const [paymentDueDate, setPaymentDueDate] = useState(inv?.paymentDueDate ?? "");
  // FIX-08: Remember original due date so switching cash→account restores it
  const savedDueDateRef = useRef(inv?.paymentDueDate ?? "");
  const [discount, setDiscount] = useState<number>(inv?.discount ?? 0);
  // الفصل الكامل بين التعديل والتحصيل: المبلغ المدفوع لا يُعدَّل من هذه الشاشة،
  // بل يفضل ثابتاً ويُحصَّل أي فرق عبر "تسجيل دفعة". لذا قيمة عرض فقط (ليست state).
  const amountReceived = inv?.amountReceived ?? 0;
  const [notes, setNotes] = useState(inv?.notes ?? "");
  const [lines, setLines] = useState<LineDraft[]>(
    () =>
      inv?.lines.map((l) => ({
        id: l.id,
        productId: l.productId,
        quantity: l.quantity,
        price: l.price,
        priceType: multiSalePricesEnabled ? resolveSalesLinePriceType(l, invoicePriceType) : invoicePriceType,
        expiryDate: l.expiryDate,
      })) ?? []
  );

  useEffect(() => {
    if (paymentType === "cash") {
      // Save current due date before clearing so it can be restored
      if (paymentDueDate) savedDueDateRef.current = paymentDueDate;
      setPaymentDueDate("");
    } else {
      // Restore saved due date when switching back to account
      if (!paymentDueDate && savedDueDateRef.current) {
        setPaymentDueDate(savedDueDateRef.current);
      }
    }
    // Intentionally runs ONLY when paymentType toggles. paymentDueDate is read
    // as the current value (saved into a ref) — adding it as a dep would re-fire
    // this clear/restore effect on every keystroke in the due-date field.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paymentType]);

  const initializedRef = useRef(false);
  const dirtyRef = useRef(false);
  useEffect(() => {
    if (!initializedRef.current) { initializedRef.current = true; return; }
    dirtyRef.current = true;
  }, [date, invoiceNumber, driverId, paymentType, paymentDueDate, discount, notes, lines, globalPriceType]);
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (!dirtyRef.current) return;
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, []);
  const blocker = useBlocker(useCallback(() => dirtyRef.current, []));

  const gross = useMemo(
    () => lines.reduce((a, l) => a + (l.quantity || 0) * (l.price || 0), 0),
    [lines]
  );
  const invoiceNet = Math.max(0, gross - (discount || 0));

  const originalLinesById = useMemo(
    () => new Map(inv?.lines.map((line) => [line.id, line]) ?? []),
    [inv]
  );
  const originalBaseQtyByProduct = useMemo(() => {
    const m = new Map<string, number>();
    inv?.lines.forEach((l) => {
      const product = products.find((p) => p.id === l.productId);
      const stockPriceType = resolveSalesLinePriceType(l, invoicePriceType);
      m.set(l.productId, (m.get(l.productId) ?? 0) + quantityAsBaseUnits(product, l.quantity, stockPriceType));
    });
    return m;
  }, [inv, invoicePriceType, products]);

  const effectiveStockPriceType = useCallback((line: LineDraft): SalesPriceType => {
    return multiSalePricesEnabled
      ? line.priceType ?? resolveSalesLinePriceType(originalLinesById.get(line.id) ?? line, invoicePriceType)
      : globalPriceType;
  }, [multiSalePricesEnabled, originalLinesById, invoicePriceType, globalPriceType]);

  function productPrice(product: Product, selectedPriceType: SalesPriceType) {
    return selectedPriceType === "retail" ? product.retailPrice : product.wholesalePrice;
  }

  const stockWarnings = useMemo(() => {
    const requestedBaseByProduct = new Map<string, number>();
    lines.forEach((l) => {
      if (!l.productId) return;
      const p = products.find((x) => x.id === l.productId);
      requestedBaseByProduct.set(
        l.productId,
        (requestedBaseByProduct.get(l.productId) ?? 0) + quantityAsBaseUnits(p, l.quantity, effectiveStockPriceType(l))
      );
    });
    const out: { productId: string; requested: number; available: number; name: string; unit: string }[] = [];
    requestedBaseByProduct.forEach((requestedBase, pid) => {
      const p = products.find((x) => x.id === pid);
      if (!p) return;
      const availableBase =
        (p.piecesPerUnit ? p.quantity * p.piecesPerUnit + (p.looseQuantity ?? 0) : p.quantity) +
        (originalBaseQtyByProduct.get(pid) ?? 0);
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
  }, [lines, products, originalBaseQtyByProduct, effectiveStockPriceType]);

  function addLine() {
    setLines((l) => [...l, { id: uid("line"), productId: "", quantity: 1, price: 0, priceType: multiSalePricesEnabled ? DEFAULT_PRICE_TYPE : globalPriceType }]);
  }

  function updateLine(lineId: string, patch: Partial<LineDraft>) {
    setLines((arr) =>
      arr.map((l) => {
        if (l.id !== lineId) return l;
        const next = { ...l, ...patch };
        next.priceType = multiSalePricesEnabled ? (next.priceType ?? DEFAULT_PRICE_TYPE) : globalPriceType;
        if (patch.productId !== undefined || patch.priceType !== undefined) {
          const p = products.find((x) => x.id === next.productId);
          if (p) next.price = productPrice(p, next.priceType);
        }
        return next;
      })
    );
  }

  function removeLine(lineId: string) {
    setLines((arr) => arr.filter((l) => l.id !== lineId));
  }

  function changeGlobalPriceType(nextPriceType: SalesPriceType) {
    if (nextPriceType === globalPriceType) return;
    setGlobalPriceType(nextPriceType);
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
    if (!inv) return;
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
        "الكمية تتجاوز المخزون",
        stockWarnings.map((w) => `${w.name}: متاح ${w.available} / مطلوب ${w.requested}`).join(" • ")
      );
      return;
    }
    if (discount < 0 || discount > gross) {
      toast.error("قيمة الخصم غير صحيحة");
      return;
    }
    if (paymentType === "account" && !paymentDueDate) {
      toast.error("أدخل تاريخ الاستحقاق");
      return;
    }
    if (paymentType === "account" && inv.paymentType !== "account" && !creditSalesEnabled) {
      toast.error("ميزة البيع الآجل غير مفعّلة في ترخيصك");
      return;
    }

    const invLines: InvoiceLine[] = lines.map((l) => {
      const p = products.find((x) => x.id === l.productId)!;
      const ept = effectiveStockPriceType(l);
      const isRetailUnit = ept === "retail" && !!p.piecesPerUnit;
      // FIX-04: Preserve existing costPrice or fall back to current purchase price
      const existingLine = originalLinesById.get(l.id);
      const costPrice = existingLine?.costPrice ?? p.purchasePrice;
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
        costPrice,
        expiryDate: l.expiryDate,
        subtotal: l.quantity * l.price,
        isRetailUnit: isRetailUnit || undefined,
      };
    });

    const effectiveDueDate = paymentType === "account" && paymentDueDate ? paymentDueDate : undefined;
    // الفصل الكامل: نمرّر إجمالي المدفوع الفعلي كما هو (المستلم + أي فائض سابق)،
    // فيعيد الـ store توزيعه على المتبقي/الفائض حسب الإجمالي الجديد دون أي حركة
    // خزنة (cashDelta = 0). أي فرق يدفعه العميل يُسجَّل عبر "تسجيل دفعة".
    const carriedPaid = inv.amountReceived + (inv.overpayment ?? 0);

    updateSalesInvoice(inv.id, {
      invoiceNumber,
      date,
      driverId: driverId || undefined,
      driverName: driverId ? drivers.find((d) => d.id === driverId)?.name : undefined,
      lines: invLines,
      total: invoiceNet,
      discount: discount > 0 ? discount : undefined,
      amountReceived: carriedPaid,
      paymentType,
      priceType: aggregateSalesPriceType(invLines),
      paymentDueDate: effectiveDueDate,
      notes: notes.trim() || undefined,
      cancelled: inv.cancelled,
      createdByUserId: inv.createdByUserId,
    });

    dirtyRef.current = false;
    toast.success("تم تحديث الفاتورة");
    navigate(`/sales/${inv.id}`);
  }

  if (!inv) {
    return (
      <Card>
        <CardBody>
          <div className="text-center py-8 text-ink-faint">الفاتورة غير موجودة</div>
        </CardBody>
      </Card>
    );
  }

  // FIX-10: Block editing cancelled invoices with a clear message
  if (inv.cancelled) {
    return (
      <Card>
        <CardBody>
          <div className="text-center py-8 space-y-3">
            <div className="text-rose-600 dark:text-rose-400 font-semibold">هذه الفاتورة ملغاة ولا يمكن تعديلها</div>
            <Button variant="outline" onClick={() => navigate(`/sales/${inv.id}`)}>
              <ArrowRight className="w-4 h-4" /> العودة لتفاصيل الفاتورة
            </Button>
          </div>
        </CardBody>
      </Card>
    );
  }

  return (
    <>
      <PageHeader
        title={`تعديل فاتورة ${inv.invoiceNumber}`}
        description="تعديل بنود الفاتورة — المبلغ المدفوع يُحصَّل عبر «تسجيل دفعة» — العميل لا يمكن تغييره"
        actions={
          <>
            <Button variant="outline" onClick={() => navigate(`/sales/${inv.id}`)}>
              <ArrowRight className="w-4 h-4" /> إلغاء
            </Button>
            <Button onClick={submit}>
              <Save className="w-4 h-4" /> حفظ التعديلات
            </Button>
          </>
        }
      />

      {stockWarnings.length > 0 && (
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
      )}

      <Card>
        <CardHeader title="بيانات الفاتورة" />
        <CardBody>
          {/* Customer — read-only */}
          <div className="mb-4 bg-surface-muted border border-line rounded-lg px-4 py-3 text-sm text-ink-muted">
            <span className="text-ink-faint text-xs block mb-0.5">العميل (غير قابل للتعديل)</span>
            <div className="flex items-center justify-between">
              <span className="font-semibold text-ink">{inv.customerName}</span>
              {(() => {
                const bal = customerBalance(inv.customerId);
                if (bal === 0) return null;
                return (
                  <span className={`text-xs font-semibold ${bal > 0 ? "text-rose-600 dark:text-rose-400" : "text-emerald-700 dark:text-emerald-400"}`}>
                    {bal > 0
                      ? `مديون: ${formatCurrency(bal, settings.currency)}`
                      : `رصيد دائن: ${formatCurrency(-bal, settings.currency)}`}
                  </span>
                );
              })()}
            </div>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            <Field label="رقم الفاتورة">
              <Input
                value={invoiceNumber}
                readOnly
                className="bg-surface-muted cursor-not-allowed text-ink-faint opacity-70 font-mono"
              />
            </Field>
            <Field label="التاريخ" required>
              <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </Field>
            <Field label="السائق">
              <Select value={driverId} onChange={(e) => setDriverId(e.target.value)}>
                <option value="">— بدون سائق —</option>
                {drivers.map((d) => (
                  <option key={d.id} value={d.id}>{d.name}</option>
                ))}
              </Select>
            </Field>
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="بنود الفاتورة"
          actions={
            <Button size="sm" onClick={addLine}>
              <Plus className="w-3.5 h-3.5" /> إضافة بند
            </Button>
          }
        />
        <CardBody>
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
                    active={globalPriceType === "wholesale"}
                    onClick={() => changeGlobalPriceType("wholesale")}
                  />
                  <PriceTypeOption
                    label="تجزئة"
                    hint="الفاتورة كلها بسعر التجزئة"
                    active={globalPriceType === "retail"}
                    onClick={() => changeGlobalPriceType("retail")}
                  />
                </div>
              </div>
            </div>
          )}
          {lines.length === 0 ? (
            <div className="text-center py-8 text-sm text-ink-faint">
              لا توجد بنود.
              <div className="mt-3">
                <Button onClick={addLine}><Plus className="w-4 h-4" /> إضافة بند</Button>
              </div>
            </div>
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>المنتج</TH>
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
                  const ept = effectiveStockPriceType(l);
                  const currentBaseQty = quantityAsBaseUnits(p, l.quantity, ept);
                  const availableBase = p
                    ? (p.piecesPerUnit ? p.quantity * p.piecesPerUnit + (p.looseQuantity ?? 0) : p.quantity) +
                      (originalBaseQtyByProduct.get(l.productId) ?? 0)
                    : 0;
                  const otherDraftBaseQty = lines
                    .filter((ol) => ol.id !== l.id && ol.productId === l.productId)
                    .reduce((sum, ol) => {
                      const otherProduct = products.find((x) => x.id === ol.productId);
                      return sum + quantityAsBaseUnits(otherProduct, ol.quantity, effectiveStockPriceType(ol));
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
                      <TD>
                        <Select
                          value={l.productId}
                          onChange={(e) => updateLine(l.id, { productId: e.target.value })}
                          className="w-full"
                        >
                          <option value="">— اختر منتجاً —</option>
                          {products.map((pr) => (
                            <option key={pr.id} value={pr.id}>
                              {pr.name}{pr.category ? ` (${pr.category})` : ""} — {pr.code}
                            </option>
                          ))}
                        </Select>
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
                        ) : "—"}
                      </TD>
                      <TD>
                        <Input
                          type="number"
                          min={1}
                          value={l.quantity}
                          onChange={(e) =>
                            updateLine(l.id, {
                              quantity: Math.max(1, parseNumericInput(e.target.value, l.quantity)),
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
            {/* FIX-07: Lock payment type when returns exist to prevent inconsistent state */}
            <Field label="طريقة الدفع" required>
              <div className="flex items-center gap-4">
                <label className="flex items-center gap-2 text-sm">
                  <input type="radio" checked={paymentType === "cash"} onChange={() => setPaymentType("cash")} disabled={hasReturns} />
                  كاش
                </label>
                {(creditSalesEnabled || inv.paymentType === "account") && (
                  <label className="flex items-center gap-2 text-sm">
                    <input type="radio" checked={paymentType === "account"} onChange={() => setPaymentType("account")} disabled={hasReturns || !creditSalesEnabled} />
                    آجل (حساب)
                  </label>
                )}
              </div>
            </Field>
            {paymentType === "account" && (
              <Field label="تاريخ الاستحقاق" required>
                <Input type="date" value={paymentDueDate} onChange={(e) => setPaymentDueDate(e.target.value)} required />
              </Field>
            )}
            <Field label="المبلغ المدفوع (سابقاً)">
              <Input
                type="number"
                value={amountReceived}
                readOnly
                className="bg-surface-muted cursor-not-allowed text-ink-faint opacity-70"
              />
            </Field>
            <div className="bg-blue-50 dark:bg-blue-500/10 border border-blue-200 dark:border-blue-500/30 rounded-lg p-3 text-xs text-blue-800 dark:text-blue-400">
              التعديل هنا للبنود فقط، والمبلغ المدفوع لا يتغيّر. لو دفع العميل فرقاً بعد
              التعديل، سجّله من صفحة الفاتورة عبر <strong>«تسجيل دفعة»</strong>.
            </div>
            <Field label="ملاحظات">
              <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
            </Field>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="الملخص" />
          <CardBody className="space-y-2 text-sm">
            <div className="flex justify-between text-ink-muted">
              <span>إجمالي البنود</span>
              <span className="font-mono">{formatCurrency(gross, settings.currency)}</span>
            </div>
            <div className="flex items-center justify-between gap-2">
              <span className="text-ink-muted">خصم</span>
              <Input
                type="number"
                min={0}
                step="0.01"
                value={discount || ""}
                onChange={(e) =>
                  setDiscount(Math.max(0, parseNumericInput(e.target.value, discount)))
                }
                placeholder="0.00"
                className="w-28 h-8"
              />
            </div>
            {discount > 0 && (
              <div className="flex justify-between text-ink font-semibold">
                <span>صافي الفاتورة</span>
                <span className="font-mono">{formatCurrency(invoiceNet, settings.currency)}</span>
              </div>
            )}
            <div className="flex justify-between text-ink-muted">
              <span>المدفوع</span>
              <span className="font-mono">{formatCurrency(Math.min(amountReceived, invoiceNet), settings.currency)}</span>
            </div>
            <div className="border-t border-line pt-2 flex justify-between text-lg font-bold text-amber-700 dark:text-amber-400">
              <span>المتبقي</span>
              <span className="font-mono">{formatCurrency(Math.max(0, invoiceNet - amountReceived), settings.currency)}</span>
            </div>
            <div className="pt-2">
              <Button onClick={submit} size="lg" className="w-full">
                <Save className="w-4 h-4" /> حفظ التعديلات
              </Button>
            </div>
          </CardBody>
        </Card>
      </div>
      <ConfirmDialog
        open={blocker.state === "blocked"}
        onClose={() => blocker.reset?.()}
        onConfirm={() => blocker.proceed?.()}
        title="الخروج بدون حفظ؟"
        message="لديك تعديلات غير محفوظة. هل تريد الخروج وفقدان التغييرات؟"
        confirmText="خروج"
        variant="danger"
      />
    </>
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
