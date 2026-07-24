// Custom Windows code-signing hook for electron-builder.
//
// It exists to work around two problems specific to this project's environment:
//
//  1. asar-integrity crash: electron-builder (v26) + Electron 39 embed an
//     asar-integrity hash that does not match what Electron recomputes at
//     runtime, so the packaged app dies on launch with
//     "FATAL ... Integrity check failed for asar archive". electron-builder
//     ignores `electronFuses.enableEmbeddedAsarIntegrityValidation: false`
//     and force-enables the validation fuse. This hook runs AFTER
//     electron-builder's @electron/fuses step (signing is the last per-file
//     step), so flipping the fuse off here on the main app executable sticks.
//
//  2. unreachable timestamp server: some build machines cannot reach the public
//     RFC-3161 timestamp servers. We now TRY each known TSA in turn (so the
//     signature keeps validating after the cert expires when the build host has
//     connectivity) and only fall back to signing WITHOUT a timestamp if every
//     TSA is unreachable — that fallback preserves the previous behaviour and
//     stays valid until the cert expires.
//
// Configured via package.json -> build.win.signtoolOptions.sign.

const { existsSync, readFileSync, writeFileSync } = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { createHash } = require("node:crypto");
const { flipFuses, FuseVersion, FuseV1Options } = require("@electron/fuses");

const CERT_SHA1 = "E950B2D3C22831B0EDE52E0F69D7C0C422BCBE02";
const MAIN_EXE_NAME = "AutoParts Inventory & Sales System.exe";

// Public RFC-3161 timestamp authorities, tried in order. A timestamped
// signature stays valid after the signing certificate expires.
const TIMESTAMP_URLS = [
  "http://timestamp.digicert.com",
  "http://timestamp.sectigo.com",
  "http://time.certum.pl",
  "http://tsa.starfieldtech.com",
];

const SIGNTOOL_CANDIDATES = [
  "C:\\Users\\amrha\\AppData\\Local\\electron-builder\\Cache\\winCodeSign\\winCodeSign-2.6.0\\windows-10\\x64\\signtool.exe",
  "C:\\Program Files (x86)\\Windows Kits\\10\\bin\\10.0.26100.0\\x64\\signtool.exe",
];

function findSigntool() {
  const found = SIGNTOOL_CANDIDATES.find((p) => existsSync(p));
  if (!found) throw new Error("signtool.exe not found in any known location.");
  return found;
}

exports.default = async function sign(configuration) {
  const file = configuration.path;

  // Disable the broken asar-integrity validation fuse on the main app exe only.
  // Flipping a fuse rewrites the PE, so it must happen before we sign the file.
  if (path.basename(file) === MAIN_EXE_NAME) {
    await flipFuses(file, {
      version: FuseVersion.V1,
      [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: false,
      resetAdHocDarwinSignature: false,
    });
    console.log(`[sign-win] disabled asar-integrity fuse on ${MAIN_EXE_NAME}`);

    // Compensating control for the disabled fuse above: write a sibling hash
    // of app.asar that electron/main.cjs verifies at startup (see
    // verifyAsarIntegrityOrExit). Weaker than the real fuse — it only catches
    // accidental corruption / naive tampering, not a motivated attacker who
    // also patches the check out of a modified archive — but it's better than
    // nothing while the upstream electron-builder/Electron bug is unfixed.
    const resourcesDir = path.join(path.dirname(file), "resources");
    const asarPath = path.join(resourcesDir, "app.asar");
    if (existsSync(asarPath)) {
      const hash = createHash("sha256").update(readFileSync(asarPath)).digest("hex");
      writeFileSync(path.join(resourcesDir, "asar-integrity.sha256"), `${hash}\n`, "utf8");
      console.log(`[sign-win] wrote asar-integrity.sha256 (${hash.slice(0, 12)}...)`);
    } else {
      console.warn(`[sign-win] app.asar not found at ${asarPath} — skipping integrity hash`);
    }
  }

  const signtool = findSigntool();
  const baseName = path.basename(file);

  // Try each timestamp authority; fall back to an untimestamped signature only
  // if all of them are unreachable (preserves the previous build behaviour).
  let timestamped = false;
  for (const tsUrl of TIMESTAMP_URLS) {
    try {
      execFileSync(
        signtool,
        ["sign", "/sha1", CERT_SHA1, "/fd", "sha256", "/tr", tsUrl, "/td", "sha256", file],
        { stdio: "inherit" }
      );
      timestamped = true;
      console.log(`[sign-win] signed ${baseName} (timestamped via ${tsUrl})`);
      break;
    } catch {
      console.warn(`[sign-win] timestamp server unreachable: ${tsUrl} — trying next…`);
    }
  }

  if (!timestamped) {
    execFileSync(
      signtool,
      ["sign", "/sha1", CERT_SHA1, "/fd", "sha256", file],
      { stdio: "inherit" }
    );
    console.warn(
      `[sign-win] signed ${baseName} WITHOUT a timestamp (no TSA reachable) — ` +
        `signature stops validating once the certificate expires.`
    );
  }
};
