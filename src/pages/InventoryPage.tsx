import { useMemo, useState, useEffect } from "react";
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
  SlidersHorizontal,
  RotateCcw,
  Filter,
  ChevronDown,
} from "lucide-react";
import { PageHeader } from "../components/layout/AppLayout";
import { Card, CardBody, CardHeader } from "../components/ui/Card";
import { Button } from "../components/ui/Button";
import { Badge } from "../components/ui/Badge";
import { Input, Field, Textarea } from "../components/ui/Input";
import { Table, TBody, TD, TH, THead, TR } from "../components/ui/Table";
import { EmptyState } from "../components/ui/EmptyState";
import { Dialog } from "../components/ui/Dialog";
import { useCatalog } from "../store/CatalogContext";
import { useInvoicing } from "../store/InvoicingContext";
import { useAuth } from "../store/AuthContext";
import { useSettings } from "../store/SettingsContext";
import { useToast } from "../components/ui/Toast";
import { daysUntil } from "../lib/utils";
import { formatDate, formatQualityGradeLabel } from "../lib/format";
import { formatStockMovementReference } from "../lib/stockMovement";
import type { Product } from "../types";
import { hasPermission } from "../lib/permissions";
import { useFeatures } from "../lib/useFeatures";
import { BarcodeScanInput } from "../features/products/BarcodeScanInput";
import { findProductScanCandidates, productMatchesSearch } from "../lib/partSearch";
import { VEHICLE_COUNTRIES } from "../data/vehicleCountries";
import { useVehicleCatalog } from "../store/VehicleCatalogContext";
import { SearchableSelect } from "../components/ui/SearchableSelect";

export function InventoryPage() {
  const { products, suppliers, adjustStock } = useCatalog();
  const { stockMovements, salesInvoices, purchaseInvoices, salesReturns, purchaseReturns } = useInvoicing();
  const { currentUser } = useAuth();
  const { settings } = useSettings();
  const { isEnabled } = useFeatures();
  const vehicleCatalog = useVehicleCatalog();
  const expiryTrackingEnabled = isEnabled("expiryTracking");
  const toast = useToast();
  const canAdjustStock = hasPermission(currentUser, "inventory", "adjust");
  const [q, setQ] = useState("");
  const [category, setCategory] = useState("");
  const [supplier, setSupplier] = useState("");
  const [qtyFilter, setQtyFilter] = useState<"all" | "available" | "low" | "zero">("all");
  const [expiryFilter, setExpiryFilter] = useState<"all" | "valid" | "soon" | "expired">("all");

  // Pagination & limit state for inventory list
  const [inventoryPageSize, setInventoryPageSize] = useState(10);
  const [inventoryVisibleCount, setInventoryVisibleCount] = useState(10);

  const [showAdvanced, setShowAdvanced] = useState(false);
  const [brandFilter, setBrandFilter] = useState("");
  const [originFilter, setOriginFilter] = useState("");
  const [qualityFilter, setQualityFilter] = useState("");
  const [makeFilter, setMakeFilter] = useState("");
  const [rackFilter, setRackFilter] = useState("");
  const [conditionFilter, setConditionFilter] = useState("");

  // Reset the visible count whenever any filter changes so the user sees the
  // top of the freshly filtered list. Declared after all filter state above to
  // avoid a temporal-dead-zone reference in the dependency array.
  useEffect(() => {
    setInventoryVisibleCount(inventoryPageSize);
  }, [q, category, supplier, qtyFilter, expiryFilter, brandFilter, originFilter, qualityFilter, makeFilter, rackFilter, conditionFilter, inventoryPageSize]);

  const [adjustTarget, setAdjustTarget] = useState<Product | null>(null);
  const [adjType, setAdjType] = useState<"in" | "out">("in");
  const [adjQty, setAdjQty] = useState(0);
  const [adjLooseQty, setAdjLooseQty] = useState(0);
  const [adjReason, setAdjReason] = useState("");

  const categories = useMemo(
    () => Array.from(new Set(products.map((p) => p.category))),
    [products]
  );

  const manufacturers = useMemo(
    () => Array.from(new Set(products.map((p) => p.manufacturer || p.partBrand).filter((m): m is string => Boolean(m)))).sort(),
    [products]
  );

  const qualityGrades = useMemo(
    () => Array.from(new Set(products.map((p) => p.qualityGrade).filter((q): q is string => Boolean(q)))).sort(),
    [products]
  );

  const rackLocations = useMemo(
    () => Array.from(new Set(products.map((p) => p.rackLocation).filter((r): r is string => Boolean(r)))).sort(),
    [products]
  );

  const activeAdvancedCount = useMemo(() => {
    let count = 0;
    if (brandFilter) count++;
    if (originFilter) count++;
    if (qualityFilter) count++;
    if (makeFilter) count++;
    if (rackFilter) count++;
    if (conditionFilter) count++;
    return count;
  }, [brandFilter, originFilter, qualityFilter, makeFilter, rackFilter, conditionFilter]);

  const hasAnyFilterActive = useMemo(() => {
    return Boolean(q.trim() || category || supplier || qtyFilter !== "all" || expiryFilter !== "all" || activeAdvancedCount > 0);
  }, [q, category, supplier, qtyFilter, expiryFilter, activeAdvancedCount]);

  function resetAllFilters() {
    setQ("");
    setCategory("");
    setSupplier("");
    setQtyFilter("all");
    setExpiryFilter("all");
    setBrandFilter("");
    setOriginFilter("");
    setQualityFilter("");
    setMakeFilter("");
    setRackFilter("");
    setConditionFilter("");
  }

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
    if (brandFilter) {
      list = list.filter((p) => (p.manufacturer || p.partBrand || "") === brandFilter);
    }
    if (originFilter) {
      list = list.filter((p) => p.originCountry === originFilter);
    }
    if (qualityFilter) {
      list = list.filter((p) => p.qualityGrade === qualityFilter);
    }
    if (conditionFilter) {
      list = list.filter((p) => p.condition === conditionFilter);
    }
    if (rackFilter) {
      list = list.filter((p) => p.rackLocation === rackFilter);
    }
    if (makeFilter) {
      const matchingProductIds = new Set(
        vehicleCatalog.productFitments
          .filter((f) => f.makeId === makeFilter)
          .map((f) => f.productId)
      );
      list = list.filter((p) => matchingProductIds.has(p.id));
    }
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
  }, [
    products, q, category, supplier, brandFilter, originFilter, qualityFilter, conditionFilter,
    rackFilter, makeFilter, vehicleCatalog.productFitments, qtyFilter, expiryFilter, expiryTrackingEnabled
  ]);

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

  // Pagination & limit state for movements log
  const [movementsPageSize, setMovementsPageSize] = useState(10);
  const [movementsVisibleCount, setMovementsVisibleCount] = useState(10);

  useEffect(() => {
    setMovementsVisibleCount(movementsPageSize);
  }, [movQ, movType, movDateFrom, movDateTo, movementsPageSize]);

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
    return list;
  }, [stockMovements, movQ, movType, movDateFrom, movDateTo]);

  const visibleProducts = useMemo(() => {
    return filtered.slice(0, inventoryVisibleCount);
  }, [filtered, inventoryVisibleCount]);

  const visibleMovements = useMemo(() => {
    return filteredMovements.slice(0, movementsVisibleCount);
  }, [filteredMovements, movementsVisibleCount]);

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
          <div className="flex flex-wrap gap-2 items-center justify-between">
            <div className="flex flex-wrap gap-2 items-center flex-1">
              <div className="relative w-52">
                <Search className="w-4 h-4 absolute top-1/2 -translate-y-1/2 end-3 text-ink-faint" />
                <Input
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder="بحث عن منتج..."
                  className="pe-9"
                />
              </div>
              <SearchableSelect
                value={category}
                onChange={(val) => setCategory(val)}
                options={categories.map((c) => ({ value: c, label: c, searchText: c }))}
                placeholder="كل الفئات"
                searchPlaceholder="ابحث عن فئة..."
                className="w-44"
              />
              <SearchableSelect
                value={supplier}
                onChange={(val) => setSupplier(val)}
                options={suppliers.map((s) => ({ value: s.id, label: s.name, searchText: s.name }))}
                placeholder="كل الموردين"
                searchPlaceholder="ابحث عن مورد..."
                className="w-48"
              />
              <Button
                type="button"
                variant={showAdvanced || activeAdvancedCount > 0 ? "secondary" : "outline"}
                onClick={() => setShowAdvanced(!showAdvanced)}
                className="flex items-center gap-1.5"
              >
                <SlidersHorizontal className="w-4 h-4" />
                <span>فلاتر متقدمة</span>
                {activeAdvancedCount > 0 && (
                  <Badge tone="blue" className="ms-1 font-mono text-xs">
                    {activeAdvancedCount}
                  </Badge>
                )}
              </Button>
              <div className="flex items-center gap-1.5 bg-surface-muted px-2.5 h-9 rounded-xl text-xs border border-line/60">
                <span className="text-ink-muted whitespace-nowrap">العدد الظاهر:</span>
                <input
                  type="number"
                  min={1}
                  max={5000}
                  value={inventoryPageSize || ""}
                  onChange={(e) => {
                    const val = Math.max(1, parseInt(e.target.value) || 10);
                    setInventoryPageSize(val);
                    setInventoryVisibleCount(val);
                  }}
                  className="w-14 h-6 text-center rounded border border-line bg-surface font-semibold text-brand-700 dark:text-brand-300 outline-none focus:ring-1 focus:ring-brand-500 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                  title="تحديد عدد النتائج المعروضة"
                />
              </div>
            </div>

            {hasAnyFilterActive && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={resetAllFilters}
                className="text-red-500 hover:text-red-600 dark:text-red-400 flex items-center gap-1"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                مسح الفلاتر
              </Button>
            )}
          </div>

          {showAdvanced && (
            <div className="bg-surface-subtle p-3.5 rounded-xl border border-line space-y-3 mt-2 animate-in fade-in slide-in-from-top-1 duration-200">
              <div className="flex items-center justify-between text-xs font-medium text-ink-muted border-b border-line/60 pb-2">
                <div className="flex items-center gap-1.5 text-brand-600 dark:text-brand-400 font-semibold">
                  <Filter className="w-3.5 h-3.5" />
                  خيارات الفلترة المتقدمة لقطع الغيار
                </div>
                {activeAdvancedCount > 0 && (
                  <span className="text-brand-600 dark:text-brand-400">
                    تم تفعيل {activeAdvancedCount} فلاتر إضافية
                  </span>
                )}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3">
                <div>
                  <label className="block text-xs text-ink-muted mb-1">الشركة المصنّعة / الماركة</label>
                  <SearchableSelect
                    value={brandFilter}
                    onChange={(val) => setBrandFilter(val)}
                    options={manufacturers.map((m) => ({ value: m, label: m, searchText: m }))}
                    placeholder="كل الماركات والشركات"
                    searchPlaceholder="ابحث عن ماركة..."
                  />
                </div>

                <div>
                  <label className="block text-xs text-ink-muted mb-1">بلد المنشأ</label>
                  <SearchableSelect
                    value={originFilter}
                    onChange={(val) => setOriginFilter(val)}
                    options={VEHICLE_COUNTRIES.map((c) => ({
                      value: c.code,
                      label: `${c.flag}  ${c.nameAr} (${c.code})`,
                      searchText: `${c.nameAr} ${c.nameEn} ${c.code}`,
                    }))}
                    placeholder="كل بلاد المنشأ"
                    searchPlaceholder="ابحث عن دولة..."
                  />
                </div>

                <div>
                  <label className="block text-xs text-ink-muted mb-1">درجة الجودة</label>
                  <SearchableSelect
                    value={qualityFilter}
                    onChange={(val) => setQualityFilter(val)}
                    options={qualityGrades.map((qg) => ({
                      value: qg,
                      label: formatQualityGradeLabel(qg),
                      searchText: `${formatQualityGradeLabel(qg)} ${qg}`,
                    }))}
                    placeholder="كل درجات الجودة"
                    searchPlaceholder="ابحث عن درجة الجودة..."
                  />
                </div>

                <div>
                  <label className="block text-xs text-ink-muted mb-1">توافق ماركة السيارة</label>
                  <SearchableSelect
                    value={makeFilter}
                    onChange={(val) => setMakeFilter(val)}
                    options={vehicleCatalog.vehicleMakes.map((mk) => ({
                      value: mk.id,
                      label: mk.name,
                      searchText: mk.name,
                    }))}
                    placeholder="كل ماركات السيارات"
                    searchPlaceholder="ابحث عن ماركة سيارة..."
                  />
                </div>

                <div>
                  <label className="block text-xs text-ink-muted mb-1">موقع الرف / البِن</label>
                  <SearchableSelect
                    value={rackFilter}
                    onChange={(val) => setRackFilter(val)}
                    options={rackLocations.map((r) => ({ value: r, label: `رف: ${r}`, searchText: r }))}
                    placeholder="كل الرفوف والمواقع"
                    searchPlaceholder="ابحث عن موقع الرف..."
                  />
                </div>

                <div>
                  <label className="block text-xs text-ink-muted mb-1">حالة القطعة</label>
                  <SearchableSelect
                    value={conditionFilter}
                    onChange={(val) => setConditionFilter(val)}
                    options={[
                      { value: "new", label: "جديد (New)" },
                      { value: "used", label: "مستعمل / استيراد (Used)" },
                      { value: "refurbished", label: "معاد تجديده (Refurbished)" },
                      { value: "remanufactured", label: "معاد تصنيعه (Remanufactured)" },
                    ]}
                    placeholder="كل الحالات"
                    searchPlaceholder="ابحث عن حالة القطعة..."
                  />
                </div>
              </div>
            </div>
          )}

          <div className="flex flex-wrap gap-3 items-center pt-1 border-t border-line/40">
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
                  className={`px-3 h-8 text-xs rounded-md transition-colors ${
                    qtyFilter === b.key
                      ? "bg-surface text-brand-700 dark:text-brand-300 font-medium shadow-sm"
                      : "text-ink-muted hover:text-ink"
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
                    className={`px-3 h-8 text-xs rounded-md transition-colors ${
                      expiryFilter === b.key
                        ? "bg-surface text-brand-700 dark:text-brand-300 font-medium shadow-sm"
                        : "text-ink-muted hover:text-ink"
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
                {visibleProducts.map((p) => {
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

          {filtered.length > 0 && (
            <div className="flex flex-col sm:flex-row items-center justify-between gap-3 pt-3 border-t border-line text-xs text-ink-muted">
              <div>
                عرض <span className="font-semibold text-ink">{Math.min(inventoryVisibleCount, filtered.length)}</span> من إجمالي <span className="font-semibold text-ink">{filtered.length}</span> قطعة
              </div>
              {filtered.length > inventoryVisibleCount && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setInventoryVisibleCount((prev) => prev + inventoryPageSize)}
                  className="gap-1.5 font-medium border-brand-300 dark:border-brand-500/40 text-brand-700 dark:text-brand-300 hover:bg-brand-50 dark:hover:bg-brand-500/10"
                >
                  <ChevronDown className="w-4 h-4" />
                  إظهار المزيد (+{Math.min(inventoryPageSize, filtered.length - inventoryVisibleCount)})
                </Button>
              )}
            </div>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="سجل حركات المخزون" subtitle={`${filteredMovements.length} حركة`} />
        <CardBody className="space-y-3">
          <div className="flex gap-2 items-center flex-wrap">
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
            <div className="flex items-center gap-1.5 bg-surface-muted px-2.5 h-9 rounded-xl text-xs border border-line/60 ms-auto">
              <span className="text-ink-muted whitespace-nowrap">العدد الظاهر:</span>
              <input
                type="number"
                min={1}
                max={5000}
                value={movementsPageSize || ""}
                onChange={(e) => {
                  const val = Math.max(1, parseInt(e.target.value) || 10);
                  setMovementsPageSize(val);
                  setMovementsVisibleCount(val);
                }}
                className="w-14 h-6 text-center rounded border border-line bg-surface font-semibold text-brand-700 dark:text-brand-300 outline-none focus:ring-1 focus:ring-brand-500 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                title="تحديد عدد الحركات المعروضة"
              />
            </div>
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
                {visibleMovements.map((m) => (
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

          {filteredMovements.length > 0 && (
            <div className="flex flex-col sm:flex-row items-center justify-between gap-3 pt-3 border-t border-line text-xs text-ink-muted">
              <div>
                عرض <span className="font-semibold text-ink">{Math.min(movementsVisibleCount, filteredMovements.length)}</span> من إجمالي <span className="font-semibold text-ink">{filteredMovements.length}</span> حركة
              </div>
              {filteredMovements.length > movementsVisibleCount && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setMovementsVisibleCount((prev) => prev + movementsPageSize)}
                  className="gap-1.5 font-medium border-brand-300 dark:border-brand-500/40 text-brand-700 dark:text-brand-300 hover:bg-brand-50 dark:hover:bg-brand-500/10"
                >
                  <ChevronDown className="w-4 h-4" />
                  إظهار المزيد (+{Math.min(movementsPageSize, filteredMovements.length - movementsVisibleCount)})
                </Button>
              )}
            </div>
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
