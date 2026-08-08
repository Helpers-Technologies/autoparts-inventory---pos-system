import { describe, expect, it } from "vitest";
import {
  QUIET_PERIOD_MS,
  alertSignature,
  formatNotificationBody,
  shopAlertSummary,
  shouldNotify,
} from "../../../electron/mobile-notifications.cjs";

type Product = {
  name: string;
  quantityMilli: number;
  minStockMilli: number;
  archived?: boolean;
};
type Order = { remainingMinor: number; cancelled?: boolean };

const snapshot = (products: Product[], orders: Order[] = []) => ({ products, orders });

describe("shopAlertSummary", () => {
  it("counts a product as low only when it has a minimum and has reached it", () => {
    const summary = shopAlertSummary(
      snapshot([
        { name: "فلتر زيت", quantityMilli: 2_000, minStockMilli: 5_000 },
        { name: "على الحد بالظبط", quantityMilli: 5_000, minStockMilli: 5_000 },
        { name: "مخزون كافٍ", quantityMilli: 90_000, minStockMilli: 5_000 },
        // A shop that never set a minimum must not have its whole catalogue
        // reported as low — this is the difference between a useful alert and
        // one the owner mutes immediately.
        { name: "بدون حد أدنى", quantityMilli: 0, minStockMilli: 0 },
      ]),
    );
    expect(summary.lowStockCount).toBe(2);
    expect(summary.firstLowStockName).toBe("فلتر زيت");
  });

  it("ignores archived products and cancelled invoices", () => {
    const summary = shopAlertSummary(
      snapshot(
        [{ name: "صنف مؤرشف", quantityMilli: 0, minStockMilli: 5_000, archived: true }],
        [
          { remainingMinor: 50_000, cancelled: true },
          { remainingMinor: 12_500 },
          { remainingMinor: 0 },
        ],
      ),
    );
    expect(summary.lowStockCount).toBe(0);
    expect(summary.unpaidCount).toBe(1);
    expect(summary.unpaidTotalMinor).toBe(12_500);
  });

  it("survives a malformed snapshot instead of throwing inside the sync job", () => {
    expect(shopAlertSummary(undefined).lowStockCount).toBe(0);
    expect(shopAlertSummary({}).unpaidCount).toBe(0);
  });
});

describe("formatNotificationBody", () => {
  it("names the item rather than showing a bare count", () => {
    expect(
      formatNotificationBody({
        lowStockCount: 1,
        firstLowStockName: "فلتر زيت",
        unpaidCount: 0,
        unpaidTotalMinor: 0,
      }),
    ).toBe("فلتر زيت أوشك على النفاد");

    expect(
      formatNotificationBody({
        lowStockCount: 5,
        firstLowStockName: "فلتر زيت",
        unpaidCount: 0,
        unpaidTotalMinor: 0,
      }),
    ).toBe("فلتر زيت و4 صنف آخر أوشكوا على النفاد");
  });

  it("renders money in pounds, not in the minor units it is stored as", () => {
    expect(
      formatNotificationBody({
        lowStockCount: 0,
        firstLowStockName: "",
        unpaidCount: 3,
        unpaidTotalMinor: 125_050,
      }),
    ).toBe("3 فاتورة غير محصّلة بإجمالي 1250.50 ج.م");
  });

  it("is empty when there is nothing worth waking a phone for", () => {
    expect(
      formatNotificationBody({
        lowStockCount: 0,
        firstLowStockName: "",
        unpaidCount: 0,
        unpaidTotalMinor: 0,
      }),
    ).toBe("");
  });
});

describe("shouldNotify", () => {
  const now = Date.parse("2026-08-08T12:00:00.000Z");
  const signature = "2:فلتر زيت:1";

  it("notifies when nothing has been sent before", () => {
    expect(shouldNotify(null, signature, now)).toBe(true);
  });

  it("stays silent while the same situation persists", () => {
    // The sync job runs every two minutes; without this the owner would be
    // notified 30 times an hour about one low item.
    const justSent = { signature, at: new Date(now - 2 * 60 * 1000).toISOString() };
    expect(shouldNotify(justSent, signature, now)).toBe(false);
  });

  it("notifies again as soon as the situation actually changes", () => {
    const justSent = { signature, at: new Date(now - 2 * 60 * 1000).toISOString() };
    expect(shouldNotify(justSent, "3:فلتر زيت:1", now)).toBe(true);
  });

  it("re-raises an unresolved problem after the quiet period", () => {
    const stale = { signature, at: new Date(now - QUIET_PERIOD_MS - 1000).toISOString() };
    expect(shouldNotify(stale, signature, now)).toBe(true);
  });

  it("treats a corrupt timestamp as never sent rather than as never due", () => {
    // Failing open matters more than failing closed here: a bad stored value
    // must not be able to silence the shop's alerts permanently.
    expect(shouldNotify({ signature, at: "not a date" }, signature, now)).toBe(true);
  });
});

describe("the whole decision, end to end", () => {
  it("a shop that fixes its stock then breaks it again is notified twice, not thirty times", () => {
    const low = snapshot([{ name: "فلتر زيت", quantityMilli: 1_000, minStockMilli: 5_000 }]);
    const fine = snapshot([{ name: "فلتر زيت", quantityMilli: 90_000, minStockMilli: 5_000 }]);
    const start = Date.parse("2026-08-08T09:00:00.000Z");

    let delivered: { signature: string; at: string } | null = null;
    let sent = 0;
    const tick = (state: ReturnType<typeof snapshot>, minute: number) => {
      const summary = shopAlertSummary(state);
      if (!formatNotificationBody(summary)) return;
      const sig = alertSignature(summary);
      const at = start + minute * 60 * 1000;
      if (!shouldNotify(delivered, sig, at)) return;
      sent += 1;
      delivered = { signature: sig, at: new Date(at).toISOString() };
    };

    // Low for half an hour: 15 sync cycles, one notification.
    for (let minute = 0; minute < 30; minute += 2) tick(low, minute);
    expect(sent).toBe(1);
    // Restocked — nothing to say, and no notification for "all clear".
    for (let minute = 30; minute < 40; minute += 2) tick(fine, minute);
    expect(sent).toBe(1);
    // Low again. The signature matches the one already delivered, so the only
    // thing that can let this through is the quiet period — which has not
    // passed. This is the one case worth being explicit about: the owner is
    // told once about a recurring problem, not on every relapse.
    for (let minute = 40; minute < 60; minute += 2) tick(low, minute);
    expect(sent).toBe(1);
    // After the quiet period, a still-unresolved shortage is raised again.
    tick(low, QUIET_PERIOD_MS / 60_000 + 5);
    expect(sent).toBe(2);
  });
});
