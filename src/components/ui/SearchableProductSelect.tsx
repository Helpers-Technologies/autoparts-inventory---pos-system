import { useEffect, useRef, useState, useMemo, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { ChevronDown, Search, Package, Check, X, Box } from "lucide-react";
import type { Product } from "../../types";
import { isFuzzyMatch } from "../../lib/fuzzySearch";
import { Badge } from "./Badge";

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
}

export function SearchableProductSelect({
  products,
  value,
  onChange,
  placeholder = "— اختر منتجاً أو ابحث —",
  searchPlaceholder = "ابحث بالاسم، رقم القطعة، OEM، الباركود، الماركة...",
  className = "",
  disabled = false,
  dropUp,
  showStock = true,
  showPrices = false,
}: SearchableProductSelectProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);

  const [popoverStyle, setPopoverStyle] = useState<{
    top?: number;
    bottom?: number;
    right: number;
    width: number;
    maxHeight: number;
  }>({ right: 0, width: 360, maxHeight: 300 });

  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);

  const selectedProduct = useMemo(
    () => products.find((p) => p.id === value),
    [products, value]
  );

  const filteredProducts = useMemo(() => {
    if (!query.trim()) return products;
    const q = query.trim().toLowerCase();
    return products.filter((p) => {
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
  }, [products, query]);

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

    const width = Math.min(Math.max(rect.width, 380), window.innerWidth - 20);
    let right = window.innerWidth - rect.right;
    if (right < 10) right = 10;
    if (right + width > window.innerWidth - 10) {
      right = Math.max(10, window.innerWidth - width - 10);
    }

    const openUpward =
      dropUp !== undefined ? dropUp : spaceBelow < 280 && spaceAbove > spaceBelow;

    if (openUpward) {
      const maxHeight = Math.min(320, spaceAbove - 16);
      setPopoverStyle({
        bottom: window.innerHeight - rect.top + 6,
        right,
        width,
        maxHeight,
      });
    } else {
      const maxHeight = Math.min(320, spaceBelow - 16);
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
        zIndex: 9999,
      }}
      className="rounded-2xl border border-line bg-surface shadow-2xl overflow-hidden flex flex-col dir-rtl"
      dir="rtl"
    >
      {/* Search Input Box Header */}
      <div className="p-2.5 border-b border-line bg-surface-muted/60 shrink-0">
        <div className="relative flex items-center">
          <Search className="w-4 h-4 text-ink-faint absolute right-3 pointer-events-none" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={searchPlaceholder}
            className="w-full rounded-xl border border-line bg-surface pr-9 pl-8 py-2 text-sm text-ink placeholder:text-ink-faint outline-none focus:border-cyan-500 focus:ring-2 focus:ring-cyan-500/20 transition-all"
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery("")}
              className="absolute left-2.5 p-1 rounded-md text-ink-faint hover:text-ink hover:bg-surface-muted transition-colors"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
        <div className="flex items-center justify-between mt-2 px-1 text-[11px] text-ink-faint font-medium">
          <span>{filteredProducts.length} قطعة متوفرة</span>
          <span>(↑↓) للتنقل • (Enter) للاختيار</span>
        </div>
      </div>

      {/* Product Items List */}
      <div
        ref={listRef}
        style={{ maxHeight: Math.max(120, popoverStyle.maxHeight - 75) }}
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
          <div className="py-8 text-center text-sm text-ink-faint">
            <Box className="w-8 h-8 mx-auto mb-2 opacity-40 stroke-[1.5]" />
            لا توجد نتائج مطابقة لـ "{query}"
          </div>
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
