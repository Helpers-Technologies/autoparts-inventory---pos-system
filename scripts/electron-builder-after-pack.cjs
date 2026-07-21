const fs = require("node:fs/promises");
const path = require("node:path");

const DEFAULT_TIMEOUT_MS = 30000;
const DEFAULT_SETTLE_MS = 3500;

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function canOpenForWrite(filePath) {
  let handle;
  try {
    handle = await fs.open(filePath, "r+");
    return true;
  } catch (error) {
    if (error && (error.code === "EBUSY" || error.code === "EPERM" || error.code === "EACCES")) {
      return false;
    }
    throw error;
  } finally {
    if (handle) await handle.close();
  }
}

async function waitForWritable(filePath) {
  const timeoutMs = Number(process.env.HELPERS_EXE_UNLOCK_TIMEOUT_MS || DEFAULT_TIMEOUT_MS);
  const settleMs = Number(process.env.HELPERS_EXE_SETTLE_MS || DEFAULT_SETTLE_MS);
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    if (await canOpenForWrite(filePath)) {
      if (settleMs > 0) await delay(settleMs);
      return;
    }
    await delay(500);
  }

  throw new Error(
    `Timed out waiting for packaged executable to become writable: ${filePath}. ` +
      "Close any running packaged app and retry npm run dist:win."
  );
}

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== "win32") return;

  const exePath = path.join(
    context.appOutDir,
    `${context.packager.appInfo.productFilename}.exe`
  );

  await waitForWritable(exePath);
};
