/**
 * Unit tests for electron/machine-fingerprint.cjs
 *
 * Regression cover for the activation bug: the app bound a license to the
 * LOWEST MAC on the machine, which on any box running Docker Desktop / WSL2
 * is the Hyper-V "vEthernet (Default Switch)" adapter. Hyper-V draws that MAC
 * from the 00:15:5d pool and draws a NEW one whenever Windows rebuilds the
 * switch, so the machine hash changed behind the user's back, the stored
 * license read as `machine_mismatch`, and the app demanded a fresh serial on
 * every single launch.
 *
 * TC-MFP-001 through TC-MFP-016
 */
import { describe, it, expect } from "vitest";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  isVirtualMac,
  collectMacAddresses,
  pickPrimaryMac,
  buildFingerprintMaterial,
  machineCodeFromMaterial,
  machineHashFromMaterial,
  acceptedMachineHashes,
  stableCoreHash,
} = require("../../../electron/machine-fingerprint.cjs");

const SALT = "autoparts-inventory-system-v1-local-license";

// Taken from the machine that reproduced the bug.
const PARTS = {
  machineGuid: "576ba81a-41db-4b67-908f-a5aeb03254fe",
  smbiosUuid: "BDA0007F-317C-11EC-80F0-84A9387027AF",
  diskSerial: "00A0_7501_325A_4E1D.",
};
const PHYSICAL_MAC = "e0:0a:f6:31:80:69"; // Qualcomm Wi-Fi
const HYPERV_MAC = "00:15:5d:4d:63:92"; // vEthernet (Default Switch)

/** The MAC the pre-fix code would have chosen: plain lowest-wins. */
function legacyLowestMac(macs: string[]) {
  return [...macs].sort()[0] || "";
}

// ── isVirtualMac ─────────────────────────────────────────────────────────

describe("isVirtualMac", () => {
  it("TC-MFP-001: flags the Hyper-V virtual switch pool", () => {
    expect(isVirtualMac(HYPERV_MAC)).toBe(true);
  });

  it("TC-MFP-002: flags VMware, VirtualBox, Xen and Parallels adapters", () => {
    expect(isVirtualMac("00:50:56:aa:bb:cc")).toBe(true); // VMware
    expect(isVirtualMac("08:00:27:aa:bb:cc")).toBe(true); // VirtualBox
    expect(isVirtualMac("00:16:3e:aa:bb:cc")).toBe(true); // Xen
    expect(isVirtualMac("00:1c:42:aa:bb:cc")).toBe(true); // Parallels
  });

  it("TC-MFP-003: flags locally-administered addresses (Docker bridge, randomised Wi-Fi)", () => {
    expect(isVirtualMac("02:42:ac:11:00:02")).toBe(true); // Docker
    expect(isVirtualMac("06:aa:bb:cc:dd:ee")).toBe(true); // 0x06 has the LA bit
    expect(isVirtualMac("0a:00:27:00:00:0a")).toBe(true); // VirtualBox host-only
  });

  it("TC-MFP-004: leaves a vendor-burned address alone", () => {
    expect(isVirtualMac(PHYSICAL_MAC)).toBe(false);
    expect(isVirtualMac("00:1a:2b:3c:4d:5e")).toBe(false);
  });

  it("TC-MFP-005: is case-insensitive and survives junk input", () => {
    expect(isVirtualMac("00:15:5D:4D:63:92")).toBe(true);
    expect(isVirtualMac("")).toBe(false);
    expect(isVirtualMac(null)).toBe(false);
  });
});

// ── collectMacAddresses ──────────────────────────────────────────────────

describe("collectMacAddresses", () => {
  it("TC-MFP-006: de-duplicates the per-address repeats and sorts", () => {
    // os.networkInterfaces() lists an adapter once per bound address, so the
    // same MAC appears for IPv4 and IPv6.
    const ifaces = {
      "vEthernet (Default Switch)": [
        { mac: HYPERV_MAC, internal: false },
        { mac: HYPERV_MAC, internal: false },
      ],
      "Wi-Fi": [
        { mac: PHYSICAL_MAC, internal: false },
        { mac: PHYSICAL_MAC.toUpperCase(), internal: false },
      ],
    };
    expect(collectMacAddresses(ifaces)).toEqual([HYPERV_MAC, PHYSICAL_MAC]);
  });

  it("TC-MFP-007: skips loopback and all-zero adapters", () => {
    const ifaces = {
      "Loopback Pseudo-Interface 1": [
        { mac: "00:00:00:00:00:00", internal: true },
      ],
      "Bluetooth Network Connection": [
        { mac: "00:00:00:00:00:00", internal: false },
      ],
      "Wi-Fi": [{ mac: PHYSICAL_MAC, internal: false }],
    };
    expect(collectMacAddresses(ifaces)).toEqual([PHYSICAL_MAC]);
  });

  it("TC-MFP-008: returns [] rather than throwing on nothing", () => {
    expect(collectMacAddresses(null)).toEqual([]);
    expect(collectMacAddresses({})).toEqual([]);
  });
});

// ── pickPrimaryMac — the regression ──────────────────────────────────────

describe("pickPrimaryMac", () => {
  it("TC-MFP-009: picks the physical NIC even though the Hyper-V MAC sorts first", () => {
    const macs = [HYPERV_MAC, PHYSICAL_MAC];
    // This is exactly what the old code did, and why activation broke.
    expect(legacyLowestMac(macs)).toBe(HYPERV_MAC);
    expect(pickPrimaryMac(macs)).toBe(PHYSICAL_MAC);
  });

  it("TC-MFP-010: returns '' when every adapter is virtual", () => {
    expect(pickPrimaryMac([HYPERV_MAC, "02:42:ac:11:00:02"])).toBe("");
    expect(pickPrimaryMac([])).toBe("");
  });
});

// ── Fingerprint stability ────────────────────────────────────────────────

describe("fingerprint stability", () => {
  const hashFor = (macs: string[]) =>
    machineHashFromMaterial(
      buildFingerprintMaterial(PARTS, pickPrimaryMac(macs)),
      SALT,
    );

  it("TC-MFP-011: holds still when Docker Desktop starts and stops", () => {
    const dockerRunning = [HYPERV_MAC, PHYSICAL_MAC];
    const dockerStopped = [PHYSICAL_MAC];
    expect(hashFor(dockerRunning)).toBe(hashFor(dockerStopped));

    // Same scenario under the old rule: a different machine every time.
    const legacyHash = (macs: string[]) =>
      machineHashFromMaterial(
        buildFingerprintMaterial(PARTS, legacyLowestMac(macs)),
        SALT,
      );
    expect(legacyHash(dockerRunning)).not.toBe(legacyHash(dockerStopped));
  });

  it("TC-MFP-012: holds still when Hyper-V re-draws the virtual switch MAC", () => {
    expect(hashFor([HYPERV_MAC, PHYSICAL_MAC])).toBe(
      hashFor(["00:15:5d:01:99:07", PHYSICAL_MAC]),
    );
  });

  it("TC-MFP-013: an unreadable component leaves an empty slot instead of shifting", () => {
    // A PowerShell probe timing out must not slide the MAC into the disk
    // serial's position and mint a brand-new identity.
    const noDisk = { ...PARTS, diskSerial: "" };
    expect(buildFingerprintMaterial(noDisk, PHYSICAL_MAC)).toBe(
      `${PARTS.machineGuid}|${PARTS.smbiosUuid}||${PHYSICAL_MAC}`,
    );
    expect(buildFingerprintMaterial(noDisk, PHYSICAL_MAC)).not.toBe(
      [PARTS.machineGuid, PARTS.smbiosUuid, PHYSICAL_MAC].join("|"),
    );
  });

  it("TC-MFP-014: matches the pre-fix material byte for byte when nothing is missing", () => {
    // Licenses already issued to healthy machines must keep validating.
    const slots = [PARTS.machineGuid, PARTS.smbiosUuid, PARTS.diskSerial, PHYSICAL_MAC];
    expect(buildFingerprintMaterial(PARTS, PHYSICAL_MAC)).toBe(
      slots.filter(Boolean).join("|"),
    );
  });

  it("TC-MFP-015: the machine code keeps the APW-XXXX-…×8 shape", () => {
    const code = machineCodeFromMaterial(
      buildFingerprintMaterial(PARTS, PHYSICAL_MAC),
      SALT,
    );
    expect(code).toMatch(/^APW-([A-F0-9]{4}-){7}[A-F0-9]{4}$/);
  });
});

// ── acceptedMachineHashes — healing already-issued licenses ──────────────

describe("acceptedMachineHashes", () => {
  const macs = [HYPERV_MAC, PHYSICAL_MAC];
  const accepted = () => acceptedMachineHashes(PARTS, macs, SALT);

  it("TC-MFP-016: accepts a license bound to the virtual MAC the old code chose", () => {
    // The customer's serial was minted against the Hyper-V address. As long
    // as that adapter is still on the box, they keep working — no reissue.
    const legacyHash = machineHashFromMaterial(
      [PARTS.machineGuid, PARTS.smbiosUuid, PARTS.diskSerial, HYPERV_MAC].join("|"),
      SALT,
    );
    expect(accepted().has(legacyHash)).toBe(true);
  });

  it("TC-MFP-017: accepts the canonical hash a fresh activation binds to", () => {
    const canonical = machineHashFromMaterial(
      buildFingerprintMaterial(PARTS, pickPrimaryMac(macs)),
      SALT,
    );
    expect(accepted().has(canonical)).toBe(true);
  });

  it("TC-MFP-018: accepts the old drop-the-empties join when a probe had failed", () => {
    const partsNoDisk = { ...PARTS, diskSerial: "" };
    const legacyShifted = machineHashFromMaterial(
      [partsNoDisk.machineGuid, partsNoDisk.smbiosUuid, PHYSICAL_MAC].join("|"),
      SALT,
    );
    expect(acceptedMachineHashes(partsNoDisk, macs, SALT).has(legacyShifted)).toBe(
      true,
    );
  });

  it("TC-MFP-019: rejects a hash from a different machine", () => {
    const otherBox = {
      machineGuid: "11111111-2222-3333-4444-555555555555",
      smbiosUuid: "AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEEE",
      diskSerial: "OTHER_DISK_0001",
    };
    const foreign = machineHashFromMaterial(
      buildFingerprintMaterial(otherBox, PHYSICAL_MAC),
      SALT,
    );
    expect(accepted().has(foreign)).toBe(false);
  });

  it("TC-MFP-020: stays a small bounded set — tolerance, not a blank cheque", () => {
    // 3 MAC slots ("", 2 adapters) x 2 join shapes, minus collisions.
    expect(accepted().size).toBeLessThanOrEqual(6);
  });
});

// ── stableCoreHash — scope of the remembered-binding memory ──────────────

describe("stableCoreHash", () => {
  it("TC-MFP-021: ignores the MAC, so adapter churn keeps the same core", () => {
    // main.cjs honours a previously-proved binding only while this value
    // holds. It must not move when a network adapter does, or the memory
    // would expire for the exact case it exists to cover.
    expect(stableCoreHash(PARTS, SALT)).toBe(stableCoreHash({ ...PARTS }, SALT));
  });

  it("TC-MFP-022: changes when any hardware component changes", () => {
    const base = stableCoreHash(PARTS, SALT);
    expect(stableCoreHash({ ...PARTS, machineGuid: "other" }, SALT)).not.toBe(base);
    expect(stableCoreHash({ ...PARTS, smbiosUuid: "other" }, SALT)).not.toBe(base);
    expect(stableCoreHash({ ...PARTS, diskSerial: "other" }, SALT)).not.toBe(base);
  });

  it("TC-MFP-023: an unreadable component does not collide with a shifted one", () => {
    // Same positional discipline as buildFingerprintMaterial: a blank slot
    // must not let two different machines share a core.
    expect(stableCoreHash({ machineGuid: "a", smbiosUuid: "", diskSerial: "b" }, SALT)).not.toBe(
      stableCoreHash({ machineGuid: "a", smbiosUuid: "b", diskSerial: "" }, SALT),
    );
  });
});
