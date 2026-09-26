import { afterEach, describe, it, expect, vi } from "vitest";
import {
  AUTO_BACKUP_CHECK_INTERVAL_MS,
  isAutoBackupDue,
  backupFileName,
  startAutoBackupChecks,
} from "../../../src/lib/backupSchedule";

const DAY = 24 * 60 * 60 * 1000;
const base = {
  enabled: true,
  backupPath: "D:/backups",
  frequency: "daily" as const,
  lastBackupDate: "",
  now: Date.parse("2026-06-10T12:00:00.000Z"),
};

afterEach(() => vi.useRealTimers());

describe("startAutoBackupChecks", () => {
  it("checks immediately and every 30 minutes while the app remains open", () => {
    vi.useFakeTimers();
    const check = vi.fn();
    const stop = startAutoBackupChecks(check);

    expect(check).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(AUTO_BACKUP_CHECK_INTERVAL_MS - 1);
    expect(check).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1);
    expect(check).toHaveBeenCalledTimes(2);

    stop();
    vi.advanceTimersByTime(AUTO_BACKUP_CHECK_INTERVAL_MS);
    expect(check).toHaveBeenCalledTimes(2);
  });
});

describe("isAutoBackupDue", () => {
  it("returns false when disabled", () => {
    expect(isAutoBackupDue({ ...base, enabled: false, lastBackupDate: "" })).toBe(false);
  });

  it("returns false when no destination folder is set", () => {
    expect(isAutoBackupDue({ ...base, backupPath: "" })).toBe(false);
    expect(isAutoBackupDue({ ...base, backupPath: "   " })).toBe(false);
  });

  it("returns true when it has never run", () => {
    expect(isAutoBackupDue({ ...base, lastBackupDate: "" })).toBe(true);
  });

  it("returns true when the stored timestamp is unreadable", () => {
    expect(isAutoBackupDue({ ...base, lastBackupDate: "not-a-date" })).toBe(true);
  });

  it("daily: due after 24h, not before", () => {
    const now = base.now;
    expect(isAutoBackupDue({ ...base, now, lastBackupDate: new Date(now - DAY + 1000).toISOString() })).toBe(false);
    expect(isAutoBackupDue({ ...base, now, lastBackupDate: new Date(now - DAY).toISOString() })).toBe(true);
  });

  it("weekly: due after 7 days, not before", () => {
    const now = base.now;
    const f = "weekly" as const;
    expect(isAutoBackupDue({ ...base, frequency: f, now, lastBackupDate: new Date(now - 6 * DAY).toISOString() })).toBe(false);
    expect(isAutoBackupDue({ ...base, frequency: f, now, lastBackupDate: new Date(now - 7 * DAY).toISOString() })).toBe(true);
  });

  it("monthly: due after 30 days, not before", () => {
    const now = base.now;
    const f = "monthly" as const;
    expect(isAutoBackupDue({ ...base, frequency: f, now, lastBackupDate: new Date(now - 29 * DAY).toISOString() })).toBe(false);
    expect(isAutoBackupDue({ ...base, frequency: f, now, lastBackupDate: new Date(now - 30 * DAY).toISOString() })).toBe(true);
  });
});

describe("backupFileName", () => {
  it("formats a zero-padded, filesystem-safe name", () => {
    const name = backupFileName(new Date(2026, 5, 9, 4, 7, 3)); // local time: 2026-06-09 04:07:03
    expect(name).toBe("helpers-backup-2026-06-09-0407-03.hwbak");
  });

  it("contains no characters that are invalid in a file name", () => {
    const name = backupFileName(new Date(2026, 11, 31, 23, 59, 59));
    expect(name).toMatch(/^helpers-backup-[0-9-]+\.hwbak$/);
    expect(name).not.toMatch(/[\\/:*?"<>|]/);
  });
});
