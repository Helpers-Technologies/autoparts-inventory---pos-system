import { describe, it, expect } from "vitest";
import fc from "fast-check";
import {
  formatSupplierCode,
  nextSupplierCodeFromExisting,
} from "../../../src/lib/codes";

describe("formatSupplierCode", () => {
  it("pads to four digits with the SUP- prefix", () => {
    expect(formatSupplierCode(1)).toBe("SUP-0001");
    expect(formatSupplierCode(42)).toBe("SUP-0042");
    expect(formatSupplierCode(9999)).toBe("SUP-9999");
  });

  it("does not truncate values that exceed four digits", () => {
    expect(formatSupplierCode(10000)).toBe("SUP-10000");
  });

  it("floors fractional input", () => {
    expect(formatSupplierCode(3.9)).toBe("SUP-0003");
  });

  it("falls back to 1 for non-finite or non-positive input", () => {
    expect(formatSupplierCode(0)).toBe("SUP-0001");
    expect(formatSupplierCode(-7)).toBe("SUP-0001");
    expect(formatSupplierCode(Number.NaN)).toBe("SUP-0001");
    expect(formatSupplierCode(Number.POSITIVE_INFINITY)).toBe("SUP-0001");
  });
});

describe("nextSupplierCodeFromExisting", () => {
  it("returns 1 for an empty list", () => {
    expect(nextSupplierCodeFromExisting([])).toBe(1);
  });

  it("returns max numeric suffix + 1", () => {
    expect(
      nextSupplierCodeFromExisting([
        { code: "SUP-0001" },
        { code: "SUP-0003" },
        { code: "SUP-0010" },
      ]),
    ).toBe(11);
  });

  it("ignores entries with malformed or missing codes", () => {
    expect(
      nextSupplierCodeFromExisting([
        { code: "SUP-0005" },
        { code: "BAD-0009" },
        { code: undefined },
        {},
        { code: "" },
      ]),
    ).toBe(6);
  });

  it("is case-insensitive on the prefix", () => {
    expect(
      nextSupplierCodeFromExisting([{ code: "sup-0007" }, { code: "Sup-0012" }]),
    ).toBe(13);
  });

  it("trims surrounding whitespace before matching", () => {
    expect(nextSupplierCodeFromExisting([{ code: "  SUP-0020  " }])).toBe(21);
  });

  it("is monotonically increasing under append (property)", () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: 1, max: 100000 }), { minLength: 0, maxLength: 50 }),
        fc.integer({ min: 1, max: 100000 }),
        (existingNumbers, addedNumber) => {
          const before = existingNumbers.map((n) => ({
            code: `SUP-${String(n).padStart(4, "0")}`,
          }));
          const after = [
            ...before,
            { code: `SUP-${String(addedNumber).padStart(4, "0")}` },
          ];
          const nextBefore = nextSupplierCodeFromExisting(before);
          const nextAfter = nextSupplierCodeFromExisting(after);
          return nextAfter >= nextBefore;
        },
      ),
    );
  });

  it("never collides with any existing code (property)", () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: 1, max: 100000 }), { minLength: 1, maxLength: 50 }),
        (numbers) => {
          const suppliers = numbers.map((n) => ({
            code: `SUP-${String(n).padStart(4, "0")}`,
          }));
          const next = nextSupplierCodeFromExisting(suppliers);
          return !numbers.includes(next);
        },
      ),
    );
  });
});
