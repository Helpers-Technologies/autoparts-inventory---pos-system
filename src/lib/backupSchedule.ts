import type { Settings } from "../types";

/** Milliseconds between automatic backups for each frequency option. */
const FREQUENCY_MS: Record<Settings["autoBackupFrequency"], number> = {
  daily: 24 * 60 * 60 * 1000,
  weekly: 7 * 24 * 60 * 60 * 1000,
  monthly: 30 * 24 * 60 * 60 * 1000,
};

/**
 * Decide whether an automatic backup should run now.
 *
 * A backup is due when the feature is enabled, a destination folder is set, and
 * either it has never run, the stored timestamp is unreadable, or at least one
 * frequency interval has elapsed since the last run.
 */
export function isAutoBackupDue(args: {
  enabled: boolean;
  backupPath: string;
  frequency: Settings["autoBackupFrequency"];
  lastBackupDate: string;
  now: number;
}): boolean {
  const { enabled, backupPath, frequency, lastBackupDate, now } = args;
  if (!enabled) return false;
  if (!backupPath.trim()) return false;
  if (!lastBackupDate) return true;
  const last = new Date(lastBackupDate).getTime();
  if (Number.isNaN(last)) return true;
  return now - last >= FREQUENCY_MS[frequency];
}

/** Build a timestamped, filesystem-safe backup file name (e.g. `helpers-backup-2026-06-10-1430-05.json`). */
export function backupFileName(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  const stamp =
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `-${pad(date.getHours())}${pad(date.getMinutes())}-${pad(date.getSeconds())}`;
  return `helpers-backup-${stamp}.hwbak`;
}
