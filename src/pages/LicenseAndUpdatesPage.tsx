import { useCallback, useEffect, useState } from "react";
import { PageHeader } from "../components/layout/AppLayout";
import { Card, CardBody, CardHeader } from "../components/ui/Card";
import { Button } from "../components/ui/Button";
import { Dialog } from "../components/ui/Dialog";
import { Field, Input, Textarea } from "../components/ui/Input";
import { useApp } from "../store/AppContext";
import { useToast } from "../components/ui/Toast";
import { cn } from "../lib/utils";
import { UpdateSettingsCard } from "../components/updates/UpdateSettingsCard";
import {
  ShieldCheck,
  Clock,
  Copy,
  KeyRound,
  MessageCircle,
  Gift,
} from "lucide-react";

type ReferralHistoryEntry = {
  id: number;
  referredShopName: string;
  status: "invited" | "pending" | "approved" | "paid" | "cancelled";
  commissionAmountMinor: number;
  currency: string;
  createdAt: string | null;
  convertedAt: string | null;
  approvedAt: string | null;
  paidAt: string | null;
  paymentReference: string | null;
};

const REFERRAL_STATUS_LABELS: Record<ReferralHistoryEntry["status"], string> = {
  invited: "تمت الدعوة",
  pending: "قيد المراجعة",
  approved: "مستحقة للدفع",
  paid: "تم الدفع",
  cancelled: "ملغاة",
};

const REFERRAL_STATUS_CLASSES: Record<ReferralHistoryEntry["status"], string> = {
  invited: "border-slate-200 bg-slate-50 text-slate-600 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-300",
  pending: "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300",
  approved: "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-300",
  paid: "border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-500/30 dark:bg-blue-500/10 dark:text-blue-300",
  cancelled: "border-red-200 bg-red-50 text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300",
};

function formatReferralMoney(minor: number, currency: string): string {
  return new Intl.NumberFormat("ar-EG", { style: "currency", currency }).format(minor / 100);
}

function formatReferralDate(value: string | null): string {
  if (!value) return "—";
  const normalized = value.includes("T") ? value : value.replace(" ", "T") + "Z";
  const date = new Date(normalized);
  return Number.isNaN(date.getTime())
    ? "—"
    : date.toLocaleDateString("ar-EG", { year: "numeric", month: "short", day: "numeric" });
}

function getRemainingDays(startDate: string | null, months: number): number {
  if (!startDate) return 0;
  const start = new Date(startDate);
  const end = new Date(start);
  end.setMonth(end.getMonth() + months);
  const now = new Date();
  const diff = end.getTime() - now.getTime();
  return Math.ceil(diff / (1000 * 60 * 60 * 24));
}

function monthsBetween(startDate: string | null, endDate: string | null): number {
  if (!startDate || !endDate) return 0;
  const start = new Date(startDate), end = new Date(endDate);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return 0;
  const months = (end.getUTCFullYear() - start.getUTCFullYear()) * 12 + end.getUTCMonth() - start.getUTCMonth();
  return Math.max(0, months);
}

function subscriptionDurationLabel(type: string, months: number): string {
  if (type === "lifetime") return "مدى الحياة";
  const m = Number(months) || 0;
  if (m <= 0) return "غير محددة";
  if (m % 12 === 0) {
    const y = m / 12;
    return y === 1 ? "سنة كاملة" : y === 2 ? "سنتان" : `${y} سنوات`;
  }
  return `${m} شهر`;
}

const PLAN_LABELS: Record<string, string> = {
  basic: "الباقة الأساسية",
  pro: "الباقة الاحترافية",
  full: "الباقة الشاملة",
  custom: "باقة مخصّصة",
};

function planDisplayLabel(license?: { plan?: string; features?: string[] } | null): string {
  if (!license) return "—";
  if (license.plan && PLAN_LABELS[license.plan]) return PLAN_LABELS[license.plan];
  const f = license.features;
  if (Array.isArray(f) && f.length > 0) return `${f.length} ميزة مفعّلة`;
  return "الباقة الشاملة";
}

interface LicenseCellProps {
  label: string;
  value?: string;
  valueClass?: string;
  children?: React.ReactNode;
}

function LicenseCell({ label, value, valueClass, children }: LicenseCellProps) {
  return (
    <div className="min-w-0 rounded-lg border border-line-soft bg-surface-muted/45 px-3 py-2">
      <div className="mb-1 text-[10px] font-bold tracking-wide text-ink-faint">{label}</div>
      {children ?? <div className={`text-sm font-bold leading-5 text-ink ${valueClass ?? ""}`}>{value}</div>}
    </div>
  );
}

export function LicenseAndUpdatesPage() {
  const { licenseStatus, activateLicense, currentUser } = useApp();
  const toast = useToast();

  const [licenseDialogOpen, setLicenseDialogOpen] = useState(false);
  const [newSerial, setNewSerial] = useState("");
  const [applyingSerial, setApplyingSerial] = useState(false);
  const [referralHistoryOpen, setReferralHistoryOpen] = useState(false);
  const [referralInfo, setReferralInfo] = useState<
    | { state: "idle" }
    | { state: "loading" }
    | {
        state: "ready";
        code: string;
        url: string;
        currency: string;
        summary: {
          totalReferrals: number;
          pendingMinor: number;
          approvedMinor: number;
          paidMinor: number;
          totalCommissionMinor: number;
        };
        history: ReferralHistoryEntry[];
      }
    | { state: "error"; error: string }
  >({ state: "idle" });


  // Dummy form values from license
  const form = {
    subscriptionType: licenseStatus?.license?.subscriptionType ?? "lifetime",
    subscriptionMonths: monthsBetween(licenseStatus?.license?.subscriptionStartDate ?? null, licenseStatus?.license?.subscriptionExpiresAt ?? null),
    subscriptionStartDate: licenseStatus?.license?.subscriptionStartDate ?? new Date().toISOString(),
    warrantyType: licenseStatus?.license?.warrantyExpiresAt ? "limited" : "none",
    warrantyMonths: monthsBetween(licenseStatus?.license?.warrantyStartDate ?? null, licenseStatus?.license?.warrantyExpiresAt ?? null),
    warrantyStartDate: licenseStatus?.license?.warrantyStartDate ?? new Date().toISOString(),
  };

  const loadReferralInfo = useCallback(async () => {
    const api = window.desktopAPI?.license?.getReferral;
    if (!api) {
      setReferralInfo({ state: "error", error: "معاينة المتصفح لا تحتوي على ترخيص عميل؛ افتح برنامج Windows المرخّص لعرض حساب الدعوات الحقيقي" });
      return;
    }
    setReferralInfo({ state: "loading" });
    const result = await api();
    if (result.ok) {
      setReferralInfo({
        state: "ready",
        code: result.code,
        url: result.url,
        currency: result.currency,
        summary: result.summary,
        history: result.history,
      });
      return;
    }
    const messages: Record<string, string> = {
      not_authorized: "الميزة متاحة لمالك النظام فقط",
      license_inactive: "فعّل ترخيص النظام أولًا لعرض كود الدعوة",
      online_service_unavailable: "تعذر الاتصال بخدمة الدعوات — تحقق من الإنترنت وحاول مرة أخرى",
      referral_not_available: "كود الدعوة غير متاح حاليًا — تواصل مع الدعم",
      invalid_server_response: "وصل رد غير صحيح من خدمة الدعوات",
    };
    setReferralInfo({ state: "error", error: messages[result.error] || "تعذر تحميل كود الدعوة" });
  }, []);

  // Load referral info from backend (if available)
  useEffect(() => {
    if (licenseStatus?.state === "active" && currentUser?.role === "owner") {
      void loadReferralInfo();
    }
  }, [licenseStatus?.state, licenseStatus?.license?.licenseId, currentUser?.role, loadReferralInfo]);

  function copyMachineCode() {
    const code = licenseStatus?.machineCode;
    if (!code) {
      toast.error("لا يوجد كود جهاز", "تأكد من تفعيل النظام أولاً");
      return;
    }
    void navigator.clipboard.writeText(code);
    toast.success("تم نسخ كود الجهاز");
  }

  function copyReferralCode() {
    if (referralInfo.state !== "ready") return;
    void navigator.clipboard.writeText(referralInfo.code);
    toast.success("تم نسخ كود الدعوة");
  }

  function shareReferralOnWhatsapp() {
    if (referralInfo.state !== "ready") return;
    const message = [
      "أرشح لك نظام PartFlow لإدارة مخزون ومبيعات قطع الغيار.",
      "استخدم رابط دعوتي للتواصل وشراء النظام:",
      referralInfo.url,
      `كود الدعوة: ${referralInfo.code}`,
    ].join("\n");
    window.open(`https://wa.me/?text=${encodeURIComponent(message)}`, "_blank", "noopener,noreferrer");
  }

  function openLicenseRequestWhatsapp() {
    const code = licenseStatus?.machineCode ?? "غير متاح";
    const plan = planDisplayLabel(licenseStatus?.license);
    const sub = subscriptionDurationLabel(form.subscriptionType, form.subscriptionMonths);
    const subLeft = form.subscriptionType === "limited" && form.subscriptionStartDate
      ? getRemainingDays(form.subscriptionStartDate, form.subscriptionMonths) + " يوم"
      : "—";
    const war = form.warrantyType === "none" ? "غير مفعل" : "تحت الضمان";

    const message = [
      "السلام عليكم، أريد تجديد أو ترقية ترخيص AutoParts Inventory System",
      "الباقة الحالية: " + plan,
      "مدة الاشتراك: " + sub,
      "المتبقي في الاشتراك: " + subLeft,
      "حالة الضمان: " + war,
      "كود الجهاز: " + code,
    ].join("\n");

    window.open(
      `https://wa.me/201118445625?text=${encodeURIComponent(message)}`,
      "_blank",
    );
  }

  async function applyNewSerial() {
    if (!newSerial.trim()) return;
    setApplyingSerial(true);
    const result = await activateLicense(newSerial.trim());
    setApplyingSerial(false);
    if (result.ok) {
      setNewSerial("");
      setLicenseDialogOpen(false);
      toast.success("تم تحديث الترخيص", "تم تطبيق السيريال الجديد — الاشتراك/الضمان/الباقة محدّثة");
    } else {
      toast.error("فشل التفعيل", result.status.message ?? "حدث خطأ غير معروف");
    }
  }

  return (
    <>
      <PageHeader
        title="الترخيص والتحديثات"
        description="إدارة بيانات الاشتراك والضمان ومتابعة تحديثات النظام التلقائية"
      />

      <div className="space-y-4">
        {/* Header with Action */}
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-xl font-bold text-ink">بيانات الاشتراك والضمان</h2>
            <p className="text-sm text-ink-muted">حالة الترخيص والضمان والتحديثات للنسخة الحالية</p>
          </div>
          <Button size="sm" onClick={() => setLicenseDialogOpen(true)}>
            <KeyRound className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">إدارة الاشتراك والضمان</span>
            <span className="sm:hidden">إدارة الترخيص</span>
          </Button>
        </div>

        {/* License Cards Grid */}
        <div className="grid gap-4 lg:grid-cols-2">
          {/* Subscription Card */}
          <Card>
            <CardHeader title={<span className="inline-flex items-center gap-2"><ShieldCheck className="h-4 w-4" />حالة الاشتراك</span>} />
            <CardBody className="space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-sm font-bold text-brand-700 dark:text-brand-300">
                  <ShieldCheck className="h-4 w-4" />
                  <span>الاشتراك</span>
                </div>
                <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-100 bg-emerald-50 px-2.5 py-1 text-[11px] font-bold text-emerald-700 dark:border-emerald-500/20 dark:bg-emerald-500/10 dark:text-emerald-400">
                  <span className="h-2 w-2 rounded-full bg-emerald-500" />
                  نشط ومفعل
                </span>
              </div>

              <div className={cn("grid grid-cols-2 gap-2", form.subscriptionType === "limited" && "sm:grid-cols-2 xl:grid-cols-4")}>
                <LicenseCell label="مدة الاشتراك" value={subscriptionDurationLabel(form.subscriptionType, form.subscriptionMonths)} />
                <LicenseCell label="الباقة الحالية" value={planDisplayLabel(licenseStatus?.license)} valueClass="text-brand-700 dark:text-brand-400" />
                <LicenseCell label="تاريخ التفعيل" value={form.subscriptionStartDate ? new Date(form.subscriptionStartDate).toLocaleDateString("ar-EG") : "غير محدد"} />
                {form.subscriptionType === "limited" && (
                  <LicenseCell label="الأيام المتبقية">
                    <span className="inline-flex items-center gap-1.5 text-sm font-mono font-bold text-brand-600 dark:text-brand-400">
                      <Clock className="w-3 h-3" />
                      {Math.max(0, getRemainingDays(form.subscriptionStartDate, form.subscriptionMonths))} يوم
                    </span>
                  </LicenseCell>
                )}
              </div>
            </CardBody>
          </Card>

          {/* Warranty Card */}
          <Card>
            <CardHeader title={<span className="inline-flex items-center gap-2"><Clock className="h-4 w-4" />حالة الضمان والتحديثات</span>} />
            <CardBody className="space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-sm font-bold text-indigo-700 dark:text-indigo-300">
                  <Clock className="h-4 w-4" />
                  <span>الضمان</span>
                </div>
                <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-bold ${form.warrantyType === "none"
                  ? "text-ink-faint bg-surface-muted border-line-soft"
                  : "text-indigo-700 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-500/10 border-indigo-100 dark:border-indigo-500/20"}`}>
                  <span className={`h-2 w-2 rounded-full ${form.warrantyType === "none" ? "bg-slate-400" : "bg-indigo-500"}`} />
                  {form.warrantyType === "none" ? "غير مفعل" : "تحت الضمان الساري"}
                </span>
              </div>

              <div className={cn("grid grid-cols-2 gap-2", form.warrantyType === "limited" && "sm:grid-cols-2 xl:grid-cols-4")}>
                <LicenseCell label="مدة الضمان" value={form.warrantyType === "none" ? "بدون ضمان" : `${form.warrantyMonths} شهر فقط`} />
                {form.warrantyType === "limited" && (
                  <LicenseCell label="تاريخ البدء" value={form.warrantyStartDate ? new Date(form.warrantyStartDate).toLocaleDateString("ar-EG") : "غير محدد"} />
                )}
                <LicenseCell label="نوع الدعم" value={form.warrantyType === "none" ? "—" : "ضمان وتحديثات"} />
                <LicenseCell label="الأيام المتبقية">
                  <span className={`inline-flex items-center gap-1.5 text-sm font-mono font-bold ${form.warrantyType === "limited" && form.warrantyStartDate
                    ? "text-indigo-600 dark:text-indigo-400"
                    : "text-ink-faint"}`}>
                    <Clock className="w-3 h-3" />
                    {form.warrantyType === "limited" && form.warrantyStartDate ? Math.max(0, getRemainingDays(form.warrantyStartDate, form.warrantyMonths)) : 0} يوم
                  </span>
                </LicenseCell>
              </div>
            </CardBody>
          </Card>
        </div>

        {/* Machine Code Strip */}
        <Card>
          <CardBody>
            <div className="flex flex-col gap-2 lg:flex-row lg:items-center">
              <button
                type="button"
                onClick={copyMachineCode}
                title="نسخ كود الجهاز"
                className="flex min-w-0 items-center gap-2 rounded-lg border border-line bg-surface-muted/40 px-3 py-2 text-ink-muted transition-colors hover:border-brand-300 hover:text-brand-600 lg:w-96"
              >
                <span className="inline-flex shrink-0 items-center gap-1.5 text-[11px] font-bold">
                  <Copy className="h-3.5 w-3.5" /> كود الجهاز
                </span>
                <span dir="ltr" className="min-w-0 flex-1 truncate text-left font-mono text-[11px]">
                  {licenseStatus?.machineCode ?? "—"}
                </span>
              </button>
              <p className="flex-1 text-[11px] leading-5 text-ink-muted">
                بيانات رسمية موثقة من <strong>Dar Tech</strong> ولا يمكن تعديلها من داخل النظام.
              </p>
            </div>
          </CardBody>
        </Card>

        {/* Referral Card - Owner Only */}
        {currentUser?.role === "owner" && (
          <Card>
            <CardBody>
              <div className="space-y-4">
                {/* Header */}
                <div className="flex items-start gap-3">
                  <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300">
                    <Gift className="h-5 w-5" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="font-bold text-amber-950 dark:text-amber-100">ادعُ صديقًا واحصل على عمولة 5%</div>
                    <p className="mt-1 text-xs leading-6 text-amber-900/80 dark:text-amber-200/80">
                      شارك رابطك مع صاحب محل جديد. بعد تثبيت النظام واعتماد الدفعة تُسجّل عمولتك (5% من قيمة فاتورته الأولى) ويصلك إشعار باستحقاقها لحسابك.
                    </p>
                  </div>
                </div>

                {referralInfo.state === "ready" ? (
                  <>
                    {/* Referral Code */}
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                      <button
                        type="button"
                        onClick={copyReferralCode}
                        className="flex min-w-0 items-center gap-2 rounded-lg border border-amber-200 bg-amber-50/60 px-3 py-2 text-amber-900 transition-colors hover:border-amber-300 hover:bg-amber-100 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-100 dark:hover:border-amber-400 dark:hover:bg-amber-500/15 sm:w-48"
                        title="نسخ كود الدعوة"
                      >
                        <Copy className="h-4 w-4 shrink-0" />
                        <span dir="ltr" className="min-w-0 flex-1 truncate text-left font-mono text-sm font-bold">
                          {referralInfo.code}
                        </span>
                      </button>

                      <Button
                        type="button"
                        size="sm"
                        className="gap-2 bg-emerald-600 hover:bg-emerald-700"
                        onClick={shareReferralOnWhatsapp}
                      >
                        <MessageCircle className="h-4 w-4" />
                        مشاركة على واتساب
                      </Button>

                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => setReferralHistoryOpen(true)}
                      >
                        سجل العمولات
                      </Button>
                    </div>

                    {/* Summary */}
                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                      <LicenseCell label="إجمالي الدعوات" value={String(referralInfo.summary.totalReferrals)} />
                      <LicenseCell label="قيد المراجعة" value={formatReferralMoney(referralInfo.summary.pendingMinor, referralInfo.currency)} valueClass="text-amber-600" />
                      <LicenseCell label="مستحق للدفع" value={formatReferralMoney(referralInfo.summary.approvedMinor, referralInfo.currency)} valueClass="text-emerald-600" />
                      <LicenseCell label="تم دفعه لك" value={formatReferralMoney(referralInfo.summary.paidMinor, referralInfo.currency)} valueClass="text-blue-600" />
                    </div>
                  </>
                ) : (
                  <div className="rounded-lg border border-dashed border-line bg-surface-muted/30 p-4 text-center text-xs text-ink-faint">
                    {referralInfo.state === "loading" ? "جارٍ تحميل بيانات الدعوات..." : "بيانات الدعوات غير متاحة حاليًا"}
                  </div>
                )}
              </div>
            </CardBody>
          </Card>
        )}

        {/* Updates Section */}
        <UpdateSettingsCard />
      </div>

      {/* License Management Dialog */}
      <Dialog
        open={licenseDialogOpen}
        onClose={() => setLicenseDialogOpen(false)}
        title="تجديد أو ترقية أو تمديد الترخيص"
        subtitle="جدّد اشتراكك أو فعّل ضمانك أو ارقِ باقتك بدون إعادة تثبيت أو فقدان بياناتك"
        width="lg"
      >
        <div className="space-y-5">
          <div className="rounded-xl border border-line bg-surface-muted dark:bg-surface-muted/60 p-4 space-y-3">
            <div className="flex items-center gap-2 text-xs font-bold text-ink-muted">
              <span className="grid place-items-center w-5 h-5 rounded-full bg-emerald-100 dark:bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 text-[10px]">1</span>
              أرسل كود جهازك للمطوّر
            </div>
            <Field label="كود الجهاز">
              <div className="flex gap-2">
                <Input value={licenseStatus?.machineCode ?? "—"} readOnly dir="ltr" className="font-mono text-left" />
                <Button type="button" variant="outline" onClick={copyMachineCode}>
                  <Copy className="w-4 h-4" />
                </Button>
              </div>
            </Field>
            <Button
              type="button"
              className="w-full gap-2 bg-emerald-600 hover:bg-emerald-700"
              onClick={openLicenseRequestWhatsapp}
            >
              <MessageCircle className="w-4 h-4" /> إرسال الطلب عبر واتساب (كود الجهاز مرفق تلقائياً)
            </Button>
            <p className="text-[11px] text-ink-faint leading-relaxed">
              ستصلك رسالة بالكود والحالة جاهزة — يكفي إرسالها. سيرسل لك المطوّر سيريالاً جديداً
              يجدّد الاشتراك أو يفعّل الضمان أو يفتح مميزات الباقة الأعلى.
            </p>
          </div>

          <div className="rounded-xl border border-brand-200 dark:border-brand-500/30 bg-brand-50/60 dark:bg-brand-500/10 p-4 space-y-3">
            <div className="flex items-center gap-2 text-xs font-bold text-brand-700 dark:text-brand-300">
              <span className="grid place-items-center w-5 h-5 rounded-full bg-brand-600 text-white text-[10px]">2</span>
              الصق السيريال الجديد وفعّله
            </div>
            <Field label="السيريال الجديد">
              <Textarea
                rows={3}
                value={newSerial}
                onChange={(e) => setNewSerial(e.target.value)}
                placeholder="APLIC..."
                dir="ltr"
                className="font-mono text-left"
              />
            </Field>
            <Button
              type="button"
              size="lg"
              className="w-full gap-2"
              onClick={applyNewSerial}
              disabled={applyingSerial || !newSerial.trim()}
            >
              <KeyRound className="w-4 h-4" />
              {applyingSerial ? "جارٍ التطبيق..." : "تطبيق السيريال وتحديث الترخيص"}
            </Button>
            <p className="text-[11px] text-ink-faint leading-relaxed">
              يتم التطبيق فوراً على هذا الجهاز دون أي تأثير على بياناتك. يمكنك التجديد في أي وقت —
              حتى قبل انتهاء الاشتراك — فلن يتوقف العمل.
            </p>
          </div>
        </div>
      </Dialog>

      {/* Referral History Dialog */}
      <Dialog
        open={referralHistoryOpen}
        onClose={() => setReferralHistoryOpen(false)}
        title="سجل دعواتي وعمولاتي"
        subtitle="قيمة كل عمولة وحالتها وتاريخ اعتمادها أو دفعها"
        width="lg"
      >
        {referralInfo.state === "ready" ? (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <LicenseCell label="إجمالي الدعوات" value={String(referralInfo.summary.totalReferrals)} />
              <LicenseCell label="قيد المراجعة" value={formatReferralMoney(referralInfo.summary.pendingMinor, referralInfo.currency)} valueClass="text-amber-600" />
              <LicenseCell label="مستحق للدفع" value={formatReferralMoney(referralInfo.summary.approvedMinor, referralInfo.currency)} valueClass="text-emerald-600" />
              <LicenseCell label="تم دفعه" value={formatReferralMoney(referralInfo.summary.paidMinor, referralInfo.currency)} valueClass="text-blue-600" />
            </div>

            {referralInfo.history.length ? (
              <div className="max-h-[58vh] space-y-2 overflow-y-auto pe-1">
                {referralInfo.history.map((entry) => {
                  const eventDate = entry.paidAt || entry.approvedAt || entry.convertedAt || entry.createdAt;
                  return (
                    <div key={entry.id} className="flex flex-col gap-3 rounded-xl border border-line bg-surface-muted/45 p-3 sm:flex-row sm:items-center">
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-bold text-ink">{entry.referredShopName}</div>
                        <div className="mt-1 text-[11px] text-ink-faint">{formatReferralDate(eventDate)}</div>
                        {entry.status === "paid" && entry.paymentReference ? (
                          <div dir="ltr" className="mt-1 truncate text-left font-mono text-[10px] text-ink-faint">مرجع الدفع: {entry.paymentReference}</div>
                        ) : null}
                      </div>
                      <span className={`inline-flex w-fit rounded-full border px-2.5 py-1 text-[11px] font-bold ${REFERRAL_STATUS_CLASSES[entry.status]}`}>
                        {REFERRAL_STATUS_LABELS[entry.status]}
                      </span>
                      <div dir="ltr" className="font-mono text-sm font-black text-ink">
                        {entry.commissionAmountMinor > 0 ? formatReferralMoney(entry.commissionAmountMinor, entry.currency) : "—"}
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="rounded-xl border border-dashed border-line p-8 text-center text-sm text-ink-faint">
                لسه مفيش دعوات مسجلة على كودك. شارك الرابط علشان تبدأ.
              </div>
            )}
          </div>
        ) : (
          <div className="p-8 text-center text-sm text-ink-faint">بيانات الدعوات غير متاحة حاليًا.</div>
        )}
      </Dialog>
    </>
  );
}
