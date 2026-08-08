"use strict";

/**
 * Deciding *what* to tell the shop's phones, and *whether* to tell them again.
 *
 * Kept out of main.cjs because the second question is the one that decides
 * whether this feature is useful or is the thing the owner mutes in week two —
 * and it is pure logic that deserves tests rather than a manual six-hour wait.
 */

// The sync job runs every two minutes. Anything that repeats on that cadence is
// spam, so a notification the owner has already been shown is suppressed until
// the situation actually changes — or until this much time has passed, which is
// what keeps a genuinely unresolved problem from going silent forever.
const QUIET_PERIOD_MS = 6 * 60 * 60 * 1000;

/// What is worth waking a phone for, derived from the snapshot that was just
/// uploaded so the notification and the app can never disagree.
function shopAlertSummary(snapshot) {
  const products = Array.isArray(snapshot?.products) ? snapshot.products : [];
  const orders = Array.isArray(snapshot?.orders) ? snapshot.orders : [];
  // minStockMilli of 0 means "no minimum set", not "everything is low" — the
  // difference between a useful alert and one that fires for the whole catalogue.
  const lowStock = products.filter(
    (product) => !product.archived && product.minStockMilli > 0 && product.quantityMilli <= product.minStockMilli,
  );
  const unpaid = orders.filter((order) => !order.cancelled && order.remainingMinor > 0);
  return {
    lowStockCount: lowStock.length,
    // Carried so the notification can name the item instead of showing a bare
    // number the owner has to open the app to understand.
    firstLowStockName: String(lowStock[0]?.name || ""),
    unpaidCount: unpaid.length,
    unpaidTotalMinor: unpaid.reduce((sum, order) => sum + Number(order.remainingMinor || 0), 0),
  };
}

function formatNotificationBody(summary) {
  const parts = [];
  const { lowStockCount, firstLowStockName } = summary;
  if (lowStockCount === 1) {
    parts.push(firstLowStockName ? `${firstLowStockName} أوشك على النفاد` : "صنف واحد أوشك على النفاد");
  } else if (lowStockCount > 1) {
    parts.push(
      firstLowStockName
        ? `${firstLowStockName} و${lowStockCount - 1} صنف آخر أوشكوا على النفاد`
        : `${lowStockCount} أصناف أوشكت على النفاد`,
    );
  }
  if (summary.unpaidCount > 0) {
    const total = (summary.unpaidTotalMinor / 100).toFixed(2);
    parts.push(`${summary.unpaidCount} فاتورة غير محصّلة بإجمالي ${total} ج.م`);
  }
  return parts.join(" • ");
}

/// Identity of a situation, not of a moment. Two syncs that describe the same
/// shop state produce the same signature and therefore only ever notify once.
function alertSignature(summary) {
  return `${summary.lowStockCount}:${summary.firstLowStockName}:${summary.unpaidCount}`;
}

/// `previous` is whatever was stored after the last *delivered* notification —
/// storing failed attempts would let one portal outage silence the alert for a
/// whole quiet period.
function shouldNotify(previous, signature, now = Date.now()) {
  if (!previous || previous.signature !== signature) return true;
  const lastAt = Date.parse(previous.at || "");
  if (!Number.isFinite(lastAt)) return true;
  return now - lastAt > QUIET_PERIOD_MS;
}

module.exports = {
  QUIET_PERIOD_MS, alertSignature, formatNotificationBody, shopAlertSummary, shouldNotify,
};
