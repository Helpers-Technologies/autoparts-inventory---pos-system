import { useEffect, useMemo, useState } from "react";
import {
  UserRound,
  Target,
  DollarSign,
  TrendingUp,
  Calendar,
  FileText,
  Percent,
  KeyRound,
  Save,
} from "lucide-react";
import { Card, CardBody, CardHeader } from "../components/ui/Card";
import { Badge } from "../components/ui/Badge";
import { Field, Input, Select } from "../components/ui/Input";
import { Button } from "../components/ui/Button";
import { EmptyState } from "../components/ui/EmptyState";
import { Table, TBody, TD, TH, THead, TR } from "../components/ui/Table";
import { PageHeader } from "../components/layout/AppLayout";
import { useAuth } from "../store/AuthContext";
import { useUsers } from "../store/UsersContext";
import { useInvoicing } from "../store/InvoicingContext";
import { useSettings } from "../store/SettingsContext";
import { formatCurrency, formatDate } from "../lib/format";
import { useToast } from "../components/ui/Toast";
import type { AppUser, CashEntry, SalesInvoice } from "../types";

export function EmployeeProfilePage() {
  const { currentUser, updateCurrentUserProfile } = useAuth();
  const { users } = useUsers();
  const { salesInvoices, cashEntries } = useInvoicing();
  const { settings } = useSettings();
  const toast = useToast();
  const [selectedMonth, setSelectedMonth] = useState(() => monthValue(new Date()));
  const [profileName, setProfileName] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [profileErrors, setProfileErrors] = useState<Record<string, string>>({});
  const [savingProfile, setSavingProfile] = useState(false);

  const employee =
    currentUser?.role === "employee"
      ? users.find((u) => u.id === currentUser.id) ?? currentUser
      : null;
  const savedProfileName = employee?.name || employee?.username || "";

  useEffect(() => {
    setProfileName(savedProfileName);
  }, [savedProfileName]);

  const employeeId = employee?.id;

  const employeeInvoices = useMemo(
    () =>
      employeeId
        ? salesInvoices.filter((inv) => inv.createdByUserId === employeeId)
        : [],
    [salesInvoices, employeeId]
  );

  const monthOptions = useMemo(() => {
    const values = new Set<string>([monthValue(new Date())]);
    const employeeInvoiceIds = new Set(employeeInvoices.map((invoice) => invoice.id));

    employeeInvoices.forEach((invoice) => values.add(monthValue(invoice.date)));
    cashEntries.forEach((entry) => {
      if (
        entry.type === "sales-receipt" &&
        entry.referenceId &&
        employeeInvoiceIds.has(entry.referenceId)
      ) {
        values.add(monthValue(entry.date));
      }
    });

    // لكل سنة فيها بيانات (أو السنة الحالية)، أضف كل شهورها الـ 12
    const years = new Set(Array.from(values).map((v) => v.slice(0, 4)));
    years.forEach((year) => {
      for (let m = 1; m <= 12; m++) {
        values.add(`${year}-${String(m).padStart(2, "0")}`);
      }
    });

    return Array.from(values).sort((a, b) => b.localeCompare(a));
  }, [cashEntries, employeeInvoices]);

  const stats = useMemo(
    () =>
      employee
        ? calculateMonthCommissionStats({
            employee,
            invoices: employeeInvoices,
            cashEntries,
            month: selectedMonth,
          })
        : null,
    [cashEntries, employee, employeeInvoices, selectedMonth]
  );

  const hasTarget = Boolean(stats && stats.target > 0);
  const targetDelta = stats ? Math.abs(stats.commissionableSales - stats.target) : 0;
  const progress =
    stats && hasTarget ? Math.min(100, (stats.commissionableSales / stats.target) * 100) : 0;

  async function handleProfileSave() {
    const nextErrors: Record<string, string> = {};
    const changingPassword = Boolean(currentPassword || newPassword || confirmPassword);

    if (!profileName.trim()) nextErrors.name = "الاسم مطلوب";
    if (changingPassword) {
      if (!currentPassword) nextErrors.currentPassword = "أدخل كلمة المرور الحالية";
      if (newPassword.length < 6) nextErrors.newPassword = "كلمة المرور لا تقل عن 6 حروف";
      if (newPassword !== confirmPassword) nextErrors.confirmPassword = "كلمتا المرور غير متطابقتين";
    }

    if (Object.keys(nextErrors).length > 0) {
      setProfileErrors(nextErrors);
      return;
    }

    setSavingProfile(true);
    const result = await updateCurrentUserProfile({
      name: profileName.trim(),
      currentPassword: changingPassword ? currentPassword : undefined,
      newPassword: changingPassword ? newPassword : undefined,
    });
    setSavingProfile(false);

    if (result.ok) {
      setProfileErrors({});
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      toast.success("تم حفظ بياناتك");
      return;
    }

    const errorMap: Record<NonNullable<typeof result.error>, string> = {
      not_authenticated: "سجل الدخول مرة أخرى",
      invalid_name: "الاسم مطلوب",
      invalid_current_password: "كلمة المرور الحالية غير صحيحة",
      password_too_short: "كلمة المرور لا تقل عن 6 حروف",
      user_missing: "تعذر العثور على حسابك",
    };
    if (result.error === "invalid_current_password") {
      setProfileErrors({ currentPassword: errorMap[result.error] });
    } else if (result.error === "invalid_name") {
      setProfileErrors({ name: errorMap[result.error] });
    } else if (result.error === "password_too_short") {
      setProfileErrors({ newPassword: errorMap[result.error] });
    } else {
      toast.error("تعذر حفظ البيانات", errorMap[result.error ?? "not_authenticated"]);
    }
  }

  if (!currentUser || currentUser.role !== "employee") {
    return (
      <div className="flex items-center justify-center h-96">
        <EmptyState
          icon={<UserRound className="w-5 h-5" />}
          title="صفحة الموظف فقط"
          description="هذه الصفحة متاحة للموظفين فقط"
        />
      </div>
    );
  }

  if (!employee || !stats) {
    return null;
  }

  return (
    <>
      <PageHeader
        title="ملفي الشخصي"
        description="عرض معلوماتك الشخصية والراتب والعمولات والتقارير"
      />

      {/* Personal Info Card */}
      <Card className="mb-4">
        <CardHeader
          title={
            <div className="flex items-center gap-2">
              <UserRound className="w-5 h-5 text-brand-600" />
              <span>المعلومات الشخصية</span>
            </div>
          }
        />
        <CardBody className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <InfoRow label="اسم الموظف" value={employee.name || employee.username} icon={<UserRound />} />
            <InfoRow label="اسم الدخول" value={employee.username} icon={<UserRound />} />
            <InfoRow label="تاريخ الإنشاء" value={new Date(employee.createdAt).toLocaleDateString("ar-EG")} icon={<Calendar />} />
            <InfoRow label="الراتب الشهري" value={formatCurrency(employee.monthlySalary ?? 0, settings.currency)} icon={<DollarSign />} />
            <InfoRow label="نسبة العمولة" value={`${employee.salesCommissionPct ?? 0}%`} icon={<Percent />} />
            {hasTarget && (
              <InfoRow label="تارجت الربع" value={formatCurrency(stats.target, settings.currency)} icon={<Target />} />
            )}
          </div>
        </CardBody>
      </Card>

      <Card className="mb-4">
        <CardHeader
          title={
            <div className="flex items-center gap-2">
              <KeyRound className="w-5 h-5 text-brand-600" />
              <span>تعديل بيانات الموظف</span>
            </div>
          }
        />
        <CardBody>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Field label="اسم الموظف" required error={profileErrors.name}>
              <Input
                value={profileName}
                onChange={(e) => setProfileName(e.target.value)}
              />
            </Field>
            <Field label="اسم الدخول">
              <Input value={employee.username} readOnly className="bg-surface-muted" />
            </Field>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-4">
            <Field label="كلمة المرور الحالية" error={profileErrors.currentPassword}>
              <Input
                type="password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
              />
            </Field>
            <Field label="كلمة المرور الجديدة" error={profileErrors.newPassword}>
              <Input
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
              />
            </Field>
            <Field label="تأكيد كلمة المرور" error={profileErrors.confirmPassword}>
              <Input
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
              />
            </Field>
          </div>
          <div className="flex justify-end mt-4">
            <Button onClick={handleProfileSave} disabled={savingProfile}>
              <Save className="w-4 h-4" />
              {savingProfile ? "جاري الحفظ..." : "حفظ البيانات"}
            </Button>
          </div>
        </CardBody>
      </Card>

      {/* Month Selection */}
      <Card className="mb-4">
        <CardBody>
          <Field
            label="الشهر"
            hint="الإحصائيات الشهرية تعرض بيانات الشهر المحدد. العمولة الربع سنوية تُحسب على تحصيلات الربع الكامل المقابل."
          >
            <Select
              value={selectedMonth}
              onChange={(e) => setSelectedMonth(e.target.value)}
              className="w-56"
            >
              {monthOptions.map((month) => (
                <option key={month} value={month}>
                  {monthLabel(month)}
                </option>
              ))}
            </Select>
          </Field>
        </CardBody>
      </Card>

      {/* Quarterly Stats Card */}
      <Card className="mb-4">
        <CardHeader
          title={
            <div className="flex items-center gap-2">
              <TrendingUp className="w-5 h-5 text-brand-600" />
              <span>إحصائيات الربع المحدد</span>
            </div>
          }
        />
        <CardBody className="space-y-4">
          <div className="rounded-lg border border-blue-100 dark:border-blue-500/20 bg-blue-50 dark:bg-blue-500/10 px-3 py-2 text-xs text-blue-700 dark:text-blue-400">
            العمولة الربع سنوية تُحسب على الفلوس المحصلة فقط. البيع الآجل لا يدخل في العمولة إلا عند تحصيله.
          </div>

          {hasTarget && (
            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs text-ink-faint">
                <span>نسبة تحقيق التارجت الشهري من التحصيل المحتسب</span>
                <span>{Math.round(progress)}%</span>
              </div>
              <div className="h-2 rounded-full bg-surface-muted overflow-hidden">
                <div
                  className={`h-full rounded-full ${stats.achieved ? "bg-emerald-500" : "bg-amber-500"}`}
                  style={{ width: `${progress}%` }}
                />
              </div>
            </div>
          )}

          <div className="divide-y divide-line-soft border-y border-line-soft">
            <StatsRow
              label="التحصيل المحتسب للعمولة (الشهر)"
              value={formatCurrency(stats.commissionableSales, settings.currency)}
              icon={<Target />}
            />
            {hasTarget && (
              <>
                <StatsRow
                  label="التارجت الشهري"
                  value={formatCurrency(stats.target, settings.currency)}
                  icon={<Target />}
                  suffix={
                    <Badge tone={stats.achieved ? "green" : "amber"}>
                      {stats.achieved ? "محقق" : "غير محقق"}
                    </Badge>
                  }
                />
                <StatsRow
                  label={stats.achieved ? "زيادة عن التارجت" : "ناقص على التارجت"}
                  value={formatCurrency(targetDelta, settings.currency)}
                  icon={<Target />}
                  tone={stats.achieved ? "green" : "amber"}
                />
              </>
            )}
            <StatsRow
              label="الراتب الشهري"
              value={formatCurrency(stats.salary, settings.currency)}
              icon={<DollarSign />}
            />
            <StatsRow
              label={`العمولة الربع سنوية (${employee.salesCommissionPct ?? 0}%)`}
              value={formatCurrency(stats.commissionEarned, settings.currency)}
              icon={<Percent />}
            />
            <StatsRow
              label="الإجمالي المستحق"
              value={formatCurrency(stats.totalEarnings, settings.currency)}
              icon={<DollarSign />}
              tone="green"
              strong
            />
          </div>
        </CardBody>
      </Card>

      {/* Commission Collections Card */}
      <Card>
        <CardHeader
          title={
            <div className="flex items-center gap-2">
              <FileText className="w-5 h-5 text-brand-600" />
              <span>تحصيلات الشهر المحتسبة للعمولة</span>
            </div>
          }
        />
        <CardBody>
          {stats.collectionRows.length === 0 ? (
            <EmptyState
              icon={<FileText className="w-5 h-5" />}
              title="لا توجد تحصيلات محتسبة"
              description="لا توجد فلوس محصلة داخل هذا الربع لفواتير هذا الموظف"
            />
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>رقم الفاتورة</TH>
                  <TH>تاريخ الفاتورة</TH>
                  <TH>تاريخ التحصيل</TH>
                  <TH>العميل</TH>
                  <TH>نوع البيع</TH>
                  <TH className="text-end">المبلغ المحتسب</TH>
                  <TH className="text-end">مبلغ العمولة</TH>
                  <TH>حالة الفاتورة الآن</TH>
                </TR>
              </THead>
              <TBody>
                {stats.collectionRows.map((row) => (
                  <TR key={row.id}>
                    <TD>{row.invoiceNumber}</TD>
                    <TD>{formatDate(row.invoiceDate)}</TD>
                    <TD>{formatDate(row.collectionDate)}</TD>
                    <TD>{row.customerName}</TD>
                    <TD>
                      <Badge tone={row.paymentType === "cash" ? "green" : "indigo"}>
                        {row.paymentType === "cash" ? "كاش" : "آجل"}
                      </Badge>
                    </TD>
                    <TD className="text-end font-semibold text-emerald-700 dark:text-emerald-400">
                      {formatCurrency(row.amount, settings.currency)}
                    </TD>
                    <TD className="text-end font-semibold text-brand-700">
                      {formatCurrency(row.amount * (employee.salesCommissionPct ?? 0) / 100, settings.currency)}
                    </TD>
                    <TD>
                      <Badge tone={row.status === "paid" ? "green" : row.status === "partial" ? "amber" : "red"}>
                        {row.status === "paid" ? "مدفوع" : row.status === "partial" ? "مدفوع جزئياً" : "غير مدفوع"}
                      </Badge>
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </CardBody>
      </Card>
    </>
  );
}

type CommissionCollectionRow = {
  id: string;
  invoiceNumber: string;
  invoiceDate: string;
  collectionDate: string;
  customerName: string;
  paymentType: SalesInvoice["paymentType"];
  status: SalesInvoice["status"];
  amount: number;
};

type QuarterCommissionStats = {
  commissionableSales: number;
  target: number;
  achieved: boolean;
  commissionEarned: number;
  salary: number;
  totalEarnings: number;
  collectionRows: CommissionCollectionRow[];
};

function calculateMonthCommissionStats({
  employee,
  invoices,
  cashEntries,
  month,
}: {
  employee: AppUser;
  invoices: SalesInvoice[];
  cashEntries: CashEntry[];
  month: string;
}): QuarterCommissionStats {
  const mRange = monthRange(month);
  const qRange = quarterRangeForMonth(month);

  const displayRows: CommissionCollectionRow[] = [];
  let quarterlyCommissionable = 0;

  invoices
    .filter((invoice) => !invoice.cancelled)
    .forEach((invoice) => {
      const receiptEntries = cashEntries
        .filter(
          (entry) =>
            entry.type === "sales-receipt" &&
            entry.referenceId === invoice.id &&
            entry.amount > 0
        )
        .sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));

      const entries =
        receiptEntries.length > 0
          ? receiptEntries
          : invoice.amountReceived > 0
            ? [
                {
                  id: `legacy-${invoice.id}`,
                  type: "sales-receipt" as const,
                  amount: invoice.amountReceived,
                  description: "",
                  referenceId: invoice.id,
                  date: invoice.date,
                },
              ]
            : [];

      let remainingCommissionable = invoice.total;

      entries.forEach((entry) => {
        if (remainingCommissionable <= 0) return;

        const amount = Math.min(entry.amount, remainingCommissionable);
        remainingCommissionable -= amount;

        if (amount <= 0) return;

        if (dateInRange(entry.date, qRange.start, qRange.end)) {
          quarterlyCommissionable += amount;
        }

        if (!dateInRange(entry.date, mRange.start, mRange.end)) return;

        displayRows.push({
          id: entry.id,
          invoiceNumber: invoice.invoiceNumber,
          invoiceDate: invoice.date,
          collectionDate: entry.date,
          customerName: invoice.customerName,
          paymentType: invoice.paymentType,
          status: invoice.status,
          amount,
        });
      });
    });

  displayRows.sort((a, b) => b.collectionDate.localeCompare(a.collectionDate) || a.invoiceNumber.localeCompare(b.invoiceNumber));

  const commissionableSales = displayRows.reduce((sum, row) => sum + row.amount, 0);
  const target = employee.monthlySalesTarget ?? 0;
  const commissionPct = employee.salesCommissionPct ?? 0;
  const commissionEarned = (quarterlyCommissionable * commissionPct) / 100;
  const salary = employee.monthlySalary ?? 0;

  return {
    commissionableSales,
    target,
    achieved: target > 0 && commissionableSales >= target,
    commissionEarned,
    salary,
    totalEarnings: salary + commissionEarned,
    collectionRows: displayRows,
  };
}

function monthValue(value: string | Date): string {
  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return monthValue(new Date());
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  return `${yyyy}-${mm}`;
}

function monthLabel(value: string): string {
  const date = new Date(value + "-01");
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString("ar-EG", { year: "numeric", month: "long" });
}

function monthRange(value: string): { start: string; end: string } {
  const date = new Date(value + "-01");
  const year = date.getFullYear();
  const month = date.getMonth();
  return {
    start: toDateOnly(new Date(year, month, 1)),
    end: toDateOnly(new Date(year, month + 1, 0)),
  };
}

function quarterRangeForMonth(monthStr: string): { start: string; end: string } {
  const date = new Date(monthStr + "-01");
  const year = date.getFullYear();
  const quarterStart = Math.floor(date.getMonth() / 3) * 3;
  return {
    start: toDateOnly(new Date(year, quarterStart, 1)),
    end: toDateOnly(new Date(year, quarterStart + 3, 0)),
  };
}

function toDateOnly(date: Date): string {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function dateInRange(date: string, start: string, end: string): boolean {
  const value = date.slice(0, 10);
  return value >= start && value <= end;
}

function InfoRow({ label, value, icon }: { label: string; value: string; icon: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 text-sm">
      <div className="text-ink-faint">{icon}</div>
      <div className="text-ink-muted">{label}:</div>
      <div className="font-semibold text-ink">{value}</div>
    </div>
  );
}

function StatsRow({
  label,
  value,
  icon,
  suffix,
  tone = "slate",
  strong,
}: {
  label: string;
  value: string;
  icon: React.ReactNode;
  suffix?: React.ReactNode;
  tone?: "slate" | "green" | "amber";
  strong?: boolean;
}) {
  const colors: Record<"slate" | "green" | "amber", string> = {
    slate: "text-ink",
    green: "text-emerald-700 dark:text-emerald-400",
    amber: "text-amber-700 dark:text-amber-400",
  };

  return (
    <div className="flex items-center justify-between gap-3 py-3 text-sm">
      <div className="flex items-center gap-2 text-ink-muted">
        <div className="text-ink-faint">{icon}</div>
        <span>{label}</span>
      </div>
      <div className="flex items-center gap-2">
        {suffix}
        <span className={`${colors[tone]} ${strong ? "font-bold text-base" : "font-semibold"}`}>
          {value}
        </span>
      </div>
    </div>
  );
}
