import { useEffect, useMemo, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import {
  UserRound,
  DollarSign,
  FileText,
  KeyRound,
  Save,
  Shield,
  Clock,
  Target,
  Edit,
  CheckCircle2,
  Lock,
  Award,
  ArrowRight,
  Plus,
  Minus,
  HandCoins,
} from "lucide-react";
import { Card, CardBody, CardHeader } from "../components/ui/Card";
import { Badge } from "../components/ui/Badge";
import { Field, Input, Select, Textarea } from "../components/ui/Input";
import { Button } from "../components/ui/Button";
import { EmptyState } from "../components/ui/EmptyState";
import { Dialog } from "../components/ui/Dialog";
import { Table, TBody, TD, TH, THead, TR } from "../components/ui/Table";
import { PageHeader } from "../components/layout/AppLayout";
import { useAuth } from "../store/AuthContext";
import { useUsers } from "../store/UsersContext";
import { useInvoicing } from "../store/InvoicingContext";
import { useSettings } from "../store/SettingsContext";
import { formatCurrency, formatDate, formatDateTime } from "../lib/format";
import { useToast } from "../components/ui/Toast";
import type { UserPermissions } from "../types";
import { TwoFactorSecurityPanel } from "../components/security/TwoFactorSecurityPanel";
import { PaidFeatureNotice } from "../components/PaidFeatureNotice";
import { useFeatures } from "../lib/useFeatures";
import {
  PERMISSION_GROUPS,
  areAllPermissionsEnabled,
  createPermissions,
  normalizePermissions,
  setPermission,
  setPermissionGroup,
} from "../lib/permissions";

function monthValue(d: Date | string): string {
  const date = typeof d === "string" ? new Date(d) : d;
  if (isNaN(date.getTime())) return new Date().toISOString().slice(0, 7);
  return date.toISOString().slice(0, 7);
}

function monthLabel(monthStr: string): string {
  const [year, month] = monthStr.split("-");
  const monthNames = [
    "يناير",
    "فبراير",
    "مارس",
    "أبريل",
    "مايو",
    "يونيو",
    "يوليو",
    "أغسطس",
    "سبتمبر",
    "أكتوبر",
    "نوفمبر",
    "ديسمبر",
  ];
  const idx = parseInt(month, 10) - 1;
  return `${monthNames[idx] || month} ${year}`;
}

export function EmployeeProfilePage() {
  const { id } = useParams<{ id?: string }>();
  const navigate = useNavigate();
  const { currentUser, updateCurrentUserProfile } = useAuth();
  const { users, updateUser } = useUsers();
  const { salesInvoices, shifts } = useInvoicing();
  const { settings } = useSettings();
  const { isAllowed } = useFeatures();
  const toast = useToast();

  const isOwner = currentUser?.role === "owner";
  const targetUserId = id || currentUser?.id;
  const employee = useMemo(
    () => users.find((u) => u.id === targetUserId) || (targetUserId === currentUser?.id ? currentUser : null),
    [users, targetUserId, currentUser]
  );

  const [activeTab, setActiveTab] = useState<"sales" | "shifts" | "permissions" | "settings">("sales");
  const [selectedMonth, setSelectedMonth] = useState(() => monthValue(new Date()));

  // Profile Edit State for Password
  const [profileName, setProfileName] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [profileErrors, setProfileErrors] = useState<Record<string, string>>({});
  const [savingProfile, setSavingProfile] = useState(false);

  // Quick Financial Action Modal (Bonus / Penalty / Advance)
  const [finModalOpen, setFinModalOpen] = useState(false);
  const [finActionType, setFinActionType] = useState<"bonus" | "penalty" | "advance">("bonus");
  const [finAmount, setFinAmount] = useState<number>(0);
  const [finNotes, setFinNotes] = useState<string>("");

  function openFinModal(type: "bonus" | "penalty" | "advance") {
    setFinActionType(type);
    setFinAmount(0);
    setFinNotes("");
    setFinModalOpen(true);
  }

  function handleSaveFinancialAction() {
    if (!employee) return;
    if (finAmount <= 0) {
      toast.error("المبلغ يجب أن يكون أكبر من صفر");
      return;
    }

    const currentConfig = employee.monthlyConfigs?.[selectedMonth] || {};
    let currentVal = 0;
    let labelStr = "";

    if (finActionType === "bonus") {
      currentVal = currentConfig.bonus || 0;
      labelStr = "مكافأة / بونص";
    } else if (finActionType === "penalty") {
      currentVal = currentConfig.penalty || 0;
      labelStr = "خصم / جَزاء";
    } else if (finActionType === "advance") {
      currentVal = currentConfig.advance || 0;
      labelStr = "سُلفة مالية";
    }

    const newVal = currentVal + finAmount;

    const updatedConfigs = {
      ...(employee.monthlyConfigs || {}),
      [selectedMonth]: {
        ...currentConfig,
        [finActionType]: newVal,
      },
    };

    updateUser(employee.id, {
      monthlyConfigs: updatedConfigs,
    });

    toast.success(`تم إضافة ${labelStr} بمبلغ ${formatCurrency(finAmount, settings.currency)} للموظف ${employee.name}`);
    setFinModalOpen(false);
    setFinAmount(0);
    setFinNotes("");
  }

  // Admin Permissions & Details Edit Modal State
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [editForm, setEditForm] = useState<{
    name: string;
    username: string;
    role: "owner" | "employee";
    monthlySalary: string;
    bonus: string;
    penalty: string;
    advance: string;
    salesCommissionPct: string;
    monthlySalesTarget: string;
    permissions: UserPermissions;
  }>({
    name: "",
    username: "",
    role: "employee",
    monthlySalary: "0",
    bonus: "0",
    penalty: "0",
    advance: "0",
    salesCommissionPct: "0",
    monthlySalesTarget: "0",
    permissions: createPermissions(false),
  });

  const savedProfileName = employee?.name || employee?.username || "";
  useEffect(() => {
    setProfileName(savedProfileName);
  }, [savedProfileName]);

  const openAdminEditModal = () => {
    if (!employee) return;
    const currentConfig = employee.monthlyConfigs?.[selectedMonth] || {};
    setEditForm({
      name: employee.name || "",
      username: employee.username || "",
      role: employee.role,
      monthlySalary: String(employee.monthlySalary ?? 0),
      bonus: String(currentConfig.bonus ?? 0),
      penalty: String(currentConfig.penalty ?? 0),
      advance: String(currentConfig.advance ?? 0),
      salesCommissionPct: String(currentConfig.commissionPct ?? employee.salesCommissionPct ?? 0),
      monthlySalesTarget: String(currentConfig.target ?? employee.monthlySalesTarget ?? 0),
      permissions: normalizePermissions(employee.permissions),
    });
    setIsEditModalOpen(true);
  };

  const handleSaveAdminEdit = () => {
    if (!employee) return;
    if (!editForm.name.trim()) {
      toast.error("الاسم مطلوب");
      return;
    }

    const updatedMonthlyConfigs = {
      ...(employee.monthlyConfigs || {}),
      [selectedMonth]: {
        target: Number(editForm.monthlySalesTarget) || 0,
        commissionPct: Number(editForm.salesCommissionPct) || 0,
        bonus: Number(editForm.bonus) || 0,
        penalty: Number(editForm.penalty) || 0,
        advance: Number(editForm.advance) || 0,
      },
    };

    updateUser(employee.id, {
      name: editForm.name.trim(),
      role: editForm.role,
      monthlySalary: Number(editForm.monthlySalary) || 0,
      salesCommissionPct: Number(editForm.salesCommissionPct) || 0,
      monthlySalesTarget: Number(editForm.monthlySalesTarget) || 0,
      monthlyConfigs: updatedMonthlyConfigs,
      permissions: normalizePermissions(editForm.permissions),
    });

    toast.success("تم تحديث صلاحيات وتفاصيل الموظف بنجاح");
    setIsEditModalOpen(false);
  };

  // Employee-specific invoices & shifts
  const employeeInvoices = useMemo(
    () => (employee ? salesInvoices.filter((inv) => inv.createdByUserId === employee.id) : []),
    [salesInvoices, employee]
  );

  const employeeShifts = useMemo(
    () => (employee ? shifts.filter((s) => s.cashierId === employee.id || s.cashierName === employee.name) : []),
    [shifts, employee]
  );

  // Month options
  const monthOptions = useMemo(() => {
    const values = new Set<string>([monthValue(new Date())]);
    employeeInvoices.forEach((inv) => values.add(monthValue(inv.date)));
    employeeShifts.forEach((s) => values.add(monthValue(s.openedAt)));
    return Array.from(values).sort((a, b) => b.localeCompare(a));
  }, [employeeInvoices, employeeShifts]);

  // Monthly stats computation
  const monthlyStats = useMemo(() => {
    if (!employee) return null;
    const monthInvoices = employeeInvoices.filter((inv) => monthValue(inv.date) === selectedMonth);
    const totalSalesMonth = monthInvoices.reduce((sum, inv) => sum + inv.total, 0);

    const monthCollected = monthInvoices.reduce(
      (sum, inv) => sum + Math.min(inv.total, inv.amountReceived + (inv.overpayment ?? 0)),
      0
    );

    const currentConfig = employee.monthlyConfigs?.[selectedMonth] || {};
    const target = currentConfig.target ?? employee.monthlySalesTarget ?? 0;
    const commissionPct = currentConfig.commissionPct ?? employee.salesCommissionPct ?? 0;
    const bonus = currentConfig.bonus ?? 0;
    const penalty = currentConfig.penalty ?? 0;
    const advance = currentConfig.advance ?? 0;
    const baseSalary = employee.monthlySalary ?? 0;

    const targetAchievedPct = target > 0 ? Math.min(100, Math.round((totalSalesMonth / target) * 100)) : 0;
    const commissionEarned = Math.round(((totalSalesMonth * commissionPct) / 100) * 100) / 100;
    const netPayable = Math.max(0, baseSalary + bonus + commissionEarned - penalty - advance);

    const monthShifts = employeeShifts.filter((s) => monthValue(s.openedAt) === selectedMonth);

    return {
      monthInvoicesCount: monthInvoices.length,
      totalSalesMonth,
      monthCollected,
      target,
      commissionPct,
      targetAchievedPct,
      commissionEarned,
      baseSalary,
      bonus,
      penalty,
      advance,
      netPayable,
      monthShiftsCount: monthShifts.length,
    };
  }, [employee, employeeInvoices, employeeShifts, selectedMonth]);

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
      toast.success("تم حفظ بياناتك بنجاح");
      return;
    }

    toast.error("تعذر حفظ البيانات", result.error || "خطأ في الاتصال");
  }

  if (!employee) {
    return (
      <div className="flex items-center justify-center h-96" dir="rtl">
        <EmptyState
          icon={<UserRound className="w-8 h-8 text-ink-faint" />}
          title="الموظف غير موجود"
          description="لم نتمكن من العثور على بيانات هذا المستخدم في النظام."
          action={
            <Button variant="outline" onClick={() => navigate("/users")}>
              <ArrowRight className="w-4 h-4 ml-1.5" /> العودة لقائمة المستخدمين
            </Button>
          }
        />
      </div>
    );
  }

  const normalizedUserPermissions = normalizePermissions(employee.permissions);
  const allPermissionsSelected = areAllPermissionsEnabled(editForm.permissions);

  return (
    <div className="space-y-6" dir="rtl">
      {/* Top Page Header */}
      <PageHeader
        title={`ملف الموظف: ${employee.name || employee.username}`}
        description={`اسم المستخدم: ${employee.username} | تاريخ الإضافة: ${formatDate(employee.createdAt)}`}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {isOwner && (
              <>
                <Button
                  variant="outline"
                  className="border-emerald-500/50 text-emerald-700 dark:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-500/10"
                  onClick={() => openFinModal("bonus")}
                >
                  <Plus className="w-4 h-4 ml-1" /> إضافة بونص
                </Button>

                <Button
                  variant="outline"
                  className="border-rose-500/50 text-rose-700 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-500/10"
                  onClick={() => openFinModal("penalty")}
                >
                  <Minus className="w-4 h-4 ml-1" /> تسجيل جَزاء
                </Button>

                <Button
                  variant="outline"
                  className="border-amber-500/50 text-amber-700 dark:text-amber-400 hover:bg-amber-50 dark:hover:bg-amber-500/10"
                  onClick={() => openFinModal("advance")}
                >
                  <HandCoins className="w-4 h-4 ml-1" /> صرف سُلفة
                </Button>

                <Button variant="primary" onClick={openAdminEditModal}>
                  <Edit className="w-4 h-4 ml-1.5" />
                  تعديل الصلاحيات والمستهدف
                </Button>
              </>
            )}
            <Button variant="outline" onClick={() => navigate("/users")}>
              <ArrowRight className="w-4 h-4 ml-1.5" /> العودة للمستخدمين
            </Button>
          </div>
        }
      />

      {/* User Header Profile Banner */}
      <Card className="bg-gradient-to-l from-brand-600/10 via-brand-500/5 to-transparent border-brand-500/20">
        <CardBody className="p-6">
          <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-6">
            <div className="flex items-center gap-4">
              <div className="w-16 h-16 rounded-2xl bg-brand-600 text-white flex items-center justify-center text-2xl font-bold shadow-lg shadow-brand-600/20">
                {(employee.name || employee.username).charAt(0).toUpperCase()}
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="text-xl font-bold text-ink">{employee.name || employee.username}</h2>
                  {employee.role === "owner" ? (
                    <Badge tone="indigo">
                      <Shield className="w-3.5 h-3.5 ml-1" /> مالك النظام
                    </Badge>
                  ) : normalizedUserPermissions.pos?.supervisorOverride ? (
                    <Badge tone="indigo">
                      <Award className="w-3.5 h-3.5 ml-1" /> مشرف ورديات
                    </Badge>
                  ) : (
                    <Badge tone="blue">موظف / كاشير</Badge>
                  )}
                </div>
                <div className="text-xs text-ink-muted mt-1.5 flex flex-wrap items-center gap-4">
                  <span>اسم الدخول: <strong className="text-ink">{employee.username}</strong></span>
                  <span>•</span>
                  <span>الراتب الشهري: <strong className="text-emerald-600 font-bold">{formatCurrency(employee.monthlySalary ?? 0, settings.currency)}</strong></span>
                  <span>•</span>
                  <span>نسبة العمولة: <strong className="text-brand-600 font-bold">{employee.salesCommissionPct ?? 0}%</strong></span>
                </div>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <Field label="الشهر الحالي للتقرير">
                <Select
                  value={selectedMonth}
                  onChange={(e) => setSelectedMonth(e.target.value)}
                  className="w-48 font-semibold"
                >
                  {monthOptions.map((m) => (
                    <option key={m} value={m}>
                      {monthLabel(m)}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
          </div>
        </CardBody>
      </Card>

      {/* KPI Cards Grid */}
      {monthlyStats && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="p-4 rounded-xl border border-line bg-surface space-y-2 shadow-sm">
            <div className="flex items-center justify-between text-xs text-ink-muted">
              <span>إجمالي المبيعات والتحصيل</span>
              <DollarSign className="w-4 h-4 text-emerald-600" />
            </div>
            <div className="text-2xl font-bold text-ink">
              {formatCurrency(monthlyStats.totalSalesMonth, settings.currency)}
            </div>
            <div className="text-xs text-ink-faint">
              عدد الفواتير الصادرة: <strong>{monthlyStats.monthInvoicesCount}</strong> فاتورة
            </div>
          </div>

          <div className="p-4 rounded-xl border border-line bg-surface space-y-2 shadow-sm">
            <div className="flex items-center justify-between text-xs text-ink-muted">
              <span>نسبة تحقيق الهدف الشهري</span>
              <Target className="w-4 h-4 text-brand-600" />
            </div>
            <div className="text-2xl font-bold text-brand-600">
              {monthlyStats.targetAchievedPct}%
            </div>
            <div className="w-full bg-surface-muted h-2 rounded-full overflow-hidden">
              <div
                className="bg-brand-600 h-full transition-all duration-500"
                style={{ width: `${monthlyStats.targetAchievedPct}%` }}
              />
            </div>
            <div className="text-[11px] text-ink-faint">
              المستهدف: {formatCurrency(monthlyStats.target, settings.currency)}
            </div>
          </div>

          <div className="p-4 rounded-xl border border-line bg-surface space-y-2 shadow-sm">
            <div className="flex items-center justify-between text-xs text-ink-muted">
              <span>العمولة المحسوبة هذا الشهر</span>
              <Award className="w-4 h-4 text-amber-600" />
            </div>
            <div className="text-2xl font-bold text-amber-600">
              {formatCurrency(monthlyStats.commissionEarned, settings.currency)}
            </div>
            <div className="text-xs text-ink-faint">
              النسبة المعتمدة: <strong>{monthlyStats.commissionPct}%</strong> من إجمالي البيع
            </div>
          </div>

          <div className="p-4 rounded-xl border border-line bg-surface space-y-2 shadow-sm">
            <div className="flex items-center justify-between text-xs text-ink-muted">
              <span>الورديات ومطابقة الدرج</span>
              <Clock className="w-4 h-4 text-purple-600" />
            </div>
            <div className="text-2xl font-bold text-purple-600">
              {monthlyStats.monthShiftsCount} وردية
            </div>
            <div className="text-xs text-ink-faint">
              مجموع ورديات الكاشير لشهر {monthLabel(selectedMonth)}
            </div>
          </div>
        </div>
      )}

      {/* Monthly Financial Breakdown Card */}
      {monthlyStats && (
        <Card>
          <CardHeader
            title={`حساب المرتب والخصومات والبونص لشهر ${monthLabel(selectedMonth)}`}
            subtitle="المرتب الأساسي + العمولة + البونص - الخصومات/الجزاءات - السُلف = صافي المستحق"
          />
          <CardBody>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 text-center">
              <div className="p-3 rounded-lg border border-line bg-surface-muted">
                <div className="text-xs text-ink-muted mb-1">الراتب الأساسي</div>
                <div className="font-mono text-base font-bold text-ink">
                  {formatCurrency(monthlyStats.baseSalary, settings.currency)}
                </div>
              </div>

              <div className="p-3 rounded-lg border border-line bg-surface-muted">
                <div className="text-xs text-ink-muted mb-1">العمولة المستحقة (+)</div>
                <div className="font-mono text-base font-bold text-emerald-600">
                  +{formatCurrency(monthlyStats.commissionEarned, settings.currency)}
                </div>
              </div>

              <div className="p-3 rounded-lg border border-line bg-surface-muted">
                <div className="text-xs text-ink-muted mb-1">المكافأة / البونص (+)</div>
                <div className="font-mono text-base font-bold text-emerald-600">
                  +{formatCurrency(monthlyStats.bonus, settings.currency)}
                </div>
              </div>

              <div className="p-3 rounded-lg border border-line bg-surface-muted">
                <div className="text-xs text-ink-muted mb-1">الخصومات والجزاءات (-)</div>
                <div className="font-mono text-base font-bold text-rose-600">
                  -{formatCurrency(monthlyStats.penalty, settings.currency)}
                </div>
              </div>

              <div className="p-3 rounded-lg border border-line bg-surface-muted">
                <div className="text-xs text-ink-muted mb-1">السُلف المسحوبة (-)</div>
                <div className="font-mono text-base font-bold text-rose-600">
                  -{formatCurrency(monthlyStats.advance, settings.currency)}
                </div>
              </div>

              <div className="p-3 rounded-lg border border-brand-300 dark:border-brand-500/40 bg-brand-50/50 dark:bg-brand-500/10">
                <div className="text-xs font-semibold text-brand-700 dark:text-brand-300 mb-1">صافي المستحق النهائي</div>
                <div className="font-mono text-base font-extrabold text-brand-700 dark:text-brand-300">
                  {formatCurrency(monthlyStats.netPayable, settings.currency)}
                </div>
              </div>
            </div>
          </CardBody>
        </Card>
      )}

      {/* Tabs Navigation */}
      <div className="border-b border-line flex items-center gap-2">
        <button
          onClick={() => setActiveTab("sales")}
          className={`px-4 py-3 font-medium text-sm border-b-2 transition-colors flex items-center gap-2 ${
            activeTab === "sales"
              ? "border-brand-600 text-brand-600 bg-brand-50/50 dark:bg-brand-500/10"
              : "border-transparent text-ink-muted hover:text-ink"
          }`}
        >
          <FileText className="w-4 h-4" /> فواتير ومبيعات الموظف ({employeeInvoices.length})
        </button>

        <button
          onClick={() => setActiveTab("shifts")}
          className={`px-4 py-3 font-medium text-sm border-b-2 transition-colors flex items-center gap-2 ${
            activeTab === "shifts"
              ? "border-brand-600 text-brand-600 bg-brand-50/50 dark:bg-brand-500/10"
              : "border-transparent text-ink-muted hover:text-ink"
          }`}
        >
          <Clock className="w-4 h-4" /> ورديات الكاشير ({employeeShifts.length})
        </button>

        <button
          onClick={() => setActiveTab("permissions")}
          className={`px-4 py-3 font-medium text-sm border-b-2 transition-colors flex items-center gap-2 ${
            activeTab === "permissions"
              ? "border-brand-600 text-brand-600 bg-brand-50/50 dark:bg-brand-500/10"
              : "border-transparent text-ink-muted hover:text-ink"
          }`}
        >
          <Shield className="w-4 h-4" /> مصفوفة الصلاحيات
        </button>

        <button
          onClick={() => setActiveTab("settings")}
          className={`px-4 py-3 font-medium text-sm border-b-2 transition-colors flex items-center gap-2 ${
            activeTab === "settings"
              ? "border-brand-600 text-brand-600 bg-brand-50/50 dark:bg-brand-500/10"
              : "border-transparent text-ink-muted hover:text-ink"
          }`}
        >
          <KeyRound className="w-4 h-4" /> كلمة المرور والحساب
        </button>
      </div>

      {/* TAB 1: Sales Invoices */}
      {activeTab === "sales" && (
        <Card>
          <CardHeader title={`سجل فواتير مبيعات الموظف (${employeeInvoices.length} فاتورة)`} />
          <CardBody>
            {employeeInvoices.length === 0 ? (
              <EmptyState
                icon={<FileText className="w-6 h-6 text-ink-faint" />}
                title="لا توجد فواتير"
                description="لم يقم هذا الموظف بإصدار أي فواتير مبيعات حتى الآن."
              />
            ) : (
              <Table>
                <THead>
                  <TR>
                    <TH>رقم الفاتورة</TH>
                    <TH>تاريخ الفاتورة</TH>
                    <TH>اسم العميل</TH>
                    <TH>الإجمالي</TH>
                    <TH>المحصل</TH>
                    <TH>طريقة الدفع</TH>
                  </TR>
                </THead>
                <TBody>
                  {employeeInvoices.map((inv) => (
                    <TR key={inv.id}>
                      <TD className="font-bold text-brand-600">{inv.invoiceNumber}</TD>
                      <TD className="text-xs text-ink-muted">{formatDate(inv.date)}</TD>
                      <TD>{inv.customerName}</TD>
                      <TD className="font-bold">{formatCurrency(inv.total, settings.currency)}</TD>
                      <TD className="text-emerald-600 font-semibold">
                        {formatCurrency(inv.amountReceived, settings.currency)}
                      </TD>
                      <TD>
                        <Badge tone={inv.paymentType === "cash" ? "green" : "indigo"}>
                          {inv.paymentType === "cash" ? "كاش" : "آجل"}
                        </Badge>
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            )}
          </CardBody>
        </Card>
      )}

      {/* TAB 2: Cashier Shifts */}
      {activeTab === "shifts" && (
        <Card>
          <CardHeader title={`سجل ورديات الكاشير لهذا الموظف (${employeeShifts.length} وردية)`} />
          <CardBody>
            {employeeShifts.length === 0 ? (
              <EmptyState
                icon={<Clock className="w-6 h-6 text-ink-faint" />}
                title="لا توجد ورديات"
                description="لم يقم هذا الموظف بفتح أو إدارة أي ورديات كاشير حتى الآن."
              />
            ) : (
              <Table>
                <THead>
                  <TR>
                    <TH>رقم الوردية</TH>
                    <TH>تاريخ ووقت البدء</TH>
                    <TH>تاريخ ووقت الإغلاق</TH>
                    <TH>الافتتاحي</TH>
                    <TH>المتوقع</TH>
                    <TH>الفعلي بالدرج</TH>
                    <TH>العجز / الزيادة</TH>
                    <TH>الحالة</TH>
                  </TR>
                </THead>
                <TBody>
                  {employeeShifts.map((s) => (
                    <TR key={s.id}>
                      <TD className="font-bold">#{s.shiftNumber}</TD>
                      <TD className="text-xs text-ink-muted">{formatDateTime(s.openedAt)}</TD>
                      <TD className="text-xs text-ink-muted">{s.closedAt ? formatDateTime(s.closedAt) : "---"}</TD>
                      <TD>{formatCurrency(s.openingCash, settings.currency)}</TD>
                      <TD>{formatCurrency(s.expectedCash ?? s.openingCash, settings.currency)}</TD>
                      <TD>{s.closingCashActual !== undefined ? formatCurrency(s.closingCashActual, settings.currency) : "---"}</TD>
                      <TD className="font-bold">
                        {s.difference === undefined || s.difference === 0 ? (
                          <span className="text-emerald-600">مطابق (0)</span>
                        ) : s.difference > 0 ? (
                          <span className="text-emerald-600">+{formatCurrency(s.difference, settings.currency)} زيادة</span>
                        ) : (
                          <span className="text-red-600">{formatCurrency(s.difference, settings.currency)} عجز</span>
                        )}
                      </TD>
                      <TD>
                        <Badge tone={s.status === "open" ? "emerald" : "slate"}>
                          {s.status === "open" ? "نشطة الآن" : "مغلقة"}
                        </Badge>
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            )}
          </CardBody>
        </Card>
      )}

      {/* TAB 3: Permissions Matrix */}
      {activeTab === "permissions" && (
        <Card>
          <CardHeader
            title="مصفوفة الصلاحيات الممنوحة لهذا المستخدم"
            actions={
              isOwner && (
                <Button size="sm" variant="primary" onClick={openAdminEditModal}>
                  <Edit className="w-4 h-4 ml-1.5" /> تعديل الصلاحيات الآن
                </Button>
              )
            }
          />
          <CardBody>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {PERMISSION_GROUPS.map((group) => {
                const groupPermissions = (normalizedUserPermissions[group.key] ?? {}) as Record<string, boolean>;

                return (
                  <div key={group.key} className="space-y-3 bg-surface p-4 rounded-xl border border-line">
                    <div className="font-bold text-sm text-ink flex items-center justify-between">
                      <span>{group.label}</span>
                      <span className="text-xs font-normal text-ink-faint">{group.description}</span>
                    </div>
                    <div className="grid grid-cols-2 gap-2 text-xs">
                      {group.actions.map((action) => {
                        const isGranted = Boolean(groupPermissions[action.key]) || employee.role === "owner";
                        return (
                          <div
                            key={action.key}
                            className={`p-2 rounded-lg border flex items-center gap-2 ${
                              isGranted
                                ? "bg-emerald-50/50 dark:bg-emerald-500/10 border-emerald-200 dark:border-emerald-500/20 text-emerald-800 dark:text-emerald-300"
                                : "bg-surface-muted border-line text-ink-faint opacity-60"
                            }`}
                          >
                            {isGranted ? (
                              <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400 flex-shrink-0" />
                            ) : (
                              <Lock className="w-4 h-4 text-ink-faint flex-shrink-0" />
                            )}
                            <span className="font-medium">{action.label}</span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          </CardBody>
        </Card>
      )}

      {/* TAB 4: Account Settings & Password */}
      {activeTab === "settings" && (
        <div className="space-y-6">
          <Card>
            <CardHeader title="تعديل اسم الموظف وكلمة المرور" />
            <CardBody className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <Field label="اسم الموظف" required error={profileErrors.name}>
                  <Input value={profileName} onChange={(e) => setProfileName(e.target.value)} />
                </Field>
                <Field label="اسم الدخول">
                  <Input value={employee.username} readOnly className="bg-surface-muted" />
                </Field>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
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

              <div className="flex justify-end pt-2">
                <Button onClick={handleProfileSave} disabled={savingProfile}>
                  <Save className="w-4 h-4 ml-1.5" />
                  {savingProfile ? "جاري الحفظ..." : "حفظ التغييرات"}
                </Button>
              </div>
            </CardBody>
          </Card>

          {isAllowed("twoFactorAuth") ? (
            <TwoFactorSecurityPanel currentUser={employee} isOwner={employee.role === "owner"} />
          ) : (
            <PaidFeatureNotice
              title="المصادقة الثنائية والأكواد الاحتياطية"
              description="تتيح هذه الإضافة حماية الحساب بأكواد جوجل وتطبيق الأمان."
            />
          )}
        </div>
      )}

      {/* Admin User & Permissions Edit Modal */}
      {isOwner && (
        <Dialog
          open={isEditModalOpen}
          onClose={() => setIsEditModalOpen(false)}
          title={`تعديل تفاصيل وصلاحيات الموظف (${employee.name || employee.username})`}
          width="lg"
          footer={
            <div className="flex items-center justify-end gap-2">
              <Button variant="outline" onClick={() => setIsEditModalOpen(false)}>
                إلغاء
              </Button>
              <Button onClick={handleSaveAdminEdit} variant="primary">
                <Save className="w-4 h-4 ml-1.5" /> حفظ الصلاحيات والتفاصيل
              </Button>
            </div>
          }
        >
          <div className="space-y-5 max-h-[75vh] overflow-y-auto pe-1" dir="rtl">
            {/* Employee Basic Config */}
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4 p-4 rounded-xl border border-line bg-surface-muted">
              <Field label="اسم الموظف" required>
                <Input
                  value={editForm.name}
                  onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                />
              </Field>

              <Field label="الراتب الشهري (ج.م)">
                <Input
                  type="number"
                  min={0}
                  value={editForm.monthlySalary}
                  onChange={(e) => setEditForm({ ...editForm, monthlySalary: e.target.value })}
                />
              </Field>

              <Field label={`المكافآت / البونص لشهر ${selectedMonth} (+)`}>
                <Input
                  type="number"
                  min={0}
                  value={editForm.bonus}
                  onChange={(e) => setEditForm({ ...editForm, bonus: e.target.value })}
                />
              </Field>

              <Field label={`الخصومات والجزاءات لشهر ${selectedMonth} (-)`}>
                <Input
                  type="number"
                  min={0}
                  value={editForm.penalty}
                  onChange={(e) => setEditForm({ ...editForm, penalty: e.target.value })}
                />
              </Field>

              <Field label={`السُلف المسحوبة لشهر ${selectedMonth} (-)`}>
                <Input
                  type="number"
                  min={0}
                  value={editForm.advance}
                  onChange={(e) => setEditForm({ ...editForm, advance: e.target.value })}
                />
              </Field>

              <Field
                label="نسبة العمولة (%)"
                hint="عمولة مبيعات الموظف: نسبة مئوية يحصل عليها الموظف تلقائياً من إجمالي قيمة فواتير المبيعات التي يقوم بإصدارها خلال الشهر وتضاف تلقائياً لصافي مستحقاته."
              >
                <Input
                  type="number"
                  min={0}
                  max={100}
                  step="0.5"
                  value={editForm.salesCommissionPct}
                  onChange={(e) => setEditForm({ ...editForm, salesCommissionPct: e.target.value })}
                />
              </Field>

              <Field label="المستهدف الشهري (ج.م)">
                <Input
                  type="number"
                  min={0}
                  value={editForm.monthlySalesTarget}
                  onChange={(e) => setEditForm({ ...editForm, monthlySalesTarget: e.target.value })}
                />
              </Field>
            </div>

            {/* Permissions Editor */}
            <div className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line pb-2">
                <h3 className="font-bold text-ink flex items-center gap-2">
                  <Shield className="w-5 h-5 text-brand-600" /> مخصص الصلاحيات التفصيلية
                </h3>
                <label className="inline-flex items-center gap-2 rounded-lg border border-brand-200 bg-surface px-3 py-1.5 text-xs font-semibold text-brand-700 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={allPermissionsSelected}
                    onChange={(e) =>
                      setEditForm((prev) => ({
                        ...prev,
                        permissions: createPermissions(e.target.checked),
                      }))
                    }
                  />
                  اختيار كل الصلاحيات
                </label>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {PERMISSION_GROUPS.map((group) => {
                  const groupSelected = areAllPermissionsEnabled(editForm.permissions, group.key);
                  const groupPermissions = editForm.permissions[group.key] as Record<string, boolean>;

                  return (
                    <div key={group.key} className="space-y-3 bg-surface p-3.5 rounded-xl border border-line shadow-sm">
                      <div className="flex items-start justify-between gap-3 border-b border-line-soft pb-2">
                        <div>
                          <div className="font-bold text-sm text-ink">{group.label}</div>
                          <div className="text-[11px] text-ink-faint mt-0.5">{group.description}</div>
                        </div>
                        <label className="inline-flex items-center gap-1.5 text-xs text-ink-muted whitespace-nowrap cursor-pointer">
                          <input
                            type="checkbox"
                            checked={groupSelected}
                            onChange={(e) =>
                              setEditForm((prev) => ({
                                ...prev,
                                permissions: setPermissionGroup(prev.permissions, group.key, e.target.checked),
                              }))
                            }
                          />
                          كل القسم
                        </label>
                      </div>

                      <div className="grid grid-cols-2 gap-2 text-xs">
                        {group.actions.map((action) => (
                          <label key={action.key} className="flex items-center gap-2 text-ink hover:text-brand-600 cursor-pointer select-none">
                            <input
                              type="checkbox"
                              checked={Boolean(groupPermissions[action.key])}
                              onChange={(e) =>
                                setEditForm((prev) => ({
                                  ...prev,
                                  permissions: setPermission(prev.permissions, group.key, action.key, e.target.checked),
                                }))
                              }
                              className="rounded border-line text-brand-600 focus:ring-brand-500"
                            />
                            <span>{action.label}</span>
                          </label>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </Dialog>
      )}

      {/* Quick Financial Action Dialog (Bonus / Penalty / Advance) */}
      <Dialog
        open={finModalOpen}
        onClose={() => setFinModalOpen(false)}
        title={
          finActionType === "bonus"
            ? `إضافة مكافأة / بونص للموظف (${employee.name || employee.username})`
            : finActionType === "penalty"
            ? `تسجيل خصم / جَزاء على الموظف (${employee.name || employee.username})`
            : `تسجيل / صرف سُلفة للموظف (${employee.name || employee.username})`
        }
        footer={
          <div className="flex items-center justify-end gap-2">
            <Button variant="outline" onClick={() => setFinModalOpen(false)}>
              إلغاء
            </Button>
            <Button onClick={handleSaveFinancialAction} variant="primary">
              <Save className="w-4 h-4 ml-1.5" /> حفظ الإجراء
            </Button>
          </div>
        }
      >
        <div className="space-y-4" dir="rtl">
          <Field
            label={
              finActionType === "bonus"
                ? `قيمة المكافأة / البونص لشهر ${selectedMonth} (ج.م)`
                : finActionType === "penalty"
                ? `قيمة الخصم / الجزاء لشهر ${selectedMonth} (ج.م)`
                : `قيمة السُلفة لشهر ${selectedMonth} (ج.م)`
            }
            required
          >
            <Input
              type="number"
              min={0.01}
              step="0.01"
              value={finAmount || ""}
              onChange={(e) => setFinAmount(Number(e.target.value))}
              autoFocus
            />
          </Field>

          <Field label="السبب / البيان التفصيلي">
            <Textarea
              rows={2}
              value={finNotes}
              onChange={(e) => setFinNotes(e.target.value)}
              placeholder="اكتب سبب المكافأة أو الجزاء أو ملاحظة على السلفة..."
            />
          </Field>
        </div>
      </Dialog>
    </div>
  );
}
