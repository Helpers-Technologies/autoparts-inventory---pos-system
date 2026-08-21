"use strict";

/**
 * Why does this machine think its license belongs to someone else?
 *
 * Prints the four components the license fingerprint is built from, which
 * MACs were counted and which were skipped as virtual, the machine code the
 * activation screen will show, and whether the license currently stored in
 * the encrypted database still matches. Run it on a customer machine that is
 * being asked to re-enter its serial: if ACCEPTED says NO, the machine code
 * printed here is the one to mint the replacement against.
 *
 * Run with:
 *   ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron scripts/diagnose-license.cjs
 *
 * (Electron's own Node is required — better-sqlite3-multiple-ciphers is built
 * against its ABI, not the system Node's.)
 */
const path = require("node:path");
const fs = require("node:fs");
const os = require("node:os");
const crypto = require("node:crypto");
const cp = require("node:child_process");
const Database = require("better-sqlite3-multiple-ciphers");
const { machineIdSync } = require("node-machine-id");
const {
  collectMacAddresses,
  pickPrimaryMac,
  isVirtualMac,
  buildFingerprintMaterial,
  machineCodeFromMaterial,
  machineHashFromMaterial,
  acceptedMachineHashes,
} = require("../electron/machine-fingerprint.cjs");

const APP_SALT = "autoparts-inventory-system-v1-local-license";
const sha256 = (v) => crypto.createHash("sha256").update(String(v)).digest("hex");

function ps(cmd) {
  try {
    return cp
      .execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", cmd], {
        encoding: "utf8",
        timeout: 15000,
        windowsHide: true,
      })
      .trim();
  } catch (e) {
    return "";
  }
}

const parts = {
  machineGuid: machineIdSync(true),
  smbiosUuid: ps("(Get-CimInstance -ClassName Win32_ComputerSystemProduct).UUID"),
  diskSerial: ps(
    "(Get-CimInstance -ClassName Win32_DiskDrive | Sort-Object Index | Select-Object -First 1).SerialNumber",
  ),
};
const macs = collectMacAddresses(os.networkInterfaces());
const primary = pickPrimaryMac(macs);
const material = buildFingerprintMaterial(parts, primary);
const machineCode = machineCodeFromMaterial(material, APP_SALT);
const machineHash = machineHashFromMaterial(material, APP_SALT);

console.log("== FINGERPRINT (fixed derivation) ==");
console.log("machineGuid :", parts.machineGuid);
console.log("smbiosUuid  :", parts.smbiosUuid || "(unreadable)");
console.log("diskSerial  :", parts.diskSerial || "(unreadable)");
for (const mac of macs) console.log("  MAC        :", mac, isVirtualMac(mac) ? "[virtual — ignored]" : "[physical]");
console.log("picked MAC  :", primary || "(none)");
console.log("machineCode :", machineCode);
console.log("machineHash :", machineHash);

const accepted = acceptedMachineHashes(parts, macs, APP_SALT);
console.log("accepted variants:", accepted.size);

const dbPath = path.join(process.env.APPDATA, "autoparts-inventory-system", "autoparts-inventory.secure.sqlite");
console.log("\n== STORED LICENSE ==", fs.existsSync(dbPath) ? "" : "(no database yet)");
if (fs.existsSync(dbPath)) {
  const db = new Database(dbPath);
  db.pragma(`key="x'${sha256(`${APP_SALT}:db:${parts.machineGuid}`)}'"`);
  const row = db.prepare("SELECT value, updated_at FROM kv_store WHERE key = ?").get("__license_token");
  if (!row) {
    console.log("no license stored — activation screen expected");
  } else {
    const payload = JSON.parse(
      Buffer.from(row.value.slice("APLIC.".length).split(".")[0], "base64url").toString("utf8"),
    );
    console.log("stored at   :", row.updated_at);
    console.log("licenseId   :", payload.licenseId);
    console.log("plan        :", payload.plan, "/", payload.subscriptionType);
    console.log("bound hash  :", payload.machineHash);
    console.log("ACCEPTED?   :", accepted.has(payload.machineHash) ? "YES — stays activated" : "NO — needs one re-activation");
  }

  console.log("\n== PERSISTED FINGERPRINT STATE ==");
  for (const key of ["__fingerprint_probes", "__license_bound_hashes"]) {
    const r = db.prepare("SELECT value, updated_at FROM kv_store WHERE key = ?").get(key);
    console.log(key, "=>", r ? `${r.value}  (${r.updated_at})` : "(absent)");
  }
  db.close();
}
