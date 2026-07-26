import { useEffect, useRef, useState, useMemo, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { ChevronDown, Search, Check, Plus, X } from "lucide-react";
import { isFuzzyMatch } from "../../lib/fuzzySearch";
import { NoResultsHint } from "./EmptyState";
import { cn } from "../../lib/utils";

interface Option {
  value: string;
  label: string;
  searchText?: string;
  image?: string;
}

export function SearchableSelect({
  value,
  onChange,
  options,
  placeholder = "الكل",
  searchPlaceholder = "ابحث...",
  minChars = 0,
  className = "",
  onCreate,
  createLabel,
  disabled = false,
  dropUp,
  clearable = true,
}: {
  value: string;
  onChange: (value: string) => void;
  options: Option[];
  placeholder?: string;
  searchPlaceholder?: string;
  minChars?: number;
  className?: string;
  onCreate?: (query: string) => void;
  createLabel?: string;
  disabled?: boolean;
  dropUp?: boolean;
  clearable?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);

  const [popoverStyle, setPopoverStyle] = useState<{
    top?: number;
    bottom?: number;
    right: number;
    width: number;
    maxHeight: number;
  }>({ right: 0, width: 340, maxHeight: 320 });

  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);

  const selectedOption = useMemo(
    () => options.find((o) => o.value === value),
    [options, value]
  );
  const selectedLabel = selectedOption?.label ?? placeholder;

  const normalizedQuery = query.trim().toLowerCase();
  const exactMatch =
    normalizedQuery.length > 0 &&
    options.some(
      (o) =>
        o.label.toLowerCase() === normalizedQuery ||
        o.value.toLowerCase() === normalizedQuery ||
        o.searchText?.toLowerCase().includes(normalizedQuery)
    );

  const filtered = useMemo(() => {
    if (query.length < minChars) return options;
    return options.filter((o) => isFuzzyMatch(query, [o.label, o.value, o.searchText]));
  }, [options, query, minChars]);

  const canCreate = onCreate && normalizedQuery.length > 0 && !exactMatch;

  useEffect(() => {
    setActiveIndex(0);
  }, [filtered]);

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

    const width = Math.min(Math.max(rect.width, 360), window.innerWidth - 20);
    let right = window.innerWidth - rect.right;
    if (right < 10) right = 10;
    if (right + width > window.innerWidth - 10) {
      right = Math.max(10, window.innerWidth - width - 10);
    }

    const openUpward =
      dropUp !== undefined ? dropUp : spaceBelow < 260 && spaceAbove > spaceBelow;

    if (openUpward) {
      const maxHeight = Math.min(320, spaceAbove - 16);
      setPopoverStyle({
        bottom: window.innerHeight - rect.top + 4,
        right,
        width,
        maxHeight,
      });
    } else {
      const maxHeight = Math.min(320, spaceBelow - 16);
      setPopoverStyle({
        top: rect.bottom + 4,
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
        !document.getElementById("searchable-select-portal")?.contains(target)
      ) {
        setOpen(false);
      }
    }
    if (open) {
      document.addEventListener("mousedown", onClickOutside);
    }
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, [open]);

  function select(val: string) {
    onChange(val);
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
      setActiveIndex((prev) => (prev < filtered.length - 1 ? prev + 1 : 0));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((prev) => (prev > 0 ? prev - 1 : filtered.length - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (filtered[activeIndex]) {
        select(filtered[activeIndex].value);
      }
    } else if (e.key === "Escape") {
      e.preventDefault();
      setOpen(false);
    }
  }

  const dropdownMenu = open ? (
    <div
      id="searchable-select-portal"
      style={{
        position: "fixed",
        top: popoverStyle.top,
        bottom: popoverStyle.bottom,
        right: popoverStyle.right,
        width: popoverStyle.width,
        zIndex: 9999,
      }}
      className="rounded-lg border border-line bg-surface shadow-2xl overflow-hidden flex flex-col dir-rtl"
      dir="rtl"
    >
      {/* Search input header */}
      <div className="flex items-center gap-2 px-2.5 py-2 border-b border-line bg-surface-muted/50 shrink-0">
        <Search className="w-4 h-4 text-ink-faint shrink-0" />
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={query.length < minChars ? `اكتب ${minChars} أحرف للبحث...` : searchPlaceholder}
          className="flex-1 rounded-md border border-line bg-surface px-2.5 py-1 text-xs text-ink placeholder:text-ink-faint outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20"
        />
        {query && (
          <button
            type="button"
            onClick={() => setQuery("")}
            className="p-1 rounded text-ink-faint hover:text-ink transition-colors"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      {/* Options list */}
      <div
        style={{ maxHeight: Math.max(120, popoverStyle.maxHeight - 45) }}
        className="overflow-y-auto p-1 divide-y divide-line/30"
      >
        {/* Placeholder / Clear Option - only when query is empty and clearable is true */}
        {clearable && query.length === 0 && (
          <button
            type="button"
            onClick={() => select("")}
            className={cn(
              "w-full text-right px-3 py-2 text-xs rounded-md transition-colors flex items-center justify-between font-medium",
              value === ""
                ? "text-brand-600 bg-brand-500/10 font-semibold"
                : "text-ink-muted hover:bg-surface-muted"
            )}
          >
            <span>{placeholder}</span>
            {value === "" && <Check className="w-3.5 h-3.5 text-brand-600" />}
          </button>
        )}

        {query.length > 0 && query.length < minChars ? (
          <div className="px-3 py-3 text-xs text-ink-faint text-center">
            أكتب {minChars - query.length} أحرف أكتر للبحث
          </div>
        ) : (
          <>
            {filtered.length === 0 ? (
              <NoResultsHint message="لا توجد نتائج" className="py-3 text-xs" />
            ) : (
              filtered.map((o, idx) => {
                const isSelected = value === o.value;
                const isHighlighted = activeIndex === idx;
                return (
                  <button
                    key={o.value}
                    ref={(el) => {
                      itemRefs.current[idx] = el;
                    }}
                    type="button"
                    onClick={() => select(o.value)}
                    onMouseEnter={() => setActiveIndex(idx)}
                    className={cn(
                      "w-full text-right px-3 py-2.5 text-xs rounded-md transition-colors flex items-center justify-between gap-2 my-0.5 border border-transparent",
                      isHighlighted
                        ? "bg-brand-500/10 text-ink font-semibold border-brand-500/30"
                        : isSelected
                        ? "bg-surface-muted text-ink font-semibold"
                        : "text-ink hover:bg-surface-muted/60"
                    )}
                  >
                    <div className="flex items-center gap-2.5 flex-1 min-w-0">
                      {o.image && (
                        <div className="w-6 h-6 rounded bg-white dark:bg-slate-800/90 p-0.5 flex items-center justify-center border border-line/70 shrink-0 shadow-sm">
                          <img
                            src={o.image}
                            alt=""
                            className="w-full h-full object-contain"
                            onError={(e) => {
                              (e.currentTarget.parentElement as HTMLElement).style.display = "none";
                            }}
                          />
                        </div>
                      )}
                      <span className="text-xs font-medium text-right leading-relaxed text-ink break-words" title={o.label}>
                        {o.label}
                      </span>
                    </div>
                    {isSelected && <Check className="w-3.5 h-3.5 text-brand-600 shrink-0" />}
                  </button>
                );
              })
            )}

            {canCreate && (
              <button
                type="button"
                onClick={() => {
                  onCreate?.(normalizedQuery);
                  setOpen(false);
                }}
                className="w-full text-right px-3 py-2 text-xs text-brand-600 border-t border-line hover:bg-surface-muted transition-colors font-semibold flex items-center gap-1.5"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>
                  {createLabel
                    ? createLabel.includes('"')
                      ? createLabel
                      : `${createLabel}: "${normalizedQuery}"`
                    : `إضافة جديد: "${normalizedQuery}"`}
                </span>
              </button>
            )}
          </>
        )}
      </div>
    </div>
  ) : null;

  return (
    <div
      ref={containerRef}
      className={cn("relative inline-block w-full", className)}
      onKeyDown={handleKeyDown}
    >
      {/* Trigger */}
      <button
        type="button"
        onClick={() => !disabled && setOpen((o) => !o)}
        disabled={disabled}
        className={cn(
          "flex items-center justify-between w-full min-h-[36px] px-3 py-1.5 rounded-lg border border-line bg-surface text-xs text-ink cursor-pointer hover:border-brand-400 disabled:bg-surface-muted disabled:text-ink-faint disabled:cursor-not-allowed transition-all focus-ring relative text-right shadow-sm",
          open && "border-brand-500 ring-2 ring-brand-500/20"
        )}
        title={selectedOption ? selectedLabel : placeholder}
      >
        <div className="flex items-center gap-2 truncate flex-1 min-w-0 pr-0 pl-5">
          {selectedOption?.image && (
            <div className="w-5 h-5 rounded bg-white dark:bg-slate-800/90 p-0.5 flex items-center justify-center border border-line/70 shrink-0 shadow-sm">
              <img
                src={selectedOption.image}
                alt=""
                className="w-full h-full object-contain"
                onError={(e) => {
                  (e.currentTarget.parentElement as HTMLElement).style.display = "none";
                }}
              />
            </div>
          )}
          <span className="truncate font-medium text-xs">
            {selectedOption ? selectedLabel : <span className="text-ink-faint">{placeholder}</span>}
          </span>
        </div>
        <ChevronDown
          className={cn(
            "w-4 h-4 text-ink-faint absolute left-2.5 top-1/2 -translate-y-1/2 transition-transform duration-200",
            open && "rotate-180 text-brand-600"
          )}
        />
      </button>

      {/* Render Dropdown Menu into document.body using React Portal */}
      {dropdownMenu && createPortal(dropdownMenu, document.body)}
    </div>
  );
}
