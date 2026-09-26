import { useEffect, useRef, useState } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "../../store/AuthContext";
import { AppBootScreen } from "./AppBootScreen";
import { AppLayout } from "./AppLayout";
import { useToast } from "../ui/Toast";
import { hasPermission } from "../../lib/permissions";
import { useFeatures } from "../../lib/useFeatures";
import { FEATURE_MAP, featureEntitlementMessage, type FeatureKey } from "../../lib/features";
import type { UserPermissions } from "../../types";

/**
 * True once the very first authenticated screen of this session has been
 * allowed to paint.
 *
 * Signing in swaps the login page for the dashboard, and on a large shop that
 * first render blocks the main thread for seconds — during which the browser
 * has nothing to show but white. Yielding two frames first means the boot
 * screen is ON SCREEN before the expensive tree starts building.
 *
 * Module-level, so it costs those two frames once per session and not on every
 * navigation afterwards.
 */
let firstScreenPainted = false;

function useFirstScreenGate(): boolean {
  const [ready, setReady] = useState(firstScreenPainted);
  useEffect(() => {
    if (ready) return;
    const frame = requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        firstScreenPainted = true;
        setReady(true);
      }),
    );
    return () => cancelAnimationFrame(frame);
  }, [ready]);
  return ready;
}

/**
 * Redirects, and says why — from an effect, never from render.
 *
 * These three refusals used to call `setTimeout(() => toast.error(...), 0)`
 * inline before returning `<Navigate>`, i.e. a side effect scheduled during
 * the render phase. Each toast re-rendered this component, which scheduled
 * another one; meanwhile React Router commits its redirect inside a
 * `startTransition`, and every default-priority toast update preempted that
 * transition before it could land. The result was a blank window — `<Navigate>`
 * renders null, and the replacement tree never got to commit — with the toasts
 * still visible because they are portalled to document.body, outside #root.
 *
 * Hooks cannot run after the early returns above, so the effect lives here, in
 * a component that only mounts when the refusal actually happens.
 */
function RedirectWithToast({
  to,
  title,
  description,
}: {
  to: string;
  title: string;
  description: string;
}) {
  const toast = useToast();
  const announced = useRef(false);
  useEffect(() => {
    // StrictMode double-invokes mount effects in development; the shop should
    // not see the same refusal twice.
    if (announced.current) return;
    announced.current = true;
    toast.error(title, description);
    // Fires once on mount. The messages are constant per mount, and re-running
    // on a new toast identity would reintroduce the loop this replaced.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return <Navigate to={to} replace />;
}

export function ProtectedShell({
  children,
  permission,
  permissionAction = "view",
  ownerOnly,
  feature,
}: {
  children: React.ReactNode;
  permission?: keyof UserPermissions;
  permissionAction?: string;
  ownerOnly?: boolean;
  feature?: FeatureKey;
}) {
  const { auth, currentUser } = useAuth();
  const { isEnabled } = useFeatures();
  const loc = useLocation();
  const firstScreenReady = useFirstScreenGate();

  if (!auth.isAuthenticated || !currentUser) {
    return <Navigate to="/login" state={{ from: loc.pathname }} replace />;
  }

  // Module disabled by the license package or hidden by the owner — keep the
  // route unreachable even via a direct URL.
  if (feature && !isEnabled(feature)) {
    const label = FEATURE_MAP[feature]?.label ?? feature;
    return (
      <RedirectWithToast
        to="/"
        title="ميزة غير متاحة في باقتك الحالية"
        description={featureEntitlementMessage(feature, label)}
      />
    );
  }

  if (currentUser.role !== "owner") {
    if (ownerOnly) {
      return (
        <RedirectWithToast
          to="/"
          title="ليس لديك صلاحية"
          description="هذه الصفحة مخصصة للمدير فقط"
        />
      );
    }
    if (permission && !hasPermission(currentUser, permission, permissionAction)) {
      return (
        <RedirectWithToast
          to="/"
          title="ليس لديك صلاحية"
          description="لا تملك صلاحية لفتح هذه الصفحة"
        />
      );
    }
  }

  // The gate is checked LAST, after every redirect above: a user without
  // permission for this route should be sent away, not shown a loading screen
  // on the way to being sent away.
  if (!firstScreenReady) {
    return <AppBootScreen delayMs={0} />;
  }

  return <AppLayout>{children}</AppLayout>;
}
