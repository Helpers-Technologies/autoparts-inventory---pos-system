import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Bot,
  ChevronDown,
  ExternalLink,
  KeyRound,
  Link2,
  Link2Off,
  LogOut,
  MessageCircle,
  PackageCheck,
  RefreshCw,
  Settings2,
  Smartphone,
  TabletSmartphone,
  CheckCircle2,
  ShieldAlert,
  Copy,
} from "lucide-react";
import { PageHeader } from "../components/layout/AppLayout";
import { Card, CardBody, CardHeader } from "../components/ui/Card";
import { Badge } from "../components/ui/Badge";
import { Button } from "../components/ui/Button";
import { Field, Input, Select } from "../components/ui/Input";
import { ConfirmDialog, Dialog } from "../components/ui/Dialog";
import { BOSTA_PROVIDER_ID, useShipping } from "../store/ShippingContext";
import { useToast } from "../components/ui/Toast";
import type { DeliveryOrder } from "../types";
import { bostaLogo } from "../assets/bosta-logo";
import {
  bostaPublicTrackingUrl,
  bostaStatus,
  translateBostaError,
} from "../lib/shipping";
import { formatDate, formatDateTime } from "../lib/format";
import { cn } from "../lib/utils";
import { useApp } from "../store/AppContext";
import { PaidFeatureNotice } from "../components/PaidFeatureNotice";
import type { LinkedMobileDevice } from "../types/desktop";

const DEFAULT_BOSTA_WEBHOOK_URL =
  "https://api-partflow.helpers-tech.com/v1/bosta/webhook";

function integrationError(error?: string): string {
  return translateBostaError(error);
}

function withTimeout<T>(operation: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(
      () => reject(new Error("operation_timeout")),
      timeoutMs,
    );
    operation.then(
      (value) => {
        window.clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        window.clearTimeout(timer);
        reject(error);
      },
    );
  });
}

function secureRelayToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

type TrackingTimelineItem = {
  key: string;
  label: string;
  occurredAt?: string;
  location?: string;
  note?: string;
};

type TrackingSummary = {
  trackingNumber: string;
  status: string;
  updatedAt?: string;
  promisedDate?: string;
  createdAt?: string;
  provider?: string;
  supportPhones: string[];
  editable?: boolean;
  attempts?: number;
  timeline: TrackingTimelineItem[];
};

function nestedValue(source: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((value, key) => {
    if (!value || typeof value !== "object") return undefined;
    return (value as Record<string, unknown>)[key];
  }, source);
}

function firstValue(source: unknown, paths: string[]): unknown {
  for (const path of paths) {
    const value = nestedValue(source, path);
    if (value !== undefined && value !== null && value !== "") return value;
  }
  return undefined;
}

function firstText(source: unknown, paths: string[]): string | undefined {
  const value = firstValue(source, paths);
  if (typeof value !== "string" && typeof value !== "number") return undefined;
  const clean = String(value).trim();
  return clean || undefined;
}

function firstNumber(source: unknown, paths: string[]): number | undefined {
  for (const path of paths) {
    const raw = nestedValue(source, path);
    if (raw === undefined || raw === null || raw === "") continue;
    const value = Number(raw);
    if (Number.isFinite(value)) return value;
  }
  return undefined;
}

function firstBoolean(source: unknown, paths: string[]): boolean | undefined {
  const value = firstValue(source, paths);
  return typeof value === "boolean" ? value : undefined;
}

function stringList(source: unknown, paths: string[]): string[] {
  const value = firstValue(source, paths);
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => String(item ?? "").trim())
    .filter(Boolean);
}

function arabicTrackingNote(value: string | undefined): string | undefined {
  if (!value) return undefined;
  if (/Postponed/i.test(value)) return "تم تأجيل التسليم بناءً على طلب العميل";
  if (/not answering/i.test(value)) return "تعذر التواصل مع العميل";
  if (/changed the address/i.test(value)) return "طلب العميل تغيير عنوان التسليم";
  if (/wrong phone/i.test(value)) return "رقم هاتف العميل غير صحيح";
  if (/outside.*coverage/i.test(value)) return "العنوان خارج نطاق التغطية";
  if (/refus/i.test(value)) return "رفض العميل استلام الشحنة";
  if (/not (in|at) the address/i.test(value)) return "العميل غير موجود في العنوان";
  if (/address.*not clear/i.test(value)) return "عنوان التسليم غير واضح";
  if (/bad weather/i.test(value)) return "تعذر التنفيذ بسبب ظروف الطقس";
  if (/damaged/i.test(value)) return "تم تسجيل تلف في الشحنة";
  return /[\u0600-\u06ff]/.test(value)
    ? value
    : "توجد ملاحظة مسجلة على محاولة التسليم";
}

function trackingProviderLabel(value: string | undefined): string {
  if (!value || /bosta/i.test(value)) return "بوسطه";
  return value;
}

function asIsoDate(value: unknown): string | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  const numeric = typeof value === "number" ? value : Number.NaN;
  const date = new Date(
    Number.isFinite(numeric) && numeric < 1_000_000_000_000
      ? numeric * 1000
      : (value as string | number),
  );
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

function arabicBostaStatus(code: number | undefined): string {
  return bostaStatus(code).label.replace(/Bosta/g, "بوسطه");
}

function trackingSummary(data: unknown, fallback: string): TrackingSummary {
  const code = firstNumber(data, [
    "state",
    "data.state",
    "delivery.state",
    "currentStatus.code",
    "data.currentStatus.code",
    "CurrentStatus.code",
  ]);
  const historyPaths = [
    "history",
    "data.history",
    "stateHistory",
    "data.stateHistory",
    "events",
    "data.events",
    "delivery.history",
    "TransitEvents",
  ];
  const history = historyPaths
    .map((path) => nestedValue(data, path))
    .find(Array.isArray) as unknown[] | undefined;
  const timeline = (history ?? [])
    .map((item, index): TrackingTimelineItem | undefined => {
      const itemCode = firstNumber(item, ["state", "code", "status.code"]);
      const occurredAt = asIsoDate(
        firstValue(item, [
          "timeStamp",
          "timestamp",
          "createdAt",
          "updatedAt",
          "date",
        ]),
      );
      if (itemCode === undefined && !occurredAt) return undefined;
      return {
        key: `${itemCode ?? "event"}-${occurredAt ?? index}`,
        label: arabicBostaStatus(itemCode),
        occurredAt,
        location: firstText(item, ["hub", "hubName", "location"]),
        note: arabicTrackingNote(
          firstText(item, ["reason", "exceptionReason", "note"]),
        ),
      };
    })
    .filter((item): item is TrackingTimelineItem => Boolean(item))
    .filter(
      (item, index, items) =>
        items.findIndex(
          (candidate) =>
            candidate.label === item.label &&
            candidate.occurredAt === item.occurredAt,
        ) === index,
    )
    .sort((left, right) =>
      String(right.occurredAt ?? "").localeCompare(left.occurredAt ?? ""),
    );
  const updatedAt = asIsoDate(
    firstValue(data, [
      "updatedAt",
      "data.updatedAt",
      "timeStamp",
      "data.timeStamp",
      "delivery.updatedAt",
      "CurrentStatus.timestamp",
    ]),
  );
  if (!timeline.length) {
    timeline.push({
      key: `current-${code ?? "unknown"}`,
      label: arabicBostaStatus(code),
      occurredAt: updatedAt,
    });
  }
  return {
    trackingNumber:
      firstText(data, [
        "trackingNumber",
        "data.trackingNumber",
        "delivery.trackingNumber",
        "TrackingNumber",
      ]) ?? fallback,
    status: arabicBostaStatus(code),
    updatedAt,
    promisedDate: asIsoDate(
      firstValue(data, [
        "deliveryPromiseDate",
        "data.deliveryPromiseDate",
        "delivery.deliveryPromiseDate",
        "PromisedDate",
      ]),
    ),
    createdAt: asIsoDate(
      firstValue(data, ["CreateDate", "createDate", "createdAt"]),
    ),
    provider: trackingProviderLabel(
      firstText(data, ["provider", "Provider", "carrierName"]),
    ),
    supportPhones: stringList(data, [
      "SupportPhoneNumbers",
      "supportPhoneNumbers",
    ]),
    editable: firstBoolean(data, ["isEditableShipment", "editable"]),
    attempts: firstNumber(data, [
      "numberOfAttempts",
      "data.numberOfAttempts",
      "delivery.numberOfAttempts",
    ]),
    timeline,
  };
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Mobile Devices - ربط تطبيق PartFlow للهاتف
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const DEVICE_PLATFORM_ICONS = {
  android: Smartphone,
  ios: Smartphone,
  web: TabletSmartphone,
  windows: Smartphone,
  macos: Smartphone,
  linux: Smartphone,
} as const;

const DEVICE_PLATFORM_LABELS: Record<string, string> = {
  android: "أندرويد",
  ios: "آيفون / آيباد",
  web: "متصفح",
  windows: "ويندوز",
  macos: "ماك",
  linux: "لينكس",
};

function formatDeviceMoment(value: string | null): string {
  if (!value) return "—";
  const time = Date.parse(value);
  if (Number.isNaN(time)) return "—";
  const date = new Date(time);
  const days = Math.floor((Date.now() - time) / 86_400_000);
  const ago =
    days === 0 ? "اليوم" :
    days === 1 ? "أمس" :
    days < 7 ? `منذ ${days} أيام` :
    days < 30 ? `منذ ${Math.floor(days / 7)} أسابيع` :
    days < 365 ? `منذ ${Math.floor(days / 30)} شهر` :
    `منذ ${Math.floor(days / 365)} سنة`;
  return `${date.toLocaleDateString("ar-EG", { month: "short", day: "numeric", year: "numeric" })} (${ago})`;
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

export function IntegrationsPage() {
  const navigate = useNavigate();
  const {
    orders,
    updateOrder,
    bostaConfig,
    saveBostaConfig,
    testBostaConnection,
  } = useShipping();
  const toast = useToast();
  const [apiKey, setApiKey] = useState("");
  const [enabled, setEnabled] = useState(false);
  const [autoTrackingEnabled, setAutoTrackingEnabled] = useState(true);
  const [autoTrackingIntervalMinutes, setAutoTrackingIntervalMinutes] =
    useState(5);
  const [businessLocationId, setBusinessLocationId] = useState("");
  const [webhookUrl, setWebhookUrl] = useState("");
  const [webhookHeaderName, setWebhookHeaderName] = useState("");
  const [webhookHeaderValue, setWebhookHeaderValue] = useState("");
  const [webhookPollToken, setWebhookPollToken] = useState("");
  const [defaultPackageType, setDefaultPackageType] =
    useState<NonNullable<DeliveryOrder["packageType"]>>("SMALL");
  const [allowOpenPackage, setAllowOpenPackage] = useState(false);
  const [saving, setSaving] = useState(false);
  const [togglingEnabled, setTogglingEnabled] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testingWebhook, setTestingWebhook] = useState(false);
  const [trackingOpen, setTrackingOpen] = useState(false);
  const [bostaExpanded, setBostaExpanded] = useState(false);
  const [webhookExpanded, setWebhookExpanded] = useState(false);
  const [trackingNumber, setTrackingNumber] = useState("");
  const [trackingLoading, setTrackingLoading] = useState(false);
  const [trackingError, setTrackingError] = useState("");
  const [orderLookup, setOrderLookup] = useState("");
  const [orderLookupError, setOrderLookupError] = useState("");
  const [pendingLinkOrderId, setPendingLinkOrderId] = useState<string | null>(
    null,
  );
  const [trackingResult, setTrackingResult] =
    useState<TrackingSummary | null>(null);
  const [pickupLocations, setPickupLocations] = useState<
    Array<{ id: string; name: string }>
  >([]);

  // Mobile Linking State
  const { currentUser, licenseStatus } = useApp();
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
  const [devicePendingRevoke, setDevicePendingRevoke] = useState<LinkedMobileDevice | null>(null);
  const [deviceRevokeBusy, setDeviceRevokeBusy] = useState(false);
  const [deviceRefreshKey, setDeviceRefreshKey] = useState(0);
  const [mobileExpanded, setMobileExpanded] = useState(false);
  const trackedOrder = trackingResult
    ? orders.find(
        (order) =>
          order.trackingNumber === trackingResult.trackingNumber ||
          order.externalShipmentId === trackingResult.trackingNumber,
      )
    : undefined;
  const pendingLinkOrder = pendingLinkOrderId
    ? orders.find((order) => order.id === pendingLinkOrderId)
    : undefined;

  function findOrderForManualLink() {
    const reference = orderLookup.trim().toLocaleLowerCase("ar-EG");
    if (!reference) {
      setOrderLookupError("اكتب رقم أمر التوصيل أو رقم الفاتورة أولًا");
      return;
    }
    const match = orders.find(
      (order) =>
        order.orderNumber.toLocaleLowerCase("ar-EG") === reference ||
        order.invoiceNumber.toLocaleLowerCase("ar-EG") === reference,
    );
    if (!match) {
      setOrderLookupError("لم يتم العثور على أمر بهذا الرقم");
      return;
    }
    setOrderLookupError("");
    setPendingLinkOrderId(match.id);
  }

  function confirmManualOrderLink() {
    if (!pendingLinkOrder || !trackingResult) return;
    updateOrder(pendingLinkOrder.id, {
      providerId: BOSTA_PROVIDER_ID,
      providerName: "Bosta",
      trackingNumber: trackingResult.trackingNumber,
      trackingUrl: bostaPublicTrackingUrl(trackingResult.trackingNumber),
    });
    setPendingLinkOrderId(null);
    setOrderLookup("");
    setOrderLookupError("");
    toast.success(
      "تم ربط الشحنة بالأوردر",
      `تم حفظ رقم التتبع على ${pendingLinkOrder.orderNumber}`,
    );
  }

  useEffect(() => {
    setEnabled(bostaConfig.enabled);
    setAutoTrackingEnabled(bostaConfig.autoTrackingEnabled !== false);
    setAutoTrackingIntervalMinutes(
      bostaConfig.autoTrackingIntervalMinutes ?? 5,
    );
    setBusinessLocationId(bostaConfig.businessLocationId ?? "");
    setWebhookUrl(bostaConfig.webhookUrl ?? DEFAULT_BOSTA_WEBHOOK_URL);
    setWebhookHeaderName(bostaConfig.webhookHeaderName ?? "");
    setDefaultPackageType(bostaConfig.defaultPackageType ?? "SMALL");
    setAllowOpenPackage(bostaConfig.allowOpenPackage);
  }, [bostaConfig]);

  // Mobile Linking useEffect hooks
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
  }, [currentUser?.id, licenseStatus?.license?.licenseId]);

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

  // Mobile Linking functions
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

  async function save() {
    setSaving(true);
    try {
      const result = await withTimeout(
        saveBostaConfig({
          apiKey: apiKey.trim() || undefined,
          enabled,
          autoTrackingEnabled,
          autoTrackingIntervalMinutes,
          businessLocationId: businessLocationId.trim() || undefined,
          webhookUrl: webhookUrl.trim() || undefined,
          webhookHeaderName: webhookHeaderName.trim() || undefined,
          webhookHeaderValue: webhookHeaderValue.trim() || undefined,
          webhookPollToken: webhookPollToken.trim() || undefined,
          defaultPackageType,
          allowOpenPackage,
        }),
        15_000,
      );
      if (!result.ok)
        return toast.error(
          "تعذر حفظ إعداد Bosta",
          integrationError(result.error),
        );
      setApiKey("");
      setWebhookHeaderValue("");
      setWebhookPollToken("");
      toast.success(
        "تم حفظ الربط بأمان",
        "يمكنك الآن اختبار الاتصال وإرسال الشحنات",
      );
    } catch (error) {
      toast.error(
        "تعذر حفظ إعداد Bosta",
        integrationError(error instanceof Error ? error.message : undefined),
      );
    } finally {
      setSaving(false);
    }
  }

  async function toggleBostaEnabled() {
    if (saving || togglingEnabled) return;
    const nextEnabled = !enabled;
    // Switching on without a key stored, and without one typed into the panel,
    // can only come back as `api_key_missing`. Open the panel on the key field
    // instead of bouncing the owner off an error toast that does not say where
    // the key goes.
    if (nextEnabled && !bostaConfig.configured && !apiKey.trim()) {
      setBostaExpanded(true);
      toast.info(
        "أدخل مفتاح API أولًا",
        "الصق مفتاح Bosta في خانة «مفتاح API» بالأسفل واضغط «حفظ الإعداد»، ثم شغّل الربط.",
      );
      return;
    }
    setEnabled(nextEnabled);
    setTogglingEnabled(true);
    try {
      const result = await withTimeout(
        saveBostaConfig({
          apiKey: apiKey.trim() || undefined,
          enabled: nextEnabled,
          autoTrackingEnabled,
          autoTrackingIntervalMinutes,
          businessLocationId: businessLocationId.trim() || undefined,
          webhookUrl: webhookUrl.trim() || undefined,
          webhookHeaderName: webhookHeaderName.trim() || undefined,
          webhookHeaderValue: webhookHeaderValue.trim() || undefined,
          webhookPollToken: webhookPollToken.trim() || undefined,
          defaultPackageType,
          allowOpenPackage,
        }),
        15_000,
      );
      if (!result.ok) {
        setEnabled(!nextEnabled);
        toast.error(
          nextEnabled ? "تعذر تشغيل بوسطه" : "تعذر إيقاف بوسطه",
          integrationError(result.error),
        );
        return;
      }
      if (!nextEnabled) setBostaExpanded(false);
      setApiKey("");
      setWebhookHeaderValue("");
      setWebhookPollToken("");
      toast.success(
        nextEnabled ? "تم تشغيل بوسطه" : "تم إيقاف بوسطه",
        nextEnabled
          ? "أصبحت خدمات الشحن متاحة في أوامر التوصيل"
          : "لن تظهر بوسطه ضمن خيارات إنشاء الشحنات",
      );
    } catch (error) {
      setEnabled(!nextEnabled);
      toast.error(
        nextEnabled ? "تعذر تشغيل بوسطه" : "تعذر إيقاف بوسطه",
        integrationError(error instanceof Error ? error.message : undefined),
      );
    } finally {
      setTogglingEnabled(false);
    }
  }

  async function generateAndSaveWebhookKeys() {
    if (saving) return;
    const generatedHeaderValue = secureRelayToken();
    const generatedPollToken = secureRelayToken();
    setWebhookHeaderName("X-Autoparts-Webhook-Key");
    setWebhookHeaderValue(generatedHeaderValue);
    setWebhookPollToken(generatedPollToken);
    setSaving(true);
    try {
      const result = await withTimeout(
        saveBostaConfig({
          apiKey: apiKey.trim() || undefined,
          enabled,
          autoTrackingEnabled,
          autoTrackingIntervalMinutes,
          businessLocationId: businessLocationId.trim() || undefined,
          webhookUrl: webhookUrl.trim() || undefined,
          webhookHeaderName: "X-Autoparts-Webhook-Key",
          webhookHeaderValue: generatedHeaderValue,
          webhookPollToken: generatedPollToken,
          defaultPackageType,
          allowOpenPackage,
        }),
        15_000,
      );
      if (!result.ok) {
        toast.error(
          "تعذر حفظ مفاتيح خدمة الاستقبال",
          integrationError(result.error),
        );
        return;
      }
      toast.success(
        "تم توليد المفاتيح وحفظها",
        "انسخ القيم الظاهرة إلى ملف config.php ثم اضغط اختبار Webhook.",
      );
    } catch (error) {
      toast.error(
        "تعذر حفظ مفاتيح خدمة الاستقبال",
        integrationError(error instanceof Error ? error.message : undefined),
      );
    } finally {
      setSaving(false);
    }
  }

  async function test() {
    setTesting(true);
    try {
      const result = await withTimeout(testBostaConnection(), 25_000);
      if (!result.ok)
        return toast.error(
          "فشل اختبار الاتصال",
          integrationError(result.error),
        );
      const locations = result.pickupLocations ?? [];
      setPickupLocations(locations);
      if (!businessLocationId && locations.length === 1) {
        const locationId = locations[0].id;
        setBusinessLocationId(locationId);
        setSaving(true);
        try {
          const saveResult = await withTimeout(
            saveBostaConfig({
              enabled,
              autoTrackingEnabled,
              autoTrackingIntervalMinutes,
              businessLocationId: locationId,
              webhookUrl: webhookUrl.trim() || undefined,
              webhookHeaderName: webhookHeaderName.trim() || undefined,
              webhookPollToken: webhookPollToken.trim() || undefined,
              defaultPackageType,
              allowOpenPackage,
            }),
            15_000,
          );
          if (!saveResult.ok) {
            return toast.error(
              "تم الاتصال وتعذر حفظ فرع الاستلام",
              integrationError(saveResult.error),
            );
          }
        } finally {
          setSaving(false);
        }
      }
      toast.success(
        "الاتصال بـ Bosta يعمل",
        locations.length === 1
          ? `تم اختيار فرع الاستلام تلقائيًا: ${locations[0].name}`
          : "تم التحقق من المفتاح وجلب فروع الاستلام",
      );
    } catch (error) {
      toast.error(
        "فشل اختبار الاتصال",
        integrationError(error instanceof Error ? error.message : undefined),
      );
    } finally {
      setTesting(false);
    }
  }

  async function testWebhookRelay() {
    if (testingWebhook) return;
    const api = window.desktopAPI?.integrations?.bosta;
    if (!api?.testWebhook) {
      toast.error(
        "يلزم إعادة تشغيل التطبيق",
        "أغلق التطبيق وافتحه مجددًا لتفعيل اختبار Webhook",
      );
      return;
    }
    if (!webhookUrl.trim()) {
      toast.error(
        "رابط الاستقبال غير مكتوب",
        "اكتب رابط خدمة الاستقبال ثم احفظ الإعداد قبل الاختبار.",
      );
      return;
    }
    if (
      !webhookPollToken.trim() &&
      !bostaConfig.webhookPollTokenConfigured
    ) {
      toast.error(
        "مفتاح مزامنة التطبيق غير محفوظ",
        "انسخ قيمة desktop_poll_token من ملف config.php إلى خانة مفتاح مزامنة التطبيق، ثم اضغط حفظ الإعداد واختبر مرة أخرى.",
      );
      return;
    }
    setTestingWebhook(true);
    try {
      const result = await withTimeout(
        api.testWebhook({
          webhookUrl: webhookUrl.trim() || undefined,
          webhookPollToken: webhookPollToken.trim() || undefined,
        }),
        25_000,
      );
      if (!result.ok) {
        toast.error("فشل اختبار Webhook", integrationError(result.error));
        return;
      }
      toast.success(
        "خدمة Webhook تعمل",
        result.pendingEvents
          ? `تم التحقق من HTTPS والمفتاح ويوجد ${result.pendingEvents} تحديث بانتظار المزامنة`
          : "تم التحقق من الدومين وHTTPS والخدمة ومفتاح مزامنة التطبيق",
      );
    } catch (error) {
      toast.error(
        "فشل اختبار Webhook",
        integrationError(error instanceof Error ? error.message : undefined),
      );
    } finally {
      setTestingWebhook(false);
    }
  }

  async function lookupTracking() {
    const clean = trackingNumber.trim();
    if (clean.length < 3) {
      setTrackingError("اكتب رقم تتبع صحيحًا أولًا");
      return;
    }
    const api = window.desktopAPI?.integrations?.bosta;
    setTrackingLoading(true);
    setTrackingError("");
    setTrackingResult(null);
    try {
      if (/^\d{6,}$/.test(clean)) {
        try {
          const response = await withTimeout(
            fetch(
              `https://tracking.bosta.co/shipments/track/${encodeURIComponent(clean)}?lang=ar`,
              { headers: { Accept: "application/json" } },
            ),
            20_000,
          );
          if (response.ok) {
            const data: unknown = await response.json();
            setTrackingResult(trackingSummary(data, clean));
            return;
          }
          if (response.status === 404) {
            setTrackingError(integrationError("tracking_not_found"));
            return;
          }
          if (response.status === 429) {
            setTrackingError(integrationError("rate_limit_exceeded"));
            return;
          }
        } catch {
          // Fall through to the protected desktop handler when the public
          // tracking service is temporarily unreachable.
        }
      }

      if (!api?.trackDelivery) {
        setTrackingError(
          "خدمة التتبع لم تبدأ بعد. أغلق التطبيق وافتحه مرة أخرى ثم أعد المحاولة.",
        );
        return;
      }
      const result = await withTimeout(api.trackDelivery(clean), 25_000);
      if (result.ok) {
        setTrackingResult(trackingSummary(result.data, clean));
        return;
      }
      setTrackingError(integrationError(result.error));
    } catch (error) {
      setTrackingError(
        integrationError(error instanceof Error ? error.message : undefined),
      );
    } finally {
      setTrackingLoading(false);
    }
  }

  return (
    <>
      <PageHeader
        title="مركز الربط والتكاملات"
        description="إدارة الربط الآمن مع شركات الشحن وقنوات التواصل وأدوات الذكاء الاصطناعي من مكان واحد."
      />

      <div className="space-y-4">
        {/* ربط تطبيق PartFlow للهاتف */}
        <Card>
          <CardHeader
            title="تطبيقات الهاتف"
            subtitle="ربط تطبيق PartFlow للهاتف بحساب المتجر بصورة آمنة"
          />
          <CardBody>
            <div
              className={`rounded-2xl border transition-all duration-200 ${
                mobileLinkStatus.state === "ready" && mobileLinkStatus.featureLicensed
                  ? mobileExpanded
                    ? "border-brand-500/50 bg-brand-500/10"
                    : "border-brand-500/30 bg-brand-500/5"
                  : "border-line/50 bg-surface-muted/40"
              }`}
            >
              <div className="flex flex-col gap-4 p-4 lg:flex-row lg:items-center">
                <div className="flex min-w-0 flex-1 items-center gap-4">
                  <div
                    className={`grid h-14 w-14 shrink-0 place-items-center rounded-xl border transition-colors ${
                      mobileLinkStatus.state === "ready" && mobileLinkStatus.featureLicensed
                        ? "border-line bg-surface"
                        : "border-line/60 bg-surface-muted/70"
                    }`}
                  >
                    <Smartphone className="h-7 w-7 text-brand-600" />
                  </div>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-base font-bold text-ink">ربط تطبيق PartFlow</h3>
                      <Badge tone={mobileLinkStatus.state === "ready" && mobileLinkStatus.featureLicensed ? "green" : "slate"}>
                        {mobileLinkStatus.state === "loading" ? "جاري الفحص..." :
                         mobileLinkStatus.state === "ready" && mobileLinkStatus.featureLicensed ? "متاح" : "غير مفعل"}
                      </Badge>
                    </div>
                    <p className="mt-1 text-xs text-ink-muted">
                      أنشئ كود ربط آمن لربط أجهزة Android وiPhone بحساب المتجر
                    </p>
                  </div>
                </div>
                <div className="flex shrink-0 flex-wrap gap-2">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => setMobileExpanded(!mobileExpanded)}
                    className="gap-1.5"
                  >
                    <Settings2 className="h-4 w-4" />
                    {mobileExpanded ? "إخفاء" : "إدارة الأجهزة"}
                    <ChevronDown
                      className={`h-4 w-4 transition-transform ${mobileExpanded ? "rotate-180" : ""}`}
                    />
                  </Button>
                </div>
              </div>

              {mobileExpanded && (
                <div className="border-t border-line/30 p-4 space-y-4" dir="rtl">
                  {mobileLinkStatus.state === "loading" ? (
                    <div className="rounded-xl border border-line bg-surface-muted/45 p-4 text-sm text-ink-muted">
                      جارٍ فحص متطلبات الربط…
                    </div>
                  ) : mobileLinkStatus.state === "unavailable" ? (
                    <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-500/40 dark:bg-amber-500/15 dark:text-amber-100">
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
                          <div className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-500/40 dark:bg-amber-500/15 dark:text-amber-100">
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
                </div>
              )}
            </div>
          </CardBody>
        </Card>

        <Card>
          <CardHeader
            title="شركات الشحن"
            subtitle="أضف شركات الشحن وأدر إعداد كل شركة من مكان مستقل ومنظم"
          />
          <CardBody>
            <div
              className={`rounded-2xl border transition-all duration-200 ${
                enabled
                  ? bostaExpanded
                    ? "border-brand-500/50 bg-brand-500/10"
                    : "border-brand-500/30 bg-brand-500/5"
                  : "border-line/50 bg-surface-muted/40"
              }`}
            >
              <div className="flex flex-col gap-4 p-4 lg:flex-row lg:items-center">
                <div className="flex min-w-0 flex-1 items-center gap-4">
                  <div
                    className={`grid h-14 w-24 shrink-0 place-items-center rounded-xl border px-3 transition-colors ${
                      enabled
                        ? "border-line bg-white dark:bg-slate-950"
                        : "border-line/60 bg-surface-muted/70"
                    }`}
                  >
                    <img
                      src={bostaLogo}
                      alt="بوسطه"
                      className={`max-h-9 w-full object-contain transition-all ${
                        enabled ? "" : "opacity-75 saturate-75"
                      }`}
                    />
                  </div>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-base font-bold text-ink">بوسطه للشحن</h3>
                      <Badge
                        tone={
                          bostaConfig.configured && enabled ? "green" : "slate"
                        }
                      >
                        {bostaConfig.configured
                          ? enabled
                            ? "متصل"
                            : "معطّل"
                          : "غير مربوط"}
                      </Badge>
                    </div>
                    <p
                      className={`mt-1 text-xs ${
                        enabled ? "text-ink-muted" : "text-ink-muted/80"
                      }`}
                    >
                      إنشاء الشحنات والأسعار والتتبع وتحديث الحالات تلقائيًا
                    </p>
                  </div>
                </div>
                <div className="flex shrink-0 flex-wrap gap-2">
                  <button
                    type="button"
                    role="switch"
                    aria-checked={enabled}
                    aria-label={enabled ? "إيقاف تكامل بوسطه" : "تشغيل تكامل بوسطه"}
                    disabled={saving || togglingEnabled}
                    onClick={() => void toggleBostaEnabled()}
                    className={`relative h-7 w-16 shrink-0 rounded-full border font-bold shadow-inner transition-all disabled:cursor-wait disabled:opacity-60 ${
                      enabled
                        ? "border-emerald-400/60 bg-emerald-500/25 text-emerald-300"
                        : "border-slate-500/60 bg-slate-700/40 text-slate-300"
                    }`}
                    dir="ltr"
                  >
                    <span
                      className={`absolute top-0.5 h-5 w-5 rounded-full shadow transition-transform ${
                        enabled
                          ? "translate-x-10 bg-emerald-400"
                          : "translate-x-1 bg-slate-400"
                      } left-0`}
                    />
                    <span
                      className={`absolute top-1/2 -translate-y-1/2 text-[9px] ${
                        enabled ? "left-1.5" : "right-1"
                      }`}
                    >
                      {enabled ? "مفعّل" : "معطّل"}
                    </span>
                  </button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={!enabled}
                    onClick={() => {
                      setTrackingError("");
                      setTrackingResult(null);
                      setTrackingOpen(true);
                    }}
                    title={!enabled ? "فعّل بوسطه أولًا لاستخدام التتبع" : undefined}
                  >
                    <PackageCheck className="h-4 w-4" /> تتبع شحنة
                  </Button>
                  <Button
                    type="button"
                    variant={bostaExpanded ? "primary" : "outline"}
                    size="sm"
                    // Reachable while the integration is OFF on purpose: the
                    // API key lives in this panel, and the backend refuses to
                    // switch Bosta on until a key is stored. Gating the panel
                    // on `enabled` made the two requirements block each other
                    // and left a fresh install with no way in at all.
                    disabled={saving || togglingEnabled}
                    onClick={() => setBostaExpanded((current) => !current)}
                    aria-expanded={bostaExpanded}
                  >
                    <Settings2 className="h-4 w-4" />
                    {bostaExpanded ? "إغلاق الإعداد" : "إدارة الربط"}
                    <ChevronDown className={`h-4 w-4 transition-transform ${bostaExpanded ? "rotate-180" : ""}`} />
                  </Button>
                </div>
              </div>
            </div>
          </CardBody>

          {bostaExpanded ? (
            <div className="border-t border-line bg-surface-muted/10">
              <CardBody className="space-y-5 py-5">
            {!enabled ? (
              <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-xs text-amber-800 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-200">
                <span className="font-bold">الربط متوقف حاليًا.</span>{" "}
                {bostaConfig.configured
                  ? "الإعدادات محفوظة — شغّل المفتاح بالأعلى لبدء إرسال الشحنات."
                  : "الصق مفتاح API واضغط «حفظ الإعداد»، ثم شغّل المفتاح بالأعلى."}
              </div>
            ) : null}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Field
                label={
                  bostaConfig.configured
                    ? "استبدال مفتاح API (اختياري)"
                    : "مفتاح API"
                }
                hint="استخدم مفتاح Read/Write من لوحة Bosta"
              >
                <div className="relative">
                  <KeyRound className="absolute right-3 top-2.5 h-4 w-4 text-ink-faint" />
                  <Input
                    type="password"
                    value={apiKey}
                    onChange={(event) => setApiKey(event.target.value)}
                    placeholder={
                      bostaConfig.configured
                        ? "اتركه فارغًا للاحتفاظ بالمفتاح الحالي"
                        : "الصق المفتاح هنا"
                    }
                    className="pr-9 font-mono"
                    dir="ltr"
                  />
                </div>
              </Field>
              <Field
                label="فرع الاستلام في Bosta"
                hint="المكان الذي يستلم منه مندوب Bosta الشحنات"
              >
                {pickupLocations.length > 0 ? (
                  <Select
                    value={businessLocationId}
                    onChange={(event) =>
                      setBusinessLocationId(event.target.value)
                    }
                  >
                    <option value="" disabled>
                      اختر فرع الاستلام
                    </option>
                    {pickupLocations.map((location) => (
                      <option key={location.id} value={location.id}>
                        {location.name}
                      </option>
                    ))}
                  </Select>
                ) : (
                  <Input
                    value={businessLocationId ? "تم اختيار فرع محفوظ" : ""}
                    placeholder="سيظهر تلقائيًا بعد اختبار الاتصال"
                    readOnly
                  />
                )}
                <p className="mt-1.5 text-[11px] leading-5 text-ink-faint">
                  احفظ المفتاح ثم اختبر الاتصال؛ سيتم جلب الفروع من حسابك،
                  واختيار الفرع تلقائيًا إذا كان لديك فرع واحد.
                </p>
              </Field>
            </div>

            <div className="rounded-xl border border-line bg-surface p-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <div className="font-bold text-ink">
                    تحديث الحالات التلقائي
                  </div>
                  <p className="mt-1 text-xs leading-6 text-ink-muted">
                    يتابع النظام الشحنات النشطة من Bosta ويحدّث حالتها تلقائيًا
                    أثناء تشغيل التطبيق.
                  </p>
                </div>
                <Badge tone={autoTrackingEnabled ? "green" : "slate"}>
                  {autoTrackingEnabled ? "مفعّل" : "متوقف"}
                </Badge>
              </div>
              <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2">
                <label className="flex items-center justify-between rounded-xl border border-line bg-surface-muted/30 px-3 py-2.5 text-sm">
                  <span>
                    <span className="block font-semibold text-ink">
                      تشغيل التحديث التلقائي
                    </span>
                    <span className="text-xs text-ink-faint">
                      يعمل عبر Bosta API بدون إعداد خادم
                    </span>
                  </span>
                  <input
                    type="checkbox"
                    checked={autoTrackingEnabled}
                    onChange={(event) =>
                      setAutoTrackingEnabled(event.target.checked)
                    }
                    className="h-5 w-5 accent-brand-600"
                  />
                </label>
                <Field label="التحديث كل">
                  <Select
                    value={autoTrackingIntervalMinutes}
                    disabled={!autoTrackingEnabled}
                    onChange={(event) =>
                      setAutoTrackingIntervalMinutes(Number(event.target.value))
                    }
                  >
                    <option value={2}>دقيقتين</option>
                    <option value={5}>5 دقائق</option>
                    <option value={10}>10 دقائق</option>
                    <option value={15}>15 دقيقة</option>
                    <option value={30}>30 دقيقة</option>
                  </Select>
                </Field>
                <div className="md:col-span-2 mt-1 border-t border-line pt-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <div className="text-sm font-semibold text-ink">
                        Webhook لحظي سحابي (اختياري)
                      </div>
                      <p className="mt-1 text-[11px] leading-5 text-ink-faint">
                        يحتاج رابط HTTPS عام لخدمة استقبال متصلة بالنظام؛ تطبيق
                        سطح المكتب لا يستقبل طلبات الإنترنت مباشرة.
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge tone={bostaConfig.webhookRelayReady ? "green" : "slate"}>
                        {bostaConfig.webhookRelayReady ? "جاهز" : "غير مربوط"}
                      </Badge>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        onClick={() => setWebhookExpanded((current) => !current)}
                        aria-expanded={webhookExpanded}
                      >
                        {webhookExpanded ? "إخفاء الإعدادات" : "إعداد Webhook"}
                        <ChevronDown className={`h-3.5 w-3.5 transition-transform ${webhookExpanded ? "rotate-180" : ""}`} />
                      </Button>
                    </div>
                  </div>
                </div>
                {webhookExpanded ? <>
                <div className="md:col-span-2 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-brand-500/25 bg-brand-500/5 p-3">
                  <div>
                    <div className="text-sm font-semibold text-ink">
                      مفاتيح خدمة الاستقبال
                    </div>
                    <div className="mt-1 text-[11px] text-ink-faint">
                      أنشئها مرة واحدة ثم استخدم نفس القيم في ملف إعداد خدمة Hostinger.
                    </div>
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={saving}
                    onClick={() => void generateAndSaveWebhookKeys()}
                  >
                    <KeyRound className="h-4 w-4" />
                    {saving ? "جاري الحفظ..." : "توليد وحفظ مفاتيح آمنة"}
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={testingWebhook}
                    onClick={() => void testWebhookRelay()}
                  >
                    <RefreshCw
                      className={`h-4 w-4 ${testingWebhook ? "animate-spin" : ""}`}
                    />
                    اختبار Webhook
                  </Button>
                </div>
                <Field
                  label="رابط استقبال Webhook"
                  className="md:col-span-2"
                  hint="ينتهي بـ /v1/bosta/webhook"
                >
                  <Input
                    value={webhookUrl}
                    onChange={(event) => setWebhookUrl(event.target.value)}
                    placeholder="https://..."
                    dir="ltr"
                  />
                </Field>
                <Field
                  label="اسم مفتاح التوثيق — Webhook Header Name"
                  hint="استخدم X-Autoparts-Webhook-Key في التطبيق ولوحة Bosta"
                >
                  <Input
                    value={webhookHeaderName}
                    onChange={(event) =>
                      setWebhookHeaderName(event.target.value)
                    }
                    placeholder="Authorization"
                    dir="ltr"
                  />
                </Field>
                <Field
                  label={
                    bostaConfig.webhookHeaderConfigured
                      ? "استبدال مفتاح توثيق بوسطه — Bosta Webhook Secret"
                      : "مفتاح توثيق بوسطه — Bosta Webhook Secret"
                  }
                  hint={
                    bostaConfig.webhookHeaderConfigured
                      ? `محفوظة بأمان: ${bostaConfig.webhookHeaderHint ?? "••••"}`
                      : "مثال: Bearer secret-token"
                  }
                >
                  <div className="flex gap-2">
                    <Input
                      type="password"
                      value={webhookHeaderValue}
                      onChange={(event) =>
                        setWebhookHeaderValue(event.target.value)
                      }
                      placeholder={
                        bostaConfig.webhookHeaderConfigured
                          ? "اتركها فارغة للاحتفاظ بالقيمة الحالية"
                          : "قيمة سرية"
                      }
                      dir="ltr"
                    />
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={!webhookHeaderValue}
                      onClick={() => {
                        void navigator.clipboard.writeText(webhookHeaderValue);
                        toast.success("تم نسخ مفتاح Bosta");
                      }}
                    >
                      نسخ
                    </Button>
                  </div>
                </Field>
                <Field
                  label={
                    bostaConfig.webhookPollTokenConfigured
                      ? "استبدال مفتاح مزامنة التطبيق — Desktop Poll Token (desktop_poll_token)"
                      : "مفتاح مزامنة التطبيق — Desktop Poll Token (desktop_poll_token)"
                  }
                  hint={
                    bostaConfig.webhookPollTokenConfigured
                      ? `محفوظ بأمان: ${bostaConfig.webhookPollTokenHint ?? "••••"}`
                      : "desktop_poll_token في ملف config.php على Hostinger"
                  }
                  className="md:col-span-2"
                >
                  <div className="flex gap-2">
                    <Input
                      type="password"
                      value={webhookPollToken}
                      onChange={(event) =>
                        setWebhookPollToken(event.target.value)
                      }
                      placeholder={
                        bostaConfig.webhookPollTokenConfigured
                          ? "اتركه فارغًا للاحتفاظ بالمفتاح الحالي"
                          : "اضغط توليد مفاتيح آمنة"
                      }
                      dir="ltr"
                    />
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={!webhookPollToken}
                      onClick={() => {
                        void navigator.clipboard.writeText(webhookPollToken);
                        toast.success("تم نسخ مفتاح مزامنة التطبيق");
                      }}
                    >
                      نسخ
                    </Button>
                  </div>
                </Field>
                </> : null}
              </div>
            </div>

            <div className="flex flex-wrap justify-between gap-2 border-t border-line pt-4">
              <div className="flex flex-wrap gap-2">
                <a
                  href="https://docs.bosta.co/"
                  target="_blank"
                  rel="noreferrer"
                >
                  <Button variant="outline" size="sm">
                    <ExternalLink className="w-4 h-4" /> وثائق Bosta
                  </Button>
                </a>
              </div>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  onClick={test}
                  disabled={testing || saving || !bostaConfig.configured}
                >
                  <RefreshCw
                    className={`w-4 h-4 ${testing ? "animate-spin" : ""}`}
                  />{" "}
                  اختبار الاتصال
                </Button>
                <Button onClick={save} disabled={saving || testing}>
                  {saving ? "جاري الحفظ..." : "حفظ الإعداد"}
                </Button>
              </div>
            </div>
              </CardBody>
            </div>
          ) : null}
        </Card>

        <div className="grid gap-4 md:grid-cols-3">
          <Card>
            <CardHeader title="قنوات التواصل" subtitle="إشعارات ومتابعة العملاء" />
            <CardBody>
              <FutureIntegration
                icon={<MessageCircle className="h-5 w-5" />}
                title="WhatsApp Business API"
                description="إشعارات الفاتورة والشحن وحالة الطلب"
              />
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="الذكاء الاصطناعي" subtitle="مساعدات وتحليلات ذكية" />
            <CardBody>
              <FutureIntegration
                icon={<Bot className="h-5 w-5" />}
                title="أدوات الذكاء الاصطناعي"
                description="Grok ومساعدات تحليل المخزون والمبيعات"
              />
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="متاجر ومنصات البيع" subtitle="طلبات ومزامنة المخزون" />
            <CardBody>
              <FutureIntegration
                icon={<Link2 className="h-5 w-5" />}
                title="متاجر ومنصات البيع"
                description="استقبال الطلبات وتحديث المخزون تلقائيًا"
              />
            </CardBody>
          </Card>
        </div>
      </div>

      <Dialog
        open={trackingOpen}
        onClose={() => setTrackingOpen(false)}
        title={
          <div className="flex w-full flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <div>تتبع شحنة بوسطه</div>
              <div className="mt-0.5 text-xs font-normal text-ink-muted">
                اعرض حالة الشحنة وتحديثاتها داخل النظام
              </div>
            </div>
            <div className="w-full shrink-0 sm:w-64">
              <label className="mb-1 block text-[11px] font-normal text-ink-faint">
                رقم التتبع
              </label>
              <Input
                value={trackingNumber}
                onChange={(event) => {
                  setTrackingNumber(event.target.value);
                  setTrackingError("");
                  setTrackingResult(null);
                  setOrderLookup("");
                  setOrderLookupError("");
                }}
                placeholder="مثال: 81209289"
                className="h-9 font-mono"
                dir="ltr"
                autoFocus
                onKeyDown={(event) => {
                  if (
                    event.key !== "Enter" ||
                    trackingNumber.trim().length < 3
                  )
                    return;
                  void lookupTracking();
                }}
              />
            </div>
          </div>
        }
        width="lg"
        footer={
          <>
            <Button variant="outline" onClick={() => setTrackingOpen(false)}>
              إغلاق
            </Button>
            {trackingNumber.trim().length >= 3 ? (
              <Button
                variant="outline"
                onClick={() => {
                window.open(
                  bostaPublicTrackingUrl(trackingNumber),
                  "_blank",
                  "noopener,noreferrer",
                );
              }}
              >
                <ExternalLink className="h-4 w-4" /> فتح موقع بوسطه
              </Button>
            ) : null}
            <Button
              variant="outline"
              disabled={!trackedOrder}
              title={
                trackedOrder
                  ? `فتح الأمر ${trackedOrder.orderNumber}`
                  : "رقم التتبع غير مرتبط بأمر توصيل محفوظ في النظام"
              }
              onClick={() => {
                if (!trackedOrder) return;
                setTrackingOpen(false);
                navigate("/shipping", {
                  state: { openDeliveryOrderId: trackedOrder.id },
                });
              }}
            >
              <PackageCheck className="h-4 w-4" /> تفاصيل الطلب
            </Button>
            <Button
              disabled={trackingLoading || trackingNumber.trim().length < 3}
              onClick={() => void lookupTracking()}
            >
              <RefreshCw
                className={`h-4 w-4 ${trackingLoading ? "animate-spin" : ""}`}
              />
              {trackingLoading ? "جاري التتبع..." : "عرض التتبع"}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          {trackingError ? (
            <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
              {trackingError}
            </div>
          ) : null}

          {trackingResult ? (
            <div className="space-y-4">
              {!trackedOrder ? (
                <div className="space-y-2 rounded-xl border border-amber-300 bg-amber-50 px-3 py-3 text-xs text-amber-900 dark:border-amber-500/35 dark:bg-amber-500/15 dark:text-amber-100">
                  <div>
                    هذا الرقم غير مرتبط بأمر توصيل محفوظ. يمكنك البحث عن
                    الأوردر وربطه يدويًا إذا لم يتم الربط تلقائيًا.
                  </div>
                  <div className="flex flex-col gap-2 sm:flex-row">
                    <Input
                      value={orderLookup}
                      onChange={(event) => {
                        setOrderLookup(event.target.value);
                        setOrderLookupError("");
                      }}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") findOrderForManualLink();
                      }}
                      placeholder="رقم أمر التوصيل أو الفاتورة"
                      className="h-9 flex-1 bg-surface"
                      dir="ltr"
                    />
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={findOrderForManualLink}
                    >
                      <Link2 className="h-4 w-4" /> بحث وربط
                    </Button>
                  </div>
                  {orderLookupError ? (
                    <div className="text-red-300">{orderLookupError}</div>
                  ) : null}
                </div>
              ) : (
                <div className="flex items-center justify-between gap-3 rounded-xl border border-emerald-500/25 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-300">
                  <span>الشحنة مرتبطة بأمر التوصيل</span>
                  <span className="font-mono font-bold">
                    {trackedOrder.orderNumber}
                  </span>
                </div>
              )}
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <TrackingFact label="الحالة الحالية" value={trackingResult.status} strong />
                <TrackingFact
                  label="تاريخ إنشاء الشحنة"
                  value={
                    trackingResult.createdAt
                      ? formatDateTime(trackingResult.createdAt)
                      : "غير متاح"
                  }
                />
                <TrackingFact
                  label="آخر تحديث"
                  value={
                    trackingResult.updatedAt
                      ? formatDateTime(trackingResult.updatedAt)
                      : "غير متاح"
                  }
                />
                <TrackingFact
                  label="موعد التسليم المخطط"
                  value={
                    trackingResult.promisedDate
                      ? formatDate(trackingResult.promisedDate)
                      : "غير محدد"
                  }
                />
              </div>

              <div className="rounded-2xl border border-line bg-surface-muted/25 p-4">
                <div className="mb-4 flex items-center justify-between gap-3">
                  <div className="font-semibold text-ink">تحديثات الشحنة</div>
                  {trackingResult.attempts !== undefined ? (
                    <Badge tone="slate">
                      محاولات التسليم: {trackingResult.attempts}
                    </Badge>
                  ) : null}
                </div>
                <div className="space-y-0">
                  {trackingResult.timeline.map((item, index) => (
                    <div key={item.key} className="relative flex gap-3 pb-4 last:pb-0">
                      {index < trackingResult.timeline.length - 1 ? (
                        <span className="absolute right-[7px] top-4 h-[calc(100%-8px)] w-px bg-line" />
                      ) : null}
                      <span className="relative mt-1.5 h-4 w-4 shrink-0 rounded-full border-4 border-surface bg-brand-500" />
                      <div className="min-w-0">
                        <div className="text-sm font-medium text-ink">{item.label}</div>
                        <div className="mt-1 whitespace-nowrap text-xs text-ink-faint">
                          {item.occurredAt
                            ? formatDateTime(item.occurredAt)
                            : "وقت التحديث غير متاح"}
                        </div>
                        {item.location ? (
                          <div className="mt-1 text-xs text-ink-muted">
                            الموقع: <span dir="ltr">{item.location}</span>
                          </div>
                        ) : null}
                        {item.note ? (
                          <div className="mt-1 text-xs font-medium text-amber-400">
                            {item.note}
                          </div>
                        ) : null}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          ) : null}
        </div>
      </Dialog>

      <ConfirmDialog
        open={Boolean(pendingLinkOrder)}
        onClose={() => setPendingLinkOrderId(null)}
        onConfirm={confirmManualOrderLink}
        title="تأكيد ربط الشحنة"
        confirmText="تأكيد الربط"
        message={
          pendingLinkOrder && trackingResult ? (
            <div className="space-y-2">
              <p>
                سيتم ربط رقم التتبع {trackingResult.trackingNumber} بأمر
                التوصيل {pendingLinkOrder.orderNumber} والفاتورة {" "}
                {pendingLinkOrder.invoiceNumber}.
              </p>
              {pendingLinkOrder.trackingNumber &&
              pendingLinkOrder.trackingNumber !==
                trackingResult.trackingNumber ? (
                <p className="font-semibold text-amber-500">
                  تنبيه: سيتم استبدال رقم التتبع الحالي {" "}
                  {pendingLinkOrder.trackingNumber}.
                </p>
              ) : null}
            </div>
          ) : null
        }
      />

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
              <div className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-xs leading-6 text-amber-900 dark:border-amber-500/35 dark:bg-amber-500/15 dark:text-amber-100">
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
    </>
  );
}

function TrackingFact({
  label,
  value,
  strong = false,
  mono = false,
}: {
  label: string;
  value: string;
  strong?: boolean;
  mono?: boolean;
}) {
  return (
    <div className="rounded-xl border border-line bg-surface-muted/30 p-3">
      <div className="text-[11px] text-ink-faint">{label}</div>
      <div
        className={`mt-1.5 whitespace-nowrap text-sm text-ink ${strong ? "font-bold" : "font-medium"} ${mono ? "font-mono" : ""}`}
      >
        {value}
      </div>
    </div>
  );
}

function FutureIntegration({
  icon,
  title,
  description,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
}) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-line bg-surface-muted/40 p-3 opacity-90">
      <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-surface text-brand-600">
        {icon}
      </div>
      <div className="min-w-0 flex-1">
        <div className="font-semibold text-ink">{title}</div>
        <div className="text-xs text-ink-muted">{description}</div>
      </div>
      <Badge tone="slate">قريبًا</Badge>
    </div>
  );
}
