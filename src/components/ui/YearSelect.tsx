import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, Calendar } from "lucide-react";

export function YearSelect({
  value,
  onChange,
  placeholder = "اختر السنة...",
  className = "",
  disabled = false,
  startYear = 1970,
  endYear = new Date().getFullYear() + 1,
}: {
  value: string | number | undefined | null;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
  disabled?: boolean;
  startYear?: number;
  endYear?: number;
}) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const selectedRef = useRef<HTMLButtonElement>(null);

  const years = useMemo(() => {
    const list: number[] = [];
    for (let y = endYear; y >= startYear; y--) {
      list.push(y);
    }
    return list;
  }, [startYear, endYear]);

  const selectedString = value !== undefined && value !== null ? String(value) : "";
  const displayLabel = selectedString ? selectedString : placeholder;

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  useEffect(() => {
    if (open && selectedRef.current) {
      selectedRef.current.scrollIntoView({ block: "nearest" });
    }
  }, [open]);

  function select(yVal: string) {
    onChange(yVal);
    setOpen(false);
  }

  return (
    <div ref={containerRef} className={`relative ${className}`}>
      {/* Trigger Button */}
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        disabled={disabled}
        className="flex items-center justify-between w-full h-9 px-3 rounded-lg border border-line bg-surface text-sm text-ink cursor-pointer hover:border-brand-400 disabled:bg-surface-muted disabled:text-ink-faint disabled:cursor-not-allowed transition-colors focus-ring relative"
      >
        <div className="flex items-center gap-2 truncate">
          <Calendar className="w-4 h-4 text-ink-faint shrink-0" />
          <span className={`truncate ${selectedString ? "font-semibold text-sm text-ink font-mono tracking-wide" : "text-sm text-ink-faint"}`}>
            {displayLabel}
          </span>
        </div>
        <ChevronDown
          className={`w-4 h-4 text-ink-faint shrink-0 transition-transform ${
            open ? "rotate-180" : ""
          }`}
        />
      </button>

      {/* Dropdown Menu - Shorter & Styled */}
      {open && (
        <div className="absolute z-50 mt-1.5 w-full rounded-xl border border-line bg-surface shadow-2xl overflow-hidden py-1 max-h-48 overflow-y-auto">
          {/* Default / Clear option */}
          <button
            type="button"
            onClick={() => select("")}
            className={`w-full text-right px-4 py-2 text-xs hover:bg-surface-muted transition-colors ${
              selectedString === "" ? "text-brand-400 font-bold bg-surface-muted/50" : "text-ink-muted"
            }`}
          >
            {placeholder}
          </button>

          {years.map((y) => {
            const yStr = String(y);
            const isSelected = selectedString === yStr;
            return (
              <button
                key={y}
                ref={isSelected ? selectedRef : null}
                type="button"
                onClick={() => select(yStr)}
                className={`w-full px-4 py-2 text-sm font-semibold transition-colors flex items-center justify-between ${
                  isSelected
                    ? "bg-brand-500/15 text-brand-400 font-bold"
                    : "text-ink hover:bg-surface-muted"
                }`}
              >
                <span className="font-mono text-sm tracking-wide font-semibold">{y}</span>
                {isSelected && (
                  <span className="text-[10px] bg-brand-500/20 px-1.5 py-0.5 rounded text-brand-300 font-semibold">
                    محدد
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
