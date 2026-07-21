import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useBlocker, useNavigate, useParams } from "react-router-dom";
import { ArrowRight, Plus, Save, Trash2 } from "lucide-react";
import { PageHeader } from "../components/layout/AppLayout";
import { Card, CardBody, CardHeader } from "../components/ui/Card";
import { ConfirmDialog } from "../components/ui/Dialog";
import { Button } from "../components/ui/Button";
import { Field, Input, Select, Textarea } from "../components/ui/Input";
import { Table, TBody, TD, TH, THead, TR } from "../components/ui/Table";
import { useInvoicing } from "../store/InvoicingContext";
import { useCatalog } from "../store/CatalogContext";
import { useSettings } from "../store/SettingsContext";
import { useToast } from "../components/ui/Toast";
import { uid } from "../lib/utils";
import type { InvoiceLine } from "../types";
import { formatCurrency } from "../lib/format";

interface LineDraft {
  id: string;
  productId: string;
  quantity: number;
  price: number;
  expiryDate?: string;
}

export function PurchaseInvoiceEditPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const { purchaseInvoices, updatePurchaseInvoice } = useInvoicing();
  const { products } = useCatalog();
  const { settings } = useSettings();

  const inv = purchaseInvoices.find((i) => i.id === id);

  const [date, setDate] = useState(inv?.date ?? "");
  const [notes, setNotes] = useState(inv?.notes ?? "");
  const [lines, setLines] = useState<LineDraft[]>(
    () =>
      inv?.lines.map((l) => ({
        id: l.id,
        productId: l.productId,
        quantity: l.quantity,
        price: l.price,
        expiryDate: l.expiryDate,
      })) ?? []
  );

  const initializedRef = useRef(false);
  const dirtyRef = useRef(false);
  useEffect(() => {
    if (!initializedRef.current) { initializedRef.current = true; return; }
    dirtyRef.current = true;
  }, [date, notes, lines]);
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

  const supplierProducts = useMemo(
    () => products.filter((x) => !x.supplierId || x.supplierId === inv?.supplierId),
    [products, inv?.supplierId]
  );

  const total = useMemo(
    () => lines.reduce((a, l) => a + (l.quantity || 0) * (l.price || 0), 0),
    [lines]
  );

  function addLine() {
    setLines((l) => [...l, { id: uid("line"), productId: "", quantity: 1, price: 0 }]);
  }

  function updateLine(lineId: string, patch: Partial<LineDraft>) {
    setLines((arr) =>
      arr.map((l) => {
        if (l.id !== lineId) return l;
        const next = { ...l, ...patch };
        if (patch.productId !== undefined) {
          const p = products.find((x) => x.id === patch.productId);
          if (p) {
            next.price = p.purchasePrice;
            next.expiryDate = p.expiryDate;
          }
        }
        return next;
      })
    );
  }

  function removeLine(lineId: string) {
    setLines((arr) => arr.filter((l) => l.id !== lineId));
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

    const invLines: InvoiceLine[] = lines.map((l) => {
      const p = products.find((x) => x.id === l.productId)!;
      return {
        id: l.id,
        productId: p.id,
        productName: p.name,
        partNumber: p.partNumber,
        partBrand: p.partBrand,
        warrantyMonths: p.warrantyMonths,
        unit: p.unit,
        quantity: l.quantity,
        price: l.price,
        expiryDate: l.expiryDate,
        subtotal: l.quantity * l.price,
      };
    });

    updatePurchaseInvoice(inv.id, {
      lines: invLines,
      date,
      notes: notes.trim() || undefined,
    });

    dirtyRef.current = false;
    toast.success("تم تحديث الفاتورة");
    navigate(`/purchases/${inv.id}`);
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

  return (
    <>
      <PageHeader
        title={`تعديل فاتورة ${inv.invoiceNumber}`}
        description="تعديل بنود الفاتورة — المورد لا يمكن تغييره"
        actions={
          <>
            <Button variant="outline" onClick={() => navigate(`/purchases/${inv.id}`)}>
              <ArrowRight className="w-4 h-4" /> إلغاء
            </Button>
            <Button onClick={submit}>
              <Save className="w-4 h-4" /> حفظ التعديلات
            </Button>
          </>
        }
      />

      <Card>
        <CardHeader title="بيانات الفاتورة" />
        <CardBody>
          <div className="mb-4 bg-surface-muted border border-line rounded-lg px-4 py-3 text-sm text-ink-muted">
            <span className="text-ink-faint text-xs block mb-0.5">المورد (غير قابل للتعديل)</span>
            <span className="font-semibold text-ink">{inv.supplierName}</span>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="رقم الفاتورة">
              <Input
                value={inv.invoiceNumber}
                readOnly
                className="bg-surface-muted cursor-not-allowed text-ink-faint opacity-70 font-mono"
              />
            </Field>
            <Field label="التاريخ" required>
              <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
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
                  <TH className="w-24">الكمية</TH>
                  <TH className="w-28">سعر الشراء</TH>
                  <TH className="w-40">تاريخ صلاحية (اختياري)</TH>
                  <TH className="w-28 text-end">الإجمالي</TH>
                  <TH className="w-10"></TH>
                </TR>
              </THead>
              <TBody>
                {lines.map((l) => {
                  const p = products.find((x) => x.id === l.productId);
                  return (
                    <TR key={l.id}>
                      <TD>
                        <Select
                          value={l.productId}
                          onChange={(e) => updateLine(l.id, { productId: e.target.value })}
                          className="w-full"
                        >
                          <option value="">— اختر منتجاً —</option>
                          {supplierProducts.map((pr) => (
                            <option key={pr.id} value={pr.id}>
                              {pr.name}{pr.category ? ` (${pr.category})` : ""} — {pr.code}
                            </option>
                          ))}
                        </Select>
                      </TD>
                      <TD>
                        <Input
                          type="number"
                          min={1}
                          value={l.quantity}
                          onChange={(e) => updateLine(l.id, { quantity: Number(e.target.value) })}
                        />
                      </TD>
                      <TD>
                        <Input
                          type="number"
                          step="0.01"
                          min={0}
                          value={l.price}
                          onChange={(e) => updateLine(l.id, { price: Number(e.target.value) })}
                        />
                      </TD>
                      <TD>
                        <Input
                          type="date"
                          value={l.expiryDate ?? ""}
                          onChange={(e) =>
                            updateLine(l.id, { expiryDate: e.target.value || undefined })
                          }
                          disabled={!p?.hasExpiry}
                          title={!p?.hasExpiry ? "هذا المنتج بدون صلاحية" : ""}
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
          <CardHeader title="ملاحظات" />
          <CardBody>
            <Textarea
              rows={3}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="شروط السداد أو ملاحظات..."
            />
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="الملخص" />
          <CardBody className="space-y-2 text-sm">
            <div className="flex justify-between text-ink-muted">
              <span>إجمالي الفاتورة الجديد</span>
              <span className="font-mono">{formatCurrency(total, settings.currency)}</span>
            </div>
            <div className="flex justify-between text-ink-muted">
              <span>المدفوع سابقاً</span>
              <span className="font-mono">
                {formatCurrency(inv.amountPaid + (inv.overpayment ?? 0), settings.currency)}
              </span>
            </div>
            {(inv.overpayment ?? 0) > 0 && (
              <div className="flex justify-between text-emerald-700 dark:text-emerald-400 text-xs">
                <span>رصيد دائن للمورد</span>
                <span className="font-mono">{formatCurrency(inv.overpayment!, settings.currency)}</span>
              </div>
            )}
            <div className="border-t border-line pt-2 flex justify-between text-lg font-bold text-amber-700 dark:text-amber-400">
              <span>المتبقي</span>
              <span className="font-mono">
                {formatCurrency(Math.max(0, total - inv.amountPaid - (inv.overpayment ?? 0)), settings.currency)}
              </span>
            </div>
            <div className="bg-blue-50 dark:bg-blue-500/10 border border-blue-200 dark:border-blue-500/30 rounded-lg p-3 text-xs text-blue-800 dark:text-blue-400">
              التعديل هنا للبنود فقط، والمبلغ المدفوع لا يتغيّر. أي فرق بعد التعديل يُسجَّل من صفحة الفاتورة عبر <strong>«تسجيل دفعة»</strong>.
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
