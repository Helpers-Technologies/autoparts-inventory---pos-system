// Writes electron/license-heartbeat-url.cjs with the production license
// portal's heartbeat URL from the AUTOPARTS_LICENSE_HEARTBEAT_URL env var
// (a CI secret — see .github/workflows/release-exe.yml). Same reason as
// write-license-public-key.cjs: an env var set during the build step has no
// effect on what ends up inside the packaged app.asar that runs on a
// customer's machine — it has to be baked into the file itself.
//
// Unlike the public key, this is NOT fatal if unset — remote block/unblock
// is optional, best-effort functionality (see electron/main.cjs's
// checkLicenseOnline). A build with no heartbeat URL configured just ships
// with that feature off, exactly like before this existed.

const { writeFileSync } = require("node:fs");
const path = require("node:path");

const url = process.env.AUTOPARTS_LICENSE_HEARTBEAT_URL || "";
if (url && !/^https:\/\//.test(url)) {
  throw new Error("AUTOPARTS_LICENSE_HEARTBEAT_URL is set but doesn't look like an https:// URL");
}

const content = `const LICENSE_HEARTBEAT_URL =
  process.env.AUTOPARTS_LICENSE_HEARTBEAT_URL ||
  ${JSON.stringify(url || null)};

module.exports = { LICENSE_HEARTBEAT_URL };
`;

const target = path.join(__dirname, "..", "electron", "license-heartbeat-url.cjs");
writeFileSync(target, content, "utf8");
console.log(
  url
    ? `Wrote ${target} (heartbeat URL: ${url})`
    : `Wrote ${target} (no AUTOPARTS_LICENSE_HEARTBEAT_URL set — remote block/unblock disabled for this build)`
);
