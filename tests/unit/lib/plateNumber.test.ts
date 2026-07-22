import { describe, expect, it } from "vitest";
import { formatEgyptianPlateNumber, validateEgyptianPlateNumber } from "../../../src/lib/plateNumber";

describe("Egyptian License Plate Formatter & Validator", () => {
  it("formats unspaced Arabic letters and digits automatically", () => {
    expect(formatEgyptianPlateNumber("أبج1234")).toBe("أ ب ج    1 2 3 4");
    expect(formatEgyptianPlateNumber("أبج 1234")).toBe("أ ب ج    1 2 3 4");
    expect(formatEgyptianPlateNumber("أب123")).toBe("أ ب    1 2 3");
  });

  it("converts Arabic-Indic numerals to standard ASCII numerals and formats spacing", () => {
    expect(formatEgyptianPlateNumber("ا ب ١ ٢ ٣ ٤")).toBe("ا ب    1 2 3 4");
    expect(formatEgyptianPlateNumber("س ط ع ٤٨٢١")).toBe("س ط ع    4 8 2 1");
  });

  it("enforces max limit of 3 letters and 4 numbers", () => {
    expect(formatEgyptianPlateNumber("أ ب ج د 1 2 3 4 5")).toBe("أ ب ج    1 2 3 4");
  });

  it("validates 2-3 letters and 3-4 numbers rule", () => {
    expect(validateEgyptianPlateNumber("أ ب ج 1 2 3 4").isValid).toBe(true);
    expect(validateEgyptianPlateNumber("أ ب 1 2 3").isValid).toBe(true);
    expect(validateEgyptianPlateNumber("أ 1 2 3 4").isValid).toBe(false); // Only 1 letter
    expect(validateEgyptianPlateNumber("أ ب 1 2").isValid).toBe(false); // Only 2 digits
  });
});
