import { useEffect, useState } from "react";
import {
  RefreshCw,
  Download,
  CheckCircle2,
  Sparkles,
  ShieldCheck,
  X,
  HardDrive,
} from "lucide-react";
import { Card, CardHeader, CardBody } from "../ui/Card";
import { Button } from "../ui/Button";
import { useToast } from "../ui/Toast";
import { formatUpdateSize, formatDownloadedOf, isNewerVersion } from "./updateFormat";

type UpdatePreferences = {
  autoCheck: boolean;
  autoDownload: boolean;
  autoInstallOnQuit: boolean;
};

type UpdateStatusState = {
  phase: "idle" | "checking" | "available" | "downloading" | "downloaded" | "installing" | "error";
  release: {
    id: string;
    version: string;
    title: string;
    /** Release notes the admin wrote in the portal. */
    notes?: string;
    severity: "normal" | "important" | "critical" | "emergency";
    publishedAt: string | null;
    artifactSize?: number | null;
  } | null;
  downloadPercent: number;
  error: string | null;
  lastCheckAt: string | null;
  preferences: UpdatePreferences;
  currentVersion: string;
};

export function UpdateSettingsCard() {
  const toast = useToast();
  const [status, setStatus] = useState<UpdateStatusState | null>(null);
  const [isChecking, setIsChecking] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);
  const [isInstalling, setIsInstalling] = useState(false);
  const [transfer, setTransfer] = useState<{ transferred: number; total: number } | null>(null);

  const fetchStatus = async () => {
    const api = window.desktopAPI?.updates;
    if (!api) return;
    try {
      const res = await api.getStatus();
      if (res.ok) {
        setStatus(res as unknown as UpdateStatusState);
      }
    } catch {
      // Ignore
    }
  };

  useEffect(() => {
    void fetchStatus();
    const api = window.desktopAPI?.updates;
    if (!api) return;

    const unsubState = api.onStateChanged((newState) => {
      setStatus((prev) => (prev ? { ...prev, ...(newState as Partial<UpdateStatusState>) } : (newState as UpdateStatusState)));
      void fetchStatus();
    });

    const unsubProgress = api.onDownloadProgress(({ percent, transferred, total }) => {
      if (total) setTransfer({ transferred: transferred || 0, total });
      setStatus((prev) =>
        prev
          ? { ...prev, phase: "downloading", downloadPercent: percent }
          : ({ phase: "downloading", downloadPercent: percent } as UpdateStatusState)
      );
    });

    const unsubDownloaded = api.onDownloaded(({ release }) => {
      setStatus((prev) =>
        prev
          ? {
              ...prev,
              phase: "downloaded",
              release: release ? { ...prev.release, ...release, id: String(release.id || prev.release?.id || "") } : prev.release,
              downloadPercent: 100,
            }
          : ({ phase: "downloaded", downloadPercent: 100 } as UpdateStatusState)
      );
      setIsDownloading(false);
    });

    return () => {
      unsubState();
      unsubProgress();
      unsubDownloaded();
    };
  }, []);

  if (!window.desktopAPI?.updates) {
    return null; // Only render on desktop (Electron)
  }

  // Must mirror DEFAULT_UPDATE_PREFERENCES in electron/update-policy.cjs,
  // otherwise the toggles render in the wrong position before status loads.
  const prefs = status?.preferences || {
    autoCheck: true,
    autoDownload: true,
    autoInstallOnQuit: false,
  };

  const handleTogglePref = async (key: keyof UpdatePreferences) => {
    if (!window.desktopAPI?.updates) return;
    const newPrefs = { ...prefs, [key]: !prefs[key] };
    const res = await window.desktopAPI.updates.setPreferences(newPrefs);
    if (res.ok && res.preferences) {
      setStatus((prev) => (prev ? { ...prev, preferences: res.preferences! } : prev));
      toast.success("تم حفظ تفضيلات التحديث بنجاح");
    } else {
      toast.error("فشل حفظ التفضيلات");
    }
  };

  const handleCheckNow = async () => {
    if (!window.desktopAPI?.updates || isChecking) return;
    setIsChecking(true);
    try {
      const res = await window.desktopAPI.updates.checkNow();
      if (res.ok) {
        if (res.updateAvailable) {
          toast.info(`يتوفر تحديث جديد: v${res.release?.version}`);
        } else {
          toast.success("أنت تستخدم أحدث نسخة بالفعل");
        }
      } else {
        toast.error(res.error || "فشل التحقق من التحديثات");
      }
    } catch {
      toast.error("حدث خطأ أثناء الاتصال بخادم التحديثات");
    } finally {
      setIsChecking(false);
      void fetchStatus();
    }
  };

  const handleDownload = async () => {
    if (!window.desktopAPI?.updates) return;
    setIsDownloading(true);
    await window.desktopAPI.updates.download();
    setIsDownloading(false);
  };

  const handleCancelDownload = async () => {
    if (!window.desktopAPI?.updates) return;
    await window.desktopAPI.updates.cancelDownload();
    setIsDownloading(false);
    toast.info("تم إيقاف/إلغاء التحميل");
  };

  const handleInstall = async () => {
    if (!window.desktopAPI?.updates) return;
    setIsInstalling(true);
    await window.desktopAPI.updates.install();
  };

  const formattedLastCheck = status?.lastCheckAt
    ? new Date(status.lastCheckAt).toLocaleString("ar-EG", {
        year: "numeric",
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "لم يتم الفحص بعد";

  const hasUpdateAvailable = Boolean(
    status?.release && isNewerVersion(status.release.version, status.currentVersion)
  );

  const downloadProgress = status?.downloadPercent || 0;
  const isCurrentlyDownloading = isDownloading || status?.phase === "downloading";
  const totalBytes = transfer?.total || status?.release?.artifactSize;
  const updateSize = formatUpdateSize(totalBytes);
  const transferred = formatDownloadedOf(downloadProgress, totalBytes, transfer?.transferred);

  return (
    <Card className="lg:col-span-2">
      <CardHeader
        title="تحديثات النظام التلقائية"
        subtitle="متابعة الإصدارات الجديدة وتحديث التطبيق تلقائياً دون الحاجة لإعادة التثبيت اليدوي"
      />
      <CardBody className="space-y-6" dir="rtl">
        {/* Status Summary Box */}
        <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-slate-200 bg-slate-50/50 p-4 dark:border-slate-700 dark:bg-slate-800/50">
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-emerald-100 p-2.5 text-emerald-600 dark:bg-emerald-950/50 dark:text-emerald-400">
              <ShieldCheck className="h-6 w-6" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-bold text-slate-800 dark:text-slate-100">
                  الإصدار الحالي: v{status?.currentVersion || "1.0.0"}
                </span>
                {hasUpdateAvailable && status?.phase !== "downloaded" && (
                  <span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-semibold text-amber-800 dark:bg-amber-900/50 dark:text-amber-300">
                    يتوفر تحديث v{status?.release?.version}
                  </span>
                )}
                {status?.phase === "downloaded" && (
                  <span className="rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-semibold text-emerald-800 dark:bg-emerald-900/50 dark:text-emerald-300">
                    التحديث جاهز للتثبيت
                  </span>
                )}
              </div>
              <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                آخر تحقق: {formattedLastCheck}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {status?.phase === "downloaded" ? (
              <Button
                variant="primary"
                onClick={handleInstall}
                disabled={isInstalling}
                className="bg-emerald-600 hover:bg-emerald-700 text-white font-medium shadow-md transition-all animate-pulse"
              >
                <CheckCircle2 className="ml-1.5 h-4 w-4" />
                تثبيت التحديث الآن (v{status?.release?.version})
              </Button>
            ) : isCurrentlyDownloading ? (
              <div className="flex items-center gap-2">
                <Button
                  variant="primary"
                  disabled={true}
                  className="relative overflow-hidden bg-amber-500 text-white font-bold shadow-md cursor-wait"
                >
                  {/* Fill tracks real download progress behind the label. */}
                  <span
                    className="absolute inset-y-0 right-0 bg-emerald-500/70 transition-all duration-300 ease-out"
                    style={{ width: `${Math.min(100, Math.max(0, downloadProgress))}%` }}
                    aria-hidden="true"
                  />
                  <span className="relative flex items-center">
                    <RefreshCw className="ml-1.5 h-4 w-4 animate-spin" />
                    جارٍ التحميل ({downloadProgress}%)
                  </span>
                </Button>
                <Button
                  variant="secondary"
                  onClick={handleCancelDownload}
                  className="border-red-300 text-red-600 hover:bg-red-50 dark:border-red-800 dark:text-red-400 dark:hover:bg-red-950/30"
                  title="إلغاء التحميل"
                >
                  <X className="h-4 w-4 ml-1" />
                  إلغاء التحميل
                </Button>
              </div>
            ) : hasUpdateAvailable ? (
              <Button
                variant="primary"
                onClick={handleDownload}
                className="bg-amber-500 hover:bg-amber-600 text-white font-bold shadow-md transition-all animate-pulse"
              >
                <Download className="ml-1.5 h-4 w-4" />
                تحميل التحديث (v{status?.release?.version})
                {updateSize && (
                  <span className="mr-1.5 rounded bg-black/15 px-1.5 py-0.5 text-[11px] font-semibold">
                    {updateSize}
                  </span>
                )}
              </Button>
            ) : (
              <Button
                variant="secondary"
                onClick={handleCheckNow}
                disabled={isChecking || status?.phase === "checking"}
              >
                <RefreshCw className={`ml-1.5 h-4 w-4 ${isChecking || status?.phase === "checking" ? "animate-spin" : ""}`} />
                التحقق الآن
              </Button>
            )}
          </div>
        </div>

        {/* Active Download Progress Card */}
        {isCurrentlyDownloading && (
          <div className="rounded-xl border border-amber-300 bg-amber-50/70 p-4 dark:border-amber-700/50 dark:bg-amber-950/30 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-amber-900 dark:text-amber-200 font-bold">
                <Download className="h-5 w-5 animate-bounce text-amber-600" />
                <span>جارٍ تنزيل ملف التحديث v{status?.release?.version}</span>
              </div>
              <span className="text-sm font-black text-amber-700 dark:text-amber-300">
                {downloadProgress}%
              </span>
            </div>

            {/* Progress Bar Container */}
            <div className="w-full h-3 bg-amber-200 dark:bg-amber-900/60 rounded-full overflow-hidden p-0.5">
              <div
                className="relative h-full overflow-hidden rounded-full bg-gradient-to-r from-amber-500 to-emerald-500 shadow-sm transition-all duration-300"
                style={{ width: `${Math.min(100, Math.max(2, downloadProgress))}%` }}
              >
                <span className="absolute inset-0 animate-pulse bg-white/25" aria-hidden="true" />
              </div>
            </div>

            <div className="flex items-center justify-between text-xs text-amber-800 dark:text-amber-300 pt-1">
              <span className="flex items-center gap-1">
                <HardDrive className="h-3.5 w-3.5" />
                {transferred
                  ? `تم تنزيل ${transferred}`
                  : "جارٍ تحديد حجم التحديث..."}
              </span>
              <button
                onClick={handleCancelDownload}
                className="text-red-600 hover:text-red-700 dark:text-red-400 font-semibold underline flex items-center gap-1 cursor-pointer"
              >
                <X className="h-3.5 w-3.5" />
                إيقاف مؤقت / إلغاء التحميل
              </button>
            </div>
          </div>
        )}

        {/* Release Features & Changelog details */}
        {status?.release && (
          <div className="rounded-xl border border-emerald-200 bg-emerald-50/50 p-4 dark:border-emerald-800/40 dark:bg-emerald-950/20 space-y-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-emerald-800 dark:text-emerald-300 font-bold text-base">
                <Sparkles className="h-5 w-5 text-emerald-600" />
                <span>مميزات وتفاصيل الإصدار الجديد v{status.release.version}</span>
              </div>
              <div className="flex items-center gap-2">
                {updateSize && (
                  <span className="flex items-center gap-1 rounded-md bg-slate-100 px-2 py-0.5 text-xs font-bold text-slate-700 dark:bg-slate-800 dark:text-slate-300">
                    <HardDrive className="h-3 w-3" />
                    {updateSize}
                  </span>
                )}
                <span className="rounded-md bg-emerald-100 dark:bg-emerald-900/60 px-2 py-0.5 text-xs font-bold text-emerald-800 dark:text-emerald-200">
                  {status.release.title || "تحديث شامل"}
                </span>
              </div>
            </div>
            <div className="bg-white/80 dark:bg-slate-900/60 p-3 rounded-lg border border-emerald-100 dark:border-emerald-900/30 text-sm text-slate-700 dark:text-slate-300 leading-relaxed">
              <p className="font-medium whitespace-pre-wrap">
                {status.release.notes?.trim() ||
                  "يتضمن هذا التحديث تحسينات في الأداء وسرعة المعالجة وتحديثات أمنية هامة."}
              </p>
            </div>
          </div>
        )}

        {/* Preferences Toggles */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <label className="flex items-start gap-3 rounded-lg border border-slate-200 p-3.5 hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800/40 cursor-pointer transition-colors">
            <input
              type="checkbox"
              checked={prefs.autoCheck}
              onChange={() => handleTogglePref("autoCheck")}
              className="mt-1 h-4 w-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
            />
            <div>
              <span className="block text-sm font-semibold text-slate-800 dark:text-slate-200">
                الفحص التلقائي
              </span>
              <span className="block text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                البحث عن التحديثات تلقائياً عند الاتصال بالإنترنت
              </span>
            </div>
          </label>

          <label className="flex items-start gap-3 rounded-lg border border-slate-200 p-3.5 hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800/40 cursor-pointer transition-colors">
            <input
              type="checkbox"
              checked={prefs.autoDownload}
              onChange={() => handleTogglePref("autoDownload")}
              className="mt-1 h-4 w-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
            />
            <div>
              <span className="block text-sm font-semibold text-slate-800 dark:text-slate-200">
                التحميل التلقائي
              </span>
              <span className="block text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                تنزيل التحديثات العادية في الخلفية فور صدورها
              </span>
            </div>
          </label>

          <label className="flex items-start gap-3 rounded-lg border border-slate-200 p-3.5 hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800/40 cursor-pointer transition-colors">
            <input
              type="checkbox"
              checked={prefs.autoInstallOnQuit}
              onChange={() => handleTogglePref("autoInstallOnQuit")}
              className="mt-1 h-4 w-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
            />
            <div>
              <span className="block text-sm font-semibold text-slate-800 dark:text-slate-200">
                تثبيت عند الإغلاق
              </span>
              <span className="block text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                تطبيق التحديث المحمل تلقائياً عند إغلاق التطبيق
              </span>
            </div>
          </label>
        </div>
      </CardBody>
    </Card>
  );
}
