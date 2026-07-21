import { describe, it, expect, vi, afterEach } from "vitest";
import { uid, todayISO, localISODate, isToday, daysUntil, inRange } from "../../../src/lib/utils";

afterEach(() => {
  vi.useRealTimers();
});

describe("uid", () => {
  it("starts with the given prefix", () => {
    expect(uid("prd")).toMatch(/^prd_/);
    expect(uid("inv")).toMatch(/^inv_/);
  });

  it("uses 'id' as default prefix", () => {
    expect(uid()).toMatch(/^id_/);
  });

  it("generates distinct values on consecutive calls", () => {
    const ids = new Set(Array.from({ length: 100 }, () => uid()));
    expect(ids.size).toBe(100);
  });
});

describe("todayISO", () => {
  it("returns the current date in YYYY-MM-DD format", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-28T12:00:00.000Z"));
    expect(todayISO()).toBe("2026-05-28");
  });

  it("uses the LOCAL calendar day just after local midnight (BUG-04)", () => {
    vi.useFakeTimers();
    // local 00:30 on June 1 — toISOString() would report May 31 on UTC+ machines
    vi.setSystemTime(new Date(2026, 5, 1, 0, 30, 0));
    expect(todayISO()).toBe("2026-06-01");
  });
});

describe("localISODate", () => {
  it("formats local calendar components regardless of timezone (BUG-04)", () => {
    // Dec 31 local midnight — the old toISOString() approach returned Dec 30
    // on UTC+ machines, dropping the last day of every quarter
    expect(localISODate(new Date(2026, 11, 31))).toBe("2026-12-31");
  });

  it("zero-pads month and day", () => {
    expect(localISODate(new Date(2026, 0, 5))).toBe("2026-01-05");
  });

  it("defaults to now", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 2, 15, 13, 0, 0));
    expect(localISODate()).toBe("2026-03-15");
  });
});

describe("isToday", () => {
  it("returns true when the date string matches today", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-28T08:00:00.000Z"));
    expect(isToday("2026-05-28")).toBe(true);
  });

  it("returns false for yesterday", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-28T08:00:00.000Z"));
    expect(isToday("2026-05-27")).toBe(false);
  });

  it("returns false for tomorrow", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-28T08:00:00.000Z"));
    expect(isToday("2026-05-29")).toBe(false);
  });
});

describe("daysUntil", () => {
  it("returns null for undefined or empty input", () => {
    expect(daysUntil(undefined)).toBeNull();
    expect(daysUntil("")).toBeNull();
  });

  it("returns 0 when the date is today", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-28T12:00:00.000Z"));
    expect(daysUntil("2026-05-28")).toBe(0);
  });

  it("returns a positive number for a future date", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-28T00:00:00.000Z"));
    expect(daysUntil("2026-05-31")).toBe(3);
  });

  it("returns a negative number for a past date (expired)", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-28T00:00:00.000Z"));
    expect(daysUntil("2026-05-25")).toBe(-3);
  });
});

describe("inRange", () => {
  it("returns true when no bounds are provided", () => {
    expect(inRange("2026-05-15")).toBe(true);
  });

  it("returns true when date is within from–to range", () => {
    expect(inRange("2026-05-15", "2026-05-01", "2026-05-31")).toBe(true);
  });

  it("returns true at exact boundaries (inclusive)", () => {
    expect(inRange("2026-05-01", "2026-05-01", "2026-05-31")).toBe(true);
    expect(inRange("2026-05-31", "2026-05-01", "2026-05-31")).toBe(true);
  });

  it("returns false when date is before 'from'", () => {
    expect(inRange("2026-04-30", "2026-05-01", "2026-05-31")).toBe(false);
  });

  it("returns false when date is after 'to'", () => {
    expect(inRange("2026-06-01", "2026-05-01", "2026-05-31")).toBe(false);
  });

  it("respects only 'from' when 'to' is omitted", () => {
    expect(inRange("2026-05-01", "2026-05-01")).toBe(true);
    expect(inRange("2026-04-30", "2026-05-01")).toBe(false);
  });

  it("respects only 'to' when 'from' is omitted", () => {
    expect(inRange("2026-05-31", undefined, "2026-05-31")).toBe(true);
    expect(inRange("2026-06-01", undefined, "2026-05-31")).toBe(false);
  });
});
