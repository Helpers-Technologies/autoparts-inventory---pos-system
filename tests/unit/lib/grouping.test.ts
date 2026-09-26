import { describe, expect, it } from "vitest";
import { groupByKey, latestValueByKey } from "../../../src/lib/grouping";

describe("groupByKey", () => {
  it("groups every record once while preserving source order", () => {
    const records = [
      { partyId: "c1", invoice: "1" },
      { partyId: "c2", invoice: "2" },
      { partyId: "c1", invoice: "3" },
    ];
    let keyReads = 0;

    const groups = groupByKey(records, (record) => {
      keyReads += 1;
      return record.partyId;
    });

    expect(keyReads).toBe(records.length);
    expect(groups.get("c1")?.map((record) => record.invoice)).toEqual(["1", "3"]);
    expect(groups.get("c2")?.map((record) => record.invoice)).toEqual(["2"]);
    expect(groups.get("missing")).toBeUndefined();
  });
});

describe("latestValueByKey", () => {
  it("matches a filter-and-sort reference result without rescanning per party", () => {
    const records = Array.from({ length: 40_000 }, (_, index) => ({
      partyId: `party-${index % 2_000}`,
      date: `2026-${String((index % 12) + 1).padStart(2, "0")}-${String((index % 28) + 1).padStart(2, "0")}`,
      cancelled: index % 17 === 0,
    }));
    let includeReads = 0;
    let keyReads = 0;
    let valueReads = 0;

    const latest = latestValueByKey(
      records,
      (record) => {
        keyReads += 1;
        return record.partyId;
      },
      (record) => {
        valueReads += 1;
        return record.date;
      },
      (record) => {
        includeReads += 1;
        return !record.cancelled;
      }
    );

    const expectedForFirstParty = records
      .filter((record) => record.partyId === "party-0" && !record.cancelled)
      .map((record) => record.date)
      .sort()
      .at(-1);
    const includedCount = records.filter((record) => !record.cancelled).length;

    expect(latest.get("party-0")).toBe(expectedForFirstParty);
    expect(includeReads).toBe(records.length);
    expect(keyReads).toBe(includedCount);
    expect(valueReads).toBe(includedCount);
  });
});
