import { useEffect, useState } from "react";
import {
  Bot,
  ExternalLink,
  KeyRound,
  Link2,
  MessageCircle,
  PackageCheck,
  RefreshCw,
} from "lucide-react";
import { PageHeader } from "../components/layout/AppLayout";
import { Card, CardBody, CardHeader } from "../components/ui/Card";
import { Badge } from "../components/ui/Badge";
import { Button } from "../components/ui/Button";
import { Field, Input, Select } from "../components/ui/Input";
import { Dialog } from "../components/ui/Dialog";
import { useShipping } from "../store/ShippingContext";
import { useToast } from "../components/ui/Toast";
import type { DeliveryOrder } from "../types";
import { bostaLogo } from "../assets/bosta-logo";
import {
  bostaPublicTrackingUrl,
  bostaStatus,
  translateBostaError,
} from "../lib/shipping";
import { formatDateTime } from "../lib/format";

const PACKAGE_TYPES: Array<{
  value: NonNullable<DeliveryOrder["packageType"]>;
  label: string;
}> = [
  { value: "SMALL", label: "طرد صغير" },
  { value: "MEDIUM", label: "طرد متوسط" },
  { value: "LARGE", label: "طرد كبير" },
  { value: "Light Bulky", label: "كبير خفيف" },
  { value: "Heavy Bulky", label: "كبير ثقيل" },
];

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
};

type TrackingSummary = {
  trackingNumber: string;
  status: string;
  updatedAt?: string;
  promisedDate?: string;
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
  const value = Number(firstValue(source, paths));
  return Number.isFinite(value) ? value : undefined;
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
  return bostaStatus(code).label.replace(/Bosta/g, "بوسطة");
}

function trackingSummary(data: unknown, fallback: string): TrackingSummary {
  const code = firstNumber(data, [
    "state",
    "data.state",
    "delivery.state",
    "currentStatus.code",
    "data.currentStatus.code",
  ]);
  const historyPaths = [
    "history",
    "data.history",
    "stateHistory",
    "data.stateHistory",
    "events",
    "data.events",
    "delivery.history",
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
      ]) ?? fallback,
    status: arabicBostaStatus(code),
    updatedAt,
    promisedDate: asIsoDate(
      firstValue(data, [
        "deliveryPromiseDate",
        "data.deliveryPromiseDate",
        "delivery.deliveryPromiseDate",
      ]),
    ),
    attempts: firstNumber(data, [
      "numberOfAttempts",
      "data.numberOfAttempts",
      "delivery.numberOfAttempts",
    ]),
    timeline,
  };
}

export function IntegrationsPage() {
  const { bostaConfig, saveBostaConfig, testBostaConnection } = useShipping();
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
  const [testing, setTesting] = useState(false);
  const [testingWebhook, setTestingWebhook] = useState(false);
  const [trackingOpen, setTrackingOpen] = useState(false);
  const [trackingNumber, setTrackingNumber] = useState("");
  const [trackingLoading, setTrackingLoading] = useState(false);
  const [trackingError, setTrackingError] = useState("");
  const [trackingResult, setTrackingResult] =
    useState<TrackingSummary | null>(null);
  const [pickupLocations, setPickupLocations] = useState<
    Array<{ id: string; name: string }>
  >([]);

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
    if (!api?.trackDelivery) {
      setTrackingError(
        "خدمة التتبع لم تبدأ بعد. أغلق التطبيق وافتحه مرة أخرى ثم أعد المحاولة.",
      );
      return;
    }
    setTrackingLoading(true);
    setTrackingError("");
    setTrackingResult(null);
    try {
      const result = await withTimeout(api.trackDelivery(clean), 25_000);
      if (!result.ok) {
        setTrackingError(integrationError(result.error));
        return;
      }
      setTrackingResult(trackingSummary(result.data, clean));
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

      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1.5fr)_minmax(320px,.7fr)] gap-4">
        <Card>
          <CardHeader
            title={
              <span className="flex items-center gap-2">
                <img
                  src={bostaLogo}
                  alt="بوسطة"
                  className="h-7 w-auto object-contain"
                />
                Bosta للشحن
              </span>
            }
            subtitle="إنشاء الشحنات من فواتير المبيعات ومزامنة رقم التتبع والحالة"
            actions={
              <Badge
                tone={
                  bostaConfig.enabled && bostaConfig.configured
                    ? "green"
                    : "slate"
                }
              >
                {bostaConfig.enabled && bostaConfig.configured
                  ? "متصل ومفعّل"
                  : bostaConfig.configured
                    ? "مُعدّ وغير مفعّل"
                    : "غير مربوط"}
              </Badge>
            }
          />
          <CardBody className="space-y-5">
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
              <Field label="حجم الطرد الافتراضي">
                <Select
                  value={defaultPackageType}
                  onChange={(event) =>
                    setDefaultPackageType(
                      event.target.value as NonNullable<
                        DeliveryOrder["packageType"]
                      >,
                    )
                  }
                >
                  {PACKAGE_TYPES.map((item) => (
                    <option key={item.value} value={item.value}>
                      {item.label}
                    </option>
                  ))}
                </Select>
              </Field>
              <div className="flex flex-col justify-end gap-2">
                <label className="flex items-center justify-between rounded-xl border border-line bg-surface px-3 py-2.5 text-sm">
                  <span>
                    <span className="block font-semibold text-ink">
                      السماح بفتح الطرد
                    </span>
                    <span className="text-xs text-ink-faint">
                      يُرسل مع أمر الشحن عند التفعيل
                    </span>
                  </span>
                  <input
                    type="checkbox"
                    checked={allowOpenPackage}
                    onChange={(event) =>
                      setAllowOpenPackage(event.target.checked)
                    }
                    className="h-4 w-4 accent-brand-600"
                  />
                </label>
              </div>
            </div>

            <label className="flex items-center justify-between rounded-xl border border-line bg-surface px-4 py-3">
              <span>
                <span className="block font-bold text-ink">
                  تفعيل Bosta في أوامر الشحن
                </span>
                <span className="text-xs text-ink-faint">
                  يظهر زر إرسال الشحنة والتتبع في مركز التوصيل
                </span>
              </span>
              <input
                type="checkbox"
                checked={enabled}
                onChange={(event) => setEnabled(event.target.checked)}
                className="h-5 w-5 accent-brand-600"
              />
            </label>

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
                    <Badge
                      tone={bostaConfig.webhookRelayReady ? "green" : "slate"}
                    >
                      {bostaConfig.webhookRelayReady ? "جاهز" : "غير مربوط"}
                    </Badge>
                  </div>
                </div>
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
                    onClick={() => {
                      setWebhookHeaderName("X-Autoparts-Webhook-Key");
                      setWebhookHeaderValue(secureRelayToken());
                      setWebhookPollToken(secureRelayToken());
                    }}
                  >
                    <KeyRound className="h-4 w-4" /> توليد مفاتيح آمنة
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
                      ? "استبدال مفتاح توثيق بوسطة — Bosta Webhook Secret (bosta_webhook_secret)"
                      : "مفتاح توثيق بوسطة — Bosta Webhook Secret (bosta_webhook_secret)"
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
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setTrackingError("");
                    setTrackingResult(null);
                    setTrackingOpen(true);
                  }}
                >
                  <PackageCheck className="w-4 h-4" /> تتبع شحنة
                </Button>
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
        </Card>

        <div className="space-y-4">
          <Card>
            <CardHeader
              title="تكاملات قادمة"
              subtitle="نفس المركز جاهز لإضافة قنوات جديدة دون تغيير بيانات المبيعات"
            />
            <CardBody className="space-y-3">
              <FutureIntegration
                icon={<MessageCircle className="h-5 w-5" />}
                title="WhatsApp Business API"
                description="إشعارات الفاتورة والشحن وحالة الطلب"
              />
              <FutureIntegration
                icon={<Bot className="h-5 w-5" />}
                title="أدوات الذكاء الاصطناعي"
                description="Grok ومساعدات تحليل المخزون والمبيعات"
              />
              <FutureIntegration
                icon={<Link2 className="h-5 w-5" />}
                title="متاجر ومنصات البيع"
                description="استقبال الطلبات وتحديث المخزون تلقائيًا"
              />
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="قبل التشغيل" />
            <CardBody className="space-y-2 text-xs leading-6 text-ink-muted">
              <p>1. أنشئ مفتاح Read/Write من API Integration في لوحة Bosta.</p>
              <p>
                2. احفظ المفتاح واختبر الاتصال؛ سيجلب النظام فروع الاستلام من
                حسابك بدل إدخال أي كود يدويًا.
              </p>
              <p>
                3. أضف قائمة أسعار حسابك من صفحة التوصيل والشحن؛ السعر التعاقدي
                يختلف حسب الحساب والمنطقة.
              </p>
              <p>
                4. اربط عناوين العملاء بالمدينة والمنطقة الصحيحة قبل إرسال أول
                شحنة.
              </p>
            </CardBody>
          </Card>
        </div>
      </div>

      <Dialog
        open={trackingOpen}
        onClose={() => setTrackingOpen(false)}
        title="تتبع شحنة بوسطة"
        subtitle="اعرض حالة الشحنة وتحديثاتها داخل النظام"
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
                <ExternalLink className="h-4 w-4" /> فتح موقع بوسطة
              </Button>
            ) : null}
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
          <Field label="رقم الشحنة">
            <Input
              value={trackingNumber}
              onChange={(event) => {
                setTrackingNumber(event.target.value);
                setTrackingError("");
                setTrackingResult(null);
              }}
              placeholder="مثال: 81209289"
              dir="ltr"
              autoFocus
              onKeyDown={(event) => {
                if (event.key !== "Enter" || trackingNumber.trim().length < 3)
                  return;
                void lookupTracking();
              }}
            />
          </Field>

          {trackingError ? (
            <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
              {trackingError}
            </div>
          ) : null}

          {trackingResult ? (
            <div className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <TrackingFact label="الحالة الحالية" value={trackingResult.status} strong />
                <TrackingFact
                  label="رقم التتبع"
                  value={trackingResult.trackingNumber}
                  mono
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
                  label="موعد التسليم المتوقع"
                  value={
                    trackingResult.promisedDate
                      ? formatDateTime(trackingResult.promisedDate)
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
                        <div className="mt-1 text-xs text-ink-faint">
                          {item.occurredAt
                            ? formatDateTime(item.occurredAt)
                            : "وقت التحديث غير متاح"}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          ) : null}
        </div>
      </Dialog>
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
        className={`mt-1.5 text-sm text-ink ${strong ? "font-bold" : "font-medium"} ${mono ? "font-mono" : ""}`}
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
    <div className="flex items-center gap-3 rounded-xl border border-line bg-surface-muted/30 p-3 opacity-80">
      <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-surface text-brand-600">
        {icon}
      </div>
      <div className="min-w-0 flex-1">
        <div className="font-semibold text-ink">{title}</div>
        <div className="text-xs text-ink-faint">{description}</div>
      </div>
      <Badge tone="slate">قريبًا</Badge>
    </div>
  );
}
