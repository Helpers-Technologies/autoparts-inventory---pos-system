import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useBlocker, useLocation, useNavigate } from "react-router-dom";
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
import { todayISO, uid } from "../lib/utils";
import type { InvoiceLine, Product } from "../types";
import { formatCurrency } from "../lib/format";
import { BarcodeScanInput } from "../features/products/BarcodeScanInput";
import { findProductScanCandidates } from "../lib/partSearch";
import { ProductFormDialog } from "../features/products/ProductForm";
import { SupplierFormDialog } from "../features/suppliers/SupplierForm";
import { useAuth } from "../store/AuthContext";
import { hasPermission } from "../lib/permissions";
import { useFeatures } from "../lib/useFeatures";
import { SearchableProductSelect } from "../components/ui/SearchableProductSelect";
import { useAutoPartsPro } from "../store/AutoPartsProContext";

interface LineDraft {
  id: string;
  productId: string;
  quantity: number;
  price: number;
  expiryDate?: string;
}

function nextInvoiceNumber(existing: string[]): string {
  const nums = existing
    .map((x) => parseInt(x.replace(/\D/g, ""), 10))
    .filter((n) => !Number.isNaN(n));
  const currentMax = nums.length ? Math.max(...nums) + 1 : 1;
  const storedMax = parseInt(localStorage.getItem("seq_purchase_invoice") || "0", 10);
  const absoluteMax = Math.max(currentMax, storedMax + 1);
  return `PO-${String(absoluteMax).padStart(5, "0")}`;
}

export function PurchaseInvoiceNewPage() {
  const { products: allProducts, suppliers: allSuppliers } = useCatalog();
  const products = useMemo(() => allProducts.filter((p) => !p.archived), [allProducts]);
  const suppliers = useMemo(() => allSuppliers.filter((s) => !s.archived), [allSuppliers]);
  const { purchaseInvoices, addPurchaseInvoice } = useInvoicing();
  const { settings } = useSettings();
  const { isEnabled } = useFeatures();
  const expiryTrackingEnabled = isEnabled("expiryTracking");
  const { currentUser } = useAuth();
  const pro = useAutoPartsPro();
  const activeBranches = useMemo(() => pro.branches.filter((b) => b.active), [pro.branches]);
  const canAddProduct = hasPermission(currentUser, "products", "add");
  const canAddSupplier = hasPermission(currentUser, "suppliers", "add");
  const navigate = useNavigate();
  const location = useLocation();
  const toast = useToast();

  const [invoiceNumber] = useState(() =>
    nextInvoiceNumber(purchaseInvoices.map((s) => s.invoiceNumber))
  );
  const [date, setDate] = useState(() => todayISO());
  const [supplierId, setSupplierId] = useState(suppliers[0]?.id ?? "");
  const [branchId, setBranchId] = useState(() =>
    currentUser?.branchId ?? activeBranches.find((b) => b.isMain)?.id ?? activeBranches[0]?.id ?? ""
  );
  const [amountPaid, setAmountPaid] = useState<number>(0);
  const [notes, setNotes] = useState("");

  function handleSupplierChange(id: string) {
    setSupplierId(id);
    setLines((prev) =>
      prev.filter((l) => {
        const p = products.find((x) => x.id === l.productId);
        return !p || !p.supplierId || p.supplierId === id;
      })
    );
  }
  const [lines, setLines] = useState<LineDraft[]>([]);
  // Line id currently waiting for a freshly-created product to be slotted in.
  const [newProductForLine, setNewProductForLine] = useState<string | null>(null);
  const [supplierDialogOpen, setSupplierDialogOpen] = useState(false);
  const isDirtyRef = useRef(false);
  useEffect(() => { isDirtyRef.current = lines.length > 0; }, [lines]);
  const blocker = useBlocker(useCallback(() => isDirtyRef.current, []));

  useEffect(() => {
    if (!supplierId && suppliers[0]) setSupplierId(suppliers[0].id);
  }, [suppliers, supplierId]);

  // Load passed state from Purchasing Assistant plan
  useEffect(() => {
    const state = location.state as {
      supplierId?: string;
      lines?: { productId: string; quantity: number; price: number; expiryDate?: string }[];
    } | null;

    if (state?.lines && state.lines.length > 0) {
      if (state.supplierId) {
        setSupplierId(state.supplierId);
      }
      const draftLines: LineDraft[] = state.lines.map((l) => ({
        id: uid("line"),
        productId: l.productId,
        quantity: l.quantity,
        price: l.price,
        expiryDate: l.expiryDate,
      }));
      setLines(draftLines);
      toast.info("تم نقل خطة إعادة الطلب إلى الفاتورة", `${draftLines.length} صنف تم إدراجها تلقائيًا.`);
    }
  }, []);

  const total = useMemo(
    () => lines.reduce((a, l) => a + (l.quantity || 0) * (l.price || 0), 0),
    [lines]
  );

  function getLatestPurchasePrice(p: Product): number {
    const lastLine = purchaseInvoices
      .flatMap((inv) => inv.lines)
      .filter((l) => l.productId === p.id && l.price > 0)
      .pop();
    return lastLine?.price ?? p.purchasePrice ?? 0;
  }

  function addLine(productId?: string) {
    const p = productId ? products.find((x) => x.id === productId) : undefined;
    setLines((l) => [
      ...l,
      {
        id: uid("line"),
        productId: p?.id ?? "",
        quantity: 1,
        price: p ? getLatestPurchasePrice(p) : 0,
        expiryDate: p?.expiryDate,
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
    const wasExisting = lines.some((l) => l.productId === product.id);
    // Functional update keeps rapid consecutive scans of the same item accurate.
    setLines((arr) => {
      const existing = arr.find((l) => l.productId === product.id);
      if (existing) {
        return arr.map((l) =>
          l.id === existing.id ? { ...l, quantity: l.quantity + 1 } : l
        );
      }
      return [
        ...arr,
        {
          id: uid("line"),
          productId: product.id,
          quantity: 1,
          price: getLatestPurchasePrice(product),
          expiryDate: product.expiryDate,
        },
      ];
    });
    toast.success(wasExisting ? "تم تحديث الكمية" : "تمت إضافة المنتج", product.name);
  }

  function updateLine(id: string, patch: Partial<LineDraft>) {
    setLines((arr) =>
      arr.map((l) => {
        if (l.id !== id) return l;
        const next = { ...l, ...patch };
        if (patch.productId !== undefined) {
          const p = products.find((x) => x.id === patch.productId);
          if (p) {
            next.price = getLatestPurchasePrice(p);
            next.expiryDate = p.expiryDate;
          }
        }
        return next;
      })
    );
  }
  function removeLine(id: string) {
    setLines((arr) => arr.filter((l) => l.id !== id));
  }

  function submit() {
    if (!supplierId) {
      toast.error("اختر المورد");
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
    if (amountPaid < 0 || amountPaid > total) {
      toast.error("المبلغ المدفوع غير صحيح");
      return;
    }
    if (activeBranches.length > 0 && !branchId) {
      toast.error("اختر فرع الاستلام");
      return;
    }

    const supplier = suppliers.find((s) => s.id === supplierId)!;
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
        expiryDate: expiryTrackingEnabled ? l.expiryDate : undefined,
        subtotal: l.quantity * l.price,
      };
    });

    const inv = addPurchaseInvoice({
      invoiceNumber,
      date,
      supplierId,
      supplierName: supplier.name,
      lines: invLines,
      total,
      amountPaid,
      branchId: branchId || undefined,
      notes: notes.trim() || undefined,
    });

    // Route the received stock to the receiving branch itself, instead of
    // letting the branch-stock reconciler dump the new quantity on main.
    if (branchId) {
      pro.receivePurchaseStock(branchId, invLines.map((line) => ({ productId: line.productId, quantity: line.quantity })));
    }

    const issuedNum = parseInt(inv.invoiceNumber.replace(/\D/g, ""), 10);
    if (!Number.isNaN(issuedNum)) {
      const storedMax = parseInt(localStorage.getItem("seq_purchase_invoice") || "0", 10);
      localStorage.setItem("seq_purchase_invoice", Math.max(storedMax, issuedNum).toString());
    }

    isDirtyRef.current = false;
    toast.success("تم حفظ الفاتورة", `تم إضافة الكميات للمخزون`);
    navigate(`/purchases/${inv.id}`);
  }

  return (
    <>
      <PageHeader
        title="فاتورة مشتريات جديدة"
        description="أدخل بنود فاتورة المورد — يتم زيادة الكميات في المخزون تلقائياً عند الحفظ."
        actions={
          <>
            <Button variant="outline" onClick={() => navigate("/purchases")}>
              <ArrowRight className="w-4 h-4" />
              رجوع
            </Button>
            <Button onClick={submit}>
              <Save className="w-4 h-4" /> حفظ الفاتورة
            </Button>
          </>
        }
      />

      <Card>
        <CardHeader title="بيانات الفاتورة" />
        <CardBody>
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
            <Field label="المورد" required>
              <div className="flex items-center gap-1.5">
                <Select aria-label="المورد" value={supplierId} onChange={(e) => handleSupplierChange(e.target.value)} className="flex-1">
                  {suppliers.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </Select>
                {canAddSupplier && (
                  <Button
                    size="icon"
                    variant="outline"
                    className="shrink-0"
                    onClick={() => setSupplierDialogOpen(true)}
                    title="إضافة مورد جديد"
                  >
                    <Plus className="w-4 h-4" />
                  </Button>
                )}
              </div>
            </Field>
            {activeBranches.length > 1 ? (
              <Field label="فرع الاستلام" required hint="الكمية المضافة هتتحسب على مخزون هذا الفرع تحديدًا">
                <Select aria-label="فرع الاستلام" value={branchId} onChange={(e) => setBranchId(e.target.value)}>
                  {activeBranches.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  ))}
                </Select>
              </Field>
            ) : null}
          </div>
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
                  <TH>المنتج</TH>
                  <TH className="w-24">الكمية</TH>
                  <TH className="w-28">سعر الشراء</TH>
                  {expiryTrackingEnabled && <TH className="w-40">تاريخ صلاحية (اختياري)</TH>}
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
                        <div className="flex items-center gap-1.5">
                          <ProductCombo
                            products={products.filter(
                              (x) => !x.supplierId || x.supplierId === supplierId
                            )}
                            value={l.productId}
                            onChange={(pid) => updateLine(l.id, { productId: pid })}
                          />
                          {canAddProduct && (
                            <Button
                              size="icon"
                              variant="outline"
                              className="shrink-0"
                              onClick={() => setNewProductForLine(l.id)}
                              title="إضافة منتج جديد"
                            >
                              <Plus className="w-4 h-4" />
                            </Button>
                          )}
                        </div>
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
                      {expiryTrackingEnabled && (
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
                      )}
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
            <Field label="المبلغ المدفوع للمورد">
              <Input
                type="number"
                min={0}
                step="0.01"
                max={total}
                value={amountPaid}
                onChange={(e) => setAmountPaid(Number(e.target.value))}
              />
            </Field>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={() => setAmountPaid(0)}>
                آجل بالكامل
              </Button>
              <Button variant="outline" size="sm" onClick={() => setAmountPaid(total)}>
                مدفوع بالكامل
              </Button>
            </div>
            <Field label="ملاحظات">
              <Textarea
                rows={2}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="شروط السداد أو ملاحظات..."
              />
            </Field>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="الملخص" />
          <CardBody className="space-y-2">
            <Row label="إجمالي الفاتورة" value={formatCurrency(total, settings.currency)} />
            <Row label="المدفوع" value={formatCurrency(amountPaid, settings.currency)} />
            <div className="border-t border-line pt-2">
              <Row
                label="المتبقي للمورد"
                bold
                value={formatCurrency(Math.max(0, total - amountPaid), settings.currency)}
                tone="amber"
              />
            </div>
            <div className="pt-2">
              <Button onClick={submit} size="lg" className="w-full">
                <Save className="w-4 h-4" /> حفظ الفاتورة
              </Button>
            </div>
          </CardBody>
        </Card>
      </div>
      <SupplierFormDialog
        open={supplierDialogOpen}
        onClose={() => setSupplierDialogOpen(false)}
        onCreated={(created) => setSupplierId(created.id)}
      />
      <ProductFormDialog
        open={newProductForLine !== null}
        onClose={() => setNewProductForLine(null)}
        defaultSupplierId={supplierId || undefined}
        onCreated={(created) => {
          if (newProductForLine) {
            // products list isn't re-rendered yet, so set price/expiry from the new product directly.
            updateLine(newProductForLine, {
              productId: created.id,
              price: created.purchasePrice,
              expiryDate: expiryTrackingEnabled ? created.expiryDate : undefined,
            });
          }
        }}
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
    <SearchableProductSelect
      products={products}
      value={value}
      onChange={onChange}
      placeholder="— اختر منتجاً أو ابحث —"
      showStock
    />
  );
}

function Row({
  label,
  value,
  bold,
  tone,
}: {
  label: string;
  value: string;
  bold?: boolean;
  tone?: "amber";
}) {
  return (
    <div
      className={`flex items-center justify-between ${
        bold ? "text-lg font-bold" : "text-sm"
      } ${tone === "amber" ? "text-amber-700 dark:text-amber-400" : "text-ink-muted"}`}
    >
      <span>{label}</span>
      <span>{value}</span>
    </div>
  );
}
