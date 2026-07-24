import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  Package, Warehouse, AlertTriangle, TrendingUp,
  Wallet, HandCoins, Receipt, Plus, ShoppingBag, Users, Clock,
  Settings2, Eye, EyeOff, GripVertical, RotateCcw, Building2, BarChart2,
  CircleDollarSign, CarFront, PackageSearch, ShieldCheck, GitBranch, Link2,
} from "lucide-react";
import {
  AreaChart, Area, BarChart, Bar, XAxis, YAxis, Tooltip,
  ResponsiveContainer, CartesianGrid,
} from "recharts";
import { AutoPartsHero } from "../components/AutoPartsHero";
import { Card, CardBody, CardHeader } from "../components/ui/Card";
import { Badge } from "../components/ui/Badge";
import { Button } from "../components/ui/Button";
import { Dialog } from "../components/ui/Dialog";
import { useCatalog } from "../store/CatalogContext";
import { useInvoicing } from "../store/InvoicingContext";
import { useReporting } from "../store/ReportingContext";
import { useAuth } from "../store/AuthContext";
import { useSettings } from "../store/SettingsContext";
import { formatCurrency, formatDate, formatNumber } from "../lib/format";
import { hasPermission } from "../lib/permissions";
import { isToday, localISODate } from "../lib/utils";
import { lsGet, lsSet } from "../lib/storage";
import { useVehicleCatalog } from "../store/VehicleCatalogContext";
import { useAutoPartsPro } from "../store/AutoPartsProContext";
import { useFeatures } from "../lib/useFeatures";

/* ─── Types ─── */
type CardId =
  | "totalProducts" | "totalStock" | "lowStock" | "expiringSoon"
  | "todaySales" | "todayPurchases" | "monthlySales" | "monthlyPurchases"
  | "receivables" | "payables" | "cashBalance" | "accountInvoices"
  | "overdueCount" | "totalCustomers" | "totalSuppliers" | "netProfitToday"
  | "posShift";

type SectionId =
  | "trendChart" | "stockChart" | "topSellingChart"
  | "recentActivity" | "lowStockPanel" | "overduePanel" | "quickActions";

interface CardConfig { id: CardId; visible: boolean }
type SectionsConfig = Record<SectionId, boolean>;

/* ─── Defaults ─── */
const DEFAULT_CARDS: CardConfig[] = [
  { id: "posShift",         visible: true },
  { id: "totalProducts",    visible: true },
  { id: "totalStock",       visible: true },
  { id: "lowStock",         visible: true },
  { id: "expiringSoon",     visible: true },
  { id: "todaySales",       visible: true },
  { id: "monthlySales",     visible: true },
  { id: "netProfitToday",   visible: true },
  { id: "cashBalance",      visible: true },
  { id: "receivables",      visible: true },
  { id: "payables",         visible: true },
  { id: "accountInvoices",  visible: true },
  { id: "overdueCount",     visible: true },
  { id: "todayPurchases",   visible: true },
  { id: "monthlyPurchases", visible: true },
  { id: "totalCustomers",   visible: true },
  { id: "totalSuppliers",   visible: true },
];

const DEFAULT_SECTIONS: SectionsConfig = {
  trendChart: true, stockChart: true, topSellingChart: true,
  recentActivity: true, lowStockPanel: true, overduePanel: true, quickActions: true,
};

const CARD_LABELS: Record<CardId, string> = {
  posShift:         "وردية الكاشير النشطة",
  totalProducts:    "أرقام قطع نشطة",
  totalStock:       "رصيد موزع على الفروع",
  lowStock:         "قطع تحتاج إعادة طلب",
  expiringSoon:     "قطع بدون توافق سيارة",
  todaySales:       "مبيعات قطع اليوم",
  todayPurchases:   "مطالبات ضمان مفتوحة",
  monthlySales:     "صافي مبيعات القطع",
  monthlyPurchases: "قيمة مخزون راكد +90 يوم",
  receivables:      "مستحقات من العملاء",
  payables:         "مستحقات الموردين",
  cashBalance:      "رصيد الخزينة",
  accountInvoices:  "فواتير آجل مفتوحة",
  overdueCount:     "فواتير متأخرة",
  totalCustomers:   "سيارات العملاء المسجلة",
  totalSuppliers:   "الفروع النشطة",
  netProfitToday:   "مجمل ربح القطع الشهري",
};

const SECTION_LABELS: Record<SectionId, string> = {
  trendChart:      "رسم المبيعات والمشتريات",
  stockChart:      "رأس المال في القطع الراكدة",
  topSellingChart: "أكثر قطع الغيار مبيعاً",
  recentActivity:  "حركة بيع وتوريد القطع",
  lowStockPanel:   "أولوية إعادة طلب القطع",
  overduePanel:    "فواتير متأخرة عن الاستحقاق",
  quickActions:    "إجراءات سريعة",
};

/* ─── Config hook ─── */
function useDashboardConfig() {
  const [cards, setCards] = useState<CardConfig[]>(() => {
    const saved = lsGet<CardConfig[] | null>("dashboardCards", null);
    if (!saved) return DEFAULT_CARDS;
    const savedIds = new Set(saved.map((c) => c.id));
    const merged = [...saved];
    DEFAULT_CARDS.forEach((c) => { if (!savedIds.has(c.id)) merged.push(c); });
    return merged;
  });

  const [sections, setSections] = useState<SectionsConfig>(() =>
    lsGet<SectionsConfig>("dashboardSections", DEFAULT_SECTIONS)
  );

  function saveCards(next: CardConfig[]) { setCards(next); lsSet("dashboardCards", next); }
  function saveSections(next: SectionsConfig) { setSections(next); lsSet("dashboardSections", next); }

  function toggleCard(id: CardId) {
    saveCards(cards.map((c) => (c.id === id ? { ...c, visible: !c.visible } : c)));
  }
  function toggleSection(id: SectionId) {
    saveSections({ ...sections, [id]: !sections[id] });
  }
  function moveCard(from: number, to: number) {
    const next = [...cards];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    saveCards(next);
  }
  function reset() { saveCards(DEFAULT_CARDS); saveSections(DEFAULT_SECTIONS); }

  return { cards, sections, toggleCard, toggleSection, moveCard, reset };
}

/* ─── StatCard ─── */
function StatCard({
  title, value, icon, tone, delta,
}: {
  title: string; value: string;
  icon: React.ReactNode;
  tone: "blue" | "green" | "amber" | "red" | "slate" | "indigo" | "rose" | "violet";
  delta?: string;
}) {
  const toneMap: Record<string, string> = {
    blue:   "bg-blue-50 dark:bg-blue-500/10 text-blue-700 dark:text-blue-400 dark:bg-blue-500/15 dark:text-blue-300",
    green:  "bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 dark:bg-emerald-500/15 dark:text-emerald-300",
    amber:  "bg-amber-50 dark:bg-amber-500/10 text-amber-700 dark:text-amber-400 dark:bg-amber-500/15 dark:text-amber-300",
    red:    "bg-red-50 dark:bg-red-500/10 text-red-700 dark:text-red-400 dark:bg-red-500/15 dark:text-red-300",
    slate:  "bg-surface-muted text-ink-muted",
    indigo: "bg-indigo-50 dark:bg-indigo-500/10 text-indigo-700 dark:bg-indigo-500/15 dark:text-indigo-300",
    rose:   "bg-rose-50 dark:bg-rose-500/10 text-rose-700 dark:text-rose-400 dark:bg-rose-500/15 dark:text-rose-300",
    violet: "bg-violet-50 text-violet-700 dark:bg-violet-500/15 dark:text-violet-300",
  };
  return (
    <Card>
      <CardBody className="flex items-start gap-3">
        <div className={`w-10 h-10 rounded-lg grid place-items-center shrink-0 ${toneMap[tone]}`}>
          {icon}
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-[11px] font-bold uppercase tracking-wider text-ink-faint">{title}</div>
          <div className="text-xl font-bold text-ink mt-1 tabular-nums leading-tight">{value}</div>
          {delta ? (
            <div className="text-[10px] text-ink-muted mt-1 font-medium bg-surface-muted inline-block px-1.5 py-0.5 rounded-md border border-line">
              {delta}
            </div>
          ) : null}
        </div>
      </CardBody>
    </Card>
  );
}

/* ─── Customize Dialog ─── */
function CustomizeDialog({
  open, onClose, cards, sections, cardAllowed, sectionAllowed, onToggleCard, onToggleSection, onMove, onReset,
}: {
  open: boolean; onClose: () => void;
  cards: CardConfig[]; sections: SectionsConfig;
  cardAllowed: Record<CardId, boolean>;
  sectionAllowed: Record<SectionId, boolean>;
  onToggleCard: (id: CardId) => void;
  onToggleSection: (id: SectionId) => void;
  onMove: (from: number, to: number) => void;
  onReset: () => void;
}) {
  const [tab, setTab] = useState<"cards" | "sections">("cards");
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [overIdx, setOverIdx] = useState<number | null>(null);

  const allowedCards = cards.filter((c) => cardAllowed[c.id]);
  const allowedSections = (Object.keys(DEFAULT_SECTIONS) as SectionId[]).filter((id) => sectionAllowed[id]);

  function handleDrop(toIdx: number) {
    if (dragIdx !== null && dragIdx !== toIdx) onMove(dragIdx, toIdx);
    setDragIdx(null);
    setOverIdx(null);
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="تخصيص لوحة التحكم"
      subtitle="اختر الكروت التي تريد إظهارها ورتّبها حسب أولويتك"
      width="md"
      footer={
        <div className="flex items-center justify-between w-full">
          <Button variant="ghost" onClick={onReset} className="text-ink-muted gap-1.5">
            <RotateCcw className="w-3.5 h-3.5" /> إعادة الضبط الافتراضي
          </Button>
          <Button onClick={onClose}>حفظ</Button>
        </div>
      }
    >
      {/* Tabs */}
      <div className="flex gap-1 mb-4 bg-surface-muted rounded-lg p-1">
        {(["cards", "sections"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`flex-1 py-1.5 text-sm font-medium rounded-md transition-colors ${
              tab === t ? "bg-surface shadow-sm text-ink" : "text-ink-muted hover:text-ink"
            }`}
          >
            {t === "cards" ? "الكروت الإحصائية" : "الأقسام والرسوم"}
          </button>
        ))}
      </div>

      {tab === "cards" && (
        <div className="space-y-1.5 py-2 max-h-[60vh] overflow-y-auto">
          <p className="text-xs text-ink-faint mb-2">اسحب الكرت لتغيير ترتيبه</p>
          {allowedCards.map((c, idx) => (
            <div
              key={c.id}
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
              <span className="flex-1 text-sm text-ink-muted">{CARD_LABELS[c.id]}</span>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => onToggleCard(c.id)}
                  className={`p-1.5 rounded-lg transition-colors ${
                    c.visible ? "bg-brand-50 text-brand-700 hover:bg-brand-100 dark:bg-brand-500/15 dark:text-brand-300" : "bg-surface-muted text-ink-faint hover:bg-line"
                  }`}
                >
                  {c.visible ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {tab === "sections" && (
        <div className="space-y-2">
          {allowedSections.map((id) => (
            <div key={id} className="flex items-center justify-between p-3 rounded-lg border border-line bg-surface">
              <span className="text-sm text-ink-muted">{SECTION_LABELS[id]}</span>
              <button
                onClick={() => onToggleSection(id)}
                className={`flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                  sections[id] ? "bg-brand-50 text-brand-700 hover:bg-brand-100 dark:bg-brand-500/15 dark:text-brand-300" : "bg-surface-muted text-ink-muted hover:bg-line"
                }`}
              >
                {sections[id] ? <><Eye className="w-3 h-3" /> ظاهر</> : <><EyeOff className="w-3 h-3" /> مخفي</>}
              </button>
            </div>
          ))}
        </div>
      )}
    </Dialog>
  );
}

/* ─── Main Page ─── */
export function DashboardPage() {
  const { products, customers, suppliers } = useCatalog();
  const { purchaseInvoices, salesInvoices, salesReturns, currentCashBalance, activeShift } = useInvoicing();
  const { customerBalance, supplierBalance } = useReporting();
  const { currentUser } = useAuth();
  const { settings } = useSettings();
  const vehicleCatalog = useVehicleCatalog();
  const pro = useAutoPartsPro();
  const { isEnabled } = useFeatures();
  const creditSalesEnabled = isEnabled("creditSales");
  const activeProducts = useMemo(() => products.filter((product) => !product.archived), [products]);

  const [customizeOpen, setCustomizeOpen] = useState(false);
  const { cards, sections, toggleCard, toggleSection, moveCard, reset } = useDashboardConfig();

  const canViewProducts  = hasPermission(currentUser, "products");
  const canViewInventory = hasPermission(currentUser, "inventory");
  const canViewAlerts    = hasPermission(currentUser, "alerts");
  const canViewSales     = hasPermission(currentUser, "salesInvoices");
  const canAddSales      = hasPermission(currentUser, "salesInvoices", "add");
  const canViewPurchases = hasPermission(currentUser, "purchaseInvoices");
  const canAddPurchases  = hasPermission(currentUser, "purchaseInvoices", "add");
  const canViewCustomers = hasPermission(currentUser, "customers");
  const canAddCustomer   = hasPermission(currentUser, "customers", "add");
  const canViewSuppliers = hasPermission(currentUser, "suppliers");
  const canViewReturns   = hasPermission(currentUser, "returns");
  const canViewCashbox   = hasPermission(currentUser, "cashbox");
  const canAddProduct    = hasPermission(currentUser, "products", "add");
  const canViewPOS       = hasPermission(currentUser, "pos");

  // ── Stats ──
  const stats = useMemo(() => {
    const now = new Date();
    const monthStart = localISODate(new Date(now.getFullYear(), now.getMonth(), 1));

    const activeProductIds = new Set(activeProducts.map((product) => product.id));
    const branchStockUnits = pro.branchStocks
      .filter((row) => activeProductIds.has(row.productId))
      .reduce((sum, row) => sum + row.quantity, 0);
    const totalStockUnits = pro.branchStocks.some((row) => activeProductIds.has(row.productId))
      ? branchStockUnits
      : activeProducts.reduce((sum, product) => sum + product.quantity, 0);
    const lowStock = activeProducts.filter((p) => p.quantity <= p.minStock).length;
    const fittedIds = new Set(vehicleCatalog.productFitments.map((fitment) => fitment.productId));
    const unmappedParts = activeProducts.filter((product) => !fittedIds.has(product.id)).length;
    const validSales = salesInvoices.filter((invoice) => !invoice.cancelled);
    const invoiceById = new Map(salesInvoices.map((invoice) => [invoice.id, invoice]));
    const monthlyInvoices = validSales.filter((invoice) => invoice.date >= monthStart);
    const todayGross = validSales.filter((invoice) => isToday(invoice.date)).reduce((sum, invoice) => sum + invoice.total, 0);
    const todayReturns = salesReturns.filter((item) => isToday(item.date) && !invoiceById.get(item.originalInvoiceId)?.cancelled).reduce((sum, item) => sum + item.total, 0);
    const monthlyGross = monthlyInvoices.reduce((sum, invoice) => sum + invoice.total, 0);
    const monthlyReturns = salesReturns.filter((item) => item.date >= monthStart && !invoiceById.get(item.originalInvoiceId)?.cancelled).reduce((sum, item) => sum + item.total, 0);
    const todaySales = todayGross - todayReturns;
    const monthlySales = monthlyGross - monthlyReturns;
    const productById = new Map(activeProducts.map((product) => [product.id, product]));
    let grossProfitMonth = 0;
    for (const invoice of monthlyInvoices) {
      grossProfitMonth -= invoice.discount ?? 0;
      for (const line of invoice.lines) {
        const lineProd = productById.get(line.productId);
        grossProfitMonth += line.subtotal - (line.costPrice ?? lineProd?.avgCost ?? lineProd?.purchasePrice ?? 0) * line.quantity;
      }
    }
    for (const item of salesReturns.filter((entry) => entry.date >= monthStart && !invoiceById.get(entry.originalInvoiceId)?.cancelled)) {
      const original = invoiceById.get(item.originalInvoiceId);
      for (const line of item.lines) {
        const originalLine = original?.lines.find((entry) => entry.id === line.sourceLineId) ?? original?.lines.find((entry) => entry.productId === line.productId);
        const retProd = productById.get(line.productId);
        grossProfitMonth -= line.subtotal - (originalLine?.costPrice ?? retProd?.avgCost ?? retProd?.purchasePrice ?? 0) * line.quantity;
      }
    }
    const ninetyDaysAgo = new Date();
    ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);
    const cutoff = localISODate(ninetyDaysAgo);
    const soldRecently = new Set(validSales.filter((invoice) => invoice.date >= cutoff).flatMap((invoice) => invoice.lines.map((line) => line.productId)));
    const deadStockValue = activeProducts.filter((product) => product.quantity > 0 && !soldRecently.has(product.id)).reduce((sum, product) => sum + product.quantity * (product.avgCost ?? product.purchasePrice), 0);
    const openWarrantyClaims = pro.warrantyClaims.filter((claim) => !["rejected", "replaced"].includes(claim.status)).length;

    const receivables = customers.reduce((sum, customer) => sum + Math.max(0, customerBalance(customer.id)), 0);
    const payables = suppliers.reduce((sum, supplier) => sum + Math.max(0, supplierBalance(supplier.id)), 0);

    return {
      totalProducts: activeProducts.length, totalStockUnits, lowStock, unmappedParts,
      todaySales, monthlySales, grossProfitMonth, deadStockValue, openWarrantyClaims,
      receivables, payables, cashBalance: currentCashBalance(),
      totalCustomerVehicles: pro.customerVehicles.filter((vehicle) => !vehicle.archived).length,
      activeBranches: pro.branches.filter((branch) => branch.active).length,
    };
  }, [activeProducts, salesInvoices, salesReturns, customers, suppliers, customerBalance, supplierBalance, currentCashBalance, pro.branchStocks, pro.branches, pro.customerVehicles, pro.warrantyClaims, vehicleCatalog.productFitments]);

  const { accountInvoicesTotal, accountInvoicesCount, overdueInvoices, overdueTotal } = useMemo(() => {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const accountList = salesInvoices.filter((s) => !s.cancelled && s.remaining > 0);
    const overdue = accountList
      .filter((s) => { if (!s.paymentDueDate) return false; const d = new Date(s.paymentDueDate); d.setHours(0,0,0,0); return d < today; })
      .sort((a, b) => (a.paymentDueDate! < b.paymentDueDate! ? -1 : 1));
    return {
      accountInvoicesTotal: accountList.reduce((a, s) => a + s.remaining, 0),
      accountInvoicesCount: accountList.length,
      overdueInvoices: overdue,
      overdueTotal: overdue.reduce((a, s) => a + s.remaining, 0),
    };
  }, [salesInvoices]);

  // ── Charts ──
  const chartData = useMemo(() => {
    const days: { date: string; sales: number; purchases: number }[] = [];
    const cancelledInvoiceIds = new Set(salesInvoices.filter((invoice) => invoice.cancelled).map((invoice) => invoice.id));
    for (let i = 13; i >= 0; i--) {
      const d = new Date(); d.setDate(d.getDate() - i);
      const iso = localISODate(d);
      days.push({
        date: iso.slice(5),
        sales:     canViewSales
          ? salesInvoices.filter((s) => s.date.slice(0,10) === iso && !s.cancelled).reduce((a,s) => a+s.total, 0)
            - salesReturns.filter((item) => item.date.slice(0, 10) === iso && !cancelledInvoiceIds.has(item.originalInvoiceId)).reduce((sum, item) => sum + item.total, 0)
          : 0,
        purchases: canViewPurchases ? purchaseInvoices.filter((p) => p.date.slice(0,10) === iso).reduce((a,p) => a+p.total, 0) : 0,
      });
    }
    return days;
  }, [salesInvoices, salesReturns, purchaseInvoices, canViewSales, canViewPurchases]);

  const topProductsByStock = useMemo(() => {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - 90);
    const cutoff = localISODate(cutoffDate);
    const soldRecently = new Set(salesInvoices.filter((invoice) => !invoice.cancelled && invoice.date >= cutoff).flatMap((invoice) => invoice.lines.map((line) => line.productId)));
    return activeProducts.filter((product) => product.quantity > 0 && !soldRecently.has(product.id))
      .sort((a, b) => b.quantity * (b.avgCost ?? b.purchasePrice) - a.quantity * (a.avgCost ?? a.purchasePrice))
      .slice(0, 5)
      .map((product) => ({ name: product.name, qty: product.quantity * (product.avgCost ?? product.purchasePrice) }));
  }, [activeProducts, salesInvoices]);

  const topSellingProducts = useMemo(() => {
    const map: Record<string, { name: string; revenue: number; qty: number }> = {};
    const cancelledInvoiceIds = new Set(salesInvoices.filter((invoice) => invoice.cancelled).map((invoice) => invoice.id));
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - 90);
    const cutoff = localISODate(cutoffDate);
    salesInvoices.filter((s) => !s.cancelled && s.date >= cutoff).flatMap((s) => s.lines).forEach((l) => {
      if (!map[l.productId]) map[l.productId] = { name: l.productName, revenue: 0, qty: 0 };
      map[l.productId].revenue += l.subtotal;
      map[l.productId].qty += l.quantity;
    });
    salesReturns.filter((item) => item.date >= cutoff && !cancelledInvoiceIds.has(item.originalInvoiceId)).flatMap((item) => item.lines).forEach((line) => {
      if (!map[line.productId]) map[line.productId] = { name: line.productName, revenue: 0, qty: 0 };
      map[line.productId].revenue -= line.subtotal;
      map[line.productId].qty -= line.quantity;
    });
    return Object.values(map).filter((item) => item.revenue > 0).sort((a, b) => b.revenue - a.revenue).slice(0, 5)
      .map((p) => ({ name: p.name, revenue: p.revenue }));
  }, [salesInvoices, salesReturns]);

  const lowStockList = useMemo(() =>
    activeProducts.filter((p) => p.quantity <= p.minStock).sort((a, b) => a.quantity - b.quantity).slice(0, 6),
    [activeProducts]
  );

  const recentActivity = useMemo(() => {
    const items: { id: string; title: string; sub: string; amount?: number; date: string; tone: "green"|"blue"; to?: string }[] = [];
    if (canViewSales) salesInvoices.filter((invoice) => !invoice.cancelled).slice(0, 6).forEach((s) => items.push({ id: s.id, title: `بيع قطع · ${s.invoiceNumber}`, sub: [s.customerName, s.vehicleLabel, s.branchName].filter(Boolean).join(" · "), amount: s.total, date: s.date, tone: "green", to: `/sales/${s.id}` }));
    if (canViewPurchases) purchaseInvoices.slice(0, 4).forEach((p) => items.push({ id: p.id, title: `توريد قطع · ${p.invoiceNumber}`, sub: `${p.supplierName} · ${p.lines.length} بند`, amount: p.total, date: p.date, tone: "blue", to: `/purchases/${p.id}` }));
    return items.sort((a, b) => (a.date < b.date ? 1 : -1)).slice(0, 8);
  }, [salesInvoices, purchaseInvoices, canViewSales, canViewPurchases]);

  // ── Card permission map ──
  const cardAllowed: Record<CardId, boolean> = {
    posShift:         canViewPOS,
    totalProducts:    canViewProducts,
    totalStock:       canViewInventory,
    lowStock:         canViewAlerts,
    expiringSoon:     canViewProducts,
    todaySales:       canViewSales,
    todayPurchases:   canViewSales,
    monthlySales:     canViewSales,
    monthlyPurchases: canViewInventory,
    receivables:      canViewCustomers && creditSalesEnabled,
    payables:         canViewSuppliers,
    cashBalance:      canViewCashbox,
    accountInvoices:  canViewSales && creditSalesEnabled,
    overdueCount:     canViewSales && creditSalesEnabled,
    totalCustomers:   canViewCustomers,
    totalSuppliers:   canViewInventory,
    netProfitToday:   canViewSales,
  };

  const sectionAllowed: Record<SectionId, boolean> = {
    trendChart:      canViewSales || canViewPurchases,
    stockChart:      canViewInventory,
    topSellingChart: canViewSales,
    recentActivity:  canViewSales || canViewPurchases,
    lowStockPanel:   canViewInventory || canViewAlerts,
    overduePanel:    canViewSales && creditSalesEnabled,
    quickActions:    canAddSales || canAddPurchases || canAddProduct || canAddCustomer || canViewProducts || canViewCustomers || canViewReturns || canViewInventory || canViewPOS,
  };

  function renderCard(id: CardId) {
    const cur = settings.currency;
    switch (id) {
      case "posShift":         return <StatCard key={id} title="وردية الكاشير (POS)" value={activeShift ? `#${activeShift.shiftNumber} — مفتوحة` : "الوردية مغلقة"} icon={<Clock className="w-5 h-5" />} tone={activeShift ? "green" : "amber"} delta={activeShift ? `الكاشير: ${activeShift.cashierName}` : "اضغط لفتح الوردية من POS"} />;
      case "totalProducts":    return <StatCard key={id} title="أرقام قطع نشطة" value={formatNumber(stats.totalProducts)} icon={<Package className="w-5 h-5" />} tone="blue" />;
      case "totalStock":       return <StatCard key={id} title="كمية القطع في الفروع" value={formatNumber(stats.totalStockUnits)} icon={<Warehouse className="w-5 h-5" />} tone="indigo" delta={`${stats.activeBranches} فرع نشط`} />;
      case "lowStock":         return <StatCard key={id} title="قطع تحتاج إعادة طلب" value={formatNumber(stats.lowStock)} icon={<AlertTriangle className="w-5 h-5" />} tone="amber" />;
      case "expiringSoon":     return <StatCard key={id} title="قطع بدون توافق سيارة" value={formatNumber(stats.unmappedParts)} icon={<Link2 className="w-5 h-5" />} tone={stats.unmappedParts > 0 ? "red" : "green"} />;
      case "todaySales":       return <StatCard key={id} title="صافي مبيعات قطع اليوم" value={formatCurrency(stats.todaySales, cur)} icon={<TrendingUp className="w-5 h-5" />} tone="green" />;
      case "todayPurchases":   return <StatCard key={id} title="مطالبات ضمان مفتوحة" value={formatNumber(stats.openWarrantyClaims)} icon={<ShieldCheck className="w-5 h-5" />} tone={stats.openWarrantyClaims > 0 ? "amber" : "green"} />;
      case "monthlySales":     return <StatCard key={id} title="صافي مبيعات القطع" value={formatCurrency(stats.monthlySales, cur)} icon={<BarChart2 className="w-5 h-5" />} tone="green" delta="هذا الشهر بعد المرتجعات" />;
      case "monthlyPurchases": return <StatCard key={id} title="قيمة مخزون راكد +90 يوم" value={formatCurrency(stats.deadStockValue, cur)} icon={<PackageSearch className="w-5 h-5" />} tone="slate" />;
      case "receivables":      return <StatCard key={id} title="مستحقات من العملاء" value={formatCurrency(stats.receivables, cur)} icon={<HandCoins className="w-5 h-5" />} tone="amber" />;
      case "payables":         return <StatCard key={id} title="مستحقات الموردين" value={formatCurrency(stats.payables, cur)} icon={<ShoppingBag className="w-5 h-5" />} tone="slate" />;
      case "cashBalance":      return <StatCard key={id} title="رصيد الخزينة الحالي" value={formatCurrency(stats.cashBalance, cur)} icon={<Wallet className="w-5 h-5" />} tone="green" />;
      case "accountInvoices":  return <StatCard key={id} title="فواتير آجل مفتوحة" value={formatCurrency(accountInvoicesTotal, cur)} icon={<Clock className="w-5 h-5" />} tone="indigo" delta={`${accountInvoicesCount} فاتورة`} />;
      case "overdueCount":     return <StatCard key={id} title="فواتير متأخرة" value={formatNumber(overdueInvoices.length)} icon={<AlertTriangle className="w-5 h-5" />} tone="red" delta={overdueTotal > 0 ? formatCurrency(overdueTotal, cur) : "لا يوجد تأخير"} />;
      case "totalCustomers":   return <StatCard key={id} title="سيارات العملاء المسجلة" value={formatNumber(stats.totalCustomerVehicles)} icon={<CarFront className="w-5 h-5" />} tone="violet" />;
      case "totalSuppliers":   return <StatCard key={id} title="الفروع النشطة" value={formatNumber(stats.activeBranches)} icon={<GitBranch className="w-5 h-5" />} tone="slate" />;
      case "netProfitToday":   return <StatCard key={id} title="مجمل ربح القطع الشهري" value={formatCurrency(stats.grossProfitMonth, cur)} icon={<CircleDollarSign className="w-5 h-5" />} tone={stats.grossProfitMonth >= 0 ? "green" : "rose"} delta="بعد خصم المرتجعات" />;
      default: return null;
    }
  }

  const visibleCards = cards.filter((c) => c.visible && cardAllowed[c.id]);
  const showTrend = sections.trendChart && sectionAllowed.trendChart;
  const showStock = sections.stockChart && sectionAllowed.stockChart;
  const showTopSelling = sections.topSellingChart && sectionAllowed.topSellingChart;
  const showRecent = sections.recentActivity && sectionAllowed.recentActivity;
  const showLowStock = sections.lowStockPanel && sectionAllowed.lowStockPanel;
  const showOverdue = sections.overduePanel && sectionAllowed.overduePanel && overdueInvoices.length > 0;
  const showQuickActions = sections.quickActions && sectionAllowed.quickActions;

  const trendTitle = canViewSales && canViewPurchases ? "بيع وتوريد قطع الغيار — آخر 14 يوم" : canViewSales ? "مبيعات قطع الغيار — آخر 14 يوم" : "توريد قطع الغيار — آخر 14 يوم";

  return (
    <>
      <AutoPartsHero
        icon={CarFront}
        eyebrow=""
        title={`مركز ${settings.companyNameAr}`}
        description="لوحة يومية لتشغيل محل قطع الغيار: توافق السيارات، مبيعات القطع، رصيد الفروع، الضمان وإعادة الطلب في مكان واحد."

        actions={
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={() => setCustomizeOpen(true)} className="gap-1.5">
              <Settings2 className="w-4 h-4" />
              تخصيص
            </Button>
            {canAddSales && (
              <Link to="/pos">
                <Button><Plus className="w-4 h-4" />فتح الكاشير</Button>
              </Link>
            )}
            {canAddPurchases && (
              <Link to="/purchases/new">
                <Button variant="outline"><Plus className="w-4 h-4" />فاتورة مشتريات</Button>
              </Link>
            )}
          </div>
        }
      />

      {/* ── Stat Cards ── */}
      {visibleCards.length > 0 ? (
        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-4">
          {visibleCards.map((c) => renderCard(c.id))}
        </div>
      ) : (
        <Card>
          <CardBody className="py-10 text-center text-sm text-ink-muted">
            لا توجد كروت ظاهرة. اضغط <strong>تخصيص</strong> لإظهار الكروت.
          </CardBody>
        </Card>
      )}

      {/* ── Charts row 1: Trend + Stock ── */}
      {(showTrend || showStock) && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {showTrend && (
            <Card className={showStock ? "lg:col-span-2" : "lg:col-span-3"}>
              <CardHeader title={trendTitle} subtitle={`العملة: ${settings.currency}`} />
              <CardBody>
                <div className="h-64">
                  <ResponsiveContainer>
                    <AreaChart data={chartData}>
                      <defs>
                        <linearGradient id="gS" x1="0" x2="0" y1="0" y2="1">
                          <stop offset="0%" stopColor="#10b981" stopOpacity={0.4} />
                          <stop offset="100%" stopColor="#10b981" stopOpacity={0} />
                        </linearGradient>
                        <linearGradient id="gP" x1="0" x2="0" y1="0" y2="1">
                          <stop offset="0%" stopColor="#3b82f6" stopOpacity={0.35} />
                          <stop offset="100%" stopColor="#3b82f6" stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="rgb(var(--line))" />
                      <XAxis dataKey="date" stroke="rgb(var(--ink-faint))" fontSize={12} />
                      <YAxis stroke="rgb(var(--ink-faint))" fontSize={12} />
                      <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8, border: "1px solid rgb(var(--line))" }} formatter={(v) => formatCurrency(Number(v), settings.currency) as string} />
                      {canViewSales    && <Area type="monotone" dataKey="sales"     name="المبيعات"    stroke="#10b981" fill="url(#gS)" />}
                      {canViewPurchases && <Area type="monotone" dataKey="purchases" name="المشتريات" stroke="#3b82f6" fill="url(#gP)" />}
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </CardBody>
            </Card>
          )}
          {showStock && (
            <Card>
              <CardHeader title="أعلى قطع راكدة قيمةً" subtitle="رأس مال لم يتحرك منذ 90 يومًا" />
              <CardBody>
                <div className="h-64" dir="ltr">
                  <ResponsiveContainer>
                    <BarChart data={topProductsByStock} layout="vertical" margin={{ left: 10, right: 30, top: 0, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="rgb(var(--line))" horizontal={false} />
                      <XAxis type="number" fontSize={10} stroke="rgb(var(--ink-faint))" />
                      <YAxis type="category" dataKey="name" width={130} fontSize={11} stroke="#475569" tick={{ fill: "#475569", fontWeight: 500 }} axisLine={false} tickLine={false} />
                      <Tooltip cursor={{ fill: "rgb(var(--surface-muted))" }} contentStyle={{ fontSize: 12, borderRadius: 12, border: "none", boxShadow: "0 4px 12px rgb(0 0 0 / 0.1)" }} formatter={(v) => [formatCurrency(Number(v), settings.currency), "قيمة المخزون الراكد"]} />
                      <defs>
                        <linearGradient id="barG" x1="0" y1="0" x2="1" y2="0">
                          <stop offset="0%" stopColor="#6366f1" /><stop offset="100%" stopColor="#818cf8" />
                        </linearGradient>
                      </defs>
                      <Bar dataKey="qty" name="قيمة المخزون الراكد" fill="url(#barG)" radius={[0,4,4,0]} barSize={18} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </CardBody>
            </Card>
          )}
        </div>
      )}

      {/* ── Charts row 2: Top Selling ── */}
      {showTopSelling && topSellingProducts.length > 0 && (
        <Card>
          <CardHeader title="أكثر قطع الغيار مبيعًا — آخر 90 يومًا" subtitle={`صافي الإيرادات بعد المرتجعات — العملة: ${settings.currency}`} />
          <CardBody>
            <div className="h-56" dir="ltr">
              <ResponsiveContainer>
                <BarChart data={topSellingProducts} layout="vertical" margin={{ left: 10, right: 40, top: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgb(var(--line))" horizontal={false} />
                  <XAxis type="number" fontSize={10} stroke="rgb(var(--ink-faint))" />
                  <YAxis type="category" dataKey="name" width={140} fontSize={11} stroke="#475569" tick={{ fill: "#475569", fontWeight: 500 }} axisLine={false} tickLine={false} />
                  <Tooltip cursor={{ fill: "rgb(var(--surface-muted))" }} contentStyle={{ fontSize: 12, borderRadius: 12, border: "none", boxShadow: "0 4px 12px rgb(0 0 0 / 0.1)" }} formatter={(v) => [formatCurrency(Number(v), settings.currency), "الإيرادات"]} />
                  <defs>
                    <linearGradient id="barG2" x1="0" y1="0" x2="1" y2="0">
                      <stop offset="0%" stopColor="#10b981" /><stop offset="100%" stopColor="#34d399" />
                    </linearGradient>
                  </defs>
                  <Bar dataKey="revenue" name="الإيرادات" fill="url(#barG2)" radius={[0,4,4,0]} barSize={18} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardBody>
        </Card>
      )}

      {/* ── Recent Activity + Low Stock ── */}
      {(showRecent || showLowStock) && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {showRecent && (
            <Card className={showLowStock ? "lg:col-span-2" : "lg:col-span-3"}>
              <CardHeader title="حركة بيع وتوريد القطع" subtitle="آخر الفواتير مع السيارة والفرع إن وُجدا" actions={<Link to={canViewSales ? "/sales" : "/purchases"} className="text-xs text-brand-700 hover:underline">عرض الكل</Link>} />
              <CardBody className="divide-y divide-line p-0">
                {recentActivity.length === 0 ? (
                  <div className="p-8 text-center text-sm text-ink-muted">لا يوجد نشاط بعد</div>
                ) : recentActivity.map((a) => (
                  <Link key={a.id} to={a.to ?? "#"} className="flex items-center gap-3 p-3 hover:bg-surface-muted transition-colors">
                    <div className={`w-9 h-9 rounded-lg grid place-items-center ${a.tone === "green" ? "bg-emerald-50 dark:bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 dark:bg-emerald-500/15 dark:text-emerald-300" : "bg-blue-50 dark:bg-blue-500/10 text-blue-600 dark:text-blue-400 dark:bg-blue-500/15 dark:text-blue-300"}`}>
                      {a.tone === "green" ? <Receipt className="w-4 h-4" /> : <ShoppingBag className="w-4 h-4" />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm text-ink">{a.title}</div>
                      <div className="text-xs text-ink-muted truncate">{a.sub}</div>
                    </div>
                    <div className="text-left">
                      {a.amount !== undefined && <div className="text-sm font-medium text-ink">{formatCurrency(a.amount, settings.currency)}</div>}
                      <div className="text-xs text-ink-faint">{formatDate(a.date)}</div>
                    </div>
                  </Link>
                ))}
              </CardBody>
            </Card>
          )}
          {showLowStock && (
            <Card>
              <CardHeader title="أولوية إعادة طلب القطع" subtitle="رصيد وصل إلى حد الأمان" actions={<Link to="/purchasing-assistant" className="text-xs text-brand-700 hover:underline">فتح مساعد الشراء</Link>} />
              <CardBody className="divide-y divide-line p-0">
                {lowStockList.length === 0 ? (
                  <div className="p-8 text-center text-sm text-ink-muted">لا توجد قطع تحت حد الأمان</div>
                ) : lowStockList.map((p) => (
                  <div key={p.id} className="flex items-center gap-3 p-3">
                    <div className="w-9 h-9 rounded-lg bg-amber-50 dark:bg-amber-500/10 text-amber-600 dark:text-amber-400 dark:bg-amber-500/15 dark:text-amber-300 grid place-items-center">
                      <AlertTriangle className="w-4 h-4" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm text-ink truncate">{p.name}</div>
                      <div className="text-xs text-ink-muted" dir="ltr">{p.partNumber || p.code}{p.rackLocation ? ` · رف ${p.rackLocation}` : ""}</div>
                      <div className="text-[10px] text-ink-faint">حد إعادة الطلب: {p.minStock}</div>
                    </div>
                    <Badge tone={p.quantity === 0 ? "red" : "amber"}>{p.quantity} {p.unit}</Badge>
                  </div>
                ))}
              </CardBody>
            </Card>
          )}
        </div>
      )}

      {/* ── Overdue Invoices ── */}
      {showOverdue && (
        <Card>
          <CardHeader title="فواتير آجل متأخرة عن الاستحقاق" subtitle={`${overdueInvoices.length} فاتورة — إجمالي: ${formatCurrency(overdueTotal, settings.currency)}`} actions={<Link to="/sales" className="text-xs text-brand-700 hover:underline">عرض كل الفواتير</Link>} />
          <CardBody className="divide-y divide-line p-0">
            {overdueInvoices.slice(0, 8).map((inv) => {
              const due = new Date(inv.paymentDueDate!); due.setHours(0,0,0,0);
              const today = new Date(); today.setHours(0,0,0,0);
              const daysLate = Math.floor((today.getTime() - due.getTime()) / 86400000);
              return (
                <Link key={inv.id} to={`/sales/${inv.id}`} className="flex items-center gap-3 p-3 hover:bg-surface-muted transition-colors">
                  <div className="w-9 h-9 rounded-lg bg-rose-50 dark:bg-rose-500/10 text-rose-600 dark:text-rose-400 dark:bg-rose-500/15 dark:text-rose-300 grid place-items-center shrink-0">
                    <AlertTriangle className="w-4 h-4" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-ink">{inv.customerName}</div>
                    <div className="text-xs text-ink-muted">{inv.invoiceNumber} — متأخر {daysLate} يوم</div>
                    {(inv.vehicleLabel || inv.branchName) && <div className="text-[10px] text-ink-faint">{[inv.vehicleLabel, inv.branchName].filter(Boolean).join(" · ")}</div>}
                  </div>
                  <div className="text-start shrink-0">
                    <div className="text-sm font-bold text-rose-700 dark:text-rose-400">{formatCurrency(inv.remaining, settings.currency)}</div>
                    <div className="text-xs text-ink-faint">استحقاق: {formatDate(inv.paymentDueDate!)}</div>
                  </div>
                </Link>
              );
            })}
          </CardBody>
        </Card>
      )}

      {/* ── Quick Actions ── */}
      {showQuickActions && (
        <Card>
          <CardHeader title="اختصارات تشغيل محل قطع الغيار" />
          <CardBody className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {canAddSales     && <Link to="/pos"><Button variant="outline" className="w-full justify-start"><Receipt className="w-4 h-4" />فتح الكاشير</Button></Link>}
            {canViewProducts && <Link to="/parts-finder"><Button variant="outline" className="w-full justify-start"><PackageSearch className="w-4 h-4" />دليل القطع والتوافق</Button></Link>}
            {canViewCustomers && <Link to="/customer-garage"><Button variant="outline" className="w-full justify-start"><CarFront className="w-4 h-4" />جراج سيارات العملاء</Button></Link>}
            {canAddPurchases && <Link to="/purchasing-assistant"><Button variant="outline" className="w-full justify-start"><ShoppingBag className="w-4 h-4" />مساعد إعادة الطلب</Button></Link>}
            {canViewReturns  && <Link to="/warranty-center"><Button variant="outline" className="w-full justify-start"><ShieldCheck className="w-4 h-4" />مركز الضمان</Button></Link>}
            {canViewInventory && <Link to="/branches"><Button variant="outline" className="w-full justify-start"><Building2 className="w-4 h-4" />الفروع والتحويلات</Button></Link>}
            {canAddProduct   && <Link to="/products"><Button variant="outline" className="w-full justify-start"><Package className="w-4 h-4" />إضافة قطعة جديدة</Button></Link>}
            {canAddCustomer  && <Link to="/customer-garage"><Button variant="outline" className="w-full justify-start"><Users className="w-4 h-4" />إضافة سيارة عميل</Button></Link>}
          </CardBody>
        </Card>
      )}

      {/* ── Customize Dialog ── */}
      <CustomizeDialog
        open={customizeOpen}
        onClose={() => setCustomizeOpen(false)}
        cards={cards}
        sections={sections}
        cardAllowed={cardAllowed}
        sectionAllowed={sectionAllowed}
        onToggleCard={toggleCard}
        onToggleSection={toggleSection}
        onMove={moveCard}
        onReset={reset}
      />
    </>
  );
}
