import { useEffect, useMemo, useRef, useState } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "../../store/AuthContext";
import { AppBootScreen } from "./AppBootScreen";
import { AppLayout } from "./AppLayout";
import { useToast } from "../ui/Toast";
import { hasPermission } from "../../lib/permissions";
import { useFeatures } from "../../lib/useFeatures";
import { FEATURE_MAP, featureEntitlementMessage, type FeatureKey } from "../../lib/features";
import type { UserPermissions } from "../../types";
import { useCollectionHydration, type DeferredCollection } from "../../store/HydrationContext";
import { useInvoicing } from "../../store/InvoicingContext";

function requiredCollections(pathname: string): DeferredCollection[] {
  if (pathname === "/") return [];
  // Phase 12 list pages use bounded SQL-backed pages.  Detail/edit/new routes
  // retain their existing hydrated business model until they are explicitly
  // migrated; exact matching here prevents broadening that boundary.
  if (pathname === "/sales") return ["customers"];
  if (pathname === "/pos") return [];
  if (pathname === "/purchases") return [];
  if (pathname.startsWith("/audit-log")) return [];
  if (pathname === "/quotations") return [];
  if (pathname.startsWith("/quotations")) return ["customers", "quotations", "salesInvoices", "cashEntries"];
  if (pathname.startsWith("/customer-garage")) return ["customers"];
  if (pathname.startsWith("/marketing")) return ["customers", "salesInvoices"];
  if (pathname.startsWith("/warranty-center")) return ["customers", "salesInvoices", "salesReturns"];
  if (pathname === "/customers") return ["customers"];
  if (/^\/customers\/[^/]+$/.test(pathname)) return [];
  if (pathname.startsWith("/customers")) return ["customers", "salesInvoices", "salesReturns", "cashEntries"];
  if (pathname === "/suppliers" || /^\/suppliers\/[^/]+$/.test(pathname)) return [];
  if (pathname.startsWith("/suppliers")) return ["purchaseInvoices", "purchaseReturns", "cashEntries"];
  if (pathname.startsWith("/purchases") || pathname.startsWith("/purchasing-assistant")) {
    return ["purchaseInvoices", "purchaseReturns", "cashEntries"];
  }
  if (pathname.startsWith("/sales") || pathname.startsWith("/pos") || pathname.startsWith("/shipping")) {
    return ["customers", "salesInvoices", "salesReturns", "cashEntries", "quotations"];
  }
  if (pathname === "/returns") return [];
  if (pathname.startsWith("/returns")) {
    return ["customers", "salesInvoices", "purchaseInvoices", "salesReturns", "purchaseReturns", "cashEntries"];
  }
  if (
    pathname.startsWith("/cashbox") ||
    pathname.startsWith("/reports") ||
    pathname.startsWith("/employees") ||
    pathname.startsWith("/users/")
  ) {
    return ["customers", "salesInvoices", "purchaseInvoices", "salesReturns", "purchaseReturns", "cashEntries"];
  }
  if (pathname === "/dues") return [];
  if (pathname.startsWith("/backup-and-restore")) return [...DEFERRED_FOR_BACKUP];
  return [];
}

const DEFERRED_FOR_BACKUP: DeferredCollection[] = [
  "customers", "salesInvoices", "purchaseInvoices", "cashEntries", "salesReturns",
  "purchaseReturns", "quotations",
];

function routeNeedsLedger(pathname: string): boolean {
  if (pathname === "/inventory") return false;
  if (pathname === "/pos") return false;
  return ["/sales", "/purchases", "/returns", "/stocktakes"]
    .some((prefix) => pathname.startsWith(prefix));
}

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
let firstRouteContentPainted = false;

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

function useFirstRouteContentGate(shellReady: boolean): boolean {
  const [ready, setReady] = useState(firstRouteContentPainted);
  useEffect(() => {
    if (!shellReady || ready) return;
    const frame = requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        firstRouteContentPainted = true;
        setReady(true);
      }),
    );
    return () => cancelAnimationFrame(frame);
  }, [shellReady, ready]);
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
  const firstRouteContentReady = useFirstRouteContentGate(firstScreenReady);
  const { collectionState, hydrateCollections, areCollectionsLoaded } = useCollectionHydration();
  const { stockMovementsHydrated, hydrateStockMovements } = useInvoicing();
  const collections = useMemo(() => requiredCollections(loc.pathname), [loc.pathname]);
  const needsLedger = routeNeedsLedger(loc.pathname);
  const [ledgerLoading, setLedgerLoading] = useState(false);

  useEffect(() => {
    if (!auth.isAuthenticated || !currentUser) return;
    if (!areCollectionsLoaded(collections)) void hydrateCollections(collections);
    if (needsLedger && !stockMovementsHydrated && !ledgerLoading) {
      setLedgerLoading(true);
      void hydrateStockMovements().finally(() => setLedgerLoading(false));
    }
  }, [
    auth.isAuthenticated, currentUser, collections, collectionState,
    hydrateCollections, areCollectionsLoaded, needsLedger,
    stockMovementsHydrated, hydrateStockMovements, ledgerLoading,
  ]);

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

  if (!areCollectionsLoaded(collections) || (needsLedger && !stockMovementsHydrated)) {
    return (
      <AppBootScreen
        delayMs={0}
        message="Ø¬Ø§Ø±ÙŠ ØªØ­Ù…ÙŠÙ„ Ø¨ÙŠØ§Ù†Ø§Øª Ø§Ù„Ù‚Ø³Ù…..."
        hint="ÙŠØªÙ… ØªØ­Ù…ÙŠÙ„ Ø§Ù„Ø³Ø¬Ù„ Ø§Ù„Ù…Ø·Ù„ÙˆØ¨ ÙÙ‚Ø·ØŒ ÙˆÙ„Ù† ÙŠØªÙ… Ø§Ø¹ØªØ¨Ø§Ø± Ø§Ù„Ø¨ÙŠØ§Ù†Ø§Øª ØºÙŠØ± Ø§Ù„Ù…Ø­Ù…Ù„Ø© ÙØ§Ø±ØºØ©."
      />
    );
  }

  return (
    <AppLayout>
      {firstRouteContentReady ? children : (
        <div role="status" className="grid min-h-48 place-items-center text-sm text-ink-muted">
          جاري تجهيز لوحة العمل…
        </div>
      )}
    </AppLayout>
  );
}
