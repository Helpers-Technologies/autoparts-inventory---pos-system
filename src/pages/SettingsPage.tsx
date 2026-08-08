import { useEffect, useRef, useState } from "react";
import { cn, isValidEgyptianMobile, normalizePhoneInput } from "../lib/utils";
import { PageHeader } from "../components/layout/AppLayout";
import { Card, CardBody, CardHeader } from "../components/ui/Card";
import { Button } from "../components/ui/Button";
import { Field, Input, Select, Textarea } from "../components/ui/Input";
import { ConfirmDialog, Dialog } from "../components/ui/Dialog";
import { useApp } from "../store/AppContext";
import { useAuditLog } from "../store/AuditLogContext";
import { useToast } from "../components/ui/Toast";
import { lsGet } from "../lib/storage";
import { FEATURES, FEATURE_CATEGORIES, FEATURE_CATEGORY_BY_KEY, defaultFeatureState, isAllowedByLicense, type FeatureDef, type FeatureKey } from "../lib/features";
import { Save, Eye, Download, Upload, Database, FileSpreadsheet, ShieldCheck, Clock, Image as ImageIcon, Trash2, FolderOpen, Boxes, Lock, Copy, KeyRound, MessageCircle, PackagePlus, ChevronDown, ChevronUp, Gift, RefreshCw, Smartphone, ShieldAlert, CheckCircle2, LogOut, Link2Off, Laptop, Globe, TabletSmartphone, CloudUpload, CloudDownload } from "lucide-react";
import type { LinkedMobileDevice } from "../types/desktop";
import { PaidFeatureNotice } from "../components/PaidFeatureNotice";
import {
  DEFAULT_INVOICE_WHATSAPP_TEMPLATE,
  WHATSAPP_INVOICE_TAGS,
} from "../lib/whatsappTemplate";
import { MfaPolicyCard } from "../components/security/MfaPolicyCard";
import { TwoFactorSecurityPanel } from "../components/security/TwoFactorSecurityPanel";
import { UpdateSettingsCard } from "../components/updates/UpdateSettingsCard";

const SUPPORT_WHATSAPP = "201118445625";
const FEATURE_PREVIEW_LIMIT = 8;

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

const PLAN_LABELS: Record<string, string> = {
  basic: "الباقة الأساسية",
  pro: "الباقة الاحترافية",
  full: "الباقة الشاملة",
  custom: "باقة مخصّصة",
};

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

function LicenseCell({
  label,
  value,
  valueClass,
  children,
}: {
  label: string;
  value?: string;
  valueClass?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="min-w-0 rounded-lg border border-line-soft bg-surface-muted/45 px-3 py-2">
      <div className="mb-1 text-[10px] font-bold tracking-wide text-ink-faint">{label}</div>
      {children ?? <div className={`text-sm font-bold leading-5 text-ink ${valueClass ?? ""}`}>{value}</div>}
    </div>
  );
}

function planDisplayLabel(license?: { plan?: string; features?: string[] } | null): string {
  if (!license) return "—";
  if (license.plan && PLAN_LABELS[license.plan]) return PLAN_LABELS[license.plan];
  const f = license.features;
  if (Array.isArray(f) && f.length > 0) return `${f.length} ميزة مفعّلة`;
  return "الباقة الشاملة";
}

const DEVICE_PLATFORM_ICONS = {
  android: Smartphone,
  ios: Smartphone,
  web: Globe,
  windows: Laptop,
  macos: Laptop,
  linux: Laptop,
} as const;

const DEVICE_PLATFORM_LABELS: Record<string, string> = {
  android: "أندرويد",
  ios: "آيفون / آيباد",
  web: "متصفح",
  windows: "ويندوز",
  macos: "ماك",
  linux: "لينكس",
};

/** Absolute date plus a coarse "how long ago", which is what an owner scanning
 *  the list actually wants to know about a device they don't recognise. */
function formatDeviceMoment(value: string | null): string {
  if (!value) return "—";
  const time = Date.parse(value);
  if (!Number.isFinite(time)) return "—";
  const date = new Date(time).toLocaleString("ar-EG", {
    year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
  });
  const minutes = Math.floor((Date.now() - time) / 60000);
  if (minutes < 2) return `${date} (الآن)`;
  if (minutes < 60) return `${date} (منذ ${minutes} دقيقة)`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${date} (منذ ${hours} ساعة)`;
  return `${date} (منذ ${Math.floor(hours / 24)} يوم)`;
}

function MobileDeviceRow({
  device, busy, onSignOut, onUnlink,
}: {
  device: LinkedMobileDevice;
  busy: boolean;
  onSignOut: () => void;
  onUnlink: () => void;
}) {
  const Icon = (device.platform && DEVICE_PLATFORM_ICONS[device.platform]) || TabletSmartphone;
  const online = device.activeSessions > 0 && !device.revoked;
  return (
    <li className={cn(
      "rounded-xl border p-3",
      device.revoked ? "border-line bg-surface-muted/50 opacity-70" : "border-line bg-surface",
    )}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <span className="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-brand-50 text-brand-700 dark:bg-brand-500/15 dark:text-brand-300">
            <Icon className="h-4 w-4" />
          </span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="truncate text-sm font-bold text-ink">{device.deviceName}</span>
              {device.revoked ? (
                <span className="rounded-full bg-rose-100 px-2 py-0.5 text-[11px] font-bold text-rose-700 dark:bg-rose-500/20 dark:text-rose-300">
                  ملغي
                </span>
              ) : online ? (
                <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-bold text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300">
                  جلسة نشطة
                </span>
              ) : (
                <span className="rounded-full bg-surface-muted px-2 py-0.5 text-[11px] font-bold text-ink-muted">
                  مسجل خروج
                </span>
              )}
            </div>
            <div className="mt-1 space-y-0.5 text-xs leading-5 text-ink-muted">
              <div>
                {device.userDisplayName} · {device.userRole === "owner" ? "مالك" : "مشرف"}
                {device.platform ? ` · ${DEVICE_PLATFORM_LABELS[device.platform] ?? device.platform}` : ""}
                {device.appVersion ? ` · إصدار ${device.appVersion}` : ""}
              </div>
              <div>تاريخ الربط: {formatDeviceMoment(device.createdAt)}</div>
              <div>آخر نشاط: {formatDeviceMoment(device.lastSeenAt)}</div>
            </div>
          </div>
        </div>
        {!device.revoked && (
          <div className="flex shrink-0 flex-wrap gap-2">
            <Button type="button" variant="ghost" disabled={busy || !online} onClick={onSignOut}>
              <LogOut className="h-4 w-4" /> تسجيل خروج
            </Button>
            <Button type="button" variant="ghost" disabled={busy} onClick={onUnlink}>
              <Link2Off className="h-4 w-4" /> إلغاء الربط
            </Button>
          </div>
        )}
      </div>
    </li>
  );
}

function MobileRequirement({ ok, title, description }: { ok: boolean; title: string; description: string }) {
  return (
    <div className={cn(
      "flex items-start gap-3 rounded-xl border p-3",
      ok
        ? "border-emerald-200 bg-emerald-50/55 dark:border-emerald-500/25 dark:bg-emerald-500/10"
        : "border-rose-200 bg-rose-50/55 dark:border-rose-500/25 dark:bg-rose-500/10",
    )}>
      <span className={cn(
        "mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-lg",
        ok ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300" : "bg-rose-100 text-rose-700 dark:bg-rose-500/20 dark:text-rose-300",
      )}>
        {ok ? <CheckCircle2 className="h-4 w-4" /> : <ShieldAlert className="h-4 w-4" />}
      </span>
      <span className="min-w-0">
        <span className="block text-sm font-bold text-ink">{title}</span>
        <span className="mt-0.5 block text-xs leading-5 text-ink-muted">{description}</span>
      </span>
    </div>
  );
}

export function SettingsPage() {
  const { settings, updateSettings, exportBackup, importBackup, backupToPath, exportToExcel, licenseStatus, activateLicense, currentUser } = useApp();
  const toast = useToast();
  const { auditLogs, clearAuditLogs } = useAuditLog();
  const [form, setForm] = useState(settings);
  const [clearLogsDialogOpen, setClearLogsDialogOpen] = useState(false);
  const [clearLogsDays, setClearLogsDays] = useState<number>(0);
  const [licenseDialogOpen, setLicenseDialogOpen] = useState(false);
  const [newSerial, setNewSerial] = useState("");
  const [applyingSerial, setApplyingSerial] = useState(false);
  // Transient secret for password-protected MANUAL export/restore. Never
  // persisted — lives only for the current Settings view.
  const [backupPassphrase, setBackupPassphrase] = useState("");
  const [pendingRestore, setPendingRestore] = useState<{ file: File; pass?: string; isProtected: boolean } | null>(null);
  const [pendingInternalRestore, setPendingInternalRestore] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewTab, setPreviewTab] = useState<"invoice" | "whatsapp">("invoice");
  const [whatsappTemplateExpanded, setWhatsappTemplateExpanded] = useState(false);
  const [mfaRefreshKey, setMfaRefreshKey] = useState(0);
  const [mobileLinkStatus, setMobileLinkStatus] = useState<
    | { state: "loading" }
    | { state: "unavailable" }
    | {
        state: "ready";
        allowedRole: boolean;
        featureLicensed: boolean;
        twoFactorLicensed: boolean;
        mfaEnabled: boolean;
      }
  >({ state: "loading" });
  const [mobileLinkDialogOpen, setMobileLinkDialogOpen] = useState(false);
  const [mobilePassword, setMobilePassword] = useState("");
  const [mobileTotpCode, setMobileTotpCode] = useState("");
  const [mobileDeviceLabel, setMobileDeviceLabel] = useState("هاتف الإدارة");
  const [mobilePairingLoading, setMobilePairingLoading] = useState(false);
  const [mobilePairingError, setMobilePairingError] = useState("");
  const [mobilePairingResult, setMobilePairingResult] = useState<{ activationCode: string; expiresAt: string } | null>(null);
  const [mobileDevices, setMobileDevices] = useState<
    | { state: "idle" }
    | { state: "loading" }
    | { state: "ready"; devices: LinkedMobileDevice[] }
    | { state: "error"; error: string }
  >({ state: "idle" });
  const [cloudArchive, setCloudArchive] = useState<
    | { state: "unavailable" }
    | { state: "loading" }
    | {
        state: "ready";
        featureLicensed: boolean;
        configured: boolean;
        lastArchivedAt: string | null;
        lastError: { message: string; at: string } | null;
        serviceAvailable: boolean;
      }
  >({ state: "loading" });
  const [cloudArchiveRefreshKey, setCloudArchiveRefreshKey] = useState(0);
  const [cloudArchiveBusy, setCloudArchiveBusy] = useState(false);
  const [cloudPassphraseDialogOpen, setCloudPassphraseDialogOpen] = useState(false);
  const [cloudAccountPassword, setCloudAccountPassword] = useState("");
  const [cloudPassphrase, setCloudPassphrase] = useState("");
  const [cloudPassphraseConfirm, setCloudPassphraseConfirm] = useState("");
  const [cloudPassphraseError, setCloudPassphraseError] = useState("");
  const [cloudRestoreDialogOpen, setCloudRestoreDialogOpen] = useState(false);
  const [cloudRestorePassphrase, setCloudRestorePassphrase] = useState("");
  const [cloudRestoreError, setCloudRestoreError] = useState("");
  const [cloudRestorePreview, setCloudRestorePreview] = useState<
    { capturedAt: string | null; appVersion: string | null; keyCount: number } | null
  >(null);
  const [devicePendingRevoke, setDevicePendingRevoke] = useState<LinkedMobileDevice | null>(null);
  const [deviceRevokeBusy, setDeviceRevokeBusy] = useState(false);
  const [deviceRefreshKey, setDeviceRefreshKey] = useState(0);
  const [showAllFeatures, setShowAllFeatures] = useState(false);
  const [lockedFeature, setLockedFeature] = useState<FeatureDef | null>(null);
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
  const whatsappTemplateRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => setForm(settings), [settings]);

  useEffect(() => {
    let active = true;
    const api = window.desktopAPI?.license?.getMobileLinkStatus;
    if (!currentUser || !api) {
      setMobileLinkStatus({ state: "unavailable" });
      return () => { active = false; };
    }
    setMobileLinkStatus({ state: "loading" });
    void api().then((result) => {
      if (!active) return;
      if (!result.ok) {
        setMobileLinkStatus({ state: "unavailable" });
        return;
      }
      setMobileLinkStatus({
        state: "ready",
        allowedRole: result.allowedRole,
        featureLicensed: result.featureLicensed,
        twoFactorLicensed: result.twoFactorLicensed,
        mfaEnabled: result.mfaEnabled,
      });
    }).catch(() => {
      if (active) setMobileLinkStatus({ state: "unavailable" });
    });
    return () => { active = false; };
  }, [currentUser?.id, licenseStatus?.license?.licenseId, mfaRefreshKey]);

  useEffect(() => {
    let active = true;
    const api = window.desktopAPI?.license?.getCloudArchiveStatus;
    if (!api || currentUser?.role !== "owner") {
      setCloudArchive({ state: "unavailable" });
      return () => { active = false; };
    }
    setCloudArchive({ state: "loading" });
    void api().then((result) => {
      if (!active) return;
      setCloudArchive(result.ok ? { state: "ready", ...result } : { state: "unavailable" });
    }).catch(() => {
      if (active) setCloudArchive({ state: "unavailable" });
    });
    return () => { active = false; };
  }, [currentUser?.id, currentUser?.role, cloudArchiveRefreshKey]);

  const CLOUD_ARCHIVE_ERRORS: Record<string, string> = {
    not_authorized: "النسخ الاحتياطي السحابي متاح للمالك فقط",
    cloud_backup_not_licensed: "ميزة النسخة السحابية غير مفعلة على الترخيص الحالي",
    passphrase_too_short: "كلمة سر النسخة يجب ألا تقل عن 12 حرفًا",
    invalid_password: "كلمة مرور حسابك غير صحيحة",
    passphrase_not_set: "اضبط كلمة سر النسخة السحابية أولًا",
    passphrase_required: "اكتب كلمة سر النسخة السحابية",
    wrong_passphrase: "كلمة سر النسخة غير صحيحة",
    archive_not_found: "لا توجد نسخة سحابية محفوظة بعد",
    archive_too_large: "حجم بيانات المتجر تجاوز الحد المسموح للنسخة السحابية",
    license_inactive: "ترخيص البرنامج غير نشط",
    not_configured: "خدمة السحابة غير مهيأة في هذا الإصدار",
    online_service_unavailable: "تعذر الاتصال بالخدمة؛ تحقق من الإنترنت",
    timeout: "انتهت مهلة الاتصال بالخدمة",
  };

  async function saveCloudPassphrase() {
    if (cloudPassphrase.length < 12) {
      setCloudPassphraseError("كلمة سر النسخة يجب ألا تقل عن 12 حرفًا");
      return;
    }
    if (cloudPassphrase !== cloudPassphraseConfirm) {
      setCloudPassphraseError("تأكيد كلمة السر غير مطابق");
      return;
    }
    const api = window.desktopAPI?.license?.setCloudArchivePassphrase;
    if (!api) return;
    setCloudArchiveBusy(true);
    setCloudPassphraseError("");
    const result = await api(cloudAccountPassword, cloudPassphrase);
    setCloudArchiveBusy(false);
    if (result.ok) {
      setCloudPassphraseDialogOpen(false);
      setCloudAccountPassword("");
      setCloudPassphrase("");
      setCloudPassphraseConfirm("");
      setCloudArchiveRefreshKey((key) => key + 1);
      toast.success("تم تفعيل النسخة السحابية", "احتفظ بكلمة السر — من غيرها لا يمكن استرجاع النسخة");
      return;
    }
    setCloudPassphraseError(CLOUD_ARCHIVE_ERRORS[result.error || ""] || "تعذر حفظ الإعداد");
  }

  async function runCloudArchiveSync() {
    const api = window.desktopAPI?.license?.syncCloudArchiveNow;
    if (!api) return;
    setCloudArchiveBusy(true);
    const result = await api();
    setCloudArchiveBusy(false);
    setCloudArchiveRefreshKey((key) => key + 1);
    if (result.ok) {
      toast.success(
        result.skipped ? "النسخة السحابية محدَّثة بالفعل" : "تم رفع نسخة سحابية جديدة",
        result.skipped ? "لا توجد تغييرات منذ آخر رفع" : `${result.keyCount ?? 0} مجموعة بيانات`,
      );
      return;
    }
    toast.error("تعذر رفع النسخة", CLOUD_ARCHIVE_ERRORS[result.error || ""] || result.error || "");
  }

  async function previewCloudRestore() {
    const api = window.desktopAPI?.license?.previewCloudArchiveRestore;
    if (!api) return;
    setCloudArchiveBusy(true);
    setCloudRestoreError("");
    const result = await api(cloudRestorePassphrase);
    setCloudArchiveBusy(false);
    if (result.ok) {
      setCloudRestorePreview(result);
      return;
    }
    setCloudRestorePreview(null);
    setCloudRestoreError(CLOUD_ARCHIVE_ERRORS[result.error] || "تعذر قراءة النسخة السحابية");
  }

  async function confirmCloudRestore() {
    const api = window.desktopAPI?.license?.restoreCloudArchive;
    if (!api) return;
    setCloudArchiveBusy(true);
    const result = await api(cloudRestorePassphrase);
    setCloudArchiveBusy(false);
    if (!result.ok) {
      setCloudRestoreError(CLOUD_ARCHIVE_ERRORS[result.error] || "تعذر استعادة النسخة السحابية");
      return;
    }
    // The renderer's in-memory stores still hold the pre-restore data, so
    // anything short of a reload would show a mix of old and new records.
    toast.success("تمت الاستعادة", "سيتم إعادة تشغيل الواجهة الآن");
    setTimeout(() => window.location.reload(), 1200);
  }

  // Only fetched once the same gate that guards pairing has passed, so an
  // unlicensed or unauthorised install never even asks the portal.
  const mobileDevicesEligible =
    mobileLinkStatus.state === "ready" &&
    mobileLinkStatus.featureLicensed &&
    mobileLinkStatus.twoFactorLicensed &&
    mobileLinkStatus.allowedRole;

  useEffect(() => {
    let active = true;
    const api = window.desktopAPI?.license?.listMobileDevices;
    if (!mobileDevicesEligible || !api) {
      setMobileDevices({ state: "idle" });
      return () => { active = false; };
    }
    setMobileDevices({ state: "loading" });
    void api().then((result) => {
      if (!active) return;
      setMobileDevices(
        result.ok
          ? { state: "ready", devices: result.devices }
          : { state: "error", error: result.error },
      );
    }).catch(() => {
      if (active) setMobileDevices({ state: "error", error: "online_service_unavailable" });
    });
    return () => { active = false; };
  }, [mobileDevicesEligible, deviceRefreshKey]);

  async function revokeMobileDevice(device: LinkedMobileDevice, keepTrust: boolean) {
    const api = window.desktopAPI?.license?.revokeMobileDevice;
    if (!api) return;
    setDeviceRevokeBusy(true);
    const result = await api(device.id, keepTrust);
    setDeviceRevokeBusy(false);
    setDevicePendingRevoke(null);
    if (result.ok) {
      toast.success(
        keepTrust ? "تم تسجيل خروج الجهاز" : "تم إلغاء ربط الجهاز",
        keepTrust
          ? `${device.deviceName} هيحتاج تسجيل دخول بالحساب و2FA`
          : `${device.deviceName} هيحتاج كود ربط جديد`,
      );
      setDeviceRefreshKey((key) => key + 1);
      return;
    }
    const messages: Record<string, string> = {
      not_authorized: "الميزة متاحة للمالك أو المشرف المصرح له فقط",
      mobile_feature_not_licensed: "ميزة ربط الهاتف غير مفعلة في الترخيص الحالي",
      two_factor_not_licensed: "يجب تفعيل ميزة المصادقة الثنائية على الترخيص",
      license_inactive: "ترخيص البرنامج غير نشط",
      device_not_found: "الجهاز غير موجود أو تم إلغاؤه بالفعل",
      online_service_unavailable: "تعذر الاتصال بخدمة الربط؛ تحقق من الإنترنت",
    };
    toast.error("تعذر تنفيذ العملية", messages[result.error] || result.error);
  }

  function openMobilePairingDialog() {
    setMobilePassword("");
    setMobileTotpCode("");
    setMobilePairingError("");
    setMobilePairingResult(null);
    setMobileLinkDialogOpen(true);
  }

  async function createMobilePairing() {
    if (!mobilePassword || !/^\d{6}$/.test(mobileTotpCode)) {
      setMobilePairingError("اكتب كلمة مرور حسابك وكود Authenticator المكوّن من 6 أرقام");
      return;
    }
    const api = window.desktopAPI?.license?.createMobilePairing;
    if (!api) {
      setMobilePairingError("إنشاء كود الربط متاح من برنامج سطح المكتب فقط");
      return;
    }
    setMobilePairingLoading(true);
    setMobilePairingError("");
    const result = await api(mobilePassword, mobileTotpCode, mobileDeviceLabel.trim() || undefined);
    setMobilePairingLoading(false);
    if (result.ok) {
      setMobilePairingResult({ activationCode: result.activationCode, expiresAt: result.expiresAt });
      setMobilePassword("");
      setMobileTotpCode("");
      toast.success("تم إنشاء كود ربط آمن", "صالح لمرة واحدة ولمدة 10 دقائق");
      return;
    }
    const messages: Record<string, string> = {
      not_authorized: "الميزة متاحة للمالك أو المشرف المصرح له فقط",
      mobile_feature_not_licensed: "ميزة ربط الهاتف غير مفعلة في الترخيص الحالي",
      two_factor_not_licensed: "يجب تفعيل ميزة المصادقة الثنائية على الترخيص",
      mfa_not_enabled: "فعّل 2FA على حسابك أولًا ثم أعد المحاولة",
      invalid_password: "كلمة مرور الحساب غير صحيحة",
      invalid_code: "كود Authenticator غير صحيح أو انتهت صلاحيته",
      code_reused: "تم استخدام كود Authenticator هذا من قبل؛ انتظر الكود التالي",
      rate_limited: "محاولات كثيرة؛ انتظر قليلًا ثم أعد المحاولة",
      license_inactive: "ترخيص البرنامج غير نشط",
      secure_connection_required: "الخدمة تتطلب اتصال HTTPS آمن",
      online_service_unavailable: "تعذر الاتصال بخدمة الربط؛ تحقق من الإنترنت",
      portal_unreachable: "خدمة البورتال غير متاحة الآن؛ شغّلها أو تحقق من عنوان الخدمة ثم حاول مجددًا",
      invalid_server_response: "وصل رد غير صحيح من خدمة الربط",
    };
    setMobilePairingError(messages[result.error] || `تعذر إنشاء كود الربط حاليًا (${result.error || "unknown"})`);
  }

  async function copyMobilePairingCode() {
    if (!mobilePairingResult) return;
    await navigator.clipboard.writeText(mobilePairingResult.activationCode);
    toast.success("تم نسخ كود التفعيل");
  }

  async function loadReferralInfo() {
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
  }

  useEffect(() => {
    if (licenseStatus?.state === "active" && currentUser?.role === "owner") {
      void loadReferralInfo();
    }
    // Reload when a newly activated serial replaces the current license.
  }, [licenseStatus?.state, licenseStatus?.license?.licenseId, currentUser?.role]);

  async function copyMachineCode() {
    const code = licenseStatus?.machineCode;
    if (!code) return toast.error("كود الجهاز غير متاح");
    await navigator.clipboard.writeText(code);
    toast.success("تم نسخ كود الجهاز");
  }

  async function copyReferralLink() {
    if (referralInfo.state !== "ready") return;
    await navigator.clipboard.writeText(referralInfo.url);
    toast.success("تم نسخ رابط الدعوة");
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

  function buildLicenseRequest() {
    const code = licenseStatus?.machineCode ?? "غير متاح";
    const sub = subscriptionDurationLabel(form.subscriptionType, form.subscriptionMonths);
    const plan = planDisplayLabel(licenseStatus?.license);
    const subLeft =
      form.subscriptionType === "limited"
        ? Math.max(0, getRemainingDays(form.subscriptionStartDate, form.subscriptionMonths)) + " يوم"
        : "—";
    const war =
      form.warrantyType === "none"
        ? "بدون ضمان"
        : Math.max(0, getRemainingDays(form.warrantyStartDate, form.warrantyMonths)) + " يوم";
    return [
      "طلب تجديد / ترقية ترخيص — PartFlow — By Helpers Tech",
      "العميل: " + (form.companyNameAr || form.companyName || "—"),
      "كود الجهاز: " + code,
      "مدة الاشتراك: " + sub,
      "الباقة الحالية: " + plan,
      "المتبقي في الاشتراك: " + subLeft,
      "حالة الضمان: " + war,
      "",
      "المطلوب: (تجديد اشتراك / تمديد ضمان / ترقية باقة)",
    ].join("\n");
  }

  function openLicenseRequestWhatsapp() {
    const url = "https://wa.me/" + SUPPORT_WHATSAPP + "?text=" + encodeURIComponent(buildLicenseRequest());
    window.open(url, "_blank", "noopener,noreferrer");
  }

  function openFeatureUpgradeWhatsapp() {
    if (!lockedFeature) return;
    const message = [
      "طلب ترقية / إضافة مدفوعة — PartFlow — By Helpers Tech",
      "العميل: " + (form.companyNameAr || form.companyName || "—"),
      "الميزة المطلوبة: " + lockedFeature.label,
      "كود الجهاز: " + (licenseStatus?.machineCode ?? "غير متاح"),
      "",
      "المطلوب: (إضافة مستقلة / ترقية الباقة)",
    ].join("\n");
    window.open(
      "https://wa.me/" + SUPPORT_WHATSAPP + "?text=" + encodeURIComponent(message),
      "_blank",
      "noopener,noreferrer"
    );
  }

  function insertWhatsappTag(tag: string) {
    const current = form.whatsappInvoiceTemplate ?? DEFAULT_INVOICE_WHATSAPP_TEMPLATE;
    const el = whatsappTemplateRef.current;
    const start = el?.selectionStart ?? current.length;
    const end = el?.selectionEnd ?? current.length;
    const next = current.slice(0, start) + tag + current.slice(end);

    setForm({ ...form, whatsappInvoiceTemplate: next });
    requestAnimationFrame(() => {
      const target = whatsappTemplateRef.current;
      if (!target) return;
      const cursor = start + tag.length;
      target.focus();
      target.setSelectionRange(cursor, cursor);
    });
  }

  async function applyNewSerial() {
    const serial = newSerial.trim();
    if (!serial) return toast.error("الصق السيريال أولاً");
    setApplyingSerial(true);
    const result = await activateLicense(serial);
    setApplyingSerial(false);
    if (result.ok) {
      toast.success("تم تحديث الترخيص", "تم تطبيق السيريال الجديد — الاشتراك/الضمان/الباقة محدّثة");
      setNewSerial("");
      setLicenseDialogOpen(false);
      return;
    }
    const messages: Record<string, string> = {
      expired: "السيريال منتهي الصلاحية",
      machine_mismatch: "هذا السيريال مخصص لجهاز آخر",
      clock_tampered: "تم اكتشاف تغيير غير آمن في تاريخ الجهاز",
      inactive: "السيريال غير صالح",
    };
    toast.error("فشل تطبيق السيريال", messages[result.status.state] || "السيريال غير صالح");
  }

  function save() {
    if (!form.companyNameAr?.trim()) {
      toast.error("بيانات غير مكتملة", "اسم الشركة بالعربية مطلوب");
      return;
    }
    if (!form.ownerName?.trim()) {
      toast.error("بيانات غير مكتملة", "اسم صاحب الشركة / المحل مطلوب");
      return;
    }
    if (!form.ownerPhone?.trim()) {
      toast.error("بيانات غير مكتملة", "رقم موبايل صاحب الشركة / المحل مطلوب");
      return;
    }
    if (!isValidEgyptianMobile(form.ownerPhone)) {
      toast.error("رقم موبايل غير صحيح", "رقم الموبايل يجب أن يتكون من 11 رقمًا ويبدأ بـ 01 (مثال: 01018194709)");
      return;
    }

    const derivedLogoText = form.companyNameAr?.trim()
      ? form.companyNameAr.trim().slice(0, 2)
      : (form.companyName?.trim()
        ? form.companyName.trim().slice(0, 2).toUpperCase()
        : "AP");
    
    const updatedForm = {
      ...form,
      logoText: derivedLogoText
    };
    
    updateSettings(updatedForm);
    setForm(updatedForm);
    toast.success("تم حفظ الإعدادات");
  }

  async function backupNow() {
    const dir = form.backupPath?.trim();
    if (!dir) {
      toast.error("لم يتم تحديد مجلد", "اختر مجلد النسخ الاحتياطي أولاً");
      return;
    }
    if (dir !== settings.backupPath) updateSettings({ ...settings, backupPath: dir });
    const result = await backupToPath(dir);
    if (result.ok) {
      toast.success("تم النسخ الاحتياطي", result.path ?? dir);
      return;
    }
    const messages: Record<string, string> = {
      no_path: "لم يتم تحديد مجلد النسخ الاحتياطي",
      not_desktop: "هذه الميزة متاحة في تطبيق سطح المكتب فقط",
      path_not_found: "المجلد غير موجود أو غير متاح",
      not_authorized: "غير مصرح — سجّل الدخول كمالك",
      invalid_input: "بيانات غير صالحة",
      write_failed: "فشل الكتابة إلى المجلد",
    };
    toast.error("فشل النسخ الاحتياطي", messages[result.error ?? ""] ?? "حدث خطأ غير متوقع");
  }

  const license = licenseStatus?.license ?? null;
  const featureChecked = (key: FeatureKey) => form.features?.[key] ?? defaultFeatureState(key, license);
  const featureOn = (key: FeatureKey) => isAllowedByLicense(key, license) && featureChecked(key);
  const excelExportEnabled = featureOn("excelExport");
  const mfaFeatureAllowed = isAllowedByLicense("twoFactorAuth", license);
  const toggleFeature = (key: FeatureKey, value: boolean) =>
    setForm({ ...form, features: { ...(form.features ?? {}), [key]: value } });

  function getRemainingDays(startDate: string, months: number) {
    if (!startDate || months <= 0) return 0;
    const start = new Date(startDate);
    const end = new Date(start);
    end.setMonth(end.getMonth() + months);
    const diff = end.getTime() - new Date().getTime();
    return Math.ceil(diff / (1000 * 60 * 60 * 24));
  }

  function renderFeatureCard(feature: FeatureDef) {
    const allowed = isAllowedByLicense(feature.key, license);
    const isMfaFeature = feature.key === "twoFactorAuth";
    const checked = allowed && (isMfaFeature || featureChecked(feature.key));

    if (!allowed) {
      return (
        <button
          key={feature.key}
          type="button"
          onClick={() => setLockedFeature(feature)}
          className="group flex min-h-28 items-start gap-3 rounded-xl border border-amber-200 bg-amber-50/45 p-3 text-right transition-colors hover:border-amber-400 hover:bg-amber-50 dark:border-amber-500/25 dark:bg-amber-500/5 dark:hover:bg-amber-500/10"
          aria-label={`طلب تفعيل ${feature.label}`}
        >
          <span className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300">
            <Lock className="h-3.5 w-3.5" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="flex flex-wrap items-center gap-1.5 text-sm font-semibold text-ink">
              {feature.label}
              <span className="inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-100/70 px-1.5 py-0.5 text-[10px] font-bold text-amber-700 dark:border-amber-500/25 dark:bg-amber-500/15 dark:text-amber-300">
                إضافة مدفوعة <PackagePlus className="h-3 w-3" />
              </span>
            </span>
            <span className="mt-1 block text-xs leading-5 text-ink-muted">{feature.description}</span>
            <span className="mt-2 inline-flex text-[11px] font-bold text-amber-700 dark:text-amber-300">اضغط لمعرفة خيارات التفعيل</span>
          </span>
        </button>
      );
    }

    return (
      <label
        key={feature.key}
        className="flex min-h-28 items-start gap-3 rounded-xl border border-line bg-surface p-3 transition-colors hover:border-brand-300 hover:bg-surface-muted/45"
      >
        {isMfaFeature ? (
          <span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded border border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-300">✓</span>
        ) : (
          <input
            type="checkbox"
            className="mt-1 h-4 w-4 shrink-0 accent-brand-600"
            checked={checked}
            onChange={(event) => toggleFeature(feature.key, event.target.checked)}
          />
        )}
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-1.5 text-sm font-semibold text-ink">
            {feature.label}
            {isMfaFeature ? (
              <span className="rounded-full border border-emerald-200 bg-emerald-50 px-1.5 py-0.5 text-[10px] font-bold text-emerald-700 dark:border-emerald-500/25 dark:bg-emerald-500/10 dark:text-emerald-300">مضمنة في الترخيص</span>
            ) : null}
          </span>
          <span className="mt-1 block text-xs leading-5 text-ink-faint">{feature.description}</span>
          {!isMfaFeature ? (
            <span className={`mt-2 block text-[11px] font-semibold ${checked ? "text-emerald-700 dark:text-emerald-300" : "text-ink-faint"}`}>
              {checked ? "ظاهرة ومفعّلة" : "مخفية من الواجهة"}
            </span>
          ) : null}
        </span>
      </label>
    );
  }

  return (
    <>
      <PageHeader
        title="الإعدادات"
        description="خيارات الشركة، الطباعة، والعملة"
        actions={
          <Button onClick={save}>
            <Save className="w-4 h-4" /> حفظ الإعدادات
          </Button>
        }
      />

      <div className="grid w-full min-w-0 grid-cols-1 gap-4 lg:grid-cols-2">
        <Card className="lg:col-span-2">
          <CardHeader title="بيانات الشركة" subtitle="تظهر في الفواتير وأعلى التطبيق" />
          <CardBody className="grid gap-5 lg:grid-cols-[minmax(13rem,0.42fr)_minmax(0,1fr)] lg:items-center">
            <div className="flex items-center gap-6">
              <div className="relative group/logo">
                <div
                  className={`w-20 h-20 rounded-2xl border-4 border-surface shadow-lg overflow-hidden flex items-center justify-center text-2xl ${
                    form.logoImage ? "bg-surface" : "bg-gradient-to-br from-brand-600 to-brand-800 text-white font-bold"
                  }`}
                >
                  {form.logoImage ? (
                    <img src={form.logoImage} alt="Logo" className="w-full h-full object-contain" />
                  ) : (
                    form.logoText || "HD"
                  )}
                </div>
                {form.logoImage && (
                  <button
                    onClick={() => setForm({ ...form, logoImage: "" })}
                    className="absolute -top-2 -right-2 w-6 h-6 bg-red-500 text-white rounded-full shadow-md flex items-center justify-center opacity-0 group-hover/logo:opacity-100 transition-opacity"
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                )}
              </div>

              <div className="flex-1 space-y-2">
                <div className="text-sm font-bold text-ink">شعار الشركة</div>
                <div className="flex items-center gap-2">
                  <div className="relative">
                    <input
                      type="file"
                      accept="image/*"
                      className="absolute inset-0 opacity-0 cursor-pointer"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) {
                          const reader = new FileReader();
                          reader.onloadend = () => {
                            setForm({ ...form, logoImage: reader.result as string });
                          };
                          reader.readAsDataURL(file);
                        }
                      }}
                    />
                    <Button variant="outline" size="sm" className="gap-2">
                      <ImageIcon className="w-4 h-4" /> رفع صورة
                    </Button>
                  </div>
                  {!form.logoImage && (
                    <div className="text-[10px] text-ink-faint">
                      سيتم استخدام الحرفين الأولين من اسم الشركة في حال عدم رفع صورة
                    </div>
                  )}
                </div>
              </div>
            </div>

            <div className="space-y-4">
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <Field label="اسم الشركة بالعربية" required>
                  <Input
                    value={form.companyNameAr}
                    onChange={(e) => setForm({ ...form, companyNameAr: e.target.value })}
                  />
                </Field>
                <Field label="اسم الشركة بالإنجليزية">
                  <Input
                    value={form.companyName}
                    onChange={(e) => setForm({ ...form, companyName: e.target.value })}
                  />
                </Field>
              </div>

              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <Field label="اسم صاحب الشركة / المحل" required>
                  <Input
                    value={form.ownerName || ""}
                    onChange={(e) => setForm({ ...form, ownerName: e.target.value })}
                  />
                </Field>
                <Field label="رقم موبايل صاحب الشركة / المحل" required hint="يجب أن يتكون من 11 رقمًا ويبدأ بـ 01">
                  <Input
                    type="tel"
                    maxLength={11}
                    value={form.ownerPhone || ""}
                    onChange={(e) => setForm({ ...form, ownerPhone: normalizePhoneInput(e.target.value) })}
                    placeholder="01xxxxxxxxx (11 رقم)"
                    dir="ltr"
                    className="tracking-wider font-mono text-right"
                  />
                </Field>
              </div>
            </div>
          </CardBody>
        </Card>

        {cloudArchive.state !== "unavailable" && (
          <Card className="lg:col-span-2" dir="rtl">
            <CardHeader
              title={
                <div className="flex items-center gap-2">
                  <CloudUpload className="h-4 w-4 text-brand-600" />
                  <span>النسخة السحابية الكاملة</span>
                </div>
              }
              subtitle="كل بيانات المتجر مشفَّرة بكلمة سر تخصك — محليًا وعلى السحابة، وقابلة للاستعادة على أي جهاز"
            />
            <CardBody className="space-y-4">
              {cloudArchive.state === "loading" ? (
                <div className="rounded-xl border border-line bg-surface-muted/45 p-4 text-sm text-ink-muted">جارٍ فحص حالة النسخة السحابية…</div>
              ) : !cloudArchive.featureLicensed ? (
                <PaidFeatureNotice
                  title="النسخة السحابية الكاملة"
                  featureKey="cloudBackup"
                  description="نسخة مشفّرة من كل بيانات المتجر على السحابة، قابلة للاستعادة على أي جهاز بكلمة سرك — تُباع بشكل مستقل عن باقات الاشتراك."
                />
              ) : !cloudArchive.serviceAvailable ? (
                <div className="rounded-xl border border-amber-200 bg-amber-50/60 p-4 text-sm text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
                  خدمة السحابة غير مهيأة في هذا الإصدار.
                </div>
              ) : (
                <>
                  <div className={cn(
                    "rounded-xl border p-4",
                    cloudArchive.configured
                      ? "border-emerald-200 bg-emerald-50/55 dark:border-emerald-500/25 dark:bg-emerald-500/10"
                      : "border-amber-200 bg-amber-50/60 dark:border-amber-500/30 dark:bg-amber-500/10",
                  )}>
                    <div className="text-sm font-bold text-ink">
                      {cloudArchive.configured ? "النسخة السحابية مفعّلة" : "النسخة السحابية غير مفعّلة"}
                    </div>
                    <div className="mt-1 text-xs leading-6 text-ink-muted">
                      {cloudArchive.configured
                        ? <>آخر رفع: {formatDeviceMoment(cloudArchive.lastArchivedAt)} · يتم الرفع تلقائيًا كل نصف ساعة عند تغيّر البيانات.</>
                        : "اختر كلمة سر للنسخة عشان يبدأ رفع بيانات المتجر بالكامل مشفّرة. البورتال لا يستطيع فك التشفير — احتفظ بكلمة السر في مكان آمن."}
                    </div>
                    {cloudArchive.lastError && (
                      <div className="mt-2 text-xs text-rose-700 dark:text-rose-300">
                        آخر محاولة فشلت: {cloudArchive.lastError.message}
                      </div>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      type="button"
                      disabled={cloudArchiveBusy}
                      onClick={() => {
                        setCloudPassphraseError("");
                        setCloudAccountPassword("");
                        setCloudPassphrase("");
                        setCloudPassphraseConfirm("");
                        setCloudPassphraseDialogOpen(true);
                      }}
                    >
                      <KeyRound className="h-4 w-4" />
                      {cloudArchive.configured ? "تغيير كلمة سر النسخة" : "تفعيل النسخة السحابية"}
                    </Button>
                    {cloudArchive.configured && (
                      <Button type="button" variant="outline" disabled={cloudArchiveBusy} onClick={() => void runCloudArchiveSync()}>
                        <CloudUpload className={cn("h-4 w-4", cloudArchiveBusy && "animate-pulse")} /> رفع نسخة الآن
                      </Button>
                    )}
                    <Button
                      type="button"
                      variant="outline"
                      disabled={cloudArchiveBusy}
                      onClick={() => {
                        setCloudRestoreError("");
                        setCloudRestorePassphrase("");
                        setCloudRestorePreview(null);
                        setCloudRestoreDialogOpen(true);
                      }}
                    >
                      <CloudDownload className="h-4 w-4" /> استعادة من السحابة
                    </Button>
                  </div>
                </>
              )}
            </CardBody>
          </Card>
        )}

        <Card className="lg:col-span-2" dir="rtl">
          <CardHeader
            title={
              <div className="flex items-center gap-2">
                <Smartphone className="h-4 w-4 text-brand-600" />
                <span>ربط تطبيق PartFlow للهاتف</span>
              </div>
            }
            subtitle="أنشئ كود ربط لمرة واحدة بعد إثبات كلمة المرور و2FA — للمالك أو المشرف المصرح له فقط"
          />
          <CardBody className="space-y-4">
            {mobileLinkStatus.state === "loading" ? (
              <div className="rounded-xl border border-line bg-surface-muted/45 p-4 text-sm text-ink-muted">جارٍ فحص متطلبات الربط…</div>
            ) : mobileLinkStatus.state === "unavailable" ? (
              <div className="rounded-xl border border-amber-200 bg-amber-50/60 p-4 text-sm text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
                افتح هذه الصفحة من برنامج سطح المكتب بعد تسجيل الدخول لعرض حالة الربط.
              </div>
            ) : !mobileLinkStatus.featureLicensed ? (
              <PaidFeatureNotice
                title="ربط تطبيق PartFlow للهاتف"
                featureKey="mobileCompanion"
                description="فعّل الإضافة على الترخيص لتوصيل تطبيق Android وiPhone بحساب متجرك بصورة آمنة."
              />
            ) : (
              <>
                <div className="grid gap-3 md:grid-cols-3">
                  <MobileRequirement
                    ok={mobileLinkStatus.allowedRole}
                    title="صلاحية الحساب"
                    description={mobileLinkStatus.allowedRole ? "مالك أو مشرف مصرح له" : "يتطلب مالكًا أو صلاحية اعتماد المشرف"}
                  />
                  <MobileRequirement
                    ok={mobileLinkStatus.twoFactorLicensed}
                    title="ميزة 2FA"
                    description={mobileLinkStatus.twoFactorLicensed ? "مفعلة على الترخيص" : "غير مفعلة على الترخيص"}
                  />
                  <MobileRequirement
                    ok={mobileLinkStatus.mfaEnabled}
                    title="حماية حسابك"
                    description={mobileLinkStatus.mfaEnabled ? "Authenticator مفعل" : "فعّل Authenticator لحسابك أولًا"}
                  />
                </div>
                <div className="flex flex-col gap-3 rounded-xl border border-brand-200 bg-brand-50/45 p-4 dark:border-brand-500/25 dark:bg-brand-500/10 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <div className="text-sm font-bold text-ink">كود آمن صالح لمرة واحدة</div>
                    <div className="mt-1 text-xs leading-5 text-ink-muted">
                      عند فتح التطبيق سيُطلب اسم المستخدم وكلمة المرور وكود 2FA الحالي بالإضافة إلى كود الربط.
                    </div>
                  </div>
                  <Button
                    type="button"
                    className="shrink-0"
                    disabled={!mobileLinkStatus.allowedRole || !mobileLinkStatus.twoFactorLicensed || !mobileLinkStatus.mfaEnabled}
                    onClick={openMobilePairingDialog}
                  >
                    <KeyRound className="h-4 w-4" /> إنشاء كود ربط
                  </Button>
                </div>

                <div className="space-y-3 rounded-xl border border-line bg-surface-muted/35 p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <div className="text-sm font-bold text-ink">الأجهزة المرتبطة</div>
                      <div className="mt-1 text-xs leading-5 text-ink-muted">
                        كل جهاز ربط التطبيق بحساب المتجر، وآخر نشاط له، مع إمكانية تسجيل الخروج عن بُعد.
                      </div>
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      className="shrink-0"
                      disabled={mobileDevices.state === "loading"}
                      onClick={() => setDeviceRefreshKey((key) => key + 1)}
                    >
                      <RefreshCw className={cn("h-4 w-4", mobileDevices.state === "loading" && "animate-spin")} />
                      تحديث
                    </Button>
                  </div>

                  {mobileDevices.state === "loading" ? (
                    <div className="rounded-lg border border-line bg-surface p-4 text-sm text-ink-muted">
                      جارٍ تحميل قائمة الأجهزة…
                    </div>
                  ) : mobileDevices.state === "error" ? (
                    <div className="rounded-lg border border-amber-200 bg-amber-50/60 p-4 text-sm text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
                      تعذر تحميل قائمة الأجهزة الآن — تحقق من الإنترنت ثم اضغط تحديث.
                    </div>
                  ) : mobileDevices.state === "ready" && mobileDevices.devices.length === 0 ? (
                    <div className="rounded-lg border border-dashed border-line bg-surface p-5 text-center text-sm text-ink-muted">
                      لا توجد أجهزة مرتبطة بعد. أنشئ كود ربط وافتح التطبيق على الهاتف.
                    </div>
                  ) : mobileDevices.state === "ready" ? (
                    <ul className="space-y-2">
                      {mobileDevices.devices.map((device) => (
                        <MobileDeviceRow
                          key={device.id}
                          device={device}
                          busy={deviceRevokeBusy}
                          onSignOut={() => void revokeMobileDevice(device, true)}
                          onUnlink={() => setDevicePendingRevoke(device)}
                        />
                      ))}
                    </ul>
                  ) : null}
                </div>
              </>
            )}
          </CardBody>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader title="الإعدادات العامة والأمان" subtitle="إعدادات التشغيل الأساسية وحماية الحساب" />
          <CardBody className="grid grid-cols-1 items-start gap-4 space-y-0 md:grid-cols-2 xl:grid-cols-3">
            <Field
              label="الحد الأدنى الافتراضي للمخزون"
              hint="يُستخدم كقيمة افتراضية عند إضافة منتج جديد"
            >
              <Input
                type="number"
                min={0}
                value={form.lowStockThreshold}
                onChange={(e) =>
                  setForm({ ...form, lowStockThreshold: Number(e.target.value) })
                }
              />
            </Field>

            {featureOn("creditSales") && (
              <Field
                label="مدة تنبيه تأخر السداد"
                hint="المدة التي يُعتبر بعدها المورد متأخراً في السداد فتظهر تنبيهاته"
              >
                <Select
                  value={String(form.paymentTermDays ?? 7)}
                  onChange={(e) => setForm({ ...form, paymentTermDays: Number(e.target.value) })}
                >
                  <option value="7">أسبوع (7 أيام)</option>
                  <option value="14">أسبوعين (14 يوم)</option>
                  <option value="30">شهر (30 يوم)</option>
                  <option value="60">شهرين (60 يوم)</option>
                  <option value="90">ثلاثة أشهر (90 يوم)</option>
                </Select>
              </Field>
            )}

            <Field
              label="الحد الأقصى لمهلة الاسترجاع (سياسة المرتجعات)"
              hint="الحد الأقصى المسموح به بالأيام لعمل مرتجع مبيعات بعد تاريخ الشراء"
            >
              <Select
                value={String(form.maxReturnDays ?? 14)}
                onChange={(e) => setForm({ ...form, maxReturnDays: Number(e.target.value) })}
              >
                <option value="3">3 أيام</option>
                <option value="7">7 أيام</option>
                <option value="14">14 يوماً (الحد الافتراضي/القانوني)</option>
                <option value="30">30 يوماً</option>
                <option value="60">60 يوماً</option>
                <option value="999">بدون حد أقصى (مفتوح)</option>
              </Select>
            </Field>

            {featureOn("expiryTracking") ? (
              <Field
                label="تنبيه قرب انتهاء الصلاحية"
                hint="عدد الأيام قبل انتهاء الصلاحية لعرض تنبيه — ينطبق على صفحة التنبيهات"
              >
                <Select
                  value={String(form.expiryAlertDays ?? 14)}
                  onChange={(e) => setForm({ ...form, expiryAlertDays: Number(e.target.value) })}
                >
                  <option value="7">7 أيام</option>
                  <option value="14">14 يوم (افتراضي)</option>
                  <option value="30">30 يوم</option>
                  <option value="60">60 يوم</option>
                  <option value="90">90 يوم</option>
                </Select>
              </Field>
            ) : (
              <PaidFeatureNotice title="متابعة صلاحية المنتجات" featureKey="expiryTracking" />
            )}

            {featureOn("advancedSecurity") ? (
              <Field label="قفل الجلسة بعد عدم النشاط" hint="عدد الدقائق قبل قفل الشاشة تلقائياً — 0 لتعطيل الميزة">
                <Select
                  value={String(form.idleLockMinutes ?? 0)}
                  onChange={(e) => setForm({ ...form, idleLockMinutes: Number(e.target.value) })}
                >
                  <option value="0">معطّل</option>
                  <option value="5">5 دقائق</option>
                  <option value="10">10 دقائق</option>
                  <option value="15">15 دقيقة</option>
                  <option value="30">30 دقيقة</option>
                  <option value="60">ساعة كاملة</option>
                </Select>
              </Field>
            ) : (
              <PaidFeatureNotice title="قفل الشاشة والأمان المتقدم" featureKey="advancedSecurity" />
            )}

            <Field
              label="التنظيف التلقائي لسجل النشاط"
              hint="تحديد مدة الاحتفاظ بسجل العمليات ومسح القديم تلقائياً"
            >
              <Select
                value={String(form.auditLogPruneDays ?? 0)}
                onChange={(e) => setForm({ ...form, auditLogPruneDays: Number(e.target.value) })}
              >
                <option value="0">الاحتفاظ بالجميع (معطّل)</option>
                <option value="14">كل أسبوعين (14 يوم)</option>
                <option value="30">كل شهر (30 يوم)</option>
                <option value="90">كل 3 أشهر (90 يوم)</option>
                <option value="180">كل 6 أشهر (180 يوم)</option>
                <option value="365">كل سنة (365 يوم)</option>
              </Select>
            </Field>

            <Field
              label="مسح سجل النشاط يدوياً"
              hint={`مسجل حالياً ${auditLogs.length.toLocaleString()} عملية نشاط`}
            >
              <Button
                type="button"
                variant="outline"
                className="w-full justify-center text-rose-600 border-rose-200 dark:border-rose-900/50 hover:bg-rose-50 dark:hover:bg-rose-950/30"
                onClick={() => setClearLogsDialogOpen(true)}
              >
                <Trash2 className="w-4 h-4 me-2 shrink-0" />
                مسح سجل النشاط الآن
              </Button>
            </Field>
          </CardBody>

          {currentUser && mfaFeatureAllowed ? (
            <div className="border-t border-line px-4 py-4" dir="rtl">
              <div className="grid gap-3 xl:grid-cols-2">
                <div className="rounded-xl border border-line bg-surface-muted/40 p-4">
                  <MfaPolicyCard embedded onChanged={() => setMfaRefreshKey((value) => value + 1)} />
                </div>
                <div className="rounded-xl border border-line bg-surface-muted/40 p-4">
                  <TwoFactorSecurityPanel
                    key={mfaRefreshKey}
                    currentUser={currentUser}
                    isOwner
                    embedded
                  />
                </div>
              </div>
            </div>
          ) : currentUser ? (
            <div className="border-t border-line px-4 py-4" dir="rtl">
              <div className="flex flex-col gap-3 rounded-xl border border-amber-200 bg-amber-50/60 p-4 dark:border-amber-500/30 dark:bg-amber-500/10 sm:flex-row sm:items-center sm:justify-between">
                <PaidFeatureNotice
                  title="المصادقة الثنائية والأكواد الاحتياطية"
                  featureKey="twoFactorAuth"
                  description="أضف حماية الدخول وأكواد الاسترداد كإضافة مستقلة أو ضمن ترقية الباقة."
                />
                <Button type="button" variant="outline" className="shrink-0" onClick={() => setLockedFeature(FEATURES.find((feature) => feature.key === "twoFactorAuth") ?? null)}>
                  <PackagePlus className="w-4 h-4" /> خيارات التفعيل
                </Button>
              </div>
            </div>
          ) : null}
        </Card>

        <UpdateSettingsCard />

        <Card className="lg:col-span-2">
          <CardHeader
            title={
              <div className="flex items-center gap-2">
                <Boxes className="w-4 h-4 text-brand-600" />
                <span>المميزات والوحدات</span>
              </div>
            }
            subtitle="اعرض الأساسيات أولًا، ثم استكشف المميزات حسب احتياج عملك وباقتك"
          />
          <CardBody className="space-y-4">
            {!showAllFeatures ? (
              <div className="grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-3">
                {FEATURES.slice(0, FEATURE_PREVIEW_LIMIT).map((feature) => renderFeatureCard(feature))}
                <button
                  type="button"
                  onClick={() => setShowAllFeatures(true)}
                  className="group flex min-h-28 items-center gap-3 rounded-xl border border-dashed border-brand-300 bg-brand-50/50 p-3 text-right transition-colors hover:border-brand-500 hover:bg-brand-50 dark:border-brand-500/40 dark:bg-brand-500/10 dark:hover:bg-brand-500/15"
                >
                  <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-brand-600 text-white shadow-sm">
                    <PackagePlus className="h-5 w-5" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-bold text-brand-800 dark:text-brand-200">عرض المزيد من المميزات</span>
                    <span className="mt-1 block text-xs leading-5 text-brand-700/80 dark:text-brand-300/80">
                      {FEATURES.length - FEATURE_PREVIEW_LIMIT} ميزة إضافية، مرتبة حسب احتياج عملك.
                    </span>
                  </span>
                </button>
              </div>
            ) : (
              <div className="space-y-5">
                {FEATURE_CATEGORIES.map((category) => {
                  const categoryFeatures = FEATURES.filter(
                    (feature) => FEATURE_CATEGORY_BY_KEY[feature.key] === category.id
                  );
                  return (
                    <section key={category.id} className="rounded-xl border border-line bg-surface-muted/30 p-3.5">
                      <div className="mb-3 flex items-start justify-between gap-3">
                        <div>
                          <div className="text-sm font-bold text-ink">{category.label}</div>
                          <p className="mt-0.5 text-xs text-ink-muted">{category.description}</p>
                        </div>
                        <span className="rounded-full border border-line bg-surface px-2 py-0.5 text-[10px] font-bold text-ink-faint">
                          {categoryFeatures.length} مميزات
                        </span>
                      </div>
                      <div className="grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-3">
                        {categoryFeatures.map((feature) => renderFeatureCard(feature))}
                      </div>
                    </section>
                  );
                })}
                <div className="flex justify-center border-t border-line-soft pt-3">
                  <Button type="button" variant="ghost" size="sm" onClick={() => setShowAllFeatures(false)}>
                    عرض المميزات الأساسية فقط
                  </Button>
                </div>
              </div>
            )}
            <div className="border-t border-line-soft pt-3 text-xs leading-6 text-ink-faint">
              يمكنك إخفاء الميزة المتاحة من واجهة النظام دون حذف بياناتها. أمّا الميزة المقفولة فتحتاج ترقية الباقة أو إضافتها كـ Add-on من المطوّر.
            </div>
          </CardBody>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader
            title="إعدادات الفاتورة"
            subtitle="إعدادات الطباعة والحفظ ومشاركة الفاتورة"
          />
          <CardBody className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            <section className="space-y-4 rounded-xl border border-line bg-surface-muted/20 p-4">
              <div className="flex items-start gap-2">
                <div className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-brand-50 text-brand-600 dark:bg-brand-500/10 dark:text-brand-300">
                  <FileSpreadsheet className="h-4 w-4" />
                </div>
                <div>
                  <div className="text-sm font-bold text-ink">الطباعة والحفظ</div>
                  <div className="mt-0.5 text-xs text-ink-muted">اختر شكل الفاتورة ومكان حفظ نسخة PDF.</div>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <Field label="مقاس الورق">
                  <Select
                    value={form.printPaperSize}
                    onChange={(e) => setForm({ ...form, printPaperSize: e.target.value as "A4" | "A5" })}
                  >
                    <option value="A4">A4</option>
                    <option value="A5">A5</option>
                  </Select>
                </Field>

                <Field label="مجلد حفظ PDF" className="sm:col-span-2">
                  <div className="flex gap-2">
                    <Input
                      value={form.invoicesSavePath}
                      readOnly
                      placeholder="اختر مجلداً..."
                      className="bg-surface-muted text-right"
                      dir="ltr"
                    />
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      aria-label="اختيار مجلد حفظ الفواتير"
                      onClick={async () => {
                        if (window.desktopAPI?.setup?.selectDirectory) {
                          const path = await window.desktopAPI.setup.selectDirectory();
                          if (path) setForm({ ...form, invoicesSavePath: path });
                        }
                      }}
                    >
                      <FolderOpen className="w-4 h-4" />
                    </Button>
                  </div>
                </Field>
              </div>

              <Field label="نص ذيل الفاتورة" hint="رسالة قصيرة تظهر أسفل كل فاتورة">
                <Textarea
                  rows={2}
                  value={form.invoiceFooter}
                  onChange={(e) => setForm({ ...form, invoiceFooter: e.target.value })}
                  className="min-h-[64px] resize-y"
                />
              </Field>
            </section>

            <section className="space-y-4 rounded-xl border border-line bg-surface-muted/20 p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-start gap-2">
                  <div className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-emerald-50 text-emerald-600 dark:bg-emerald-500/10 dark:text-emerald-300">
                    <MessageCircle className="h-4 w-4" />
                  </div>
                  <div>
                    <div className="text-sm font-bold text-ink">مشاركة الفاتورة</div>
                    <div className="mt-0.5 text-xs text-ink-muted">راجع المظهر وخصّص رسالة واتساب عند الحاجة.</div>
                  </div>
                </div>
                <Button type="button" variant="outline" size="sm" className="shrink-0" onClick={() => setPreviewOpen(true)}>
                  <Eye className="w-4 h-4" /> معاينة
                </Button>
              </div>

              {featureOn("whatsappIntegration") ? (
                <div className="overflow-hidden rounded-xl border border-line bg-surface">
                  <button
                    type="button"
                    className="flex w-full items-center justify-between gap-4 px-3.5 py-3 text-right transition-colors hover:bg-surface-muted/60"
                    onClick={() => setWhatsappTemplateExpanded((value) => !value)}
                    aria-expanded={whatsappTemplateExpanded}
                  >
                    <span className="min-w-0">
                      <span className="block text-sm font-bold text-ink">تخصيص رسالة واتساب</span>
                      <span className="mt-0.5 block text-xs text-ink-muted">اختياري — استخدم المتغيرات لإرسال الرسالة المناسبة لكل فاتورة</span>
                    </span>
                    <span className="inline-flex shrink-0 items-center gap-1 text-xs font-bold text-brand-700 dark:text-brand-300">
                      {whatsappTemplateExpanded ? "إخفاء" : "تعديل"}
                      {whatsappTemplateExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                    </span>
                  </button>

                  {whatsappTemplateExpanded ? (
                    <div className="space-y-3 border-t border-line p-3.5">
                      <Textarea
                        ref={whatsappTemplateRef}
                        rows={5}
                        dir="rtl"
                        value={form.whatsappInvoiceTemplate ?? DEFAULT_INVOICE_WHATSAPP_TEMPLATE}
                        onChange={(e) => setForm({ ...form, whatsappInvoiceTemplate: e.target.value })}
                        className="min-h-[132px] resize-y leading-6"
                      />
                      <div className="rounded-lg border border-line bg-surface-muted/35 p-2.5">
                        <div className="mb-2 text-[11px] font-bold text-ink-muted">أضف متغيرًا في موضع المؤشر</div>
                        <div className="flex gap-1.5 overflow-x-auto pb-1" dir="rtl">
                          {WHATSAPP_INVOICE_TAGS.map((item) => (
                            <button
                              key={item.tag}
                              type="button"
                              onClick={() => insertWhatsappTag(item.tag)}
                              className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-line bg-surface px-2 py-1 text-[11px] text-ink-muted transition-colors hover:border-brand-300 hover:text-brand-700 dark:hover:text-brand-300"
                              title={`إضافة ${item.label}`}
                            >
                              <span>{item.label}</span>
                              <code dir="ltr" className="font-mono text-[10px] text-ink">{item.tag}</code>
                            </button>
                          ))}
                        </div>
                      </div>
                      <div className="flex justify-end">
                        <Button type="button" variant="ghost" size="sm" onClick={() => setForm({ ...form, whatsappInvoiceTemplate: DEFAULT_INVOICE_WHATSAPP_TEMPLATE })}>
                          استعادة القالب الافتراضي
                        </Button>
                      </div>
                    </div>
                  ) : null}
                </div>
              ) : (
                <PaidFeatureNotice title="التكامل مع واتساب" featureKey="whatsappIntegration" />
              )}
            </section>
          </CardBody>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader title="إعدادات النسخ الاحتياطي" subtitle="جدولة حفظ البيانات تلقائياً واستعادتها عند الحاجة" />
          <CardBody className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            {!featureOn("advancedSecurity") && (
              <div className="xl:col-span-2">
                <PaidFeatureNotice title="النسخ الاحتياطي التلقائي والأمان المتقدم" featureKey="advancedSecurity" />
              </div>
            )}
            <section className="rounded-xl border border-line bg-surface-muted/25 p-4">
              <div className="mb-4 flex items-start gap-2.5">
                <div className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-brand-50 text-brand-700 dark:bg-brand-500/10 dark:text-brand-300">
                  <Clock className="h-4 w-4" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-ink">الجدولة والحماية</h3>
                  <p className="mt-0.5 text-xs text-ink-muted">اضبط متى ينشئ النظام نسخة من بياناتك.</p>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="rounded-lg border border-line bg-surface p-3">
                  <Field label="تفعيل النسخ التلقائي">
                    <label className="flex min-h-9 cursor-pointer items-center gap-2 text-sm text-ink disabled:cursor-not-allowed">
                      <input
                        type="checkbox"
                        className="w-4 h-4 rounded border-2 border-ink-faint bg-surface accent-brand-600 focus:ring-2 focus:ring-brand-500 disabled:opacity-50 cursor-pointer"
                        checked={featureOn("advancedSecurity") && form.autoBackupEnabled}
                        disabled={!featureOn("advancedSecurity")}
                        onChange={(e) => setForm({ ...form, autoBackupEnabled: e.target.checked })}
                      />
                      <span>نعم، قم بالحفظ تلقائياً</span>
                    </label>
                  </Field>
                </div>
                <div className="rounded-lg border border-line bg-surface p-3">
                  <Field label="تكرار النسخ">
                    <Select
                      value={form.autoBackupFrequency}
                      disabled={!featureOn("advancedSecurity") || !form.autoBackupEnabled}
                      onChange={(e) =>
                        setForm({
                          ...form,
                          autoBackupFrequency: e.target.value as typeof form.autoBackupFrequency,
                        })
                      }
                    >
                      <option value="daily">يومي</option>
                      <option value="weekly">أسبوعي</option>
                      <option value="monthly">شهري</option>
                    </Select>
                  </Field>
                </div>
                <div className="sm:col-span-2 rounded-lg border border-line bg-surface px-3 py-2.5">
                  <Field
                    label="نسخة عند إغلاق البرنامج"
                    hint="يحفظ نسخة كاملة تلقائياً في المجلد المحدد قبل إغلاق التطبيق"
                  >
                    <label className="flex min-h-8 cursor-pointer items-center gap-2 text-sm text-ink disabled:cursor-not-allowed">
                      <input
                        type="checkbox"
                        className="w-4 h-4 rounded border-2 border-ink-faint bg-surface accent-brand-600 focus:ring-2 focus:ring-brand-500 disabled:opacity-50 cursor-pointer"
                        checked={featureOn("advancedSecurity") && (form.backupOnClose ?? true)}
                        disabled={!featureOn("advancedSecurity")}
                        onChange={(e) => setForm({ ...form, backupOnClose: e.target.checked })}
                      />
                      <span>احفظ نسخة تلقائياً عند الإغلاق</span>
                    </label>
                  </Field>
                </div>
              </div>
            </section>

            <section className="rounded-xl border border-line bg-surface-muted/25 p-4">
              <div className="mb-4 flex items-start gap-2.5">
                <div className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300">
                  <Database className="h-4 w-4" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-ink">المسار والحالة</h3>
                  <p className="mt-0.5 text-xs text-ink-muted">اختر موقع الحفظ، وابدأ نسخة فورية عند الحاجة.</p>
                </div>
              </div>

              <div className="space-y-3">
                <div className="rounded-lg border border-brand-100 bg-brand-50/60 p-3 dark:border-brand-500/20 dark:bg-brand-500/10">
                  <div className="mb-1 text-[11px] font-bold text-brand-700 dark:text-brand-300">آخر نسخة احتياطية</div>
                  <div className="font-mono text-sm font-medium text-brand-900 dark:text-brand-200" dir="rtl">
                    {settings.lastBackupDate ? new Date(settings.lastBackupDate).toLocaleString("ar-EG") : "لم يتم الحفظ بعد"}
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-3 md:grid-cols-[minmax(0,1fr)_auto] md:items-end">
                  <Field label="مجلد النسخ الاحتياطي" hint="يمكن اختيار مجلد محلي أو قرص خارجي أو مسار شبكة.">
                    <div className="flex gap-2" dir="ltr">
                      <Input
                        value={form.backupPath}
                        readOnly
                        placeholder="اختر مجلداً..."
                        className="bg-surface-muted text-left font-mono text-xs"
                      />
                      <Button
                        type="button"
                        variant="outline"
                        size="icon"
                        title="اختيار مجلد النسخ الاحتياطي"
                        disabled={!featureOn("advancedSecurity")}
                        onClick={async () => {
                          if (window.desktopAPI?.backup?.selectDirectory) {
                            const path = await window.desktopAPI.backup.selectDirectory();
                            if (path) setForm({ ...form, backupPath: path });
                          } else {
                            toast.error("متاح في تطبيق سطح المكتب فقط");
                          }
                        }}
                      >
                        <FolderOpen className="h-4 w-4" />
                      </Button>
                    </div>
                  </Field>

                  <Button
                    type="button"
                    variant="success"
                    onClick={backupNow}
                    disabled={!featureOn("advancedSecurity") || !form.backupPath?.trim()}
                    className="w-full justify-center md:min-w-44 md:w-auto"
                  >
                    <Database className="h-4 w-4" />
                    نسخ احتياطي الآن
                  </Button>
                </div>
                <p className="text-[11px] leading-5 text-ink-faint">
                  تُحفظ نسخة كاملة بصيغة JSON، ويمكن استعادتها لاحقاً من قسم استيراد النسخ الاحتياطية.
                </p>
              </div>
            </section>
          </CardBody>
        </Card>
        <Card className="relative lg:col-span-2">
          <CardHeader
            title="بيانات الاشتراك والضمان"
            subtitle="حالة الترخيص والضمان والتحديثات للنسخة الحالية"
            actions={(
              <Button size="sm" onClick={() => setLicenseDialogOpen(true)}>
                <KeyRound className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">إدارة الاشتراك والضمان</span>
                <span className="sm:hidden">إدارة الترخيص</span>
              </Button>
            )}
          />
          <CardBody className="space-y-3">
            <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            {/* ── Subscription ── */}
            <section className="flex flex-col gap-3 rounded-xl border border-brand-100 bg-brand-50/20 p-3.5 dark:border-brand-500/20 dark:bg-brand-500/[0.04]">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 text-sm font-bold text-brand-700 dark:text-brand-300">
                  <ShieldCheck className="h-4 w-4" />
                  <span>حالة الاشتراك</span>
                </div>
                <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-100 bg-emerald-50 px-2.5 py-1 text-[11px] font-bold text-emerald-700 dark:border-emerald-500/20 dark:bg-emerald-500/10 dark:text-emerald-400">
                  <span className="h-2 w-2 rounded-full bg-emerald-500" />
                  نشط ومفعل
                </span>
              </div>

              <div className={cn("grid grid-cols-2 gap-2", form.subscriptionType === "limited" ? "2xl:grid-cols-4" : "sm:grid-cols-3")}>
                <LicenseCell label="مدة الاشتراك" value={subscriptionDurationLabel(form.subscriptionType, form.subscriptionMonths)} />
                <LicenseCell label="الباقة الحالية" value={planDisplayLabel(licenseStatus?.license)} valueClass="text-brand-700 dark:text-brand-400" />
                <LicenseCell label="تاريخ التفعيل" value={form.subscriptionStartDate ? new Date(form.subscriptionStartDate).toLocaleDateString("ar-EG") : "غير محدد"} />
                {form.subscriptionType === "limited" && (
                  <LicenseCell label="الأيام المتبقية" valueClass="text-brand-600 dark:text-brand-400">
                    <span className="inline-flex items-center gap-1.5 text-sm font-mono font-bold text-brand-600 dark:text-brand-400 bg-brand-50 dark:bg-brand-500/10 border border-brand-100 dark:border-brand-500/20 px-2 py-0.5 rounded">
                      <Clock className="w-3 h-3" />
                      {Math.max(0, getRemainingDays(form.subscriptionStartDate, form.subscriptionMonths))} يوم
                    </span>
                  </LicenseCell>
                )}
              </div>
            </section>

            {/* ── Warranty ── */}
            <section className="flex flex-col gap-3 rounded-xl border border-indigo-100 bg-indigo-50/20 p-3.5 dark:border-indigo-500/20 dark:bg-indigo-500/[0.04]">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 text-sm font-bold text-indigo-700 dark:text-indigo-300">
                  <Clock className="h-4 w-4" />
                  <span>حالة الضمان والتحديثات</span>
                </div>
                <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-bold ${form.warrantyType === "none"
                  ? "text-ink-faint bg-surface-muted border-line-soft"
                  : "text-indigo-700 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-500/10 border-indigo-100 dark:border-indigo-500/20"}`}>
                  <span className={`h-2 w-2 rounded-full ${form.warrantyType === "none" ? "bg-slate-400" : "bg-indigo-500"}`} />
                  {form.warrantyType === "none" ? "غير مفعل" : "تحت الضمان الساري"}
                </span>
              </div>

              <div className={cn("grid grid-cols-2 gap-2", form.warrantyType === "limited" ? "2xl:grid-cols-4" : "sm:grid-cols-3")}>
                <LicenseCell label="مدة الضمان" value={form.warrantyType === "none" ? "بدون ضمان" : `${form.warrantyMonths} شهر فقط`} />
                {form.warrantyType === "limited" && (
                  <LicenseCell label="تاريخ البدء" value={form.warrantyStartDate ? new Date(form.warrantyStartDate).toLocaleDateString("ar-EG") : "غير محدد"} />
                )}
                <LicenseCell label="نوع الدعم" value={form.warrantyType === "none" ? "—" : "ضمان وتحديثات"} />
                <LicenseCell label="الأيام المتبقية">
                  <span className={`inline-flex items-center gap-1.5 text-sm font-mono font-bold px-2 py-0.5 rounded border ${form.warrantyType === "limited" && form.warrantyStartDate
                    ? "text-indigo-600 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-500/10 border-indigo-100 dark:border-indigo-500/20"
                    : "text-ink-faint bg-surface-muted border-line-soft"}`}>
                    <Clock className="w-3 h-3" />
                    {!form.warrantyStartDate && form.warrantyType === "limited" ? "تاريخ غير محدد" : (form.warrantyType === "limited" ? Math.max(0, getRemainingDays(form.warrantyStartDate, form.warrantyMonths)) : 0) + " يوم"}
                  </span>
                </LicenseCell>
              </div>
            </section>
            </div>

            <div className="flex flex-col gap-2 rounded-xl border border-line bg-surface-muted/45 p-2.5 lg:flex-row lg:items-center">
              <button
                type="button"
                onClick={copyMachineCode}
                title="نسخ كود الجهاز"
                className="flex min-w-0 items-center gap-2 rounded-lg border border-line bg-surface px-3 py-2 text-ink-muted transition-colors hover:border-brand-300 hover:text-brand-600 lg:w-[28rem]"
              >
                <span className="inline-flex shrink-0 items-center gap-1.5 text-[11px] font-bold">
                  <Copy className="h-3.5 w-3.5" /> كود الجهاز
                </span>
                <span dir="ltr" className="min-w-0 flex-1 truncate text-left font-mono text-[11px]">
                  {licenseStatus?.machineCode ?? "—"}
                </span>
              </button>
              <p className="flex-1 text-[11px] leading-5 text-ink-faint dark:text-slate-400">
                بيانات رسمية موثقة من <strong>Helpers Technologies</strong> ولا يمكن تعديلها من داخل النظام.
              </p>
            </div>

            {currentUser?.role === "owner" ? (
              <div className="rounded-xl border border-amber-200 bg-gradient-to-l from-amber-50/90 to-orange-50/60 p-4 dark:border-amber-500/25 dark:from-amber-500/10 dark:to-orange-500/[0.06]">
                <div className="flex flex-col gap-4 lg:flex-row lg:items-center">
                  <div className="flex min-w-0 flex-1 items-start gap-3">
                    <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300">
                      <Gift className="h-5 w-5" />
                    </span>
                    <div className="min-w-0">
                      <div className="font-bold text-amber-950 dark:text-amber-100">ادعُ صديقًا واحصل على عمولة 5%</div>
                      <p className="mt-1 text-xs leading-5 text-amber-900/70 dark:text-amber-200/70">
                        شارك رابطك مع صاحب محل جديد. بعد شراء النظام واعتماد العملية، تُسجّل عمولتك باسمك.
                      </p>
                    </div>
                  </div>

                  {referralInfo.state === "ready" ? (
                    <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-center">
                      <button
                        type="button"
                        onClick={copyReferralLink}
                        title="نسخ رابط الدعوة"
                        className="flex min-w-0 items-center gap-2 rounded-lg border border-amber-200 bg-surface px-3 py-2 text-amber-900 transition-colors hover:border-amber-400 dark:border-amber-500/30 dark:text-amber-200"
                      >
                        <span dir="ltr" className="font-mono text-xs font-bold">{referralInfo.code}</span>
                        <Copy className="h-3.5 w-3.5" />
                      </button>
                      <Button type="button" size="sm" className="gap-2 bg-emerald-600 hover:bg-emerald-700" onClick={shareReferralOnWhatsapp}>
                        <MessageCircle className="h-4 w-4" /> مشاركة على واتساب
                      </Button>
                      <Button type="button" size="sm" variant="outline" className="gap-2" onClick={() => setReferralHistoryOpen(true)}>
                        <Clock className="h-4 w-4" /> سجل العمولات
                      </Button>
                    </div>
                  ) : referralInfo.state === "loading" || referralInfo.state === "idle" ? (
                    <div className="flex items-center gap-2 text-xs font-semibold text-amber-800 dark:text-amber-300">
                      <RefreshCw className="h-4 w-4 animate-spin" /> جارِ تحميل كود الدعوة...
                    </div>
                  ) : (
                    <div className="flex max-w-sm items-center gap-2">
                      <span className="text-xs leading-5 text-amber-900/75 dark:text-amber-200/75">{referralInfo.error}</span>
                      <Button type="button" variant="outline" size="sm" onClick={() => void loadReferralInfo()}>
                        <RefreshCw className="h-3.5 w-3.5" /> إعادة المحاولة
                      </Button>
                    </div>
                  )}
                </div>

                {referralInfo.state === "ready" ? (
                  <div className="mt-4 grid grid-cols-2 gap-2 border-t border-amber-200/70 pt-4 dark:border-amber-500/20 sm:grid-cols-4">
                    <div className="rounded-lg border border-amber-200/70 bg-white/70 px-3 py-2 dark:border-amber-500/20 dark:bg-slate-950/25">
                      <div className="text-[10px] font-bold text-amber-900/60 dark:text-amber-200/60">إجمالي الدعوات</div>
                      <div className="mt-1 font-mono text-base font-black text-amber-950 dark:text-amber-100">{referralInfo.summary.totalReferrals}</div>
                    </div>
                    <div className="rounded-lg border border-amber-200/70 bg-white/70 px-3 py-2 dark:border-amber-500/20 dark:bg-slate-950/25">
                      <div className="text-[10px] font-bold text-amber-900/60 dark:text-amber-200/60">قيد المراجعة</div>
                      <div className="mt-1 font-mono text-sm font-black text-amber-700 dark:text-amber-300">{formatReferralMoney(referralInfo.summary.pendingMinor, referralInfo.currency)}</div>
                    </div>
                    <div className="rounded-lg border border-emerald-200/70 bg-white/70 px-3 py-2 dark:border-emerald-500/20 dark:bg-slate-950/25">
                      <div className="text-[10px] font-bold text-emerald-900/60 dark:text-emerald-200/60">مستحق للدفع</div>
                      <div className="mt-1 font-mono text-sm font-black text-emerald-700 dark:text-emerald-300">{formatReferralMoney(referralInfo.summary.approvedMinor, referralInfo.currency)}</div>
                    </div>
                    <div className="rounded-lg border border-blue-200/70 bg-white/70 px-3 py-2 dark:border-blue-500/20 dark:bg-slate-950/25">
                      <div className="text-[10px] font-bold text-blue-900/60 dark:text-blue-200/60">تم دفعه لك</div>
                      <div className="mt-1 font-mono text-sm font-black text-blue-700 dark:text-blue-300">{formatReferralMoney(referralInfo.summary.paidMinor, referralInfo.currency)}</div>
                    </div>
                  </div>
                ) : null}
              </div>
            ) : null}
          </CardBody>
        </Card>

        <Dialog
          open={mobileLinkDialogOpen}
          onClose={() => {
            if (mobilePairingLoading) return;
            setMobileLinkDialogOpen(false);
            // A device only appears once the phone redeems the code, so the
            // useful moment to re-read the list is when the owner closes this
            // dialog — typically right after pairing the handset.
            if (mobilePairingResult) setDeviceRefreshKey((key) => key + 1);
          }}
          title="إنشاء كود ربط آمن للهاتف"
          subtitle="يجب أن يستخدم صاحب الحساب بياناته وAuthenticator بنفسه"
          width="md"
          footer={
            mobilePairingResult ? (
              <Button type="button" onClick={() => setMobileLinkDialogOpen(false)}>تم</Button>
            ) : (
              <>
                <Button type="button" variant="outline" disabled={mobilePairingLoading} onClick={() => setMobileLinkDialogOpen(false)}>إلغاء</Button>
                <Button type="button" disabled={mobilePairingLoading} onClick={() => void createMobilePairing()}>
                  {mobilePairingLoading ? <RefreshCw className="h-4 w-4 animate-spin" /> : <KeyRound className="h-4 w-4" />}
                  {mobilePairingLoading ? "جارٍ التحقق…" : "إصدار الكود"}
                </Button>
              </>
            )
          }
        >
          <div className="space-y-4" dir="rtl">
            {mobilePairingResult ? (
              <div className="space-y-4">
                <div className="rounded-xl border border-emerald-200 bg-emerald-50/60 p-4 text-center dark:border-emerald-500/25 dark:bg-emerald-500/10">
                  <CheckCircle2 className="mx-auto h-7 w-7 text-emerald-600" />
                  <div className="mt-2 text-sm font-bold text-ink">تم إصدار كود الربط</div>
                  <div className="mt-1 text-xs text-ink-muted">صالح لمرة واحدة حتى {new Date(mobilePairingResult.expiresAt).toLocaleTimeString("ar-EG", { hour: "numeric", minute: "2-digit" })}</div>
                </div>
                <div className="flex items-stretch gap-2" dir="ltr">
                  <div className="flex min-h-14 flex-1 items-center justify-center rounded-xl border border-brand-300 bg-brand-50 px-4 font-mono text-xl font-black tracking-[0.18em] text-brand-800 dark:border-brand-500/40 dark:bg-brand-500/10 dark:text-brand-200">
                    {mobilePairingResult.activationCode}
                  </div>
                  <Button type="button" variant="outline" onClick={() => void copyMobilePairingCode()} aria-label="نسخ كود التفعيل">
                    <Copy className="h-4 w-4" />
                  </Button>
                </div>
                <div className="rounded-xl border border-amber-200 bg-amber-50/55 p-3 text-xs leading-6 text-amber-900 dark:border-amber-500/25 dark:bg-amber-500/10 dark:text-amber-200">
                  لا ترسل كلمة المرور أو كود 2FA لأي شخص. افتح PartFlow واكتب هذا الكود مع بيانات الحساب، وانتظر كود Authenticator التالي بدل إعادة استخدام الكود الذي أصدرت به الربط.
                </div>
              </div>
            ) : (
              <>
                <Field label="اسم الجهاز" hint="اسم اختياري يساعدك على معرفة الهاتف المرتبط">
                  <Input value={mobileDeviceLabel} maxLength={80} onChange={(event) => setMobileDeviceLabel(event.target.value)} placeholder="مثال: iPhone الإدارة" />
                </Field>
                <Field label="كلمة مرور حسابك">
                  <Input type="password" autoComplete="current-password" value={mobilePassword} onChange={(event) => setMobilePassword(event.target.value)} placeholder="كلمة مرور المالك أو المشرف" />
                </Field>
                <Field label="كود Authenticator الحالي" hint="الكود المكوّن من 6 أرقام في تطبيق المصادقة">
                  <Input
                    dir="ltr"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    maxLength={6}
                    value={mobileTotpCode}
                    onChange={(event) => setMobileTotpCode(event.target.value.replace(/\D/g, "").slice(0, 6))}
                    placeholder="000000"
                    className="font-mono tracking-[0.35em]"
                  />
                </Field>
                {mobilePairingError ? (
                  <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50/60 p-3 text-sm text-rose-700 dark:border-rose-500/25 dark:bg-rose-500/10 dark:text-rose-300">
                    {mobilePairingError}
                  </div>
                ) : null}
              </>
            )}
          </div>
        </Dialog>

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

        <Dialog
          open={lockedFeature !== null}
          onClose={() => setLockedFeature(null)}
          title={lockedFeature ? `تفعيل ${lockedFeature.label}` : "تفعيل ميزة مدفوعة"}
          subtitle="يمكنك طلبها كإضافة مستقلة أو ضمن ترقية الباقة"
          width="md"
          footer={
            <>
              <Button type="button" variant="outline" onClick={() => setLockedFeature(null)}>لاحقًا</Button>
              <Button type="button" className="bg-emerald-600 hover:bg-emerald-700" onClick={openFeatureUpgradeWhatsapp}>
                <MessageCircle className="w-4 h-4" /> التواصل مع المطوّر
              </Button>
            </>
          }
        >
          {lockedFeature ? (
            <div className="space-y-4" dir="rtl">
              <div className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 dark:border-amber-500/30 dark:bg-amber-500/10">
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300">
                  <Lock className="h-5 w-5" />
                </span>
                <div>
                  <div className="font-bold text-amber-950 dark:text-amber-100">هذه الميزة غير مفعّلة في الترخيص الحالي</div>
                  <p className="mt-1 text-sm leading-6 text-amber-900/80 dark:text-amber-200/80">{lockedFeature.description}</p>
                </div>
              </div>
              <div className="rounded-xl border border-line bg-surface-muted/50 p-3 text-sm leading-7 text-ink-muted">
                أرسل الطلب للمطوّر وسيصل معه اسم الميزة وكود الجهاز تلقائيًا. يمكنك اختيار شراء الميزة كـ Add-on أو ترقية الباقة، دون إعادة تثبيت النظام أو فقد البيانات.
              </div>
            </div>
          ) : null}
        </Dialog>

        <Card className="lg:col-span-1">
          <CardHeader title="النسخة الاحتياطية" subtitle="حفظ واستعادة كل بيانات النظام" />
          <CardBody className="space-y-4">
            <div className="flex flex-col gap-2">
              <Input
                type="password"
                value={backupPassphrase}
                onChange={(e) => setBackupPassphrase(e.target.value)}
                placeholder="كلمة سر النسخة (اختياري — للتصدير/الاستعادة اليدوية)"
                className="text-xs"
                autoComplete="new-password"
              />
              <Button
                onClick={async () => {
                  const ok = await exportBackup(backupPassphrase.trim() || undefined);
                  if (!ok) toast.error("فشل تشفير النسخة الاحتياطية — لم يتم إنشاء أي ملف");
                }}
                variant="outline"
                className="w-full justify-start"
              >
                <Download className="w-4 h-4" /> تصدير نسخة احتياطية (Backup)
              </Button>
              <div className="relative">
                <input
                  type="file"
                  accept=".json,.hwbak"
                  className="absolute inset-0 opacity-0 cursor-pointer"
                  onChange={async (e) => {
                    const file = e.target.files?.[0];
                    e.target.value = ""; // allow re-selecting the same file after an error
                    if (!file) return;
                    const pass = backupPassphrase.trim() || undefined;
                    // Peek the envelope so we can give a precise message and skip
                    // a pointless decrypt when a passphrase is required but empty.
                    let isProtected = false;
                    try {
                      const head = JSON.parse(await file.text());
                      isProtected = head?.enc === "aes-256-gcm" && head?.v === 2;
                    } catch {
                      /* plain or non-JSON — importBackup handles it */
                    }
                    if (isProtected && !pass) {
                      toast.error("هذه النسخة محمية بكلمة سر — اكتبها في الحقل أعلاه ثم أعد الاستيراد");
                      return;
                    }
                    setPendingRestore({ file, pass, isProtected });
                  }}
                />
                <Button variant="outline" className="w-full justify-start">
                  <Upload className="w-4 h-4" /> استيراد نسخة احتياطية (Restore)
                </Button>
              </div>
            </div>
            <p className="text-[11px] text-ink-faint">
              يتم تصدير ملف يحتوي على كافة الفواتير، المنتجات، والعملاء. لو كتبت كلمة سر
              فستُشفَّر النسخة بها ولن تُستعاد إلا بنفس الكلمة — احفظها في مكان آمن.
            </p>
            <div className="pt-2 border-t border-line-soft">
              <Button
                variant="outline"
                size="sm"
                className="w-full text-blue-600 dark:text-blue-400 border-blue-200 dark:border-blue-500/30 bg-blue-50 dark:bg-blue-500/10 hover:bg-blue-100 dark:hover:bg-blue-500/20"
                onClick={() => {
                  const data = lsGet<unknown | null>("inventory_auto_backup_internal", null);
                  if (data) {
                    setPendingInternalRestore(true);
                  } else {
                    toast.error("لا توجد نسخة تلقائية مخزنة حالياً");
                  }
                }}
              >
                <Database className="w-3.5 h-3.5" /> استعادة من النسخة التلقائية الداخلية
              </Button>
            </div>
          </CardBody>
        </Card>

        <Card className="lg:col-span-1">
          <CardHeader title="تصدير البيانات (Excel)" subtitle="تصدير جداول البيانات إلى ملفات Excel منفصلة" />
          <CardBody className="grid grid-cols-2 gap-2">
            {!excelExportEnabled && (
              <div className="col-span-2">
                <PaidFeatureNotice title="تصدير البيانات إلى Excel" featureKey="excelExport" />
              </div>
            )}
            <Button disabled={!excelExportEnabled} onClick={() => exportToExcel("products")} variant="outline" size="sm" className="justify-start">
              <FileSpreadsheet className="w-4 h-4" /> المنتجات
            </Button>
            <Button disabled={!excelExportEnabled} onClick={() => exportToExcel("customers")} variant="outline" size="sm" className="justify-start">
              <FileSpreadsheet className="w-4 h-4" /> العملاء
            </Button>
            <Button disabled={!excelExportEnabled} onClick={() => exportToExcel("suppliers")} variant="outline" size="sm" className="justify-start">
              <FileSpreadsheet className="w-4 h-4" /> الموردين
            </Button>
            <Button disabled={!excelExportEnabled} onClick={() => exportToExcel("sales")} variant="outline" size="sm" className="justify-start">
              <FileSpreadsheet className="w-4 h-4" /> المبيعات
            </Button>
            <Button disabled={!excelExportEnabled} onClick={() => exportToExcel("purchases")} variant="outline" size="sm" className="justify-start">
              <FileSpreadsheet className="w-4 h-4" /> المشتريات
            </Button>
          </CardBody>
        </Card>
        <Dialog
          open={previewOpen}
          onClose={() => setPreviewOpen(false)}
          title="معاينة مظهر الفاتورة والرسائل"
          subtitle="مظهر تجريبي للفاتورة والرسالة عند الطباعة أو المشاركة"
          width="xl"
        >
          <div className="flex flex-col gap-4">
            {/* Tabs */}
            <div className="flex border-b border-line">
              <button
                type="button"
                onClick={() => setPreviewTab("invoice")}
                className={cn(
                  "px-4 py-2 text-sm font-semibold border-b-2 -mb-px transition-colors",
                  previewTab === "invoice"
                    ? "border-brand-600 text-brand-600 dark:text-brand-400 dark:border-brand-400"
                    : "border-transparent text-ink-muted hover:text-ink"
                )}
              >
                معاينة الفاتورة المطبوعة ({form.printPaperSize})
              </button>
              <button
                type="button"
                onClick={() => setPreviewTab("whatsapp")}
                className={cn(
                  "px-4 py-2 text-sm font-semibold border-b-2 -mb-px transition-colors",
                  previewTab === "whatsapp"
                    ? "border-brand-600 text-brand-600 dark:text-brand-400 dark:border-brand-400"
                    : "border-transparent text-ink-muted hover:text-ink"
                )}
              >
                معاينة رسالة واتساب للفاتورة
              </button>
            </div>

            {/* Tab content */}
            <div className="min-h-[300px]">
              {previewTab === "invoice" ? (
                <div className="bg-slate-100 dark:bg-slate-900 rounded-lg p-6 flex justify-center overflow-x-auto">
                  {/* Mock Paper A4/A5 size */}
                  <div
                    className={cn(
                      "bg-white text-slate-900 p-8 shadow-md border border-slate-200 rounded text-xs select-none",
                      form.printPaperSize === "A4" ? "w-[595px]" : "w-[420px]"
                    )}
                    dir="rtl"
                  >
                    {/* Header */}
                    <div className="flex justify-between items-start border-b border-slate-300 pb-4 mb-4">
                      <div>
                        <div className="font-bold text-base text-slate-800">{form.companyNameAr || "اسم الشركة بالعربية"}</div>
                        {form.companyName && (
                          <div className="text-[10px] text-slate-500 font-mono" dir="ltr">{form.companyName}</div>
                        )}
                        <div className="text-[10px] text-slate-600 mt-1">صاحب المحل: {form.ownerName || "عمر أحمد"}</div>
                        <div className="text-[10px] text-slate-600">الموبايل: {form.ownerPhone || "01118445625"}</div>
                      </div>
                      <div className="text-left">
                        <div className="font-bold text-slate-800">فاتورة مبيعات مبسطة</div>
                        <div className="text-[10px] text-slate-500">الرقم: INV-2026-0042</div>
                        <div className="text-[10px] text-slate-500">التاريخ: 2026-07-21</div>
                      </div>
                    </div>

                    {/* Customer Info */}
                    <div className="mb-4 bg-slate-50 p-2 rounded border border-slate-100 flex justify-between">
                      <div>
                        <span className="font-bold text-slate-700">العميل:</span> جلال محمد
                      </div>
                      <div>
                        <span className="font-bold text-slate-700">طريقة الدفع:</span> نقدي
                      </div>
                    </div>

                    {/* Table */}
                    <table className="w-full text-[10px] text-right border-collapse mb-4">
                      <thead>
                        <tr className="border-b border-slate-300 font-bold text-slate-700 bg-slate-50">
                          <th className="py-1 px-1">#</th>
                          <th className="py-1 px-1">البيان</th>
                          <th className="py-1 px-1 text-center">الكمية</th>
                          <th className="py-1 px-1 text-left">السعر</th>
                          <th className="py-1 px-1 text-left">الإجمالي</th>
                        </tr>
                      </thead>
                      <tbody>
                        <tr className="border-b border-slate-100">
                          <td className="py-1 px-1">1</td>
                          <td className="py-1 px-1">تيل فرامل خلفي كوري</td>
                          <td className="py-1 px-1 text-center">1</td>
                          <td className="py-1 px-1 text-left">450.00 ج.م</td>
                          <td className="py-1 px-1 text-left">450.00 ج.م</td>
                        </tr>
                        <tr className="border-b border-slate-100">
                          <td className="py-1 px-1">2</td>
                          <td className="py-1 px-1">طنبورة فرامل أمامية ياباني</td>
                          <td className="py-1 px-1 text-center">2</td>
                          <td className="py-1 px-1 text-left">400.00 ج.م</td>
                          <td className="py-1 px-1 text-left">800.00 ج.م</td>
                        </tr>
                      </tbody>
                    </table>

                    {/* Totals */}
                    <div className="flex justify-end mb-6">
                      <div className="w-1/2 space-y-1 text-[10px]">
                        <div className="flex justify-between border-b border-slate-100 pb-0.5">
                          <span className="text-slate-500">الإجمالي الفرعي:</span>
                          <span>1,250.00 ج.م</span>
                        </div>
                        <div className="flex justify-between border-b border-slate-100 pb-0.5 font-bold text-slate-800">
                          <span>الإجمالي النهائي:</span>
                          <span>1,250.00 ج.م</span>
                        </div>
                        <div className="flex justify-between text-emerald-600">
                          <span>المدفوع:</span>
                          <span>1,250.00 ج.م</span>
                        </div>
                        <div className="flex justify-between text-slate-400">
                          <span>المتبقي:</span>
                          <span>0.00 ج.م</span>
                        </div>
                      </div>
                    </div>

                    {/* Footer Text */}
                    {form.invoiceFooter && (
                      <div className="border-t border-slate-200 pt-3 text-center text-[10px] text-slate-500 font-medium whitespace-pre-line">
                        {form.invoiceFooter}
                      </div>
                    )}
                  </div>
                </div>
              ) : (
                <div className="bg-slate-100 dark:bg-slate-900 rounded-lg p-6 flex justify-center">
                  {/* Mock WhatsApp Chat */}
                  <div className="w-full max-w-md bg-[#efeae2] dark:bg-[#0b141a] rounded-xl shadow-inner border border-line overflow-hidden flex flex-col h-[380px]">
                    {/* Header */}
                    <div className="bg-[#008069] dark:bg-[#1f2c34] text-white px-4 py-3 flex items-center gap-3">
                      <div className="w-9 h-9 bg-slate-300 dark:bg-slate-700 rounded-full flex items-center justify-center font-bold text-slate-600 dark:text-slate-300">
                        {form.companyNameAr?.trim() ? form.companyNameAr.trim().slice(0, 2) : "AP"}
                      </div>
                      <div>
                        <div className="font-bold text-sm">{form.companyNameAr || "اسم الشركة"}</div>
                        <div className="text-[10px] opacity-80">متصل الآن</div>
                      </div>
                    </div>

                    {/* Messages Body */}
                    <div className="flex-1 p-4 overflow-y-auto flex flex-col justify-end">
                      <div
                        className="bg-white dark:bg-[#202c33] text-slate-800 dark:text-slate-200 p-3 rounded-lg shadow-sm max-w-[85%] self-start relative text-xs whitespace-pre-wrap leading-relaxed"
                        dir="rtl"
                      >
                        {(() => {
                          const companyName = form.companyNameAr?.trim() || "اسم الشركة";
                          const ownerPhone = form.ownerPhone?.trim() || "رقم الموبايل";
                          const mockValues = {
                            "{partyName}": "جلال محمد",
                            "{invoiceNumber}": "INV-2026-0042",
                            "{invoiceType}": "مبيعات",
                            "{date}": "2026-07-21",
                            "{total}": "1,250.00",
                            "{paid}": "1,250.00",
                            "{remaining}": "0.00",
                            "{companyName}": companyName,
                            "{phone}": ownerPhone,
                            "{driverName}": "أحمد علي",
                            "{priceType}": "تجزئة",
                            "{paymentMethod}": "نقدي",
                            "{partyLabel}": "العميل",
                            "{status}": "مدفوع"
                          };
                          
                          let text = form.whatsappInvoiceTemplate || DEFAULT_INVOICE_WHATSAPP_TEMPLATE;
                          Object.entries(mockValues).forEach(([tag, val]) => {
                            const regex = new RegExp(tag.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&'), 'g');
                            text = text.replace(regex, val);
                          });
                          
                          return text;
                        })()}
                        <div className="text-[9px] text-slate-400 dark:text-slate-500 text-left mt-1">١٢:٠٠ م</div>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </Dialog>
      </div>

      <Dialog
        open={cloudPassphraseDialogOpen}
        onClose={() => { if (!cloudArchiveBusy) setCloudPassphraseDialogOpen(false); }}
        title="كلمة سر النسخة السحابية"
        subtitle="تُستخدم لتشفير بيانات المتجر قبل رفعها — لا أحد غيرك يستطيع فتحها"
        width="sm"
        footer={
          <div className="flex gap-2">
            <Button type="button" disabled={cloudArchiveBusy} onClick={() => void saveCloudPassphrase()}>
              {cloudArchiveBusy ? "جارٍ الحفظ…" : "حفظ وبدء الرفع"}
            </Button>
            <Button type="button" variant="outline" disabled={cloudArchiveBusy} onClick={() => setCloudPassphraseDialogOpen(false)}>إلغاء</Button>
          </div>
        }
      >
        <div className="space-y-3">
          <div className="rounded-xl border border-amber-200 bg-amber-50/60 p-3 text-xs leading-6 text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
            لو نسيت كلمة السر دي مفيش طريقة لاسترجاع النسخة السحابية — لا نحن ولا أي حد تاني يقدر يفكها. اكتبها واحتفظ بيها في مكان آمن.
          </div>
          <Field label="كلمة مرور حسابك" hint="لتأكيد أنك صاحب الحساب">
            <Input type="password" value={cloudAccountPassword} onChange={(e) => setCloudAccountPassword(e.target.value)} autoComplete="current-password" />
          </Field>
          <Field label="كلمة سر النسخة السحابية" hint="12 حرفًا على الأقل">
            <Input type="password" value={cloudPassphrase} onChange={(e) => setCloudPassphrase(e.target.value)} autoComplete="new-password" />
          </Field>
          <Field label="تأكيد كلمة سر النسخة">
            <Input type="password" value={cloudPassphraseConfirm} onChange={(e) => setCloudPassphraseConfirm(e.target.value)} autoComplete="new-password" />
          </Field>
          {cloudPassphraseError && (
            <div className="rounded-lg bg-rose-50 p-3 text-sm text-rose-700 dark:bg-rose-500/10 dark:text-rose-300">{cloudPassphraseError}</div>
          )}
        </div>
      </Dialog>

      <Dialog
        open={cloudRestoreDialogOpen}
        onClose={() => { if (!cloudArchiveBusy) setCloudRestoreDialogOpen(false); }}
        title="استعادة من النسخة السحابية"
        subtitle="اكتب كلمة سر النسخة لعرض تفاصيلها قبل الاستبدال"
        width="sm"
        footer={
          <div className="flex gap-2">
            {cloudRestorePreview ? (
              <Button type="button" variant="danger" disabled={cloudArchiveBusy} onClick={() => void confirmCloudRestore()}>
                {cloudArchiveBusy ? "جارٍ الاستعادة…" : "استبدال كل البيانات"}
              </Button>
            ) : (
              <Button type="button" disabled={cloudArchiveBusy || !cloudRestorePassphrase} onClick={() => void previewCloudRestore()}>
                {cloudArchiveBusy ? "جارٍ الفحص…" : "فحص النسخة"}
              </Button>
            )}
            <Button type="button" variant="outline" disabled={cloudArchiveBusy} onClick={() => setCloudRestoreDialogOpen(false)}>إلغاء</Button>
          </div>
        }
      >
        <div className="space-y-3">
          <Field label="كلمة سر النسخة السحابية">
            <Input
              type="password"
              value={cloudRestorePassphrase}
              onChange={(e) => { setCloudRestorePassphrase(e.target.value); setCloudRestorePreview(null); }}
              autoComplete="off"
            />
          </Field>
          {cloudRestorePreview && (
            <div className="rounded-xl border border-brand-200 bg-brand-50/45 p-3 text-xs leading-6 text-ink dark:border-brand-500/25 dark:bg-brand-500/10">
              <div className="font-bold">تم فتح النسخة بنجاح</div>
              <div className="mt-1 text-ink-muted">
                تاريخ النسخة: {formatDeviceMoment(cloudRestorePreview.capturedAt)}
                {cloudRestorePreview.appVersion ? ` · إصدار ${cloudRestorePreview.appVersion}` : ""}
                {` · ${cloudRestorePreview.keyCount} مجموعة بيانات`}
              </div>
              <div className="mt-2 text-rose-700 dark:text-rose-300">
                الاستعادة هتستبدل كل بيانات المتجر الحالية نهائيًا ولا يمكن التراجع عنها.
              </div>
            </div>
          )}
          {cloudRestoreError && (
            <div className="rounded-lg bg-rose-50 p-3 text-sm text-rose-700 dark:bg-rose-500/10 dark:text-rose-300">{cloudRestoreError}</div>
          )}
        </div>
      </Dialog>

      <ConfirmDialog
        open={devicePendingRevoke !== null}
        onClose={() => setDevicePendingRevoke(null)}
        title="إلغاء ربط الجهاز"
        message={
          devicePendingRevoke
            ? `سيتم إنهاء جلسة "${devicePendingRevoke.deviceName}" ونسيان الجهاز تمامًا. للدخول مرة أخرى سيحتاج كود ربط جديد من هذه الصفحة.`
            : ""
        }
        confirmText="إلغاء الربط"
        variant="danger"
        onConfirm={async () => {
          if (devicePendingRevoke) await revokeMobileDevice(devicePendingRevoke, false);
        }}
      />

      <ConfirmDialog
        open={pendingRestore !== null}
        onClose={() => setPendingRestore(null)}
        title="استعادة نسخة احتياطية"
        message="هذا الإجراء سيستبدل كل البيانات الحيّة الحالية (فواتير، منتجات، عملاء، ...) ببيانات الملف المستورد نهائيًا ولا يمكن التراجع عنه. هل أنت متأكد؟"
        confirmText="استبدال كل البيانات"
        variant="danger"
        onConfirm={async () => {
          if (!pendingRestore) return;
          const { file, pass, isProtected } = pendingRestore;
          setPendingRestore(null);
          const ok = await importBackup(file, pass);
          if (ok) {
            toast.success("تم الاستعادة — جاري إعادة التشغيل...");
            setTimeout(() => window.location.reload(), 900);
          } else {
            toast.error(
              isProtected
                ? "تعذر فك النسخة — تأكد من كلمة السر"
                : "فشل استيراد الملف، تأكد من صحته"
            );
          }
        }}
      />

      <ConfirmDialog
        open={pendingInternalRestore}
        onClose={() => setPendingInternalRestore(false)}
        title="استعادة من النسخة التلقائية الداخلية"
        message="هذا الإجراء سيستبدل كل البيانات الحيّة الحالية بآخر نسخة تلقائية داخلية محفوظة، ولا يمكن التراجع عنه. هل أنت متأكد؟"
        confirmText="استبدال كل البيانات"
        variant="danger"
        onConfirm={async () => {
          setPendingInternalRestore(false);
          const data = lsGet<unknown | null>("inventory_auto_backup_internal", null);
          if (!data) {
            toast.error("لا توجد نسخة تلقائية مخزنة حالياً");
            return;
          }
          const file = new File([JSON.stringify(data)], "internal_backup.json", { type: "application/json" });
          const ok = await importBackup(file);
          if (ok) {
            toast.success("تم الاستعادة — جاري إعادة التشغيل...");
            setTimeout(() => window.location.reload(), 900);
          } else {
            toast.error("فشل استيراد النسخة الداخلية");
          }
        }}
      />

      <Dialog
        open={clearLogsDialogOpen}
        onClose={() => setClearLogsDialogOpen(false)}
        title="مسح سجل النشاط والعمليات"
      >
        <div className="space-y-4 text-sm" dir="rtl">
          <p className="text-ink-muted">
            اختر النطاق الزمني للعمليات المراد حذفها نهائياً من سجل النشاط:
          </p>

          <Field label="نطاق المسح الزمني">
            <Select
              value={String(clearLogsDays)}
              onChange={(e) => setClearLogsDays(Number(e.target.value))}
            >
              <option value="0">مسح السجل بالكامل (جميع العمليات)</option>
              <option value="14">مسح العمليات الأقدم من أسبوعين (14 يوم)</option>
              <option value="30">مسح العمليات الأقدم من شهر (30 يوم)</option>
              <option value="90">مسح العمليات الأقدم من 3 أشهر (90 يوم)</option>
              <option value="180">مسح العمليات الأقدم من 6 أشهر (180 يوم)</option>
              <option value="365">مسح العمليات الأقدم من سنة (365 يوم)</option>
            </Select>
          </Field>

          <div className="flex items-center justify-end gap-2 pt-3 border-t border-line">
            <Button variant="outline" onClick={() => setClearLogsDialogOpen(false)}>
              إلغاء
            </Button>
            <Button
              variant="danger"
              onClick={() => {
                clearAuditLogs(clearLogsDays);
                setClearLogsDialogOpen(false);
                const label = clearLogsDays === 0
                  ? "تم مسح سجل النشاط بالكامل"
                  : `تم مسح العمليات الأقدم من ${clearLogsDays} يوم`;
                toast.success("تنظيف سجل النشاط", label);
              }}
            >
              <Trash2 className="w-4 h-4 me-1.5 shrink-0" />
              تأكيد المسح الآن
            </Button>
          </div>
        </div>
      </Dialog>
    </>
  );
}
