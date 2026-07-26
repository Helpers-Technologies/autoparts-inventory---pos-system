import { useEffect, useRef, useState, useMemo, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { Search, PackageSearch, Users, Truck, FileText, ShoppingCart, ClipboardList, X } from "lucide-react";
import { useCatalog } from "../store/CatalogContext";
import { useInvoicing } from "../store/InvoicingContext";
import { useAuth } from "../store/AuthContext";
import { hasPermission } from "../lib/permissions";
import { useFeatures } from "../lib/useFeatures";
import { NoResultsHint } from "./ui/EmptyState";
import {
  globalSearch,
  KIND_LABELS,
  type SearchResult,
  type SearchResultKind,
} from "../lib/globalSearch";

const KIND_ICONS: Record<SearchResultKind, typeof Search> = {
  product: PackageSearch,
  customer: Users,
  supplier: Truck,
  salesInvoice: FileText,
  purchaseInvoice: ShoppingCart,
  quotation: ClipboardList,
};

function optionalText(source: object, key: string): string | undefined {
  const value = (source as Record<string, unknown>)[key];
  return typeof value === "string" && value.trim() ? value : undefined;
}

function invoicePartTerms(
  lines: readonly { productName: string; partNumber?: string; partBrand?: string }[]
): string[] {
  return Array.from(new Set(lines.flatMap((line) => [
    line.productName,
    line.partNumber,
    line.partBrand,
  ].filter((value): value is string => Boolean(value)))));
}

const KIND_COLOR: Record<SearchResultKind, string> = {
  product: "text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-500/10",
  customer: "text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-500/10",
  supplier: "text-violet-600 dark:text-violet-400 bg-violet-50 dark:bg-violet-500/10",
  salesInvoice: "text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-500/10",
  purchaseInvoice: "text-orange-600 dark:text-orange-400 bg-orange-50 dark:bg-orange-500/10",
  quotation: "text-sky-600 dark:text-sky-400 bg-sky-50 dark:bg-sky-500/10",
};

export function GlobalSearch({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [activeIdx, setActiveIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();

  const { products, customers, suppliers } = useCatalog();
  const { salesInvoices, purchaseInvoices, quotations } = useInvoicing();
  const { currentUser } = useAuth();
  const { isEnabled } = useFeatures();
  const barcodeEnabled = isEnabled("barcodeSystem");

  const permissions = useMemo(() => ({
    products: hasPermission(currentUser, "products"),
    customers: hasPermission(currentUser, "customers"),
    suppliers: hasPermission(currentUser, "suppliers"),
    salesInvoices: hasPermission(currentUser, "salesInvoices"),
    purchaseInvoices: hasPermission(currentUser, "purchaseInvoices"),
    quotations: hasPermission(currentUser, "salesInvoices") && isEnabled("quotations"),
  }), [currentUser, isEnabled]);

  const catalog = useMemo(() => ({
    products: products.filter((p) => !p.archived).map((p) => ({
      id: p.id,
      name: p.name,
      code: p.code,
      barcode: barcodeEnabled ? p.barcode : undefined,
      partNumber: p.partNumber,
      oemNumbers: p.oemNumbers,
      partBrand: p.partBrand,
    })),
    customers: customers.filter((c) => !c.archived).map((c) => ({
      id: c.id, name: c.name, code: c.code, phone: c.phone,
    })),
    suppliers: suppliers.filter((s) => !s.archived).map((s) => ({
      id: s.id, name: s.name, code: s.code, phone: s.phone,
    })),
    salesInvoices: salesInvoices.map((inv) => ({
      id: inv.id, invoiceNumber: inv.invoiceNumber, customerName: inv.customerName,
      vehicleLabel: optionalText(inv, "vehicleLabel"),
      branchName: optionalText(inv, "branchName"),
      partTerms: invoicePartTerms(inv.lines),
    })),
    purchaseInvoices: purchaseInvoices.map((inv) => ({
      id: inv.id, invoiceNumber: inv.invoiceNumber, supplierName: inv.supplierName,
      branchName: optionalText(inv, "branchName"),
      partTerms: invoicePartTerms(inv.lines),
    })),
    quotations: (quotations ?? []).map((q) => ({
      id: q.id, quotationNumber: q.quotationNumber, customerName: q.customerName,
      vehicleLabel: optionalText(q, "vehicleLabel"),
      branchName: optionalText(q, "branchName"),
      partTerms: invoicePartTerms(q.lines),
    })),
  }), [products, customers, suppliers, salesInvoices, purchaseInvoices, quotations, barcodeEnabled]);

  const results = useMemo(
    () => globalSearch(query, catalog, permissions),
    [query, catalog, permissions]
  );

  // Reset state when opened
  useEffect(() => {
    if (open) {
      setQuery("");
      setActiveIdx(0);
      setTimeout(() => inputRef.current?.focus(), 30);
    }
  }, [open]);

  // Keep active index in bounds when results change
  useEffect(() => {
    setActiveIdx(0);
  }, [results.length]);

  const navigate_ = useCallback(
    (result: SearchResult) => {
      navigate(result.to, result.initialSearch ? { state: { initialSearch: result.initialSearch } } : undefined);
      onClose();
    },
    [navigate, onClose]
  );

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (query) setQuery("");
        else onClose();
        e.preventDefault();
      }
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setActiveIdx((i) => Math.min(i + 1, results.length - 1));
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setActiveIdx((i) => Math.max(i - 1, 0));
      }
      if (e.key === "Enter" && results[activeIdx]) {
        e.preventDefault();
        navigate_(results[activeIdx]);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, query, results, activeIdx, navigate_, onClose]);

  // Scroll active item into view
  useEffect(() => {
    if (!listRef.current) return;
    const el = listRef.current.querySelector(`[data-idx="${activeIdx}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }, [activeIdx]);

  if (!open) return null;

  // Group results by kind for display, preserving flat index for keyboard nav
  const kindOrder: SearchResultKind[] = ["product", "customer", "supplier", "salesInvoice", "purchaseInvoice", "quotation"];
  const groups = kindOrder.reduce<{ kind: SearchResultKind; items: (SearchResult & { flatIdx: number })[] }[]>(
    (acc, kind) => {
      const items = results
        .map((r, i) => ({ ...r, flatIdx: i }))
        .filter((r) => r.kind === kind);
      if (items.length > 0) acc.push({ kind, items });
      return acc;
    },
    []
  );

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-[10vh] px-4" dir="rtl">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-slate-900/50 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Panel */}
      <div className="relative w-full max-w-xl bg-surface rounded-2xl shadow-2xl border border-line overflow-hidden flex flex-col max-h-[70vh]">
        {/* Search input row */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-line-soft">
          <Search className="w-5 h-5 text-ink-faint shrink-0" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="رقم القطعة، OEM، باركود، سيارة، عميل أو فاتورة..."
            className="flex-1 text-base bg-transparent outline-none text-ink placeholder:text-ink-faint"
            autoComplete="off"
          />
          {query && (
            <button
              onClick={() => setQuery("")}
              className="text-ink-faint hover:text-ink-muted transition-colors"
              aria-label="مسح البحث"
            >
              <X className="w-4 h-4" />
            </button>
          )}
          <kbd className="hidden sm:inline-flex items-center gap-0.5 rounded border border-line bg-surface-muted px-1.5 py-0.5 text-[11px] text-ink-faint font-mono">
            Esc
          </kbd>
        </div>

        {/* Results */}
        <div ref={listRef} className="overflow-y-auto">
          {query.length >= 2 && results.length === 0 ? (
            <NoResultsHint message={`لا توجد نتائج لـ "${query}"`} className="py-10" />
          ) : query.length < 2 ? (
            <div className="py-8 text-center text-sm text-ink-faint">
              اكتب حرفين على الأقل — ويمكنك مسح رقم القطعة أو الباركود مباشرة
            </div>
          ) : (
            groups.map(({ kind, items }) => {
              const Icon = KIND_ICONS[kind];
              const colorCls = KIND_COLOR[kind];
              return (
                <div key={kind}>
                  <div className="px-4 py-1.5 text-[11px] font-semibold text-ink-faint uppercase tracking-wide bg-surface-muted border-b border-line-soft">
                    {KIND_LABELS[kind]}
                  </div>
                  {items.map((result) => {
                    const isActive = result.flatIdx === activeIdx;
                    return (
                      <button
                        key={result.id + result.kind}
                        data-idx={result.flatIdx}
                        onClick={() => navigate_(result)}
                        onMouseEnter={() => setActiveIdx(result.flatIdx)}
                        className={`w-full text-right flex items-center gap-3 px-4 py-2.5 border-b border-line-soft last:border-0 transition-colors ${
                          isActive ? "bg-brand-50 dark:bg-brand-500/15" : "hover:bg-surface-muted"
                        }`}
                      >
                        <span className={`w-8 h-8 rounded-lg grid place-items-center shrink-0 ${colorCls}`}>
                          <Icon className="w-4 h-4" />
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="text-sm font-medium text-ink truncate">{result.title}</div>
                          {result.subtitle && (
                            <div className="text-xs text-ink-faint truncate">{result.subtitle}</div>
                          )}
                        </div>
                        {isActive && (
                          <kbd className="hidden sm:inline-flex shrink-0 items-center rounded border border-line bg-surface px-1.5 py-0.5 text-[10px] text-ink-faint font-mono">
                            ↵
                          </kbd>
                        )}
                      </button>
                    );
                  })}
                </div>
              );
            })
          )}
        </div>

        {/* Footer hint */}
        {results.length > 0 && (
          <div className="px-4 py-2 border-t border-line-soft bg-surface-muted flex items-center gap-4 text-[11px] text-ink-faint">
            <span><kbd className="font-mono">↑↓</kbd> للتنقل</span>
            <span><kbd className="font-mono">↵</kbd> للفتح</span>
            <span><kbd className="font-mono">Esc</kbd> للإغلاق</span>
          </div>
        )}
      </div>
    </div>
  );
}
