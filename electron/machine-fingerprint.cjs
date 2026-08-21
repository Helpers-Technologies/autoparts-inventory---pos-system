"use strict";
/**
 * Pure machine-fingerprint helpers for license binding.
 * No Electron, DB, or child_process deps — safe to require from Vitest.
 *
 * `main.cjs` owns the impure half (reading MachineGuid, shelling out to
 * PowerShell for the SMBIOS UUID and disk serial, caching those readings in
 * the encrypted kv_store) and feeds the results in here.
 *
 * Why this module exists: the app used to bind a license to the LOWEST MAC
 * address on the machine. Hyper-V's virtual switch — created by Docker
 * Desktop and WSL2 — hands its "vEthernet (Default Switch)" adapter a MAC
 * from the 00:15:5d pool and draws a NEW one whenever Windows rebuilds the
 * switch. 00:15:5d sorts below every real vendor MAC, so the rule reliably
 * picked the single least stable address on the box. When it changed, the
 * machine hash changed, the stored license read as `machine_mismatch`, and
 * the app demanded a fresh serial on every launch.
 */

const crypto = require("node:crypto");

/** MAC prefixes belonging to hypervisor / container / tunnel adapters, whose
 *  addresses come from a software pool rather than being burned in. */
const VIRTUAL_MAC_PREFIXES = [
  "00:15:5d", // Hyper-V / WSL2 / Docker Desktop virtual switch
  "00:03:ff", // Microsoft Virtual PC
  "00:05:69", // VMware
  "00:0c:29", // VMware
  "00:1c:14", // VMware
  "00:50:56", // VMware
  "08:00:27", // VirtualBox
  "0a:00:27", // VirtualBox host-only
  "00:16:3e", // Xen
  "00:1c:42", // Parallels
];

/** True for an address a hypervisor, container bridge or VPN tunnel assigned
 *  itself, which may differ on the next boot. */
function isVirtualMac(mac) {
  const clean = String(mac || "").toLowerCase();
  if (VIRTUAL_MAC_PREFIXES.some((prefix) => clean.startsWith(prefix)))
    return true;
  // Locally-administered bit (0x02 of the first octet) — set by Windows Wi-Fi
  // MAC randomisation, Docker bridges and TAP/VPN adapters. A vendor-burned
  // MAC never has it set.
  const firstOctet = Number.parseInt(clean.slice(0, 2), 16);
  return Number.isInteger(firstOctet) && (firstOctet & 0x02) !== 0;
}

/**
 * Every non-loopback MAC in an `os.networkInterfaces()` map, lower-cased,
 * de-duplicated and sorted. The raw map lists an adapter once per bound
 * address, so it repeats each MAC.
 */
function collectMacAddresses(networkInterfaces) {
  try {
    const macs = new Set();
    for (const list of Object.values(networkInterfaces || {})) {
      for (const info of list || []) {
        if (info?.mac && info.mac !== "00:00:00:00:00:00" && !info.internal)
          macs.add(String(info.mac).toLowerCase());
      }
    }
    return [...macs].sort(); // deterministic regardless of enumeration order
  } catch {
    return [];
  }
}

/** The MAC a license binds to: lowest PHYSICAL address, or "" when the
 *  machine has only virtual adapters (fine — the other three components still
 *  identify it). */
function pickPrimaryMac(macs) {
  return (macs || []).filter((mac) => !isVirtualMac(mac))[0] || "";
}

/**
 * Components are joined POSITIONALLY. An unreadable component leaves an empty
 * slot instead of being dropped: dropping it slid the remaining components
 * left and produced a different identity for the same machine, so one
 * PowerShell probe timing out on a cold boot silently invalidated the
 * license. When every component reads (the normal case) this is byte for byte
 * what the pre-fix `filter(Boolean).join("|")` produced, so licenses issued
 * to healthy machines keep validating.
 */
function buildFingerprintMaterial(parts, mac) {
  return [
    parts?.machineGuid || "",
    parts?.smbiosUuid || "",
    parts?.diskSerial || "",
    mac || "",
  ].join("|");
}

function sha256(value) {
  return crypto.createHash("sha256").update(String(value)).digest("hex");
}

/** The APW-XXXX-… code shown on the activation screen and pasted into the
 *  license studio. */
function machineCodeFromMaterial(material, salt) {
  const digest = sha256(`${salt}:machine:${material}`).toUpperCase();
  const groups = digest.slice(0, 32).match(/.{1,4}/g) || [];
  return `APW-${groups.join("-")}`;
}

function machineHashFromMaterial(material, salt) {
  return sha256(machineCodeFromMaterial(material, salt));
}

/**
 * Every machine hash this machine may legitimately present.
 *
 * The canonical hash — physical MAC, positional slots — is what a fresh
 * activation binds to. The rest are shapes an ALREADY-ISSUED license could
 * have been bound to before the fingerprint was stabilised: bound to any MAC
 * currently on the box including the virtual ones, bound with no MAC at all,
 * or bound under the old drop-the-empty-components join. Accepting those
 * keeps a paying customer working through a Docker or VPN adapter appearing
 * and disappearing, instead of sending them back to the activation screen for
 * a serial they already have.
 *
 * It does not widen the door for a clone: every variant is still built from
 * THIS machine's MachineGuid, SMBIOS UUID and disk serial, so a different box
 * matches none of them.
 */
function acceptedMachineHashes(parts, macs, salt) {
  const materials = new Set();
  for (const mac of ["", ...(macs || [])]) {
    const slots = [
      parts?.machineGuid || "",
      parts?.smbiosUuid || "",
      parts?.diskSerial || "",
      mac,
    ];
    materials.add(slots.join("|"));
    materials.add(slots.filter(Boolean).join("|")); // pre-fix join
  }
  return new Set(
    [...materials].map((material) => machineHashFromMaterial(material, salt)),
  );
}

/**
 * Identity of the components that do NOT move: MachineGuid, SMBIOS UUID and
 * disk serial, with the MAC deliberately left out.
 *
 * This is what lets the app remember "a license already proved itself here"
 * without that memory becoming a way around the hardware binding. A binding
 * recorded on this machine is honoured again only while the stable core still
 * matches, so it covers exactly the case it is meant to — a network adapter
 * changing underneath a license that was issued against it — and stops
 * covering anything the moment the machine itself changes.
 */
function stableCoreHash(parts, salt) {
  return sha256(
    `${salt}:core:${parts?.machineGuid || ""}|${parts?.smbiosUuid || ""}|${parts?.diskSerial || ""}`,
  );
}

module.exports = {
  VIRTUAL_MAC_PREFIXES,
  isVirtualMac,
  collectMacAddresses,
  pickPrimaryMac,
  buildFingerprintMaterial,
  machineCodeFromMaterial,
  machineHashFromMaterial,
  acceptedMachineHashes,
  stableCoreHash,
};
