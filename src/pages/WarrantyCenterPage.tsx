import { useMemo, useRef, useState } from "react";
import { Banknote, CalendarClock, CheckCircle2, ChevronDown, FilterX, Info, PackageCheck, Search, ShieldAlert, ShieldCheck, SlidersHorizontal, Truck, XCircle } from "lucide-react";
import { AutoPartsHero } from "../components/AutoPartsHero";
import { Badge } from "../components/ui/Badge";
import { Button } from "../components/ui/Button";
import { Card, CardBody, CardHeader } from "../components/ui/Card";
import { Dialog } from "../components/ui/Dialog";
import { EmptyState } from "../components/ui/EmptyState";
import { Field, Input, Select, Textarea } from "../components/ui/Input";
import { useToast } from "../components/ui/Toast";
import { useAutoPartsPro } from "../store/AutoPartsProContext";
import { useCatalog } from "../store/CatalogContext";
import { useInvoicing } from "../store/InvoicingContext";
import { useSettings } from "../store/SettingsContext";
import { formatCurrency } from "../lib/format";
import type { WarrantyClaim, WarrantyClaimStatus } from "../types";

const STATUS_LABELS: Record<WarrantyClaimStatus, string> = {
  open: "طلب جديد",
  inspecting: "تحت الفحص",
  supplier: "عند المورد",
  approved: "تمت الموافقة",
  rejected: "مرفوض",
  replaced: "تم الاستبدال",
  compensated: "تم التعويض نقديًا",
};

type CoverageRow = {
  invoiceId: string;
  invoiceNumber: string;
  invoiceLineId: string;
  customerId: string;
  customerName: string;
  productId: string;
  productName: string;
  soldAt: string;
  expiresAt: string;
  active: boolean;
  supplierId?: string;
};

function addMonths(date: string, months: number): string {
  const value = new Date(`${date}T12:00:00`);
  value.setMonth(value.getMonth() + months);
  return value.toISOString().slice(0, 10);
}

export function WarrantyCenterPage() {
  const { salesInvoices, addCashEntry } = useInvoicing();
  const { products, suppliers, adjustStock } = useCatalog();
  const { settings } = useSettings();
  const pro = useAutoPartsPro();
  const toast = useToast();

  const [query, setQuery] = useState("");
  const [tab, setTab] = useState<"coverage" | "claims">("coverage");
  const [claimRow, setClaimRow] = useState<CoverageRow | null>(null);
  const [complaint, setComplaint] = useState("");
  const [serialNumber, setSerialNumber] = useState("");
  const [showSerialInfo, setShowSerialInfo] = useState(false);
  const [compensationClaim, setCompensationClaim] = useState<WarrantyClaim | null>(null);
  const [compensationAmount, setCompensationAmount] = useState(0);
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [pageSize, setPageSize] = useState(10);
  const [visibleCount, setVisibleCount] = useState(10);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const compensationLocks = useRef(new Set<string>());
  const today = new Date().toISOString().slice(0, 10);

  function soldLineTotal(claim: WarrantyClaim): number {
    const invoice = salesInvoices.find((item) => item.id === claim.invoiceId);
    return invoice?.lines.find((line) => line.id === claim.invoiceLineId)?.subtotal ?? 0;
  }

  function openCompensationDialog(claim: WarrantyClaim) {
    if (claim.compensationCashEntryId) {
      pro.updateWarrantyClaim(claim.id, { status: "compensated" });
      return;
    }
    setCompensationClaim(claim);
    setCompensationAmount(soldLineTotal(claim));
  }

  function changeClaimStatus(claim: WarrantyClaim, status: WarrantyClaimStatus) {
    if (status === "compensated") {
      openCompensationDialog(claim);
      return;
    }
    if (status === "replaced" && claim.status !== "replaced" && !claim.stockDeducted) {
      const product = products.find((p) => p.id === claim.productId);
      const unitCost = product ? (product.avgCost ?? product.purchasePrice) : 0;
      if (product) {
        adjustStock(claim.productId, -1, `استبدال ضمان — طلب #${claim.id} (فاتورة ${claim.invoiceNumber})`);
      }
      pro.updateWarrantyClaim(claim.id, { status, stockDeducted: true, replacementCost: unitCost });
      toast.success("تم تسجيل الاستبدال", product ? `تم خصم قطعة من المخزون بتكلفة ${unitCost.toFixed(2)}` : "تعذر العثور على المنتج لخصمه من المخزون");
      return;
    }
    pro.updateWarrantyClaim(claim.id, { status });
  }

  function submitCompensation() {
    if (!compensationClaim || compensationClaim.compensationCashEntryId) return;
    if (compensationLocks.current.has(compensationClaim.id)) return;
    if (!Number.isFinite(compensationAmount) || compensationAmount <= 0) {
      toast.error("أدخل مبلغ تعويض صحيح");
      return;
    }

    compensationLocks.current.add(compensationClaim.id);
    const cashEntry = addCashEntry({
      type: "adjustment",
      amount: -compensationAmount,
      description: `تعويض نقدي لضمان ${compensationClaim.productName} — فاتورة ${compensationClaim.invoiceNumber} — ${compensationClaim.customerName}`,
      referenceId: compensationClaim.id,
      date: today,
      paymentMethod: "cash",
    });
    pro.updateWarrantyClaim(compensationClaim.id, {
      status: "compensated",
      compensationAmount,
      compensationCashEntryId: cashEntry.id,
      compensatedAt: new Date().toISOString(),
    });
    toast.success("تم تسجيل التعويض النقدي", `تم خصم ${formatCurrency(compensationAmount, settings.currency)} من الخزينة`);
    setCompensationClaim(null);
    setCompensationAmount(0);
  }

  const coverage = useMemo<CoverageRow[]>(() => salesInvoices
    .filter((invoice) => !invoice.cancelled)
    .flatMap((invoice) => invoice.lines
      .filter((line) => (line.warrantyMonths ?? 0) > 0)
      .map((line) => {
        const expiresAt = addMonths(invoice.date, line.warrantyMonths ?? 0);
        return {
          invoiceId: invoice.id,
          invoiceNumber: invoice.invoiceNumber,
          invoiceLineId: line.id,
          customerId: invoice.customerId,
          customerName: invoice.customerName,
          productId: line.productId,
          productName: line.productName,
          soldAt: invoice.date,
          expiresAt,
          active: expiresAt >= today,
          supplierId: products.find((product) => product.id === line.productId)?.supplierId,
        };
      }))
    .sort((a, b) => b.soldAt.localeCompare(a.soldAt)), [products, salesInvoices, today]);

  const [coverageFilter, setCoverageFilter] = useState<"all" | "active" | "expired" | "compensated">("all");
  const [claimStatusFilter, setClaimStatusFilter] = useState<string>("all");

  const q = query.trim().toLowerCase();
  const compensatedLineIds = useMemo(
    () => new Set(pro.warrantyClaims.filter((claim) => claim.status === "compensated").map((claim) => claim.invoiceLineId)),
    [pro.warrantyClaims],
  );
  const filteredCoverage = useMemo(() => {
    return coverage
      .filter((row) => {
        if (coverageFilter === "compensated") return compensatedLineIds.has(row.invoiceLineId);
        if (coverageFilter === "active") return row.active && !compensatedLineIds.has(row.invoiceLineId);
        if (coverageFilter === "expired") return !row.active && !compensatedLineIds.has(row.invoiceLineId);
        return true;
      })
      .filter((row) => !dateFrom || row.soldAt >= dateFrom)
      .filter((row) => !dateTo || row.soldAt <= dateTo)
      .filter((row) => `${row.invoiceNumber} ${row.customerName} ${row.productName}`.toLowerCase().includes(q));
  }, [compensatedLineIds, coverage, coverageFilter, dateFrom, dateTo, q]);

  const filteredClaims = useMemo(() => {
    return pro.warrantyClaims
      .filter((claim) => {
        if (claimStatusFilter !== "all") return claim.status === claimStatusFilter;
        return true;
      })
      .filter((claim) => !dateFrom || claim.openedAt.slice(0, 10) >= dateFrom)
      .filter((claim) => !dateTo || claim.openedAt.slice(0, 10) <= dateTo)
      .filter((claim) => `${claim.invoiceNumber} ${claim.customerName} ${claim.productName} ${claim.serialNumber ?? ""}`.toLowerCase().includes(q))
      .sort((a, b) => b.openedAt.localeCompare(a.openedAt));
  }, [claimStatusFilter, dateFrom, dateTo, pro.warrantyClaims, q]);

  const visibleCoverage = filteredCoverage.slice(0, visibleCount);
  const visibleClaims = filteredClaims.slice(0, visibleCount);
  const activeResultCount = tab === "coverage" ? filteredCoverage.length : filteredClaims.length;
  const shownResultCount = Math.min(visibleCount, activeResultCount);
  const remainingResultCount = Math.max(0, activeResultCount - shownResultCount);
  const hasActiveFilters = Boolean(query || dateFrom || dateTo || coverageFilter !== "all" || claimStatusFilter !== "all");
  const hiddenFilterCount = Number(dateFrom !== "") + Number(dateTo !== "") + Number(tab === "coverage" ? coverageFilter !== "all" : claimStatusFilter !== "all");
  const dateFilterLabel = tab === "coverage" ? "تاريخ البيع" : "تاريخ فتح الطلب";

  function resetVisibleResults() {
    setVisibleCount(pageSize);
  }

  function clearFilters() {
    setQuery("");
    setDateFrom("");
    setDateTo("");
    setCoverageFilter("all");
    setClaimStatusFilter("all");
    setVisibleCount(pageSize);
  }

  const openClaims = pro.warrantyClaims.filter((claim) => !["rejected", "replaced", "compensated"].includes(claim.status));

  function submitClaim() {
    if (!claimRow || !complaint.trim()) {
      toast.error("اكتب وصف العطل");
      return;
    }
    const exists = pro.warrantyClaims.some((claim) => claim.invoiceLineId === claimRow.invoiceLineId && !["rejected", "replaced"].includes(claim.status));
    if (exists) {
      toast.error("يوجد طلب ضمان مفتوح لهذه القطعة");
      return;
    }
    pro.addWarrantyClaim({
      invoiceId: claimRow.invoiceId,
      invoiceNumber: claimRow.invoiceNumber,
      invoiceLineId: claimRow.invoiceLineId,
      customerId: claimRow.customerId,
      customerName: claimRow.customerName,
      productId: claimRow.productId,
      productName: claimRow.productName,
      supplierId: claimRow.supplierId,
      complaint: complaint.trim(),
      serialNumber: serialNumber.trim() || undefined,
    });
    setClaimRow(null);
    setComplaint("");
    setSerialNumber("");
    setTab("claims");
    setVisibleCount(pageSize);
    toast.success("تم فتح طلب الضمان");
  }

  return (
    <div className="space-y-5" dir="rtl">
      <AutoPartsHero
        icon={ShieldCheck}
        title="مركز ضمان قطع الغيار"
        description="الضمان يُنشأ تلقائيًا من تاريخ فاتورة البيع ومدة ضمان المنتج، مع متابعة الفحص والمورد والاستبدال أو التعويض النقدي."
        stats={[
          { label: "تغطية سارية", value: coverage.filter((row) => row.active && !compensatedLineIds.has(row.invoiceLineId)).length },
          { label: "طلبات مفتوحة", value: openClaims.length },
          { label: "تم استبدالها", value: pro.warrantyClaims.filter((claim) => claim.status === "replaced").length },
          { label: "تم تعويضها نقديًا", value: pro.warrantyClaims.filter((claim) => claim.status === "compensated").length },
        ]}
      />

      <Card>
        <CardBody className="space-y-3">
          <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
            <div className="flex flex-wrap items-center gap-2">
              <div className="flex rounded-xl bg-surface-muted p-1">
                <button type="button" onClick={() => { setTab("coverage"); resetVisibleResults(); }} className={`rounded-lg px-4 py-2 text-sm font-bold ${tab === "coverage" ? "bg-surface text-brand-700 shadow-sm" : "text-ink-muted"}`}>الضمانات المباعة</button>
                <button type="button" onClick={() => { setTab("claims"); resetVisibleResults(); }} className={`rounded-lg px-4 py-2 text-sm font-bold ${tab === "claims" ? "bg-surface text-brand-700 shadow-sm" : "text-ink-muted"}`}>طلبات الضمان ({pro.warrantyClaims.length})</button>
              </div>
              <span className="whitespace-nowrap text-[11px] text-ink-faint">
                الأحدث أولًا · {shownResultCount}/{activeResultCount}
              </span>
            </div>
            <div className="flex w-full flex-col gap-2 sm:flex-row xl:w-auto">
              <div className="relative min-w-0 flex-1 xl:w-80">
                <Search className="absolute right-3 top-2.5 h-4 w-4 text-ink-faint" />
                <Input
                  value={query}
                  onChange={(event) => { setQuery(event.target.value); resetVisibleResults(); }}
                  placeholder="فاتورة، عميل، قطعة أو سيريال..."
                  className="pr-10"
                />
              </div>
              <Input
                type="number"
                min={1}
                max={500}
                value={pageSize}
                onChange={(event) => {
                  const nextSize = Math.min(500, Math.max(1, Math.floor(Number(event.target.value) || 1)));
                  setPageSize(nextSize);
                  setVisibleCount(nextSize);
                }}
                aria-label="عدد النتائج"
                title="اكتب عدد النتائج المطلوب عرضها"
                placeholder="10"
                className="sm:w-28"
              />
              <Button
                variant="outline"
                onClick={() => setFiltersOpen((open) => !open)}
                aria-expanded={filtersOpen}
                className={`shrink-0 ${filtersOpen || hiddenFilterCount > 0 ? "border-brand-400 bg-brand-500/10 text-brand-700 dark:text-brand-300" : ""}`}
              >
                <SlidersHorizontal className="h-4 w-4" /> الفلاتر
                {hiddenFilterCount > 0 ? <span className="grid h-5 min-w-5 place-items-center rounded-full bg-brand-600 px-1 text-[10px] text-white">{hiddenFilterCount}</span> : null}
              </Button>
            </div>
          </div>

          {filtersOpen ? (
            <div className="rounded-xl border border-line bg-surface-muted/40 p-3">
              <div className="mb-2.5 flex items-center justify-between gap-3">
                <div className="text-xs font-bold text-ink-muted">تصفية حسب الحالة و{dateFilterLabel}</div>
                <Button variant="ghost" size="sm" onClick={clearFilters} disabled={!hasActiveFilters} className="h-7 px-2 text-xs">
                  <FilterX className="h-3.5 w-3.5" /> مسح
                </Button>
              </div>
              <div className="grid gap-2 md:grid-cols-3">
                {tab === "coverage" ? (
                  <Select
                    value={coverageFilter}
                    onChange={(event) => {
                      setCoverageFilter(event.target.value as "all" | "active" | "expired" | "compensated");
                      resetVisibleResults();
                    }}
                  >
                    <option value="all">كل حالات الضمان</option>
                    <option value="active">السارية فقط</option>
                    <option value="expired">المنتهية فقط</option>
                    <option value="compensated">تم تعويضها نقديًا</option>
                  </Select>
                ) : (
                  <Select value={claimStatusFilter} onChange={(event) => { setClaimStatusFilter(event.target.value); resetVisibleResults(); }}>
                    <option value="all">كل حالات الطلب</option>
                    <option value="open">طلب جديد</option>
                    <option value="inspecting">تحت الفحص</option>
                    <option value="supplier">عند المورد</option>
                    <option value="approved">تمت الموافقة</option>
                    <option value="replaced">تم الاستبدال</option>
                    <option value="compensated">تم التعويض نقديًا</option>
                    <option value="rejected">مرفوض</option>
                  </Select>
                )}
                <label className="flex items-center gap-2 text-xs text-ink-muted">
                  <span className="w-28 shrink-0">{dateFilterLabel} من</span>
                  <Input type="date" value={dateFrom} onChange={(event) => { setDateFrom(event.target.value); resetVisibleResults(); }} aria-label={`${dateFilterLabel} من`} dir="ltr" />
                </label>
                <label className="flex items-center gap-2 text-xs text-ink-muted">
                  <span className="w-28 shrink-0">{dateFilterLabel} إلى</span>
                  <Input type="date" value={dateTo} onChange={(event) => { setDateTo(event.target.value); resetVisibleResults(); }} aria-label={`${dateFilterLabel} إلى`} dir="ltr" />
                </label>
              </div>
            </div>
          ) : null}

        </CardBody>
      </Card>

      {tab === "coverage" ? (
        <Card>
          <CardHeader title="تغطيات الضمان" subtitle="يمكن فتح طلب للقطعة ما دامت التغطية سارية" />
          <CardBody>
            {filteredCoverage.length === 0 ? <EmptyState icon={<PackageCheck className="h-6 w-6" />} title="لا توجد مبيعات بضمان" description="لا توجد نتائج مطابقة للفلاتر الحالية." /> : <><div className="grid gap-3 lg:grid-cols-2">{visibleCoverage.map((row) => {
              const existing = pro.warrantyClaims.find((claim) => claim.invoiceLineId === row.invoiceLineId && !["rejected", "replaced"].includes(claim.status));
              const compensated = existing?.status === "compensated";
              return <div key={`${row.invoiceId}:${row.invoiceLineId}`} className="rounded-2xl border border-line p-4"><div className="flex items-start justify-between gap-3"><div><div className="font-semibold text-ink">{row.productName}</div><div className="mt-1 text-xs text-ink-muted">{row.customerName} · <span dir="ltr">{row.invoiceNumber}</span></div></div><Badge tone={compensated || row.active ? "green" : "red"}>{compensated ? "تم التعويض نقديًا" : row.active ? "ساري" : "منتهي"}</Badge></div><div className="mt-4 grid grid-cols-2 gap-2 text-xs"><div className="rounded-xl bg-surface-muted p-3"><span className="text-ink-faint">تاريخ البيع</span><strong className="mt-1 block" dir="ltr">{row.soldAt}</strong></div><div className="rounded-xl bg-surface-muted p-3"><span className="text-ink-faint">نهاية الضمان</span><strong className="mt-1 block" dir="ltr">{row.expiresAt}</strong></div></div><Button className="mt-3 w-full" variant={existing ? "outline" : "primary"} disabled={!row.active || Boolean(existing)} onClick={() => setClaimRow(row)}>{existing ? <><CalendarClock className="h-4 w-4" /> {STATUS_LABELS[existing.status]}</> : <><ShieldAlert className="h-4 w-4" /> فتح طلب ضمان</>}</Button></div>;
            })}</div>{remainingResultCount > 0 ? <div className="mt-5 flex justify-center"><Button variant="outline" className="min-w-56" onClick={() => setVisibleCount((count) => count + pageSize)}><ChevronDown className="h-4 w-4" /> عرض المزيد ({remainingResultCount} متبقي)</Button></div> : null}</>}
          </CardBody>
        </Card>
      ) : (
        <Card>
          <CardHeader title="متابعة طلبات الضمان" subtitle="غيّر الحالة مع انتقال القطعة من الفحص إلى المورد ثم القرار النهائي" />
          <CardBody>
            {filteredClaims.length === 0 ? (
              <EmptyState icon={<ShieldCheck className="h-6 w-6" />} title="لا توجد طلبات ضمان" />
            ) : (
              <div className="space-y-3">
                {visibleClaims.map((claim) => {
                  const supplier = suppliers.find((item) => item.id === claim.supplierId);
                  const isSettled = claim.status === "replaced" || claim.status === "compensated";
                  const isCompensated = claim.status === "compensated";
                  return (
                    <div key={claim.id} className="rounded-2xl border border-line p-4">
                      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <strong>{claim.productName}</strong>
                            <Badge tone={claim.status === "rejected" ? "red" : isSettled ? "green" : "amber"}>
                              {STATUS_LABELS[claim.status]}
                            </Badge>
                          </div>
                          <div className="mt-1 text-xs text-ink-muted">
                            {claim.customerName} · <span dir="ltr">{claim.invoiceNumber}</span>
                            {supplier ? ` · المورد: ${supplier.name}` : ""}
                          </div>
                          <div className="mt-2 rounded-xl bg-surface-muted px-3 py-2 text-sm text-ink">{claim.complaint}</div>
                          {claim.serialNumber ? <div className="mt-2 font-mono text-xs text-ink-faint" dir="ltr">S/N: {claim.serialNumber}</div> : null}
                          {claim.status === "replaced" && claim.replacementCost !== undefined ? (
                            <div className="mt-2 text-xs font-semibold text-red-700 dark:text-red-400">
                              تكلفة الاستبدال: {formatCurrency(claim.replacementCost, settings.currency)} (تم خصم قطعة من المخزون)
                            </div>
                          ) : null}
                          {claim.status === "compensated" && claim.compensationAmount !== undefined ? (
                            <div className="mt-2 text-xs font-semibold text-emerald-700 dark:text-emerald-400">
                              التعويض المدفوع: {formatCurrency(claim.compensationAmount, settings.currency)} (تم خصمه من الخزينة)
                            </div>
                          ) : null}
                        </div>
                        <div className="w-full rounded-2xl border border-line-soft bg-surface-muted/40 p-2.5 lg:w-[400px] lg:shrink-0">
                          <Select
                            value={claim.status}
                            onChange={(event) => changeClaimStatus(claim, event.target.value as WarrantyClaimStatus)}
                            className="h-10 rounded-xl bg-surface font-semibold"
                            disabled={isCompensated}
                          >
                            {Object.entries(STATUS_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                          </Select>
                          <div className="mt-2.5 grid grid-cols-3 gap-2.5">
                            <Button
                              size="sm"
                              variant="success"
                              className="h-10 whitespace-nowrap rounded-xl px-3 font-bold shadow-sm"
                              onClick={() => changeClaimStatus(claim, "replaced")}
                              disabled={isCompensated}
                            >
                              <CheckCircle2 className="h-4 w-4 shrink-0" /> استبدال
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-10 whitespace-nowrap rounded-xl border-amber-300 bg-amber-50 px-3 font-bold text-amber-700 hover:bg-amber-100 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300 dark:hover:bg-amber-500/20"
                              onClick={() => openCompensationDialog(claim)}
                              disabled={Boolean(claim.compensationCashEntryId)}
                            >
                              <Banknote className="h-4 w-4 shrink-0" /> تعويض نقدي
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-10 whitespace-nowrap rounded-xl border-red-300 bg-red-50 px-3 font-bold text-red-600 hover:bg-red-100 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300 dark:hover:bg-red-500/20"
                              onClick={() => changeClaimStatus(claim, "rejected")}
                              disabled={isCompensated}
                            >
                              <XCircle className="h-4 w-4 shrink-0" /> رفض
                            </Button>
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
                {remainingResultCount > 0 ? (
                  <div className="mt-5 flex justify-center">
                    <Button variant="outline" className="min-w-56" onClick={() => setVisibleCount((count) => count + pageSize)}>
                      <ChevronDown className="h-4 w-4" /> عرض المزيد ({remainingResultCount} متبقي)
                    </Button>
                  </div>
                ) : null}
              </div>
            )}
          </CardBody>
        </Card>
      )}

      <Dialog
        open={Boolean(compensationClaim)}
        onClose={() => {
          setCompensationClaim(null);
          setCompensationAmount(0);
        }}
        title="تعويض العميل نقديًا"
        subtitle={compensationClaim ? `${compensationClaim.customerName} — ${compensationClaim.productName}` : undefined}
        width="sm"
        footer={
          <>
            <Button
              variant="outline"
              onClick={() => {
                setCompensationClaim(null);
                setCompensationAmount(0);
              }}
            >
              إلغاء
            </Button>
            <Button variant="success" onClick={submitCompensation}>
              <Banknote className="h-4 w-4" /> تأكيد التعويض
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <Field label="مبلغ التعويض" required>
            <Input
              type="number"
              min="0.01"
              step="0.01"
              value={compensationAmount}
              onChange={(event) => setCompensationAmount(Number(event.target.value))}
              aria-label="مبلغ التعويض"
              placeholder="0.00"
              autoFocus
            />
          </Field>
          {compensationClaim && soldLineTotal(compensationClaim) > 0 ? (
            <div className="rounded-xl bg-surface-muted px-3 py-2 text-xs text-ink-muted">
              قيمة بند الفاتورة: <strong className="text-ink">{formatCurrency(soldLineTotal(compensationClaim), settings.currency)}</strong>
            </div>
          ) : null}
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs leading-relaxed text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300">
            سيتم خصم المبلغ مرة واحدة من الخزينة وتسجيل الطلب «تم التعويض نقديًا». لن يتم خصم أي قطعة بديلة من المخزون.
          </div>
        </div>
      </Dialog>

      <Dialog
        open={Boolean(claimRow)}
        onClose={() => { setClaimRow(null); setShowSerialInfo(false); }}
        title="فتح طلب ضمان"
        subtitle={claimRow ? `${claimRow.productName} — ${claimRow.invoiceNumber}` : undefined}
        width="md"
        footer={
          <>
            <Button variant="outline" onClick={() => { setClaimRow(null); setShowSerialInfo(false); }}>إلغاء</Button>
            <Button onClick={submitClaim}><Truck className="h-4 w-4" /> تسجيل الطلب</Button>
          </>
        }
      >
        <div className="space-y-4">
          <Field
            label={
              <div className="flex items-center gap-1.5">
                <span>السيريال / رقم التشغيلة</span>
                <button
                  type="button"
                  onClick={() => setShowSerialInfo(!showSerialInfo)}
                  title="ما هو السيريال؟ اضغط للتوضيح"
                  className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-cyan-100 dark:bg-cyan-500/20 text-cyan-700 dark:text-cyan-300 hover:bg-cyan-200 dark:hover:bg-cyan-500/30 transition-colors text-[11px] font-bold"
                >
                  i
                </button>
              </div>
            }
          >
            <Input
              value={serialNumber}
              onChange={(event) => setSerialNumber(event.target.value)}
              dir="ltr"
              placeholder="اختياري (مثل: S/N أو Batch No)"
            />
          </Field>
          {showSerialInfo && (
            <div className="rounded-xl border border-cyan-200 bg-cyan-50 p-3 text-xs text-cyan-900 dark:border-cyan-500/30 dark:bg-cyan-500/10 dark:text-cyan-200 space-y-1.5">
              <div className="font-bold flex items-center gap-1.5 text-cyan-800 dark:text-cyan-300">
                <Info className="h-4 w-4 shrink-0 text-cyan-600 dark:text-cyan-400" />
                ما هو السيريال / رقم التشغيلة؟
              </div>
              <p className="leading-relaxed">
                هو الرقم التسلسلي المميز <strong>(S/N)</strong> أو رقم دفعة التصنيع <strong>(Batch/Lot No)</strong> المطبوع من المصنع على العبوة الخارجية أو المحفور على جسم القطعة نفسها (مثل: الكمبروسر، الحساسات، الدينامو).
              </p>
              <p className="leading-relaxed text-cyan-800/80 dark:text-cyan-300/80">
                يساعدك في مطابقة القطعة مع المورد والتأكد من هويتها عند الاستبدال. الحقل <strong>اختياري</strong> ويمكن تركه فارغاً إذا لم يوجد رقم على القطعة.
              </p>
            </div>
          )}
          <Field label="وصف العطل" required>
            <Textarea value={complaint} onChange={(event) => setComplaint(event.target.value)} placeholder="صف العطل وحالة القطعة ونتيجة الفحص الأولي..." />
          </Field>
          {claimRow?.supplierId ? (
            <div className="rounded-xl border border-blue-200 bg-blue-50 p-3 text-xs text-blue-800 dark:border-blue-500/30 dark:bg-blue-500/10 dark:text-blue-300">
              سيتم ربط الطلب بالمورد المسجل على المنتج.
            </div>
          ) : null}
        </div>
      </Dialog>
    </div>
  );
}
