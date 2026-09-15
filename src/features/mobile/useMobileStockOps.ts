import { useCallback, useEffect, useRef, useState } from "react";
import { useCatalog } from "../../store/CatalogContext";
import { useToast } from "../../components/ui/Toast";
import { useFeatures } from "../../lib/useFeatures";
import type { MobileStockOp } from "./mobileStockOps";

/** How often the desktop looks for work queued by a phone. */
const POLL_INTERVAL_MS = 20_000;
/** After a failure, back off rather than hammering a portal that is down. */
const BACKOFF_MS = 120_000;

export interface MobileStockOpsState {
  /** Operations applied since the app started, for the settings screen. */
  appliedCount: number;
  rejectedCount: number;
  lastCheckedAt: string | null;
  lastAppliedAt: string | null;
  busy: boolean;
  lastError: string | null;
}

/**
 * Applies stock work scanned on a phone, as it arrives.
 *
 * The shop asked for this to be immediate: a storeman scans a shelf and the
 * desktop reflects it without anyone pressing anything. So this polls, applies,
 * and reports back — no approval step.
 *
 * Main commits each stock effect, movement, audit entry and operation receipt
 * together. A failed acknowledgement can be retried with the stored result,
 * even after restart, without applying the inventory change again.
 *
 * Polling rather than push: a push can be missed, and a warehouse phone with
 * bad signal is the normal case. A poll that finds nothing costs one small
 * request; a missed push costs a stock discrepancy nobody can explain.
 */
export function useMobileStockOps(): MobileStockOpsState {
  const { applyMobileStockOps } = useCatalog();
  const toast = useToast();
  const mobileCompanionEnabled = useFeatures().isEnabled("mobileCompanion");

  const [state, setState] = useState<MobileStockOpsState>({
    appliedCount: 0,
    rejectedCount: 0,
    lastCheckedAt: null,
    lastAppliedAt: null,
    busy: false,
    lastError: null,
  });

  // The effect below must not restart every time a product changes — applying
  // an operation changes products, which would otherwise cancel and restart
  // the very timer that applied it.
  const applyStockRef = useRef(applyMobileStockOps);
  const runningRef = useRef(false);
  // Written in an effect, not during render: a ref assigned while rendering is
  // a value React is free to discard, and the compiler flags it.
  useEffect(() => {
    applyStockRef.current = applyMobileStockOps;
  });

  const drainOnce = useCallback(async () => {
    const api = window.desktopAPI?.license;
    if (!api?.fetchMobileStockOps || runningRef.current) return;
    runningRef.current = true;
    setState((current) => ({ ...current, busy: true }));
    try {
      const fetched = await api.fetchMobileStockOps();
      const checkedAt = new Date().toISOString();
      if (!fetched?.ok || !Array.isArray(fetched.ops) || fetched.ops.length === 0) {
        setState((current) => ({ ...current, busy: false, lastCheckedAt: checkedAt, lastError: fetched?.ok ? null : fetched?.error ?? "fetch_failed" }));
        return;
      }

      const committed = await applyStockRef.current(fetched.ops as MobileStockOp[]);
      if (!committed.ok) {
        setState(current => ({ ...current, busy: false, lastCheckedAt: checkedAt, lastError: committed.error }));
        return;
      }
      const applied = committed.newResults.filter(result => result.status === "applied").length;
      const rejected = committed.newResults.length - applied;

      setState(current => ({
        ...current, appliedCount: current.appliedCount + applied,
        rejectedCount: current.rejectedCount + rejected, lastCheckedAt: checkedAt,
        lastAppliedAt: applied ? checkedAt : current.lastAppliedAt,
      }));

      // Reported back even if the desktop is about to close: an operation the
      // phone never hears about is one the storeman will scan again.
      const acknowledgement = await api.resolveMobileStockOps?.(committed.results);

      setState((current) => ({
        ...current,
        lastCheckedAt: checkedAt,
        busy: false,
        lastError: acknowledgement?.ok ? null : acknowledgement?.error ?? "acknowledgement_failed",
      }));

      if (applied || rejected) {
        const detail = [applied ? `${applied} عملية اتطبّقت` : "", rejected ? `${rejected} اترفضت` : ""].filter(Boolean).join(" · ");
        if (rejected) {
          toast.info("وصلت عمليات مخزون من الموبايل", `${detail} — راجع المرفوض من تطبيق الموبايل.`);
        } else {
          toast.success("وصلت عمليات مخزون من الموبايل", detail);
        }
      }
    } catch (error) {
      // A warehouse with no signal is the normal case, not an exception worth
      // a dialog. The next tick tries again.
      setState((current) => ({ ...current, busy: false, lastError: error instanceof Error ? error.message : "processing_failed" }));
    } finally {
      runningRef.current = false;
    }
  }, [toast]);

  useEffect(() => {
    if (!mobileCompanionEnabled) return;
    if (!window.desktopAPI?.license?.fetchMobileStockOps) return;

    let cancelled = false;
    let timer: number | undefined;

    const tick = async () => {
      if (cancelled) return;
      const before = Date.now();
      await drainOnce();
      if (cancelled) return;
      // Back off after a slow round so a struggling connection does not turn
      // into overlapping requests.
      const elapsed = Date.now() - before;
      timer = window.setTimeout(tick, elapsed > 5_000 ? BACKOFF_MS : POLL_INTERVAL_MS);
    };

    // Checking on focus is what makes it feel immediate: the owner walks back
    // to the counter, the window wakes, and the shelf count is already in.
    const onFocus = () => { void drainOnce(); };
    window.addEventListener("focus", onFocus);
    void tick();

    return () => {
      cancelled = true;
      window.removeEventListener("focus", onFocus);
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [drainOnce, mobileCompanionEnabled]);

  return state;
}
