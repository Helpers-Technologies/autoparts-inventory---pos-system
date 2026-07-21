import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { hashPassword, verifyFallbackPassword } from "../../../src/lib/auth";

// auth.ts branches on window.desktopAPI — these tests cover the web fallback path.
// The Argon2 (desktop) path is tested via IPC integration tests (Wave 4).

function setWindow(desktopAPI: unknown = undefined) {
  vi.stubGlobal("window", { desktopAPI });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("hashPassword (web fallback — SHA-256)", () => {
  beforeEach(() => setWindow(undefined));

  it("returns a 'sha256:' prefixed hex string", async () => {
    const hash = await hashPassword("secret");
    expect(hash).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it("is deterministic — same password always produces the same hash", async () => {
    const [h1, h2] = await Promise.all([hashPassword("same"), hashPassword("same")]);
    expect(h1).toBe(h2);
  });

  it("produces different hashes for different passwords", async () => {
    const [h1, h2] = await Promise.all([hashPassword("abc"), hashPassword("xyz")]);
    expect(h1).not.toBe(h2);
  });

  it("handles empty string without throwing", async () => {
    const hash = await hashPassword("");
    expect(hash).toMatch(/^sha256:/);
  });

  it("handles very long passwords", async () => {
    const hash = await hashPassword("a".repeat(1000));
    expect(hash).toMatch(/^sha256:[0-9a-f]{64}$/);
  });
});

describe("hashPassword (desktop IPC path)", () => {
  it("delegates to window.desktopAPI.auth.hashPassword when available", async () => {
    const mockHash = "argon2id$v=19$m=65536$mocked";
    const mockHashFn = vi.fn().mockResolvedValue(mockHash);
    setWindow({ auth: { hashPassword: mockHashFn } });

    const result = await hashPassword("any-password");

    expect(mockHashFn).toHaveBeenCalledOnce();
    expect(mockHashFn).toHaveBeenCalledWith("any-password");
    expect(result).toBe(mockHash);
  });
});

describe("verifyFallbackPassword", () => {
  beforeEach(() => setWindow(undefined));

  describe("sha256 hashes", () => {
    it("returns true when password matches the stored sha256 hash", async () => {
      const hash = await hashPassword("correct");
      expect(await verifyFallbackPassword(hash, "correct")).toBe(true);
    });

    it("returns false when password does not match the sha256 hash", async () => {
      const hash = await hashPassword("correct");
      expect(await verifyFallbackPassword(hash, "wrong")).toBe(false);
    });
  });

  describe("legacy btoa hashes", () => {
    it("returns false for btoa-encoded stored value (btoa path is unsupported)", async () => {
      const stored = btoa("legacy-password");
      expect(await verifyFallbackPassword(stored, "legacy-password")).toBe(false);
    });

    it("returns false when password does not match the btoa value", async () => {
      const stored = btoa("correct");
      expect(await verifyFallbackPassword(stored, "wrong")).toBe(false);
    });

    it("treats any non-sha256 hash as unsupported and returns false", async () => {
      expect(await verifyFallbackPassword("notbase64", "anything")).toBe(false);
    });
  });
});
