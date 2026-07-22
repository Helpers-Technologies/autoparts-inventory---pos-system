import { useEffect, useRef, useState } from "react";
import { ChevronDown, Search } from "lucide-react";
import { isFuzzyMatch } from "../../lib/fuzzySearch";

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
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [isDropUp, setIsDropUp] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const selectedOption = options.find((o) => o.value === value);
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
  const filtered =
    query.length >= minChars
      ? options.filter((o) => isFuzzyMatch(query, [o.label, o.value, o.searchText]))
      : options;
  const canCreate = onCreate && normalizedQuery.length > 0 && !exactMatch;

  useEffect(() => {
    if (open) {
      setQuery("");
      if (dropUp !== undefined) {
        setIsDropUp(dropUp);
      } else if (containerRef.current) {
        const rect = containerRef.current.getBoundingClientRect();
        const spaceBelow = window.innerHeight - rect.bottom;
        setIsDropUp(spaceBelow < 320 && rect.top > 200);
      }
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open, dropUp]);

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  function select(val: string) {
    onChange(val);
    setOpen(false);
  }

  return (
    <div ref={containerRef} className={`relative ${className}`}>
      {/* Trigger */}
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        disabled={disabled}
        className="flex items-center justify-between w-full h-10 px-3 rounded-lg border border-line bg-surface text-sm text-ink cursor-pointer hover:border-brand-400 disabled:bg-surface-muted disabled:text-ink-faint disabled:cursor-not-allowed transition-colors focus-ring relative"
      >
        <div className="flex items-center gap-2.5 truncate w-full pr-1 pl-6">
          {selectedOption?.image && (
            <div className="w-7 h-7 rounded bg-white dark:bg-slate-800/90 p-0.5 flex items-center justify-center border border-line/70 shrink-0 shadow-sm">
              <img src={selectedOption.image} alt="" className="w-full h-full object-contain" onError={(e) => { e.currentTarget.style.display = 'none'; }} />
            </div>
          )}
          <span className="truncate font-medium">{selectedLabel}</span>
        </div>
        <ChevronDown className={`w-4 h-4 text-ink-faint absolute left-3 top-1/2 -translate-y-1/2 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {/* Dropdown */}
      {open && (
        <div
          className={`absolute z-50 right-0 min-w-full w-max max-w-[550px] rounded-xl border border-line bg-surface shadow-2xl overflow-hidden ${
            isDropUp ? "bottom-full mb-2" : "top-full mt-2"
          }`}
        >
          {/* Search input */}
          <div className="flex items-center gap-2 px-3 py-3 border-b border-line bg-surface-muted/50">
            <Search className="w-4 h-4 text-ink-faint shrink-0" />
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={query.length < minChars ? `اكتب ${minChars} أحرف للبحث...` : searchPlaceholder}
              className="flex-1 rounded-xl border border-line bg-surface px-3 py-2 text-sm text-ink placeholder:text-ink-faint outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-400/20"
            />
          </div>

          {/* Options */}
          <div className="max-h-64 overflow-y-auto">
            {/* "الكل" option */}
            <button
              type="button"
              onClick={() => select("")}
              className={`w-full text-right px-4 py-3 text-sm hover:bg-surface-muted transition-colors ${value === "" ? "text-brand-400 font-semibold" : "text-ink"}`}
            >
              {placeholder}
            </button>

            {query.length > 0 && query.length < minChars ? (
              <div className="px-4 py-4 text-xs text-ink-faint text-center">
                أكتب {minChars - query.length} أحرف أكتر للبحث
              </div>
            ) : (
              <>
                {filtered.length === 0 ? (
                  <div className="px-4 py-4 text-xs text-ink-faint text-center">لا توجد نتائج</div>
                ) : (
                  filtered.map((o) => (
                    <button
                      key={o.value}
                      type="button"
                      onClick={() => select(o.value)}
                      className={`w-full text-right px-4 py-2.5 text-sm hover:bg-surface-muted transition-colors flex items-center gap-3 ${value === o.value ? "text-brand-400 font-semibold bg-surface-muted/40" : "text-ink"}`}
                    >
                      {o.image && (
                        <div className="w-10 h-10 rounded-lg bg-white dark:bg-slate-800/90 p-1 flex items-center justify-center border border-line/70 shrink-0 shadow-sm">
                          <img src={o.image} alt="" className="w-full h-full object-contain" onError={(e) => { (e.currentTarget.parentElement as HTMLElement).style.display = 'none'; }} />
                        </div>
                      )}
                      <span className="whitespace-nowrap font-medium text-sm sm:text-base">{o.label}</span>
                    </button>
                  ))
                )}
                {canCreate && (
                  <button
                    type="button"
                    onClick={() => {
                      onCreate?.(normalizedQuery);
                      setOpen(false);
                    }}
                    className="w-full text-right px-4 py-3 text-sm text-blue-600 border-t border-line hover:bg-surface-muted transition-colors"
                  >
                    {createLabel ?? `إضافة جديد: "${query.trim()}"`}
                  </button>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
