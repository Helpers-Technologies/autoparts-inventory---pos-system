import { describe, it, expect } from "vitest";
import { compareVersions, releasesSince, RELEASES } from "../../../src/lib/whatsNew";

describe("compareVersions", () => {
  it("orders by major, then minor, then patch", () => {
    expect(compareVersions("3.3.4", "3.3.3")).toBeGreaterThan(0);
    expect(compareVersions("3.3.3", "3.3.4")).toBeLessThan(0);
    expect(compareVersions("4.0.0", "3.9.9")).toBeGreaterThan(0);
    expect(compareVersions("3.2.0", "3.10.0")).toBeLessThan(0);
  });

  it("treats equal versions as 0", () => {
    expect(compareVersions("3.3.4", "3.3.4")).toBe(0);
  });

  it("pads missing segments with 0", () => {
    expect(compareVersions("3.3", "3.3.0")).toBe(0);
    expect(compareVersions("3.3.1", "3.3")).toBeGreaterThan(0);
  });

  it("never throws on malformed input", () => {
    expect(() => compareVersions("", "")).not.toThrow();
    expect(() => compareVersions("abc", "3.x.1")).not.toThrow();
    expect(compareVersions("3.3.4", "garbage")).toBeGreaterThan(0);
  });
});

describe("releasesSince", () => {
  it("returns nothing for a fresh install (null baseline)", () => {
    expect(releasesSince(null)).toEqual([]);
    expect(releasesSince("")).toEqual([]);
  });

  it("returns only releases strictly newer than the baseline", () => {
    const since = releasesSince("3.1.0");
    expect(since.map((r) => r.version)).toEqual(["6.0.2", "6.0.1", "6.0.0", "5.0.0", "4.0.0", "3.8.0", "3.7.0", "3.6.0", "3.5.1", "3.5.0", "3.4.0", "3.3.4", "3.2.0"]);
  });

  it("returns nothing when the user is already on the latest", () => {
    const latest = RELEASES[0].version;
    expect(releasesSince(latest)).toEqual([]);
  });

  it("preserves newest-first ordering", () => {
    const versions = releasesSince("3.0.0").map((r) => r.version);
    const sorted = [...versions].sort((a, b) => compareVersions(b, a));
    expect(versions).toEqual(sorted);
  });
});

describe("RELEASES data", () => {
  it("is ordered newest-first and has unique versions", () => {
    for (let i = 1; i < RELEASES.length; i++) {
      expect(compareVersions(RELEASES[i - 1].version, RELEASES[i].version)).toBeGreaterThan(0);
    }
  });

  it("every highlight has a known tone", () => {
    const tones = new Set(["feature", "fix", "improvement"]);
    for (const r of RELEASES) {
      for (const h of r.highlights) {
        expect(tones.has(h.tone)).toBe(true);
      }
    }
  });
});
