const UPDATE_SEVERITIES = new Set([
  "normal",
  "important",
  "critical",
  "emergency",
]);

const DEFAULT_UPDATE_PREFERENCES = Object.freeze({
  autoCheck: true,
  autoDownload: true,
  autoInstallOnQuit: false,
});

function normalizeUpdatePreferences(value) {
  const source = value && typeof value === "object" ? value : {};
  return {
    autoCheck:
      typeof source.autoCheck === "boolean"
        ? source.autoCheck
        : DEFAULT_UPDATE_PREFERENCES.autoCheck,
    autoDownload:
      typeof source.autoDownload === "boolean"
        ? source.autoDownload
        : DEFAULT_UPDATE_PREFERENCES.autoDownload,
    autoInstallOnQuit:
      typeof source.autoInstallOnQuit === "boolean"
        ? source.autoInstallOnQuit
        : DEFAULT_UPDATE_PREFERENCES.autoInstallOnQuit,
  };
}

function normalizeUpdateRelease(value) {
  if (!value || typeof value !== "object") return null;
  const id = String(value.id || "").trim().slice(0, 128);
  const version = String(value.version || "").trim().slice(0, 64);
  if (!id || !/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(version)) {
    return null;
  }

  const severity = UPDATE_SEVERITIES.has(value.severity)
    ? value.severity
    : "normal";
  const policy =
    value.policy && typeof value.policy === "object"
      ? {
          ...(typeof value.policy.message === "string"
            ? { message: value.policy.message.trim().slice(0, 1000) }
            : {}),
          ...(typeof value.policy.deadlineAt === "string"
            ? { deadlineAt: value.policy.deadlineAt.slice(0, 64) }
            : {}),
        }
      : undefined;

  const artifactSize = Number(value.artifactSize);

  return {
    id,
    version,
    title: String(value.title || `الإصدار ${version}`).trim().slice(0, 200),
    notes: String(value.notes || "").trim().slice(0, 12000),
    severity,
    artifactSize: Number.isSafeInteger(artifactSize) && artifactSize > 0 ? artifactSize : null,
    publishedAt:
      typeof value.publishedAt === "string"
        ? value.publishedAt.slice(0, 64)
        : null,
    ...(policy && Object.keys(policy).length ? { policy } : {}),
  };
}

function canSkipUpdate(release) {
  return release?.severity === "normal";
}

function shouldAutoDownloadUpdate(release, preferences) {
  if (!release) return false;
  if (
    release.severity === "important" ||
    release.severity === "critical" ||
    release.severity === "emergency"
  ) {
    return true;
  }
  return normalizeUpdatePreferences(preferences).autoDownload;
}

// A portal response alone is not trusted strongly enough to deny access to the
// offline app. The blocking gate is activated only after electron-updater has
// downloaded and verified the artifact (SHA-512 and Windows publisher check).
function shouldBlockForUpdate(release, phase) {
  if (
    release?.severity !== "critical" &&
    release?.severity !== "emergency"
  ) {
    return false;
  }
  return phase === "downloaded" || phase === "installing";
}

function shouldShowPersistentUpdate(release) {
  return (
    release?.severity === "important" ||
    release?.severity === "critical" ||
    release?.severity === "emergency"
  );
}

module.exports = {
  DEFAULT_UPDATE_PREFERENCES,
  UPDATE_SEVERITIES,
  canSkipUpdate,
  normalizeUpdatePreferences,
  normalizeUpdateRelease,
  shouldAutoDownloadUpdate,
  shouldBlockForUpdate,
  shouldShowPersistentUpdate,
};
