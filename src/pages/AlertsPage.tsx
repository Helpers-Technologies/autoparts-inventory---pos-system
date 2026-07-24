import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  AlertTriangle,
  CalendarClock,
  CalendarX,
  Users,
  Factory,
  ArrowLeft,
  Bell,
  Receipt,
  Coins,
  Settings2,
  GripVertical,
  Eye,
  EyeOff,
  Search,
  Plus,
  Info,
  PackageX,
  Sparkles,
} from "lucide-react";
import { PageHeader } from "../components/layout/AppLayout";
import { Card, CardBody, CardHeader } from "../components/ui/Card";
import { Badge } from "../components/ui/Badge";
import { Button } from "../components/ui/Button";
import { Input } from "../components/ui/Input";
import { EmptyState } from "../components/ui/EmptyState";
import { Dialog } from "../components/ui/Dialog";
import { useCatalog } from "../store/CatalogContext";
import { useInvoicing } from "../store/InvoicingContext";
import { useReporting } from "../store/ReportingContext";
import { useSettings } from "../store/SettingsContext";
import { formatCurrency, formatDate } from "../lib/format";
import { daysUntil, isExpired, isExpiringSoon } from "../lib/utils";
import { useFeatures } from "../lib/useFeatures";
import type { Product } from "../types";

const CREDIT_KEYS = new Set<CardKey>([
  "accountDue",
  "customerCredit",
  "unpaidCustomers",
  "supplierCredit",
  "supplierInvoices",
]);

const CARD_DEFS = [
  { key: "outOfStock",       label: "منتهى المخزون",                icon: "🔴" },
  { key: "lowStock",         label: "اقتراب انتهاء الكمية",         icon: "🟡" },
  { key: "expiringSoon",     label: "اقتراب انتهاء الصلاحية",       icon: "🟠" },
  { key: "expired",          label: "منتهية الصلاحية",              icon: "🔴" },
  { key: "accountDue",       label: "فواتير آجل متأخرة (آجل)",      icon: "🔴" },
  { key: "customerCredit",   label: "عملاء برصيد دائن (آجل)",       icon: "🟢" },
  { key: "unpaidCustomers",  label: "عملاء عليهم فلوس (آجل)",       icon: "🟣" },
  { key: "supplierCredit",   label: "موردين برصيد دائن (آجل)",      icon: "🟢" },
  { key: "supplierInvoices", label: "فواتير موردين غير مسددة (آجل)", icon: "🔵" },
] as const;

type CardKey = (typeof CARD_DEFS)[number]["key"];

function loadVisible(key: string): Set<CardKey> {
  try {
    let saved = localStorage.getItem(key);
    if (!saved) saved = localStorage.getItem("alerts-visible-cards");
    if (saved) return new Set(JSON.parse(saved) as CardKey[]);
  } catch {
    /* corrupt/missing localStorage — fall through to defaults */
  }
  return new Set(CARD_DEFS.map((c) => c.key).filter((k) => !CREDIT_KEYS.has(k)));
}

function loadOrder(key: string): CardKey[] {
  try {
    let saved = localStorage.getItem(key);
    if (!saved) saved = localStorage.getItem("alerts-cards-order");
    if (saved) {
      const parsed = JSON.parse(saved) as CardKey[];
      const allKeys = CARD_DEFS.map((c) => c.key);
      const valid = parsed.filter((k) => allKeys.includes(k));
      const missing = allKeys.filter((k) => !valid.includes(k));
      return [...valid, ...missing];
    }
  } catch {
    /* corrupt/missing localStorage — fall through to defaults */
  }
  return CARD_DEFS.map((c) => c.key);
}

function saveOrder(key: string, order: CardKey[]) {
  localStorage.setItem(key, JSON.stringify(order));
}

export function AlertsPage() {
  const { products, customers, suppliers } = useCatalog();
  const { purchaseInvoices, salesInvoices } = useInvoicing();
  const { customerBalance, customerCredit, supplierBalance } = useReporting();
  const { settings } = useSettings();
  const navigate = useNavigate();

  const [statsVisible, setStatsVisible] = useState<Set<CardKey>>(() => loadVisible("alerts-stats-visible"));
  const [statsOrder, setStatsOrder] = useState<CardKey[]>(() => loadOrder("alerts-stats-order"));

  const [widgetsVisible, setWidgetsVisible] = useState<Set<CardKey>>(() => loadVisible("alerts-widgets-visible"));
  const [widgetsOrder, setWidgetsOrder] = useState<CardKey[]>(() => loadOrder("alerts-widgets-order"));

  const [settingsOpen, setSettingsOpen] = useState(false);
  const [tab, setTab] = useState<"stats" | "widgets">("stats");

  const [searchQuery, setSearchQuery] = useState("");
  const [filterType, setFilterType] = useState<"all" | "outOfStock" | "lowStock" | "expiringSoon" | "expired">("all");

  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [overIdx, setOverIdx] = useState<number | null>(null);

  const orderedStatsDefs = useMemo(() => statsOrder.map((k) => CARD_DEFS.find((c) => c.key === k)!).filter(Boolean), [statsOrder]);
  const orderedWidgetsDefs = useMemo(() => widgetsOrder.map((k) => CARD_DEFS.find((c) => c.key === k)!).filter(Boolean), [widgetsOrder]);

  function moveCard(from: number, to: number) {
    if (from === to) return;
    if (tab === "stats") {
      const next = [...statsOrder];
      const fromKey = orderedStatsDefs[from].key;
      const toKey = orderedStatsDefs[to].key;
      next.splice(next.indexOf(fromKey), 1);
      next.splice(next.indexOf(toKey), 0, fromKey);
      setStatsOrder(next);
      saveOrder("alerts-stats-order", next);
    } else {
      const next = [...widgetsOrder];
      const fromKey = orderedWidgetsDefs[from].key;
      const toKey = orderedWidgetsDefs[to].key;
      next.splice(next.indexOf(fromKey), 1);
      next.splice(next.indexOf(toKey), 0, fromKey);
      setWidgetsOrder(next);
      saveOrder("alerts-widgets-order", next);
    }
  }

  function handleDrop(toIdx: number) {
    if (dragIdx !== null && dragIdx !== toIdx) moveCard(dragIdx, toIdx);
    setDragIdx(null);
    setOverIdx(null);
  }

  function toggle(key: CardKey) {
    if (tab === "stats") {
      setStatsVisible((prev) => {
        const next = new Set(prev);
        if (next.has(key)) next.delete(key); else next.add(key);
        localStorage.setItem("alerts-stats-visible", JSON.stringify([...next]));
        return next;
      });
    } else {
      setWidgetsVisible((prev) => {
        const next = new Set(prev);
        if (next.has(key)) next.delete(key); else next.add(key);
        localStorage.setItem("alerts-widgets-visible", JSON.stringify([...next]));
        return next;
      });
    }
  }

  const { isEnabled } = useFeatures();
  const creditEnabled = isEnabled("creditSales");

  useEffect(() => {
    if (!localStorage.getItem("alerts-credit-clean-v3")) {
      localStorage.setItem("alerts-credit-clean-v3", "true");
      setStatsVisible((prev) => {
        const next = new Set(prev);
        CREDIT_KEYS.forEach((k) => next.delete(k));
        localStorage.setItem("alerts-stats-visible", JSON.stringify([...next]));
        return next;
      });
      setWidgetsVisible((prev) => {
        const next = new Set(prev);
        CREDIT_KEYS.forEach((k) => next.delete(k));
        localStorage.setItem("alerts-widgets-visible", JSON.stringify([...next]));
        return next;
      });
    }
  }, []);

  const showStat = (key: CardKey) => {
    if (CREDIT_KEYS.has(key) && !creditEnabled) return false;
    return statsVisible.has(key);
  };
  const showWidget = (key: CardKey) => {
    if (CREDIT_KEYS.has(key) && !creditEnabled) return false;
    if (filterType !== "all" && key !== filterType) return false;
    return widgetsVisible.has(key);
  };

  // ── Data ──
  const outOfStock = useMemo(() => products.filter((p) => p.quantity === 0), [products]);
  const lowStockOnly = useMemo(() => products.filter((p) => p.quantity > 0 && p.quantity <= p.minStock), [products]);
  const expiryAlertDays = settings.expiryAlertDays ?? 14;
  const expiringSoon = useMemo(() => products.filter((p) => isExpiringSoon(p, expiryAlertDays)), [products, expiryAlertDays]);
  const expired = useMemo(() => products.filter((p) => isExpired(p)), [products]);

  const matchesSearch = (p: Product) => {
    if (!searchQuery.trim()) return true;
    const term = searchQuery.toLowerCase().trim();
    return (
      p.name.toLowerCase().includes(term) ||
      (p.partNumber && p.partNumber.toLowerCase().includes(term)) ||
      (p.oemNumbers && p.oemNumbers.some((o) => o.toLowerCase().includes(term))) ||
      (p.barcode && p.barcode.toLowerCase().includes(term)) ||
      (p.partBrand && p.partBrand.toLowerCase().includes(term)) ||
      (p.rackLocation && p.rackLocation.toLowerCase().includes(term))
    );
  };

  const filteredOutOfStock = useMemo(() => outOfStock.filter(matchesSearch), [outOfStock, searchQuery]);
  const filteredLowStockOnly = useMemo(() => lowStockOnly.filter(matchesSearch), [lowStockOnly, searchQuery]);
  const filteredExpiringSoon = useMemo(() => expiringSoon.filter(matchesSearch), [expiringSoon, searchQuery]);
  const filteredExpired = useMemo(() => expired.filter(matchesSearch), [expired, searchQuery]);

  const unpaidCustomers = useMemo(() => {
    return customers
      .map((c) => {
        const grossRemaining = salesInvoices
          .filter((s) => s.customerId === c.id && !s.cancelled && s.remaining > 0)
          .reduce((a, s) => a + s.remaining, 0);
        const credit = Math.max(0, -customerBalance(c.id));
        return { c, bal: grossRemaining, credit };
      })
      .filter((x) => x.bal > 0)
      .sort((a, b) => b.bal - a.bal);
  }, [customers, salesInvoices, customerBalance]);

  const customersWithCredit = useMemo(() => {
    return customers
      .map((c) => ({ c, credit: customerCredit(c.id) }))
      .filter((x) => x.credit > 0)
      .sort((a, b) => b.credit - a.credit);
  }, [customers, customerCredit]);

  const suppliersWithCredit = useMemo(() => {
    return suppliers
      .map((s) => ({ s, credit: Math.max(0, -supplierBalance(s.id)) }))
      .filter((x) => x.credit > 0)
      .sort((a, b) => b.credit - a.credit);
  }, [suppliers, supplierBalance]);

  const accountDueInvoices = useMemo(() => {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    return salesInvoices
      .filter((inv) => inv.paymentType === "account" && inv.remaining > 0 && !inv.cancelled && inv.paymentDueDate)
      .flatMap((inv) => {
        const due = new Date(inv.paymentDueDate!);
        if (Number.isNaN(due.getTime())) return [];
        due.setHours(0, 0, 0, 0);
        const diffDays = Math.ceil((due.getTime() - today.getTime()) / 86400000);
        return [{ inv, diffDays }];
      })
      .filter(({ diffDays }) => diffDays <= 3)
      .sort((a, b) => a.diffDays - b.diffDays);
  }, [salesInvoices]);

  const overdueAccountCount = accountDueInvoices.filter(({ diffDays }) => diffDays < 0).length;
  const overdueDays = settings.paymentTermDays ?? 7;

  const overdueSupplierInvoices = useMemo(() => {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - overdueDays);
    cutoff.setHours(0, 0, 0, 0);
    return purchaseInvoices
      .filter((p) => {
        if (p.remaining <= 0) return false;
        const d = new Date(p.date);
        return !Number.isNaN(d.getTime()) && d < cutoff;
      })
      .sort((a, b) => a.date.localeCompare(b.date));
  }, [purchaseInvoices, overdueDays]);

  const totalAlertCount = outOfStock.length + lowStockOnly.length + expiringSoon.length + expired.length;

  return (
    <>
      <PageHeader
        title="التنبيهات والمتابعة"
        description="مركز الرقابة على حالة القطع والمخزون والتنبيهات التشغيلية"
        actions={
          <div className="flex items-center gap-2">
            <Link to="/purchases/new">
              <Button variant="primary" size="sm" className="flex items-center gap-1.5">
                <Plus className="w-4 h-4" />
                فاتورة توريد جديدة
              </Button>
            </Link>
            <Button variant="outline" size="sm" onClick={() => setSettingsOpen(true)} className="flex items-center gap-1.5">
              <Settings2 className="w-4 h-4" />
              تخصيص الكروت
            </Button>
          </div>
        }
      />

      {/* Banner overview */}
      <div className="bg-gradient-to-r from-slate-900 via-slate-800 to-slate-900 dark:from-slate-950 dark:via-slate-900 dark:to-slate-950 text-white rounded-2xl p-5 border border-slate-700/60 shadow-xl mb-6 flex flex-col md:flex-row justify-between items-start md:items-center gap-4 relative overflow-hidden">
        <div className="absolute -left-10 -bottom-10 w-40 h-40 bg-brand-500/10 rounded-full blur-3xl pointer-events-none" />
        <div className="space-y-1 z-10">
          <div className="flex items-center gap-2 text-brand-400 font-medium text-xs">
            <Sparkles className="w-4 h-4" />
            <span>نظام التنبيهات الذكي للمخزون</span>
          </div>
          <h2 className="text-xl font-bold text-slate-100">
            {totalAlertCount === 0 ? "المخزون في حالة ممتازة ومستقرة! 🎉" : `يوجد ${totalAlertCount} تنبيهات تتطلب متابعتك اليوم`}
          </h2>
          <p className="text-xs text-slate-300">
            إجمالي المنتجات المضافة: <strong className="text-white">{products.length}</strong> • المنتجات النفدة: <strong className="text-red-400">{outOfStock.length}</strong> • قريبة النفاد: <strong className="text-amber-400">{lowStockOnly.length}</strong>
          </p>
        </div>
        <div className="flex items-center gap-2 z-10">
          <Link to="/inventory">
            <Button variant="outline" size="sm" className="bg-slate-800/80 border-slate-700 text-slate-200 hover:bg-slate-700">
              جدول المخزون
              <ArrowLeft className="w-4 h-4 ms-1" />
            </Button>
          </Link>
        </div>
      </div>

      {/* Stats KPI grid */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
        {orderedStatsDefs.map((card) => {
          if (!showStat(card.key)) return null;
          const statMap: Record<CardKey, React.ReactNode> = {
            outOfStock: (
              <StatCard
                key="outOfStock"
                icon={<PackageX className="w-5 h-5 text-red-600 dark:text-red-400" />}
                label="منتهى المخزون"
                value={outOfStock.length}
                subtitle="كمية صفر - تحتاج توريد"
                tone="red"
                active={filterType === "outOfStock"}
                onClick={() => setFilterType((prev) => (prev === "outOfStock" ? "all" : "outOfStock"))}
              />
            ),
            lowStock: (
              <StatCard
                key="lowStock"
                icon={<AlertTriangle className="w-5 h-5 text-amber-600 dark:text-amber-400" />}
                label="اقتراب انتهاء الكمية"
                value={lowStockOnly.length}
                subtitle="وصلت للحد الأدنى"
                tone="amber"
                active={filterType === "lowStock"}
                onClick={() => setFilterType((prev) => (prev === "lowStock" ? "all" : "lowStock"))}
              />
            ),
            expiringSoon: (
              <StatCard
                key="expiringSoon"
                icon={<CalendarClock className="w-5 h-5 text-rose-600 dark:text-rose-400" />}
                label="قريب انتهاء الصلاحية"
                value={expiringSoon.length}
                subtitle={`خلال ${expiryAlertDays} يوم`}
                tone="rose"
                active={filterType === "expiringSoon"}
                onClick={() => setFilterType((prev) => (prev === "expiringSoon" ? "all" : "expiringSoon"))}
              />
            ),
            expired: (
              <StatCard
                key="expired"
                icon={<CalendarX className="w-5 h-5 text-red-600 dark:text-red-400" />}
                label="منتهي الصلاحية"
                value={expired.length}
                subtitle="تجاوزت تاريخ الصلاحية"
                tone="red"
                active={filterType === "expired"}
                onClick={() => setFilterType((prev) => (prev === "expired" ? "all" : "expired"))}
              />
            ),
            accountDue:       <Stat key="accountDue"       icon={<Receipt className="w-4 h-4" />}       label="فواتير آجل متأخرة"               value={overdueAccountCount}            tone="red"    />,
            supplierInvoices: <Stat key="supplierInvoices" icon={<Factory className="w-4 h-4" />}       label={`موردين متأخرون +${overdueDays}د`} value={overdueSupplierInvoices.length} tone="red"  />,
            unpaidCustomers:  <Stat key="unpaidCustomers"  icon={<Users className="w-4 h-4" />}         label="عملاء مديونون"                   value={unpaidCustomers.length}         tone="indigo" />,
            customerCredit:   <Stat key="customerCredit"   icon={<Coins className="w-4 h-4" />}         label="رصيد دائن للعملاء"               value={customersWithCredit.length}     tone="blue"   />,
            supplierCredit:   <Stat key="supplierCredit"   icon={<Factory className="w-4 h-4" />}       label="موردين برصيد دائن"               value={suppliersWithCredit.length}     tone="green"  />,
          };
          return statMap[card.key];
        })}
      </div>

      {/* Filter and Search Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 mb-5 bg-surface p-3.5 rounded-xl border border-line shadow-sm">
        <div className="relative flex-1 min-w-[240px]">
          <Search className="w-4 h-4 absolute top-1/2 -translate-y-1/2 start-3 text-ink-faint" />
          <Input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="ابحث باسم القطعة، رقم القطعة، OEM، أو الرف..."
            className="ps-9 pe-9"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery("")}
              className="absolute top-1/2 -translate-y-1/2 end-3 text-xs text-ink-faint hover:text-ink"
            >
              مسح
            </button>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-1.5 text-xs font-medium">
          <button
            onClick={() => setFilterType("all")}
            className={`px-3 py-1.5 rounded-lg border transition-colors ${filterType === "all" ? "bg-brand-500 text-white border-brand-500 font-semibold" : "bg-surface-muted border-line text-ink-muted hover:text-ink"}`}
          >
            عرض الكل ({totalAlertCount})
          </button>
          <button
            onClick={() => setFilterType("outOfStock")}
            className={`px-3 py-1.5 rounded-lg border transition-colors ${filterType === "outOfStock" ? "bg-red-500 text-white border-red-500 font-semibold" : "bg-surface-muted border-line text-ink-muted hover:text-ink"}`}
          >
            المنتهية ({outOfStock.length})
          </button>
          <button
            onClick={() => setFilterType("lowStock")}
            className={`px-3 py-1.5 rounded-lg border transition-colors ${filterType === "lowStock" ? "bg-amber-500 text-white border-amber-500 font-semibold" : "bg-surface-muted border-line text-ink-muted hover:text-ink"}`}
          >
            المنخفضة ({lowStockOnly.length})
          </button>
          <button
            onClick={() => setFilterType("expiringSoon")}
            className={`px-3 py-1.5 rounded-lg border transition-colors ${filterType === "expiringSoon" ? "bg-rose-500 text-white border-rose-500 font-semibold" : "bg-surface-muted border-line text-ink-muted hover:text-ink"}`}
          >
            قريبة الصلاحية ({expiringSoon.length})
          </button>
        </div>
      </div>

      {/* Detail cards — ordered */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {orderedWidgetsDefs.map((card) => {
          if (!showWidget(card.key)) return null;
          switch (card.key) {
            case "outOfStock": return (
              <Card key="outOfStock" className="border-red-200/80 dark:border-red-500/20 shadow-sm">
                <CardHeader
                  title="منتهى المخزون"
                  subtitle={`المنتجات التي وصلت إلى كمية صفر (${filteredOutOfStock.length})`}
                  actions={
                    <Link to="/inventory" className="text-xs text-brand-600 dark:text-brand-400 hover:underline flex items-center gap-1 font-medium">
                      <span>عرض بالمخزون</span>
                      <ArrowLeft className="w-3.5 h-3.5" />
                    </Link>
                  }
                />
                <CardBody className="divide-y divide-line p-0">
                  {filteredOutOfStock.length === 0 ? (
                    <EmptyState icon={<Bell className="w-5 h-5" />} title="لا توجد منتجات نفدت" description="كل المنتجات متوفر منها كميات في المخزن." />
                  ) : (
                    filteredOutOfStock.slice(0, 10).map((p) => (
                      <div key={p.id} className="flex items-center justify-between gap-3 p-3.5 hover:bg-surface-muted/50 transition-colors">
                        <div className="flex items-center gap-3 min-w-0 flex-1">
                          <div className="w-9 h-9 rounded-lg bg-red-50 dark:bg-red-500/10 text-red-600 dark:text-red-400 grid place-items-center shrink-0 border border-red-200 dark:border-red-500/20">
                            <AlertTriangle className="w-4 h-4" />
                          </div>
                          <div className="min-w-0 flex-1">
                            <button
                              onClick={() => navigate(`/products/${p.id}`)}
                              className="text-sm font-semibold text-ink hover:text-brand-600 dark:hover:text-brand-400 truncate text-start block max-w-full"
                            >
                              {p.name}
                            </button>
                            <div className="flex flex-wrap items-center gap-2 text-xs text-ink-muted mt-0.5">
                              {p.partNumber && <span className="font-mono bg-surface-muted px-1.5 py-0.5 rounded border border-line">P/N: {p.partNumber}</span>}
                              {p.oemNumbers && p.oemNumbers.length > 0 && <span className="font-mono text-ink-faint">OEM: {p.oemNumbers.join(", ")}</span>}
                              {p.rackLocation && <span className="text-brand-600 dark:text-brand-400 font-medium">رف: {p.rackLocation}</span>}
                            </div>
                          </div>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <Badge tone="red">نفد المخزون</Badge>
                          <Link to="/purchases/new">
                            <Button variant="outline" size="sm" className="h-8 text-xs">
                              توريد
                            </Button>
                          </Link>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => navigate(`/products/${p.id}`)}
                            className="h-8 w-8 p-0"
                            title="التفاصيل"
                          >
                            <Info className="w-4 h-4 text-ink-muted" />
                          </Button>
                        </div>
                      </div>
                    ))
                  )}
                </CardBody>
              </Card>
            );

            case "lowStock": return (
              <Card key="lowStock" className="border-amber-200/80 dark:border-amber-500/20 shadow-sm">
                <CardHeader
                  title="اقتراب انتهاء الكمية"
                  subtitle={`المنتجات التي وصلت إلى الحد الأدنى للمخزون أو أقل (${filteredLowStockOnly.length})`}
                  actions={
                    <Link to="/inventory" className="text-xs text-brand-600 dark:text-brand-400 hover:underline flex items-center gap-1 font-medium">
                      <span>عرض بالمخزون</span>
                      <ArrowLeft className="w-3.5 h-3.5" />
                    </Link>
                  }
                />
                <CardBody className="divide-y divide-line p-0">
                  {filteredLowStockOnly.length === 0 ? (
                    <EmptyState icon={<Bell className="w-5 h-5" />} title="لا يوجد كميات منخفضة" description="جميع المنتجات فوق الحد الأدنى المطلوب." />
                  ) : (
                    filteredLowStockOnly.slice(0, 10).map((p) => (
                      <div key={p.id} className="flex items-center justify-between gap-3 p-3.5 hover:bg-surface-muted/50 transition-colors">
                        <div className="flex items-center gap-3 min-w-0 flex-1">
                          <div className="w-9 h-9 rounded-lg bg-amber-50 dark:bg-amber-500/10 text-amber-600 dark:text-amber-400 grid place-items-center shrink-0 border border-amber-200 dark:border-amber-500/20">
                            <AlertTriangle className="w-4 h-4" />
                          </div>
                          <div className="min-w-0 flex-1">
                            <button
                              onClick={() => navigate(`/products/${p.id}`)}
                              className="text-sm font-semibold text-ink hover:text-brand-600 dark:hover:text-brand-400 truncate text-start block max-w-full"
                            >
                              {p.name}
                            </button>
                            <div className="flex flex-wrap items-center gap-2 text-xs text-ink-muted mt-0.5">
                              <span>المتبقي: <strong className="text-amber-600 dark:text-amber-400">{p.quantity} {p.unit}</strong></span>
                              <span>الحد الأدنى: {p.minStock}</span>
                              {p.rackLocation && <span className="text-brand-600 dark:text-brand-400 font-medium">رف: {p.rackLocation}</span>}
                            </div>
                          </div>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <Badge tone="amber">منخفض ({p.quantity})</Badge>
                          <Link to="/purchases/new">
                            <Button variant="outline" size="sm" className="h-8 text-xs">
                              توريد
                            </Button>
                          </Link>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => navigate(`/products/${p.id}`)}
                            className="h-8 w-8 p-0"
                            title="التفاصيل"
                          >
                            <Info className="w-4 h-4 text-ink-muted" />
                          </Button>
                        </div>
                      </div>
                    ))
                  )}
                </CardBody>
              </Card>
            );

            case "expiringSoon": return (
              <Card key="expiringSoon" className="border-rose-200/80 dark:border-rose-500/20 shadow-sm">
                <CardHeader
                  title={`اقتراب انتهاء الصلاحية (${expiryAlertDays} يوم)`}
                  subtitle={`المنتجات التي تنتهي صلاحيتها قريباً (${filteredExpiringSoon.length})`}
                />
                <CardBody className="divide-y divide-line p-0">
                  {filteredExpiringSoon.length === 0 ? (
                    <EmptyState icon={<CalendarClock className="w-5 h-5" />} title="لا توجد منتجات قريبة الانتهاء" description="لا توجد قطع تنتهي صلاحيتها خلال الأيام القادمة." />
                  ) : (
                    filteredExpiringSoon.slice(0, 10).map((p) => (
                      <div key={p.id} className="flex items-center justify-between gap-3 p-3.5 hover:bg-surface-muted/50 transition-colors">
                        <div className="flex items-center gap-3 min-w-0 flex-1">
                          <div className="w-9 h-9 rounded-lg bg-rose-50 dark:bg-rose-500/10 text-rose-600 dark:text-rose-400 grid place-items-center shrink-0 border border-rose-200 dark:border-rose-500/20">
                            <CalendarClock className="w-4 h-4" />
                          </div>
                          <div className="min-w-0 flex-1">
                            <button
                              onClick={() => navigate(`/products/${p.id}`)}
                              className="text-sm font-semibold text-ink hover:text-brand-600 dark:hover:text-brand-400 truncate text-start block max-w-full"
                            >
                              {p.name}
                            </button>
                            <div className="flex flex-wrap items-center gap-2 text-xs text-ink-muted mt-0.5">
                              <span>تاريخ الانتهاء: <strong>{formatDate(p.expiryDate!)}</strong></span>
                            </div>
                          </div>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <Badge tone="rose">يتبقى {daysUntil(p.expiryDate)} يوم</Badge>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => navigate(`/products/${p.id}`)}
                            className="h-8 w-8 p-0"
                            title="التفاصيل"
                          >
                            <Info className="w-4 h-4 text-ink-muted" />
                          </Button>
                        </div>
                      </div>
                    ))
                  )}
                </CardBody>
              </Card>
            );

            case "expired": return (
              <Card key="expired" className="border-red-300 dark:border-red-500/30 shadow-sm">
                <CardHeader
                  title="منتهية الصلاحية"
                  subtitle={`المنتجات التي تجاوزت تاريخ الصلاحية (${filteredExpired.length})`}
                />
                <CardBody className="divide-y divide-line p-0">
                  {filteredExpired.length === 0 ? (
                    <EmptyState icon={<CalendarX className="w-5 h-5" />} title="لا يوجد منتهي الصلاحية" description="جميع المنتجات ذات صلاحية سارية." />
                  ) : (
                    filteredExpired.slice(0, 10).map((p) => (
                      <div key={p.id} className="flex items-center justify-between gap-3 p-3.5 hover:bg-surface-muted/50 transition-colors">
                        <div className="flex items-center gap-3 min-w-0 flex-1">
                          <div className="w-9 h-9 rounded-lg bg-red-100 text-red-700 dark:text-red-400 dark:bg-red-500/15 grid place-items-center shrink-0 border border-red-300 dark:border-red-500/30">
                            <CalendarX className="w-4 h-4" />
                          </div>
                          <div className="min-w-0 flex-1">
                            <button
                              onClick={() => navigate(`/products/${p.id}`)}
                              className="text-sm font-semibold text-ink hover:text-brand-600 dark:hover:text-brand-400 truncate text-start block max-w-full"
                            >
                              {p.name}
                            </button>
                            <div className="flex flex-wrap items-center gap-2 text-xs text-ink-muted mt-0.5">
                              <span>انتهى بتاريخ: <strong className="text-red-600 dark:text-red-400">{formatDate(p.expiryDate!)}</strong></span>
                            </div>
                          </div>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <Badge tone="red">منتهي منذ {Math.abs(daysUntil(p.expiryDate) ?? 0)} يوم</Badge>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => navigate(`/products/${p.id}`)}
                            className="h-8 w-8 p-0"
                            title="التفاصيل"
                          >
                            <Info className="w-4 h-4 text-ink-muted" />
                          </Button>
                        </div>
                      </div>
                    ))
                  )}
                </CardBody>
              </Card>
            );

            case "accountDue": return (
              <Card key="accountDue">
                <CardHeader title="فواتير آجل متأخرة أو قريبة الاستحقاق" subtitle={`عدد: ${accountDueInvoices.length}`} />
                <CardBody className="divide-y divide-line p-0">
                  {accountDueInvoices.length === 0 ? <EmptyState icon={<Receipt className="w-5 h-5" />} title="لا توجد فواتير آجل قريبة الاستحقاق" />
                  : accountDueInvoices.slice(0, 8).map(({ inv, diffDays }) => (
                    <div key={inv.id} className="flex items-center gap-3 p-3">
                      <div className="w-9 h-9 rounded-lg bg-red-50 dark:bg-red-500/10 text-red-600 dark:text-red-400 grid place-items-center"><Receipt className="w-4 h-4" /></div>
                      <div className="flex-1 min-w-0"><div className="text-sm font-medium text-ink truncate">{inv.customerName} — {inv.invoiceNumber}</div><div className="text-xs text-ink-muted">تاريخ الاستحقاق: {formatDate(inv.paymentDueDate!)} • المتبقي: {formatCurrency(inv.remaining, settings.currency)}</div></div>
                      <Badge tone={diffDays < 0 ? "red" : diffDays === 0 ? "orange" : "amber"}>{diffDays < 0 ? "متأخر" : diffDays === 0 ? "اليوم" : `خلال ${diffDays} أيام`}</Badge>
                      <Link to={`/sales/${inv.id}`}><Button variant="outline" size="sm">عرض</Button></Link>
                    </div>
                  ))}
                </CardBody>
              </Card>
            );

            case "customerCredit": return (
              <Card key="customerCredit">
                <CardHeader title="عملاء برصيد دائن (دفعوا زيادة)" subtitle={`عدد: ${customersWithCredit.length}`} actions={customersWithCredit.length > 0 ? <Link to="/sales/new" className="text-xs text-brand-700 hover:underline">فاتورة جديدة</Link> : undefined} />
                <CardBody className="divide-y divide-line p-0">
                  {customersWithCredit.length === 0 ? <EmptyState icon={<Coins className="w-5 h-5" />} title="لا يوجد رصيد دائن" description="لا أحد دفع زيادة حتى الآن." />
                  : customersWithCredit.slice(0, 8).map(({ c, credit }) => (
                    <div key={c.id} className="flex items-center gap-3 p-3">
                      <div className="w-9 h-9 rounded-lg bg-emerald-50 dark:bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 grid place-items-center"><Coins className="w-4 h-4" /></div>
                      <div className="flex-1 min-w-0"><div className="text-sm font-medium text-ink truncate">{c.name}</div><div className="text-xs text-ink-muted">{c.phone ?? "—"}</div></div>
                      <Badge tone="green">رصيد {formatCurrency(credit, settings.currency)}</Badge>
                      <Link to="/sales/new"><Button variant="outline" size="sm">استخدام <ArrowLeft className="w-3.5 h-3.5" /></Button></Link>
                    </div>
                  ))}
                </CardBody>
              </Card>
            );

            case "unpaidCustomers": return (
              <Card key="unpaidCustomers">
                <CardHeader title="عملاء عليهم فلوس" subtitle={`عدد: ${unpaidCustomers.length}`} />
                <CardBody className="divide-y divide-line p-0">
                  {unpaidCustomers.length === 0 ? <EmptyState icon={<Users className="w-5 h-5" />} title="لا توجد أرصدة متبقية" />
                  : unpaidCustomers.slice(0, 8).map(({ c, bal, credit }) => (
                    <div key={c.id} className="flex items-center gap-3 p-3">
                      <div className="w-9 h-9 rounded-lg bg-indigo-50 dark:bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 grid place-items-center"><Users className="w-4 h-4" /></div>
                      <div className="flex-1 min-w-0"><div className="text-sm font-medium text-ink truncate">{c.name}</div><div className="text-xs text-ink-muted">{c.phone ?? "—"}</div></div>
                      {credit > 0 && <Badge tone="green">رصيد {formatCurrency(credit, settings.currency)}</Badge>}
                      <Badge tone="amber">{formatCurrency(bal, settings.currency)}</Badge>
                      <Link to="/customers"><Button variant="outline" size="sm">عرض <ArrowLeft className="w-3.5 h-3.5" /></Button></Link>
                    </div>
                  ))}
                </CardBody>
              </Card>
            );

            case "supplierCredit": return (
              <Card key="supplierCredit">
                <CardHeader title="موردين برصيد دائن (دفعنا زيادة)" subtitle={`عدد: ${suppliersWithCredit.length}`} actions={suppliersWithCredit.length > 0 ? <Link to="/purchases/new" className="text-xs text-brand-700 hover:underline">فاتورة جديدة</Link> : undefined} />
                <CardBody className="divide-y divide-line p-0">
                  {suppliersWithCredit.length === 0 ? <EmptyState icon={<Coins className="w-5 h-5" />} title="لا يوجد رصيد دائن" description="لا يوجد موردين دفعنا لهم زيادة." />
                  : suppliersWithCredit.slice(0, 8).map(({ s, credit }) => (
                    <div key={s.id} className="flex items-center gap-3 p-3">
                      <div className="w-9 h-9 rounded-lg bg-emerald-50 dark:bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 grid place-items-center"><Factory className="w-4 h-4" /></div>
                      <div className="flex-1 min-w-0"><div className="text-sm font-medium text-ink truncate">{s.name}</div><div className="text-xs text-ink-muted">{s.phone ?? "—"}</div></div>
                      <Badge tone="green">رصيد {formatCurrency(credit, settings.currency)}</Badge>
                      <Link to="/purchases/new"><Button variant="outline" size="sm">استخدام <ArrowLeft className="w-3.5 h-3.5" /></Button></Link>
                    </div>
                  ))}
                </CardBody>
              </Card>
            );

            case "supplierInvoices": return (
              <Card key="supplierInvoices" className="lg:col-span-2">
                <CardHeader title="فواتير موردين غير مسددة" subtitle={overdueSupplierInvoices.length > 0 ? `${overdueSupplierInvoices.length} متأخرة أكثر من ${overdueDays} يوم` : undefined} />
                <CardBody className="divide-y divide-line p-0">
                  {purchaseInvoices.filter((p) => p.remaining > 0).length === 0 ? <EmptyState icon={<Factory className="w-5 h-5" />} title="لا توجد فواتير متأخرة" />
                  : purchaseInvoices.filter((p) => p.remaining > 0).sort((a, b) => a.date.localeCompare(b.date)).slice(0, 10).map((p) => {
                    const isOverdue = overdueSupplierInvoices.some((o) => o.id === p.id);
                    return (
                      <div key={p.id} className={`flex items-center gap-3 p-3 ${isOverdue ? "bg-red-50/40 dark:bg-red-500/10" : ""}`}>
                        <div className={`w-9 h-9 rounded-lg grid place-items-center ${isOverdue ? "bg-red-100 text-red-600 dark:text-red-400 dark:bg-red-500/15" : "bg-blue-50 dark:bg-blue-500/10 text-blue-600 dark:text-blue-400"}`}><Factory className="w-4 h-4" /></div>
                        <div className="flex-1 min-w-0"><div className="text-sm font-medium text-ink truncate">{p.invoiceNumber} — {p.supplierName}</div><div className="text-xs text-ink-muted">{formatDate(p.date)}</div></div>
                        {isOverdue && <Badge tone="red">متأخرة</Badge>}
                        <Badge tone="amber">متبقي {formatCurrency(p.remaining, settings.currency)}</Badge>
                        <Link to={`/purchases/${p.id}`}><Button variant="outline" size="sm">عرض</Button></Link>
                      </div>
                    );
                  })}
                </CardBody>
              </Card>
            );

            default: return null;
          }
        })}
      </div>

      {/* Settings dialog */}
      <Dialog
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        title="تخصيص صفحة التنبيهات"
        subtitle="اختر الكروت التي تريد إظهارها ورتّبها حسب أولويتك"
      >
        <div className="flex gap-1 mb-4 bg-surface-muted rounded-lg p-1">
          <button
            onClick={() => setTab("stats")}
            className={`flex-1 py-1.5 text-sm font-medium rounded-md transition-colors ${tab === "stats" ? "bg-surface shadow-sm text-ink" : "text-ink-muted hover:text-ink"}`}
          >
            الكروت العلوية
          </button>
          <button
            onClick={() => setTab("widgets")}
            className={`flex-1 py-1.5 text-sm font-medium rounded-md transition-colors ${tab === "widgets" ? "bg-surface shadow-sm text-ink" : "text-ink-muted hover:text-ink"}`}
          >
            ويدجات التفاصيل
          </button>
        </div>

        <div className="space-y-1.5 py-2 max-h-[60vh] overflow-y-auto">
          <p className="text-xs text-ink-faint mb-2">اسحب الكرت لتغيير ترتيبه</p>
          {(tab === "stats" ? orderedStatsDefs : orderedWidgetsDefs)
            .filter((card) => creditEnabled || !CREDIT_KEYS.has(card.key))
            .map((card, idx) => (
            <div
              key={card.key}
              draggable
              onDragStart={() => setDragIdx(idx)}
              onDragOver={(e) => { e.preventDefault(); setOverIdx(idx); }}
              onDrop={() => handleDrop(idx)}
              onDragEnd={() => { setDragIdx(null); setOverIdx(null); }}
              className={`flex items-center gap-2 p-2.5 rounded-lg border transition-all cursor-grab active:cursor-grabbing ${
                overIdx === idx && dragIdx !== idx
                  ? "border-brand-400 bg-brand-50 dark:bg-brand-500/15"
                  : dragIdx === idx
                  ? "opacity-40 border-dashed border-line"
                  : "border-line bg-surface hover:border-line-soft"
              }`}
            >
              <GripVertical className="w-4 h-4 text-ink-muted shrink-0" />
              <span className="flex-1 text-sm text-ink-muted">{card.label}</span>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => toggle(card.key)}
                  className={`p-1.5 rounded-lg transition-colors ${
                    (tab === "stats" ? statsVisible : widgetsVisible).has(card.key) ? "bg-brand-50 text-brand-700 hover:bg-brand-100 dark:bg-brand-500/15 dark:text-brand-300" : "bg-surface-muted text-ink-faint hover:bg-line"
                  }`}
                >
                  {(tab === "stats" ? statsVisible : widgetsVisible).has(card.key) ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}
                </button>
              </div>
            </div>
          ))}
        </div>
        <div className="flex justify-between pt-3 border-t border-line">
          <Button variant="ghost" size="sm" onClick={() => {
            const all = new Set(CARD_DEFS.map((c) => c.key));
            const defaultOrder = CARD_DEFS.map((c) => c.key);
            if (tab === "stats") {
              setStatsVisible(all);
              localStorage.setItem("alerts-stats-visible", JSON.stringify([...all]));
              setStatsOrder(defaultOrder);
              saveOrder("alerts-stats-order", defaultOrder);
            } else {
              setWidgetsVisible(all);
              localStorage.setItem("alerts-widgets-visible", JSON.stringify([...all]));
              setWidgetsOrder(defaultOrder);
              saveOrder("alerts-widgets-order", defaultOrder);
            }
          }}>إظهار الكل</Button>
          <Button size="sm" onClick={() => setSettingsOpen(false)}>تم</Button>
        </div>
      </Dialog>
    </>
  );
}

function StatCard({
  icon,
  label,
  value,
  subtitle,
  tone,
  active,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  subtitle: string;
  tone: "amber" | "rose" | "red";
  active?: boolean;
  onClick?: () => void;
}) {
  const tones: Record<string, string> = {
    amber: "border-amber-200 dark:border-amber-500/30 hover:border-amber-400",
    rose:  "border-rose-200 dark:border-rose-500/30 hover:border-rose-400",
    red:   "border-red-200 dark:border-red-500/30 hover:border-red-400",
  };

  return (
    <div
      onClick={onClick}
      className={`bg-surface border rounded-xl p-3.5 flex flex-col justify-between cursor-pointer transition-all hover:shadow-md ${tones[tone]} ${active ? "ring-2 ring-brand-400 border-brand-400 shadow-md" : ""}`}
    >
      <div className="flex items-center justify-between gap-2 mb-2">
        <span className="text-xs font-semibold text-ink-muted truncate">{label}</span>
        <div className="w-8 h-8 rounded-lg bg-surface-muted flex items-center justify-center shrink-0">
          {icon}
        </div>
      </div>
      <div>
        <div className="text-2xl font-bold text-ink">{value}</div>
        <div className="text-[11px] text-ink-muted truncate mt-0.5">{subtitle}</div>
      </div>
    </div>
  );
}

function Stat({
  icon,
  label,
  value,
  tone,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  tone: "amber" | "rose" | "red" | "indigo" | "blue" | "green";
}) {
  const colors: Record<string, string> = {
    amber: "bg-amber-50 dark:bg-amber-500/10 text-amber-700 dark:text-amber-400",
    rose:  "bg-rose-50 dark:bg-rose-500/10 text-rose-700 dark:text-rose-400",
    red:   "bg-red-50 dark:bg-red-500/10 text-red-700 dark:text-red-400",
    indigo:"bg-indigo-50 dark:bg-indigo-500/10 text-indigo-700 dark:text-indigo-300",
    blue:  "bg-blue-50 dark:bg-blue-500/10 text-blue-700 dark:text-blue-400",
    green: "bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  };
  return (
    <div className="bg-surface border border-line rounded-xl p-3 flex items-center gap-3">
      <div className={`w-9 h-9 rounded-lg grid place-items-center ${colors[tone]}`}>{icon}</div>
      <div>
        <div className="text-xs text-ink-muted">{label}</div>
        <div className="text-xl font-semibold">{value}</div>
      </div>
    </div>
  );
}
