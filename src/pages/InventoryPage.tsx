import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  AlertTriangle,
  CalendarClock,
  CalendarX,
  Package,
  Plus,
  Minus,
  Search,
  Warehouse,
} from "lucide-react";
import { PageHeader } from "../components/layout/AppLayout";
import { Card, CardBody, CardHeader } from "../components/ui/Card";
import { Button } from "../components/ui/Button";
import { Badge } from "../components/ui/Badge";
import { Input, Select, Field, Textarea } from "../components/ui/Input";
import { Table, TBody, TD, TH, THead, TR } from "../components/ui/Table";
import { EmptyState } from "../components/ui/EmptyState";
import { Dialog } from "../components/ui/Dialog";
import { useCatalog } from "../store/CatalogContext";
import { useInvoicing } from "../store/InvoicingContext";
import { useAuth } from "../store/AuthContext";
import { useSettings } from "../store/SettingsContext";
import { useToast } from "../components/ui/Toast";
import { daysUntil } from "../lib/utils";
import { formatDate } from "../lib/format";
import { formatStockMovementReference } from "../lib/stockMovement";
import type { Product } from "../types";
import { hasPermission } from "../lib/permissions";
import { useFeatures } from "../lib/useFeatures";
import { BarcodeScanInput } from "../features/products/BarcodeScanInput";
import { findProductScanCandidates, productMatchesSearch } from "../lib/partSearch";

export function InventoryPage() {
  const { products, suppliers, adjustStock } = useCatalog();
  const { stockMovements, salesInvoices, purchaseInvoices, salesReturns, purchaseReturns } = useInvoicing();
  const { currentUser } = useAuth();
  const { settings } = useSettings();
  const { isEnabled } = useFeatures();
  const expiryTrackingEnabled = isEnabled("expiryTracking");
  const toast = useToast();
  const canAdjustStock = hasPermission(currentUser, "inventory", "adjust");
  const [q, setQ] = useState("");
  const [category, setCategory] = useState("");
  const [supplier, setSupplier] = useState("");
  const [qtyFilter, setQtyFilter] = useState<"all" | "available" | "low" | "zero">("all");
  const [expiryFilter, setExpiryFilter] = useState<"all" | "valid" | "soon" | "expired">("all");

  const [adjustTarget, setAdjustTarget] = useState<Product | null>(null);
  const [adjType, setAdjType] = useState<"in" | "out">("in");
  const [adjQty, setAdjQty] = useState(0);
  const [adjLooseQty, setAdjLooseQty] = useState(0);
  const [adjReason, setAdjReason] = useState("");

  const categories = useMemo(
    () => Array.from(new Set(products.map((p) => p.category))),
    [products]
  );

  const counts = useMemo(() => {
    const low = products.filter((p) => p.quantity <= p.minStock).length;
    const soon = expiryTrackingEnabled ? products.filter((p) => {
      if (!p.hasExpiry || !p.expiryDate) return false;
      const du = daysUntil(p.expiryDate);
      return du !== null && du >= 0 && du <= 14;
    }).length : 0;
    const expired = expiryTrackingEnabled ? products.filter((p) => {
      if (!p.hasExpiry || !p.expiryDate) return false;
      const du = daysUntil(p.expiryDate);
      return du !== null && du < 0;
    }).length : 0;
    return { low, soon, expired };
  }, [products, expiryTrackingEnabled]);

  const filtered = useMemo(() => {
    let list = products;
    if (q.trim()) {
      list = list.filter((p) => productMatchesSearch(p, q));
    }
    if (category) list = list.filter((p) => p.category === category);
    if (supplier) list = list.filter((p) => p.supplierId === supplier);
    if (qtyFilter === "low") list = list.filter((p) => p.quantity > 0 && p.quantity <= p.minStock);
    if (qtyFilter === "zero") list = list.filter((p) => p.quantity === 0);
    if (qtyFilter === "available") list = list.filter((p) => p.quantity > p.minStock);
    if (expiryTrackingEnabled && expiryFilter === "soon")
      list = list.filter((p) => {
        if (!p.hasExpiry || !p.expiryDate) return false;
        const du = daysUntil(p.expiryDate);
        return du !== null && du >= 0 && du <= 14;
      });
    if (expiryTrackingEnabled && expiryFilter === "expired")
      list = list.filter((p) => {
        if (!p.hasExpiry || !p.expiryDate) return false;
        const du = daysUntil(p.expiryDate);
        return du !== null && du < 0;
      });
    if (expiryTrackingEnabled && expiryFilter === "valid")
      list = list.filter((p) => {
        if (!p.hasExpiry || !p.expiryDate) return true;
        const du = daysUntil(p.expiryDate);
        return du !== null && du > 14;
      });
    return list;
  }, [products, q, category, supplier, qtyFilter, expiryFilter, expiryTrackingEnabled]);

  function submitAdjust() {
    if (!adjustTarget) return;
    if (!adjQty || adjQty <= 0) {
      toast.error("الكمية يجب أن تكون أكبر من صفر");
      return;
    }
    if (!adjReason.trim()) {
      toast.error("السبب مطلوب");
      return;
    }
    if (!canAdjustStock) {
      toast.error("ليس لديك صلاحية", "لا تملك صلاحية ضبط المخزون");
      return;
    }
    const delta = adjType === "in" ? adjQty : -adjQty;
    const looseDelta = adjustTarget.piecesPerUnit
      ? (adjType === "in" ? adjLooseQty : -adjLooseQty)
      : undefined;
    adjustStock(adjustTarget.id, delta, adjReason.trim(), looseDelta);
    toast.success(
      adjType === "in" ? "تم إضافة الكمية" : "تم خصم الكمية",
      `${adjustTarget.name}: ${delta > 0 ? "+" : ""}${delta} ${adjustTarget.unit}`
    );
    setAdjustTarget(null);
    setAdjQty(0);
    setAdjLooseQty(0);
    setAdjReason("");
    setAdjType("in");
  }

  function handleInventoryScan(code: string) {
    const candidates = findProductScanCandidates(products, code);
    if (candidates.length > 1) {
      setQ(code);
      toast.info(`يوجد ${candidates.length} بدائل لهذا الرقم`, "اختر القطعة المطلوبة من جدول المخزون");
      return;
    }
    const match = candidates[0];
    if (!match) {
      toast.error("القطعة غير موجودة", `لا يوجد باركود أو Part Number أو OEM مطابق: ${code}`);
      return;
    }
    if (!canAdjustStock) {
      setQ(match.product.partNumber || match.product.code);
      toast.info("تم العثور على القطعة", match.product.name);
      return;
    }
    setAdjustTarget(match.product);
    setAdjType("in");
    setAdjQty(1);
    setAdjLooseQty(0);
    setAdjReason("استلام مخزون بالاسكان");
    toast.success("تم التعرف على القطعة", `${match.product.name} — ${match.product.rackLocation || "موقع الرف غير محدد"}`);
  }

  const [movQ, setMovQ] = useState("");
  const [movType, setMovType] = useState("all");
  const [movDateFrom, setMovDateFrom] = useState("");
  const [movDateTo, setMovDateTo] = useState("");

  const filteredMovements = useMemo(() => {
    let list = [...stockMovements];
    if (movQ.trim()) {
      const q = movQ.trim().toLowerCase();
      list = list.filter((m) => m.productName?.toLowerCase().includes(q));
    }
    if (movType !== "all") {
      list = list.filter((m) =>
        movType === "return" ? m.type === "return" : m.type === movType
      );
    }
    if (movDateFrom) {
      list = list.filter((m) => m.date >= movDateFrom);
    }
    if (movDateTo) {
      list = list.filter((m) => m.date <= movDateTo);
    }
    return list.slice(0, 100);
  }, [stockMovements, movQ, movType, movDateFrom, movDateTo]);

  return (
    <>
      <PageHeader
        title="المخزون"
        description="الكميات الحالية، التنبيهات، وضبط المخزون اليدوي"
      />

      <Card>
        <CardBody className="flex flex-col md:flex-row md:items-center gap-3">
          <div className="min-w-48"><div className="text-sm font-semibold">اسكان المخزون السريع</div><div className="text-xs text-ink-muted">يمسح الباركود أو رقم القطعة أو OEM ويفتح حركة إضافة مباشرة</div></div>
          <BarcodeScanInput onScan={handleInventoryScan} disabled={products.length === 0} className="flex-1" />
        </CardBody>
      </Card>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardBody className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-amber-50 dark:bg-amber-500/10 text-amber-600 dark:text-amber-400 dark:bg-amber-500/15 dark:text-amber-300 grid place-items-center">
              <AlertTriangle className="w-5 h-5" />
            </div>
            <div>
              <div className="text-xs text-ink-muted">منتجات قليلة المخزون</div>
              <div className="text-xl font-semibold">{counts.low}</div>
            </div>
          </CardBody>
        </Card>
        {expiryTrackingEnabled && (
          <>
            <Card>
              <CardBody className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-rose-50 dark:bg-rose-500/10 text-rose-600 dark:text-rose-400 dark:bg-rose-500/15 dark:text-rose-300 grid place-items-center">
                  <CalendarClock className="w-5 h-5" />
                </div>
                <div>
                  <div className="text-xs text-ink-muted">قارب على الانتهاء (14 يوم)</div>
                  <div className="text-xl font-semibold">{counts.soon}</div>
                </div>
              </CardBody>
            </Card>
            <Card>
              <CardBody className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-red-100 text-red-700 dark:text-red-400 dark:bg-red-500/15 dark:text-red-300 grid place-items-center">
                  <CalendarX className="w-5 h-5" />
                </div>
                <div>
                  <div className="text-xs text-ink-muted">منتهي الصلاحية</div>
                  <div className="text-xl font-semibold">{counts.expired}</div>
                </div>
              </CardBody>
            </Card>
          </>
        )}
      </div>

      <Card>
        <CardHeader
          title="قائمة المخزون"
          subtitle="كمية، وحدة، حد أدنى، حالة"
        />
        <CardBody className="space-y-3">
          <div className="flex gap-2 items-center">
            <div className="relative w-52">
              <Search className="w-4 h-4 absolute top-1/2 -translate-y-1/2 end-3 text-ink-faint" />
              <Input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="بحث عن منتج..."
                className="pe-9"
              />
            </div>
            <Select value={category} onChange={(e) => setCategory(e.target.value)} className="w-36">
              <option value="">كل الفئات</option>
              {categories.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </Select>
            <Select value={supplier} onChange={(e) => setSupplier(e.target.value)} className="w-40">
              <option value="">كل الموردين</option>
              {suppliers.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </Select>
            <div className="inline-flex items-center gap-1 bg-surface-muted p-1 rounded-lg">
                <span className="px-2 text-xs text-ink-faint select-none">الكمية:</span>
                {([
                  { key: "all", label: "الكل" },
                  { key: "available", label: "متوفر" },
                  { key: "low", label: "منخفض" },
                  { key: "zero", label: "نفد" },
                ] as const).map((b) => (
                  <button
                    key={b.key}
                    onClick={() => setQtyFilter(b.key)}
                    className={`px-3 h-8 text-xs rounded-md ${
                      qtyFilter === b.key
                        ? "bg-surface text-brand-700 shadow-sm"
                        : "text-ink-muted"
                    }`}
                  >
                    {b.label}
                  </button>
                ))}
              </div>
              {expiryTrackingEnabled && (
              <div className="inline-flex items-center gap-1 bg-surface-muted p-1 rounded-lg">
                <span className="px-2 text-xs text-ink-faint select-none">الصلاحية:</span>
                {([
                  { key: "all", label: "الكل" },
                  { key: "valid", label: "صالح" },
                  { key: "soon", label: "قارب ينتهي" },
                  { key: "expired", label: "منتهي" },
                ] as const).map((b) => (
                  <button
                    key={b.key}
                    onClick={() => setExpiryFilter(b.key)}
                    className={`px-3 h-8 text-xs rounded-md ${
                      expiryFilter === b.key
                        ? "bg-surface text-brand-700 shadow-sm"
                        : "text-ink-muted"
                    }`}
                  >
                    {b.label}
                  </button>
                ))}
              </div>
              )}
          </div>

          {filtered.length === 0 ? (
            <EmptyState
              icon={<Warehouse className="w-5 h-5" />}
              title={
                expiryFilter === "expired" ? "لا توجد منتجات منتهية الصلاحية" :
                expiryFilter === "soon" ? "لا توجد منتجات قاربت على الانتهاء" :
                qtyFilter === "low" ? "لا توجد منتجات منخفضة المخزون" :
                qtyFilter === "zero" ? "لا توجد منتجات نفدت كميتها" :
                "لا توجد منتجات"
              }
            />
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>رقم القطعة / الموقع</TH>
                  <TH>المنتج</TH>
                  <TH>الفئة</TH>
                  <TH className="text-end">الكمية</TH>
                  <TH className="text-end">الحد الأدنى</TH>
                  {expiryTrackingEnabled && <TH>الصلاحية</TH>}
                  <TH>حالة الكمية</TH>
                  {expiryTrackingEnabled && <TH>حالة الصلاحية</TH>}
                  {canAdjustStock ? <TH className="text-end">ضبط المخزون</TH> : null}
                </TR>
              </THead>
              <TBody>
                {filtered.map((p) => {
                  const du = daysUntil(p.expiryDate);
                  const low = p.quantity <= p.minStock;
                  const expired = p.hasExpiry && du !== null && du < 0;
                  const soon =
                    p.hasExpiry && du !== null && du >= 0 && du <= 14;
                  return (
                    <TR key={p.id}>
                      <TD><div className="font-mono text-xs" dir="ltr">{p.partNumber || p.code}</div><div className="text-[11px] text-ink-faint font-mono" dir="ltr">{p.rackLocation || "—"}</div></TD>
                      <TD className="font-medium text-ink">{p.name}</TD>
                      <TD className="text-ink-muted">{p.category}</TD>
                      <TD className="text-end font-semibold">
                        {p.piecesPerUnit
                          ? `${p.quantity} ${p.unit}${p.looseQuantity ? ` + ${p.looseQuantity} ${p.retailUnit ?? "قطعة"}` : ""}`
                          : `${p.quantity} ${p.unit}`}
                      </TD>
                      <TD className="text-end text-ink-muted">{p.minStock}</TD>
                      {expiryTrackingEnabled && (
                        <TD className="text-ink-muted text-xs">
                          {p.hasExpiry && p.expiryDate ? formatDate(p.expiryDate) : "—"}
                        </TD>
                      )}
                      <TD>
                        {p.quantity === 0
                          ? <Badge tone="red">نفد</Badge>
                          : low
                          ? <Badge tone="amber">منخفض</Badge>
                          : <Badge tone="green">متوفر</Badge>}
                      </TD>
                      {expiryTrackingEnabled && (
                        <TD>
                          {!p.hasExpiry || !p.expiryDate
                            ? <span className="text-ink-faint text-xs">—</span>
                            : expired
                            ? <Badge tone="red">منتهي</Badge>
                            : soon
                            ? <Badge tone="rose">قريب ينتهي</Badge>
                            : <Badge tone="green">سليمة</Badge>}
                        </TD>
                      )}
                      {canAdjustStock ? (
                        <TD className="text-end">
                          <div className="inline-flex items-center gap-1">
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => {
                                setAdjustTarget(p);
                                setAdjType("in");
                              }}
                            >
                              <Plus className="w-3.5 h-3.5" />
                              إضافة
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => {
                                setAdjustTarget(p);
                                setAdjType("out");
                              }}
                            >
                              <Minus className="w-3.5 h-3.5" />
                              خصم
                            </Button>
                          </div>
                        </TD>
                      ) : null}
                    </TR>
                  );
                })}
              </TBody>
            </Table>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="سجل حركات المخزون" subtitle={`${filteredMovements.length} حركة`} />
        <CardBody className="space-y-3">
          <div className="flex gap-2 items-center">
            <div className="relative w-52">
              <Search className="w-4 h-4 absolute top-1/2 -translate-y-1/2 end-3 text-ink-faint" />
              <Input
                value={movQ}
                onChange={(e) => setMovQ(e.target.value)}
                placeholder="بحث بالمنتج..."
                className="pe-9"
              />
            </div>
            <div className="inline-flex items-center gap-1 bg-surface-muted p-1 rounded-lg">
              <span className="px-2 text-xs text-ink-faint select-none">النوع:</span>
              {([
                { key: "all",            label: "الكل" },
                { key: "sale",           label: "بيع" },
                { key: "purchase",       label: "شراء" },
                { key: "return",         label: "مرتجع" },
                { key: "adjustment-in",  label: "تعديل +" },
                { key: "adjustment-out", label: "تعديل -" },
              ] as const).map((b) => (
                <button
                  key={b.key}
                  onClick={() => setMovType(b.key)}
                  className={`px-3 h-8 text-xs rounded-md transition-colors ${
                    movType === b.key
                      ? "bg-surface text-brand-700 shadow-sm"
                      : "text-ink-muted hover:text-ink"
                  }`}
                >
                  {b.label}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-1 bg-surface-muted px-3 py-1.5 rounded-lg">
              <span className="text-xs text-ink-faint select-none">من:</span>
              <input
                type="date"
                value={movDateFrom}
                onChange={(e) => setMovDateFrom(e.target.value)}
                className="bg-transparent text-xs text-ink outline-none w-28"
              />
            </div>
            <div className="flex items-center gap-1 bg-surface-muted px-3 py-1.5 rounded-lg">
              <span className="text-xs text-ink-faint select-none">إلى:</span>
              <input
                type="date"
                value={movDateTo}
                onChange={(e) => setMovDateTo(e.target.value)}
                className="bg-transparent text-xs text-ink outline-none w-28"
              />
            </div>
            {(movDateFrom || movDateTo) && (
              <button
                type="button"
                onClick={() => { setMovDateFrom(""); setMovDateTo(""); }}
                className="text-xs text-ink-faint hover:text-ink transition-colors"
              >
                مسح
              </button>
            )}
          </div>
          {filteredMovements.length === 0 ? (
            <EmptyState
              icon={<Package className="w-5 h-5" />}
              title="لا توجد حركات"
            />
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>التاريخ</TH>
                  <TH>المنتج</TH>
                  <TH>النوع</TH>
                  <TH className="text-end">الكمية</TH>
                  <TH>السبب / المرجع</TH>
                </TR>
              </THead>
              <TBody>
                {filteredMovements.map((m) => (
                  <TR key={m.id}>
                    <TD>{formatDate(m.date)}</TD>
                    <TD className="text-ink">{m.productName}</TD>
                    <TD>
                      <Badge
                        tone={
                          m.type === "purchase"
                            ? "blue"
                            : m.type === "sale"
                            ? "green"
                            : m.type === "adjustment-in"
                            ? "emerald"
                            : m.type === "adjustment-out"
                            ? "rose"
                            : "amber"
                        }
                      >
                        {m.type === "purchase"
                          ? "شراء"
                          : m.type === "sale"
                          ? "بيع"
                          : m.type === "adjustment-in"
                          ? "تعديل زائد"
                          : m.type === "adjustment-out"
                          ? "تعديل ناقص"
                          : "مرتجع"}
                      </Badge>
                    </TD>
                    <TD
                      className={`text-end font-medium ${
                        m.quantity >= 0 ? "text-emerald-700 dark:text-emerald-400" : "text-rose-700 dark:text-rose-400"
                      }`}
                    >
                      {m.quantity > 0 ? "+" : ""}
                      {m.quantity}
                    </TD>
                    <TD className="text-xs">
                      {(() => {
                        const refText = formatStockMovementReference(m, {
                          salesInvoices,
                          purchaseInvoices,
                          salesReturns,
                          purchaseReturns,
                        });
                        if (!m.referenceId)
                          return <span className="text-ink-muted">{refText}</span>;

                        let to = "";
                        if (m.type === "sale" || m.referenceType === "sale")
                          to = `/sales/${m.referenceId}`;
                        else if (
                          m.type === "purchase" ||
                          m.referenceType === "purchase"
                        )
                          to = `/purchases/${m.referenceId}`;
                        else if (m.type === "return") to = "/returns";

                        if (!to)
                          return <span className="text-ink-muted">{refText}</span>;
                        return (
                          <Link
                            to={to}
                            className="text-brand-600 hover:text-brand-800 hover:underline font-medium"
                          >
                            {refText}
                          </Link>
                        );
                      })()}
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </CardBody>
      </Card>

      <Dialog
        open={!!adjustTarget}
        onClose={() => setAdjustTarget(null)}
        title={`ضبط مخزون: ${adjustTarget?.name ?? ""}`}
        subtitle={
          adjustTarget?.piecesPerUnit
            ? `الكمية الحالية: ${adjustTarget.quantity} ${adjustTarget.unit}${adjustTarget.looseQuantity ? ` + ${adjustTarget.looseQuantity} ${adjustTarget.retailUnit ?? "قطعة"}` : ""}`
            : `الكمية الحالية: ${adjustTarget?.quantity} ${adjustTarget?.unit}`
        }
        width="md"
        footer={
          <>
            <Button variant="outline" onClick={() => setAdjustTarget(null)}>
              إلغاء
            </Button>
            <Button onClick={submitAdjust}>حفظ</Button>
          </>
        }
      >
        <div className="space-y-3">
          <Field label="نوع التعديل">
            <div className="flex items-center gap-2">
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="radio"
                  checked={adjType === "in"}
                  onChange={() => setAdjType("in")}
                />
                إضافة للمخزون
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="radio"
                  checked={adjType === "out"}
                  onChange={() => setAdjType("out")}
                />
                خصم من المخزون
              </label>
            </div>
          </Field>
          <Field label={`الكمية (${adjustTarget?.unit ?? ""})`} required>
            <Input
              type="number"
              min={0}
              value={adjQty || ""}
              onChange={(e) => setAdjQty(Number(e.target.value))}
              placeholder="مثل: 2"
            />
          </Field>
          {adjustTarget?.piecesPerUnit ? (
            <Field label={`القطع المفردة (${adjustTarget.retailUnit ?? "قطعة"})`}>
              <Input
                type="number"
                min={0}
                value={adjLooseQty || ""}
                onChange={(e) => setAdjLooseQty(Number(e.target.value))}
                placeholder="مثل: 6"
              />
            </Field>
          ) : null}
          <Field label="السبب" required>
            <Textarea
              rows={2}
              value={adjReason}
              onChange={(e) => setAdjReason(e.target.value)}
              placeholder={`مثل: ${adjType === "in" ? "مرتجع عميل، جرد أعلى" : "تلف، فقد، جرد أقل"}`}
            />
          </Field>
        </div>
      </Dialog>

      {settings /* keep for hot reload refs */ && null}
    </>
  );
}
