import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Pencil, Plus, Trash2, Eye, Package, Search, Archive, ArchiveRestore, ArrowUpNarrowWide, ArrowDownNarrowWide, ScanLine, SlidersHorizontal, Download, DollarSign, MapPin, Folder, CarFront } from "lucide-react";
import { PageHeader } from "../components/layout/AppLayout";
import { Card, CardBody, CardHeader } from "../components/ui/Card";
import { Button } from "../components/ui/Button";
import { Badge } from "../components/ui/Badge";
import { Field, Input, Select } from "../components/ui/Input";
import { SearchableSelect } from "../components/ui/SearchableSelect";
import { Table, TBody, TD, TH, THead, TR } from "../components/ui/Table";
import { EmptyState } from "../components/ui/EmptyState";
import { ConfirmDialog, Dialog } from "../components/ui/Dialog";
import { useCatalog } from "../store/CatalogContext";
import { useAuth } from "../store/AuthContext";
import { useSettings } from "../store/SettingsContext";
import { useToast } from "../components/ui/Toast";
import { formatCurrency, formatQualityGradeLabel } from "../lib/format";
import { vehicleCountryLabel } from "../data/vehicleCountries";
import { daysUntil } from "../lib/utils";
import { ProductFormDialog } from "../features/products/ProductForm";
import type { Product, PartAlternativeRelation } from "../types";
import { hasPermission } from "../lib/permissions";
import { useFeatures } from "../lib/useFeatures";
import { productMatchesSearch } from "../lib/partSearch";
import { buildXlsx } from "../lib/xlsx";
import { useVehicleCatalog } from "../store/VehicleCatalogContext";

type SortKey = "name" | "quantity" | "wholesalePrice" | "retailPrice" | "purchasePrice";

export function ProductsPage() {
  const { products, suppliers, deleteProduct, archiveProduct, updateProduct } = useCatalog();
  const vehicleCatalog = useVehicleCatalog();
  const { currentUser } = useAuth();
  const { settings } = useSettings();
  const [stockAlternativeModal, setStockAlternativeModal] = useState<{
    product: Product;
    alternatives: { product: Product; relation: PartAlternativeRelation; notes?: string }[];
  } | null>(null);

  const alternativesByProductId = useMemo(() => {
    const map = new Map<string, { product: Product; relation: PartAlternativeRelation; notes?: string }[]>();
    const productById = new Map(products.map((p) => [p.id, p]));

    for (const link of vehicleCatalog.productAlternatives) {
      const p1 = productById.get(link.productId);
      const p2 = productById.get(link.alternativeProductId);

      if (p1 && p2) {
        if (!map.has(link.productId)) map.set(link.productId, []);
        map.get(link.productId)!.push({ product: p2, relation: link.relation, notes: link.notes });

        if (!map.has(link.alternativeProductId)) map.set(link.alternativeProductId, []);
        map.get(link.alternativeProductId)!.push({ product: p1, relation: link.relation, notes: link.notes });
      }
    }
    return map;
  }, [products, vehicleCatalog.productAlternatives]);

  const supplierById = useMemo(() => {
    return new Map(suppliers.map((s) => [s.id, s.name]));
  }, [suppliers]);
  const { isEnabled } = useFeatures();
  const multiSalePricesEnabled = isEnabled("multiSalePrices");
  const expiryTrackingEnabled = isEnabled("expiryTracking");
  const excelExportEnabled = isEnabled("excelExport");
  const bulkProductToolsEnabled = isEnabled("bulkProductTools");
  const toast = useToast();
  const loc = useLocation();
  const navigate = useNavigate();
  const canAddProduct = hasPermission(currentUser, "products", "add");
  const canEditProduct = hasPermission(currentUser, "products", "edit");
  const canDeleteProduct = hasPermission(currentUser, "products", "delete");
  const [q, setQ] = useState<string>((loc.state as { initialSearch?: string } | null)?.initialSearch ?? "");
  const [category, setCategory] = useState("");
  const [supplier, setSupplier] = useState("");
  const [expiryFilter, setExpiryFilter] = useState<"all" | "expiring" | "expired">("all");
  const [stockFilter, setStockFilter] = useState<"all" | "low" | "out">("all");
  const [sort, setSort] = useState<SortKey>("name");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [showAdvancedFilters, setShowAdvancedFilters] = useState(false);
  const [qualityGradeFilter, setQualityGradeFilter] = useState("");
  const [brandFilter, setBrandFilter] = useState("");
  const [originCountryFilter, setOriginCountryFilter] = useState("");
  const [conditionFilter, setConditionFilter] = useState("");

  const searchInputRef = useRef<HTMLInputElement>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Product | null>(null);
  const [toDelete, setToDelete] = useState<Product | null>(null);
  const [showArchived, setShowArchived] = useState(false);

  // ── Bulk selection & actions state ──
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const [bulkPriceOpen, setBulkPriceOpen] = useState(false);
  const [bulkPriceTarget, setBulkPriceTarget] = useState<"wholesalePrice" | "retailPrice" | "purchasePrice" | "all">("wholesalePrice");
  const [bulkPriceType, setBulkPriceType] = useState<"percentage" | "fixed_add" | "set_value">("percentage");
  const [bulkPriceValue, setBulkPriceValue] = useState<number>(0);

  const [bulkRackOpen, setBulkRackOpen] = useState(false);
  const [bulkRackValue, setBulkRackValue] = useState<string>("");

  const [bulkCatOpen, setBulkCatOpen] = useState(false);
  const [bulkCatValue, setBulkCatValue] = useState<string>("");
  const [bulkSupplierValue, setBulkSupplierValue] = useState<string>("");

  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);

  // USB Barcode Scanner listener
  useEffect(() => {
    let buffer = "";
    let lastKeyTime = Date.now();

    const handleKeyDown = (e: KeyboardEvent) => {
      const active = document.activeElement;
      const isInput = active && (active.tagName === "INPUT" || active.tagName === "TEXTAREA" || active.tagName === "SELECT");
      if (isInput && active !== searchInputRef.current) {
        return;
      }

      const currentTime = Date.now();
      if (currentTime - lastKeyTime > 80) {
        buffer = "";
      }
      lastKeyTime = currentTime;

      if (e.key === "Enter") {
        if (buffer.length >= 3) {
          const scannedCode = buffer.trim();
          setQ(scannedCode);
          toast.success("تم مسح الباركود", `الرمز: ${scannedCode}`);
          searchInputRef.current?.focus();
          e.preventDefault();
        }
        buffer = "";
      } else if (e.key.length === 1) {
        buffer += e.key;
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [toast]);

  useEffect(() => {
    if (!multiSalePricesEnabled && sort === "retailPrice") setSort("wholesalePrice");
    if (!expiryTrackingEnabled && expiryFilter !== "all") setExpiryFilter("all");
  }, [multiSalePricesEnabled, sort, expiryTrackingEnabled, expiryFilter]);

  const categories = useMemo(() => {
    return Array.from(new Set(products.map((p) => p.category)));
  }, [products]);

  const brands = useMemo(
    () => Array.from(new Set(products.map((p) => p.partBrand).filter((b): b is string => Boolean(b)))).sort((a, b) => a.localeCompare(b, "ar")),
    [products],
  );
  const originCountries = useMemo(
    () => Array.from(new Set(products.map((p) => p.originCountry).filter((c): c is string => Boolean(c)))),
    [products],
  );
  const advancedFilterCount = [qualityGradeFilter, brandFilter, originCountryFilter, conditionFilter].filter(Boolean).length;

  function clearAdvancedFilters() {
    setQualityGradeFilter("");
    setBrandFilter("");
    setOriginCountryFilter("");
    setConditionFilter("");
  }

  const archivedCount = useMemo(() => products.filter((p) => p.archived).length, [products]);

  const filtered = useMemo(() => {
    let list = products.filter((p) => !p.archived);
    if (q.trim()) {
      list = list.filter((p) => productMatchesSearch(p, q));
    }
    if (category) list = list.filter((p) => p.category === category);
    if (supplier) list = list.filter((p) => p.supplierId === supplier);
    if (qualityGradeFilter) list = list.filter((p) => p.qualityGrade === qualityGradeFilter);
    if (brandFilter) list = list.filter((p) => p.partBrand === brandFilter);
    if (originCountryFilter) list = list.filter((p) => p.originCountry === originCountryFilter);
    if (conditionFilter) list = list.filter((p) => p.condition === conditionFilter);
    // حالة الكمية: قارب على النفاذ (أقل من أو يساوي الحد الأدنى لكن غير صفر) / نفذ (صفر)
    if (stockFilter === "low")
      list = list.filter((p) => p.quantity > 0 && p.quantity <= p.minStock);
    // حالة الصلاحية: قارب الانتهاء (خلال 14 يوم) / منتهي
    if (expiryTrackingEnabled && expiryFilter === "expiring")
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

    list = [...list].sort((a, b) => {
      const av = a[sort];
      const bv = b[sort];
      let cmp: number;
      if (typeof av === "number" && typeof bv === "number") cmp = av - bv;
      else cmp = String(av ?? "").localeCompare(String(bv ?? ""), "ar");
      return sortDir === "asc" ? cmp : -cmp;
    });
    return list;
  }, [products, q, category, supplier, qualityGradeFilter, brandFilter, originCountryFilter, conditionFilter, expiryFilter, stockFilter, sort, sortDir, expiryTrackingEnabled]);

  function handleDelete() {
    if (!toDelete) return;
    const ok = deleteProduct(toDelete.id);
    if (ok) {
      toast.success("تم حذف المنتج");
    } else {
      archiveProduct(toDelete.id, true);
      toast.success("تم أرشفة المنتج", "المنتج محفوظ في الأرشيف ويمكن استعادته");
    }
    setToDelete(null);
  }

  const isAllSelected = filtered.length > 0 && filtered.every((p) => selectedIds.has(p.id));

  function toggleSelectAll() {
    if (isAllSelected) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filtered.map((p) => p.id)));
    }
  }

  function toggleSelect(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function handleBulkDelete() {
    if (selectedIds.size === 0) return;
    let count = 0;
    selectedIds.forEach((id) => {
      const ok = deleteProduct(id);
      if (!ok) archiveProduct(id, true);
      count++;
    });
    toast.success(`تم حذف/أرشفة ${count} صنف بنجاح`);
    setSelectedIds(new Set());
    setBulkDeleteOpen(false);
  }

  function handleBulkPriceUpdate() {
    if (!bulkProductToolsEnabled && selectedIds.size >= 10) {
      toast.error(
        "النسخة المجانية تدعم التعديل الجماعي حتى 9 أصناف فقط في المرة الواحدة — لتعديل عدد أكبر يلزم تفعيل ميزة أدوات التعديل الجماعي غير المحدودة.",
      );
      return;
    }
    if (selectedIds.size === 0 || !bulkPriceValue) return;
    let count = 0;
    selectedIds.forEach((id) => {
      const p = products.find((x) => x.id === id);
      if (!p) return;
      const patch: Partial<Product> = {};
      const applyCalc = (oldVal: number) => {
        if (bulkPriceType === "percentage") return Math.round(oldVal * (1 + bulkPriceValue / 100) * 100) / 100;
        if (bulkPriceType === "fixed_add") return Math.max(0, oldVal + bulkPriceValue);
        return Math.max(0, bulkPriceValue);
      };

      if (bulkPriceTarget === "wholesalePrice" || bulkPriceTarget === "all") {
        patch.wholesalePrice = applyCalc(p.wholesalePrice);
      }
      if (bulkPriceTarget === "retailPrice" || bulkPriceTarget === "all") {
        patch.retailPrice = applyCalc(p.retailPrice);
      }
      if (bulkPriceTarget === "purchasePrice" || bulkPriceTarget === "all") {
        patch.purchasePrice = applyCalc(p.purchasePrice);
      }

      updateProduct(id, patch);
      count++;
    });
    toast.success(`تم تحديث أسعار ${count} صنف بنجاح`);
    setSelectedIds(new Set());
    setBulkPriceOpen(false);
  }

  function handleBulkRackUpdate() {
    if (!bulkProductToolsEnabled && selectedIds.size >= 10) {
      toast.error(
        "النسخة المجانية تدعم التعديل الجماعي حتى 9 أصناف فقط في المرة الواحدة — لتعديل عدد أكبر يلزم تفعيل ميزة أدوات التعديل الجماعي غير المحدودة.",
      );
      return;
    }
    if (selectedIds.size === 0) return;
    let count = 0;
    selectedIds.forEach((id) => {
      updateProduct(id, { rackLocation: bulkRackValue.trim() || undefined });
      count++;
    });
    toast.success(`تم تحديث موقع الرف لـ ${count} صنف بنجاح`);
    setSelectedIds(new Set());
    setBulkRackOpen(false);
  }

  function handleBulkCatSupplierUpdate() {
    if (!bulkProductToolsEnabled && selectedIds.size >= 10) {
      toast.error(
        "النسخة المجانية تدعم التعديل الجماعي حتى 9 أصناف فقط في المرة الواحدة — لتعديل عدد أكبر يلزم تفعيل ميزة أدوات التعديل الجماعي غير المحدودة.",
      );
      return;
    }
    if (selectedIds.size === 0) return;
    let count = 0;
    selectedIds.forEach((id) => {
      const patch: Partial<Product> = {};
      if (bulkCatValue) patch.category = bulkCatValue;
      if (bulkSupplierValue !== "") patch.supplierId = bulkSupplierValue || undefined;
      updateProduct(id, patch);
      count++;
    });
    toast.success(`تم تحديث بيانات ${count} صنف بنجاح`);
    setSelectedIds(new Set());
    setBulkCatOpen(false);
  }

  function exportCatalogExcel() {
    if (products.length === 0) {
      toast.error("لا توجد منتجات لتصديرها");
      return;
    }
    const headers = [
      "#",
      "الكود",
      "رقم القطعة",
      "اسم القطعة",
      "الفئة",
      "الماركة",
      "درجة الجودة",
      "بلد المنشأ",
      "الوحدة",
      "المخزون",
      "الحد الأدنى",
      "موقع الرف",
      "سعر الشراء",
      "سعر الجملة",
      "سعر التجزئة",
      "المورد",
    ];
    const rows: (string | number)[][] = filtered.map((p, idx) => {
      const sup = suppliers.find((s) => s.id === p.supplierId)?.name || "—";
      return [
        idx + 1,
        p.code,
        p.partNumber || "—",
        p.name,
        p.category,
        p.partBrand || "—",
        p.qualityGrade ? formatQualityGradeLabel(p.qualityGrade) : "—",
        p.originCountry || "—",
        p.unit,
        p.quantity,
        p.minStock,
        p.rackLocation || "—",
        p.purchasePrice,
        p.wholesalePrice,
        p.retailPrice,
        sup,
      ];
    });

    const bytes = buildXlsx([{ name: "كتالوج قطع الغيار", headers, rows }]);
    const blob = new Blob([bytes], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `كتالوج_قطع_الغيار_${new Date().toLocaleDateString("en-CA")}.xlsx`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success("تم تصدير كتالوج قطع الغيار إلى Excel بنجاح");
  }

  return (
    <>
      <PageHeader
        title="قطع الغيار"
        description={`إدارة كل قطع الغيار والأسعار والمخزون (${products.length})`}
        actions={
          <div className="flex items-center gap-2">
            {excelExportEnabled && (
              <Button variant="outline" onClick={exportCatalogExcel} title="تصدير الكتالوج الحالي إلى Excel">
                <Download className="w-4 h-4" />
                تصدير الكتالوج
              </Button>
            )}
            {canAddProduct && (
              <Button
                onClick={() => {
                  setEditing(null);
                  setFormOpen(true);
                }}
              >
                <Plus className="w-4 h-4" />
                إضافة منتج
              </Button>
            )}
          </div>
        }
      />

      <Card>
        <CardHeader
          title="قائمة قطع الغيار"
          subtitle="ابحث أو صفّي حسب الفئة، المورد، الحالة"
          actions={archivedCount > 0 ? (
            <Button
              size="sm"
              variant="outline"
              className="gap-1.5 text-ink-muted"
              onClick={() => setShowArchived((v) => !v)}
            >
              <Archive className="w-3.5 h-3.5" />
              {showArchived ? "إخفاء الأرشيف" : `الأرشيف (${archivedCount})`}
            </Button>
          ) : undefined}
        />
        <CardBody className="space-y-3">
          <div className="flex gap-2.5 items-end flex-wrap">
            <Field label="بحث" className="flex-1 min-w-[200px]">
              <div className="relative">
                <Search className="w-4 h-4 absolute top-1/2 -translate-y-1/2 end-3 text-ink-faint pointer-events-none" />
                <Input
                  ref={searchInputRef}
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder="Part No. / OEM / باركود / اسم"
                  className="pe-9"
                />
              </div>
            </Field>
            <Button
              type="button"
              variant="outline"
              className="w-9 h-9 p-0 self-end shrink-0 text-cyan-700 dark:text-cyan-300 border-cyan-300 dark:border-cyan-500/40 bg-cyan-50/50 dark:bg-cyan-500/10 hover:bg-cyan-100 dark:hover:bg-cyan-500/20 flex items-center justify-center"
              title="سكان بالباركود"
              onClick={() => {
                searchInputRef.current?.focus();
                toast.info("جاهز لقراءة الباركود (الاسكانر)", "وجّه الاسكانر على عبوة المنتج أو اكتب الباركود مباشرة في حقل البحث");
              }}
            >
              <ScanLine className="w-4 h-4 text-cyan-600 dark:text-cyan-400" />
            </Button>
            <Field label="الفئة" className="min-w-[130px]">
              <Select value={category} onChange={(e) => setCategory(e.target.value)}>
                <option value="">كل الفئات</option>
                {categories.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="المورد" className="min-w-[150px]">
              <SearchableSelect
                value={supplier}
                onChange={setSupplier}
                options={suppliers.map((s) => ({ value: s.id, label: s.name }))}
                placeholder="كل الموردين"
                minChars={3}
              />
            </Field>
            {expiryTrackingEnabled && (
              <Field label="الصلاحية" className="min-w-[120px]">
                <Select
                  value={expiryFilter}
                  onChange={(e) => setExpiryFilter(e.target.value as typeof expiryFilter)}
                >
                  <option value="all">كل الحالات</option>
                  <option value="expiring">قارب الانتهاء</option>
                  <option value="expired">منتهي</option>
                </Select>
              </Field>
            )}
            <Field label="الكمية" className="min-w-[120px]">
              <Select
                value={stockFilter}
                onChange={(e) => setStockFilter(e.target.value as typeof stockFilter)}
              >
                <option value="all">كل الحالات</option>
                <option value="low">قارب النفاذ</option>
                <option value="out">نفذ</option>
              </Select>
            </Field>
            <div className="flex items-end gap-1 min-w-[140px]">
              <Field label="ترتيب حسب" className="w-full">
                <Select
                  value={sort}
                  onChange={(e) => setSort(e.target.value as SortKey)}
                >
                  <option value="name">الاسم</option>
                  <option value="quantity">الكمية</option>
                  <option value="wholesalePrice">{multiSalePricesEnabled ? "سعر الجملة" : "سعر البيع"}</option>
                  {multiSalePricesEnabled && <option value="retailPrice">سعر التجزئة</option>}
                  <option value="purchasePrice">سعر الشراء</option>
                </Select>
              </Field>
              <Button
                variant="outline"
                size="icon"
                className="h-9 w-9 self-end shrink-0"
                title={sortDir === "asc" ? "تصاعدي" : "تنازلي"}
                onClick={() => setSortDir((d) => (d === "asc" ? "desc" : "asc"))}
              >
                {sortDir === "asc"
                  ? <ArrowUpNarrowWide className="w-4 h-4" />
                  : <ArrowDownNarrowWide className="w-4 h-4" />}
              </Button>
            </div>
            <Button
              type="button"
              variant="outline"
              className={`h-9 gap-1.5 self-end shrink-0 relative ${
                showAdvancedFilters || advancedFilterCount > 0
                  ? "text-cyan-700 dark:text-cyan-300 border-cyan-300 dark:border-cyan-500/40 bg-cyan-50/50 dark:bg-cyan-500/10"
                  : "text-ink-muted"
              }`}
              onClick={() => setShowAdvancedFilters((v) => !v)}
            >
              <SlidersHorizontal className="w-4 h-4" />
              فلاتر متقدمة
              {advancedFilterCount > 0 && (
                <span className="grid h-4 w-4 place-items-center rounded-full bg-cyan-500 text-[10px] font-bold text-white">
                  {advancedFilterCount}
                </span>
              )}
            </Button>
          </div>

          {showAdvancedFilters && (
            <div className="flex gap-2 items-end flex-wrap rounded-xl border border-line bg-surface-muted/40 p-3">
              <Field label="درجة الجودة" className="w-40">
                <Select value={qualityGradeFilter} onChange={(e) => setQualityGradeFilter(e.target.value)}>
                  <option value="">كل الدرجات</option>
                  <option value="genuine">{formatQualityGradeLabel("genuine")}</option>
                  <option value="oem">{formatQualityGradeLabel("oem")}</option>
                  <option value="aftermarket-premium">{formatQualityGradeLabel("aftermarket-premium")}</option>
                  <option value="aftermarket-economy">{formatQualityGradeLabel("aftermarket-economy")}</option>
                </Select>
              </Field>
              <Field label="الماركة" className="w-40">
                <Select value={brandFilter} onChange={(e) => setBrandFilter(e.target.value)}>
                  <option value="">كل الماركات</option>
                  {brands.map((b) => <option key={b} value={b}>{b}</option>)}
                </Select>
              </Field>
              <Field label="بلد المنشأ" className="w-40">
                <Select value={originCountryFilter} onChange={(e) => setOriginCountryFilter(e.target.value)}>
                  <option value="">كل البلاد</option>
                  {originCountries.map((c) => <option key={c} value={c}>{vehicleCountryLabel(c)}</option>)}
                </Select>
              </Field>
              <Field label="الحالة" className="w-40">
                <Select value={conditionFilter} onChange={(e) => setConditionFilter(e.target.value)}>
                  <option value="">كل الحالات</option>
                  <option value="new">جديدة</option>
                  <option value="used">استيراد / مستعملة</option>
                  <option value="refurbished">مجددة</option>
                  <option value="remanufactured">معاد تصنيعها</option>
                </Select>
              </Field>
              {advancedFilterCount > 0 && (
                <Button type="button" variant="ghost" size="sm" className="text-rose-600" onClick={clearAdvancedFilters}>
                  مسح الفلاتر ({advancedFilterCount})
                </Button>
              )}
            </div>
          )}
          {selectedIds.size > 0 && (
            <div className="flex flex-wrap items-center justify-between gap-3 p-3 bg-brand-50/60 dark:bg-brand-900/30 border border-brand-200 dark:border-brand-800 rounded-xl">
              <div className="flex items-center gap-2 text-sm font-bold text-brand-900 dark:text-brand-100">
                <span className="flex items-center justify-center min-w-[24px] h-6 px-1.5 rounded-full bg-brand-600 text-white text-xs">
                  {selectedIds.size}
                </span>
                <span>صنف محدد</span>
                {!bulkProductToolsEnabled && selectedIds.size >= 9 && (
                  <span className="text-[11px] font-semibold text-amber-600 dark:text-amber-400">
                    (9/9 كحد أقصى للنسخة المجانية)
                  </span>
                )}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Button size="sm" variant="outline" onClick={() => setBulkPriceOpen(true)}>
                  <DollarSign className="w-3.5 h-3.5 ml-1 text-emerald-600" /> تعديل أسعار
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => navigate("/vehicle-catalog", { state: { bulkFitmentProductIds: Array.from(selectedIds) } })}
                >
                  <CarFront className="w-3.5 h-3.5 ml-1 text-indigo-600" /> ربط توافق سيارة
                </Button>
                <Button size="sm" variant="outline" onClick={() => setBulkRackOpen(true)}>
                  <MapPin className="w-3.5 h-3.5 ml-1 text-blue-600" /> نقل رف
                </Button>
                <Button size="sm" variant="outline" onClick={() => setBulkCatOpen(true)}>
                  <Folder className="w-3.5 h-3.5 ml-1 text-purple-600" /> تغيير فئة/مورد
                </Button>
                {canDeleteProduct && (
                  <Button size="sm" variant="outline" className="text-red-600 border-red-200 hover:bg-red-50 dark:border-red-500/30" onClick={() => setBulkDeleteOpen(true)}>
                    <Trash2 className="w-3.5 h-3.5 ml-1" /> حذف/أرشفة جماعية
                  </Button>
                )}
                <Button size="sm" variant="ghost" onClick={() => setSelectedIds(new Set())}>
                  إلغاء التحديد
                </Button>
              </div>
            </div>
          )}

          {filtered.length === 0 ? (
            <EmptyState
              icon={<Package className="w-5 h-5" />}
              title="لا توجد منتجات مطابقة"
              description="جرّب تعديل البحث أو الفلاتر."
            />
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH className="w-10">
                    <input
                      type="checkbox"
                      checked={isAllSelected}
                      onChange={toggleSelectAll}
                      className="w-4 h-4 rounded border-2 border-ink-faint bg-surface accent-brand-600 focus:ring-2 focus:ring-brand-500 cursor-pointer"
                    />
                  </TH>
                  <TH>رقم القطعة</TH>
                  <TH>المنتج</TH>
                  <TH>الفئة</TH>
                  <TH>الوحدة</TH>
                  <TH className="text-end">الكمية</TH>
                  <TH>حالة الكمية</TH>
                  <TH className="text-end">سعر الشراء</TH>
                  <TH className="text-end">{multiSalePricesEnabled ? "سعر الجملة" : "سعر البيع"}</TH>
                  {multiSalePricesEnabled && <TH className="text-end">سعر التجزئة</TH>}
                  {expiryTrackingEnabled && <TH>الصلاحية</TH>}
                  {expiryTrackingEnabled && <TH>حالة الصلاحية</TH>}
                  <TH>المورد</TH>
                  <TH className="text-end">إجراءات</TH>
                </TR>
              </THead>
              <TBody>
                {filtered.map((p) => {
                  const supName = p.supplierId ? supplierById.get(p.supplierId) : undefined;
                  const du = daysUntil(p.expiryDate);
                  const out = p.quantity <= 0;
                  const low = !out && p.quantity <= p.minStock;
                  const expired = p.hasExpiry && du !== null && du < 0;
                  const soon =
                    p.hasExpiry && du !== null && du >= 0 && du <= 14;
                  const alts = alternativesByProductId.get(p.id) || [];
                  return (
                    <TR key={p.id}>
                      <TD>
                        <input
                          type="checkbox"
                          checked={selectedIds.has(p.id)}
                          onChange={() => toggleSelect(p.id)}
                          className="w-4 h-4 rounded border-2 border-ink-faint bg-surface accent-brand-600 focus:ring-2 focus:ring-brand-500 cursor-pointer"
                        />
                      </TD>
                      <TD><div className="font-mono text-xs" dir="ltr">{p.partNumber || p.code}</div>{p.partBrand ? <div className="text-[11px] text-ink-faint" dir="ltr">{p.partBrand}</div> : null}</TD>
                      <TD>
                        <span className="font-medium text-ink">{p.name}</span>
                      </TD>
                      <TD>{p.category}</TD>
                      <TD>{p.unit}</TD>
                      <TD className="text-end font-medium">
                        {multiSalePricesEnabled && p.piecesPerUnit
                          ? `${p.quantity} ${p.unit}${p.looseQuantity ? ` + ${p.looseQuantity} ${p.retailUnit ?? "قطعة"}` : ""}`
                          : `${p.quantity} ${p.unit}`}
                      </TD>
                      <TD>
                        {out ? (
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <Badge tone="red">نفذ</Badge>
                            {alts.length > 0 && (
                              <button
                                type="button"
                                onClick={() => setStockAlternativeModal({ product: p, alternatives: alts })}
                                className="px-2 py-0.5 rounded-full bg-amber-500 hover:bg-amber-600 text-white text-[10px] font-bold shadow-sm transition-all animate-pulse"
                                title="اضغط لعرض القطع البديلة المسجلة"
                              >
                                يوجد بديل ({alts.length})
                              </button>
                            )}
                          </div>
                        ) : low ? (
                          <Badge tone="amber">قارب على النفاذ</Badge>
                        ) : (
                          <Badge tone="green">متوفر</Badge>
                        )}
                      </TD>
                      <TD className="text-end text-ink-muted">
                        {formatCurrency(p.purchasePrice, settings.currency)}
                      </TD>
                      <TD className="text-end font-medium">
                        {formatCurrency(p.wholesalePrice, settings.currency)}
                      </TD>
                      {multiSalePricesEnabled && (
                        <TD className="text-end font-medium">
                          {formatCurrency(p.retailPrice, settings.currency)}
                        </TD>
                      )}
                      {expiryTrackingEnabled && (
                        <TD>
                          {p.hasExpiry && p.expiryDate ? (
                            <span className="text-xs text-ink-muted">
                              {p.expiryDate}
                            </span>
                          ) : (
                            <span className="text-xs text-ink-faint">—</span>
                          )}
                        </TD>
                      )}
                      {expiryTrackingEnabled && (
                        <TD>
                          {!p.hasExpiry ? (
                            <span className="text-xs text-ink-faint">—</span>
                          ) : expired ? (
                            <Badge tone="red">منتهي</Badge>
                          ) : soon ? (
                            <Badge tone="rose">قارب الانتهاء</Badge>
                          ) : (
                            <Badge tone="green">سليمة</Badge>
                          )}
                        </TD>
                      )}
                      <TD className="text-ink-muted text-xs">{supName ?? "—"}</TD>
                      <TD className="text-end">
                        <div className="inline-flex items-center gap-1">
                          <Button
                            size="icon"
                            variant="ghost"
                            onClick={() => navigate(`/products/${p.id}`)}
                            title="عرض"
                          >
                            <Eye className="w-4 h-4" />
                          </Button>
                          {canEditProduct ? (
                            <Button
                              size="icon"
                              variant="ghost"
                              onClick={() => {
                                setEditing(p);
                                setFormOpen(true);
                              }}
                              title="تعديل"
                            >
                              <Pencil className="w-4 h-4" />
                            </Button>
                          ) : null}
                          {canDeleteProduct ? (
                            <Button
                              size="icon"
                              variant="ghost"
                              className="text-red-600 dark:text-red-400 hover:bg-red-50 dark:bg-red-500/10"
                              onClick={() => setToDelete(p)}
                              title="حذف"
                            >
                              <Trash2 className="w-4 h-4" />
                            </Button>
                          ) : null}
                        </div>
                      </TD>
                    </TR>
                  );
                })}
                {showArchived && products.filter((p) => p.archived).map((p) => (
                  <TR key={p.id} className="opacity-50 bg-surface-muted">
                    <TD />
                    <TD className="text-ink-faint font-mono text-xs">{p.code}</TD>
                    <TD className="text-ink-muted line-through">{p.name}</TD>
                    <TD className="text-ink-faint">{p.category}</TD>
                    <TD />
                    <TD />
                    <TD />
                    <TD />
                    <TD />
                    <TD />
                    <TD />
                    <TD />
                    <TD />
                    <TD className="text-end">
                      <div className="inline-flex items-center gap-1">
                        <Button
                          size="sm"
                          variant="outline"
                          className="gap-1 text-ink-muted h-7 text-xs"
                          onClick={() => { archiveProduct(p.id, false); toast.success("تمت الاستعادة"); }}
                          title="استعادة من الأرشيف"
                        >
                          <ArchiveRestore className="w-3 h-3" />
                          استعادة
                        </Button>
                        {canDeleteProduct && (
                          <Button
                            size="icon"
                            variant="ghost"
                            className="text-red-600 dark:text-red-400 hover:bg-red-50 dark:bg-red-500/10 w-7 h-7"
                            onClick={() => setToDelete(p)}
                            title="حذف نهائي"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
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

      <ProductFormDialog
        open={formOpen}
        onClose={() => setFormOpen(false)}
        editing={editing}
      />
      <ConfirmDialog
        open={!!toDelete}
        onClose={() => setToDelete(null)}
        onConfirm={handleDelete}
        title="حذف منتج"
        message={`هل أنت متأكد من حذف "${toDelete?.name}"؟`}
        variant="danger"
        confirmText="حذف"
      />

      {/* ── Bulk Price Update Dialog ── */}
      <Dialog
        open={bulkPriceOpen}
        onClose={() => setBulkPriceOpen(false)}
        title={`تعديل أسعار جماعي (${selectedIds.size} صنف)`}
        width="sm"
        footer={
          <>
            <Button variant="outline" onClick={() => setBulkPriceOpen(false)}>إلغاء</Button>
            <Button onClick={handleBulkPriceUpdate} disabled={!bulkPriceValue}>تطبيق التعديل</Button>
          </>
        }
      >
        <div className="space-y-3" dir="rtl">
          <Field label="السعر المراد تعديله">
            <Select value={bulkPriceTarget} onChange={(e) => setBulkPriceTarget(e.target.value as any)}>
              <option value="wholesalePrice">{multiSalePricesEnabled ? "سعر الجملة" : "سعر البيع"}</option>
              {multiSalePricesEnabled && <option value="retailPrice">سعر التجزئة</option>}
              <option value="purchasePrice">سعر الشراء</option>
              <option value="all">كل الأسعار</option>
            </Select>
          </Field>
          <Field label="نوع التعديل">
            <Select value={bulkPriceType} onChange={(e) => setBulkPriceType(e.target.value as any)}>
              <option value="percentage">نسبة مئوية % (مثال: 10 لزيادة 10% أو -5 لتخفيض 5%)</option>
              <option value="fixed_add">إضافة/خصم قيمة ثابتة (مثال: 20 أو -10)</option>
              <option value="set_value">تحديد قيمة ثابتة موحدة</option>
            </Select>
          </Field>
          <Field label="القيمة">
            <Input
              type="number"
              step="any"
              value={bulkPriceValue || ""}
              onChange={(e) => setBulkPriceValue(Number(e.target.value))}
              placeholder="اكتب القيمة..."
              autoFocus
            />
          </Field>
        </div>
      </Dialog>

      {/* ── Bulk Rack Location Dialog ── */}
      <Dialog
        open={bulkRackOpen}
        onClose={() => setBulkRackOpen(false)}
        title={`نقل رف جماعي (${selectedIds.size} صنف)`}
        width="sm"
        footer={
          <>
            <Button variant="outline" onClick={() => setBulkRackOpen(false)}>إلغاء</Button>
            <Button onClick={handleBulkRackUpdate}>حفظ الموقع الجديد</Button>
          </>
        }
      >
        <div className="space-y-3" dir="rtl">
          <Field label="موقع الرف الجديد">
            <Input
              value={bulkRackValue}
              onChange={(e) => setBulkRackValue(e.target.value)}
              placeholder="مثال: A-04-2 أو اتركه فارغاً للإلغاء"
              autoFocus
            />
          </Field>
        </div>
      </Dialog>

      {/* ── Bulk Category / Supplier Dialog ── */}
      <Dialog
        open={bulkCatOpen}
        onClose={() => setBulkCatOpen(false)}
        title={`تغيير الفئة أو المورد (${selectedIds.size} صنف)`}
        width="sm"
        footer={
          <>
            <Button variant="outline" onClick={() => setBulkCatOpen(false)}>إلغاء</Button>
            <Button onClick={handleBulkCatSupplierUpdate}>تطبيق التغييرات</Button>
          </>
        }
      >
        <div className="space-y-3" dir="rtl">
          <Field label="تغيير الفئة إلى (اختياري)">
            <Select value={bulkCatValue} onChange={(e) => setBulkCatValue(e.target.value)}>
              <option value="">— لا تغيير —</option>
              {categories.map((c) => <option key={c} value={c}>{c}</option>)}
            </Select>
          </Field>
          <Field label="تغيير المورد إلى (اختياري)">
            <Select value={bulkSupplierValue} onChange={(e) => setBulkSupplierValue(e.target.value)}>
              <option value="">— لا تغيير —</option>
              <option value="none">بدون مورد</option>
              {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </Select>
          </Field>
        </div>
      </Dialog>

      {/* ── Bulk Delete Confirm Dialog ── */}
      <ConfirmDialog
        open={bulkDeleteOpen}
        onClose={() => setBulkDeleteOpen(false)}
        onConfirm={handleBulkDelete}
        title="حذف/أرشفة جماعية"
        message={`هل أنت متأكد من حذف أو أرشفة ${selectedIds.size} صنف محدد؟`}
        variant="danger"
        confirmText="تأكيد الحذف/الأرشفة"
      />

      {/* ── Alternative Parts Dialog ── */}
      {stockAlternativeModal && (
        <Dialog
          open={Boolean(stockAlternativeModal)}
          onClose={() => setStockAlternativeModal(null)}
          title="القطع البديلة المسجلة"
          subtitle={`بدائل القطعة: ${stockAlternativeModal.product.name} (${stockAlternativeModal.product.partNumber || stockAlternativeModal.product.code})`}
        >
          <div className="space-y-3" dir="rtl">
            <div className="p-3 rounded-xl bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/30 text-amber-900 dark:text-amber-200 text-xs font-semibold">
              القطعة الأصلية نفذت من المخزون. يمكنك الاعتماد على القطع البديلة التالية:
            </div>

            <div className="space-y-2 max-h-80 overflow-y-auto pr-1">
              {stockAlternativeModal.alternatives.map(({ product: alt, relation, notes }) => (
                <div
                  key={alt.id}
                  className="p-3 rounded-xl border border-line bg-surface hover:border-cyan-500/50 transition-all flex items-center justify-between gap-3"
                >
                  <div className="space-y-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-mono text-xs font-bold text-cyan-600 dark:text-cyan-400" dir="ltr">
                        {alt.partNumber || alt.code}
                      </span>
                      <Badge tone={relation === "economy" ? "amber" : relation === "premium" ? "indigo" : "green"}>
                        {relation === "economy" ? "بديل اقتصادي" : relation === "premium" ? "بديل أعلى جودة" : "بديل مطابق"}
                      </Badge>
                      {alt.qualityGrade ? (
                        <Badge tone="slate">{formatQualityGradeLabel(alt.qualityGrade)}</Badge>
                      ) : null}
                    </div>
                    <div className="font-bold text-sm text-ink">{alt.name}</div>
                    <div className="text-xs text-ink-muted flex items-center gap-2 flex-wrap">
                      <span>الماركة: {alt.partBrand || "بدون"}</span>
                      <span>•</span>
                      <span>الفئة: {alt.category}</span>
                      {alt.rackLocation && (
                        <>
                          <span>•</span>
                          <span className="font-semibold text-brand-600">الرف: {alt.rackLocation}</span>
                        </>
                      )}
                    </div>
                    {notes && <div className="text-xs text-amber-700 dark:text-amber-400 italic">{notes}</div>}
                  </div>

                  <div className="text-left shrink-0 space-y-1">
                    <Badge tone={alt.quantity > 0 ? "green" : "red"} className="text-xs">
                      المتاح: {alt.quantity} {alt.unit}
                    </Badge>
                    <div className="font-bold text-sm text-brand-600">
                      {formatCurrency(alt.retailPrice, settings.currency)}
                    </div>
                  </div>
                </div>
              ))}
            </div>

            <div className="pt-2 flex justify-end">
              <Button onClick={() => setStockAlternativeModal(null)}>إغلاق</Button>
            </div>
          </div>
        </Dialog>
      )}
    </>
  );
}
