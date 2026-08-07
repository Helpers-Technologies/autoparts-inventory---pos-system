import { describe, expect, it } from "vitest";
import {
  encryptBackupWithPassphrase,
  decryptBackupWithPassphrase,
} from "../../../electron/backup-crypto.cjs";
import { isRendererStorageKey } from "../../../electron/storage-security.cjs";

/**
 * The cloud archive uploads every key `isRendererStorageKey` accepts. These
 * tests pin what that means, because the archive leaves the machine: a secret
 * that slips into the set would be shipped to the portal on the next sync.
 */
describe("cloud archive scope", () => {
  it("includes ordinary shop data", () => {
    for (const key of [
      "autoparts_inventory_v1::products",
      "autoparts_inventory_v1::suppliers",
      "autoparts_inventory_v1::purchaseInvoices",
      "autoparts_inventory_v1::expenses",
      "autoparts_inventory_v1::auditLogs",
      "autoparts_inventory_v1::branches",
      "autoparts_inventory_v1::settings",
    ]) {
      expect(isRendererStorageKey(key), key).toBe(true);
    }
  });

  it("excludes the licence token, the session, and the archive passphrase itself", () => {
    for (const key of [
      "__license_token",
      "__license_last_seen_at",
      "autoparts_inventory_v1::auth",
      // Internal keys carry no prefix, so they fall outside the archive. The
      // passphrase being excluded is what stops the archive from shipping the
      // key that opens it.
      "__cloud_archive_passphrase",
      "__cloud_archive_hash",
      "__commerce_sync_hash",
    ]) {
      expect(isRendererStorageKey(key), key).toBe(false);
    }
  });
});

describe("cloud archive envelope", () => {
  const payload = JSON.stringify({
    archiveVersion: 1,
    state: { "autoparts_inventory_v1::products": '[{"id":"p1","name":"فلتر زيت"}]' },
  });

  it("round-trips through the passphrase envelope the portal accepts", () => {
    const envelope = encryptBackupWithPassphrase(payload, "a long owner passphrase");
    // The portal validates exactly these fields before storing.
    const parsed = JSON.parse(envelope);
    expect(parsed.v).toBe(2);
    expect(parsed.kdf).toBe("scrypt");
    expect(envelope).not.toContain("فلتر زيت");
    expect(decryptBackupWithPassphrase(envelope, "a long owner passphrase")).toBe(payload);
  });

  it("refuses to open with the wrong passphrase", () => {
    const envelope = encryptBackupWithPassphrase(payload, "a long owner passphrase");
    expect(() => decryptBackupWithPassphrase(envelope, "another passphrase")).toThrow();
  });
});

describe("async envelope", () => {
  it("produces an envelope the sync decryptor accepts, so the two stay compatible", async () => {
    const { encryptBackupWithPassphraseAsync } = await import(
      "../../../electron/backup-crypto.cjs"
    );
    const secret = "another long owner passphrase";
    const plaintext = JSON.stringify({ archiveVersion: 1, state: { a: "قطعة غيار" } });
    const envelope = await encryptBackupWithPassphraseAsync(plaintext, secret);
    expect(JSON.parse(envelope).v).toBe(2);
    expect(envelope).not.toContain("قطعة غيار");
    expect(decryptBackupWithPassphrase(envelope, secret)).toBe(plaintext);
    expect(() => decryptBackupWithPassphrase(envelope, "nope")).toThrow();
  });
});
