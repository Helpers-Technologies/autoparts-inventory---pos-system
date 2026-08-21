import { useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { AlertTriangle, ClipboardCopy, Download, FileText, Factory, PackagePlus, Printer, Search, ShoppingCart, Sparkles, TrendingUp } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { AutoPartsHero } from "../components/AutoPartsHero";
import { Badge } from "../components/ui/Badge";
import { Button } from "../components/ui/Button";
import { Card, CardBody, CardHeader } from "../components/ui/Card";
import { EmptyState } from "../components/ui/EmptyState";
import { Dialog } from "../components/ui/Dialog";
import { Input, Select } from "../components/ui/Input";
import { useToast } from "../components/ui/Toast";
import { formatCurrency, formatDate } from "../lib/format";
import { usePrintPreviewMode } from "../lib/usePrintPreviewMode";
import { buildXlsx } from "../lib/xlsx";
import { useCatalog } from "../store/CatalogContext";
import { useInvoicing } from "../store/InvoicingContext";
import { useSettings } from "../store/SettingsContext";
import { useFeatures } from "../lib/useFeatures";

function daysAgo(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return date.toISOString().slice(0, 10);
}

export function PurchasingAssistantPage() {
  const { products, suppliers } = useCatalog();
  const { salesInvoices, purchaseInvoices, salesReturns } = useInvoicing();
  const { settings } = useSettings();
  const excelExportEnabled = useFeatures().isEnabled("excelExport");
  const toast = useToast();
  const navigate = useNavigate();
  const [windowDays, setWindowDays] = useState(90);
  const [targetDays, setTargetDays] = useState(45);
  const [query, setQuery] = useState("");
  const [supplierFilter, setSupplierFilter] = useState("all");
  const [showPlanDialog, setShowPlanDialog] = useState(false);
  const [showSupplierSplit, setShowSupplierSplit] = useState(false);

  usePrintPreviewMode(showPlanDialog);
  const since = daysAgo(windowDays);

  // Sales, returns and last-purchase are each folded ONCE, keyed by product.
  //
  // This block used to re-filter and re-flatten the entire invoice history
  // inside the per-product map: for every one of 6,000 products it walked all
  // 48,483 sales invoices, allocated a fresh array of every line in them, then
  // threw all but one product's lines away — and did the same again for
  // returns and purchases. On a five-year shop the page took just under a
  // minute to open, most of it garbage collection.
  const soldByProduct = useMemo(() => {
    const totals = new Map<string, number>();
    for (const invoice of salesInvoices) {
      if (invoice.cancelled || invoice.date < since) continue;
      for (const line of invoice.lines) {
        totals.set(line.productId, (totals.get(line.productId) ?? 0) + line.quantity);
      }
    }
    return totals;
  }, [salesInvoices, since]);

  const returnedByProduct = useMemo(() => {
    const totals = new Map<string, number>();
    for (const item of salesReturns) {
      if (item.date < since) continue;
      for (const line of item.lines) {
        totals.set(line.productId, (totals.get(line.productId) ?? 0) + line.quantity);
      }
    }
    return totals;
  }, [salesReturns, since]);

  /** Newest purchase touching each product, plus that invoice's line for it. */
  const lastPurchaseByProduct = useMemo(() => {
    const latest = new Map<string, { invoice: (typeof purchaseInvoices)[number]; line: (typeof purchaseInvoices)[number]["lines"][number] }>();
    for (const invoice of purchaseInvoices) {
      for (const line of invoice.lines) {
        const current = latest.get(line.productId);
        if (!current || invoice.date.localeCompare(current.invoice.date) > 0) {
          latest.set(line.productId, { invoice, line });
        }
      }
    }
    return latest;
  }, [purchaseInvoices]);

  const supplierById = useMemo(
    () => new Map(suppliers.map((supplier) => [supplier.id, supplier])),
    [suppliers],
  );

  const rows = useMemo(() => products
    .filter((product) => !product.archived)
    .map((product) => {
      const sold = soldByProduct.get(product.id) ?? 0;
      const returned = returnedByProduct.get(product.id) ?? 0;
      const netSold = Math.max(0, sold - returned);
      const dailyRate = netSold / Math.max(1, windowDays);
      const coverDays = dailyRate > 0 ? product.quantity / dailyRate : null;
      const forecastNeed = Math.ceil(dailyRate * targetDays - product.quantity);
      const minimumNeed = product.quantity <= product.minStock
        ? (product.reorderQuantity ?? Math.max(1, product.minStock * 2 - product.quantity))
        : 0;
      const recommended = Math.max(0, forecastNeed, minimumNeed);
      const lastPurchaseEntry = lastPurchaseByProduct.get(product.id);
      const lastPurchase = lastPurchaseEntry?.invoice;
      const lastLine = lastPurchaseEntry?.line;
      const supplierId = product.supplierId || lastPurchase?.supplierId;
      const supplierName = (supplierId ? supplierById.get(supplierId)?.name : undefined) || lastPurchase?.supplierName || "غير محدد";
      const cost = lastLine?.price ?? product.purchasePrice;
      const urgency = product.quantity <= 0 ? 3 : product.quantity <= product.minStock ? 2 : coverDays !== null && coverDays < 15 ? 1 : 0;
      return { product, netSold, dailyRate, coverDays, recommended, supplierId, supplierName, cost, urgency };
    })
    .filter((row) => row.recommended > 0)
    .sort((a, b) => b.urgency - a.urgency || b.recommended * b.cost - a.recommended * a.cost),
    [products, lastPurchaseByProduct, returnedByProduct, soldByProduct, supplierById, targetDays, windowDays]);

  // Memoised so the per-supplier grouping below has a stable input; a fresh
  // array on every render would rebuild the groups on every keystroke.
  const filtered = useMemo(() => rows.filter((row) => {
    const text = `${row.product.name} ${row.product.partNumber ?? ""} ${row.product.code} ${row.product.partBrand ?? ""}`.toLowerCase();
    return text.includes(query.trim().toLowerCase()) && (supplierFilter === "all" || row.supplierId === supplierFilter || (supplierFilter === "none" && !row.supplierId));
  }), [rows, query, supplierFilter]);
  const totalBudget = filtered.reduce((sum, row) => sum + row.recommended * row.cost, 0);
  const totalUnits = filtered.reduce((sum, row) => sum + row.recommended, 0);

  function copyPlan() {
    const text = filtered.map((row) => `${row.product.partNumber || row.product.code}\t${row.product.name}\t${row.recommended}\t${row.supplierName}`).join("\n");
    void navigator.clipboard.writeText(`رقم القطعة\tالصنف\tالكمية\tالمورد\n${text}`);
    toast.success("تم نسخ خطة الشراء", "يمكن لصقها في Excel أو إرسالها للمورد.");
  }

  function downloadExcel() {
    const headers = [
      "#",
      "رقم القطعة",
      "اسم الصنف",
      "الماركة",
      "المورد",
      "المخزون الحالي",
      "مبيعات الفترة",
      "الكمية المقترحة",
      "سعر التكلفة",
      "التكلفة الإجمالية",
    ];
    const dataRows: (string | number)[][] = filtered.map((row, idx) => [
      idx + 1,
      row.product.partNumber || row.product.code,
      row.product.name,
      row.product.partBrand || "—",
      row.supplierName,
      row.product.quantity,
      row.netSold,
      row.recommended,
      row.cost,
      row.recommended * row.cost,
    ]);

    dataRows.push(["", "", "الإجمالي", "", "", "", "", totalUnits, "", totalBudget]);

    const bytes = buildXlsx([{ name: "خطة المشتريات", headers, rows: dataRows }]);
    const blob = new Blob([bytes], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `كشف_خطة_المشتريات_${new Date().toLocaleDateString("en-CA")}.xlsx`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success("تم تصدير كشف الخطة إلى Excel");
  }

  // A purchase invoice belongs to ONE supplier — it is what gets sent to them
  // and what their account is debited by. The plan, on the other hand, spans
  // whatever the shop happens to be short of, which is normally spread over
  // several suppliers. Pushing the whole plan into one invoice stamped with
  // the first row's supplier (what this did) produced an invoice claiming a
  // supplier had sold parts they never carried.
  //
  // So the plan is grouped by supplier, and each group becomes its own invoice.
  const planBySupplier = useMemo(() => {
    const groups = new Map<string, { supplierId: string; supplierName: string; rows: typeof filtered }>();
    for (const row of filtered) {
      const key = row.supplierId ?? "";
      let group = groups.get(key);
      if (!group) {
        group = { supplierId: key, supplierName: key ? row.supplierName : "بدون مورد محدد", rows: [] };
        groups.set(key, group);
      }
      group.rows.push(row);
    }
    return [...groups.values()]
      .map((group) => ({
        ...group,
        units: group.rows.reduce((sum, row) => sum + row.recommended, 0),
        budget: group.rows.reduce((sum, row) => sum + row.recommended * row.cost, 0),
      }))
      // Unassigned parts last: they need a supplier picked before they can be
      // ordered at all, so they are the least actionable group.
      .sort((a, b) => (a.supplierId ? 0 : 1) - (b.supplierId ? 0 : 1) || b.budget - a.budget);
  }, [filtered]);

  function openPurchaseInvoiceFor(supplierId: string, rows: typeof filtered) {
    navigate("/purchases/new", {
      state: {
        supplierId,
        lines: rows.map((row) => ({
          productId: row.product.id,
          quantity: row.recommended,
          price: row.cost,
          expiryDate: row.product.expiryDate,
        })),
      },
    });
  }

  function createPurchaseInvoiceFromPlan() {
    if (filtered.length === 0) {
      toast.error("لا توجد بنود في الخطة الحالية تحوّل إلى فاتورة");
      return;
    }
    if (planBySupplier.length === 1) {
      const only = planBySupplier[0];
      openPurchaseInvoiceFor(only.supplierId, only.rows);
      return;
    }
    setShowSupplierSplit(true);
  }

  const selectedSupplierName =
    supplierFilter === "all"
      ? "كل الموردين"
      : supplierFilter === "none"
      ? "بدون مورد محدد"
      : suppliers.find((s) => s.id === supplierFilter)?.name || "مورد محدد";

  return (
    <div className="space-y-5" dir="rtl">
      <AutoPartsHero
        icon={Sparkles}
        title="مساعد المشتريات الذكي"
        description="يحوّل حركة البيع والحد الأدنى والتغطية بالأيام إلى خطة طلب واضحة، مع آخر مورد وتكلفة وميزانية متوقعة."
        stats={[
          { label: "قطع مقترح طلبها", value: filtered.length },
          { label: "وحدات مطلوبة", value: totalUnits },
          { label: "ميزانية تقديرية", value: formatCurrency(totalBudget, settings.currency) },
        ]}
        actions={
          <>
            <Button
              variant="outline"
              className="border-white/20 bg-white/10 text-white hover:bg-white/20 font-medium"
              onClick={() => setShowPlanDialog(true)}
            >
              <FileText className="h-4 w-4" /> كشف الخطة
            </Button>
            <Button
              className="bg-amber-400 text-slate-950 hover:bg-amber-300 font-semibold"
              onClick={createPurchaseInvoiceFromPlan}
            >
              <ShoppingCart className="h-4 w-4" />{" "}
              {planBySupplier.length > 1
                ? `تحويل الخطة إلى فواتير شراء (${planBySupplier.length} مورد)`
                : `تحويل الخطة إلى فاتورة شراء (${filtered.length})`}
            </Button>
          </>
        }
      />

      <Card>
        <CardBody className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
          <div className="relative xl:col-span-2">
            <Search className="absolute right-3 top-2.5 h-4 w-4 text-ink-faint" />
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="ابحث باسم أو Part Number..."
              className="pr-10"
            />
          </div>
          <Select
            value={supplierFilter}
            onChange={(event) => setSupplierFilter(event.target.value)}
          >
            <option value="all">كل الموردين</option>
            <option value="none">بدون مورد محدد</option>
            {suppliers
              .filter((supplier) => !supplier.archived)
              .map((supplier) => (
                <option key={supplier.id} value={supplier.id}>
                  {supplier.name}
                </option>
              ))}
          </Select>
          <Select
            value={windowDays}
            onChange={(event) => setWindowDays(Number(event.target.value))}
          >
            <option value={30}>حركة آخر 30 يوم</option>
            <option value={60}>حركة آخر 60 يوم</option>
            <option value={90}>حركة آخر 90 يوم</option>
            <option value={180}>حركة آخر 180 يوم</option>
          </Select>
          <Select
            value={targetDays}
            onChange={(event) => setTargetDays(Number(event.target.value))}
          >
            <option value={30}>تغطية 30 يوم</option>
            <option value={45}>تغطية 45 يوم</option>
            <option value={60}>تغطية 60 يوم</option>
            <option value={90}>تغطية 90 يوم</option>
          </Select>
        </CardBody>
      </Card>

      <div className="grid gap-3 md:grid-cols-3">
        <Insight
          icon={AlertTriangle}
          title="الأولوية الأولى"
          value={`${filtered.filter((row) => row.product.quantity <= 0).length} قطعة نافدة`}
          tone="rose"
        />
        <Insight
          icon={TrendingUp}
          title="سريعة الحركة"
          value={`${filtered.filter((row) => row.dailyRate >= 0.2).length} قطعة`}
          tone="cyan"
        />
        <Insight
          icon={PackagePlus}
          title="بدون مورد"
          value={`${filtered.filter((row) => !row.supplierId).length} قطعة تحتاج ربط`}
          tone="amber"
        />
      </div>

      <Card>
        <CardHeader
          title="خطة إعادة الطلب"
          subtitle="المقترح لا يغير المخزون؛ راجعه قبل إنشاء فاتورة الشراء"
          actions={
            <Button
              size="sm"
              variant="outline"
              onClick={() => setShowPlanDialog(true)}
              className="gap-1 text-xs"
            >
              <Printer className="w-3.5 h-3.5" /> طباعة / PDF
            </Button>
          }
        />
        <CardBody className="p-0">
          {filtered.length === 0 ? (
            <div className="p-6">
              <EmptyState
                icon={<PackagePlus className="h-6 w-6" />}
                title="لا توجد احتياجات شراء وفق الفلاتر الحالية"
              />
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-surface-muted text-xs text-ink-muted">
                  <tr>
                    <th className="p-3 text-right">القطعة</th>
                    <th className="p-3 text-right">المورد</th>
                    <th className="p-3 text-center">المخزون</th>
                    <th className="p-3 text-center">مبيعات الفترة</th>
                    <th className="p-3 text-center">التغطية</th>
                    <th className="p-3 text-center">المقترح</th>
                    <th className="p-3 text-left">التكلفة المتوقعة</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((row) => (
                    <tr key={row.product.id} className="border-t border-line hover:bg-surface-muted/30">
                      <td className="p-3">
                        <div className="font-semibold text-ink">{row.product.name}</div>
                        <div className="mt-0.5 font-mono text-[11px] text-ink-faint" dir="ltr">
                          {row.product.partNumber || row.product.code} · {row.product.partBrand || "—"}
                        </div>
                      </td>
                      <td className="p-3">
                        <Badge tone={row.supplierId ? "blue" : "amber"}>{row.supplierName}</Badge>
                      </td>
                      <td className="p-3 text-center">
                        <Badge
                          tone={
                            row.product.quantity <= 0
                              ? "red"
                              : row.product.quantity <= row.product.minStock
                              ? "amber"
                              : "green"
                          }
                        >
                          {row.product.quantity}
                        </Badge>
                      </td>
                      <td className="p-3 text-center">{row.netSold}</td>
                      <td className="p-3 text-center">
                        {row.coverDays === null ? "لا حركة" : `${Math.round(row.coverDays)} يوم`}
                      </td>
                      <td className="p-3 text-center">
                        <strong className="text-lg text-brand-700">{row.recommended}</strong>
                      </td>
                      <td className="p-3 text-left font-bold">
                        {formatCurrency(row.recommended * row.cost, settings.currency)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardBody>
      </Card>

      <Dialog
        open={showSupplierSplit}
        onClose={() => setShowSupplierSplit(false)}
        title="الخطة موزّعة على الموردين"
        subtitle="كل مورد له فاتورة شراء لوحده — اختر المورد اللي هتطلب منه دلوقتي"
        width="lg"
        footer={<Button variant="outline" onClick={() => setShowSupplierSplit(false)}>إغلاق</Button>}
      >
        <div className="space-y-2">
          {planBySupplier.map((group) => (
            <div
              key={group.supplierId || "none"}
              className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line bg-surface p-3"
            >
              <div className="flex min-w-0 items-center gap-3">
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-surface-muted text-ink-muted">
                  <Factory className="h-4 w-4" />
                </span>
                <div className="min-w-0">
                  <div className="truncate text-sm font-semibold text-ink">{group.supplierName}</div>
                  <div className="text-[11px] text-ink-muted">
                    {group.rows.length} قطعة · {group.units} وحدة ·{" "}
                    {formatCurrency(group.budget, settings.currency)}
                  </div>
                </div>
              </div>
              <Button
                size="sm"
                variant={group.supplierId ? "primary" : "outline"}
                onClick={() => {
                  setShowSupplierSplit(false);
                  openPurchaseInvoiceFor(group.supplierId, group.rows);
                }}
              >
                <ShoppingCart className="h-3.5 w-3.5" />
                {group.supplierId ? "إنشاء فاتورة" : "إنشاء فاتورة واختيار المورد"}
              </Button>
            </div>
          ))}
          <p className="text-[11px] leading-relaxed text-ink-faint">
            الفاتورة بتتفتح كمسودة بالبنود والأسعار — راجعها وعدّل قبل الحفظ.
          </p>
        </div>
      </Dialog>

      {/* Print / Export Modal Overlay */}
      {showPlanDialog &&
        createPortal(
          <div
            className="fixed inset-0 z-50 bg-black/70 flex flex-col items-center overflow-y-auto py-8 px-4 print-preview-backdrop"
            onClick={(e) => { if (e.target === e.currentTarget) setShowPlanDialog(false); }}
          >
            {/* Top Control Bar (Hidden on print) */}
            <div className="w-full max-w-[760px] mb-4 flex items-center justify-between no-print">
            <div className="flex items-center gap-2">
              <button
                onClick={() => window.print()}
                className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold px-4 h-9 rounded-lg shadow cursor-pointer"
              >
                <Printer className="w-4 h-4" /> طباعة / حفظ PDF
              </button>
              {excelExportEnabled && (
                <button
                  onClick={downloadExcel}
                  className="flex items-center gap-2 bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold px-4 h-9 rounded-lg shadow cursor-pointer"
                >
                  <Download className="w-4 h-4" /> تصدير Excel
                </button>
              )}
              <button
                onClick={copyPlan}
                className="flex items-center gap-2 bg-slate-700 hover:bg-slate-800 text-white text-sm font-semibold px-4 h-9 rounded-lg shadow cursor-pointer"
              >
                <ClipboardCopy className="w-4 h-4" /> نسخ النص
              </button>
            </div>
            <button
              onClick={() => setShowPlanDialog(false)}
              className="flex items-center gap-1.5 bg-white/20 hover:bg-white/30 text-white text-sm font-medium px-4 h-9 rounded-lg cursor-pointer"
            >
              إغلاق ✕
            </button>
          </div>

          {/* Printable Document Paper */}
          <div className="print-preview-area bg-white text-slate-900 rounded-xl shadow-2xl p-6 print:p-0 max-w-[760px] w-full font-sans text-right" dir="rtl">
            <style
              dangerouslySetInnerHTML={{
                __html: `
                  @media print {
                    @page {
                      size: A4 portrait;
                      margin: 8mm 6mm;
                    }
                    html, body {
                      background: white !important;
                      color: black !important;
                    }
                    .print-preview-backdrop {
                      position: static !important;
                      background: transparent !important;
                      padding: 0 !important;
                      margin: 0 !important;
                      display: block !important;
                    }
                    .print-preview-area {
                      width: 100% !important;
                      max-width: 100% !important;
                      padding: 0 !important;
                      margin: 0 !important;
                      box-shadow: none !important;
                      border-radius: 0 !important;
                      background: white !important;
                    }
                    table {
                      width: 100% !important;
                      table-layout: fixed !important;
                    }
                    th {
                      background-color: #1e293b !important;
                      color: white !important;
                      -webkit-print-color-adjust: exact !important;
                      print-color-adjust: exact !important;
                    }
                    tr {
                      page-break-inside: avoid !important;
                      break-inside: avoid !important;
                    }
                  }
                `,
              }}
            />

            {/* Header info */}
            <div className="flex items-start justify-between border-b-2 border-slate-900 pb-3 mb-3">
              <div>
                <h1 className="text-2xl font-black text-slate-900">
                  {settings.companyNameAr || settings.companyName || "اسم المحل"}
                </h1>
                {settings.companyNameAr && settings.companyName && settings.companyNameAr !== settings.companyName && (
                  <div className="text-xs text-slate-600 font-semibold mt-0.5">{settings.companyName}</div>
                )}
                <div className="text-xs text-slate-500 font-medium mt-0.5">نظام إدارة المشتريات والمخزون</div>
              </div>
              <div className="text-left">
                <h2 className="text-lg font-black text-blue-950">
                  كشف خطة المشتريات والطلب
                </h2>
                <div className="text-xs text-slate-600 font-medium mt-0.5">
                  تاريخ الاستخراج: <span className="font-bold text-slate-900">{formatDate(new Date().toISOString())}</span>
                </div>
              </div>
            </div>

            {/* Filter Parameters Summary Bar */}
            <div className="grid grid-cols-3 gap-2 bg-slate-100 p-2.5 rounded-lg border border-slate-300 text-xs mb-3 font-medium">
              <div>
                <span className="text-slate-600">تحليل المبيعات: </span>
                <strong className="text-slate-900">آخر {windowDays} يوم</strong>
              </div>
              <div>
                <span className="text-slate-600">فترة التغطية: </span>
                <strong className="text-slate-900">{targetDays} يوم</strong>
              </div>
              <div>
                <span className="text-slate-600">المورد المحدد: </span>
                <strong className="text-slate-900">{selectedSupplierName}</strong>
              </div>
            </div>

            {/* Executive Summary Cards */}
            <div className="grid grid-cols-3 gap-3 mb-4">
              <div className="p-2.5 bg-slate-50 border border-slate-300 rounded-lg text-center">
                <div className="text-xs text-slate-600 font-semibold">أصناف مطلوب شراؤها</div>
                <div className="text-lg font-black text-slate-900 mt-0.5">{filtered.length} صنف</div>
              </div>
              <div className="p-2.5 bg-slate-50 border border-slate-300 rounded-lg text-center">
                <div className="text-xs text-slate-600 font-semibold">إجمالي قطع الطلب</div>
                <div className="text-lg font-black text-blue-900 mt-0.5">{totalUnits} قطعة</div>
              </div>
              <div className="p-2.5 bg-slate-50 border border-slate-300 rounded-lg text-center">
                <div className="text-xs text-slate-600 font-semibold">الميزانية التقديرية</div>
                <div className="text-lg font-black text-emerald-800 mt-0.5">
                  {formatCurrency(totalBudget, settings.currency)}
                </div>
              </div>
            </div>

            {/* Detailed Items Table */}
            <table className="w-full text-xs border-collapse border border-slate-300 mb-5 table-fixed">
              <colgroup>
                <col style={{ width: "32px" }} />
                <col style={{ width: "115px" }} />
                <col />
                <col style={{ width: "85px" }} />
                <col style={{ width: "45px" }} />
                <col style={{ width: "45px" }} />
                <col style={{ width: "48px" }} />
                <col style={{ width: "65px" }} />
                <col style={{ width: "80px" }} />
              </colgroup>
              <thead>
                <tr className="bg-slate-800 text-white font-bold border-b-2 border-slate-900 text-[11px]">
                  <th className="px-1 py-2 text-center border border-slate-700">#</th>
                  <th className="px-1.5 py-2 text-right border border-slate-700">رقم القطعة / الكود</th>
                  <th className="px-2 py-2 text-right border border-slate-700">الصنف وتفاصيل التوافق والماركة</th>
                  <th className="px-1.5 py-2 text-right border border-slate-700">المورد</th>
                  <th className="px-1 py-2 text-center border border-slate-700">المخزون</th>
                  <th className="px-1 py-2 text-center border border-slate-700">المبيعات</th>
                  <th className="px-1 py-2 text-center border border-slate-700 font-extrabold text-blue-200">الطلب</th>
                  <th className="px-1.5 py-2 text-left border border-slate-700">السعر</th>
                  <th className="px-1.5 py-2 text-left border border-slate-700">الإجمالي</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((row, idx) => (
                  <tr key={row.product.id} className={idx % 2 === 0 ? "bg-white" : "bg-slate-50/70"}>
                    <td className="px-1 py-2 text-center border border-slate-300 text-slate-500 font-mono text-[10px] align-top">{idx + 1}</td>
                    <td className="px-1.5 py-2 text-right border border-slate-300 font-mono text-[10.5px] whitespace-nowrap align-top font-semibold text-slate-800" dir="ltr">
                      {row.product.partNumber || row.product.code}
                    </td>
                    <td className="px-2 py-2 text-right border border-slate-300 align-top">
                      <div className="font-bold text-slate-900 text-[11.5px] leading-snug break-words">
                        {row.product.name}
                      </div>
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10px] text-slate-600 mt-1">
                        {row.product.partBrand && (
                          <span className="font-semibold text-slate-700 bg-slate-100 px-1.5 py-0.5 rounded border border-slate-200">
                            الماركة: {row.product.partBrand}
                          </span>
                        )}
                        {row.product.rackLocation && (
                          <span className="text-slate-500">
                            الرف: {row.product.rackLocation}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-1.5 py-2 text-right border border-slate-300 text-slate-700 whitespace-nowrap align-top text-[11px]">
                      {row.supplierName}
                    </td>
                    <td className="px-1 py-2 text-center border border-slate-300 font-semibold align-top text-xs">
                      {row.product.quantity}
                    </td>
                    <td className="px-1 py-2 text-center border border-slate-300 text-slate-600 align-top text-xs">
                      {row.netSold}
                    </td>
                    <td className="px-1 py-2 text-center border border-slate-300 font-black text-blue-900 text-sm bg-blue-50/60 align-top">
                      {row.recommended}
                    </td>
                    <td className="px-1.5 py-2 text-left border border-slate-300 text-slate-700 whitespace-nowrap text-[11px] align-top">
                      {formatCurrency(row.cost, settings.currency)}
                    </td>
                    <td className="px-1.5 py-2 text-left border border-slate-300 font-bold text-slate-900 whitespace-nowrap text-[11px] align-top">
                      {formatCurrency(row.recommended * row.cost, settings.currency)}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="bg-slate-200 text-slate-900 font-black border-t-2 border-slate-400">
                  <td colSpan={6} className="px-2 py-2 text-end border border-slate-300">
                    الإجمالي الكلي للطلب:
                  </td>
                  <td className="px-1 py-2 text-center border border-slate-300 text-blue-950 text-xs bg-blue-100/80 font-black">
                    {totalUnits}
                  </td>
                  <td className="px-1.5 py-2 border border-slate-300"></td>
                  <td className="px-1.5 py-2 text-left border border-slate-300 text-emerald-950 text-xs whitespace-nowrap font-black">
                    {formatCurrency(totalBudget, settings.currency)}
                  </td>
                </tr>
              </tfoot>
            </table>

            {/* Footer Signature Box */}
            <div className="mt-6 pt-3 border-t-2 border-slate-300 grid grid-cols-2 text-xs font-bold text-slate-800">
              <div>توقيع أمين المخزن: .......................................</div>
              <div className="text-left">اعتماد مدير المشتريات / صاحب المحل: .......................................</div>
            </div>

            <div className="text-[10px] text-slate-400 text-center mt-5">
              تم استخراج هذا التقرير آلياً عبر نظام إدارة قطع الغيار والمبيعات · مساعد المشتريات الذكي
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}

function Insight({
  icon: Icon,
  title,
  value,
  tone,
}: {
  icon: typeof AlertTriangle;
  title: string;
  value: string;
  tone: "rose" | "cyan" | "amber";
}) {
  const color =
    tone === "rose"
      ? "bg-rose-50 text-rose-700 dark:bg-rose-500/10"
      : tone === "cyan"
      ? "bg-cyan-50 text-cyan-700 dark:bg-cyan-500/10"
      : "bg-amber-50 text-amber-700 dark:bg-amber-500/10";
  return (
    <Card>
      <CardBody className="flex items-center gap-3">
        <div className={`grid h-11 w-11 place-items-center rounded-xl ${color}`}>
          <Icon className="h-5 w-5" />
        </div>
        <div>
          <div className="text-xs text-ink-muted">{title}</div>
          <div className="mt-1 font-bold text-ink">{value}</div>
        </div>
      </CardBody>
    </Card>
  );
}
