import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { computeStatus } from "../../../src/store/_pure";

describe("computeStatus", () => {
  it("returns 'unpaid' when nothing has been paid", () => {
    expect(computeStatus(100, 0)).toBe("unpaid");
  });

  it("returns 'partial' when paid is strictly between 0 and total", () => {
    expect(computeStatus(100, 50)).toBe("partial");
    expect(computeStatus(100, 1)).toBe("partial");
    expect(computeStatus(100, 99.999)).toBe("partial");
  });

  it("returns 'paid' when paid equals total", () => {
    expect(computeStatus(100, 100)).toBe("paid");
  });

  it("returns 'paid' for overpayments (paid > total)", () => {
    expect(computeStatus(100, 150)).toBe("paid");
  });

  it("returns 'paid' when total is zero or negative regardless of paid", () => {
    expect(computeStatus(0, 0)).toBe("paid");
    expect(computeStatus(0, 50)).toBe("paid");
    expect(computeStatus(-10, 0)).toBe("paid");
  });

  it("treats negative paid as 'unpaid' (defensive)", () => {
    expect(computeStatus(100, -5)).toBe("unpaid");
  });

  it("partitions the (total, paid) plane correctly (property)", () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0.01, max: 1_000_000, noNaN: true }),
        fc.double({ min: -1_000_000, max: 2_000_000, noNaN: true }),
        (total, paid) => {
          const status = computeStatus(total, paid);
          if (paid <= 0) return status === "unpaid";
          if (paid >= total) return status === "paid";
          return status === "partial";
        },
      ),
    );
  });
});
