import { useEffect, useRef, useState, useMemo, type KeyboardEvent } from "react";
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
  const [isDropUp, setIsDropUp] = useState(false);

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

  // Reset active index when query or filtered products change
  useEffect(() => {
    setActiveIndex(0);
  }, [filteredProducts]);

  // Auto-scroll active item into view
  useEffect(() => {
    if (open && itemRefs.current[activeIndex]) {
      itemRefs.current[activeIndex]?.scrollIntoView({
        block: "nearest",
        behavior: "smooth",
      });
    }
  }, [activeIndex, open]);

  // Position calculation and input focus when dropdown opens
  useEffect(() => {
    if (open) {
      setQuery("");
      setActiveIndex(0);
      if (dropUp !== undefined) {
        setIsDropUp(dropUp);
      } else if (containerRef.current) {
        const rect = containerRef.current.getBoundingClientRect();
        const spaceBelow = window.innerHeight - rect.bottom;
        setIsDropUp(spaceBelow < 350 && rect.top > 250);
      }
      setTimeout(() => inputRef.current?.focus(), 40);
    }
  }, [open, dropUp]);

  // Handle click outside to close dropdown
  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

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

  return (
    <div ref={containerRef} className={`relative ${className}`} onKeyDown={handleKeyDown}>
      {/* Trigger Button */}
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        disabled={disabled}
        className={`group flex items-center justify-between w-full min-h-[42px] px-3.5 py-2 rounded-xl border transition-all text-right cursor-pointer ${
          open
            ? "border-brand-500 ring-2 ring-brand-500/20 bg-surface"
            : "border-line bg-surface hover:border-brand-400/80 hover:bg-surface-muted/30"
        } disabled:bg-surface-muted disabled:text-ink-faint disabled:cursor-not-allowed`}
      >
        <div className="flex items-center gap-2.5 min-w-0 flex-1 pl-2">
          {selectedProduct ? (
            <div className="flex items-center gap-2 truncate min-w-0">
              <span className="shrink-0 px-2 py-0.5 rounded-md bg-brand-50 dark:bg-brand-500/20 text-brand-700 dark:text-brand-300 font-mono text-xs font-semibold border border-brand-200/50 dark:border-brand-500/30">
                {selectedProduct.partNumber || selectedProduct.code}
              </span>
              <span className="font-semibold text-ink text-sm truncate">
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
              <Package className="w-4 h-4 shrink-0 text-ink-faint" />
              <span className="truncate">{placeholder}</span>
            </div>
          )}
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
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
              className="p-1 rounded-md text-ink-faint hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/30 transition-colors"
            >
              <X className="w-3.5 h-3.5" />
            </span>
          )}
          <ChevronDown
            className={`w-4 h-4 text-ink-faint transition-transform duration-200 ${
              open ? "rotate-180 text-brand-500" : "group-hover:text-ink"
            }`}
          />
        </div>
      </button>

      {/* Dropdown Menu Popup */}
      {open && (
        <div
          className={`absolute z-50 right-0 left-0 min-w-[320px] max-w-[650px] w-full rounded-2xl border border-line bg-surface shadow-2xl overflow-hidden transition-all duration-150 ${
            isDropUp ? "bottom-full mb-2" : "top-full mt-2"
          }`}
        >
          {/* Search Box Header */}
          <div className="p-2.5 border-b border-line bg-surface-muted/40">
            <div className="relative flex items-center">
              <Search className="w-4 h-4 text-ink-faint absolute right-3 pointer-events-none" />
              <input
                ref={inputRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={searchPlaceholder}
                className="w-full rounded-xl border border-line bg-surface pr-9 pl-8 py-2 text-sm text-ink placeholder:text-ink-faint outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 transition-all"
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
              <span>استخدم أسهم اللوحة (↑↓) للتنقل و (Enter) للاختيار</span>
            </div>
          </div>

          {/* Product Items List */}
          <div ref={listRef} className="max-h-72 overflow-y-auto divide-y divide-line/40 p-1">
            {/* Clear / Unselect Option */}
            <button
              type="button"
              onClick={() => handleSelect("")}
              className={`w-full text-right px-3 py-2 rounded-xl text-xs font-semibold transition-colors flex items-center justify-between ${
                value === ""
                  ? "bg-brand-50 text-brand-700 dark:bg-brand-950/40 dark:text-brand-300"
                  : "text-ink-muted hover:bg-surface-muted"
              }`}
            >
              <span>— بدون تحديد —</span>
              {value === "" && <Check className="w-3.5 h-3.5 text-brand-600" />}
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
                        ? "bg-brand-50/80 dark:bg-brand-950/50 border-brand-300 dark:border-brand-700/60 shadow-sm"
                        : isSelected
                        ? "bg-surface-muted/70 border-line font-medium"
                        : "border-transparent hover:bg-surface-muted/50"
                    }`}
                  >
                    {/* Top Row: Part Number Badge + Name + Stock/Check */}
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="shrink-0 px-2 py-0.5 rounded-md bg-slate-100 dark:bg-slate-800 text-slate-800 dark:text-slate-200 font-mono text-xs font-bold border border-slate-200 dark:border-slate-700">
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
                        {isSelected && <Check className="w-4 h-4 text-brand-600 shrink-0" />}
                      </div>
                    </div>

                    {/* Bottom Row: Metadata (Brand, Category, OEM, Prices) */}
                    <div className="flex flex-wrap items-center gap-2 text-xs text-ink-muted">
                      {p.partBrand && (
                        <span className="bg-surface-muted px-2 py-0.5 rounded text-[11px] font-medium border border-line">
                          {p.partBrand}
                        </span>
                      )}
                      {p.category && (
                        <span className="text-ink-faint text-[11px]">
                          {p.category}
                        </span>
                      )}
                      {oem && (
                        <span className="font-mono text-[11px] text-ink-faint bg-slate-50 dark:bg-slate-900/50 px-1.5 py-0.5 rounded border border-line/60" dir="ltr">
                          OEM: {oem}
                        </span>
                      )}
                      {p.rackLocation && (
                        <span className="text-[11px] text-amber-700 dark:text-amber-400">
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
      )}
    </div>
  );
}
