import { useMemo, useState } from "react";
import { AlertTriangle, ClipboardCopy, PackagePlus, Search, ShoppingCart, Sparkles, TrendingUp } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { AutoPartsHero } from "../components/AutoPartsHero";
import { Badge } from "../components/ui/Badge";
import { Button } from "../components/ui/Button";
import { Card, CardBody, CardHeader } from "../components/ui/Card";
import { EmptyState } from "../components/ui/EmptyState";
import { Input, Select } from "../components/ui/Input";
import { useToast } from "../components/ui/Toast";
import { formatCurrency } from "../lib/format";
import { useCatalog } from "../store/CatalogContext";
import { useInvoicing } from "../store/InvoicingContext";
import { useSettings } from "../store/SettingsContext";

function daysAgo(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return date.toISOString().slice(0, 10);
}

export function PurchasingAssistantPage() {
  const { products, suppliers } = useCatalog();
  const { salesInvoices, purchaseInvoices, salesReturns } = useInvoicing();
  const { settings } = useSettings();
  const toast = useToast();
  const navigate = useNavigate();
  const [windowDays, setWindowDays] = useState(90);
  const [targetDays, setTargetDays] = useState(45);
  const [query, setQuery] = useState("");
  const [supplierFilter, setSupplierFilter] = useState("all");
  const since = daysAgo(windowDays);

  const rows = useMemo(() => products
    .filter((product) => !product.archived)
    .map((product) => {
      const sold = salesInvoices
        .filter((invoice) => !invoice.cancelled && invoice.date >= since)
        .flatMap((invoice) => invoice.lines)
        .filter((line) => line.productId === product.id)
        .reduce((sum, line) => sum + line.quantity, 0);
      const returned = salesReturns
        .filter((item) => item.date >= since)
        .flatMap((item) => item.lines)
        .filter((line) => line.productId === product.id)
        .reduce((sum, line) => sum + line.quantity, 0);
      const netSold = Math.max(0, sold - returned);
      const dailyRate = netSold / Math.max(1, windowDays);
      const coverDays = dailyRate > 0 ? product.quantity / dailyRate : null;
      const forecastNeed = Math.ceil(dailyRate * targetDays - product.quantity);
      const minimumNeed = product.quantity <= product.minStock
        ? (product.reorderQuantity ?? Math.max(1, product.minStock * 2 - product.quantity))
        : 0;
      const recommended = Math.max(0, forecastNeed, minimumNeed);
      const lastPurchase = purchaseInvoices
        .filter((invoice) => invoice.lines.some((line) => line.productId === product.id))
        .sort((a, b) => b.date.localeCompare(a.date))[0];
      const lastLine = lastPurchase?.lines.find((line) => line.productId === product.id);
      const supplierId = product.supplierId || lastPurchase?.supplierId;
      const supplierName = suppliers.find((supplier) => supplier.id === supplierId)?.name || lastPurchase?.supplierName || "غير محدد";
      const cost = lastLine?.price ?? product.purchasePrice;
      const urgency = product.quantity <= 0 ? 3 : product.quantity <= product.minStock ? 2 : coverDays !== null && coverDays < 15 ? 1 : 0;
      return { product, netSold, dailyRate, coverDays, recommended, supplierId, supplierName, cost, urgency };
    })
    .filter((row) => row.recommended > 0)
    .sort((a, b) => b.urgency - a.urgency || b.recommended * b.cost - a.recommended * a.cost), [products, purchaseInvoices, salesInvoices, salesReturns, since, suppliers, targetDays, windowDays]);

  const filtered = rows.filter((row) => {
    const text = `${row.product.name} ${row.product.partNumber ?? ""} ${row.product.code} ${row.product.partBrand ?? ""}`.toLowerCase();
    return text.includes(query.trim().toLowerCase()) && (supplierFilter === "all" || row.supplierId === supplierFilter || (supplierFilter === "none" && !row.supplierId));
  });
  const totalBudget = filtered.reduce((sum, row) => sum + row.recommended * row.cost, 0);

  function copyPlan() {
    const text = filtered.map((row) => `${row.product.partNumber || row.product.code}\t${row.product.name}\t${row.recommended}\t${row.supplierName}`).join("\n");
    void navigator.clipboard.writeText(`رقم القطعة\tالصنف\tالكمية\tالمورد\n${text}`);
    toast.success("تم نسخ خطة الشراء", "يمكن لصقها في Excel أو إرسالها للمورد.");
  }

  return (
    <div className="space-y-5" dir="rtl">
      <AutoPartsHero
        icon={Sparkles}
        eyebrow="DEMAND FORECAST · REORDER · SUPPLIER COST"
        title="مساعد المشتريات الذكي"
        description="يحوّل حركة البيع والحد الأدنى والتغطية بالأيام إلى خطة طلب واضحة، مع آخر مورد وتكلفة وميزانية متوقعة."
        stats={[
          { label: "قطع مقترح طلبها", value: filtered.length },
          { label: "وحدات مطلوبة", value: filtered.reduce((sum, row) => sum + row.recommended, 0) },
          { label: "ميزانية تقديرية", value: formatCurrency(totalBudget, settings.currency) },
        ]}
        actions={<><Button variant="outline" className="border-white/20 bg-white/10 text-white hover:bg-white/20" onClick={copyPlan}><ClipboardCopy className="h-4 w-4" /> نسخ الخطة</Button><Button className="bg-amber-400 text-slate-950 hover:bg-amber-300" onClick={() => navigate("/purchases/new")}><ShoppingCart className="h-4 w-4" /> فاتورة شراء</Button></>}
      />

      <Card>
        <CardBody className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
          <div className="relative xl:col-span-2"><Search className="absolute right-3 top-2.5 h-4 w-4 text-ink-faint" /><Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="ابحث باسم أو Part Number..." className="pr-10" /></div>
          <Select value={supplierFilter} onChange={(event) => setSupplierFilter(event.target.value)}><option value="all">كل الموردين</option><option value="none">بدون مورد محدد</option>{suppliers.filter((supplier) => !supplier.archived).map((supplier) => <option key={supplier.id} value={supplier.id}>{supplier.name}</option>)}</Select>
          <Select value={windowDays} onChange={(event) => setWindowDays(Number(event.target.value))}><option value={30}>حركة آخر 30 يوم</option><option value={60}>حركة آخر 60 يوم</option><option value={90}>حركة آخر 90 يوم</option><option value={180}>حركة آخر 180 يوم</option></Select>
          <Select value={targetDays} onChange={(event) => setTargetDays(Number(event.target.value))}><option value={30}>تغطية 30 يوم</option><option value={45}>تغطية 45 يوم</option><option value={60}>تغطية 60 يوم</option><option value={90}>تغطية 90 يوم</option></Select>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="خطة إعادة الطلب" subtitle="المقترح لا يغير المخزون؛ راجعه قبل إنشاء فاتورة الشراء" />
        <CardBody className="p-0">
          {filtered.length === 0 ? <div className="p-6"><EmptyState icon={<PackagePlus className="h-6 w-6" />} title="لا توجد احتياجات شراء وفق الفلاتر الحالية" /></div> : <div className="overflow-x-auto"><table className="w-full text-sm"><thead className="bg-surface-muted text-xs text-ink-muted"><tr><th className="p-3 text-right">القطعة</th><th className="p-3 text-right">المورد</th><th className="p-3 text-center">المخزون</th><th className="p-3 text-center">مبيعات الفترة</th><th className="p-3 text-center">التغطية</th><th className="p-3 text-center">المقترح</th><th className="p-3 text-left">التكلفة المتوقعة</th></tr></thead><tbody>{filtered.map((row) => <tr key={row.product.id} className="border-t border-line hover:bg-surface-muted/30"><td className="p-3"><div className="font-semibold text-ink">{row.product.name}</div><div className="mt-0.5 font-mono text-[11px] text-ink-faint" dir="ltr">{row.product.partNumber || row.product.code} · {row.product.partBrand || "—"}</div></td><td className="p-3"><Badge tone={row.supplierId ? "blue" : "amber"}>{row.supplierName}</Badge></td><td className="p-3 text-center"><Badge tone={row.product.quantity <= 0 ? "red" : row.product.quantity <= row.product.minStock ? "amber" : "green"}>{row.product.quantity}</Badge></td><td className="p-3 text-center">{row.netSold}</td><td className="p-3 text-center">{row.coverDays === null ? "لا حركة" : `${Math.round(row.coverDays)} يوم`}</td><td className="p-3 text-center"><strong className="text-lg text-brand-700">{row.recommended}</strong></td><td className="p-3 text-left font-bold">{formatCurrency(row.recommended * row.cost, settings.currency)}</td></tr>)}</tbody></table></div>}
        </CardBody>
      </Card>

      <div className="grid gap-3 md:grid-cols-3">
        <Insight icon={AlertTriangle} title="الأولوية الأولى" value={`${filtered.filter((row) => row.product.quantity <= 0).length} قطعة نافدة`} tone="rose" />
        <Insight icon={TrendingUp} title="سريعة الحركة" value={`${filtered.filter((row) => row.dailyRate >= 0.2).length} قطعة`} tone="cyan" />
        <Insight icon={PackagePlus} title="بدون مورد" value={`${filtered.filter((row) => !row.supplierId).length} قطعة تحتاج ربط`} tone="amber" />
      </div>
    </div>
  );
}

function Insight({ icon: Icon, title, value, tone }: { icon: typeof AlertTriangle; title: string; value: string; tone: "rose" | "cyan" | "amber" }) {
  const color = tone === "rose" ? "bg-rose-50 text-rose-700 dark:bg-rose-500/10" : tone === "cyan" ? "bg-cyan-50 text-cyan-700 dark:bg-cyan-500/10" : "bg-amber-50 text-amber-700 dark:bg-amber-500/10";
  return <Card><CardBody className="flex items-center gap-3"><div className={`grid h-11 w-11 place-items-center rounded-xl ${color}`}><Icon className="h-5 w-5" /></div><div><div className="text-xs text-ink-muted">{title}</div><div className="mt-1 font-bold text-ink">{value}</div></div></CardBody></Card>;
}
