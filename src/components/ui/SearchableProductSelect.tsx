import { useEffect, useRef, useState, useMemo, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { ChevronDown, Package, Check, X, Box, ScanLine, SlidersHorizontal } from "lucide-react";
import type { Product } from "../../types";
import { isFuzzyMatch } from "../../lib/fuzzySearch";
import { formatQualityGradeLabel } from "../../lib/format";
import { Badge } from "./Badge";
import { NoResultsHint } from "./EmptyState";

const QUALITY_GRADES = ["genuine", "oem", "aftermarket-premium", "aftermarket-economy"] as const;

interface SearchableProductSelectProps {
  products: Product[];
  value: string;
  onChange: (productId: string) => void;
  placeholder?: string;
  searchPlaceholder?: string;
  className?: string;
  disabled?: boolean;
  dropUp?: boolean;
  showStock?: boolean;
  showPrices?: boolean;
  defaultQualityGrade?: string;
}

export function SearchableProductSelect({
  products,
  value,
  onChange,
  placeholder = "— اختر منتجاً أو ابحث —",
  searchPlaceholder = "امسح الباركود أو ابحث بالاسم، Part No.، OEM...",
  className = "",
  disabled = false,
  dropUp,
  showStock = true,
  showPrices = false,
  defaultQualityGrade = "",
}: SearchableProductSelectProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const [showFilters, setShowFilters] = useState(false);
  const [filterCategory, setFilterCategory] = useState("");
  const [filterBrand, setFilterBrand] = useState("");
  const [selectedQualityGrades, setSelectedQualityGrades] = useState<string[]>(
    () => (defaultQualityGrade === "genuine_oem" ? ["genuine", "oem"] : defaultQualityGrade ? [defaultQualityGrade] : [])
  );
  const [openCategoryDropdown, setOpenCategoryDropdown] = useState(false);
  const [openBrandDropdown, setOpenBrandDropdown] = useState(false);
  const [categorySearch, setCategorySearch] = useState("");
  const [brandSearch, setBrandSearch] = useState("");

  const categories = useMemo(
    () => [...new Set(products.map((p) => p.category).filter(Boolean))].sort((a, b) => a.localeCompare(b, "ar")),
    [products],
  );
  const brands = useMemo(
    () => [...new Set(products.map((p) => p.partBrand).filter((b): b is string => Boolean(b)))].sort((a, b) => a.localeCompare(b, "ar")),
    [products],
  );

  const filteredCategoriesList = useMemo(
    () => categories.filter((c) => c.toLowerCase().includes(categorySearch.trim().toLowerCase())),
    [categories, categorySearch]
  );

  const filteredBrandsList = useMemo(
    () => brands.filter((b) => b.toLowerCase().includes(brandSearch.trim().toLowerCase())),
    [brands, brandSearch]
  );

  const activeFilterCount =
    (filterCategory ? 1 : 0) +
    (filterBrand ? 1 : 0) +
    (selectedQualityGrades.length > 0 ? 1 : 0);

  function clearFilters() {
    setFilterCategory("");
    setFilterBrand("");
    setSelectedQualityGrades([]);
    setOpenCategoryDropdown(false);
    setOpenBrandDropdown(false);
    setCategorySearch("");
    setBrandSearch("");
  }

  const [popoverStyle, setPopoverStyle] = useState<{
    top?: number;
    bottom?: number;
    right: number;
    width: number;
    maxHeight: number;
  }>({ right: 0, width: 380, maxHeight: 300 });

  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);

  const selectedProduct = useMemo(
    () => products.find((p) => p.id === value),
    [products, value]
  );

  const filteredProducts = useMemo(() => {
    const q = query.trim().toLowerCase();
    return products.filter((p) => {
      if (filterCategory && p.category !== filterCategory) return false;
      if (filterBrand && p.partBrand !== filterBrand) return false;
      if (selectedQualityGrades.length > 0) {
        if (!p.qualityGrade || !selectedQualityGrades.includes(p.qualityGrade)) return false;
      }
      if (!q) return true;
      const searchTargets = [
        p.name,
        p.partNumber || "",
        p.code || "",
        p.partBrand || "",
        p.category || "",
        p.barcode || "",
        p.rackLocation || "",
        ...(p.oemNumbers || []),
      ];
      return isFuzzyMatch(q, searchTargets);
    });
  }, [products, query, filterCategory, filterBrand, selectedQualityGrades]);

  useEffect(() => {
    setActiveIndex(0);
  }, [filteredProducts]);

  useEffect(() => {
    if (open && itemRefs.current[activeIndex]) {
      itemRefs.current[activeIndex]?.scrollIntoView({
        block: "nearest",
        behavior: "smooth",
      });
    }
  }, [activeIndex, open]);

  const updatePosition = () => {
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const spaceBelow = window.innerHeight - rect.bottom;
    const spaceAbove = rect.top;

    const width = Math.min(Math.max(rect.width, 420), window.innerWidth - 20);
    let right = window.innerWidth - rect.right;
    if (right < 10) right = 10;
    if (right + width > window.innerWidth - 10) {
      right = Math.max(10, window.innerWidth - width - 10);
    }

    const openUpward =
      dropUp !== undefined ? dropUp : spaceBelow < 320 && spaceAbove > spaceBelow;

    if (openUpward) {
      const maxHeight = Math.min(480, spaceAbove - 16);
      setPopoverStyle({
        bottom: window.innerHeight - rect.top + 6,
        right,
        width,
        maxHeight,
      });
    } else {
      const maxHeight = Math.min(480, spaceBelow - 16);
      setPopoverStyle({
        top: rect.bottom + 6,
        right,
        width,
        maxHeight,
      });
    }
  };

  useEffect(() => {
    if (open) {
      setQuery("");
      setActiveIndex(0);
      updatePosition();
      setTimeout(() => inputRef.current?.focus(), 40);
    }
  }, [open, dropUp]);

  useEffect(() => {
    if (!open) return;
    const handleScrollOrResize = () => updatePosition();
    window.addEventListener("scroll", handleScrollOrResize, true);
    window.addEventListener("resize", handleScrollOrResize);
    return () => {
      window.removeEventListener("scroll", handleScrollOrResize, true);
      window.removeEventListener("resize", handleScrollOrResize);
    };
  }, [open]);

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      const target = e.target as Node;
      if (
        containerRef.current &&
        !containerRef.current.contains(target) &&
        !document.getElementById("searchable-product-select-portal")?.contains(target)
      ) {
        setOpen(false);
      }
    }
    if (open) {
      document.addEventListener("mousedown", onClickOutside);
    }
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, [open]);

  function handleSelect(productId: string) {
    onChange(productId);
    setOpen(false);
  }

  function handleKeyDown(e: KeyboardEvent) {
    if (!open) {
      if (e.key === "ArrowDown" || e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        setOpen(true);
      }
      return;
    }

    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((prev) => (prev < filteredProducts.length - 1 ? prev + 1 : 0));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((prev) => (prev > 0 ? prev - 1 : filteredProducts.length - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (filteredProducts[activeIndex]) {
        handleSelect(filteredProducts[activeIndex].id);
      }
    } else if (e.key === "Escape") {
      e.preventDefault();
      setOpen(false);
    }
  }

  const dropdownMenu = open ? (
    <div
      id="searchable-product-select-portal"
      style={{
        position: "fixed",
        top: popoverStyle.top,
        bottom: popoverStyle.bottom,
        right: popoverStyle.right,
        width: popoverStyle.width,
        maxHeight: popoverStyle.maxHeight,
        zIndex: 9999,
      }}
      className="rounded-2xl border border-line bg-surface shadow-2xl overflow-hidden flex flex-col dir-rtl text-ink"
      dir="rtl"
    >
      {/* Search Input Box Header */}
      <div className="p-2.5 border-b border-line bg-surface-muted/40 shrink-0 space-y-2">
        <div className="relative flex items-center">
          <ScanLine className="w-4 h-4 text-cyan-600 dark:text-cyan-400 absolute right-3 pointer-events-none" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={searchPlaceholder}
            className="w-full rounded-xl border border-line bg-surface pr-9 pl-16 py-2 text-sm text-ink placeholder:text-ink-faint outline-none focus:border-cyan-500 focus:ring-2 focus:ring-cyan-500/20 transition-all font-semibold"
          />
          <div className="absolute left-2 flex items-center gap-1">
            <button
              type="button"
              onClick={() => setShowFilters((v) => !v)}
              title="فلاتر متقدمة"
              className={`relative p-1.5 rounded-lg transition-all flex items-center gap-1 text-xs font-bold ${
                showFilters || activeFilterCount > 0
                  ? "text-cyan-600 dark:text-cyan-400 bg-cyan-500/10 border border-cyan-500/30"
                  : "text-ink-faint hover:text-ink hover:bg-surface-muted border border-transparent"
              }`}
            >
              <SlidersHorizontal className="w-3.5 h-3.5" />
              {activeFilterCount > 0 && (
                <span className="grid h-4 min-w-[16px] px-1 place-items-center rounded-full bg-cyan-600 text-[10px] font-extrabold text-white">
                  {activeFilterCount}
                </span>
              )}
            </button>
            {query && (
              <button
                type="button"
                onClick={() => setQuery("")}
                className="p-1 rounded-md text-ink-faint hover:text-ink hover:bg-surface-muted transition-colors"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>

        {showFilters && (
          <div className="p-2 rounded-xl bg-surface border border-line space-y-2 animate-in fade-in duration-150">
            {/* Quality Grade Compact Pills */}
            <div className="space-y-1">
              <div className="flex items-center justify-between text-[11px] font-bold text-ink-muted">
                <span>تصفية حسب الجودة:</span>
                {selectedQualityGrades.length > 0 ? (
                  <button
                    type="button"
                    onClick={() => setSelectedQualityGrades([])}
                    className="text-[10px] text-rose-500 hover:text-rose-600 font-bold"
                  >
                    تحديد الكل
                  </button>
                ) : (
                  <span className="text-[10px] text-emerald-600 font-bold">(عرض الكل)</span>
                )}
              </div>
              <div className="flex flex-wrap gap-1">
                {QUALITY_GRADES.map((grade) => {
                  const isChecked = selectedQualityGrades.includes(grade);
                  return (
                    <button
                      key={grade}
                      type="button"
                      onClick={() => {
                        setSelectedQualityGrades((prev) =>
                          prev.includes(grade)
                            ? prev.filter((g) => g !== grade)
                            : [...prev, grade]
                        );
                      }}
                      className={`px-2 py-0.5 text-[11px] font-bold rounded-lg border transition-all flex items-center gap-1 select-none ${
                        isChecked
                          ? "bg-cyan-600 text-white border-cyan-600 shadow-sm"
                          : "bg-surface text-ink-muted border-line hover:border-cyan-500/50"
                      }`}
                    >
                      <span className={`w-3 h-3 rounded text-[9px] flex items-center justify-center ${isChecked ? "bg-white/20 text-white font-black" : "border border-line"}`}>
                        {isChecked ? "✓" : ""}
                      </span>
                      <span>{formatQualityGradeLabel(grade)}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Category & Brand Custom Dropdowns in 1 Row */}
            <div className="grid grid-cols-2 gap-1.5 pt-1.5 border-t border-line/60">
              {/* Custom Category Dropdown */}
              <div className="relative">
                <button
                  type="button"
                  onClick={() => {
                    setOpenCategoryDropdown((v) => !v);
                    setOpenBrandDropdown(false);
                  }}
                  className="w-full rounded-lg border border-line bg-surface px-2 py-1 text-xs text-ink flex items-center justify-between font-bold hover:border-cyan-500/50 transition-colors"
                >
                  <span className="truncate">{filterCategory ? filterCategory : `كل الفئات (${categories.length})`}</span>
                  <ChevronDown className="w-3.5 h-3.5 text-ink-faint shrink-0 ml-0.5" />
                </button>

                {openCategoryDropdown && (
                  <div className="absolute top-full right-0 left-0 mt-1 z-[10000] max-h-48 overflow-y-auto rounded-xl border border-line bg-surface shadow-2xl p-1 text-xs space-y-0.5 dir-rtl">
                    <div className="p-1 border-b border-line/60 sticky top-0 bg-surface z-10">
                      <input
                        type="text"
                        value={categorySearch}
                        onChange={(e) => setCategorySearch(e.target.value)}
                        placeholder="ابحث عن فئة..."
                        className="w-full rounded-md border border-line bg-surface-muted px-2 py-1 text-[11px] text-ink outline-none focus:border-cyan-500 font-semibold"
                        onClick={(e) => e.stopPropagation()}
                      />
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setFilterCategory("");
                        setOpenCategoryDropdown(false);
                        setCategorySearch("");
                      }}
                      className={`w-full text-right px-2 py-1 rounded-lg transition-colors font-bold ${
                        !filterCategory ? "bg-cyan-500/10 text-cyan-600 dark:text-cyan-400" : "hover:bg-surface-muted text-ink"
                      }`}
                    >
                      كل الفئات ({categories.length})
                    </button>
                    {filteredCategoriesList.map((c) => (
                      <button
                        key={c}
                        type="button"
                        onClick={() => {
                          setFilterCategory(c);
                          setOpenCategoryDropdown(false);
                          setCategorySearch("");
                        }}
                        className={`w-full text-right px-2 py-1 rounded-lg transition-colors truncate font-semibold ${
                          filterCategory === c ? "bg-cyan-500/10 text-cyan-600 dark:text-cyan-400 font-bold" : "hover:bg-surface-muted text-ink"
                        }`}
                      >
                        {c}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Custom Brand Dropdown */}
              <div className="relative">
                <button
                  type="button"
                  onClick={() => {
                    setOpenBrandDropdown((v) => !v);
                    setOpenCategoryDropdown(false);
                  }}
                  className="w-full rounded-lg border border-line bg-surface px-2 py-1 text-xs text-ink flex items-center justify-between font-bold hover:border-cyan-500/50 transition-colors"
                >
                  <span className="truncate">{filterBrand ? filterBrand : `كل الماركات (${brands.length})`}</span>
                  <ChevronDown className="w-3.5 h-3.5 text-ink-faint shrink-0 ml-0.5" />
                </button>

                {openBrandDropdown && (
                  <div className="absolute top-full right-0 left-0 mt-1 z-[10000] max-h-48 overflow-y-auto rounded-xl border border-line bg-surface shadow-2xl p-1 text-xs space-y-0.5 dir-rtl">
                    <div className="p-1 border-b border-line/60 sticky top-0 bg-surface z-10">
                      <input
                        type="text"
                        value={brandSearch}
                        onChange={(e) => setBrandSearch(e.target.value)}
                        placeholder="ابحث عن ماركة..."
                        className="w-full rounded-md border border-line bg-surface-muted px-2 py-1 text-[11px] text-ink outline-none focus:border-cyan-500 font-semibold"
                        onClick={(e) => e.stopPropagation()}
                      />
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setFilterBrand("");
                        setOpenBrandDropdown(false);
                        setBrandSearch("");
                      }}
                      className={`w-full text-right px-2 py-1 rounded-lg transition-colors font-bold ${
                        !filterBrand ? "bg-cyan-500/10 text-cyan-600 dark:text-cyan-400" : "hover:bg-surface-muted text-ink"
                      }`}
                    >
                      كل الماركات ({brands.length})
                    </button>
                    {filteredBrandsList.map((b) => (
                      <button
                        key={b}
                        type="button"
                        onClick={() => {
                          setFilterBrand(b);
                          setOpenBrandDropdown(false);
                          setBrandSearch("");
                        }}
                        className={`w-full text-right px-2 py-1 rounded-lg transition-colors truncate font-semibold ${
                          filterBrand === b ? "bg-cyan-500/10 text-cyan-600 dark:text-cyan-400 font-bold" : "hover:bg-surface-muted text-ink"
                        }`}
                      >
                        {b}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        <div className="flex items-center justify-between px-1 text-[11px] text-ink-faint font-medium">
          <span>{filteredProducts.length} قطعة متوفرة</span>
          {activeFilterCount > 0 ? (
            <button type="button" onClick={clearFilters} className="text-rose-500 hover:text-rose-600 font-bold">
              مسح الفلاتر ({activeFilterCount})
            </button>
          ) : (
            <span>(↑↓) للتنقل • (Enter) للاختيار</span>
          )}
        </div>
      </div>

      {/* Product Items List */}
      <div
        ref={listRef}
        style={{ maxHeight: Math.max(200, popoverStyle.maxHeight - (showFilters ? 120 : 60)) }}
        className="overflow-y-auto divide-y divide-line/40 p-1.5 flex-1"
      >
        {/* Clear / Unselect Option */}
        <button
          type="button"
          onClick={() => handleSelect("")}
          className={`w-full text-right px-3 py-2 rounded-xl text-xs font-semibold transition-colors flex items-center justify-between mb-1 ${
            value === ""
              ? "bg-cyan-500/10 text-cyan-700 dark:text-cyan-300 border border-cyan-500/30"
              : "text-ink-muted hover:bg-surface-muted"
          }`}
        >
          <span>— بدون تحديد —</span>
          {value === "" && <Check className="w-3.5 h-3.5 text-cyan-500" />}
        </button>

        {filteredProducts.length === 0 ? (
          <NoResultsHint
            icon={<Box className="w-8 h-8 opacity-40 stroke-[1.5]" />}
            message={`لا توجد نتائج مطابقة لـ "${query}"`}
          />
        ) : (
          filteredProducts.map((p, idx) => {
            const isSelected = value === p.id;
            const isHighlighted = activeIndex === idx;
            const oem = p.oemNumbers?.[0];

            return (
              <button
                key={p.id}
                ref={(el) => {
                  itemRefs.current[idx] = el;
                }}
                type="button"
                onClick={() => handleSelect(p.id)}
                onMouseEnter={() => setActiveIndex(idx)}
                className={`w-full text-right p-2.5 my-0.5 rounded-xl transition-all flex flex-col gap-1.5 cursor-pointer border ${
                  isHighlighted
                    ? "bg-cyan-500/10 border-cyan-500/40 text-ink shadow-sm"
                    : isSelected
                    ? "bg-surface-muted border-line text-ink font-semibold"
                    : "border-transparent text-ink hover:bg-surface-muted/60"
                }`}
              >
                {/* Top Row: Code Badge + Product Name + Stock Tag / Checkmark */}
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="shrink-0 px-2 py-0.5 rounded-md bg-surface-muted text-ink font-mono text-xs font-bold border border-line">
                      {p.partNumber || p.code}
                    </span>
                    <span className="font-bold text-ink text-sm truncate">
                      {p.name}
                    </span>
                  </div>

                  <div className="flex items-center gap-1.5 shrink-0">
                    {showStock && (
                      <Badge
                        tone={p.quantity > p.minStock ? "green" : p.quantity > 0 ? "amber" : "rose"}
                      >
                        المتاح: {p.quantity} {p.unit}
                      </Badge>
                    )}
                    {isSelected && <Check className="w-4 h-4 text-cyan-500 shrink-0" />}
                  </div>
                </div>

                {/* Bottom Row: Details (Brand, Category, OEM, Rack, Price) */}
                <div className="flex flex-wrap items-center gap-2 text-xs text-ink-muted">
                  {p.partBrand && (
                    <span className="bg-surface-muted px-2 py-0.5 rounded text-[11px] font-medium border border-line text-ink-muted">
                      {p.partBrand}
                    </span>
                  )}
                  {p.category && (
                    <span className="text-ink-faint text-[11px]">
                      {p.category}
                    </span>
                  )}
                  {oem && (
                    <span className="font-mono text-[11px] text-ink-faint bg-surface-muted px-1.5 py-0.5 rounded border border-line" dir="ltr">
                      OEM: {oem}
                    </span>
                  )}
                  {p.rackLocation && (
                    <span className="text-[11px] text-amber-600 dark:text-amber-400 font-medium">
                      الرف: {p.rackLocation}
                    </span>
                  )}
                  {showPrices && (
                    <span className="mr-auto font-semibold text-emerald-600 dark:text-emerald-400">
                      {p.wholesalePrice} ج.م
                    </span>
                  )}
                </div>
              </button>
            );
          })
        )}
      </div>
    </div>
  ) : null;

  return (
    <div ref={containerRef} className={`relative ${className}`} onKeyDown={handleKeyDown}>
      {/* Trigger Button */}
      <button
        type="button"
        onClick={() => !disabled && setOpen((o) => !o)}
        disabled={disabled}
        className={`group flex items-center justify-between w-full min-h-[42px] px-3 py-2 rounded-xl border text-right transition-all outline-none ${
          open
            ? "border-cyan-500 ring-2 ring-cyan-500/20 bg-surface shadow-sm"
            : "border-line bg-surface hover:border-cyan-500/60 hover:bg-surface-muted/30"
        } ${disabled ? "opacity-50 cursor-not-allowed bg-surface-muted" : "cursor-pointer"}`}
      >
        <div className="flex items-center gap-2 min-w-0 flex-1 pl-1">
          {selectedProduct ? (
            <div className="flex items-center gap-2 truncate min-w-0">
              <span className="shrink-0 px-2 py-0.5 rounded-md bg-cyan-500/10 text-cyan-700 dark:text-cyan-300 font-mono text-xs font-bold border border-cyan-500/30">
                {selectedProduct.partNumber || selectedProduct.code}
              </span>
              <span className="font-bold text-ink text-sm truncate">
                {selectedProduct.name}
              </span>
              {selectedProduct.partBrand && (
                <span className="shrink-0 text-xs text-ink-muted bg-surface-muted px-2 py-0.5 rounded-md border border-line">
                  {selectedProduct.partBrand}
                </span>
              )}
            </div>
          ) : (
            <div className="flex items-center gap-2 text-ink-faint text-sm">
              <Package className="w-4 h-4 shrink-0 opacity-70" />
              <span className="truncate">{placeholder}</span>
            </div>
          )}
        </div>

        <div className="flex items-center gap-1.5 shrink-0 mr-1">
          {selectedProduct && !disabled && (
            <span
              role="button"
              tabIndex={0}
              onClick={(e) => {
                e.stopPropagation();
                onChange("");
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.stopPropagation();
                  onChange("");
                }
              }}
              title="إلغاء التحديد"
              className="p-1 rounded-md text-ink-faint hover:text-rose-500 hover:bg-rose-500/10 transition-colors"
            >
              <X className="w-3.5 h-3.5" />
            </span>
          )}
          <ChevronDown
            className={`w-4 h-4 text-ink-faint transition-transform duration-200 ${
              open ? "rotate-180 text-cyan-500" : "group-hover:text-ink"
            }`}
          />
        </div>
      </button>

      {/* Render Dropdown Menu into document.body using React Portal */}
      {dropdownMenu && createPortal(dropdownMenu, document.body)}
    </div>
  );
}
