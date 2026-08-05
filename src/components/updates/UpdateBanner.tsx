import { useEffect, useState } from "react";
import {
  Download,
  RefreshCw,
  AlertTriangle,
  ShieldAlert,
  X,
  CheckCircle2,
  Sparkles,
} from "lucide-react";
import { Button } from "../ui/Button";
import { formatUpdateSize, formatDownloadedOf } from "./updateFormat";

type UpdateState = {
  phase: "idle" | "checking" | "available" | "downloading" | "downloaded" | "installing" | "error";
  release: {
    id: string;
    version: string;
    title: string;
    /** Release notes the admin wrote in the portal. */
    notes?: string;
    severity: "normal" | "important" | "critical" | "emergency";
    publishedAt: string | null;
    mandatoryDeadlineAt?: string | null;
    artifactSize?: number | null;
  } | null;
  downloadPercent: number;
  error: string | null;
  // Only carried by the initial getStatus() response, not by onStateChanged
  // broadcasts — genuinely absent if a broadcast lands before that resolves.
  canSkip?: boolean;
  blocked?: boolean;
  persistent?: boolean;
  currentVersion?: string;
};

export function UpdateBanner() {
  const [state, setState] = useState<UpdateState | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);
  const [isInstalling, setIsInstalling] = useState(false);
  const [transfer, setTransfer] = useState<{ transferred: number; total: number } | null>(null);

  useEffect(() => {
    const api = window.desktopAPI?.updates;
    if (!api) return;

    void api.getStatus().then((res) => {
      if (res.ok) {
        setState(res as unknown as UpdateState);
      }
    });

    const unsubState = api.onStateChanged((newState) => {
      setState((prev) => ({ ...(prev || {}), ...newState }));
    });

    const unsubProgress = api.onDownloadProgress(({ percent, transferred, total }) => {
      if (total) setTransfer({ transferred: transferred || 0, total });
      setState((prev) => (prev ? { ...prev, phase: "downloading", downloadPercent: percent } : prev));
    });

    const unsubDownloaded = api.onDownloaded(({ release, blocked }) => {
      setState((prev) =>
        prev
          ? {
              ...prev,
              phase: "downloaded",
              release,
              blocked,
              downloadPercent: 100,
            }
          : prev
      );
      setIsDownloading(false);
    });

    const unsubBlocked = api.onBlocked(({ release }) => {
      setState((prev) => (prev ? { ...prev, release, blocked: true } : prev));
    });

    return () => {
      unsubState();
      unsubProgress();
      unsubDownloaded();
      unsubBlocked();
    };
  }, []);

  if (!state || !state.release || (dismissed && !state.blocked && state.release.severity === "normal")) {
    return null;
  }

  const { release, phase, downloadPercent, blocked, canSkip } = state;
  const isEmergency = release.severity === "emergency" || release.severity === "critical";
  const totalBytes = transfer?.total || release.artifactSize;
  const updateSize = formatUpdateSize(totalBytes);
  const transferred = formatDownloadedOf(downloadPercent, totalBytes, transfer?.transferred);

  const handleDownload = async () => {
    if (!window.desktopAPI?.updates) return;
    setIsDownloading(true);
    await window.desktopAPI.updates.download();
  };

  const handleInstall = async () => {
    if (!window.desktopAPI?.updates) return;
    setIsInstalling(true);
    await window.desktopAPI.updates.install();
  };

  const handleSkip = async () => {
    if (!window.desktopAPI?.updates || !canSkip) return;
    setDismissed(true);
    await window.desktopAPI.updates.skipRelease(release.id);
  };

  // Full blocking overlay for Critical / Emergency updates when required
  if (blocked && (phase === "downloaded" || isEmergency)) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/90 backdrop-blur-md p-4" dir="rtl">
        <div className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-2xl dark:bg-slate-800 dark:border dark:border-slate-700">
          <div className="flex items-center gap-3 text-red-600 dark:text-red-400 mb-4">
            <div className="rounded-full bg-red-100 p-3 dark:bg-red-950/50">
              <ShieldAlert className="h-8 w-8" />
            </div>
            <div>
              <h3 className="text-xl font-bold">تحديث أمني إجباري مطلوب</h3>
              <p className="text-sm text-slate-500 dark:text-slate-400">
                النسخة v{release.version} تتضمن إصلاحات هامة ويجب التحديث للاستمرار.
              </p>
            </div>
          </div>

          <div className="my-4 rounded-xl bg-slate-50 p-4 dark:bg-slate-900/50 border border-slate-200 dark:border-slate-700">
            <h4 className="font-semibold text-slate-800 dark:text-slate-200">{release.title}</h4>
            <p className="mt-1 whitespace-pre-wrap text-sm text-slate-600 dark:text-slate-300">{release.notes}</p>
          </div>

          {phase === "downloading" && (
            <div className="my-4 space-y-2">
              <div className="flex justify-between text-xs text-slate-600 dark:text-slate-300 font-medium">
                <span>{transferred ? `جاري تحميل التحديث — ${transferred}` : "جاري تحميل التحديث..."}</span>
                <span>{downloadPercent}%</span>
              </div>
              <div className="h-2.5 w-full rounded-full bg-slate-200 dark:bg-slate-700 overflow-hidden">
                <div
                  className="relative h-full overflow-hidden bg-emerald-500 transition-all duration-300"
                  style={{ width: `${Math.min(100, Math.max(2, downloadPercent))}%` }}
                >
                  <span className="absolute inset-0 animate-pulse bg-white/25" aria-hidden="true" />
                </div>
              </div>
            </div>
          )}

          <div className="mt-6 flex flex-col gap-2">
            {phase === "downloaded" ? (
              <Button
                variant="primary"
                className="w-full justify-center bg-red-600 hover:bg-red-700 text-white"
                onClick={handleInstall}
                disabled={isInstalling}
              >
                <RefreshCw className={`ml-2 h-4 w-4 ${isInstalling ? "animate-spin" : ""}`} />
                إعادة التشغيل والتثبيت الآن
              </Button>
            ) : (
              <Button
                variant="primary"
                className="w-full justify-center bg-red-600 hover:bg-red-700 text-white"
                onClick={handleDownload}
                disabled={isDownloading || phase === "downloading"}
              >
                {isDownloading || phase === "downloading" ? (
                  <RefreshCw className="ml-2 h-4 w-4 animate-spin" />
                ) : (
                  <Download className="ml-2 h-4 w-4" />
                )}
                تنزيل التحديث الآن ({release.version}){updateSize ? ` — ${updateSize}` : ""}
              </Button>
            )}
          </div>
        </div>
      </div>
    );
  }

  // Top banner styling based on severity
  const bgStyle =
    release.severity === "important"
      ? "bg-amber-500 text-slate-950 dark:bg-amber-600 dark:text-white"
      : "bg-emerald-600 text-white dark:bg-emerald-700";

  return (
    <div className={`${bgStyle} px-4 py-2.5 shadow-md relative z-40 transition-all`} dir="rtl">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 text-sm font-medium">
        <div className="flex items-center gap-2">
          {release.severity === "important" ? (
            <AlertTriangle className="h-5 w-5 shrink-0" />
          ) : (
            <Sparkles className="h-5 w-5 shrink-0" />
          )}
          <span>
            <strong>يتوفر تحديث جديد (v{release.version}):</strong> {release.title}
          </span>
        </div>

        <div className="flex items-center gap-2">
          {phase === "downloading" ? (
            <div className="flex min-w-[230px] flex-col gap-1 rounded-lg bg-black/10 px-3 py-1.5 dark:bg-white/10">
              <div className="flex items-center gap-2">
                <RefreshCw className="h-4 w-4 animate-spin" />
                <span className="font-bold">جاري التحميل ({downloadPercent}%)</span>
              </div>
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-black/20 dark:bg-white/20">
                <div
                  className="h-full rounded-full bg-white/90 transition-all duration-300 ease-out"
                  style={{ width: `${Math.min(100, Math.max(2, downloadPercent))}%` }}
                />
              </div>
              {transferred && <span className="text-[11px] opacity-90">{transferred}</span>}
            </div>
          ) : phase === "downloaded" ? (
            <Button
              size="sm"
              className="bg-white text-slate-900 hover:bg-slate-100 font-bold"
              onClick={handleInstall}
              disabled={isInstalling}
            >
              <CheckCircle2 className="ml-1.5 h-4 w-4 text-emerald-600" />
              إعادة التشغيل للتثبيت
            </Button>
          ) : (
            <Button
              size="sm"
              className="bg-white text-slate-900 hover:bg-slate-100 font-bold"
              onClick={handleDownload}
              disabled={isDownloading}
            >
              {isDownloading ? (
                <RefreshCw className="ml-1.5 h-4 w-4 animate-spin" />
              ) : (
                <Download className="ml-1.5 h-4 w-4" />
              )}
              تحديث الآن
              {updateSize && (
                <span className="mr-1.5 rounded bg-slate-900/10 px-1.5 py-0.5 text-[11px] font-semibold">
                  {updateSize}
                </span>
              )}
            </Button>
          )}

          {canSkip && phase !== "downloading" && phase !== "downloaded" && (
            <button
              onClick={handleSkip}
              className="rounded-lg p-1 hover:bg-black/10 dark:hover:bg-white/10 transition-colors"
              title="تجاهل هذا التحديث"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
