import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function uid(prefix = "id"): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 9)}${Date.now()
    .toString(36)
    .slice(-4)}`;
}

/**
 * YYYY-MM-DD from the LOCAL calendar date. Never use
 * `toISOString().slice(0, 10)` for day stamps or range boundaries: it converts
 * to UTC first, so on UTC+ machines it returns yesterday near midnight and
 * shifts month/quarter boundaries by a day (BUG-04, report 09).
 */
export function localISODate(d: Date = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function todayISO(): string {
  return localISODate();
}

export function isToday(dateStr: string): boolean {
  return dateStr.slice(0, 10) === todayISO();
}

export function daysUntil(dateStr?: string): number | null {
  if (!dateStr) return null;
  const d = new Date(dateStr);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  d.setHours(0, 0, 0, 0);
  return Math.round((d.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
}

/**
 * True when a product is within `thresholdDays` of expiring (but not yet
 * expired). Drives the "قرب انتهاء الصلاحية" alert; the threshold comes from
 * Settings.expiryAlertDays (default 14). Products without expiry tracking,
 * with no date, or already expired are excluded.
 */
export function isExpiringSoon(
  p: { hasExpiry?: boolean; expiryDate?: string },
  thresholdDays: number,
): boolean {
  if (!p.hasExpiry || !p.expiryDate) return false;
  const du = daysUntil(p.expiryDate);
  return du !== null && du >= 0 && du <= thresholdDays;
}

/** True when a product has expiry tracking and its date is in the past. */
export function isExpired(p: { hasExpiry?: boolean; expiryDate?: string }): boolean {
  if (!p.hasExpiry || !p.expiryDate) return false;
  const du = daysUntil(p.expiryDate);
  return du !== null && du < 0;
}

export function inRange(dateStr: string, from?: string, to?: string): boolean {
  const d = dateStr.slice(0, 10);
  if (from && d < from) return false;
  if (to && d > to) return false;
  return true;
}

/** Returns all YYYY-MM keys from the month containing `from` to the month containing `to`. */
export function getMonthsInRange(from: string, to: string): string[] {
  const months: string[] = [];
  const start = new Date(from.slice(0, 7) + "-01");
  const end = new Date(to.slice(0, 7) + "-01");
  for (const d = new Date(start); d <= end; d.setMonth(d.getMonth() + 1)) {
    months.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
  }
  return months;
}

export const MONTH_NAMES_AR = [
  "يناير","فبراير","مارس","أبريل","مايو","يونيو",
  "يوليو","أغسطس","سبتمبر","أكتوبر","نوفمبر","ديسمبر",
];

export function monthLabel(yyyymm: string): string {
  const [y, m] = yyyymm.split("-").map(Number);
  return `${MONTH_NAMES_AR[m - 1]} ${y}`;
}

/** Validates that a phone number is an 11-digit Egyptian mobile number starting with 01 */
export function isValidEgyptianMobile(phone: string): boolean {
  const digits = phone.trim().replace(/\D/g, "");
  return /^01\d{9}$/.test(digits);
}

/** Formats/cleans phone input to only allow up to 11 digits */
export function normalizePhoneInput(value: string): string {
  const arabicDigits = "٠١٢٣٤٥٦٧٨٩";
  const persianDigits = "۰۱۲۳۴۵۶۷۸۹";
  const normalized = value
    .replace(/[٠-٩]/g, (digit) => String(arabicDigits.indexOf(digit)))
    .replace(/[۰-۹]/g, (digit) => String(persianDigits.indexOf(digit)))
    .replace(/\D/g, "");
  return normalized.slice(0, 11);
}
