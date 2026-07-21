import { useEffect, useRef, useState } from "react";
import { ChevronDown, Search } from "lucide-react";

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
  minChars = 3,
  className = "",
  onCreate,
  createLabel,
  disabled = false,
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
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
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
      ? options.filter((o) => {
          const text = `${o.label} ${o.value} ${o.searchText ?? ""}`.toLowerCase();
          return text.includes(query.toLowerCase());
        })
      : options;
  const canCreate = onCreate && normalizedQuery.length > 0 && !exactMatch;

  useEffect(() => {
    if (open) {
      setQuery("");
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open]);

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
        className="flex items-center justify-center gap-2 w-full h-9 px-3 rounded-lg border border-line bg-surface text-sm text-ink cursor-pointer hover:border-brand-400 disabled:bg-surface-muted disabled:text-ink-faint disabled:cursor-not-allowed transition-colors focus-ring relative"
      >
        <div className="flex items-center gap-2 justify-center truncate w-full px-4">
          {selectedOption?.image && (
            <img src={selectedOption.image} alt="" className="w-5 h-5 object-contain shrink-0" onError={(e) => { e.currentTarget.style.display = 'none'; }} />
          )}
          <span className="truncate text-center">{selectedLabel}</span>
        </div>
        <ChevronDown className={`w-4 h-4 text-ink-faint absolute left-3 top-1/2 -translate-y-1/2 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {/* Dropdown */}
      {open && (
        <div className="absolute z-50 mt-2 w-full min-w-[220px] rounded-xl border border-line bg-white shadow-xl overflow-hidden">
          {/* Search input */}
          <div className="flex items-center gap-2 px-3 py-3 border-b border-line">
            <Search className="w-4 h-4 text-ink-faint shrink-0" />
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={query.length < minChars ? `اكتب ${minChars} أحرف للبحث...` : searchPlaceholder}
              className="flex-1 rounded-2xl border border-line bg-surface px-3 py-2 text-sm text-ink placeholder:text-ink-faint outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-100"
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
                      className={`w-full text-right px-4 py-3 text-sm hover:bg-surface-muted transition-colors flex items-center gap-2 ${value === o.value ? "text-brand-400 font-semibold" : "text-ink"}`}
                    >
                      {o.image && (
                        <img src={o.image} alt="" className="w-5 h-5 object-contain shrink-0" onError={(e) => { e.currentTarget.style.display = 'none'; }} />
                      )}
                      <span className="truncate">{o.label}</span>
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
