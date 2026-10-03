import { useEffect, useMemo, useState } from "react";
import { Plus, Minus, Wallet, HandCoins, Factory, NotebookPen, Search, ChevronDown, ChevronUp, PieChart, Banknote, CreditCard, Landmark, Smartphone, MoreHorizontal, SlidersHorizontal } from "lucide-react";
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
import { cashBalanceByMethod, drawerCashFrom } from "../lib/cashBalance";
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
  const [balanceBreakdownOpen, setBalanceBreakdownOpen] = useState(false);
  const [receivedDetailsOpen, setReceivedDetailsOpen] = useState(false);
  const [supplierPaymentsDetailsOpen, setSupplierPaymentsDetailsOpen] = useState(false);
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

  // Split by how the money arrived, so the shop can reconcile the drawer
  // against the drawer instead of against a total that also contains last
  // week's Visa settlement. See lib/cashBalance.
  const balanceByMethod = useMemo(
    () => cashBalanceByMethod(cashEntries, settings.openingBalance),
    [cashEntries, settings.openingBalance],
  );
  const drawerCash = drawerCashFrom(balanceByMethod);

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
        <Stat
          icon={<Wallet className="w-5 h-5" />}
          label="الرصيد الحالي"
          value={formatCurrency(currentCashBalance(), settings.currency)}
          tone="green"
          hint={`منها ${formatCurrency(drawerCash, settings.currency)} في الدرج`}
          onDetails={() => setBalanceBreakdownOpen(true)}
          detailsLabel="تفاصيل الرصيد حسب طريقة الدفع"
        />
        <Stat
          icon={<HandCoins className="w-5 h-5" />}
          label="إجمالي المحصل"
          value={formatCurrency(totalReceived, settings.currency)}
          tone="blue"
          onDetails={() => setReceivedDetailsOpen(true)}
          detailsLabel="تفاصيل إجمالي المحصل"
        />
        <Stat
          icon={<Factory className="w-5 h-5" />}
          label="مدفوعات الموردين"
          value={formatCurrency(totalPurchasePayments, settings.currency)}
          tone="amber"
          onDetails={() => setSupplierPaymentsDetailsOpen(true)}
          detailsLabel="تفاصيل مدفوعات الموردين"
        />
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
        open={balanceBreakdownOpen}
        onClose={() => setBalanceBreakdownOpen(false)}
        title="تفاصيل الرصيد الحالي"
        subtitle="الرصيد موزّع على طرق الدفع اللي دخلت أو خرجت بيها الفلوس"
        width="2xl"
        footer={<Button variant="outline" onClick={() => setBalanceBreakdownOpen(false)}>إغلاق</Button>}
      >
        <div className="space-y-3">
          {balanceByMethod.length === 0 ? (
            <EmptyState icon={<PieChart className="h-5 w-5" />} title="لا توجد حركات بعد" />
          ) : (
            <>
              <div className="overflow-x-auto rounded-xl border border-line">
                <Table>
                  <THead>
                    <TR>
                      <TH>طريقة الدفع</TH>
                      <TH className="text-end">داخل</TH>
                      <TH className="text-end">خارج</TH>
                      <TH className="text-end">الصافي</TH>
                    </TR>
                  </THead>
                  <TBody>
                    {balanceByMethod.map((row) => (
                      <TR key={row.method}>
                        <TD>
                          <span className="flex items-center gap-2 font-semibold text-ink">
                            <span className="grid h-7 w-7 place-items-center rounded-lg bg-surface-muted text-ink-muted">
                              {PAYMENT_METHOD_ICONS[row.method] ?? <MoreHorizontal className="h-3.5 w-3.5" />}
                            </span>
                            {PAYMENT_METHOD_LABELS[row.method] ?? row.method}
                            {row.method === "cash" ? (
                              <span className="text-[10px] text-ink-faint">(شامل الرصيد الافتتاحي)</span>
                            ) : null}
                          </span>
                        </TD>
                        <TD className="text-end text-emerald-600 dark:text-emerald-400">
                          {formatCurrency(row.inflow, settings.currency)}
                        </TD>
                        <TD className="text-end text-rose-600 dark:text-rose-400">
                          {row.outflow ? `- ${formatCurrency(row.outflow, settings.currency)}` : "—"}
                        </TD>
                        <TD className={`text-end font-bold ${row.net < 0 ? "text-rose-600 dark:text-rose-400" : "text-ink"}`}>
                          {formatCurrency(row.net, settings.currency)}
                        </TD>
                      </TR>
                    ))}
                  </TBody>
                </Table>
              </div>
              <StatRow
                label="إجمالي الرصيد الحالي"
                value={currentCashBalance()}
                tone="total"
                settings={settings}
              />
              <p className="text-[11px] leading-relaxed text-ink-faint">
                الدرج هو الكاش اللي المفروض يتعدّ فعليًا؛ باقي الطرق أرصدة عند
                البنك أو المحفظة أو ماكينة الفيزا لحد ما تتسوّى.
              </p>
            </>
          )}
        </div>
      </Dialog>

      <Dialog
        open={receivedDetailsOpen}
        onClose={() => setReceivedDetailsOpen(false)}
        title="تفاصيل إجمالي المحصل"
        subtitle="مدفوعات فواتير البيع غير الملغاة"
        width="2xl"
        footer={<Button variant="outline" onClick={() => setReceivedDetailsOpen(false)}>إغلاق</Button>}
      >
        <CashboxInvoiceDetails
          rows={salesInvoices
            .filter((invoice) => !invoice.cancelled && invoice.amountReceived + (invoice.overpayment ?? 0) > 0)
            .sort((a, b) => b.date.localeCompare(a.date))
            .map((invoice) => ({
              id: invoice.id,
              number: invoice.invoiceNumber,
              date: invoice.date,
              party: invoice.customerName,
              methodKey: invoice.paymentMethod ?? "cash",
              method: invoice.paymentMethodLabel || PAYMENT_METHOD_LABELS[invoice.paymentMethod ?? "cash"] || "—",
              amount: invoice.amountReceived + (invoice.overpayment ?? 0),
            }))}
          partyLabel="العميل"
          total={totalReceived}
          currency={settings.currency}
          emptyTitle="لا توجد محصلات بعد"
        />
      </Dialog>

      <Dialog
        open={supplierPaymentsDetailsOpen}
        onClose={() => setSupplierPaymentsDetailsOpen(false)}
        title="تفاصيل مدفوعات الموردين"
        subtitle="المبالغ المدفوعة لفواتير الشراء"
        width="2xl"
        footer={<Button variant="outline" onClick={() => setSupplierPaymentsDetailsOpen(false)}>إغلاق</Button>}
      >
        <CashboxInvoiceDetails
          rows={purchaseInvoices
            .filter((invoice) => invoice.amountPaid + (invoice.overpayment ?? 0) > 0)
            .sort((a, b) => b.date.localeCompare(a.date))
            .map((invoice) => ({
              id: invoice.id,
              number: invoice.invoiceNumber,
              date: invoice.date,
              party: invoice.supplierName,
              methodKey: invoice.paymentLog?.[0]?.paymentMethod ?? "other",
              method: invoice.paymentLog?.length ? "مدفوعات مسجلة" : "مدفوعات الفاتورة",
              amount: invoice.amountPaid + (invoice.overpayment ?? 0),
            }))}
          partyLabel="المورد"
          total={totalPurchasePayments}
          currency={settings.currency}
          emptyTitle="لا توجد مدفوعات بعد"
        />
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

/** One glyph per way money moves, so the breakdown reads at a glance. */
const PAYMENT_METHOD_ICONS: Record<string, React.ReactNode> = {
  cash: <Banknote className="h-3.5 w-3.5" />,
  card: <CreditCard className="h-3.5 w-3.5" />,
  instapay: <Landmark className="h-3.5 w-3.5" />,
  vodafone: <Smartphone className="h-3.5 w-3.5" />,
  bank: <Landmark className="h-3.5 w-3.5" />,
  other: <MoreHorizontal className="h-3.5 w-3.5" />,
};

function CashboxInvoiceDetails({
  rows,
  partyLabel,
  total,
  currency,
  emptyTitle,
}: {
  rows: Array<{ id: string; number: string; date: string; party: string; methodKey: string; method: string; amount: number }>;
  partyLabel: string;
  total: number;
  currency: string;
  emptyTitle: string;
}) {
  const [query, setQuery] = useState("");
  const [methodFilter, setMethodFilter] = useState("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [minAmount, setMinAmount] = useState("");
  const [maxAmount, setMaxAmount] = useState("");
  const [sortBy, setSortBy] = useState<"newest" | "oldest" | "highest" | "lowest">("newest");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [showAll, setShowAll] = useState(false);

  const summary = useMemo(() => {
    const totals = new Map<string, number>();
    rows.forEach((row) => totals.set(row.methodKey, (totals.get(row.methodKey) ?? 0) + row.amount));
    return Array.from(totals.entries()).sort((a, b) => b[1] - a[1]);
  }, [rows]);

  const filteredRows = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    const filtered = rows.filter((row) => {
      const matchesQuery = !normalized || `${row.number} ${row.party} ${row.method}`.toLowerCase().includes(normalized);
      const matchesMethod = methodFilter === "all" || row.methodKey === methodFilter;
      const matchesFrom = !dateFrom || row.date >= dateFrom;
      const matchesTo = !dateTo || row.date <= dateTo;
      const matchesMin = !minAmount || row.amount >= Number(minAmount);
      const matchesMax = !maxAmount || row.amount <= Number(maxAmount);
      return matchesQuery && matchesMethod && matchesFrom && matchesTo && matchesMin && matchesMax;
    });
    return filtered.sort((a, b) => {
      if (sortBy === "oldest") return a.date.localeCompare(b.date);
      if (sortBy === "highest") return b.amount - a.amount;
      if (sortBy === "lowest") return a.amount - b.amount;
      return b.date.localeCompare(a.date);
    });
  }, [rows, query, methodFilter, dateFrom, dateTo, minAmount, maxAmount, sortBy]);

  const visibleRows = showAll ? filteredRows : filteredRows.slice(0, 5);

  if (rows.length === 0) {
    return <EmptyState icon={<PieChart className="h-5 w-5" />} title={emptyTitle} />;
  }

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-4 gap-2">
        {summary.map(([methodKey, amount]) => (
          <button
            key={methodKey}
            type="button"
            onClick={() => setMethodFilter(methodFilter === methodKey ? "all" : methodKey)}
            className={`flex items-center justify-between rounded-lg border p-3 text-start transition ${methodFilter === methodKey ? "border-brand-500 bg-brand-50 dark:bg-brand-500/10" : "border-line bg-surface"}`}
          >
            <span className="text-xs text-ink-muted">{PAYMENT_METHOD_LABELS[methodKey] ?? (methodKey === "other" ? "أخرى" : methodKey)}</span>
            <span className="font-semibold text-ink">{formatCurrency(amount, currency)}</span>
          </button>
        ))}
      </div>

      <StatRow label="الإجمالي" value={total} tone="total" settings={{ currency }} />

      <div className="flex items-center justify-between gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={() => setFiltersOpen((current) => !current)}
          aria-expanded={filtersOpen}
        >
          <SlidersHorizontal className="h-4 w-4" />
          {filtersOpen ? "إخفاء الفلاتر" : "إظهار الفلاتر"}
          {query || methodFilter !== "all" || dateFrom || dateTo || minAmount || maxAmount ? (
            <span className="rounded-full bg-brand-600 px-1.5 text-[10px] text-white">مفعّلة</span>
          ) : null}
        </Button>
        <span className="text-xs text-ink-muted">{filteredRows.length} عملية</span>
      </div>

      {filtersOpen ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2 rounded-xl border border-line bg-surface-muted/40 p-3">
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="ابحث برقم الفاتورة أو الاسم..."
            aria-label="بحث في العمليات"
          />
          <Select value={methodFilter} onChange={(event) => setMethodFilter(event.target.value)} aria-label="فلترة طريقة الدفع">
            <option value="all">كل طرق الدفع</option>
            {summary.map(([methodKey]) => (
              <option key={methodKey} value={methodKey}>{PAYMENT_METHOD_LABELS[methodKey] ?? methodKey}</option>
            ))}
          </Select>
          <Input type="date" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} aria-label="من تاريخ" />
          <Input type="date" value={dateTo} onChange={(event) => setDateTo(event.target.value)} aria-label="إلى تاريخ" />
          <Input type="number" min="0" step="0.01" value={minAmount} onChange={(event) => setMinAmount(event.target.value)} placeholder="أقل مبلغ" aria-label="أقل مبلغ" />
          <Input type="number" min="0" step="0.01" value={maxAmount} onChange={(event) => setMaxAmount(event.target.value)} placeholder="أقصى مبلغ" aria-label="أقصى مبلغ" />
          <Select value={sortBy} onChange={(event) => setSortBy(event.target.value as typeof sortBy)} aria-label="ترتيب العمليات">
            <option value="newest">الأحدث أولًا</option>
            <option value="oldest">الأقدم أولًا</option>
            <option value="highest">الأعلى مبلغًا</option>
            <option value="lowest">الأقل مبلغًا</option>
          </Select>
          <Button
            variant="ghost"
            onClick={() => {
              setQuery("");
              setMethodFilter("all");
              setDateFrom("");
              setDateTo("");
              setMinAmount("");
              setMaxAmount("");
              setSortBy("newest");
              setShowAll(false);
            }}
          >
            مسح الفلاتر
          </Button>
        </div>
      ) : null}

      <div className="overflow-x-auto rounded-xl border border-line">
        <Table>
          <THead>
            <TR>
              <TH>الفاتورة</TH>
              <TH>{partyLabel}</TH>
              <TH>التاريخ</TH>
              <TH>طريقة الدفع</TH>
              <TH className="text-end">المبلغ</TH>
            </TR>
          </THead>
          <TBody>
            {visibleRows.map((row) => (
              <TR key={row.id}>
                <TD className="font-semibold text-ink">{row.number}</TD>
                <TD>{row.party}</TD>
                <TD className="text-ink-muted">{formatDate(row.date)}</TD>
                <TD className="text-ink-muted">{row.method}</TD>
                <TD className="text-end font-semibold text-emerald-600 dark:text-emerald-400">
                  {formatCurrency(row.amount, currency)}
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      </div>
      {filteredRows.length > 5 ? (
        <Button
          variant="outline"
          className="w-full"
          onClick={() => setShowAll((current) => !current)}
        >
          {showAll ? "عرض أقل" : `عرض المزيد (${filteredRows.length - 5})`}
        </Button>
      ) : null}
      {filteredRows.length === 0 ? <EmptyState title="لا توجد عمليات مطابقة للفلترة" /> : null}
    </div>
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
  hint,
  onDetails,
  detailsLabel,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  tone: "green" | "blue" | "amber" | "rose" | "violet";
  hint?: string;
  onDetails?: () => void;
  detailsLabel?: string;
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
      <div className="min-w-0 flex-1">
        <div className="text-xs text-ink-muted">{label}</div>
        <div className="font-semibold text-ink">{value}</div>
        {hint ? <div className="text-[11px] text-ink-faint truncate">{hint}</div> : null}
      </div>
      {onDetails ? (
        <button
          type="button"
          onClick={onDetails}
          title={detailsLabel}
          aria-label={detailsLabel}
          className="shrink-0 grid h-8 w-8 place-items-center rounded-lg border border-line text-ink-muted transition hover:border-brand-400 hover:bg-surface-muted hover:text-brand-600"
        >
          <PieChart className="h-4 w-4" />
        </button>
      ) : null}
    </div>
  );
}
