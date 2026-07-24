import { buildXlsx } from "../lib/xlsx";
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { AlertTriangle, ArrowLeft, BadgeDollarSign, Building2, CarFront, MapPin, PackageSearch, ShieldCheck, TrendingUp, Undo2, Download, Printer } from "lucide-react";
import { AutoPartsHero } from "../components/AutoPartsHero";
import { Badge } from "../components/ui/Badge";
import { Card, CardBody, CardHeader } from "../components/ui/Card";
import { EmptyState } from "../components/ui/EmptyState";
import { Table, TBody, TD, TH, THead, TR } from "../components/ui/Table";
import { formatCurrency } from "../lib/format";
import { useCatalog } from "../store/CatalogContext";
import { useSettings } from "../store/SettingsContext";
import { useVehicleCatalog } from "../store/VehicleCatalogContext";
import { useInvoicing } from "../store/InvoicingContext";
import { useAutoPartsPro } from "../store/AutoPartsProContext";
import { useAuth } from "../store/AuthContext";
import { Select } from "../components/ui/Input";
import { Button } from "../components/ui/Button";
import { Dialog } from "../components/ui/Dialog";
import { localISODate } from "../lib/utils";
import { hasPermission } from "../lib/permissions";

const ORIGIN_LABELS: Record<string, string> = {
  CN: "الصين 🇨🇳",
  KR: "كوريا الجنوبية 🇰🇷",
  DE: "ألمانيا 🇩🇪",
  JP: "اليابان 🇯🇵",
  US: "الولايات المتحدة 🇺🇸",
  IT: "إيطاليا 🇮🇹",
};

export function AutoPartsReportsPage() {
  const { products } = useCatalog();
  const { settings } = useSettings();
  const { salesInvoices, salesReturns } = useInvoicing();
  const { currentUser } = useAuth();
  const pro = useAutoPartsPro();
  const vehicleCatalog = useVehicleCatalog();
  const [period, setPeriod] = useState<"30" | "90" | "180" | "all">("90");
  const [printTarget, setPrintTarget] = useState<"stagnant" | "returns" | "reorder" | null>(null);
  const [reportModal, setReportModal] = useState<"stagnant" | "returns" | "reorder" | "brands" | "completion" | null>(null);
  const [modalLimit, setModalLimit] = useState<number>(50);

  function openModal(type: typeof reportModal) {
    setModalLimit(50);
    setReportModal(type);
  }
  const canViewBranches = hasPermission(currentUser, "inventory");
  const canViewWarranty = hasPermission(currentUser, "returns");
  const canManagePricing = currentUser?.role === "owner";
  const periodStart = useMemo(() => {
    if (period === "all") return "";
    const date = new Date();
    date.setDate(date.getDate() - Number(period));
    return localISODate(date);
  }, [period]);
  const periodSales = salesInvoices.filter((invoice) => !invoice.cancelled && (!periodStart || invoice.date.slice(0, 10) >= periodStart));
  const invoiceById = new Map(salesInvoices.map((invoice) => [invoice.id, invoice]));
  const periodReturns = salesReturns.filter((item) => !invoiceById.get(item.originalInvoiceId)?.cancelled && (!periodStart || item.date.slice(0, 10) >= periodStart));
  const activeProducts = products.filter((product) => !product.archived);
  const fittedProductIds = new Set(vehicleCatalog.productFitments.map((fitment) => fitment.productId));
  const inventoryValue = activeProducts.reduce(
    (sum, product) => sum + product.quantity * (product.avgCost ?? product.purchasePrice),
    0,
  );
  const lowStock = activeProducts.filter((product) => product.quantity <= product.minStock);
  const missingFitment = activeProducts.filter((product) => !fittedProductIds.has(product.id));
  const missingRack = activeProducts.filter((product) => !product.rackLocation?.trim());
  const warrantyProducts = activeProducts.filter((product) => (product.warrantyMonths ?? 0) > 0);
  const productById = new Map(activeProducts.map((product) => [product.id, product]));
  const salesByProduct = new Map<string, { quantity: number; revenue: number; profit: number; lastDate: string }>();
  for (const invoice of periodSales) {
    const linesGross = invoice.lines.reduce((sum, line) => sum + line.subtotal, 0);
    for (const line of invoice.lines) {
      const row = salesByProduct.get(line.productId) ?? { quantity: 0, revenue: 0, profit: 0, lastDate: "" };
      const discountShare = linesGross > 0 ? (invoice.discount ?? 0) * (line.subtotal / linesGross) : 0;
      const netLineRevenue = line.subtotal - discountShare;
      row.quantity += line.quantity;
      row.revenue += netLineRevenue;
      const rowProd = productById.get(line.productId);
      row.profit += netLineRevenue - (line.costPrice ?? rowProd?.avgCost ?? rowProd?.purchasePrice ?? 0) * line.quantity;
      row.lastDate = row.lastDate > invoice.date ? row.lastDate : invoice.date;
      salesByProduct.set(line.productId, row);
    }
  }
  const returnedByProduct = new Map<string, number>();
  for (const item of periodReturns) for (const line of item.lines) {
    returnedByProduct.set(line.productId, (returnedByProduct.get(line.productId) ?? 0) + line.quantity);
    const original = invoiceById.get(item.originalInvoiceId);
    const originalLine = original?.lines.find((entry) => entry.id === line.sourceLineId)
      ?? original?.lines.find((entry) => entry.productId === line.productId);
    const row = salesByProduct.get(line.productId) ?? { quantity: 0, revenue: 0, profit: 0, lastDate: "" };
    const returnProd = productById.get(line.productId);
    const cost = originalLine?.costPrice ?? returnProd?.avgCost ?? returnProd?.purchasePrice ?? 0;
    row.quantity -= line.quantity;
    row.revenue -= line.subtotal;
    row.profit -= line.subtotal - cost * line.quantity;
    salesByProduct.set(line.productId, row);
  }
  const lastSaleByProduct = new Map<string, string>();
  for (const invoice of salesInvoices.filter((item) => !item.cancelled)) for (const line of invoice.lines) {
    const current = lastSaleByProduct.get(line.productId) ?? "";
    if (invoice.date > current) lastSaleByProduct.set(line.productId, invoice.date);
  }
  const ninetyDaysAgo = (() => { const date = new Date(); date.setDate(date.getDate() - 90); return localISODate(date); })();
  const deadStock = activeProducts
    .filter((product) => product.quantity > 0 && (!lastSaleByProduct.get(product.id) || lastSaleByProduct.get(product.id)! < ninetyDaysAgo))
    .sort((a, b) => b.quantity * (b.avgCost ?? b.purchasePrice) - a.quantity * (a.avgCost ?? a.purchasePrice));
  const fastMovers = [...salesByProduct.entries()]
    .map(([productId, row]) => ({ product: productById.get(productId), ...row, returned: returnedByProduct.get(productId) ?? 0 }))
    .filter((row) => row.product && row.quantity > 0)
    .sort((a, b) => b.quantity - a.quantity)
    .slice(0, 12);
  const originPerformance = (() => {
    const map = new Map<string, { products: number; stock: number; revenue: number; profit: number }>();
    for (const product of activeProducts) {
      const origin = product.originCountry || "غير محدد";
      const row = map.get(origin) ?? { products: 0, stock: 0, revenue: 0, profit: 0 };
      const sales = salesByProduct.get(product.id);
      row.products += 1;
      row.stock += product.quantity;
      row.revenue += sales?.revenue ?? 0;
      row.profit += sales?.profit ?? 0;
      map.set(origin, row);
    }
    return [...map.entries()].map(([origin, row]) => ({ origin, ...row })).sort((a, b) => b.revenue - a.revenue);
  })();
  const vehicleSales = (() => {
    const map = new Map<string, { invoices: number; revenue: number }>();
    for (const invoice of periodSales.filter((item) => item.vehicleLabel)) {
      const row = map.get(invoice.vehicleLabel!) ?? { invoices: 0, revenue: 0 };
      row.invoices += 1;
      row.revenue += invoice.total;
      map.set(invoice.vehicleLabel!, row);
    }
    for (const item of periodReturns) {
      const invoice = invoiceById.get(item.originalInvoiceId);
      if (!invoice?.vehicleLabel) continue;
      const row = map.get(invoice.vehicleLabel) ?? { invoices: 0, revenue: 0 };
      row.revenue -= item.total;
      map.set(invoice.vehicleLabel, row);
    }
    return [...map.entries()].map(([vehicle, row]) => ({ vehicle, ...row })).sort((a, b) => b.revenue - a.revenue).slice(0, 10);
  })();
  const branchDistribution = pro.branches.filter((branch) => branch.active).map((branch) => {
    const rows = pro.branchStocks.filter((row) => row.branchId === branch.id);
    return {
      branch,
      quantity: rows.reduce((sum, row) => sum + row.quantity, 0),
      skuCount: rows.filter((row) => row.quantity > 0).length,
    };
  }).sort((a, b) => b.quantity - a.quantity);
  const openWarrantyClaims = pro.warrantyClaims.filter((claim) => !["rejected", "replaced"].includes(claim.status));
  const priceTierPerformance = (() => {
    const map = new Map<string, { invoices: number; revenue: number }>();
    for (const invoice of periodSales) {
      const name = invoice.priceTierName || "السعر الافتراضي";
      const row = map.get(name) ?? { invoices: 0, revenue: 0 };
      row.invoices += 1;
      row.revenue += invoice.total;
      map.set(name, row);
    }
    for (const item of periodReturns) {
      const invoice = invoiceById.get(item.originalInvoiceId);
      const name = invoice?.priceTierName || "السعر الافتراضي";
      const row = map.get(name) ?? { invoices: 0, revenue: 0 };
      row.revenue -= item.total;
      map.set(name, row);
    }
    return [...map.entries()].map(([name, row]) => ({ name, ...row })).sort((a, b) => b.revenue - a.revenue);
  })();

  const reorderRows = lowStock
    .map((product) => ({
      product,
      suggested: product.reorderQuantity ?? Math.max(1, product.minStock * 2 - product.quantity),
    }))
    .sort((a, b) => a.product.quantity - b.product.quantity);

  const allBrands = (() => {
    const map = new Map<string, { count: number; quantity: number; value: number }>();
    for (const product of activeProducts) {
      const brand = product.partBrand?.trim() || "بدون ماركة";
      const row = map.get(brand) ?? { count: 0, quantity: 0, value: 0 };
      row.count += 1;
      row.quantity += product.quantity;
      row.value += product.quantity * (product.avgCost ?? product.purchasePrice);
      map.set(brand, row);
    }
    return [...map.entries()]
      .map(([brand, values]) => ({ brand, ...values }))
      .sort((a, b) => b.value - a.value);
  })();

  const brands = allBrands.slice(0, 5);

  const incompleteProducts = activeProducts.filter(
    (product) => !fittedProductIds.has(product.id) || !product.rackLocation || !product.oemNumbers?.length
  );

  if (printTarget) {
    return (
      <PrintableReportView
        target={printTarget}
        onClose={() => setPrintTarget(null)}
        deadStock={deadStock}
        returnedByProduct={returnedByProduct}
        productById={productById}
        reorderRows={reorderRows}
        currency={settings.currency}
      />
    );
  }

  return (
    <>
      <AutoPartsHero
        icon={PackageSearch}
        title="تقارير قطع الغيار"
        description={`أداء الماركات والسيارات والقطع والمرتجعات خلال ${period === "all" ? "كل المدة" : `آخر ${period} يومًا`}، مع الفروع والضمان وجودة بيانات الكتالوج.`}
        actions={
          <div className="flex flex-row items-center gap-2 w-full sm:w-auto">
            <Select
              value={period}
              onChange={(event) => setPeriod(event.target.value as typeof period)}
              className="h-10 w-40 border-white/15 bg-white/10 text-white"
            >
              <option className="text-slate-900" value="30">آخر 30 يوم</option>
              <option className="text-slate-900" value="90">آخر 90 يوم</option>
              <option className="text-slate-900" value="180">آخر 180 يوم</option>
              <option className="text-slate-900" value="all">كل المدة</option>
            </Select>
            <Link to="/reports/financial" className="shrink-0">
              <Button
                variant="outline"
                className="h-10 border-white/15 bg-white/10 text-white hover:bg-white/20"
              >
                التقارير المالية <ArrowLeft className="h-4 w-4" />
              </Button>
            </Link>
          </div>
        }
      />
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
        <ReportStat icon={<PackageSearch className="w-5 h-5" />} label="قيمة المخزون" value={formatCurrency(inventoryValue, settings.currency)} tone="blue" />
        <ReportStat icon={<AlertTriangle className="w-5 h-5" />} label="إعادة طلب" value={String(lowStock.length)} tone="amber" />
        <ReportStat icon={<CarFront className="w-5 h-5" />} label="بدون توافق سيارة" value={String(missingFitment.length)} tone="rose" />
        <ReportStat icon={<MapPin className="w-5 h-5" />} label="بدون موقع رف" value={String(missingRack.length)} tone="slate" />
        <ReportStat icon={<ShieldCheck className="w-5 h-5" />} label="قطع بضمان" value={String(warrantyProducts.length)} tone="green" />
        <ReportStat icon={<Building2 className="w-5 h-5" />} label="فروع نشطة" value={String(branchDistribution.length)} tone="blue" />
        <ReportStat icon={<ShieldCheck className="w-5 h-5" />} label="مطالبات ضمان مفتوحة" value={String(openWarrantyClaims.length)} tone="amber" />
        <ReportStat icon={<BadgeDollarSign className="w-5 h-5" />} label="شرائح سعر مستخدمة" value={String(priceTierPerformance.length)} tone="slate" />
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <Card>
          <CardHeader title="توزيع المخزون على الفروع" subtitle="عدد الأصناف والوحدات المخصصة لكل فرع" actions={canViewBranches ? <Link to="/branches" className="text-xs font-semibold text-brand-700">إدارة الفروع</Link> : undefined} />
          <CardBody className="space-y-2">{branchDistribution.map((row) => <div key={row.branch.id} className="flex items-center justify-between rounded-xl border border-line p-3"><div><div className="font-semibold">{row.branch.name}</div><div className="text-xs text-ink-faint">{row.skuCount} رقم قطعة متوفر</div></div><Badge tone="blue">{row.quantity} وحدة</Badge></div>)}</CardBody>
        </Card>
        <Card>
          <CardHeader title="حالة مطالبات الضمان" subtitle="المطالبات التي تحتاج متابعة" actions={canViewWarranty ? <Link to="/warranty-center" className="text-xs font-semibold text-brand-700">مركز الضمان</Link> : undefined} />
          <CardBody className="space-y-2">{openWarrantyClaims.length === 0 ? <EmptyState icon={<ShieldCheck className="h-5 w-5" />} title="لا توجد مطالبات مفتوحة" /> : openWarrantyClaims.slice(0, 8).map((claim) => <div key={claim.id} className="flex items-center justify-between rounded-xl border border-line p-3"><div><div className="text-sm font-semibold">{claim.productName}</div><div className="text-xs text-ink-faint">{claim.customerName}</div></div><Badge tone="amber">{claim.status === "open" ? "مفتوحة" : claim.status === "inspecting" ? "قيد الفحص" : claim.status === "supplier" ? "لدى المورد" : "معتمدة"}</Badge></div>)}</CardBody>
        </Card>
        <Card>
          <CardHeader title="أداء شرائح التسعير" subtitle={period === "all" ? "كل المدة" : `آخر ${period} يومًا`} actions={canManagePricing ? <Link to="/pricing-rules" className="text-xs font-semibold text-brand-700">قواعد الأسعار</Link> : undefined} />
          <CardBody className="space-y-2">{priceTierPerformance.length === 0 ? <EmptyState icon={<BadgeDollarSign className="h-5 w-5" />} title="لا توجد مبيعات في الفترة" /> : priceTierPerformance.map((row) => <div key={row.name} className="rounded-xl border border-line p-3"><div className="flex items-center justify-between"><span className="font-semibold">{row.name}</span><strong>{formatCurrency(row.revenue, settings.currency)}</strong></div><div className="mt-1 text-xs text-ink-faint">{row.invoices} فاتورة</div></div>)}</CardBody>
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <Card>
          <CardHeader title="الأداء حسب بلد المنشأ" subtitle="الإيراد والربح من القطع المباعة" />
          <CardBody className="space-y-2">{originPerformance.map((row) => <div key={row.origin} className="rounded-xl border border-line p-3"><div className="flex items-center justify-between"><Badge tone={row.origin === "CN" ? "red" : row.origin === "KR" ? "blue" : "slate"}>{ORIGIN_LABELS[row.origin] || row.origin}</Badge><strong>{formatCurrency(row.revenue, settings.currency)}</strong></div><div className="mt-2 flex justify-between text-xs text-ink-muted"><span>{row.products} رقم قطعة · {row.stock} وحدة</span><span className="text-emerald-700">ربح {formatCurrency(row.profit, settings.currency)}</span></div></div>)}</CardBody>
        </Card>
        <Card>
          <CardHeader title={<span className="flex items-center gap-2"><TrendingUp className="h-4 w-4 text-emerald-600" /> أسرع القطع حركة</span>} subtitle="مرتبة حسب الكمية المباعة" />
          <CardBody className="space-y-2">{fastMovers.length === 0 ? <EmptyState icon={<TrendingUp className="h-5 w-5" />} title="لا توجد مبيعات بعد" /> : fastMovers.slice(0, 8).map((row) => <div key={row.product!.id} className="flex items-center justify-between gap-3 rounded-xl border border-line p-3"><div className="min-w-0"><div className="truncate text-sm font-semibold">{row.product!.name}</div><div className="font-mono text-[11px] text-ink-faint" dir="ltr">{row.product!.partNumber || row.product!.code}</div></div><div className="text-left"><strong className="text-brand-700">{row.quantity}</strong><div className="text-[10px] text-ink-faint">مباع</div></div></div>)}</CardBody>
        </Card>
        <Card>
          <CardHeader title={<span className="flex items-center gap-2"><CarFront className="h-4 w-4 text-cyan-600" /> السيارات الأعلى مبيعًا</span>} subtitle="حسب السيارات المختارة في POS" />
          <CardBody className="space-y-2">{vehicleSales.length === 0 ? <EmptyState icon={<CarFront className="h-5 w-5" />} title="اربط الفواتير بسيارات العملاء" /> : vehicleSales.map((row) => <div key={row.vehicle} className="rounded-xl border border-line p-3"><div className="text-sm font-semibold" dir="ltr">{row.vehicle}</div><div className="mt-2 flex justify-between text-xs text-ink-muted"><span>{row.invoices} فاتورة</span><strong>{formatCurrency(row.revenue, settings.currency)}</strong></div></div>)}</CardBody>
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2 items-stretch">
        <Card className="flex flex-col h-full">
          <CardHeader
            title="المخزون الراكد"
            subtitle="رصيد لم يتحرك خلال آخر 90 يومًا"
            actions={
              <div className="flex items-center gap-2">
                <Button size="sm" variant="outline" className="gap-1 border-brand-200 text-brand-700 hover:bg-brand-50" onClick={() => setPrintTarget("stagnant")}>
                  <Printer className="w-3.5 h-3.5" />طباعة الكشف
                </Button>
                {deadStock.length > 5 && (
                  <Button size="sm" variant="ghost" className="text-xs text-brand-600 font-medium hover:bg-brand-50" onClick={() => openModal("stagnant")}>
                    المزيد ({deadStock.length})
                  </Button>
                )}
              </div>
            }
          />
          <CardBody className="flex-1 flex flex-col justify-between">
            {deadStock.length === 0 ? (
              <EmptyState icon={<ShieldCheck className="h-5 w-5" />} title="لا يوجد مخزون راكد" />
            ) : (
              <div className="flex-1 flex flex-col justify-between space-y-2">
                <div className="space-y-2">
                  {deadStock.slice(0, 5).map((product) => (
                    <div key={product.id} className="flex items-center justify-between gap-3 rounded-xl border border-line p-3">
                      <div>
                        <div className="text-sm font-semibold">{product.name}</div>
                        <div className="font-mono text-[11px] text-ink-faint" dir="ltr">{product.partNumber || product.code}</div>
                      </div>
                      <div className="text-left">
                        <Badge tone="amber">{product.quantity} وحدة</Badge>
                        <div className="mt-1 text-xs font-semibold">{formatCurrency(product.quantity * (product.avgCost ?? product.purchasePrice), settings.currency)}</div>
                      </div>
                    </div>
                  ))}
                </div>
                {deadStock.length > 5 && (
                  <div className="pt-2 text-center border-t border-line-soft mt-auto">
                    <button
                      onClick={() => openModal("stagnant")}
                      className="text-xs text-brand-600 hover:text-brand-800 font-semibold"
                    >
                      عرض باقي الأصناف الراكدة ({deadStock.length - 5} متبقٍ) ←
                    </button>
                  </div>
                )}
              </div>
            )}
          </CardBody>
        </Card>

        <Card className="flex flex-col h-full">
          <CardHeader
            title={<span className="flex items-center gap-2"><Undo2 className="h-4 w-4 text-rose-600" /> مراقبة المرتجعات</span>}
            subtitle="القطع الأعلى في الكمية المرتجعة"
            actions={
              <div className="flex items-center gap-2">
                <Button size="sm" variant="outline" className="gap-1 border-brand-200 text-brand-700 hover:bg-brand-50" onClick={() => setPrintTarget("returns")}>
                  <Printer className="w-3.5 h-3.5" />طباعة الكشف
                </Button>
                {returnedByProduct.size > 5 && (
                  <Button size="sm" variant="ghost" className="text-xs text-brand-600 font-medium hover:bg-brand-50" onClick={() => openModal("returns")}>
                    المزيد ({returnedByProduct.size})
                  </Button>
                )}
              </div>
            }
          />
          <CardBody className="flex-1 flex flex-col justify-between">
            {returnedByProduct.size === 0 ? (
              <EmptyState icon={<Undo2 className="h-5 w-5" />} title="لا توجد مرتجعات مبيعات" />
            ) : (
              <div className="flex-1 flex flex-col justify-between space-y-2">
                <div className="space-y-2">
                  {[...returnedByProduct.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([productId, quantity]) => {
                    const product = productById.get(productId);
                    return (
                      <div key={productId} className="flex items-center justify-between rounded-xl border border-line p-3">
                        <div>
                          <div className="text-sm font-semibold">{product?.name || "منتج محذوف"}</div>
                          <div className="font-mono text-[11px] text-ink-faint" dir="ltr">{product?.partNumber || product?.code || productId}</div>
                        </div>
                        <Badge tone="rose">{quantity} مرتجع</Badge>
                      </div>
                    );
                  })}
                </div>
                {returnedByProduct.size > 5 && (
                  <div className="pt-2 text-center border-t border-line-soft mt-auto">
                    <button
                      onClick={() => openModal("returns")}
                      className="text-xs text-brand-600 hover:text-brand-800 font-semibold"
                    >
                      عرض باقي المرتجعات ({returnedByProduct.size - 5} متبقٍ) ←
                    </button>
                  </div>
                )}
              </div>
            )}
          </CardBody>
        </Card>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[1.5fr_1fr] gap-4 items-stretch">
        <Card className="flex flex-col h-full">
          <CardHeader
            title="مقترحات إعادة الطلب"
            subtitle="القطع التي وصلت للحد الأدنى أو نفدت"
            actions={
              <div className="flex items-center gap-2">
                <Button size="sm" variant="outline" className="gap-1 border-brand-200 text-brand-700 hover:bg-brand-50" onClick={() => setPrintTarget("reorder")}>
                  <Printer className="w-3.5 h-3.5" />طباعة الكشف
                </Button>
                {reorderRows.length > 5 && (
                  <Button size="sm" variant="ghost" className="text-xs text-brand-600 font-medium hover:bg-brand-50" onClick={() => openModal("reorder")}>
                    المزيد ({reorderRows.length})
                  </Button>
                )}
              </div>
            }
          />
          <CardBody className="flex-1 flex flex-col justify-between">
            {reorderRows.length === 0 ? (
              <EmptyState icon={<ShieldCheck className="w-5 h-5" />} title="المخزون في حالة جيدة" />
            ) : (
              <div className="flex-1 flex flex-col justify-between">
                <Table>
                  <THead>
                    <TR>
                      <TH>رقم القطعة</TH>
                      <TH>الصنف</TH>
                      <TH>الموقع</TH>
                      <TH className="text-end">الحالي</TH>
                      <TH className="text-end">الحد الأدنى</TH>
                      <TH className="text-end">المقترح طلبه</TH>
                    </TR>
                  </THead>
                  <TBody>
                    {reorderRows.slice(0, 5).map(({ product, suggested }) => (
                      <TR key={product.id}>
                        <TD className="font-mono text-xs" dir="ltr">{product.partNumber || product.code}</TD>
                        <TD>
                          <div className="font-medium">{product.name}</div>
                          <div className="text-[11px] text-ink-faint" dir="ltr">{product.partBrand || "—"}</div>
                        </TD>
                        <TD className="font-mono text-xs" dir="ltr">{product.rackLocation || "—"}</TD>
                        <TD className="text-end"><Badge tone={product.quantity <= 0 ? "red" : "amber"}>{product.quantity}</Badge></TD>
                        <TD className="text-end">{product.minStock}</TD>
                        <TD className="text-end font-bold text-brand-700">{suggested}</TD>
                      </TR>
                    ))}
                  </TBody>
                </Table>
                {reorderRows.length > 5 && (
                  <div className="pt-3 text-center border-t border-line-soft mt-auto">
                    <button
                      onClick={() => openModal("reorder")}
                      className="text-xs text-brand-600 hover:text-brand-800 font-semibold"
                    >
                      عرض باقي مقترحات إعادة الطلب ({reorderRows.length - 5} متبقٍ) ←
                    </button>
                  </div>
                )}
              </div>
            )}
          </CardBody>
        </Card>

        <Card className="flex flex-col h-full">
          <CardHeader
            title="أعلى ماركات القطع قيمةً"
            subtitle="حسب قيمة تكلفة المخزون الحالية"
            actions={
              allBrands.length > 5 ? (
                <Button size="sm" variant="ghost" className="text-xs text-brand-600 font-medium hover:bg-brand-50" onClick={() => openModal("brands")}>
                  المزيد ({allBrands.length})
                </Button>
              ) : undefined
            }
          />
          <CardBody className="flex-1 flex flex-col justify-between">
            <div className="space-y-2">
              {brands.map((row, index) => (
                <div key={row.brand} className="rounded-lg border border-line p-3">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <span className="text-xs text-ink-faint me-2">#{index + 1}</span>
                      <span className="font-semibold" dir="ltr">{row.brand}</span>
                    </div>
                    <span className="font-bold">{formatCurrency(row.value, settings.currency)}</span>
                  </div>
                  <div className="mt-1 text-xs text-ink-muted">{row.count} صنف · {row.quantity} وحدة</div>
                </div>
              ))}
            </div>
            {allBrands.length > 5 && (
              <div className="pt-2 text-center border-t border-line-soft mt-auto">
                <button
                  onClick={() => openModal("brands")}
                  className="text-xs text-brand-600 hover:text-brand-800 font-semibold"
                >
                  عرض باقي الماركات ({allBrands.length - 5} متبقٍ) ←
                </button>
              </div>
            )}
          </CardBody>
        </Card>
      </div>

      <Card>
        <CardHeader
          title="اكتمال بيانات قطع الغيار"
          subtitle={`الأصناف التي تحتاج استكمال بيانات قبل الاعتماد على دليل السيارة (${incompleteProducts.length} صنف)`}
          actions={
            incompleteProducts.length > 5 ? (
              <Button size="sm" variant="ghost" className="text-xs text-brand-600 font-medium hover:bg-brand-50" onClick={() => openModal("completion")}>
                المزيد ({incompleteProducts.length})
              </Button>
            ) : undefined
          }
        />
        <CardBody>
          <Table>
            <THead>
              <TR>
                <TH>رقم القطعة</TH>
                <TH>الصنف</TH>
                <TH>التوافق</TH>
                <TH>موقع الرف</TH>
                <TH>OEM</TH>
                <TH>الضمان</TH>
              </TR>
            </THead>
            <TBody>
              {incompleteProducts.slice(0, 5).map((product) => (
                <TR key={product.id}>
                  <TD className="font-mono text-xs" dir="ltr">{product.partNumber || product.code}</TD>
                  <TD className="font-medium">{product.name}</TD>
                  <TD><Badge tone={fittedProductIds.has(product.id) ? "green" : "rose"}>{fittedProductIds.has(product.id) ? "مربوط" : "ناقص"}</Badge></TD>
                  <TD><Badge tone={product.rackLocation ? "green" : "amber"}>{product.rackLocation || "ناقص"}</Badge></TD>
                  <TD><Badge tone={product.oemNumbers?.length ? "green" : "amber"}>{product.oemNumbers?.length || "ناقص"}</Badge></TD>
                  <TD>{product.warrantyMonths ? `${product.warrantyMonths} شهر` : "—"}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
          {incompleteProducts.length > 5 && (
            <div className="pt-3 text-center border-t border-line-soft">
              <button
                onClick={() => openModal("completion")}
                className="text-xs text-brand-600 hover:text-brand-800 font-semibold"
              >
                عرض كافة الأصناف الناقصة البيانات ({incompleteProducts.length - 5} متبقٍ) ←
              </button>
            </div>
          )}
        </CardBody>
      </Card>

      {/* POPUP Dialogs for Detail Views */}
      {reportModal === "stagnant" && (
        <Dialog
          open={true}
          onClose={() => setReportModal(null)}
          title="كشف المخزون الراكد (أصناف لم تتحرك خلال 90 يومًا)"
          subtitle={`إجمالي ${deadStock.length} صنف بقيمة تكلفة ${formatCurrency(deadStock.reduce((s, p) => s + p.quantity * (p.avgCost ?? p.purchasePrice), 0), settings.currency)}`}
          width="2xl"
        >
          <div className="overflow-x-auto max-h-[65vh] p-1">
            <Table>
              <THead>
                <TR>
                  <TH className="w-12">م</TH>
                  <TH>رقم القطعة / الكود</TH>
                  <TH>اسم الصنف</TH>
                  <TH className="text-end">الكمية الراكدة</TH>
                  <TH className="text-end">تكلفة الوحدة</TH>
                  <TH className="text-end">إجمالي القيمة</TH>
                </TR>
              </THead>
              <TBody>
                {deadStock.slice(0, modalLimit).map((p, idx) => (
                  <TR key={p.id}>
                    <TD className="text-xs text-ink-faint">{idx + 1}</TD>
                    <TD className="font-mono text-xs" dir="ltr">{p.partNumber || p.code}</TD>
                    <TD className="font-semibold text-ink text-sm">{p.name}</TD>
                    <TD className="text-end"><Badge tone="amber">{p.quantity} وحدة</Badge></TD>
                    <TD className="text-end font-mono text-xs">{formatCurrency(p.avgCost ?? p.purchasePrice, settings.currency)}</TD>
                    <TD className="text-end font-mono font-bold text-ink text-sm">{formatCurrency(p.quantity * (p.avgCost ?? p.purchasePrice), settings.currency)}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
            {deadStock.length > modalLimit && (
              <div className="p-3 text-center border-t border-line mt-2">
                <button
                  onClick={() => setModalLimit((prev) => prev + 50)}
                  className="px-4 py-1.5 text-xs text-brand-600 hover:text-brand-800 font-semibold bg-brand-500/10 hover:bg-brand-500/20 rounded-lg transition-colors"
                >
                  تحميل المزيد ({deadStock.length - modalLimit} متبقٍ)
                </button>
              </div>
            )}
          </div>
        </Dialog>
      )}

      {reportModal === "returns" && (
        <Dialog
          open={true}
          onClose={() => setReportModal(null)}
          title="كشف مراقبة مرتجعات قطع الغيار"
          subtitle={`إجمالي ${returnedByProduct.size} صنف تم إرجاعها خلال الفترة`}
          width="2xl"
        >
          <div className="overflow-x-auto max-h-[65vh] p-1">
            <Table>
              <THead>
                <TR>
                  <TH className="w-12">م</TH>
                  <TH>رقم القطعة / الكود</TH>
                  <TH>اسم الصنف</TH>
                  <TH className="text-end">الكمية المرتجعة</TH>
                </TR>
              </THead>
              <TBody>
                {[...returnedByProduct.entries()]
                  .sort((a, b) => b[1] - a[1])
                  .slice(0, modalLimit)
                  .map(([productId, quantity], idx) => {
                    const product = productById.get(productId);
                    return (
                      <TR key={productId}>
                        <TD className="text-xs text-ink-faint">{idx + 1}</TD>
                        <TD className="font-mono text-xs" dir="ltr">{product?.partNumber || product?.code || productId}</TD>
                        <TD className="font-semibold text-ink text-sm">{product?.name || "منتج محذوف"}</TD>
                        <TD className="text-end"><Badge tone="rose">{quantity} مرتجع</Badge></TD>
                      </TR>
                    );
                  })}
              </TBody>
            </Table>
            {returnedByProduct.size > modalLimit && (
              <div className="p-3 text-center border-t border-line mt-2">
                <button
                  onClick={() => setModalLimit((prev) => prev + 50)}
                  className="px-4 py-1.5 text-xs text-brand-600 hover:text-brand-800 font-semibold bg-brand-500/10 hover:bg-brand-500/20 rounded-lg transition-colors"
                >
                  تحميل المزيد ({returnedByProduct.size - modalLimit} متبقٍ)
                </button>
              </div>
            )}
          </div>
        </Dialog>
      )}

      {reportModal === "reorder" && (
        <Dialog
          open={true}
          onClose={() => setReportModal(null)}
          title="كشف مقترحات إعادة الطلب والنواقص الكامل"
          subtitle={`إجمالي ${reorderRows.length} صنف يحتاج لإعادة الطلب`}
          width="2xl"
        >
          <div className="overflow-x-auto max-h-[65vh] p-1">
            <Table>
              <THead>
                <TR>
                  <TH>رقم القطعة</TH>
                  <TH>الصنف والماركة</TH>
                  <TH>الموقع</TH>
                  <TH className="text-end">الحالي</TH>
                  <TH className="text-end">الحد الأدنى</TH>
                  <TH className="text-end">المقترح طلبه</TH>
                </TR>
              </THead>
              <TBody>
                {reorderRows.slice(0, modalLimit).map(({ product, suggested }) => (
                  <TR key={product.id}>
                    <TD className="font-mono text-xs" dir="ltr">{product.partNumber || product.code}</TD>
                    <TD>
                      <div className="font-semibold text-ink text-sm">{product.name}</div>
                      <div className="text-[11px] text-ink-faint" dir="ltr">{product.partBrand || "—"}</div>
                    </TD>
                    <TD className="font-mono text-xs" dir="ltr">{product.rackLocation || "—"}</TD>
                    <TD className="text-end"><Badge tone={product.quantity <= 0 ? "red" : "amber"}>{product.quantity}</Badge></TD>
                    <TD className="text-end text-sm">{product.minStock}</TD>
                    <TD className="text-end font-bold text-brand-700 text-sm">{suggested}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
            {reorderRows.length > modalLimit && (
              <div className="p-3 text-center border-t border-line mt-2">
                <button
                  onClick={() => setModalLimit((prev) => prev + 50)}
                  className="px-4 py-1.5 text-xs text-brand-600 hover:text-brand-800 font-semibold bg-brand-500/10 hover:bg-brand-500/20 rounded-lg transition-colors"
                >
                  تحميل المزيد ({reorderRows.length - modalLimit} متبقٍ)
                </button>
              </div>
            )}
          </div>
        </Dialog>
      )}

      {reportModal === "brands" && (
        <Dialog
          open={true}
          onClose={() => setReportModal(null)}
          title="أعلى ماركات القطع قيمةً - القائمة الكاملة"
          subtitle={`إجمالي ${allBrands.length} ماركة قطع غيار متوفرة بالمخزون`}
          width="xl"
        >
          <div className="overflow-x-auto max-h-[65vh] p-1">
            <Table>
              <THead>
                <TR>
                  <TH className="w-12">م</TH>
                  <TH>الماركة</TH>
                  <TH className="text-center">عدد الأصناف</TH>
                  <TH className="text-center">إجمالي الوحدات</TH>
                  <TH className="text-end">إجمالي القيمة التقديرية</TH>
                </TR>
              </THead>
              <TBody>
                {allBrands.slice(0, modalLimit).map((row, idx) => (
                  <TR key={row.brand}>
                    <TD className="text-xs text-ink-faint">#{idx + 1}</TD>
                    <TD className="font-semibold text-ink text-sm" dir="ltr">{row.brand}</TD>
                    <TD className="text-center text-xs">{row.count} صنف</TD>
                    <TD className="text-center text-xs">{row.quantity} وحدة</TD>
                    <TD className="text-end font-mono font-bold text-ink text-sm">{formatCurrency(row.value, settings.currency)}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
            {allBrands.length > modalLimit && (
              <div className="p-3 text-center border-t border-line mt-2">
                <button
                  onClick={() => setModalLimit((prev) => prev + 50)}
                  className="px-4 py-1.5 text-xs text-brand-600 hover:text-brand-800 font-semibold bg-brand-500/10 hover:bg-brand-500/20 rounded-lg transition-colors"
                >
                  تحميل المزيد ({allBrands.length - modalLimit} متبقٍ)
                </button>
              </div>
            )}
          </div>
        </Dialog>
      )}

      {reportModal === "completion" && (
        <Dialog
          open={true}
          onClose={() => setReportModal(null)}
          title="أصناف محتاجة لاستكمال البيانات"
          subtitle={`إجمالي ${incompleteProducts.length} صنف ناقصة في التوافق أو موقع الرف أو أرقام OEM`}
          width="2xl"
        >
          <div className="overflow-x-auto max-h-[65vh] p-1">
            <Table>
              <THead>
                <TR>
                  <TH>رقم القطعة</TH>
                  <TH>الصنف</TH>
                  <TH>التوافق</TH>
                  <TH>موقع الرف</TH>
                  <TH>OEM</TH>
                  <TH>الضمان</TH>
                </TR>
              </THead>
              <TBody>
                {incompleteProducts.slice(0, modalLimit).map((product) => (
                  <TR key={product.id}>
                    <TD className="font-mono text-xs" dir="ltr">{product.partNumber || product.code}</TD>
                    <TD className="font-semibold text-ink text-sm">{product.name}</TD>
                    <TD><Badge tone={fittedProductIds.has(product.id) ? "green" : "rose"}>{fittedProductIds.has(product.id) ? "مربوط" : "ناقص"}</Badge></TD>
                    <TD><Badge tone={product.rackLocation ? "green" : "amber"}>{product.rackLocation || "ناقص"}</Badge></TD>
                    <TD><Badge tone={product.oemNumbers?.length ? "green" : "amber"}>{product.oemNumbers?.length || "ناقص"}</Badge></TD>
                    <TD className="text-xs">{product.warrantyMonths ? `${product.warrantyMonths} شهر` : "—"}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
            {incompleteProducts.length > modalLimit && (
              <div className="p-3 text-center border-t border-line mt-2">
                <button
                  onClick={() => setModalLimit((prev) => prev + 50)}
                  className="px-4 py-1.5 text-xs text-brand-600 hover:text-brand-800 font-semibold bg-brand-500/10 hover:bg-brand-500/20 rounded-lg transition-colors"
                >
                  تحميل المزيد ({incompleteProducts.length - modalLimit} متبقٍ)
                </button>
              </div>
            )}
          </div>
        </Dialog>
      )}
    </>
  );
}

function ReportStat({ icon, label, value, tone }: { icon: React.ReactNode; label: string; value: string; tone: "blue" | "amber" | "rose" | "slate" | "green" }) {
  const colors = { blue: "text-blue-600 bg-blue-50 dark:bg-blue-500/10", amber: "text-amber-600 bg-amber-50 dark:bg-amber-500/10", rose: "text-rose-600 bg-rose-50 dark:bg-rose-500/10", slate: "text-ink-muted bg-surface-muted", green: "text-emerald-600 bg-emerald-50 dark:bg-emerald-500/10" };
  return <Card><CardBody className="flex items-center gap-3"><div className={`w-10 h-10 rounded-lg grid place-items-center ${colors[tone]}`}>{icon}</div><div><div className="text-xs text-ink-muted">{label}</div><div className="text-xl font-bold mt-0.5">{value}</div></div></CardBody></Card>;
}

function PrintableReportView({
  target,
  onClose,
  deadStock,
  returnedByProduct,
  productById,
  reorderRows,
  currency,
}: {
  target: "stagnant" | "returns" | "reorder";
  onClose: () => void;
  deadStock: any[];
  returnedByProduct: Map<string, number>;
  productById: Map<string, any>;
  reorderRows: any[];
  currency: string;
}) {
  function downloadXlsx() {
    let headers: string[] = [];
    let rows: any[][] = [];
    let fileName = "";
    
    if (target === "stagnant") {
      fileName = "تقرير_المخزون_الراكد";
      headers = ["م", "رقم القطعة/الكود", "اسم الصنف", "الكمية", "تكلفة الوحدة", "إجمالي القيمة التقديرية"];
      rows = deadStock.map((p, idx) => [
        idx + 1,
        p.partNumber || p.code,
        p.name,
        p.quantity,
        p.avgCost ?? p.purchasePrice,
        p.quantity * (p.avgCost ?? p.purchasePrice)
      ]);
      const totalVal = deadStock.reduce((s, p) => s + p.quantity * (p.avgCost ?? p.purchasePrice), 0);
      const totalQty = deadStock.reduce((s, p) => s + p.quantity, 0);
      rows.push(["", "الإجمالي", "", totalQty, "", totalVal]);
    } else if (target === "returns") {
      fileName = "تقرير_مراقبة_المرتجعات";
      headers = ["م", "رقم القطعة/الكود", "اسم الصنف", "الكمية المرتجعة"];
      rows = [...returnedByProduct.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([productId, qty], idx) => {
          const p = productById.get(productId);
          return [
            idx + 1,
            p?.partNumber || p?.code || productId,
            p?.name || "منتج محذوف",
            qty
          ];
        });
    } else if (target === "reorder") {
      fileName = "تقرير_مقترحات_إعادة_الطلب";
      headers = ["م", "رقم القطعة/الكود", "اسم الصنف", "الماركة", "الموقع", "المخزون الحالي", "الحد الأدنى", "المقترح طلبه"];
      rows = reorderRows.map(({ product: p, suggested }, idx) => [
        idx + 1,
        p.partNumber || p.code,
        p.name,
        p.partBrand || "",
        p.rackLocation || "",
        p.quantity,
        p.minStock,
        suggested
      ]);
    }
    
    const bytes = buildXlsx([{ name: "التقرير", headers, rows }]);
    const blob = new Blob([bytes], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${fileName}_${new Date().toLocaleDateString("en-CA")}.xlsx`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const printDate = new Date().toLocaleDateString("ar-EG", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  return (
    <div className="min-h-screen bg-canvas py-8 px-4 print:p-0 print:bg-surface" dir="rtl">
      <style
        dangerouslySetInnerHTML={{
          __html: `
          @media print {
            @page { size: A4 portrait; margin: 15mm; }
            body { background: white; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
            .no-print { display: none !important; }
            .report-page { box-shadow: none !important; border-radius: 0 !important; border: none !important; }
          }
          @media screen { .report-page { max-width: 210mm; } }
        `,
        }}
      />

      <div className="no-print max-w-[210mm] mx-auto flex items-center justify-between mb-4">
        <button
          onClick={onClose}
          className="text-sm text-ink-muted hover:text-ink flex items-center gap-1.5 bg-surface border border-line rounded-lg px-3 h-9"
        >
          ← رجوع للتقارير
        </button>
        <div className="flex gap-2">
          <button
            onClick={downloadXlsx}
            className="h-9 px-4 bg-emerald-600 text-white rounded-lg text-sm font-medium hover:bg-emerald-700 flex items-center gap-1.5"
          >
            <Download className="w-4 h-4" />
            تنزيل Excel
          </button>
          <button
            onClick={() => window.print()}
            className="h-9 px-5 bg-blue-700 text-white rounded-lg text-sm font-medium hover:bg-blue-800 flex items-center gap-1.5"
          >
            <Printer className="w-4 h-4" />
            طباعة الكشف (PDF)
          </button>
        </div>
      </div>

      <div className="report-page mx-auto bg-surface border border-line rounded-2xl p-8 shadow-sm">
        <div className="flex items-start justify-between border-b pb-6 mb-6">
          <div>
            <h1 className="text-xl font-black text-ink font-bold">
              {target === "stagnant" && "تقرير المخزون الراكد"}
              {target === "returns" && "تقرير مراقبة مرتجعات قطع الغيار"}
              {target === "reorder" && "تقرير النواقص ومقترحات إعادة الطلب"}
            </h1>
            <p className="text-xs text-ink-muted mt-1">نظام إدارة قطع الغيار والمبيعات</p>
          </div>
          <div className="text-left">
            <div className="text-xs text-ink-faint">تاريخ التقرير</div>
            <div className="text-sm font-bold text-ink mt-0.5">{printDate}</div>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-right border-collapse">
            <thead>
              <tr className="border-b border-line/80 text-xs font-bold text-ink-muted bg-surface-muted/50">
                <th className="py-2.5 px-3">م</th>
                <th className="py-2.5 px-3">الكود / رقم القطعة</th>
                <th className="py-2.5 px-3">اسم الصنف</th>
                {target === "reorder" && <th className="py-2.5 px-3">الماركة</th>}
                {target === "reorder" && <th className="py-2.5 px-3">الموقع</th>}
                {target === "stagnant" && <th className="py-2.5 px-3 text-end">الكمية الراكدة</th>}
                {target === "stagnant" && <th className="py-2.5 px-3 text-end">تكلفة الوحدة</th>}
                {target === "stagnant" && <th className="py-2.5 px-3 text-end">إجمالي التكلفة</th>}
                {target === "returns" && <th className="py-2.5 px-3 text-end">الكمية المرتجعة</th>}
                {target === "reorder" && <th className="py-2.5 px-3 text-end">المخزون الحالي</th>}
                {target === "reorder" && <th className="py-2.5 px-3 text-end">الحد الأدنى</th>}
                {target === "reorder" && <th className="py-2.5 px-3 text-end">الطلب المقترح</th>}
              </tr>
            </thead>
            <tbody className="text-sm divide-y divide-line/40">
              {target === "stagnant" && deadStock.map((p, idx) => (
                <tr key={p.id} className="hover:bg-slate-50/50">
                  <td className="py-3 px-3 text-ink-muted text-xs">{idx + 1}</td>
                  <td className="py-3 px-3 font-mono text-xs" dir="ltr">{p.partNumber || p.code}</td>
                  <td className="py-3 px-3 font-medium text-ink">{p.name}</td>
                  <td className="py-3 px-3 text-end font-semibold">{p.quantity}</td>
                  <td className="py-3 px-3 text-end font-mono">{formatCurrency(p.avgCost ?? p.purchasePrice, currency)}</td>
                  <td className="py-3 px-3 text-end font-semibold font-mono">{formatCurrency(p.quantity * (p.avgCost ?? p.purchasePrice), currency)}</td>
                </tr>
              ))}

              {target === "returns" && [...returnedByProduct.entries()]
                .sort((a, b) => b[1] - a[1])
                .map(([productId, qty], idx) => {
                  const p = productById.get(productId);
                  return (
                    <tr key={productId} className="hover:bg-slate-50/50">
                      <td className="py-3 px-3 text-ink-muted text-xs">{idx + 1}</td>
                      <td className="py-3 px-3 font-mono text-xs" dir="ltr">{p?.partNumber || p?.code || productId}</td>
                      <td className="py-3 px-3 font-medium text-ink">{p?.name || "منتج محذوف"}</td>
                      <td className="py-3 px-3 text-end font-semibold">{qty}</td>
                    </tr>
                  );
                })}

              {target === "reorder" && reorderRows.map(({ product: p, suggested }, idx) => (
                <tr key={p.id} className="hover:bg-slate-50/50">
                  <td className="py-3 px-3 text-ink-muted text-xs">{idx + 1}</td>
                  <td className="py-3 px-3 font-mono text-xs" dir="ltr">{p.partNumber || p.code}</td>
                  <td className="py-3 px-3 font-medium text-ink">{p.name}</td>
                  <td className="py-3 px-3 text-xs" dir="ltr">{p.partBrand || "—"}</td>
                  <td className="py-3 px-3 text-xs font-mono" dir="ltr">{p.rackLocation || "—"}</td>
                  <td className="py-3 px-3 text-end font-semibold">{p.quantity}</td>
                  <td className="py-3 px-3 text-end text-ink-muted">{p.minStock}</td>
                  <td className="py-3 px-3 text-end font-bold text-brand-700">{suggested}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {target === "stagnant" && (
          <div className="mt-6 flex justify-end gap-6 text-sm border-t pt-4">
            <div>
              <span className="text-ink-muted">إجمالي الأصناف الراكدة: </span>
              <strong className="text-ink">{deadStock.length} صنف</strong>
            </div>
            <div>
              <span className="text-ink-muted">إجمالي التكلفة الراكدة: </span>
              <strong className="text-rose-700 font-mono">
                {formatCurrency(deadStock.reduce((s, p) => s + p.quantity * (p.avgCost ?? p.purchasePrice), 0), currency)}
              </strong>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
