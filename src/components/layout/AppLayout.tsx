import { useEffect, useRef, useState, Suspense } from "react";
import type { ReactNode } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { AlertTriangle, X, Globe } from "lucide-react";
import { Sidebar } from "./Sidebar";
import { Topbar } from "./Topbar";
import { LockScreen } from "./LockScreen";
import { PageLoading } from "./PageLoading";
import { GlobalSearch } from "../GlobalSearch";
import { useAuth } from "../../store/AuthContext";
import { useSettings } from "../../store/SettingsContext";
import { lsGet, lsSet } from "../../lib/storage";
import { WhatsNewDialog } from "../WhatsNewDialog";
import { RELEASES, releasesSince, compareVersions, type Release } from "../../lib/whatsNew";
import { useFeatures } from "../../lib/useFeatures";

const WHATS_NEW_KEY = "whatsNew_lastSeenVersion";

export function AppLayout({ children }: { children: ReactNode }) {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() =>
    lsGet("sidebarCollapsed", false)
  );
  const { isLocked, lockSession, licenseStatus } = useAuth();
  const { settings } = useSettings();
  const { isEnabled } = useFeatures();
  const navigate = useNavigate();
  const [renewDismissed, setRenewDismissed] = useState(false);
  const [subDaysLeft, setSubDaysLeft] = useState<number | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // "What's New": after the installed version changes, show the highlights of
  // the releases the user hasn't acknowledged yet. Offline — compares the
  // built-in version against a locally stored baseline. The footer version chip
  // also opens this (showing the full changelog).
  const [globalSearchOpen, setGlobalSearchOpen] = useState(false);
  const [whatsNewOpen, setWhatsNewOpen] = useState(false);
  const [whatsNewReleases, setWhatsNewReleases] = useState<Release[]>([]);
  useEffect(() => {
    const lastSeen = lsGet<string | null>(WHATS_NEW_KEY, null);
    if (!lastSeen) {
      // No baseline stored — either a truly fresh install OR an existing user
      // upgrading for the first time to a version that includes this feature.
      // Show only the current version's highlights so upgrades aren't silent,
      // while fresh installs still see what they just got.
      const currentRelease = RELEASES.find((r) => r.version === __APP_VERSION__);
      if (currentRelease) {
        setWhatsNewReleases([currentRelease]);
        setWhatsNewOpen(true);
      }
      lsSet(WHATS_NEW_KEY, __APP_VERSION__);
      return;
    }
    if (compareVersions(__APP_VERSION__, lastSeen) > 0) {
      const pending = releasesSince(lastSeen);
      if (pending.length > 0) {
        setWhatsNewReleases(pending);
        setWhatsNewOpen(true);
      }
      // Advance the baseline regardless, so we don't re-check every launch even
      // when the changelog has no entry for the new version.
      lsSet(WHATS_NEW_KEY, __APP_VERSION__);
    }
  }, []);

  // Global search: Ctrl+K (or Ctrl+/) from anywhere in the app.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && (e.key === "k" || e.key === "/") && !isLocked) {
        e.preventDefault();
        setGlobalSearchOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isLocked]);

  // Proactive renewal reminder: warn when a limited subscription is within 14
  // days of expiry so the owner can renew before the system locks. Computed in
  // an effect (re-checked hourly) to keep render pure.
  const expiresAt =
    licenseStatus?.license?.subscriptionType === "limited"
      ? licenseStatus.license.subscriptionExpiresAt
      : null;
  useEffect(() => {
    if (!expiresAt) {
      setSubDaysLeft(null);
      return;
    }
    const compute = () =>
      setSubDaysLeft(Math.ceil((new Date(expiresAt).getTime() - Date.now()) / 86400000));
    compute();
    const id = window.setInterval(compute, 60 * 60 * 1000);
    return () => window.clearInterval(id);
  }, [expiresAt]);
  const showRenewBanner =
    subDaysLeft !== null && subDaysLeft >= 0 && subDaysLeft <= 14 && !renewDismissed;

  // The copyright footer is shown only on the Settings page.
  const showFooter = useLocation().pathname === "/settings";

  useEffect(() => {
    lsSet("sidebarCollapsed", sidebarCollapsed);
  }, [sidebarCollapsed]);

  useEffect(() => {
    const minutes = isEnabled("advancedSecurity") ? (settings.idleLockMinutes ?? 0) : 0;
    if (!minutes || isLocked) return;
    const ms = minutes * 60 * 1000;

    function reset() {
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(lockSession, ms);
    }

    const events = ["mousemove", "keydown", "click", "touchstart", "scroll"] as const;
    events.forEach((ev) => window.addEventListener(ev, reset, { passive: true }));
    reset();

    return () => {
      events.forEach((ev) => window.removeEventListener(ev, reset));
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [settings.idleLockMinutes, isLocked, lockSession, isEnabled]);

  return (
    <div className="h-screen overflow-hidden flex bg-canvas" dir="rtl">
      {isLocked && <LockScreen />}
      <GlobalSearch open={globalSearchOpen} onClose={() => setGlobalSearchOpen(false)} />
      <WhatsNewDialog
        open={whatsNewOpen}
        onClose={() => setWhatsNewOpen(false)}
        releases={whatsNewReleases}
        currentVersion={__APP_VERSION__}
      />
      <div className="no-print">
        <Sidebar collapsed={sidebarCollapsed} />
      </div>
      <div className="flex-1 min-w-0 min-h-0 flex flex-col">
        <div className="no-print">
          <Topbar
            sidebarCollapsed={sidebarCollapsed}
            onToggleSidebar={() => setSidebarCollapsed((value) => !value)}
            onOpenSearch={() => setGlobalSearchOpen(true)}
          />
        </div>

        {showRenewBanner && (
          <div
            className={`no-print shrink-0 flex items-center justify-between gap-3 px-5 py-2.5 text-sm font-bold border-b ${
              (subDaysLeft as number) <= 3
                ? "bg-rose-50 dark:bg-rose-500/10 text-rose-700 dark:text-rose-400 border-rose-200 dark:border-rose-500/30"
                : "bg-amber-50 dark:bg-amber-500/10 text-amber-800 dark:text-amber-400 border-amber-200 dark:border-amber-500/30"
            }`}
          >
            <div className="flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              <span>
                {subDaysLeft === 0
                  ? "اشتراكك ينتهي اليوم — جدّد الآن قبل توقّف النظام"
                  : `اشتراكك ينتهي خلال ${subDaysLeft} يوم — جدّد الآن قبل توقّف النظام`}
              </span>
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              <button
                onClick={() => navigate("/settings")}
                className={`h-7 px-3 rounded-lg text-white text-xs font-bold transition-colors ${
                  (subDaysLeft as number) <= 3 ? "bg-rose-600 hover:bg-rose-700" : "bg-amber-600 hover:bg-amber-700"
                }`}
              >
                تجديد الآن
              </button>
              <button
                onClick={() => setRenewDismissed(true)}
                aria-label="إخفاء"
                className="w-7 h-7 grid place-items-center rounded-lg hover:bg-black/5 transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}

        <main className="flex-1 min-h-0 overflow-x-hidden overflow-y-auto p-5 space-y-5">
          <Suspense fallback={<PageLoading />}>
            {children}
          </Suspense>
        </main>

        {showFooter && (
        <footer className="no-print shrink-0 py-6 px-5 border-t border-line bg-surface">
          <div className="flex flex-col md:flex-row items-center justify-between gap-4 text-xs text-ink-muted">
            <div className="flex items-center gap-2">
              <span className="font-bold text-brand-600">© 2026 جميع الحقوق محفوظة لشركة Helpers Technologies</span>
              <span className="hidden md:inline">|</span>
              <button
                type="button"
                onClick={() => {
                  setWhatsNewReleases(RELEASES);
                  setWhatsNewOpen(true);
                }}
                className="hover:text-brand-600 underline-offset-2 hover:underline transition-colors"
                title="عرض ما الجديد"
              >
                نظام قطع الغيار والمبيعات — الإصدار {__APP_VERSION__}
              </button>
            </div>
            <div className="flex items-center gap-6">
              <a href="https://wa.me/201118445625" target="_blank" rel="noreferrer" className="hover:text-emerald-600 dark:hover:text-emerald-400 flex items-center gap-1.5 transition-colors">
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" viewBox="0 0 16 16" className="w-4 h-4">
                  <path d="M13.601 2.326A7.854 7.854 0 0 0 7.994 0C3.627 0 .068 3.558.064 7.926c0 1.399.366 2.76 1.057 3.965L0 16l4.204-1.102a7.933 7.933 0 0 0 3.79.965h.004c4.368 0 7.926-3.558 7.93-7.93A7.898 7.898 0 0 0 13.6 2.326zM7.994 14.521a6.573 6.573 0 0 1-3.356-.92l-.24-.144-2.494.654.666-2.433-.156-.251a6.56 6.56 0 0 1-1.007-3.505c0-3.626 2.957-6.584 6.591-6.584a6.56 6.56 0 0 1 4.66 1.931 6.557 6.557 0 0 1 1.928 4.66c-.004 3.639-2.961 6.592-6.592 6.592zm3.615-4.934c-.197-.099-1.17-.578-1.353-.646-.182-.065-.315-.099-.445.099-.133.197-.513.646-.627.775-.114.133-.232.148-.43.05-.197-.1-.836-.308-1.592-.985-.59-.525-.985-1.175-1.103-1.372-.114-.198-.011-.304.088-.403.087-.088.197-.232.296-.346.1-.114.133-.198.198-.33.065-.134.034-.248-.015-.347-.05-.099-.445-1.076-.612-1.47-.16-.389-.323-.335-.445-.34-.114-.004-.247-.007-.38-.007a.729.729 0 0 0-.529.247c-.182.198-.691.677-.691 1.654 0 .977.71 1.916.81 2.049.098.133 1.394 2.132 3.383 2.992.47.205.84.326 1.129.418.475.152.904.129 1.246.08.38-.058 1.171-.48 1.338-.943.164-.464.164-.86.114-.943-.049-.084-.182-.133-.38-.232z"/>
                </svg>
                <span>واتساب الدعم: +201118445625</span>
              </a>
              <a href="https://helpers-tech.com/" target="_blank" rel="noreferrer" className="hover:text-brand-600 flex items-center gap-1.5 transition-colors">
                <Globe className="w-4 h-4" />
                <span>الموقع الرسمي: helpers-tech.com</span>
              </a>
            </div>
          </div>
        </footer>
        )}
      </div>
    </div>
  );
}

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div>
        <h2 className="text-xl font-semibold text-ink">{title}</h2>
        {description ? (
          <p className="text-sm text-ink-muted mt-0.5">{description}</p>
        ) : null}
      </div>
      {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
    </div>
  );
}
