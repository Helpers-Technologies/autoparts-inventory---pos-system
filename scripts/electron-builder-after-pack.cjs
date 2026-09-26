const fs = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");

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

async function hashFile(filePath) {
  const hash = crypto.createHash("sha256");
  const handle = await fs.open(filePath, "r");
  try {
    for await (const chunk of handle.createReadStream({ autoClose: false })) hash.update(chunk);
  } finally {
    await handle.close();
  }
  return hash.digest("hex");
}

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== "win32") return;

  const exePath = path.join(
    context.appOutDir,
    `${context.packager.appInfo.productFilename}.exe`
  );

  await waitForWritable(exePath);

  // Signing hooks can run before app.asar exists in newer electron-builder
  // releases. Generate the startup integrity sidecar here, after packaging has
  // completed, so every supported builder version puts it in the final app and
  // installer payload.
  const resourcesDir = path.join(context.appOutDir, "resources");
  const asarPath = path.join(resourcesDir, "app.asar");
  const integrityPath = path.join(resourcesDir, "asar-integrity.sha256");
  const hash = await hashFile(asarPath);
  await fs.writeFile(integrityPath, `${hash}\n`, "utf8");
  console.log(`[after-pack] wrote asar-integrity.sha256 (${hash.slice(0, 12)}...)`);
};
