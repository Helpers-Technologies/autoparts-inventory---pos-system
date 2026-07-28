import { useEffect, useMemo, useState } from "react";
import { Plus, Minus, Wallet, HandCoins, Factory, NotebookPen, Search, ChevronDown, ChevronUp } from "lucide-react";
import { PageHeader } from "../components/layout/AppLayout";
import { Card, CardBody, CardHeader } from "../components/ui/Card";
import { Button } from "../components/ui/Button";
import { Badge } from "../components/ui/Badge";
import { Input, Field, Select, Textarea } from "../components/ui/Input";
import { Table, TBody, TD, TH, THead, TR } from "../components/ui/Table";
import { Dialog } from "../components/ui/Dialog";
import { EmptyState } from "../components/ui/EmptyState";
import { SearchableSelect } from "../components/ui/SearchableSelect";
import { useCatalog } from "../store/CatalogContext";
import { useInvoicing } from "../store/InvoicingContext";
import { useReporting } from "../store/ReportingContext";
import { useAuth } from "../store/AuthContext";
import { useUsers } from "../store/UsersContext";
import { useSettings } from "../store/SettingsContext";
import { useToast } from "../components/ui/Toast";
import { todayISO, uid } from "../lib/utils";
import type { CashEntryType, PaymentMethod } from "../types";
import { formatCurrency, formatDate, PAYMENT_METHOD_LABELS } from "../lib/format";
import { hasPermission } from "../lib/permissions";
import { useFeatures } from "../lib/useFeatures";

function monthValue(d: Date | string): string {
  const date = typeof d === "string" ? new Date(d) : d;
  if (isNaN(date.getTime())) return new Date().toISOString().slice(0, 7);
  return date.toISOString().slice(0, 7);
}

export function CashboxPage() {
  const { suppliers, drivers, offlineEmployees, offlineTransactions, addOfflineTransaction } = useCatalog();
  const { users } = useUsers();
  const { cashEntries, salesInvoices, purchaseInvoices, addCashEntry, currentCashBalance } = useInvoicing();
  const { supplierBalance } = useReporting();
  const { currentUser } = useAuth();
  const { settings, updateSettings } = useSettings();
  const toast = useToast();
  const canAddCash = hasPermission(currentUser, "cashbox", "add");
  const canSpendCash = hasPermission(currentUser, "cashbox", "spend");
  const canEditOpeningBalance = hasPermission(currentUser, "cashbox", "editOpeningBalance");
  const driversEnabled = useFeatures().isEnabled("drivers");

  const [open, setOpen] = useState(false);
  const [entryType, setEntryType] = useState<CashEntryType>("manual-add");
  const [amount, setAmount] = useState(0);
  const [desc, setDesc] = useState("");
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("cash");

  const [payoutTarget, setPayoutTarget] = useState<"general" | "driver" | "employee" | "offline">("general");
  const [selectedDriverId, setSelectedDriverId] = useState("");
  const [selectedUserId, setSelectedUserId] = useState("");
  const [selectedOfflineId, setSelectedOfflineId] = useState("");

  const [payoutCategory, setPayoutCategory] = useState<"salary" | "bonus" | "advance" | "penalty" | "calculated">("salary");
  const [payoutMonth, setPayoutMonth] = useState(() => monthValue(new Date()));
  const [baseSalaryInput, setBaseSalaryInput] = useState<number>(0);
  const [bonusInput, setBonusInput] = useState<number>(0);
  const [advanceInput, setAdvanceInput] = useState<number>(0);
  const [penaltyInput, setPenaltyInput] = useState<number>(0);
  const [commissionEarned, setCommissionEarned] = useState<number>(0);
  const [payoutMode, setPayoutMode] = useState<"full" | "partial">("full");
  const [partialAmount, setPartialAmount] = useState<number>(0);

  function resetPayoutForm() {
    setPayoutTarget("general");
    setSelectedDriverId("");
    setSelectedUserId("");
    setSelectedOfflineId("");
    setPayoutCategory("salary");
    setPayoutMonth(monthValue(new Date()));
    setBaseSalaryInput(0);
    setBonusInput(0);
    setAdvanceInput(0);
    setPenaltyInput(0);
    setCommissionEarned(0);
    setPayoutMode("full");
    setPartialAmount(0);
  }

  // Employee dues recorded in the system for the selected month (salary, bonus,
  // penalty, advance from monthlyConfigs + commission computed from that month's invoices).
  const selectedEmployee = useMemo(
    () => users.find((u) => u.id === selectedUserId) || null,
    [users, selectedUserId]
  );

  const selectedDriver = useMemo(
    () => drivers.find((driver) => driver.id === selectedDriverId) || null,
    [drivers, selectedDriverId],
  );
  const selectedOfflineEmployee = useMemo(
    () => offlineEmployees.find((employee) => employee.id === selectedOfflineId) || null,
    [offlineEmployees, selectedOfflineId],
  );

  const payrollReference = payoutTarget === "employee" && selectedUserId
    ? `payroll:user:${selectedUserId}:${payoutMonth}`
    : payoutTarget === "driver" && selectedDriverId
      ? `payroll:driver:${selectedDriverId}:${payoutMonth}`
      : payoutTarget === "offline" && selectedOfflineId
        ? `payroll:offline:${selectedOfflineId}:${payoutMonth}`
        : undefined;
  const alreadyPaid = payrollReference
    ? Math.abs(cashEntries.filter((entry) => entry.referenceId === payrollReference && entry.amount < 0).reduce((sum, entry) => sum + entry.amount, 0))
    : 0;

  const employeeMonthlyStats = useMemo(() => {
    if (!selectedEmployee) return null;
    const totalSalesMonth = salesInvoices
      .filter((inv) => inv.createdByUserId === selectedEmployee.id && monthValue(inv.date) === payoutMonth)
      .reduce((sum, inv) => sum + inv.total, 0);

    const currentConfig = selectedEmployee.monthlyConfigs?.[payoutMonth] || {};
    const commissionPct = currentConfig.commissionPct ?? selectedEmployee.salesCommissionPct ?? 0;
    const baseSalary = selectedEmployee.monthlySalary ?? 0;
    const bonus = currentConfig.bonus ?? 0;
    const penalty = currentConfig.penalty ?? 0;
    const advance = currentConfig.advance ?? 0;
    const commission = Math.round(((totalSalesMonth * commissionPct) / 100) * 100) / 100;
    const netPayable = Math.max(0, baseSalary + bonus + commission - penalty - advance - alreadyPaid);

    return { baseSalary, bonus, penalty, advance, commission, netPayable };
  }, [selectedEmployee, salesInvoices, payoutMonth, alreadyPaid]);

  const driverMonthlyStats = useMemo(() => {
    if (!selectedDriver) return null;
    const config = selectedDriver.monthlyConfigs?.[payoutMonth] ?? {};
    const baseSalary = selectedDriver.salary ?? 0;
    const bonus = config.bonus ?? 0;
    const penalty = config.penalty ?? 0;
    const advance = config.advance ?? 0;
    return { baseSalary, bonus, penalty, advance, commission: 0, netPayable: Math.max(0, baseSalary + bonus - penalty - advance - alreadyPaid) };
  }, [selectedDriver, payoutMonth, alreadyPaid]);

  const offlineMonthlyStats = useMemo(() => {
    if (!selectedOfflineEmployee) return null;
    const tx = offlineTransactions.filter((item) => item.employeeId === selectedOfflineEmployee.id && item.month === payoutMonth);
    const sum = (type: "incentive" | "deduction" | "advance") => tx.filter((item) => item.type === type).reduce((total, item) => total + item.amount, 0);
    const baseSalary = selectedOfflineEmployee.basicSalary;
    const bonus = sum("incentive");
    const penalty = sum("deduction");
    const advance = sum("advance");
    return { baseSalary, bonus, penalty, advance, commission: 0, netPayable: Math.max(0, baseSalary + bonus - penalty - advance - alreadyPaid) };
  }, [selectedOfflineEmployee, offlineTransactions, payoutMonth, alreadyPaid]);

  const selectedPayrollStats = payoutTarget === "employee" ? employeeMonthlyStats : payoutTarget === "driver" ? driverMonthlyStats : payoutTarget === "offline" ? offlineMonthlyStats : null;

  // For an employee, dues come straight from the system record for the chosen month.
  useEffect(() => {
    if (selectedPayrollStats) {
      setBaseSalaryInput(selectedPayrollStats.baseSalary);
      setBonusInput(selectedPayrollStats.bonus);
      setPenaltyInput(selectedPayrollStats.penalty);
      setAdvanceInput(selectedPayrollStats.advance);
      setCommissionEarned(selectedPayrollStats.commission);
      setPayoutCategory("calculated");
    }
  }, [selectedPayrollStats]);

  const calculatedNet = selectedPayrollStats?.netPayable ?? Math.max(0, baseSalaryInput + bonusInput + commissionEarned - penaltyInput - advanceInput);

  // Compute the amount/description for the current selection whenever any relevant input changes.
  useEffect(() => {
    if (!(entryType === "manual-remove" && payoutTarget !== "general")) return;

    const targetLabel = payoutTarget === "driver" ? "السائق" : "الموظف";
    const name =
      payoutTarget === "driver"
        ? selectedDriver?.name || ""
        : payoutTarget === "offline" ? selectedOfflineEmployee?.name || "" : selectedEmployee?.name || "";

    if (payoutCategory === "salary") {
      setAmount(baseSalaryInput);
      setDesc(name ? `صرف مرتب ${targetLabel}: ${name}` : `صرف مرتب ${targetLabel}`);
    } else if (payoutCategory === "bonus") {
      setAmount(bonusInput);
      setDesc(name ? `صرف مكافأة / بونص لـ ${targetLabel}: ${name}` : `صرف مكافأة / بونص`);
    } else if (payoutCategory === "advance") {
      setAmount(advanceInput);
      setDesc(name ? `صرف سُلفة مالية لـ ${targetLabel}: ${name}` : `صرف سُلفة مالية`);
    } else if (payoutCategory === "penalty") {
      setAmount(penaltyInput);
      setDesc(name ? `خصم / جَزاء على ${targetLabel}: ${name}` : `خصم / جَزاء`);
    } else if (payoutCategory === "calculated") {
      const payAmount = payoutMode === "full" ? calculatedNet : Math.min(partialAmount, calculatedNet);
      setAmount(payAmount);
      const details = [];
      if (baseSalaryInput > 0) details.push(`أساسي ${baseSalaryInput}`);
      if (commissionEarned > 0) details.push(`عمولة +${commissionEarned}`);
      if (bonusInput > 0) details.push(`بونص +${bonusInput}`);
      if (penaltyInput > 0) details.push(`خصم -${penaltyInput}`);
      if (advanceInput > 0) details.push(`سُلفة -${advanceInput}`);
      const detailsStr = details.length > 0 ? ` (${details.join("، ")})` : "";
      const partialNote = payoutMode === "partial" ? " - دفعة جزئية" : "";
      setDesc(
        name
          ? `صرف صافي مستحقات ${targetLabel}: ${name}${detailsStr}${partialNote}`
          : `صرف صافي مستحقات${partialNote}`
      );
    }
  }, [
    entryType,
    payoutTarget,
    payoutCategory,
    baseSalaryInput,
    bonusInput,
    penaltyInput,
    advanceInput,
    commissionEarned,
    payoutMode,
    partialAmount,
    calculatedNet,
    selectedDriverId,
    selectedEmployee,
    selectedDriver,
    selectedOfflineEmployee,
    drivers,
  ]);

  useEffect(() => {
    if (payoutCategory === "calculated") {
      setPartialAmount(calculatedNet);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [payoutCategory, selectedUserId, selectedDriverId, payoutMonth]);

  const driverOptions = useMemo(
    () =>
      drivers.map((d) => ({
        value: d.id,
        label: `${d.name} ${d.salary ? `(المرتب: ${formatCurrency(d.salary, settings.currency)})` : ""}`,
        searchText: `${d.name} ${d.phone ?? ""} ${d.licenseNumber ?? ""}`,
      })),
    [drivers, settings.currency]
  );

  const employeeOptions = useMemo(
    () =>
      users.filter((u) => u.role !== "owner").map((u) => ({
        value: u.id,
        label: `${u.name} (${u.username}) ${u.monthlySalary ? `(المرتب: ${formatCurrency(u.monthlySalary, settings.currency)})` : ""}`,
        searchText: `${u.name} ${u.username}`,
      })),
    [users, settings.currency]
  );

  const offlineEmployeeOptions = useMemo(
    () => offlineEmployees.filter((employee) => !employee.archived).map((employee) => ({ value: employee.id, label: `${employee.name} ${employee.jobTitle ? `(${employee.jobTitle})` : ""}`, searchText: `${employee.name} ${employee.jobTitle ?? ""} ${employee.phone ?? ""}` })),
    [offlineEmployees],
  );

  const [openBalOpen, setOpenBalOpen] = useState(false);
  const [newOpening, setNewOpening] = useState(settings.openingBalance);

  const [cashQ, setCashQ] = useState("");
  const [cashType, setCashType] = useState("all");
  const [cashFrom, setCashFrom] = useState("");
  const [cashTo, setCashTo] = useState("");
  const [displayLimit, setDisplayLimit] = useState<number | "all">(5);
  const [showAllRows, setShowAllRows] = useState(false);

  const filteredEntries = useMemo(() => {
    let list = [...cashEntries];
    if (cashQ.trim()) {
      const q = cashQ.trim().toLowerCase();
      list = list.filter((e) => e.description?.toLowerCase().includes(q));
    }
    if (cashType !== "all") list = list.filter((e) => e.type === cashType);
    if (cashFrom) list = list.filter((e) => e.date >= cashFrom);
    if (cashTo)   list = list.filter((e) => e.date <= cashTo);
    return list;
  }, [cashEntries, cashQ, cashType, cashFrom, cashTo]);

  const visibleEntries = useMemo(() => {
    if (showAllRows || displayLimit === "all") return filteredEntries;
    return filteredEntries.slice(0, typeof displayLimit === "number" ? displayLimit : 5);
  }, [filteredEntries, showAllRows, displayLimit]);

  const totalReceived = useMemo(
    () =>
      salesInvoices
        .filter((s) => !s.cancelled)
        .reduce((a, s) => a + s.amountReceived + (s.overpayment ?? 0), 0),
    [salesInvoices]
  );
  const totalPurchasePayments = useMemo(
    () => purchaseInvoices.reduce((a, s) => a + s.amountPaid + (s.overpayment ?? 0), 0),
    [purchaseInvoices]
  );
  const payables = useMemo(
    () => suppliers.reduce((a, s) => a + supplierBalance(s.id), 0),
    [suppliers, supplierBalance]
  );

  function submit() {
    if (entryType === "manual-remove" && payoutTarget !== "general" && !payrollReference) {
      toast.error("اختر الموظف أولًا");
      return;
    }
    if (amount <= 0) {
      toast.error("المبلغ يجب أن يكون أكبر من صفر");
      return;
    }
    if (!desc.trim()) {
      toast.error("الوصف مطلوب");
      return;
    }
    if (entryType === "manual-add" && !canAddCash) {
      toast.error("ليس لديك صلاحية", "لا تملك صلاحية إضافة نقدية");
      return;
    }
    if (entryType === "manual-remove" && !canSpendCash) {
      toast.error("ليس لديك صلاحية", "لا تملك صلاحية صرف نقدية");
      return;
    }
    if (entryType === "adjustment" && !canAddCash && !canSpendCash) {
      toast.error("ليس لديك صلاحية", "لا تملك صلاحية تسجيل تسوية");
      return;
    }
    const signed = entryType === "manual-add" ? amount : -amount;
    addCashEntry({
      id: uid("cash_m"),
      type: entryType,
      amount: signed,
      description: desc.trim(),
      referenceId: payrollReference,
      date: todayISO(),
      paymentMethod,
    });
    if (payoutTarget === "offline" && selectedOfflineId) {
      addOfflineTransaction({ employeeId: selectedOfflineId, type: "salary", amount, month: payoutMonth, date: todayISO(), notes: desc.trim() });
    }
    toast.success(entryType === "manual-add" ? "تم إضافة نقدية" : "تم خصم نقدية");
    setOpen(false);
    setAmount(0);
    setDesc("");
    setPaymentMethod("cash");
    resetPayoutForm();
  }

  return (
    <>
      <PageHeader
        title="الخزينة"
        description="رصيد نقدي، إيداعات، صرف، وسجل مالي"
        actions={
          canEditOpeningBalance || canAddCash || canSpendCash ? (
            <>
              {canEditOpeningBalance ? (
                <Button
                  variant="outline"
                  onClick={() => {
                    setNewOpening(settings.openingBalance);
                    setOpenBalOpen(true);
                  }}
                >
                  الرصيد الافتتاحي
                </Button>
              ) : null}
              {canAddCash ? (
                <Button
                  onClick={() => {
                    setEntryType("manual-add");
                    setOpen(true);
                  }}
                >
                  <Plus className="w-4 h-4" /> إضافة نقدية
                </Button>
              ) : null}
              {canSpendCash ? (
                <Button
                  variant="outline"
                  onClick={() => {
                    setEntryType("manual-remove");
                    setPayoutTarget("general");
                    setSelectedDriverId("");
                    setSelectedUserId("");
                    setSelectedOfflineId("");
                    setOpen(true);
                  }}
                >
                  <Minus className="w-4 h-4" /> صرف
                </Button>
              ) : null}
            </>
          ) : null
        }
      />

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <Stat icon={<Wallet className="w-5 h-5" />} label="الرصيد الحالي" value={formatCurrency(currentCashBalance(), settings.currency)} tone="green" />
        <Stat icon={<HandCoins className="w-5 h-5" />} label="إجمالي المحصل" value={formatCurrency(totalReceived, settings.currency)} tone="blue" />
        <Stat icon={<Factory className="w-5 h-5" />} label="مدفوعات الموردين" value={formatCurrency(totalPurchasePayments, settings.currency)} tone="amber" />
      </div>

      <Card>
        <CardHeader
          title="دفتر الخزينة"
          subtitle={`الرصيد الافتتاحي: ${formatCurrency(settings.openingBalance, settings.currency)} • مستحقات على الموردين: ${formatCurrency(payables, settings.currency)}`}
          actions={
            <div className="flex items-center gap-2">
              <span className="text-xs text-ink-muted hidden sm:inline">عدد العرض:</span>
              <Select
                value={displayLimit}
                onChange={(e) => {
                  const val = e.target.value;
                  setDisplayLimit(val === "all" ? "all" : Number(val));
                  setShowAllRows(false);
                }}
                className="w-28 text-xs h-8 font-semibold"
              >
                <option value={5}>5 حركات</option>
                <option value={10}>10 حركات</option>
                <option value={20}>20 حركة</option>
                <option value={50}>50 حركة</option>
                <option value="all">عرض الكل</option>
              </Select>
            </div>
          }
        />
        <CardBody className="space-y-3">
          <div className="flex gap-2 items-center flex-wrap">
            <div className="relative w-52">
              <Search className="w-4 h-4 absolute top-1/2 -translate-y-1/2 end-3 text-ink-faint" />
              <Input
                value={cashQ}
                onChange={(e) => setCashQ(e.target.value)}
                placeholder="بحث في البيان..."
                className="pe-9"
              />
            </div>
            <div className="inline-flex items-center gap-1 bg-surface-muted p-1 rounded-lg">
              <span className="px-2 text-xs text-ink-faint select-none">النوع:</span>
              {([
                { key: "all",              label: "الكل" },
                { key: "sales-receipt",    label: "تحصيل" },
                { key: "purchase-payment", label: "مشتريات" },
                { key: "manual-add",       label: "إضافة" },
                { key: "manual-remove",    label: "صرف" },
                { key: "adjustment",       label: "تسوية" },
              ] as const).map((b) => (
                <button
                  key={b.key}
                  onClick={() => setCashType(b.key)}
                  className={`px-3 h-8 text-xs rounded-md transition-colors ${
                    cashType === b.key ? "bg-surface text-brand-700 shadow-sm" : "text-ink-muted hover:text-ink"
                  }`}
                >
                  {b.label}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-1 bg-surface-muted px-3 py-1.5 rounded-lg">
              <span className="text-xs text-ink-faint select-none">من:</span>
              <input type="date" value={cashFrom} onChange={(e) => setCashFrom(e.target.value)} className="bg-transparent text-xs text-ink outline-none w-28" />
            </div>
            <div className="flex items-center gap-1 bg-surface-muted px-3 py-1.5 rounded-lg">
              <span className="text-xs text-ink-faint select-none">إلى:</span>
              <input type="date" value={cashTo} onChange={(e) => setCashTo(e.target.value)} className="bg-transparent text-xs text-ink outline-none w-28" />
            </div>
            {(cashFrom || cashTo || cashQ || cashType !== "all") && (
              <button
                type="button"
                onClick={() => { setCashQ(""); setCashType("all"); setCashFrom(""); setCashTo(""); }}
                className="text-xs text-ink-faint hover:text-ink transition-colors"
              >
                مسح الفلاتر
              </button>
            )}
            <span className="text-xs text-ink-faint me-auto">{filteredEntries.length} حركة</span>
          </div>
          {cashEntries.length === 0 ? (
            <EmptyState
              icon={<NotebookPen className="w-5 h-5" />}
              title="لا توجد حركات بالخزينة"
              description="سيتم تسجيل كل دفعة تلقائياً هنا."
            />
          ) : (
            <>
              <Table>
                <THead>
                  <TR>
                    <TH>التاريخ</TH>
                    <TH>النوع</TH>
                    <TH>البيان</TH>
                    <TH>وسيلة الدفع</TH>
                    <TH className="text-end">المبلغ</TH>
                  </TR>
                </THead>
                <TBody>
                  {visibleEntries.map((c) => (
                    <TR key={c.id}>
                      <TD>{formatDate(c.date)}</TD>
                      <TD>
                        <TypeBadge type={c.type} />
                      </TD>
                      <TD className="text-ink-muted">{c.description}</TD>
                      <TD className="text-ink-faint text-sm">
                        {c.paymentMethod ? PAYMENT_METHOD_LABELS[c.paymentMethod] : "—"}
                      </TD>
                      <TD
                        className={`text-end font-medium ${
                          c.amount >= 0 ? "text-emerald-700 dark:text-emerald-400" : "text-rose-700 dark:text-rose-400"
                        }`}
                      >
                        {c.amount >= 0 ? "+" : ""}
                        {formatCurrency(c.amount, settings.currency)}
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>

              {filteredEntries.length > (typeof displayLimit === "number" ? displayLimit : filteredEntries.length) && (
                <div className="pt-3 text-center border-t border-line mt-3 flex flex-wrap items-center justify-between gap-3">
                  <span className="text-xs text-ink-faint">
                    يتم عرض {visibleEntries.length} من أصل {filteredEntries.length} حركة
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setShowAllRows(!showAllRows)}
                    className="text-xs font-bold text-brand-600 dark:text-brand-400 hover:bg-brand-50 dark:hover:bg-brand-500/10 gap-1.5"
                  >
                    {showAllRows ? (
                      <>
                        <ChevronUp className="w-4 h-4" /> عرض أقل (عرض 5 فقط)
                      </>
                    ) : (
                      <>
                        <ChevronDown className="w-4 h-4" /> عرض المزيد ({filteredEntries.length - visibleEntries.length} حركات متبقية)
                      </>
                    )}
                  </Button>
                </div>
              )}
            </>
          )}
        </CardBody>
      </Card>

      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title={entryType === "manual-add" ? "إضافة نقدية" : "صرف نقدية / مرتبات"}
        footer={
          <>
            <Button variant="outline" onClick={() => setOpen(false)}>إلغاء</Button>
            <Button onClick={submit}>حفظ</Button>
          </>
        }
      >
        <div className="space-y-3">
          <Field label="النوع">
            <Select value={entryType} onChange={(e) => setEntryType(e.target.value as CashEntryType)}>
              {canAddCash ? <option value="manual-add">إضافة نقدية</option> : null}
              {canSpendCash ? <option value="manual-remove">صرف</option> : null}
              {canAddCash || canSpendCash ? <option value="adjustment">تسوية / ملاحظة</option> : null}
            </Select>
          </Field>

          {entryType === "manual-remove" && (
            <Field label="الغرض من الصرف">
              <Select
                value={payoutTarget}
                onChange={(e) => {
                  const val = e.target.value as "general" | "driver" | "employee" | "offline";
                  setPayoutTarget(val);
                  setSelectedDriverId("");
                  setSelectedUserId("");
                  setSelectedOfflineId("");
                  setPayoutMonth(monthValue(new Date()));
                  setBaseSalaryInput(0);
                  setBonusInput(0);
                  setAdvanceInput(0);
                  setPenaltyInput(0);
                  setCommissionEarned(0);
                  setPayoutMode("full");
                  setPartialAmount(0);
                }}
              >
                <option value="general">مصروفات عامة / نثرية</option>
                {driversEnabled && <option value="driver">صرف مرتب / مستحقات سائق</option>}
                <option value="employee">صرف مستحقات مستخدم نظام</option>
                <option value="offline">صرف مستحقات موظف بدون حساب</option>
              </Select>
            </Field>
          )}

          {entryType === "manual-remove" && payoutTarget === "driver" && (
            <Field label="اختر السائق">
              <SearchableSelect
                value={selectedDriverId}
                onChange={setSelectedDriverId}
                options={driverOptions}
                placeholder="-- اختر السائق --"
                searchPlaceholder="ابحث باسم السائق أو رقم الهاتف..."
              />
            </Field>
          )}

          {entryType === "manual-remove" && payoutTarget === "employee" && (
            <Field label="اختر الموظف">
              <SearchableSelect
                value={selectedUserId}
                onChange={(uId) => setSelectedUserId(uId)}
                options={employeeOptions}
                placeholder="-- اختر الموظف --"
                searchPlaceholder="ابحث باسم الموظف أو اسم المستخدم..."
              />
            </Field>
          )}

          {entryType === "manual-remove" && payoutTarget === "offline" && (
            <Field label="اختر الموظف">
              <SearchableSelect
                value={selectedOfflineId}
                onChange={setSelectedOfflineId}
                options={offlineEmployeeOptions}
                placeholder="-- اختر الموظف بدون حساب --"
                searchPlaceholder="ابحث باسم الموظف أو الوظيفة..."
              />
            </Field>
          )}

          {entryType === "manual-remove" && payoutTarget !== "general" && (selectedUserId || selectedDriverId || selectedOfflineId) && (
            <Field label="شهر الاستحقاق">
              <Input
                type="month"
                value={payoutMonth}
                onChange={(e) => setPayoutMonth(e.target.value || monthValue(new Date()))}
              />
            </Field>
          )}

          {entryType === "manual-remove" && payoutTarget !== "general" && selectedPayrollStats && (
            <>
              <div className="p-3 rounded-lg border border-brand-300/60 bg-brand-50/50 dark:bg-brand-500/10 space-y-3">
                <div className="text-xs font-semibold text-ink">المبلغ محسوب تلقائيًا من ملف الموظف لشهر {payoutMonth} ولا يمكن تعديله من الخزينة:</div>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <StatRow label="المرتب الأساسي" value={baseSalaryInput} tone="neutral" settings={settings} />
                  <StatRow label="العمولة (+)" value={commissionEarned} tone="positive" settings={settings} />
                  <StatRow label="البونص (+)" value={bonusInput} tone="positive" settings={settings} />
                  <StatRow label="الخصم (-)" value={penaltyInput} tone="negative" settings={settings} />
                  <StatRow label="السُلفة (-)" value={advanceInput} tone="negative" settings={settings} />
                  <StatRow label="تم صرفه سابقًا" value={alreadyPaid} tone="negative" settings={settings} />
                  <StatRow label="المتبقي للصرف" value={calculatedNet} tone="total" settings={settings} />
                </div>
              </div>
            </>
          )}

          <Field label="المبلغ" required>
            <Input
              type="number"
              min={0.01}
              step="0.01"
              value={amount || ""}
              onChange={(e) => setAmount(Number(e.target.value))}
              readOnly={entryType === "manual-remove" && payoutTarget !== "general"}
              className={entryType === "manual-remove" && payoutTarget !== "general" ? "cursor-not-allowed bg-surface-muted font-bold text-brand-600" : undefined}
            />
          </Field>
          <Field label="طريقة الدفع">
            <Select value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value as PaymentMethod)}>
              {Object.entries(PAYMENT_METHOD_LABELS).filter(([k]) => k !== "credit").map(([k, v]) => (
                <option key={k} value={k}>{v}</option>
              ))}
            </Select>
          </Field>
          <Field label="البيان" required>
            <Textarea
              rows={2}
              value={desc}
              onChange={(e) => setDesc(e.target.value)}
              placeholder="مثل: إيداع من صاحب المحل، صرف مصاريف، صرف مرتبات..."
            />
          </Field>
        </div>
      </Dialog>

      <Dialog
        open={openBalOpen}
        onClose={() => setOpenBalOpen(false)}
        title="تعديل الرصيد الافتتاحي"
        footer={
          <>
            <Button variant="outline" onClick={() => setOpenBalOpen(false)}>إلغاء</Button>
            <Button
              onClick={() => {
                updateSettings({ openingBalance: Math.max(0, newOpening) });
                toast.success("تم تحديث الرصيد الافتتاحي");
                setOpenBalOpen(false);
              }}
            >
              حفظ
            </Button>
          </>
        }
      >
        <Field label="الرصيد الافتتاحي للخزينة">
          <Input type="number" step="0.01" value={newOpening} onChange={(e) => setNewOpening(Number(e.target.value))} />
        </Field>
      </Dialog>
    </>
  );
}

function TypeBadge({ type }: { type: CashEntryType }) {
  if (type === "sales-receipt") return <Badge tone="green">تحصيل مبيعات</Badge>;
  if (type === "purchase-payment") return <Badge tone="blue">سداد مشتريات</Badge>;
  if (type === "manual-add") return <Badge tone="emerald">إضافة يدوية</Badge>;
  if (type === "manual-remove") return <Badge tone="rose">صرف يدوي</Badge>;
  return <Badge tone="amber">تسوية</Badge>;
}

function StatRow({
  label,
  value,
  tone,
  settings,
}: {
  label: string;
  value: number;
  tone: "neutral" | "positive" | "negative" | "total";
  settings: { currency: string };
}) {
  const toneClass =
    tone === "positive"
      ? "text-emerald-600 dark:text-emerald-400"
      : tone === "negative"
      ? "text-rose-600 dark:text-rose-400"
      : tone === "total"
      ? "text-brand-600 dark:text-brand-400 font-bold"
      : "text-ink";
  return (
    <div className="flex items-center justify-between p-2 rounded-lg bg-surface border border-line">
      <span className="text-ink-muted">{label}</span>
      <span className={toneClass}>{formatCurrency(value, settings.currency)}</span>
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
  value: string;
  tone: "green" | "blue" | "amber" | "rose" | "violet";
}) {
  const colors: Record<string, string> = {
    green: "bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 dark:bg-emerald-500/15 dark:text-emerald-300",
    blue: "bg-blue-50 dark:bg-blue-500/10 text-blue-700 dark:text-blue-400 dark:bg-blue-500/15 dark:text-blue-300",
    amber: "bg-amber-50 dark:bg-amber-500/10 text-amber-700 dark:text-amber-400 dark:bg-amber-500/15 dark:text-amber-300",
    emerald: "bg-emerald-50 dark:bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
    rose: "bg-rose-50 dark:bg-rose-500/10 text-rose-600 dark:text-rose-400",
    violet: "bg-violet-50 dark:bg-violet-500/10 text-violet-600 dark:text-violet-400",
  };
  return (
    <div className="bg-surface rounded-xl border border-line p-4 flex items-center gap-3">
      <div className={`w-10 h-10 rounded-lg grid place-items-center ${colors[tone]}`}>
        {icon}
      </div>
      <div>
        <div className="text-xs text-ink-muted">{label}</div>
        <div className="font-semibold text-ink">{value}</div>
      </div>
    </div>
  );
}
