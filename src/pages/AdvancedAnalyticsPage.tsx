import { useMemo, useState, type ReactNode } from "react";
import { TrendingUp, Coins, Percent, Boxes, Info } from "lucide-react";
import {
  LineChart, Line, BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from "recharts";
import { PageHeader } from "../components/layout/AppLayout";
import { Card, CardBody, CardHeader } from "../components/ui/Card";
import { Badge } from "../components/ui/Badge";
import { Field, Input } from "../components/ui/Input";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "../components/ui/Tabs";
import { Table, TBody, TD, TH, THead, TR } from "../components/ui/Table";
import { useCatalog } from "../store/CatalogContext";
import { useInvoicing } from "../store/InvoicingContext";
import { useSettings } from "../store/SettingsContext";
import { formatCurrency } from "../lib/format";
import { localISODate, todayISO } from "../lib/utils";
import {
  aggregateProductSales, computeAbc, computeTurnover, computeMovement,
  computeCustomerProfitability, computeSalesTrend,
} from "../lib/analytics";

const ABC_COLORS: Record<"A" | "B" | "C", string> = { A: "#16a34a", B: "#f59e0b", C: "#94a3b8" };
const pct = (frac: number) => `${(frac * 100).toFixed(1)}%`;

function Stat({ icon, label, value, tone }: { icon: ReactNode; label: string; value: string; tone: string }) {
  return (
    <Card>
      <CardBody className="flex items-center gap-3">
        <div className={`w-10 h-10 rounded-lg grid place-items-center ${tone}`}>{icon}</div>
        <div className="min-w-0">
          <div className="text-xs text-ink-faint">{label}</div>
          <div className="text-lg font-bold text-ink truncate">{value}</div>
        </div>
      </CardBody>
    </Card>
  );
}

function EmptyHint({ children }: { children: ReactNode }) {
  return <div className="text-center py-10 text-sm text-ink-faint">{children}</div>;
}

export function AdvancedAnalyticsPage() {
  const { products, customers } = useCatalog();
  const { salesInvoices, salesReturns } = useInvoicing();
  const { settings } = useSettings();
  const cur = settings.currency;

  const [from, setFrom] = useState<string>(() => {
    const d = new Date();
    d.setDate(d.getDate() - 90);
    return localISODate(d);
  });
  const [to, setTo] = useState<string>(() => todayISO());

  const aggs = useMemo(
    () => aggregateProductSales(salesInvoices, salesReturns, from, to),
    [salesInvoices, salesReturns, from, to]
  );
  const abc = useMemo(() => computeAbc(aggs), [aggs]);
  const turnover = useMemo(() => computeTurnover(aggs, products), [aggs, products]);
  const movement = useMemo(
    () => computeMovement(salesInvoices, products, from, to, to),
    [salesInvoices, products, from, to]
  );
  const custProfit = useMemo(
    () => computeCustomerProfitability(salesInvoices, salesReturns, customers, from, to),
    [salesInvoices, salesReturns, customers, from, to]
  );
  const trend = useMemo(
    () => computeSalesTrend(salesInvoices, salesReturns, from, to),
    [salesInvoices, salesReturns, from, to]
  );

  const totalRevenue = aggs.reduce((s, a) => s + a.revenue, 0);
  const totalProfit = aggs.reduce((s, a) => s + a.profit, 0);
  const margin = totalRevenue !== 0 ? totalProfit / totalRevenue : 0;
  const hasData = aggs.length > 0;

  const abcSummary = useMemo(() => {
    const acc: Record<"A" | "B" | "C", { count: number; revenue: number }> = {
      A: { count: 0, revenue: 0 }, B: { count: 0, revenue: 0 }, C: { count: 0, revenue: 0 },
    };
    abc.forEach((r) => { acc[r.abcClass].count += 1; acc[r.abcClass].revenue += r.revenue; });
    return (["A", "B", "C"] as const).map((k) => ({ name: `فئة ${k}`, klass: k, ...acc[k] }));
  }, [abc]);

  const topCustomers = custProfit.slice(0, 8).map((c) => ({ name: c.customerName, profit: c.profit }));

  return (
    <>
      <PageHeader
        title="التحليلات المتقدمة"
        description="تحليلات احترافية للمبيعات والمخزون والعملاء — ضمن الباقات المدفوعة"
        actions={
          <div className="flex items-end gap-2">
            <Field label="من"><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="w-40" /></Field>
            <Field label="إلى"><Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="w-40" /></Field>
          </div>
        }
      />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Stat icon={<TrendingUp className="w-5 h-5 text-emerald-700 dark:text-emerald-400" />} tone="bg-emerald-50 dark:bg-emerald-500/10" label="صافي الإيراد" value={formatCurrency(totalRevenue, cur)} />
        <Stat icon={<Coins className="w-5 h-5 text-amber-700 dark:text-amber-400" />} tone="bg-amber-50 dark:bg-amber-500/10" label="صافي الربح" value={formatCurrency(totalProfit, cur)} />
        <Stat icon={<Percent className="w-5 h-5 text-blue-700 dark:text-blue-400" />} tone="bg-blue-50 dark:bg-blue-500/10" label="هامش الربح" value={pct(margin)} />
        <Stat icon={<Boxes className="w-5 h-5 text-violet-700 dark:text-violet-400" />} tone="bg-violet-50 dark:bg-violet-500/10" label="أصناف متحركة" value={String(aggs.length)} />
      </div>

      {!hasData ? (
        <Card><CardBody><EmptyHint>لا توجد مبيعات في هذه الفترة. غيّر نطاق التاريخ لعرض التحليلات.</EmptyHint></CardBody></Card>
      ) : (
        <Tabs defaultValue="trend" className="mt-2">
          <TabsList>
            <TabsTrigger value="trend">اتجاه المبيعات</TabsTrigger>
            <TabsTrigger value="abc">تصنيف ABC</TabsTrigger>
            <TabsTrigger value="turnover">دوران المخزون</TabsTrigger>
            <TabsTrigger value="movement">حركة الأصناف</TabsTrigger>
            <TabsTrigger value="customers">ربحية العملاء</TabsTrigger>
          </TabsList>

          {/* ── الاتجاه ───────────────────────────────────────────────── */}
          <TabsContent value="trend">
            <Card>
              <CardHeader title="الإيراد والربح الشهري" />
              <CardBody>
                <ResponsiveContainer width="100%" height={320}>
                  <LineChart data={trend} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgb(var(--line))" />
                    <XAxis dataKey="month" tick={{ fontSize: 12 }} />
                    <YAxis tick={{ fontSize: 12 }} />
                    <Tooltip formatter={(v) => formatCurrency(Number(v), cur)} />
                    <Legend />
                    <Line type="monotone" dataKey="revenue" name="الإيراد" stroke="#2563eb" strokeWidth={2} dot={{ r: 3 }} />
                    <Line type="monotone" dataKey="profit" name="الربح" stroke="#16a34a" strokeWidth={2} dot={{ r: 3 }} />
                  </LineChart>
                </ResponsiveContainer>
                <Table className="mt-4">
                  <THead><TR><TH>الشهر</TH><TH className="text-end">الإيراد</TH><TH className="text-end">الربح</TH><TH className="text-end">النمو الشهري</TH></TR></THead>
                  <TBody>
                    {trend.map((t) => (
                      <TR key={t.month}>
                        <TD className="font-mono">{t.month}</TD>
                        <TD className="text-end">{formatCurrency(t.revenue, cur)}</TD>
                        <TD className="text-end">{formatCurrency(t.profit, cur)}</TD>
                        <TD className="text-end">
                          {t.growthPct === null ? <span className="text-ink-faint">—</span> : (
                            <span className={t.growthPct >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400"}>
                              {t.growthPct >= 0 ? "▲" : "▼"} {Math.abs(t.growthPct).toFixed(1)}%
                            </span>
                          )}
                        </TD>
                      </TR>
                    ))}
                  </TBody>
                </Table>
              </CardBody>
            </Card>
          </TabsContent>

          {/* ── ABC ───────────────────────────────────────────────────── */}
          <TabsContent value="abc">
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
              <Card>
                <CardHeader title="توزيع القيمة" />
                <CardBody>
                  <ResponsiveContainer width="100%" height={240}>
                    <PieChart>
                      <Pie data={abcSummary.filter((s) => s.revenue > 0)} dataKey="revenue" nameKey="name" cx="50%" cy="50%" outerRadius={80} label={(e) => e.name}>
                        {abcSummary.filter((s) => s.revenue > 0).map((s) => <Cell key={s.klass} fill={ABC_COLORS[s.klass]} />)}
                      </Pie>
                      <Tooltip formatter={(v) => formatCurrency(Number(v), cur)} />
                    </PieChart>
                  </ResponsiveContainer>
                  <div className="space-y-1 mt-2 text-xs">
                    {abcSummary.map((s) => (
                      <div key={s.klass} className="flex items-center justify-between">
                        <span className="flex items-center gap-2">
                          <span className="w-3 h-3 rounded-sm inline-block" style={{ background: ABC_COLORS[s.klass] }} />
                          {s.name} — {s.count} صنف
                        </span>
                        <span className="font-mono text-ink-muted">{formatCurrency(s.revenue, cur)}</span>
                      </div>
                    ))}
                  </div>
                </CardBody>
              </Card>
              <Card className="lg:col-span-2">
                <CardHeader title="الأصناف حسب الأهمية (باريتو)" />
                <CardBody className="max-h-[360px] overflow-auto">
                  <Table>
                    <THead><TR><TH>الصنف</TH><TH className="text-center">الفئة</TH><TH className="text-end">الإيراد</TH><TH className="text-end">النسبة التراكمية</TH></TR></THead>
                    <TBody>
                      {abc.map((r) => (
                        <TR key={r.productId}>
                          <TD className="font-medium">{r.productName}</TD>
                          <TD className="text-center">
                            <Badge tone={r.abcClass === "A" ? "green" : r.abcClass === "B" ? "amber" : "slate"}>{r.abcClass}</Badge>
                          </TD>
                          <TD className="text-end">{formatCurrency(r.revenue, cur)}</TD>
                          <TD className="text-end font-mono text-ink-faint">{pct(r.cumulativeShare)}</TD>
                        </TR>
                      ))}
                    </TBody>
                  </Table>
                </CardBody>
              </Card>
            </div>
          </TabsContent>

          {/* ── الدوران ──────────────────────────────────────────────── */}
          <TabsContent value="turnover">
            <Card>
              <CardHeader title="معدل دوران المخزون" />
              <CardBody>
                <div className="flex items-start gap-2 bg-blue-50 dark:bg-blue-500/10 border border-blue-200 dark:border-blue-500/30 rounded-lg p-3 text-xs text-blue-800 dark:text-blue-400 mb-3">
                  <Info className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>معدل تقريبي = تكلفة المبيعات ÷ قيمة المخزون الحالي (لعدم توفر لقطات تاريخية للمخزون). كلما زاد الرقم زادت سرعة تصريف رأس المال. <strong>∞</strong> تعني بيع كامل للكمية.</span>
                </div>
                <Table>
                  <THead><TR><TH>الصنف</TH><TH className="text-end">تكلفة المبيعات</TH><TH className="text-end">قيمة المخزون</TH><TH className="text-end">معدل الدوران</TH></TR></THead>
                  <TBody>
                    {turnover.map((r) => (
                      <TR key={r.productId}>
                        <TD className="font-medium">{r.productName}</TD>
                        <TD className="text-end">{formatCurrency(r.cogs, cur)}</TD>
                        <TD className="text-end">{formatCurrency(r.stockValue, cur)}</TD>
                        <TD className="text-end font-mono">
                          {r.turnover === null ? <span className="text-emerald-600 dark:text-emerald-400 font-bold">∞</span> : `${r.turnover.toFixed(2)}×`}
                        </TD>
                      </TR>
                    ))}
                  </TBody>
                </Table>
              </CardBody>
            </Card>
          </TabsContent>

          {/* ── الحركة ───────────────────────────────────────────────── */}
          <TabsContent value="movement">
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
              <MovementCard title="الأسرع حركةً" rows={movement.fastMovers} kind="fast" />
              <MovementCard title="الأبطأ حركةً" rows={movement.slowMovers} kind="slow" />
              <MovementCard title="مخزون راكد" rows={movement.deadStock} kind="dead" />
            </div>
          </TabsContent>

          {/* ── ربحية العملاء ───────────────────────────────────────── */}
          <TabsContent value="customers">
            <Card>
              <CardHeader title="أعلى العملاء ربحيةً" />
              <CardBody>
                <ResponsiveContainer width="100%" height={280}>
                  <BarChart data={topCustomers} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgb(var(--line))" />
                    <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 12 }} />
                    <Tooltip formatter={(v) => formatCurrency(Number(v), cur)} />
                    <Bar dataKey="profit" name="الربح" fill="#2563eb" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
                <Table className="mt-4">
                  <THead><TR><TH>العميل</TH><TH className="text-center">عدد الفواتير</TH><TH className="text-end">الإيراد</TH><TH className="text-end">الربح</TH><TH className="text-end">الهامش</TH></TR></THead>
                  <TBody>
                    {custProfit.map((c) => (
                      <TR key={c.customerId}>
                        <TD className="font-medium">{c.customerName}</TD>
                        <TD className="text-center">{c.invoiceCount}</TD>
                        <TD className="text-end">{formatCurrency(c.revenue, cur)}</TD>
                        <TD className={`text-end font-medium ${c.profit >= 0 ? "text-emerald-700 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400"}`}>{formatCurrency(c.profit, cur)}</TD>
                        <TD className="text-end font-mono text-ink-faint">{pct(c.margin)}</TD>
                      </TR>
                    ))}
                  </TBody>
                </Table>
              </CardBody>
            </Card>
          </TabsContent>
        </Tabs>
      )}
    </>
  );
}

function MovementCard({
  title, rows, kind,
}: {
  title: string;
  rows: { productId: string; productName: string; qtySold: number; stockUnits: number; daysSinceLastSale: number | null }[];
  kind: "fast" | "slow" | "dead";
}) {
  return (
    <Card>
      <CardHeader title={title} />
      <CardBody className="max-h-[360px] overflow-auto">
        {rows.length === 0 ? (
          <EmptyHint>لا توجد أصناف</EmptyHint>
        ) : (
          <Table>
            <THead>
              <TR>
                <TH>الصنف</TH>
                {kind === "dead" ? <TH className="text-end">المخزون</TH> : <TH className="text-end">المباع</TH>}
                <TH className="text-end">آخر بيع</TH>
              </TR>
            </THead>
            <TBody>
              {rows.map((r) => (
                <TR key={r.productId}>
                  <TD className="font-medium">{r.productName}</TD>
                  <TD className="text-end font-mono">
                    {kind === "dead" ? r.stockUnits.toFixed(r.stockUnits % 1 === 0 ? 0 : 1) : r.qtySold.toFixed(r.qtySold % 1 === 0 ? 0 : 1)}
                  </TD>
                  <TD className="text-end text-xs">
                    {r.daysSinceLastSale === null ? (
                      <span className="text-rose-500">لم يُبع</span>
                    ) : r.daysSinceLastSale === 0 ? (
                      <span className="text-emerald-600 dark:text-emerald-400">اليوم</span>
                    ) : (
                      <span className="text-ink-faint">منذ {r.daysSinceLastSale} يوم</span>
                    )}
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </CardBody>
    </Card>
  );
}
