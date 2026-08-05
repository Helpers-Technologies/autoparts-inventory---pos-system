export function formatUpdateSize(bytes?: number | null): string | null {
  if (!bytes || !Number.isFinite(bytes) || bytes <= 0) return null;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} كيلوبايت`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} ميجابايت`;
}

/**
 * "62.8 ميجابايت من 139.5 ميجابايت". Prefers the exact byte counts
 * electron-updater reports during a live download; falls back to deriving
 * them from the percent when only the release's total size is known (e.g.
 * state rehydrated via getStatus before the first progress event).
 */
export function formatDownloadedOf(
  percent: number,
  totalBytes?: number | null,
  transferredBytes?: number | null,
): string | null {
  const total = formatUpdateSize(totalBytes);
  if (!total) return null;
  const doneBytes =
    transferredBytes && transferredBytes > 0
      ? transferredBytes
      : ((totalBytes as number) * Math.min(100, Math.max(0, percent))) / 100;
  const done = formatUpdateSize(doneBytes);
  return done ? `${done} من ${total}` : total;
}

function parseVersion(version?: string | null): number[] | null {
  const match = /^(\d+)\.(\d+)\.(\d+)/.exec(String(version || "").trim());
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null;
}

/** True when `candidate` is strictly newer than `current`. */
export function isNewerVersion(candidate?: string | null, current?: string | null): boolean {
  const a = parseVersion(candidate);
  const b = parseVersion(current);
  if (!a || !b) return Boolean(candidate && current && candidate !== current);
  for (let i = 0; i < 3; i += 1) {
    if (a[i] !== b[i]) return a[i] > b[i];
  }
  return false;
}
