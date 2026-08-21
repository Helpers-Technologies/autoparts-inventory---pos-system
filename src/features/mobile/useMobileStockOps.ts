import { useCallback, useEffect, useRef, useState } from "react";
import { useCatalog } from "../../store/CatalogContext";
import { useToast } from "../../components/ui/Toast";
import { useFeatures } from "../../lib/useFeatures";
import {
  planStockOps,
  resultForChange,
  summarizeBatch,
  type MobileStockOp,
  type MobileStockOpResult,
} from "./mobileStockOps";

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
}

/**
 * Applies stock work scanned on a phone, as it arrives.
 *
 * The shop asked for this to be immediate: a storeman scans a shelf and the
 * desktop reflects it without anyone pressing anything. So this polls, applies,
 * and reports back — no approval step.
 *
 * That decision has a cost and the design pays it deliberately: every applied
 * operation goes through `adjustStock`, which is the same path the desktop's
 * own stocktake uses, so each one leaves a stock movement AND an audit entry
 * naming the phone and the person who scanned it. Automatic is not the same as
 * invisible — the owner can see every change and reverse it.
 *
 * Polling rather than push: a push can be missed, and a warehouse phone with
 * bad signal is the normal case. A poll that finds nothing costs one small
 * request; a missed push costs a stock discrepancy nobody can explain.
 */
export function useMobileStockOps(): MobileStockOpsState {
  const { products, adjustStock } = useCatalog();
  const toast = useToast();
  const mobileCompanionEnabled = useFeatures().isEnabled("mobileCompanion");

  const [state, setState] = useState<MobileStockOpsState>({
    appliedCount: 0,
    rejectedCount: 0,
    lastCheckedAt: null,
    lastAppliedAt: null,
    busy: false,
  });

  // The effect below must not restart every time a product changes — applying
  // an operation changes products, which would otherwise cancel and restart
  // the very timer that applied it.
  const productsRef = useRef(products);
  const adjustStockRef = useRef(adjustStock);
  const runningRef = useRef(false);
  // Written in an effect, not during render: a ref assigned while rendering is
  // a value React is free to discard, and the compiler flags it.
  useEffect(() => {
    productsRef.current = products;
    adjustStockRef.current = adjustStock;
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
        setState((current) => ({ ...current, busy: false, lastCheckedAt: checkedAt }));
        return;
      }

      const plan = planStockOps(fetched.ops as MobileStockOp[], productsRef.current);
      const results: MobileStockOpResult[] = [...plan.rejected];
      for (const change of plan.changes) {
        // Zero-delta counts still resolve, but writing a movement of zero
        // would add noise to the ledger without adding information.
        if (change.delta !== 0) {
          adjustStockRef.current(change.op.productId, change.delta, change.reason);
        }
        results.push(resultForChange(change));
      }

      // Reported back even if the desktop is about to close: an operation the
      // phone never hears about is one the storeman will scan again.
      await api.resolveMobileStockOps?.(results);

      setState((current) => ({
        appliedCount: current.appliedCount + plan.changes.length,
        rejectedCount: current.rejectedCount + plan.rejected.length,
        lastCheckedAt: checkedAt,
        lastAppliedAt: plan.changes.length ? checkedAt : current.lastAppliedAt,
        busy: false,
      }));

      if (plan.changes.length || plan.rejected.length) {
        const detail = summarizeBatch(plan);
        if (plan.rejected.length) {
          toast.info("وصلت عمليات مخزون من الموبايل", `${detail} — راجع المرفوض من تطبيق الموبايل.`);
        } else {
          toast.success("وصلت عمليات مخزون من الموبايل", detail);
        }
      }
    } catch {
      // A warehouse with no signal is the normal case, not an exception worth
      // a dialog. The next tick tries again.
      setState((current) => ({ ...current, busy: false }));
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
