import { useMemo, useState } from "react";
import {
  Download,
  Printer,
  Eye,
  TrendingUp,
  TrendingDown,
  Coins,
  UserRound,
  HandCoins,
  FileDown,
  MessageCircle,
  Landmark,
  PackageSearch,
} from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import {
  BarChart,
  Bar,
  LineChart,
  Line,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Legend,
} from "recharts";
import { AutoPartsHero } from "../components/AutoPartsHero";
import { Card, CardBody, CardHeader } from "../components/ui/Card";
import { Button } from "../components/ui/Button";
import { Badge } from "../components/ui/Badge";
import { Input, Field, Select } from "../components/ui/Input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../components/ui/Tabs";
import { Table, TBody, TD, TH, THead, TR } from "../components/ui/Table";
import { useCatalog } from "../store/CatalogContext";
import { useUsers } from "../store/UsersContext";
import { useInvoicing } from "../store/InvoicingContext";
import { useReporting } from "../store/ReportingContext";
import { useAuth } from "../store/AuthContext";
import { useSettings } from "../store/SettingsContext";
import { useToast } from "../components/ui/Toast";
import { useFeatures } from "../lib/useFeatures";
import { formatCurrency, formatDate } from "../lib/format";
import { daysUntil, getMonthsInRange, inRange, localISODate, todayISO } from "../lib/utils";
import { downloadXlsxFile } from "../lib/xlsx";
import { employeeCollectedCash } from "../store/_pure";
import type { Product, Customer, Supplier, PurchaseInvoice } from "../types";

type SupplierPayableRow = {
  supplierId: string;
  supplierName: string;
  supplierCode?: string;
  phone?: string;
  invoiceCount: number;
  total: number;
  paid: number;
  remaining: number;
  oldestDate: string;
};
type MonthlyProfitRow = { month: string; sales: number; purchases: number; profit: number };
type CommissionRow = { tierId: string; threshold: number; periodDays: number; totalPurchases: number; earned: number };

type PrintMode =
  | "full"
  | "sales"
  | "purchases"
  | "stock"
  | "customers"
  | "suppliers"
  | "supplierDues"
  | "commissions"
  | "monthlyProfit"
  | "customerDues";

export function ReportsPage() {
  const { isEnabled } = useFeatures();
  const whatsappEnabled = isEnabled("whatsappIntegration");
  const expiryTrackingEnabled = isEnabled("expiryTracking");
  const excelExportEnabled = isEnabled("excelExport");
  const { products, customers, suppliers } = useCatalog();
  const { users } = useUsers();
  const { salesInvoices, purchaseInvoices, salesReturns, cashEntries } = useInvoicing();
  const { settings } = useSettings();
  const {
    customerBalance,
    supplierBalance,
    calculateSupplierCommission,
    exportToExcel,
  } = useReporting();
  const { currentUser } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();

  const [from, setFrom] = useState<string>(() => {
    const d = new Date();
    d.setDate(d.getDate() - 30);
    return localISODate(d);
  });
  const [to, setTo] = useState<string>(() => todayISO());
  const [printMode, setPrintMode] = useState<PrintMode>("full");
  const [previewOpen, setPreviewOpen] = useState(false);
  const canViewEmployeeBonuses = currentUser?.role === "owner";

  const salesInRange = useMemo(
    () => salesInvoices.filter((s) => !s.cancelled && inRange(s.date, from, to)),
    [salesInvoices, from, to]
  );
  const purchasesInRange = useMemo(
    () => purchaseInvoices.filter((p) => inRange(p.date, from, to)),
    [purchaseInvoices, from, to]
  );

  const invoiceById = useMemo(
    () => new Map(salesInvoices.map((s) => [s.id, s])),
    [salesInvoices]
  );

  // OBS-01: returns reverse revenue and profit. Returns on cancelled invoices
  // are excluded because the cancellation already reversed the whole invoice.
  const salesReturnsInRange = useMemo(
    () =>
      salesReturns.filter(
        (r) => inRange(r.date, from, to) && !invoiceById.get(r.originalInvoiceId)?.cancelled
      ),
    [salesReturns, from, to, invoiceById]
  );

  // Cost of a returned line: original invoice line (by sourceLineId, then by
  // product), falling back to the product's current purchase price.
  const returnLineCost = (originalInvoiceId: string, rl: { sourceLineId?: string; productId: string }) => {
    const orig = invoiceById.get(originalInvoiceId);
    const origLine =
      orig?.lines.find((l) => l.id === rl.sourceLineId) ??
      orig?.lines.find((l) => l.productId === rl.productId);
    const prod = products.find((x) => x.id === rl.productId);
    return origLine?.costPrice ?? prod?.avgCost ?? prod?.purchasePrice ?? 0;
  };

  const returnsTotalInRange = salesReturnsInRange.reduce((a, r) => a + r.total, 0);
  const returnsByPriceType = salesReturnsInRange.reduce(
    (acc, r) => {
      const type = invoiceById.get(r.originalInvoiceId)?.priceType === "retail" ? "retail" : "wholesale";
      acc[type] += r.total;
      return acc;
    },
    { wholesale: 0, retail: 0 }
  );

  // Gross sales = sum of invoice totals (already net of invoice-level discounts).
  const grossSalesInRange = salesInRange.reduce((a, s) => a + s.total, 0);
  // Net sales: returns in the period are deducted.
  const totalSales = grossSalesInRange - returnsTotalInRange;
  const totalPurchases = purchasesInRange.reduce((a, p) => a + p.total, 0);
  // Cash collected and still outstanding for invoices in the period.
  const collectedInRange = salesInRange.reduce((a, s) => a + s.amountReceived, 0);
  const remainingInRange = salesInRange.reduce((a, s) => a + s.remaining, 0);
  const wholesaleSalesTotal =
    salesInRange
      .filter((s) => s.priceType === "wholesale")
      .reduce((a, s) => a + s.total, 0) - returnsByPriceType.wholesale;
  const retailSalesTotal =
    salesInRange
      .filter((s) => s.priceType === "retail")
      .reduce((a, s) => a + s.total, 0) - returnsByPriceType.retail;

  const totalCommissions = useMemo(() => {
    return suppliers.reduce((sum, s) => {
      const comms = calculateSupplierCommission(s.id);
      return sum + comms.reduce((a, c) => a + c.earned, 0);
    }, 0);
  }, [suppliers, calculateSupplierCommission]);

  // OBS-01: estimated GROSS profit = Σ(line price − cost) − invoice discounts
  // − profit reversed by returns in the period.
  const estimatedProfit = useMemo(() => {
    let p = 0;
    salesInRange.forEach((inv) => {
      inv.lines.forEach((l) => {
        const costProd = products.find((x) => x.id === l.productId);
        const cost = l.costPrice ?? costProd?.avgCost ?? costProd?.purchasePrice ?? 0;
        p += (l.price - cost) * l.quantity;
      });
      p -= inv.discount ?? 0;
    });
    salesReturnsInRange.forEach((r) => {
      r.lines.forEach((rl) => {
        p -= (rl.price - returnLineCost(r.originalInvoiceId, rl)) * rl.quantity;
      });
    });
    return p;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [salesInRange, salesReturnsInRange, invoiceById, products]);

  const monthlyProfitData = useMemo(() => {
    const map = new Map<string, { month: string; sales: number; purchases: number; profit: number }>();
    const entryOf = (key: string) =>
      map.get(key) ?? { month: key, sales: 0, purchases: 0, profit: 0 };
    salesInvoices.filter((s) => !s.cancelled).forEach((s) => {
      const entry = entryOf(s.date.slice(0, 7));
      entry.sales += s.total;
      let invProfit = -(s.discount ?? 0);
      s.lines.forEach((l) => {
        const costProd = products.find((x) => x.id === l.productId);
        const cost = l.costPrice ?? costProd?.avgCost ?? costProd?.purchasePrice ?? 0;
        invProfit += (l.price - cost) * l.quantity;
      });
      entry.profit += invProfit;
      map.set(entry.month, entry);
    });
    salesReturns.forEach((r) => {
      if (invoiceById.get(r.originalInvoiceId)?.cancelled) return;
      const entry = entryOf(r.date.slice(0, 7));
      entry.sales -= r.total;
      r.lines.forEach((rl) => {
        entry.profit -= (rl.price - returnLineCost(r.originalInvoiceId, rl)) * rl.quantity;
      });
      map.set(entry.month, entry);
    });
    purchaseInvoices.forEach((p) => {
      const entry = entryOf(p.date.slice(0, 7));
      entry.purchases += p.total;
      map.set(entry.month, entry);
    });
    return Array.from(map.values()).sort((a, b) => a.month.localeCompare(b.month));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [salesInvoices, salesReturns, purchaseInvoices, invoiceById, products]);

  const monthlyTotals = useMemo(
    () =>
      monthlyProfitData.reduce(
        (acc, m) => ({
          sales: acc.sales + m.sales,
          purchases: acc.purchases + m.purchases,
          profit: acc.profit + m.profit,
        }),
        { sales: 0, purchases: 0, profit: 0 }
      ),
    [monthlyProfitData]
  );

  const employeeBonusRows = useMemo(() => {
    const months = getMonthsInRange(from, to);
    return users
      .filter((user) => user.role === "employee")
      .map((employee) => {
        const invoices = salesInRange.filter((invoice) => invoice.createdByUserId === employee.id);
        const employeeTotalSales = invoices.reduce((sum, invoice) => sum + invoice.total, 0);

        // Calculate commission month-by-month to respect per-month rates
        let bonus = 0;
        let totalTarget = 0;
        const hasMonthlyConfigs = employee.monthlyConfigs && Object.keys(employee.monthlyConfigs).length > 0;
        const collected = employeeCollectedCash(salesInvoices, salesReturns, cashEntries, employee.id, from, to);

        if (hasMonthlyConfigs) {
          months.forEach((m) => {
            const [yr, mn] = m.split("-").map(Number);
            const mStart = localISODate(new Date(yr, mn - 1, 1));
            const mEnd = localISODate(new Date(yr, mn, 0));
            const mFrom = mStart < from ? from : mStart;
            const mTo = mEnd > to ? to : mEnd;
            const cfg = employee.monthlyConfigs?.[m];
            const mPct = cfg?.commissionPct ?? employee.salesCommissionPct ?? 0;
            const mTarget = cfg?.target ?? employee.monthlySalesTarget ?? 0;
            const mCollected = employeeCollectedCash(salesInvoices, salesReturns, cashEntries, employee.id, mFrom, mTo);
            bonus += (mCollected * mPct) / 100;
            totalTarget += mTarget;
          });
        } else {
          const commissionPct = employee.salesCommissionPct ?? 0;
          bonus = (collected * commissionPct) / 100;
          totalTarget = (employee.monthlySalesTarget ?? 0) * months.length;
        }

        const salary = employee.monthlySalary ?? 0;
        const effectivePct = collected > 0 ? (bonus / collected) * 100 : (employee.salesCommissionPct ?? 0);
        const remainingTarget = totalTarget > 0 ? Math.max(0, totalTarget - employeeTotalSales) : 0;
        const exceededTarget = totalTarget > 0 ? Math.max(0, employeeTotalSales - totalTarget) : 0;

        return {
          employee,
          invoiceCount: invoices.length,
          totalSales: employeeTotalSales,
          collected,
          commissionPct: effectivePct,
          bonus,
          salary,
          target: totalTarget,
          remainingTarget,
          exceededTarget,
          achievedTarget: totalTarget > 0 && employeeTotalSales >= totalTarget,
          totalEarnings: salary + bonus,
        };
      })
      .sort((a, b) => b.bonus - a.bonus || b.totalSales - a.totalSales);
  }, [users, salesInRange, salesInvoices, salesReturns, cashEntries, from, to]);

  const totalEmployeeBonuses = employeeBonusRows.reduce((sum, row) => sum + row.bonus, 0);
  const totalEmployeeSales = employeeBonusRows.reduce((sum, row) => sum + row.totalSales, 0);
  const employeesWithSales = employeeBonusRows.filter((row) => row.invoiceCount > 0).length;
  const employeesTargetAchieved = employeeBonusRows.filter((row) => row.achievedTarget).length;
  const unattributedEmployeeInvoices = salesInRange.filter((invoice) => !invoice.createdByUserId);
  const unattributedEmployeeSales = unattributedEmployeeInvoices.reduce((sum, invoice) => sum + invoice.total, 0);
  // Supplier bonuses are income the store EARNS from suppliers (they were
  // wrongly subtracted before); employee bonuses are an expense.
  const estimatedProfitAfterBonuses = estimatedProfit + totalCommissions - totalEmployeeBonuses;

  const totalReceivables = useMemo(
    () => customers.reduce((sum, c) => sum + Math.max(0, customerBalance(c.id)), 0),
    [customers, customerBalance]
  );

  const supplierLookup = useMemo(
    () => new Map(suppliers.map((supplier) => [supplier.id, supplier])),
    [suppliers]
  );

  const supplierDueInvoices = useMemo(
    () =>
      purchaseInvoices
        .filter((invoice) => invoice.remaining > 0)
        .sort((a, b) => {
          const byDate = a.date.localeCompare(b.date);
          return byDate !== 0 ? byDate : b.remaining - a.remaining;
        }),
    [purchaseInvoices]
  );

  const supplierPayableRows = useMemo(() => {
    const rows = new Map<
      string,
      {
        supplierId: string;
        supplierName: string;
        supplierCode?: string;
        phone?: string;
        invoiceCount: number;
        total: number;
        paid: number;
        remaining: number;
        oldestDate: string;
      }
    >();

    supplierDueInvoices.forEach((invoice) => {
      const supplier = supplierLookup.get(invoice.supplierId);
      const current = rows.get(invoice.supplierId) ?? {
        supplierId: invoice.supplierId,
        supplierName: invoice.supplierName,
        supplierCode: supplier?.code,
        phone: supplier?.phone,
        invoiceCount: 0,
        total: 0,
        paid: 0,
        remaining: 0,
        oldestDate: invoice.date,
      };

      current.invoiceCount += 1;
      current.total += invoice.total;
      current.paid += invoice.amountPaid;
      current.remaining += invoice.remaining;
      if (invoice.date < current.oldestDate) current.oldestDate = invoice.date;
      rows.set(invoice.supplierId, current);
    });

    return Array.from(rows.values()).sort((a, b) => b.remaining - a.remaining);
  }, [supplierDueInvoices, supplierLookup]);

  const supplierPayablesTotal = supplierDueInvoices.reduce((sum, invoice) => sum + invoice.remaining, 0);
  const supplierDuePaidTotal = supplierDueInvoices.reduce((sum, invoice) => sum + invoice.amountPaid, 0);
  const largestSupplierPayable = supplierPayableRows[0];
  const oldestSupplierDue = supplierDueInvoices[0];

  const dailyData = useMemo(() => {
    const map = new Map<string, { date: string; sales: number; purchases: number }>();
    const start = new Date(from);
    const end = new Date(to);
    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
      const iso = localISODate(d);
      map.set(iso, { date: iso.slice(5), sales: 0, purchases: 0 });
    }
    salesInRange.forEach((s) => {
      const key = s.date.slice(0, 10);
      const e = map.get(key);
      if (e) e.sales += s.total;
    });
    purchasesInRange.forEach((p) => {
      const key = p.date.slice(0, 10);
      const e = map.get(key);
      if (e) e.purchases += p.total;
    });
    return Array.from(map.values());
  }, [from, to, salesInRange, purchasesInRange]);

  const topProducts = useMemo(() => {
    const map = new Map<string, { name: string; partNumber?: string; partBrand?: string; qty: number; revenue: number; grossProfit: number }>();
    salesInRange.forEach((inv) => {
      inv.lines.forEach((l) => {
        const product = products.find((x) => x.id === l.productId);
        const e = map.get(l.productId) ?? { name: l.productName, partNumber: l.partNumber || product?.partNumber || product?.code, partBrand: l.partBrand || product?.partBrand, qty: 0, revenue: 0, grossProfit: 0 };
        const cost = l.costPrice ?? product?.avgCost ?? product?.purchasePrice ?? 0;
        e.qty += l.quantity;
        e.revenue += l.subtotal;
        e.grossProfit += (l.price - cost) * l.quantity;
        map.set(l.productId, e);
      });
    });
    return Array.from(map.values())
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 8);
  }, [salesInRange, products]);

  const categoryShare = useMemo(() => {
    const map = new Map<string, number>();
    salesInRange.forEach((inv) => {
      inv.lines.forEach((l) => {
        const prod = products.find((p) => p.id === l.productId);
        if (!prod) return;
        map.set(prod.category, (map.get(prod.category) ?? 0) + l.subtotal);
      });
    });
    return Array.from(map.entries()).map(([name, value]) => ({ name, value }));
  }, [salesInRange, products]);

  const PIE_COLORS = ["#3b82f6", "#10b981", "#f59e0b", "#8b5cf6", "#ef4444", "#14b8a6"];

  return (
    <>
      <div className="no-print">
        <AutoPartsHero
          icon={Landmark}
          title="التقارير المالية"
          description="صافي مبيعات وتوريد القطع، مجمل الربح، التحصيلات والمديونيات خلال الفترة. تقارير التوافق والفروع والضمان موجودة في شاشة تقارير قطع الغيار."
          actions={
            <>
              <Link to="/reports">
                <Button variant="outline" className="border-white/15 bg-white/10 text-white hover:bg-white/20">
                  <PackageSearch className="w-4 h-4" /> تقارير قطع الغيار
                </Button>
              </Link>
              {currentUser?.role === "owner" ? (
                <Button variant="outline" className="border-white/15 bg-white/10 text-white hover:bg-white/20" onClick={() => navigate("/reports/employees")}>
                  <UserRound className="w-4 h-4" /> تقرير الموظفين
                </Button>
              ) : null}
              <Button
                variant="outline"
                className="border-white/15 bg-white/10 text-white hover:bg-white/20"
                disabled={!excelExportEnabled}
                onClick={() => {
                  if (!excelExportEnabled) {
                    toast.error("ميزة غير متاحة", "تصدير Excel غير مفعل في الباقة الحالية");
                    return;
                  }
                  // Modes handled directly by exportToExcel (static data, no date range)
                  const contextModes = ["products", "customers", "suppliers", "sales", "purchases", "stock", "supplierDues", "customerDues", "commissions"] as const;
                  type ContextMode = typeof contextModes[number];

                  if (printMode === "full") {
                    toast.info("تصدير", "اختر تقريراً محدداً من القائمة للتصدير إلى Excel");
                    return;
                  }

                  if ((contextModes as readonly string[]).includes(printMode)) {
                    exportToExcel(printMode as ContextMode);
                    return;
                  }

                  // monthlyProfit: export the computed chart data (all months, no range filter)
                  if (printMode === "monthlyProfit") {
                    downloadXlsxFile(
                      {
                        name: "الربح الشهري",
                        headers: ["الشهر", "المبيعات", "المشتريات", "الربح"],
                        rows: monthlyProfitData.map((m) => [m.month, m.sales, m.purchases, m.profit]),
                      },
                      `monthly_profit_${todayISO()}`
                    );
                    return;
                  }

                  toast.info("تصدير", "هذا التقرير لا يدعم التصدير إلى Excel");
                }}
              >
                <Download className="w-4 h-4" /> تصدير
              </Button>
            </>
          }
        />
      </div>

      <div className="no-print">
        <Card>
          <CardBody className="flex flex-wrap gap-3 items-end">
            <Field label="من تاريخ">
              <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="w-44" />
            </Field>
            <Field label="إلى تاريخ">
              <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="w-44" />
            </Field>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={() => { const d=new Date(); d.setDate(d.getDate()-7); setFrom(localISODate(d)); setTo(todayISO());}}>
                آخر 7 أيام
              </Button>
              <Button variant="outline" size="sm" onClick={() => { const d=new Date(); d.setDate(d.getDate()-30); setFrom(localISODate(d)); setTo(todayISO());}}>
                آخر 30 يوم
              </Button>
              <Button variant="outline" size="sm" onClick={() => { const d=new Date(); d.setDate(d.getDate()-90); setFrom(localISODate(d)); setTo(todayISO());}}>
                آخر 90 يوم
              </Button>
            </div>
            <div className="flex items-center gap-2 ms-auto">
              <Select 
                value={printMode} 
                onChange={(e) => setPrintMode(e.target.value as PrintMode)}
                className="w-48 text-xs h-9"
              >
                <option value="full">المركز المالي الشامل</option>
                <option value="sales">مبيعات قطع الغيار</option>
                <option value="purchases">توريد قطع الغيار</option>
                <option value="stock">قيمة مخزون القطع</option>
                <option value="customers">كشف أرصدة العملاء</option>
                <option value="suppliers">كشف أرصدة الموردين</option>
                <option value="supplierDues">كشف فلوس علينا للموردين</option>
                <option value="commissions">تقرير عمولات الموردين</option>
                <option value="monthlyProfit">تقرير الربح الشهري</option>
                <option value="customerDues">كشف فلوس لدينا من عملاء</option>
              </Select>
              <Button variant="outline" onClick={() => setPreviewOpen(true)}>
                <Eye className="w-4 h-4" /> معاينة
              </Button>
              <Button variant="outline" onClick={() => window.print()}>
                <Printer className="w-4 h-4" /> طباعة
              </Button>
            </div>
          </CardBody>
        </Card>
      </div>

      <div className="no-print flex flex-wrap items-stretch gap-3">
        <Stat icon={<TrendingUp className="w-5 h-5" />} tone="green" label="صافي المبيعات (بعد المرتجعات)" value={formatCurrency(totalSales, settings.currency)} />
        <Stat icon={<TrendingDown className="w-5 h-5" />} tone="blue" label="إجمالي المشتريات" value={formatCurrency(totalPurchases, settings.currency)} />
        <Stat icon={<Coins className="w-5 h-5" />} tone="amber" label="الربح التقديري" value={formatCurrency(estimatedProfit, settings.currency)} />
        <Stat icon={<TrendingUp className="w-5 h-5" />} tone="emerald" label="بونص الموردين" value={formatCurrency(totalCommissions, settings.currency)} />
        {canViewEmployeeBonuses ? (
          <Stat icon={<UserRound className="w-5 h-5" />} tone="rose" label="بونص الموظفين" value={formatCurrency(totalEmployeeBonuses, settings.currency)} />
        ) : null}
        <Stat icon={<HandCoins className="w-5 h-5" />} tone="rose" label="فلوس علينا للموردين" value={formatCurrency(supplierPayablesTotal, settings.currency)} />
      </div>

      <div className="no-print">
        <Tabs defaultValue="sales">
        <TabsList className="flex w-full flex-wrap justify-center">
          <TabsTrigger value="sales">مبيعات قطع الغيار</TabsTrigger>
          <TabsTrigger value="purchases">توريد قطع الغيار</TabsTrigger>
          <TabsTrigger value="stock">قيمة مخزون القطع</TabsTrigger>
          <TabsTrigger value="lowstock">إعادة طلب القطع</TabsTrigger>
          {expiryTrackingEnabled ? <TabsTrigger value="expiredstock">قطع منتهية الصلاحية</TabsTrigger> : null}
          <TabsTrigger value="customers">أرصدة العملاء</TabsTrigger>
          <TabsTrigger value="suppliers">أرصدة الموردين</TabsTrigger>
          <TabsTrigger value="supplierDues">فلوس علينا للموردين</TabsTrigger>
          {canViewEmployeeBonuses ? <TabsTrigger value="commissions">عمولات الموردين</TabsTrigger> : null}
          <TabsTrigger value="monthlyProfit">الربح الشهري</TabsTrigger>
          <TabsTrigger value="customerDues">فلوس لدينا من عملاء</TabsTrigger>
          {canViewEmployeeBonuses ? <TabsTrigger value="employeeBonuses">بونص الموظفين</TabsTrigger> : null}
        </TabsList>

        <TabsContent value="sales">
          {/* ── Sales summary ── */}
          <div className="flex flex-wrap items-stretch gap-3 mb-4">
            <SummaryCard
              label="إجمالي المبيعات"
              value={formatCurrency(grossSalesInRange, settings.currency)}
              sub={`${salesInRange.length} فاتورة`}
              tone="slate"
            />
            {returnsTotalInRange > 0 && (
              <SummaryCard
                label="إجمالي المرتجعات"
                value={`- ${formatCurrency(returnsTotalInRange, settings.currency)}`}
                sub={`${salesReturnsInRange.length} مرتجع`}
                tone="red"
              />
            )}
            <SummaryCard
              label="صافي المبيعات"
              value={formatCurrency(totalSales, settings.currency)}
              sub="بعد المرتجعات"
              tone="green"
            />
            <SummaryCard
              label="المبالغ المحصلة"
              value={formatCurrency(collectedInRange, settings.currency)}
              sub="كاش + آجل مسدد"
              tone="emerald"
            />
            <SummaryCard
              label="المبالغ المتبقية"
              value={formatCurrency(remainingInRange, settings.currency)}
              sub="غير محصل بعد"
              tone={remainingInRange > 0 ? "amber" : "slate"}
            />
            <SummaryCard
              label="الربح التقديري"
              value={formatCurrency(estimatedProfit, settings.currency)}
              sub="بعد الخصومات والمرتجعات"
              tone={estimatedProfit >= 0 ? "indigo" : "red"}
            />
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <Card className="lg:col-span-2">
              <CardHeader title="المبيعات اليومية" />
              <CardBody className="h-72">
                <ResponsiveContainer>
                  <LineChart data={dailyData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                    <defs>
                      <linearGradient id="colorSales" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#10b981" stopOpacity={0.1}/>
                        <stop offset="95%" stopColor="#10b981" stopOpacity={0}/>
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgb(var(--line))" vertical={false} />
                    <XAxis dataKey="date" fontSize={12} stroke="rgb(var(--ink-faint))" tick={{ fill: "rgb(var(--ink-muted))" }} />
                    <YAxis fontSize={12} stroke="rgb(var(--ink-faint))" tick={{ fill: "rgb(var(--ink-muted))" }} />
                    <Tooltip 
                      contentStyle={{ borderRadius: 12, border: "none", boxShadow: "0 10px 15px -3px rgb(0 0 0 / 0.1)" }}
                      formatter={(v) => [formatCurrency(Number(v), settings.currency), "مبيعات"]} 
                    />
                    <Line type="monotone" dataKey="sales" name="مبيعات" stroke="#10b981" strokeWidth={3} dot={{ r: 4, fill: "#10b981", strokeWidth: 2, stroke: "#fff" }} activeDot={{ r: 6 }} />
                  </LineChart>
                </ResponsiveContainer>
              </CardBody>
            </Card>
            <Card>
              <CardHeader title="توزيع المبيعات حسب الفئة" />
              <CardBody className="h-72">
                {categoryShare.length === 0 ? (
                  <div className="h-full grid place-items-center text-sm text-ink-faint">لا توجد بيانات</div>
                ) : (
                  <ResponsiveContainer>
                    <PieChart>
                      <Pie 
                        data={categoryShare} 
                        dataKey="value" 
                        nameKey="name" 
                        innerRadius={60} 
                        outerRadius={80} 
                        paddingAngle={5}
                      >
                        {categoryShare.map((_, idx) => (
                          <Cell key={idx} fill={PIE_COLORS[idx % PIE_COLORS.length]} stroke="none" />
                        ))}
                      </Pie>
                      <Legend 
                        verticalAlign="bottom" 
                        height={36} 
                        iconType="circle"
                        wrapperStyle={{ fontSize: '12px', paddingTop: '20px' }}
                      />
                      <Tooltip 
                        contentStyle={{ borderRadius: 12, border: "none", boxShadow: "0 10px 15px -3px rgb(0 0 0 / 0.1)" }}
                        formatter={(v) => formatCurrency(Number(v), settings.currency) as string} 
                      />
                    </PieChart>
                  </ResponsiveContainer>
                )}
              </CardBody>
            </Card>
          </div>
          <Card className="mt-4">
            <CardHeader title="تفصيل المبيعات حسب نوع السعر" />
            <CardBody>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div className="rounded-lg border border-line bg-surface-muted p-3">
                  <div className="text-xs text-ink-faint">مبيعات الجملة</div>
                  <div className="text-lg font-bold text-ink mt-1">
                    {formatCurrency(wholesaleSalesTotal, settings.currency)}
                  </div>
                </div>
                <div className="rounded-lg border border-line bg-surface-muted p-3">
                  <div className="text-xs text-ink-faint">مبيعات التجزئة</div>
                  <div className="text-lg font-bold text-ink mt-1">
                    {formatCurrency(retailSalesTotal, settings.currency)}
                  </div>
                </div>
              </div>
            </CardBody>
          </Card>
          <Card className="mt-4">
            <CardHeader title="أعلى قطع الغيار مبيعًا" />
            <CardBody>
              {topProducts.length === 0 ? (
                <div className="text-sm text-ink-faint text-center py-6">لا توجد بيانات</div>
              ) : (
                <Table>
                  <THead>
                    <TR>
                      <TH>قطعة الغيار / Part No.</TH>
                      <TH className="text-end">الكمية المباعة</TH>
                      <TH className="text-end">الإيراد</TH>
                      <TH className="text-end">هامش الربح</TH>
                    </TR>
                  </THead>
                  <TBody>
                    {topProducts.map((t) => (
                      <TR key={t.name}>
                        <TD><div className="font-medium text-ink">{t.name}</div><div className="font-mono text-[11px] text-ink-faint" dir="ltr">{[t.partNumber, t.partBrand].filter(Boolean).join(" · ")}</div></TD>
                        <TD className="text-end">{t.qty}</TD>
                        <TD className="text-end">{formatCurrency(t.revenue, settings.currency)}</TD>
                        <TD className={`text-end font-medium ${t.grossProfit >= 0 ? "text-emerald-700 dark:text-emerald-400" : "text-rose-700 dark:text-rose-400"}`}>
                          {formatCurrency(t.grossProfit, settings.currency)}
                        </TD>
                      </TR>
                    ))}
                  </TBody>
                </Table>
              )}
            </CardBody>
          </Card>
        </TabsContent>

        <TabsContent value="purchases">
          <Card>
            <CardHeader title="المشتريات اليومية" />
            <CardBody className="h-72">
              <ResponsiveContainer>
                <BarChart data={dailyData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgb(var(--line))" />
                  <XAxis dataKey="date" fontSize={12} stroke="rgb(var(--ink-faint))" />
                  <YAxis fontSize={12} stroke="rgb(var(--ink-faint))" />
                  <Tooltip formatter={(v) => formatCurrency(Number(v), settings.currency) as string} />
                  <Bar dataKey="purchases" name="مشتريات" fill="#3b82f6" radius={[6, 6, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </CardBody>
          </Card>
          <Card className="mt-4">
            <CardHeader title={`فواتير المشتريات (${purchasesInRange.length})`} />
            <CardBody>
              {purchasesInRange.length === 0 ? (
                <div className="text-sm text-ink-faint text-center py-6">لا توجد فواتير في الفترة</div>
              ) : (
                <Table>
                  <THead>
                    <TR>
                      <TH>الرقم</TH>
                      <TH>التاريخ</TH>
                      <TH>المورد</TH>
                      <TH className="text-end">الإجمالي</TH>
                      <TH className="text-end">المتبقي</TH>
                    </TR>
                  </THead>
                  <TBody>
                    {purchasesInRange.map((p) => (
                      <TR key={p.id}>
                        <TD className="font-mono text-xs">{p.invoiceNumber}</TD>
                        <TD>{formatDate(p.date)}</TD>
                        <TD>{p.supplierName}</TD>
                        <TD className="text-end">{formatCurrency(p.total, settings.currency)}</TD>
                        <TD className="text-end">
                          {p.remaining > 0 ? (
                            <Badge tone="amber">{formatCurrency(p.remaining, settings.currency)}</Badge>
                          ) : (
                            <Badge tone="green">مسدد</Badge>
                          )}
                        </TD>
                      </TR>
                    ))}
                  </TBody>
                </Table>
              )}
            </CardBody>
          </Card>
        </TabsContent>

        <TabsContent value="stock">
          {products.length > 0 && (() => {
            const totalPurchase = products.reduce((s, p) => s + p.quantity * (p.avgCost ?? p.purchasePrice), 0);
            const totalWholesale = products.reduce((s, p) => s + p.quantity * p.wholesalePrice, 0);
            const totalRetail = products.reduce((s, p) => s + p.quantity * p.retailPrice, 0);
            const profitIfWholesale = totalWholesale - totalPurchase;
            const profitIfRetail = totalRetail - totalPurchase;
            return (
              <div className="flex flex-wrap items-stretch gap-3 mb-4">
                <SummaryCard
                  label="عدد أرقام القطع"
                  value={`${products.length} رقم قطعة`}
                  sub={`${products.filter(p => p.quantity > 0).length} متاح بالمخزون`}
                  tone="slate"
                />
                <SummaryCard
                  label="إجمالي قيمة الشراء"
                  value={formatCurrency(totalPurchase, settings.currency)}
                  sub="التكلفة الكلية للمخزون"
                  tone="slate"
                />
                <SummaryCard
                  label="قيمة البيع جملة"
                  value={formatCurrency(totalWholesale, settings.currency)}
                  sub={`هامش: ${formatCurrency(profitIfWholesale, settings.currency)}`}
                  tone="indigo"
                />
                <SummaryCard
                  label="قيمة البيع تجزئة"
                  value={formatCurrency(totalRetail, settings.currency)}
                  sub={`هامش: ${formatCurrency(profitIfRetail, settings.currency)}`}
                  tone="emerald"
                />
                <SummaryCard
                  label="قطع نفدت"
                  value={`${products.filter(p => p.quantity <= 0).length} رقم قطعة`}
                  sub={`${products.filter(p => p.quantity > 0 && p.quantity <= p.minStock).length} يحتاج إعادة طلب`}
                  tone={products.some(p => p.quantity <= 0) ? "red" : "slate"}
                />
              </div>
            );
          })()}
          <Card>
            <CardHeader title={`قائمة مخزون قطع الغيار (${products.length} رقم قطعة)`} />
            <CardBody>
              <Table>
                <THead>
                  <TR>
                    <TH>Part No.</TH>
                    <TH>اسم القطعة</TH>
                    <TH>الماركة / المنشأ / الرف</TH>
                    <TH className="text-end">الكمية</TH>
                    <TH className="text-end">قيمة الشراء</TH>
                    <TH className="text-end">قيمة البيع جملة</TH>
                    <TH className="text-end">قيمة البيع تجزئة</TH>
                  </TR>
                </THead>
                <TBody>
                  {products.map((p) => (
                    <TR key={p.id}>
                      <TD className="font-mono text-xs" dir="ltr">{p.partNumber || p.code}</TD>
                      <TD className="font-medium text-ink">{p.name}</TD>
                      <TD><div className="text-ink-muted" dir="ltr">{[p.partBrand, p.originCountry].filter(Boolean).join(" · ") || "—"}</div><div className="font-mono text-[11px] text-ink-faint" dir="ltr">{p.rackLocation ? `RACK ${p.rackLocation}` : p.category}</div></TD>
                      <TD className={`text-end font-mono ${p.quantity <= 0 ? "text-rose-700 dark:text-rose-400 font-bold" : p.quantity <= p.minStock ? "text-amber-700 dark:text-amber-400" : ""}`}>
                        {p.quantity} {p.unit}
                      </TD>
                      <TD className="text-end">{formatCurrency(p.quantity * (p.avgCost ?? p.purchasePrice), settings.currency)}</TD>
                      <TD className="text-end">{formatCurrency(p.quantity * p.wholesalePrice, settings.currency)}</TD>
                      <TD className="text-end">{formatCurrency(p.quantity * p.retailPrice, settings.currency)}</TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </CardBody>
          </Card>
        </TabsContent>

        <TabsContent value="lowstock">
          <Card>
            <CardHeader title="إعادة طلب قطع الغيار" subtitle="قطع وصلت أو تجاوزت حد إعادة الطلب" />
            <CardBody>
              {products.filter((p) => p.quantity <= p.minStock).length === 0 ? (
                <div className="text-sm text-ink-faint text-center py-6">لا توجد قطع تحتاج إعادة طلب</div>
              ) : (
                <Table>
                  <THead>
                    <TR>
                      <TH>قطعة الغيار / Part No.</TH>
                      <TH>الماركة / الرف</TH>
                      <TH className="text-end">الكمية الحالية</TH>
                      <TH className="text-end">الحد الأدنى</TH>
                      <TH>الحالة</TH>
                    </TR>
                  </THead>
                  <TBody>
                    {products
                      .filter((p) => p.quantity <= p.minStock)
                      .sort((a, b) => a.quantity - b.quantity)
                      .map((p) => (
                        <TR key={p.id}>
                          <TD><div className="font-medium text-ink">{p.name}</div><div className="font-mono text-[11px] text-ink-faint" dir="ltr">{p.partNumber || p.code}</div></TD>
                          <TD className="text-ink-faint text-xs" dir="ltr">{[p.partBrand, p.rackLocation ? `RACK ${p.rackLocation}` : undefined].filter(Boolean).join(" · ") || "—"}</TD>
                          <TD className="text-end font-mono font-semibold text-rose-700 dark:text-rose-400">
                            {p.quantity} {p.unit}
                          </TD>
                          <TD className="text-end text-ink-faint">{p.minStock} {p.unit}</TD>
                          <TD>
                            {p.quantity === 0
                              ? <Badge tone="red">نفذ تماماً</Badge>
                              : <Badge tone="amber">منخفض</Badge>}
                          </TD>
                        </TR>
                      ))}
                  </TBody>
                </Table>
              )}
            </CardBody>
          </Card>
        </TabsContent>

        {expiryTrackingEnabled ? <TabsContent value="expiredstock">
          <Card>
            <CardHeader title="مواد وقطع محددة الصلاحية" subtitle="زيوت وسوائل وبطاريات أو أصناف مسجلة تنتهي خلال 14 يومًا" />
            <CardBody>
              {products.filter((p) => {
                if (!p.hasExpiry || !p.expiryDate) return false;
                const du = daysUntil(p.expiryDate);
                return du !== null && du <= 14;
              }).length === 0 ? (
                <div className="text-sm text-ink-faint text-center py-6">لا توجد مواد أو قطع محددة الصلاحية تحتاج متابعة</div>
              ) : (
                <Table>
                  <THead>
                    <TR>
                      <TH>قطعة الغيار / المادة</TH>
                      <TH>الماركة / الفئة</TH>
                      <TH className="text-end">الكمية</TH>
                      <TH>تاريخ الانتهاء</TH>
                      <TH>الحالة</TH>
                    </TR>
                  </THead>
                  <TBody>
                    {products
                      .filter((p) => {
                        if (!p.hasExpiry || !p.expiryDate) return false;
                        const du = daysUntil(p.expiryDate);
                        return du !== null && du <= 14;
                      })
                      .sort((a, b) => (a.expiryDate ?? "").localeCompare(b.expiryDate ?? ""))
                      .map((p) => {
                        const du = daysUntil(p.expiryDate);
                        return (
                          <TR key={p.id}>
                            <TD className="font-medium text-ink">{p.name}</TD>
                            <TD className="text-ink-faint text-xs">{p.category}</TD>
                            <TD className="text-end font-mono">{p.quantity} {p.unit}</TD>
                            <TD className="text-xs font-medium">
                              {p.expiryDate ? formatDate(p.expiryDate) : "—"}
                            </TD>
                            <TD>
                              {du !== null && du < 0
                                ? <Badge tone="red">منتهي منذ {Math.abs(du)} يوم</Badge>
                                : du !== null && du === 0
                                ? <Badge tone="red">ينتهي اليوم</Badge>
                                : <Badge tone="rose">يتبقى {du} يوم</Badge>}
                            </TD>
                          </TR>
                        );
                      })}
                  </TBody>
                </Table>
              )}
            </CardBody>
          </Card>
        </TabsContent> : null}

        <TabsContent value="customers">
          <Card>
            <CardHeader title="أرصدة العملاء" />
            <CardBody>
              <Table>
                <THead>
                  <TR>
                    <TH>العميل</TH>
                    <TH>الهاتف</TH>
                    <TH className="text-end">الرصيد المستحق</TH>
                  </TR>
                </THead>
                <TBody>
                  {customers.map((c) => {
                    const bal = customerBalance(c.id);
                    return (
                      <TR key={c.id}>
                        <TD className="font-medium">{c.name}</TD>
                        <TD className="text-ink-muted">{c.phone ?? "—"}</TD>
                        <TD className="text-end">
                          {bal > 0 ? (
                            <Badge tone="amber">{formatCurrency(bal, settings.currency)}</Badge>
                          ) : bal < 0 ? (
                            <Badge tone="green">رصيد دائن {formatCurrency(-bal, settings.currency)}</Badge>
                          ) : (
                            <Badge tone="green">لا يوجد</Badge>
                          )}
                        </TD>
                      </TR>
                    );
                  })}
                </TBody>
              </Table>
            </CardBody>
          </Card>
        </TabsContent>

        <TabsContent value="suppliers">
          <Card>
            <CardHeader title="أرصدة الموردين" />
            <CardBody>
              <Table>
                <THead>
                  <TR>
                    <TH>المورد</TH>
                    <TH>الهاتف</TH>
                    <TH className="text-end">الرصيد المتبقي</TH>
                  </TR>
                </THead>
                <TBody>
                  {suppliers.map((s) => {
                    const bal = supplierBalance(s.id);
                    return (
                      <TR key={s.id}>
                        <TD className="font-medium">{s.name}</TD>
                        <TD className="text-ink-muted">{s.phone ?? "—"}</TD>
                        <TD className="text-end">
                          {bal > 0 ? (
                            <Badge tone="amber">{formatCurrency(bal, settings.currency)}</Badge>
                          ) : (
                            <Badge tone="green">مسدد</Badge>
                          )}
                        </TD>
                      </TR>
                    );
                  })}
                </TBody>
              </Table>
            </CardBody>
          </Card>
        </TabsContent>

        <TabsContent value="supplierDues">
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
            <div className="rounded-xl border border-rose-200 dark:border-rose-500/30 bg-rose-50 dark:bg-rose-500/10 p-4">
              <div className="text-xs font-bold text-rose-500">إجمالي المطلوب دفعه</div>
              <div className="mt-1 text-xl font-bold text-rose-700 dark:text-rose-400">
                {formatCurrency(supplierPayablesTotal, settings.currency)}
              </div>
            </div>
            <div className="rounded-xl border border-line bg-surface p-4">
              <div className="text-xs font-bold text-ink-faint">فواتير مفتوحة</div>
              <div className="mt-1 text-xl font-bold text-ink">{supplierDueInvoices.length}</div>
            </div>
            <div className="rounded-xl border border-line bg-surface p-4">
              <div className="text-xs font-bold text-ink-faint">أكبر مورد مستحق</div>
              <div className="mt-1 text-sm font-bold text-ink truncate">
                {largestSupplierPayable ? largestSupplierPayable.supplierName : "—"}
              </div>
              <div className="mt-1 text-sm font-semibold text-rose-700 dark:text-rose-400">
                {largestSupplierPayable ? formatCurrency(largestSupplierPayable.remaining, settings.currency) : "—"}
              </div>
            </div>
            <div className="rounded-xl border border-line bg-surface p-4">
              <div className="text-xs font-bold text-ink-faint">أقدم فاتورة مفتوحة</div>
              <div className="mt-1 text-sm font-bold text-ink">
                {oldestSupplierDue ? oldestSupplierDue.invoiceNumber : "—"}
              </div>
              <div className="mt-1 text-sm font-semibold text-amber-700 dark:text-amber-400">
                {oldestSupplierDue
                  ? `${formatDate(oldestSupplierDue.date)} - ${invoiceAgeLabel(invoiceAgeDays(oldestSupplierDue.date))}`
                  : "—"}
              </div>
            </div>
          </div>

          <Card className="mt-4">
            <CardHeader
              title="تفصيل حسب المورد"
              subtitle={`إجمالي المدفوع من هذه الفواتير: ${formatCurrency(supplierDuePaidTotal, settings.currency)}`}
            />
            <CardBody>
              {supplierPayableRows.length === 0 ? (
                <div className="text-sm text-ink-faint text-center py-6">لا توجد مستحقات مفتوحة للموردين</div>
              ) : (
                <Table>
                  <THead>
                    <TR>
                      <TH>كود المورد</TH>
                      <TH>المورد</TH>
                      <TH>الهاتف</TH>
                      <TH className="text-end">عدد الفواتير</TH>
                      <TH className="text-end">إجمالي الفواتير</TH>
                      <TH className="text-end">المدفوع</TH>
                      <TH className="text-end">المطلوب دفعه</TH>
                      <TH>أقدم فاتورة</TH>
                    </TR>
                  </THead>
                  <TBody>
                    {supplierPayableRows.map((row) => (
                      <TR key={row.supplierId}>
                        <TD className="font-mono text-xs">{row.supplierCode || "—"}</TD>
                        <TD className="font-medium text-ink">{row.supplierName}</TD>
                        <TD className="text-ink-muted">{row.phone || "—"}</TD>
                        <TD className="text-end">{row.invoiceCount}</TD>
                        <TD className="text-end">{formatCurrency(row.total, settings.currency)}</TD>
                        <TD className="text-end">{formatCurrency(row.paid, settings.currency)}</TD>
                        <TD className="text-end font-bold text-rose-700 dark:text-rose-400">
                          {formatCurrency(row.remaining, settings.currency)}
                        </TD>
                        <TD>
                          <div className="text-sm">{formatDate(row.oldestDate)}</div>
                          <div className="text-xs text-ink-faint">{invoiceAgeLabel(invoiceAgeDays(row.oldestDate))}</div>
                        </TD>
                      </TR>
                    ))}
                  </TBody>
                </Table>
              )}
            </CardBody>
          </Card>

          <Card className="mt-4">
            <CardHeader
              title="الفواتير المطلوب سدادها"
              subtitle="يعرض كل فواتير الموردين المفتوحة حالياً، حتى لو كانت خارج فترة التقرير المختارة"
            />
            <CardBody>
              {supplierDueInvoices.length === 0 ? (
                <div className="text-sm text-ink-faint text-center py-6">كل فواتير الموردين مسددة</div>
              ) : (
                <Table>
                  <THead>
                    <TR>
                      <TH>رقم الفاتورة</TH>
                      <TH>التاريخ</TH>
                      <TH>العمر</TH>
                      <TH>المورد</TH>
                      <TH>الهاتف</TH>
                      <TH className="text-end">الإجمالي</TH>
                      <TH className="text-end">المدفوع</TH>
                      <TH className="text-end">المتبقي</TH>
                      <TH>الحالة</TH>
                      <TH className="text-end">إجراء</TH>
                    </TR>
                  </THead>
                  <TBody>
                    {supplierDueInvoices.map((invoice) => {
                      const supplier = supplierLookup.get(invoice.supplierId);
                      const age = invoiceAgeDays(invoice.date);
                      return (
                        <TR key={invoice.id}>
                          <TD className="font-mono text-xs">{invoice.invoiceNumber}</TD>
                          <TD>{formatDate(invoice.date)}</TD>
                          <TD>
                            <Badge tone={invoiceAgeTone(age)}>{invoiceAgeLabel(age)}</Badge>
                          </TD>
                          <TD className="font-medium text-ink">{invoice.supplierName}</TD>
                          <TD className="text-ink-muted">{supplier?.phone || "—"}</TD>
                          <TD className="text-end">{formatCurrency(invoice.total, settings.currency)}</TD>
                          <TD className="text-end">{formatCurrency(invoice.amountPaid, settings.currency)}</TD>
                          <TD className="text-end font-bold text-rose-700 dark:text-rose-400">
                            {formatCurrency(invoice.remaining, settings.currency)}
                          </TD>
                          <TD>
                            <Badge tone={invoice.status === "partial" ? "amber" : "rose"}>
                              {purchaseStatusLabel(invoice.status)}
                            </Badge>
                          </TD>
                          <TD className="text-end">
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => navigate(`/purchases/${invoice.id}`)}
                            >
                              فتح
                            </Button>
                          </TD>
                        </TR>
                      );
                    })}
                  </TBody>
                </Table>
              )}
            </CardBody>
          </Card>
        </TabsContent>

        <TabsContent value="commissions">
          <Card>
            <CardHeader title="تفاصيل عمولات وبونص الموردين" />
            <CardBody>
              <Table>
                <THead>
                  <TR>
                    <TH>المورد</TH>
                    <TH>الشريحة</TH>
                    <TH className="text-end">المشتريات الحالية</TH>
                    <TH className="text-end">البونص المستحق</TH>
                  </TR>
                </THead>
                <TBody>
                  {suppliers.map((s) => {
                    const comms = calculateSupplierCommission(s.id);
                    if (comms.length === 0) return null;
                    return comms.map((c, idx) => (
                      <TR key={`${s.id}-${c.tierId}`}>
                        <TD className={idx === 0 ? "font-medium" : "opacity-0"}>{idx === 0 ? s.name : ""}</TD>
                        <TD className="text-xs text-ink-muted">
                          {formatCurrency(c.threshold, settings.currency)} ({c.periodDays} يوم)
                        </TD>
                        <TD className="text-end">{formatCurrency(c.totalPurchases, settings.currency)}</TD>
                        <TD className="text-end font-bold text-emerald-600 dark:text-emerald-400">
                          {c.earned > 0 ? formatCurrency(c.earned, settings.currency) : "—"}
                        </TD>
                      </TR>
                    ));
                  })}
                  {suppliers.every(s => calculateSupplierCommission(s.id).length === 0) && (
                    <TR>
                      <TD colSpan={4} className="text-center py-8 text-ink-faint">لا توجد شرائح عمولة مسجلة</TD>
                    </TR>
                  )}
                </TBody>
              </Table>
            </CardBody>
          </Card>
        </TabsContent>
        <TabsContent value="monthlyProfit">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4">
            <div className="rounded-xl border border-emerald-200 dark:border-emerald-500/30 bg-emerald-50 dark:bg-emerald-500/10 p-4">
              <div className="text-xs font-bold text-emerald-600 dark:text-emerald-400">صافي المبيعات (كل الشهور)</div>
              <div className="mt-1 text-xl font-bold text-emerald-700 dark:text-emerald-400">{formatCurrency(monthlyTotals.sales, settings.currency)}</div>
            </div>
            <div className="rounded-xl border border-blue-200 dark:border-blue-500/30 bg-blue-50 dark:bg-blue-500/10 p-4">
              <div className="text-xs font-bold text-blue-600 dark:text-blue-400">إجمالي المشتريات (كل الشهور)</div>
              <div className="mt-1 text-xl font-bold text-blue-700 dark:text-blue-400">{formatCurrency(monthlyTotals.purchases, settings.currency)}</div>
            </div>
            <div className={`rounded-xl border p-4 ${monthlyTotals.profit >= 0 ? "border-green-200 dark:border-green-500/30 bg-green-50 dark:bg-green-500/10" : "border-rose-200 dark:border-rose-500/30 bg-rose-50 dark:bg-rose-500/10"}`}>
              <div className={`text-xs font-bold ${monthlyTotals.profit >= 0 ? "text-green-600 dark:text-green-400" : "text-rose-600 dark:text-rose-400"}`}>هامش الربح الإجمالي</div>
              <div className={`mt-1 text-xl font-bold ${monthlyTotals.profit >= 0 ? "text-green-700" : "text-rose-700 dark:text-rose-400"}`}>
                {formatCurrency(monthlyTotals.profit, settings.currency)}
              </div>
            </div>
          </div>
          <Card>
            <CardHeader title="الربح الشهري" subtitle="صافي المبيعات والمشتريات وهامش الربح (سعر البيع − التكلفة − الخصومات − المرتجعات) لكل شهر" />
            <CardBody className="h-72">
              <ResponsiveContainer>
                <BarChart data={monthlyProfitData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgb(var(--line))" vertical={false} />
                  <XAxis dataKey="month" fontSize={12} stroke="rgb(var(--ink-faint))" tick={{ fill: "rgb(var(--ink-muted))" }} />
                  <YAxis fontSize={12} stroke="rgb(var(--ink-faint))" tick={{ fill: "rgb(var(--ink-muted))" }} />
                  <Tooltip
                    contentStyle={{ borderRadius: 12, border: "none", boxShadow: "0 10px 15px -3px rgb(0 0 0 / 0.1)" }}
                    formatter={(v, name) => [formatCurrency(Number(v), settings.currency), String(name)]}
                  />
                  <Bar dataKey="sales" name="مبيعات" fill="#10b981" radius={[4, 4, 0, 0]} barSize={20} />
                  <Bar dataKey="purchases" name="مشتريات" fill="#3b82f6" radius={[4, 4, 0, 0]} barSize={20} />
                  <Bar dataKey="profit" name="هامش الربح" fill="#8b5cf6" radius={[4, 4, 0, 0]} barSize={20} />
                </BarChart>
              </ResponsiveContainer>
            </CardBody>
          </Card>
          <Card className="mt-4">
            <CardHeader title="تفصيل شهري" />
            <CardBody>
              {monthlyProfitData.length === 0 ? (
                <div className="text-sm text-ink-faint text-center py-6">لا توجد بيانات</div>
              ) : (
                <Table>
                  <THead>
                    <TR>
                      <TH>الشهر</TH>
                      <TH className="text-end">المبيعات</TH>
                      <TH className="text-end">المشتريات</TH>
                      <TH className="text-end">هامش الربح</TH>
                    </TR>
                  </THead>
                  <TBody>
                    {monthlyProfitData.map((row) => (
                      <TR key={row.month}>
                        <TD className="font-medium">{row.month}</TD>
                        <TD className="text-end text-emerald-700 dark:text-emerald-400">{formatCurrency(row.sales, settings.currency)}</TD>
                        <TD className="text-end text-blue-700 dark:text-blue-400">{formatCurrency(row.purchases, settings.currency)}</TD>
                        <TD className={`text-end font-bold ${row.profit >= 0 ? "text-green-700" : "text-rose-700 dark:text-rose-400"}`}>
                          {formatCurrency(row.profit, settings.currency)}
                        </TD>
                      </TR>
                    ))}
                  </TBody>
                </Table>
              )}
            </CardBody>
          </Card>
        </TabsContent>

        <TabsContent value="customerDues">
          <Card>
            <CardHeader
              title="فلوس لدينا من عملاء"
              subtitle={`الإجمالي المستحق: ${formatCurrency(totalReceivables, settings.currency)}`}
            />
            <CardBody>
              {customers.every((c) => customerBalance(c.id) <= 0) ? (
                <div className="text-sm text-ink-faint text-center py-6">لا يوجد عملاء لديهم أرصدة مستحقة</div>
              ) : (
                <Table>
                  <THead>
                    <TR>
                      <TH>الكود</TH>
                      <TH>العميل</TH>
                      <TH>الهاتف</TH>
                      <TH className="text-end">المبلغ المستحق</TH>
                    </TR>
                  </THead>
                  <TBody>
                    {customers
                      .map((c) => ({ c, bal: customerBalance(c.id) }))
                      .filter(({ bal }) => bal > 0)
                      .sort((a, b) => b.bal - a.bal)
                      .map(({ c, bal }) => (
                        <TR key={c.id}>
                          <TD className="font-mono text-xs text-ink-faint">{c.code ?? "—"}</TD>
                          <TD className="font-medium text-ink">{c.name}</TD>
                          <TD className="text-ink-muted">{c.phone ?? "—"}</TD>
                          <TD className="text-end font-bold text-rose-700 dark:text-rose-400">
                            {formatCurrency(bal, settings.currency)}
                          </TD>
                        </TR>
                      ))}
                  </TBody>
                </Table>
              )}
            </CardBody>
          </Card>
        </TabsContent>

        {canViewEmployeeBonuses ? (
          <TabsContent value="employeeBonuses">
            <Card>
              <CardHeader
                title="بونص الموظفين"
                subtitle="حساب البونص من فواتير البيع داخل الفترة المختارة"
              />
              <CardBody className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-5 gap-3">
                  <div className="rounded-lg border border-line bg-surface-muted p-3">
                    <div className="text-xs text-ink-faint">إجمالي بونص الموظفين</div>
                    <div className="text-lg font-bold text-rose-700 dark:text-rose-400 mt-1">
                      {formatCurrency(totalEmployeeBonuses, settings.currency)}
                    </div>
                  </div>
                  <div className="rounded-lg border border-line bg-surface-muted p-3">
                    <div className="text-xs text-ink-faint">مبيعات الموظفين</div>
                    <div className="text-lg font-bold text-ink mt-1">
                      {formatCurrency(totalEmployeeSales, settings.currency)}
                    </div>
                  </div>
                  <div className="rounded-lg border border-line bg-surface-muted p-3">
                    <div className="text-xs text-ink-faint">موظفون لديهم مبيعات</div>
                    <div className="text-lg font-bold text-ink mt-1">
                      {employeesWithSales} / {employeeBonusRows.length}
                    </div>
                  </div>
                  <div className="rounded-lg border border-line bg-surface-muted p-3">
                    <div className="text-xs text-ink-faint">محققين التارجت</div>
                    <div className="text-lg font-bold text-emerald-700 dark:text-emerald-400 mt-1">
                      {employeesTargetAchieved}
                    </div>
                  </div>
                  <div className="rounded-lg border border-line bg-surface-muted p-3">
                    <div className="text-xs text-ink-faint">صافي تقديري بعد البونصات</div>
                    <div className="text-lg font-bold text-ink mt-1">
                      {formatCurrency(estimatedProfitAfterBonuses, settings.currency)}
                    </div>
                  </div>
                </div>

                {unattributedEmployeeInvoices.length > 0 ? (
                  <div className="rounded-lg border border-amber-200 dark:border-amber-500/30 bg-amber-50 dark:bg-amber-500/10 p-3 text-sm text-amber-800 dark:text-amber-400">
                    توجد {unattributedEmployeeInvoices.length} فواتير بيع بدون موظف مسجل بقيمة{" "}
                    <span className="font-bold">{formatCurrency(unattributedEmployeeSales, settings.currency)}</span>.
                    هذه الفواتير لا تدخل في بونص أي موظف.
                  </div>
                ) : null}

                <Table>
                  <THead>
                    <TR>
                      <TH>الموظف</TH>
                      <TH className="text-end">عدد الفواتير</TH>
                      <TH className="text-end">إجمالي المبيعات</TH>
                      <TH className="text-end">المحصَّل في الفترة</TH>
                      <TH className="text-end">نسبة العمولة</TH>
                      <TH className="text-end">البونص (من المحصَّل)</TH>
                      <TH className="text-end">الراتب الشهري</TH>
                      <TH className="text-end">التارجت الشهري</TH>
                      <TH>الحالة</TH>
                      <TH className="text-end">إجمالي مستحقات تقديري</TH>
                    </TR>
                  </THead>
                  <TBody>
                    {employeeBonusRows.length === 0 ? (
                      <TR>
                        <TD colSpan={10} className="text-center py-8 text-ink-faint">
                          لا يوجد موظفون مسجلون
                        </TD>
                      </TR>
                    ) : (
                      employeeBonusRows.map((row) => (
                        <TR key={row.employee.id}>
                          <TD className="font-medium text-ink">
                            {row.employee.name || row.employee.username}
                          </TD>
                          <TD className="text-end tabular-nums">{row.invoiceCount}</TD>
                          <TD className="text-end">{formatCurrency(row.totalSales, settings.currency)}</TD>
                          <TD className="text-end font-medium text-emerald-700 dark:text-emerald-400">
                            {formatCurrency(row.collected, settings.currency)}
                          </TD>
                          <TD className="text-end tabular-nums">{row.commissionPct}%</TD>
                          <TD className="text-end font-bold text-rose-700 dark:text-rose-400">
                            {formatCurrency(row.bonus, settings.currency)}
                          </TD>
                          <TD className="text-end">{formatCurrency(row.salary, settings.currency)}</TD>
                          <TD className="text-end">
                            {row.target > 0 ? formatCurrency(row.target, settings.currency) : "—"}
                          </TD>
                          <TD>
                            {row.target <= 0 ? (
                              <Badge tone="slate">بدون تارجت</Badge>
                            ) : row.achievedTarget ? (
                              <Badge tone="green">
                                محقق
                                {row.exceededTarget > 0
                                  ? ` +${formatCurrency(row.exceededTarget, settings.currency)}`
                                  : ""}
                              </Badge>
                            ) : (
                              <Badge tone="amber">
                                متبقي {formatCurrency(row.remainingTarget, settings.currency)}
                              </Badge>
                            )}
                          </TD>
                          <TD className="text-end font-bold text-ink">
                            {formatCurrency(row.totalEarnings, settings.currency)}
                          </TD>
                        </TR>
                      ))
                    )}
                  </TBody>
                </Table>
              </CardBody>
            </Card>
          </TabsContent>
        ) : null}
      </Tabs>
      </div>

      {/* ── Preview Modal ── */}
      {previewOpen && (
        <div
          className="fixed inset-0 z-50 bg-black/60 flex flex-col items-center overflow-y-auto py-8 px-4 print-preview-backdrop"
          onClick={(e) => { if (e.target === e.currentTarget) setPreviewOpen(false); }}
        >
          <div className="w-full max-w-[820px] mb-4 flex items-center justify-between no-print">
            <div className="flex gap-2">
              <button
                onClick={() => window.print()}
                className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium px-4 h-9 rounded-lg"
              >
                <Printer className="w-4 h-4" /> طباعة
              </button>
              {whatsappEnabled && (
                <button
                  onClick={() => {
                    const reportTitles: Record<string, string> = {
                      full: "التقرير المالي التحليلي الشامل",
                      suppliers: "كشف مستحقات الموردين",
                      supplierDues: "كشف المبالغ المستحقة للموردين",
                      commissions: "تقرير عمولات الموردين",
                      monthlyProfit: "تقرير الربح الشهري",
                      customerDues: "كشف المبالغ المستحقة من العملاء",
                    };
                    const title = reportTitles[printMode] ?? "تقرير مالي";
                    const msg = [
                      `📊 ${title}`,
                      `🏢 ${settings.companyName}`,
                      `📅 ${formatDate(from)} — ${formatDate(to)}`,
                      ``,
                      `💰 إجمالي المبيعات: ${formatCurrency(totalSales, settings.currency)}`,
                      `🛒 إجمالي المشتريات: ${formatCurrency(totalPurchases, settings.currency)}`,
                      `📈 الربح التشغيلي: ${formatCurrency(estimatedProfit, settings.currency)}`,
                    ].join("\n");
                    window.open(`https://wa.me/?text=${encodeURIComponent(msg)}`);
                  }}
                  className="flex items-center gap-2 bg-green-600 hover:bg-green-700 text-white text-sm font-medium px-4 h-9 rounded-lg"
                >
                  <MessageCircle className="w-4 h-4" /> واتساب
                </button>
              )}
              <button
                onClick={() => window.print()}
                className="flex items-center gap-2 bg-slate-600 hover:bg-slate-700 text-white text-sm font-medium px-4 h-9 rounded-lg"
              >
                <FileDown className="w-4 h-4" /> حفظ PDF
              </button>
            </div>
            <button
              onClick={() => setPreviewOpen(false)}
              className="text-white/80 hover:text-white text-sm flex items-center gap-1.5 bg-surface/10 hover:bg-surface/20 px-3 h-9 rounded-lg"
            >
              ✕ إغلاق
            </button>
          </div>
          <div className="print-preview-area w-full max-w-[820px] bg-white rounded-xl shadow-2xl overflow-hidden force-light">
            <ReportContent
              printMode={printMode} from={from} to={to}
              settings={settings} formatCurrency={formatCurrency} formatDate={formatDate}
              salesInRange={salesInRange} purchasesInRange={purchasesInRange}
              salesReturnsInRange={salesReturnsInRange}
              grossSalesInRange={grossSalesInRange} totalSales={totalSales}
              totalPurchases={totalPurchases} returnsTotalInRange={returnsTotalInRange}
              collectedInRange={collectedInRange} remainingInRange={remainingInRange}
              estimatedProfit={estimatedProfit} estimatedProfitAfterBonuses={estimatedProfitAfterBonuses}
              totalCommissions={totalCommissions} totalEmployeeBonuses={totalEmployeeBonuses}
              totalReceivables={totalReceivables} supplierPayablesTotal={supplierPayablesTotal}
              supplierDueInvoices={supplierDueInvoices} supplierPayableRows={supplierPayableRows}
              monthlyProfitData={monthlyProfitData} monthlyTotals={monthlyTotals}
              topProducts={topProducts} categoryShare={categoryShare}
              products={products} customers={customers} suppliers={suppliers}
              customerBalance={customerBalance} supplierBalance={supplierBalance}
              calculateSupplierCommission={calculateSupplierCommission}
              canViewEmployeeBonuses={canViewEmployeeBonuses}
            />
          </div>
        </div>
      )}

      {/* Print-Only Layout */}
      <div className="print-only">
        <ReportContent
          printMode={printMode} from={from} to={to}
          settings={settings} formatCurrency={formatCurrency} formatDate={formatDate}
          salesInRange={salesInRange} purchasesInRange={purchasesInRange}
          salesReturnsInRange={salesReturnsInRange}
          grossSalesInRange={grossSalesInRange} totalSales={totalSales}
          totalPurchases={totalPurchases} returnsTotalInRange={returnsTotalInRange}
          collectedInRange={collectedInRange} remainingInRange={remainingInRange}
          estimatedProfit={estimatedProfit} estimatedProfitAfterBonuses={estimatedProfitAfterBonuses}
          totalCommissions={totalCommissions} totalEmployeeBonuses={totalEmployeeBonuses}
          totalReceivables={totalReceivables} supplierPayablesTotal={supplierPayablesTotal}
          supplierDueInvoices={supplierDueInvoices} supplierPayableRows={supplierPayableRows}
          monthlyProfitData={monthlyProfitData} monthlyTotals={monthlyTotals}
          topProducts={topProducts} categoryShare={categoryShare}
          products={products} customers={customers} suppliers={suppliers}
          customerBalance={customerBalance} supplierBalance={supplierBalance}
          calculateSupplierCommission={calculateSupplierCommission}
          canViewEmployeeBonuses={canViewEmployeeBonuses}
        />
      </div>

    </>
  );
}

function invoiceAgeDays(date: string): number {
  const issuedAt = new Date(date);
  if (Number.isNaN(issuedAt.getTime())) return 0;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  issuedAt.setHours(0, 0, 0, 0);
  return Math.max(0, Math.floor((today.getTime() - issuedAt.getTime()) / (1000 * 60 * 60 * 24)));
}

function invoiceAgeLabel(days: number): string {
  if (days === 0) return "اليوم";
  if (days === 1) return "منذ يوم";
  return `منذ ${days} يوم`;
}

function invoiceAgeTone(days: number): "blue" | "amber" | "orange" | "rose" {
  if (days >= 60) return "rose";
  if (days >= 30) return "orange";
  if (days >= 14) return "amber";
  return "blue";
}

function purchaseStatusLabel(status: string): string {
  if (status === "partial") return "مدفوع جزئياً";
  if (status === "unpaid") return "غير مدفوع";
  return "مفتوح";
}

function Stat({
  icon,
  label,
  value,
  tone,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  tone: "green" | "blue" | "amber" | "indigo" | "emerald" | "rose" | "violet";
}) {
  const colors: Record<string, string> = {
    green: "bg-emerald-50 dark:bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-200/50 dark:border-emerald-500/20",
    blue: "bg-blue-50 dark:bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-200/50 dark:border-blue-500/20",
    amber: "bg-amber-50 dark:bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-200/50 dark:border-amber-500/20",
    indigo: "bg-indigo-50 dark:bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 border-indigo-200/50 dark:border-indigo-500/20",
    emerald: "bg-emerald-50 dark:bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-200/50 dark:border-emerald-500/20",
    rose: "bg-rose-50 dark:bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-200/50 dark:border-rose-500/20",
    violet: "bg-violet-50 dark:bg-violet-500/10 text-violet-600 dark:text-violet-400 border-violet-200/50 dark:border-violet-500/20",
  };
  return (
    <div className="bg-surface rounded-2xl border border-line p-4 flex items-center justify-between gap-3 flex-1 min-w-[210px] shadow-sm hover:shadow-md hover:border-brand-500/30 transition-all">
      <div className="min-w-0 flex-1">
        <div className="text-xs font-semibold text-ink-muted leading-4 truncate" title={label}>{label}</div>
        <div className="text-lg font-bold text-ink mt-1 tabular-nums leading-tight truncate">{value}</div>
      </div>
      <div className={`w-10 h-10 rounded-xl border grid place-items-center shrink-0 ${colors[tone]}`}>
        {icon}
      </div>
    </div>
  );
}

function SummaryCard({
  label,
  value,
  sub,
  tone = "slate",
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: "slate" | "green" | "emerald" | "amber" | "red" | "indigo";
}) {
  const valueColors: Record<string, string> = {
    slate: "text-ink",
    green: "text-emerald-600 dark:text-emerald-400",
    emerald: "text-emerald-600 dark:text-emerald-400",
    amber: "text-amber-600 dark:text-amber-400",
    red: "text-rose-600 dark:text-rose-400",
    indigo: "text-indigo-600 dark:text-indigo-400",
  };
  const borderColors: Record<string, string> = {
    slate: "border-line bg-surface",
    green: "border-emerald-200/80 dark:border-emerald-500/25 bg-emerald-50/30 dark:bg-emerald-500/[0.04]",
    emerald: "border-emerald-200/80 dark:border-emerald-500/25 bg-emerald-50/30 dark:bg-emerald-500/[0.04]",
    amber: "border-amber-200/80 dark:border-amber-500/25 bg-amber-50/30 dark:bg-amber-500/[0.04]",
    red: "border-rose-200/80 dark:border-rose-500/25 bg-rose-50/30 dark:bg-rose-500/[0.04]",
    indigo: "border-indigo-200/80 dark:border-indigo-500/25 bg-indigo-50/30 dark:bg-indigo-500/[0.04]",
  };
  return (
    <div className={`rounded-xl border p-3.5 shadow-sm transition-all hover:shadow-md flex-1 min-w-[160px] ${borderColors[tone]}`}>
      <div className="text-[11px] font-semibold text-ink-muted mb-1 truncate" title={label}>{label}</div>
      <div className={`text-base font-bold tabular-nums leading-tight ${valueColors[tone]}`}>{value}</div>
      {sub && <div className="text-[10px] text-ink-faint mt-1 truncate">{sub}</div>}
    </div>
  );
}

// ─── Print / Preview Report Component ────────────────────────────────────────

type RCProps = {
  printMode: PrintMode;
  from: string;
  to: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  settings: any;
  formatCurrency: (a: number, c: string) => string;
  formatDate: (d: string) => string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  salesInRange: any[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  purchasesInRange: any[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  salesReturnsInRange: any[];
  grossSalesInRange: number;
  totalSales: number;
  totalPurchases: number;
  returnsTotalInRange: number;
  collectedInRange: number;
  remainingInRange: number;
  estimatedProfit: number;
  estimatedProfitAfterBonuses: number;
  totalCommissions: number;
  totalEmployeeBonuses: number;
  totalReceivables: number;
  supplierPayablesTotal: number;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supplierDueInvoices: any[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supplierPayableRows: any[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  monthlyProfitData: any[];
  monthlyTotals: { sales: number; purchases: number; profit: number };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  topProducts: any[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  categoryShare: any[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  products: any[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  customers: any[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  suppliers: any[];
  customerBalance: (id: string) => number;
  supplierBalance: (id: string) => number;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  calculateSupplierCommission: (id: string) => any[];
  canViewEmployeeBonuses: boolean;
};

function SectionHeader({ title }: { title: string }) {
  return (
    <div className="flex items-center gap-2 mb-4 mt-6">
      <div className="w-1 h-5 bg-blue-600 rounded-full shrink-0" />
      <h3 className="text-sm font-bold text-ink whitespace-nowrap">{title}</h3>
      <div className="flex-1 h-px bg-line" />
    </div>
  );
}

function KpiCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="border-[1.5px] border-ink rounded-md overflow-hidden">
      <div className="px-2.5 py-1.5 text-[10px] font-bold text-ink bg-surface-muted border-b border-line">
        {label}
      </div>
      <div className="px-2.5 py-1.5 font-extrabold text-ink text-[13px] font-mono">
        {value}
      </div>
    </div>
  );
}

function PrintTable({
  head,
  body,
  foot,
}: {
  head: string[];
  body: (string | React.ReactNode)[][];
  foot?: (string | React.ReactNode)[];
}) {
  return (
    <table className="w-full text-xs border-collapse">
      <thead>
        <tr className="bg-slate-800 text-white">
          {head.map((h, i) => (
            <th key={i} className="px-3 py-2 text-right font-semibold whitespace-nowrap">{h}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {body.map((row, ri) => (
          <tr key={ri} className={ri % 2 === 0 ? "bg-surface" : "bg-surface-muted"}>
            {row.map((cell, ci) => (
              <td key={ci} className="px-3 py-1.5 text-right border-b border-line-soft">{cell}</td>
            ))}
          </tr>
        ))}
      </tbody>
      {foot && (
        <tfoot>
          <tr className="bg-surface-muted border-t-2 border-ink font-bold">
            {foot.map((cell, i) => (
              <td key={i} className="px-3 py-2 text-right tabular-nums">{cell}</td>
            ))}
          </tr>
        </tfoot>
      )}
    </table>
  );
}

function ReportContent({
  printMode, from, to, settings,
  formatCurrency, formatDate,
  salesInRange, purchasesInRange,
  grossSalesInRange, totalSales, totalPurchases,
  returnsTotalInRange, collectedInRange, remainingInRange,
  estimatedProfit, estimatedProfitAfterBonuses,
  totalCommissions, totalEmployeeBonuses,
  totalReceivables, supplierPayablesTotal,
  supplierDueInvoices, supplierPayableRows,
  monthlyProfitData, monthlyTotals,
  topProducts,
  products, customers, suppliers,
  customerBalance, supplierBalance,
  calculateSupplierCommission,
  canViewEmployeeBonuses,
}: RCProps) {
  const cur = settings.currency;

  const modeLabel: Record<PrintMode, string> = {
    full:         "التقرير المالي التحليلي الشامل",
    sales:        "تقرير مبيعات الفترة",
    purchases:    "تقرير مشتريات الفترة",
    stock:        "كشف حالة المخزون",
    customers:    "كشف أرصدة العملاء",
    suppliers:    "كشف مستحقات الموردين",
    supplierDues: "كشف المبالغ المستحقة للموردين",
    commissions:  "تقرير عمولات الموردين",
    monthlyProfit:"تقرير الربح الشهري",
    customerDues: "كشف المبالغ المستحقة من العملاء",
  };

  const periodLine =
    printMode === "supplierDues"
      ? "كل الفواتير المفتوحة حتى تاريخ الاستخراج"
      : `الفترة: ${formatDate(from)} — ${formatDate(to)}`;

  return (
    <div className="font-sans text-ink" dir="rtl">
      {/* ── Header ── */}
      <div style={{ borderBottom: "3px solid #0f172a", padding: "16px 32px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{
            width: 48, height: 48, borderRadius: 8, overflow: "hidden", flexShrink: 0,
            border: "1px solid rgb(var(--line))",
            background: settings.logoImage ? "transparent" : "#f1f5f9",
            display: "flex", alignItems: "center", justifyContent: "center",
          }}>
            {settings.logoImage
              ? <img src={settings.logoImage} alt="Logo" style={{ width: "100%", height: "100%", objectFit: "contain" }} />
              : <span style={{ fontWeight: 800, fontSize: 15, color: "#0f172a" }}>{settings.logoText}</span>
            }
          </div>
          <div>
            <div style={{ fontWeight: 800, fontSize: 17, color: "#0f172a", lineHeight: 1.2 }}>{settings.companyNameAr}</div>
            {settings.companyName && settings.companyName !== settings.companyNameAr && (
              <div style={{ fontSize: 11, color: "#64748b", marginTop: 2 }}>{settings.companyName}</div>
            )}
          </div>
        </div>
        <div style={{ textAlign: "left" }}>
          <div style={{ fontSize: 15, fontWeight: 800, color: "#0f172a" }}>{modeLabel[printMode]}</div>
          <div style={{ fontSize: 11, color: "#64748b", marginTop: 3 }}>{periodLine}</div>
        </div>
      </div>
      <div style={{ borderBottom: "1px solid #e2e8f0", padding: "5px 32px", display: "flex", justifyContent: "space-between", fontSize: 10, color: "#94a3b8" }}>
        <span>تاريخ الاستخراج: {formatDate(new Date().toISOString())}</span>
      </div>

      {/* ── Content ── */}
      <div className="px-8 py-6">

        {/* ════ FULL ════ */}
        {printMode === "full" && (
          <>
            <div className="grid grid-cols-3 gap-3 mb-6">
              <KpiCard label="إجمالي المبيعات" value={formatCurrency(totalSales, cur)} />
              <KpiCard label="إجمالي المشتريات" value={formatCurrency(totalPurchases, cur)} />
              <KpiCard label="الربح التشغيلي التقديري" value={formatCurrency(estimatedProfit, cur)} />
            </div>

            <div className="grid grid-cols-2 gap-8">
              <div>
                <SectionHeader title="الملخص المالي" />
                <PrintTable
                  head={["البيان", "القيمة"]}
                  body={[
                    ["إجمالي المبيعات", formatCurrency(totalSales, cur)],
                    ["إجمالي المشتريات", formatCurrency(totalPurchases, cur)],
                    ["مرتجعات البيع", formatCurrency(returnsTotalInRange, cur)],
                    ["الربح التشغيلي", formatCurrency(estimatedProfit, cur)],
                    ["عمولات الموردين المستحقة", formatCurrency(totalCommissions, cur)],
                    ...(canViewEmployeeBonuses ? [["بونص الموظفين", formatCurrency(totalEmployeeBonuses, cur)]] : []),
                    ...(canViewEmployeeBonuses ? [["صافي الربح بعد البونص", formatCurrency(estimatedProfitAfterBonuses, cur)]] : []),
                    ["ذمم العملاء المستحقة", formatCurrency(totalReceivables, cur)],
                    ["مستحقات الموردين", formatCurrency(supplierPayablesTotal, cur)],
                  ]}
                />
              </div>
              <div>
                <SectionHeader title="إحصاءات الفترة" />
                <PrintTable
                  head={["البيان", "العدد"]}
                  body={[
                    ["عدد فواتير المبيعات", salesInRange.length.toString()],
                    ["عدد فواتير المشتريات", purchasesInRange.length.toString()],
                    ["عدد أرقام القطع المتاحة", products.filter((p) => p.quantity > 0).length.toString()],
                    ["عدد العملاء", customers.length.toString()],
                    ["عدد الموردين", suppliers.length.toString()],
                    ["عدد الفواتير المفتوحة (موردين)", supplierDueInvoices.length.toString()],
                  ]}
                />
              </div>
            </div>

            {topProducts.length > 0 && (
              <>
                <SectionHeader title="أعلى قطع الغيار مبيعًا" />
                <PrintTable
                  head={["قطعة الغيار / Part No.", "الكمية", "الإيرادات"]}
                  body={topProducts.slice(0, 10).map((p) => [
                    `${p.name}${p.partNumber ? ` · ${p.partNumber}` : ""}`,
                    p.qty.toString(),
                    formatCurrency(p.revenue, cur),
                  ])}
                />
              </>
            )}

            {customers.some((c) => customerBalance(c.id) > 0) && (
              <>
                <SectionHeader title="أرصدة العملاء المستحقة" />
                <PrintTable
                  head={["العميل", "المبلغ المستحق"]}
                  body={customers
                    .map((c) => ({ c, bal: customerBalance(c.id) }))
                    .filter(({ bal }) => bal > 0)
                    .sort((a, b) => b.bal - a.bal)
                    .slice(0, 10)
                    .map(({ c, bal }) => [c.name, formatCurrency(bal, cur)])}
                  foot={["الإجمالي", formatCurrency(totalReceivables, cur)]}
                />
              </>
            )}
          </>
        )}

        {/* ════ SALES ════ */}
        {printMode === "sales" && (
          <>
            <div className="grid grid-cols-3 gap-3 mb-2">
              <KpiCard label="إجمالي المبيعات" value={formatCurrency(grossSalesInRange, cur)} />
              <KpiCard label="المرتجعات" value={formatCurrency(returnsTotalInRange, cur)} />
              <KpiCard label="صافي المبيعات" value={formatCurrency(totalSales, cur)} />
            </div>
            <div className="grid grid-cols-2 gap-3 mb-6">
              <KpiCard label="المبالغ المحصلة" value={formatCurrency(collectedInRange, cur)} />
              <KpiCard label="المبالغ المتبقية" value={formatCurrency(remainingInRange, cur)} />
            </div>

            <SectionHeader title="تفاصيل فواتير المبيعات" />
            <PrintTable
              head={["رقم الفاتورة", "التاريخ", "العميل", "نوع السعر", "الإجمالي", "المحصل", "المتبقي", "الحالة"]}
              body={salesInRange.map((s) => [
                s.invoiceNumber,
                formatDate(s.date),
                s.customerName || "—",
                s.priceType === "retail" ? "تجزئة" : "جملة",
                formatCurrency(s.total, cur),
                formatCurrency(s.amountReceived, cur),
                formatCurrency(s.remaining, cur),
                s.paymentType === "cash" ? "كاش" : "آجل",
              ])}
              foot={[
                `${salesInRange.length} فاتورة`,
                "",
                "",
                "",
                formatCurrency(grossSalesInRange, cur),
                formatCurrency(collectedInRange, cur),
                formatCurrency(remainingInRange, cur),
                "",
              ]}
            />
          </>
        )}

        {/* ════ PURCHASES ════ */}
        {printMode === "purchases" && (
          <>
            <div className="grid grid-cols-3 gap-3 mb-6">
              <KpiCard label="إجمالي المشتريات" value={formatCurrency(totalPurchases, cur)} />
              <KpiCard label="عدد الفواتير" value={purchasesInRange.length.toString()} />
              <KpiCard label="إجمالي المستحق للموردين" value={formatCurrency(supplierPayablesTotal, cur)} />
            </div>

            <SectionHeader title="تفاصيل فواتير المشتريات" />
            <PrintTable
              head={["رقم الفاتورة", "التاريخ", "المورد", "الإجمالي", "المدفوع", "المتبقي", "الحالة"]}
              body={purchasesInRange.map((p) => [
                p.invoiceNumber,
                formatDate(p.date),
                p.supplierName || "—",
                formatCurrency(p.total, cur),
                formatCurrency(p.amountPaid, cur),
                formatCurrency(p.remaining, cur),
                p.status === "paid" ? "مدفوع" : p.status === "partial" ? "جزئي" : "غير مدفوع",
              ])}
              foot={[
                `${purchasesInRange.length} فاتورة`,
                "",
                "",
                formatCurrency(totalPurchases, cur),
                formatCurrency(purchasesInRange.reduce((a: number, p: PurchaseInvoice) => a + p.amountPaid, 0), cur),
                formatCurrency(supplierPayablesTotal, cur),
                "",
              ]}
            />
          </>
        )}

        {/* ════ STOCK ════ */}
        {printMode === "stock" && (
          <>
            <div className="grid grid-cols-4 gap-3 mb-6">
              <KpiCard
                label="قيمة المخزون (شراء)"
                value={formatCurrency(products.reduce((a: number, p: Product) => a + p.quantity * (p.avgCost ?? p.purchasePrice), 0), cur)}

              />
              <KpiCard
                label="قيمة البيع جملة"
                value={formatCurrency(products.reduce((a: number, p: Product) => a + p.quantity * p.wholesalePrice, 0), cur)}

              />
              <KpiCard
                label="قيمة البيع تجزئة"
                value={formatCurrency(products.reduce((a: number, p: Product) => a + p.quantity * p.retailPrice, 0), cur)}
               
              />
              <KpiCard
                label="إجمالي أرقام القطع"
                value={products.length.toString()}
               
              />
            </div>

            <SectionHeader title="كشف المخزون التفصيلي" />
            <PrintTable
              head={["Part No.", "اسم القطعة", "الماركة / المنشأ / الرف", "الرصيد", "قيمة الشراء", "سعر تجار", "سعر عميل"]}
              body={products.map((p: Product) => [
                p.partNumber || p.code || "—",
                p.name,
                [p.partBrand, p.originCountry, p.rackLocation ? `RACK ${p.rackLocation}` : undefined].filter(Boolean).join(" · ") || p.category || "—",
                `${p.quantity} ${p.unit || ""}`.trim(),
                formatCurrency(p.quantity * (p.avgCost ?? p.purchasePrice), cur),
                formatCurrency(p.quantity * p.wholesalePrice, cur),
                formatCurrency(p.quantity * p.retailPrice, cur),
              ])}
              foot={[
                "", "",
                `${products.length} رقم قطعة`,
                "",
                formatCurrency(products.reduce((a: number, p: Product) => a + p.quantity * (p.avgCost ?? p.purchasePrice), 0), cur),
                formatCurrency(products.reduce((a: number, p: Product) => a + p.quantity * p.wholesalePrice, 0), cur),
                formatCurrency(products.reduce((a: number, p: Product) => a + p.quantity * p.retailPrice, 0), cur),
              ]}
            />
          </>
        )}

        {/* ════ CUSTOMERS ════ */}
        {printMode === "customers" && (
          <>
            <div className="grid grid-cols-2 gap-3 mb-6">
              <KpiCard label="إجمالي الأرصدة المستحقة" value={formatCurrency(totalReceivables, cur)} />
              <KpiCard label="عدد العملاء لديهم أرصدة" value={customers.filter((c: Customer) => customerBalance(c.id) > 0).length.toString()} />
            </div>
            <SectionHeader title="كشف أرصدة العملاء" />
            <PrintTable
              head={["العميل", "الهاتف", "الرصيد المستحق"]}
              body={customers
                .map((c: Customer) => ({ c, bal: customerBalance(c.id) }))
                .filter(({ bal }) => bal !== 0)
                .sort((a, b) => b.bal - a.bal)
                .map(({ c, bal }) => [c.name, c.phone || "—", formatCurrency(bal, cur)])}
              foot={["الإجمالي", "", formatCurrency(totalReceivables, cur)]}
            />
          </>
        )}

        {/* ════ SUPPLIERS ════ */}
        {printMode === "suppliers" && (
          <>
            <SectionHeader title="كشف مستحقات الموردين" />
            <PrintTable
              head={["المورد", "الهاتف", "المستحق"]}
              body={suppliers
                .map((s: Supplier) => ({ s, bal: supplierBalance(s.id) }))
                .filter(({ bal }) => bal !== 0)
                .sort((a, b) => b.bal - a.bal)
                .map(({ s, bal }) => [s.name, s.phone || "—", formatCurrency(bal, cur)])}
              foot={["الإجمالي", "", formatCurrency(suppliers.reduce((a: number, s: Supplier) => a + supplierBalance(s.id), 0), cur)]}
            />
          </>
        )}

        {/* ════ SUPPLIER DUES ════ */}
        {printMode === "supplierDues" && (
          <>
            <div className="grid grid-cols-3 gap-3 mb-6">
              <KpiCard label="إجمالي المطلوب دفعه" value={formatCurrency(supplierPayablesTotal, cur)} />
              <KpiCard label="عدد الفواتير المفتوحة" value={supplierDueInvoices.length.toString()} />
              <KpiCard label="عدد الموردين" value={supplierPayableRows.length.toString()} />
            </div>
            <SectionHeader title="ملخص الموردين" />
            <PrintTable
              head={["المورد", "عدد الفواتير", "الإجمالي", "المدفوع", "المتبقي"]}
              body={supplierPayableRows.map((r: SupplierPayableRow) => [
                r.supplierName,
                r.invoiceCount.toString(),
                formatCurrency(r.total, cur),
                formatCurrency(r.paid, cur),
                formatCurrency(r.remaining, cur),
              ])}
              foot={["الإجمالي", supplierDueInvoices.length.toString(), "", "", formatCurrency(supplierPayablesTotal, cur)]}
            />
            <SectionHeader title="تفاصيل الفواتير" />
            <PrintTable
              head={["رقم الفاتورة", "التاريخ", "المورد", "الإجمالي", "المدفوع", "المتبقي"]}
              body={supplierDueInvoices.map((inv: PurchaseInvoice) => [
                inv.invoiceNumber,
                formatDate(inv.date),
                inv.supplierName,
                formatCurrency(inv.total, cur),
                formatCurrency(inv.amountPaid, cur),
                formatCurrency(inv.remaining, cur),
              ])}
              foot={["", "", "", "", "", formatCurrency(supplierPayablesTotal, cur)]}
            />
          </>
        )}

        {/* ════ COMMISSIONS ════ */}
        {printMode === "commissions" && (
          <>
            <SectionHeader title="تقرير عمولات الموردين" />
            <PrintTable
              head={["المورد", "الشريحة (الهدف)", "المشتريات الحالية", "البونص المستحق"]}
              body={suppliers.flatMap((s: Supplier) =>
                calculateSupplierCommission(s.id).map((c: CommissionRow) => [
                  s.name,
                  `${formatCurrency(c.threshold, cur)} (${c.periodDays} يوم)`,
                  formatCurrency(c.totalPurchases, cur),
                  formatCurrency(c.earned, cur),
                ])
              )}
            />
          </>
        )}

        {/* ════ MONTHLY PROFIT ════ */}
        {printMode === "monthlyProfit" && (
          <>
            <div className="grid grid-cols-3 gap-3 mb-6">
              <KpiCard label="إجمالي المبيعات" value={formatCurrency(monthlyTotals.sales, cur)} />
              <KpiCard label="إجمالي المشتريات" value={formatCurrency(monthlyTotals.purchases, cur)} />
              <KpiCard label="إجمالي هامش الربح" value={formatCurrency(monthlyTotals.profit, cur)} />
            </div>
            <SectionHeader title="الربح الشهري التفصيلي" />
            <PrintTable
              head={["الشهر", "المبيعات", "المشتريات", "هامش الربح"]}
              body={monthlyProfitData.map((r: MonthlyProfitRow) => [
                r.month,
                formatCurrency(r.sales, cur),
                formatCurrency(r.purchases, cur),
                formatCurrency(r.profit, cur),
              ])}
              foot={[
                "الإجمالي",
                formatCurrency(monthlyTotals.sales, cur),
                formatCurrency(monthlyTotals.purchases, cur),
                formatCurrency(monthlyTotals.profit, cur),
              ]}
            />
          </>
        )}

        {/* ════ CUSTOMER DUES ════ */}
        {printMode === "customerDues" && (
          <>
            <div className="grid grid-cols-2 gap-3 mb-6">
              <KpiCard label="إجمالي المستحق من العملاء" value={formatCurrency(totalReceivables, cur)} />
              <KpiCard label="عدد العملاء لديهم أرصدة" value={customers.filter((c: Customer) => customerBalance(c.id) > 0).length.toString()} />
            </div>
            <SectionHeader title="كشف المبالغ المستحقة من العملاء" />
            <PrintTable
              head={["الكود", "العميل", "الهاتف", "المبلغ المستحق"]}
              body={customers
                .map((c: Customer) => ({ c, bal: customerBalance(c.id) }))
                .filter(({ bal }) => bal > 0)
                .sort((a, b) => b.bal - a.bal)
                .map(({ c, bal }) => [c.code || "—", c.name, c.phone || "—", formatCurrency(bal, cur)])}
              foot={["", "الإجمالي", "", formatCurrency(totalReceivables, cur)]}
            />
          </>
        )}

      </div>

      {/* ── Footer ── */}
      <div className="mx-8 mt-4 mb-6 pt-4 border-t border-line flex justify-between items-end text-[10px] text-ink-faint">
        <span>هذا التقرير تم استخراجه آلياً ولا يحتاج لختم رسمي.</span>
        <div className="text-center">
          <div className="mb-6 text-xs font-bold text-ink-muted">توقيع المسؤول</div>
          <div>.................................................</div>
        </div>
      </div>
    </div>
  );
}

