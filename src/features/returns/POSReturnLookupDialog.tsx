import { useMemo, useState } from "react";
import { RotateCcw, Search, FileText } from "lucide-react";
import { Dialog } from "../../components/ui/Dialog";
import { Input } from "../../components/ui/Input";
import { Badge } from "../../components/ui/Badge";
import { useInvoicing } from "../../store/InvoicingContext";
import { useSettings } from "../../store/SettingsContext";
import { formatCurrency, formatDate } from "../../lib/format";
import type { SalesInvoice } from "../../types";

const MAX_RESULTS = 50;

export function POSReturnLookupDialog({
  open,
  onClose,
  onSelectInvoice,
}: {
  open: boolean;
  onClose: () => void;
  onSelectInvoice: (invoice: SalesInvoice) => void;
}) {
  const { salesInvoices, salesReturns } = useInvoicing();
  const { settings } = useSettings();
  const [query, setQuery] = useState("");

  // Only show non-cancelled invoices, sorted newest first
  const eligibleInvoices = useMemo(() => {
    return salesInvoices
      .filter((inv) => !inv.cancelled)
      .slice(0, MAX_RESULTS);
  }, [salesInvoices]);

  // Check if an invoice still has returnable items
  const returnableTotal = (inv: SalesInvoice) => {
    const previousReturnsTotal = salesReturns
      .filter((r) => r.originalInvoiceId === inv.id)
      .reduce((sum, r) => sum + r.total, 0);
    return Math.max(0, inv.total - previousReturnsTotal);
  };

  const filtered = useMemo(() => {
    if (!query.trim()) return eligibleInvoices;
    const q = query.trim().toLowerCase();
    return eligibleInvoices.filter(
      (inv) =>
        inv.invoiceNumber.toLowerCase().includes(q) ||
        inv.customerName.toLowerCase().includes(q)
    );
  }, [eligibleInvoices, query]);

  function handleSelect(inv: SalesInvoice) {
    setQuery("");
    onSelectInvoice(inv);
  }

  return (
    <Dialog
      open={open}
      onClose={() => {
        setQuery("");
        onClose();
      }}
      title="مرتجع مبيعات سريع"
      subtitle="ابحث عن فاتورة لإنشاء مرتجع مباشرة"
      width="lg"
    >
      <div className="space-y-4">
        {/* Search box */}
        <div className="relative">
          <Search className="absolute right-3 top-2.5 w-4 h-4 text-ink-faint" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="ابحث برقم الفاتورة أو اسم العميل..."
            className="pr-10"
            autoFocus
          />
        </div>

        {/* Results list */}
        <div className="max-h-[400px] overflow-y-auto space-y-1.5 scrollbar-thin">
          {filtered.length === 0 ? (
            <div className="py-10 text-center text-ink-faint text-sm">
              <FileText className="w-10 h-10 mx-auto mb-2 stroke-[1.2]" />
              {query.trim()
                ? "لا توجد فواتير مطابقة للبحث"
                : "لا توجد فواتير مبيعات"}
            </div>
          ) : (
            filtered.map((inv) => {
              const remaining = returnableTotal(inv);
              const fullyReturned = remaining <= 0;
              return (
                <button
                  key={inv.id}
                  type="button"
                  disabled={fullyReturned}
                  onClick={() => handleSelect(inv)}
                  className={`w-full text-right flex items-center justify-between gap-3 rounded-xl border p-3.5 transition-all ${
                    fullyReturned
                      ? "opacity-50 cursor-not-allowed border-line bg-surface-muted/30"
                      : "border-line hover:border-brand-500 hover:shadow-md cursor-pointer bg-surface"
                  }`}
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2 mb-1">
                      <span className="font-mono text-xs font-bold text-brand-700 dark:text-brand-300">
                        {inv.invoiceNumber}
                      </span>
                      <Badge
                        tone={
                          inv.status === "paid"
                            ? "green"
                            : inv.status === "partial"
                            ? "amber"
                            : "red"
                        }
                        className="text-[10px]"
                      >
                        {inv.status === "paid"
                          ? "مسددة"
                          : inv.status === "partial"
                          ? "جزئي"
                          : "غير مسددة"}
                      </Badge>
                      {fullyReturned && (
                        <Badge tone="slate" className="text-[10px]">
                          مرتجعة بالكامل
                        </Badge>
                      )}
                    </div>
                    <div className="font-semibold text-sm text-ink truncate">
                      {inv.customerName}
                    </div>
                    <div className="flex flex-wrap items-center gap-2 mt-1 text-xs text-ink-muted">
                      <span>{formatDate(inv.date)}</span>
                      <span className="text-line">·</span>
                      <span>
                        {inv.lines.length} صنف
                      </span>
                      <span className="text-line">·</span>
                      <span className="font-semibold">
                        {formatCurrency(inv.total, settings.currency)}
                      </span>
                    </div>
                  </div>
                  {!fullyReturned && (
                    <div className="shrink-0 flex items-center gap-1.5 text-xs font-bold text-brand-600 dark:text-brand-400">
                      <RotateCcw className="w-4 h-4" />
                      مرتجع
                    </div>
                  )}
                </button>
              );
            })
          )}
        </div>
      </div>
    </Dialog>
  );
}
