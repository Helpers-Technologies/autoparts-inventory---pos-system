import { useContext, useEffect, useState } from "react";
import { SettingsContext } from "../../store/SettingsContext";

/**
 * What the shop looks at while the app is building the first screen.
 *
 * Signing in on a five-year shop leaves the window BLANK — the login page has
 * unmounted and the dashboard's first render has not painted yet — and a blank
 * white window is indistinguishable from a crash. This is what fills that gap.
 *
 * It deliberately does NOT appear immediately. The original fallback returned
 * null precisely so a fast load would not flash a spinner for 80 ms, and that
 * reasoning still holds; the delay keeps it. What changed is that a load which
 * takes seconds now says so instead of showing nothing.
 */
export function AppBootScreen({
  message = "جاري تحميل بيانات المحل...",
  hint = "المحلات اللي عندها تاريخ كبير بتاخد وقت أطول شوية في أول فتح.",
  delayMs = 250,
}: {
  message?: string;
  hint?: string;
  /** Nothing is drawn before this; a fast load stays flicker-free. */
  delayMs?: number;
}) {
  const [visible, setVisible] = useState(delayMs === 0);
  // Read straight off the context rather than through useSettings, which
  // throws when there is no provider — and this screen is also used as a
  // Suspense fallback that can render above one.
  const settingsContext = useContext(SettingsContext);
  const settings = settingsContext?.settings;
  const shopName =
    (settings?.arabicLabels ? settings.companyNameAr : settings?.companyName) || "PartFlow";
  const logoImage = settings?.logoImage || undefined;
  const logoText = settings?.logoText || undefined;

  useEffect(() => {
    if (delayMs === 0) return;
    const timer = window.setTimeout(() => setVisible(true), delayMs);
    return () => window.clearTimeout(timer);
  }, [delayMs]);

  if (!visible) return null;

  return (
    <div
      dir="rtl"
      role="status"
      aria-live="polite"
      className="fixed inset-0 z-40 grid place-items-center bg-canvas"
    >
      <div className="flex w-full max-w-xs flex-col items-center gap-4 px-6 text-center">
        <div className="grid h-16 w-16 place-items-center overflow-hidden rounded-2xl bg-gradient-to-br from-brand-600 to-brand-800 text-xl font-bold text-white shadow-lg">
          {logoImage ? (
            <img src={logoImage} alt="" className="h-full w-full object-contain" />
          ) : (
            logoText || "AP"
          )}
        </div>

        <div className="space-y-1">
          <div className="text-sm font-bold text-ink">{shopName}</div>
          <div className="text-xs text-ink-muted">{message}</div>
        </div>

        {/* An indeterminate bar, not a percentage: the app genuinely does not
            know how far along it is, and a fake percentage that stalls at 90%
            is worse than an honest one that just moves. */}
        <div className="h-1 w-full overflow-hidden rounded-full bg-surface-muted">
          <div className="boot-progress h-full w-1/3 rounded-full bg-brand-600" />
        </div>

        <p className="text-[11px] leading-relaxed text-ink-faint">{hint}</p>
      </div>
    </div>
  );
}
