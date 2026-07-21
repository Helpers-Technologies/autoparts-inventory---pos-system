import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { buildEmployeeStatementRows, computeOfflineEmployeeSummary } from "../../../src/store/_pure";
import type { OfflineEmployeeTransaction, OfflineEmployeeTransactionType } from "../../../src/types";

/**
 * V4 feature — الموظفون بدون حسابات (offline employees).
 * computeOfflineEmployeeSummary aggregates an employee's salary/advance/
 * incentive/deduction transactions into the running totals the page displays.
 */
function tx(
  employeeId: string,
  type: OfflineEmployeeTransactionType,
  amount: number,
  date = "2026-06-01",
): OfflineEmployeeTransaction {
  return {
    id: `tx-${Math.random()}`,
    employeeId,
    type,
    amount,
    date,
    createdAt: `${date}T00:00:00.000Z`,
  };
}

describe("computeOfflineEmployeeSummary", () => {
  it("returns all-zero summary when the employee has no transactions", () => {
    const s = computeOfflineEmployeeSummary("E1", []);
    expect(s).toEqual({
      totalSalary: 0,
      totalAdvances: 0,
      totalAdvanceDeductions: 0,
      totalIncentives: 0,
      totalDeductions: 0,
      outstandingAdvance: 0,
    });
  });

  it("sums each transaction type into its own bucket", () => {
    const txs = [
      tx("E1", "salary", 3000),
      tx("E1", "salary", 3000),
      tx("E1", "advance", 500),
      tx("E1", "incentive", 200),
      tx("E1", "deduction", 100),
    ];
    const s = computeOfflineEmployeeSummary("E1", txs);
    expect(s.totalSalary).toBe(6000);
    expect(s.totalAdvances).toBe(500);
    expect(s.totalIncentives).toBe(200);
    expect(s.totalDeductions).toBe(100);
  });

  it("only counts transactions belonging to the given employee", () => {
    const txs = [
      tx("E1", "salary", 3000),
      tx("E2", "salary", 9999),
      tx("E2", "advance", 4444),
    ];
    const s = computeOfflineEmployeeSummary("E1", txs);
    expect(s.totalSalary).toBe(3000);
    expect(s.totalAdvances).toBe(0);
  });

  it("outstanding advance = advances taken − advance-deductions repaid", () => {
    const txs = [
      tx("E1", "advance", 1000),
      tx("E1", "advance", 500),
      tx("E1", "advance-deduction", 300),
    ];
    const s = computeOfflineEmployeeSummary("E1", txs);
    expect(s.totalAdvances).toBe(1500);
    expect(s.totalAdvanceDeductions).toBe(300);
    expect(s.outstandingAdvance).toBe(1200);
  });

  it("never reports a negative outstanding advance (over-repayment clamps to 0)", () => {
    const txs = [
      tx("E1", "advance", 500),
      tx("E1", "advance-deduction", 800), // repaid more than was taken
    ];
    const s = computeOfflineEmployeeSummary("E1", txs);
    expect(s.outstandingAdvance).toBe(0);
  });

  it("a fully-repaid advance leaves zero outstanding", () => {
    const txs = [
      tx("E1", "advance", 700),
      tx("E1", "advance-deduction", 700),
    ];
    expect(computeOfflineEmployeeSummary("E1", txs).outstandingAdvance).toBe(0);
  });

  it("tolerates malformed amounts (treats missing/NaN as 0)", () => {
    const txs = [
      { ...tx("E1", "salary", Number.NaN) },
      tx("E1", "salary", 100),
    ];
    expect(computeOfflineEmployeeSummary("E1", txs).totalSalary).toBe(100);
  });

  it("property (summary): outstandingAdvance is always ≥ 0 and the buckets never mix", () => {
    const arbType: fc.Arbitrary<OfflineEmployeeTransactionType> = fc.constantFrom(
      "salary", "advance", "incentive", "deduction", "advance-deduction",
    );
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            type: arbType,
            amount: fc.double({ min: 0, max: 1_000_000, noNaN: true }),
          }),
        ),
        (rows) => {
          const txs = rows.map((r) => tx("E1", r.type, r.amount));
          const s = computeOfflineEmployeeSummary("E1", txs);
          const expectAdv = rows.filter((r) => r.type === "advance").reduce((a, r) => a + r.amount, 0);
          const expectAdvDed = rows.filter((r) => r.type === "advance-deduction").reduce((a, r) => a + r.amount, 0);
          return (
            s.outstandingAdvance >= 0 &&
            s.outstandingAdvance === Math.max(0, expectAdv - expectAdvDed) &&
            Math.abs(s.totalAdvances - expectAdv) < 1e-6
          );
        },
      ),
    );
  });
});

describe("buildEmployeeStatementRows — كشف حساب الموظف", () => {
  it("returns an empty ledger when the employee has no transactions", () => {
    expect(buildEmployeeStatementRows("E1", [])).toEqual([]);
  });

  it("sorts rows chronologically (oldest first)", () => {
    const txs = [
      tx("E1", "salary", 3000, "2026-03-10"),
      tx("E1", "advance", 500, "2026-01-05"),
      tx("E1", "incentive", 200, "2026-02-20"),
    ];
    const rows = buildEmployeeStatementRows("E1", txs);
    expect(rows.map((r) => r.date)).toEqual(["2026-01-05", "2026-02-20", "2026-03-10"]);
  });

  it("classifies salaries/incentives/advances as credit; deductions/advance-deductions as debit", () => {
    const rows = buildEmployeeStatementRows("E1", [
      tx("E1", "salary", 3000, "2026-01-01"),
      tx("E1", "incentive", 200, "2026-01-02"),
      tx("E1", "advance", 500, "2026-01-03"),
      tx("E1", "deduction", 100, "2026-01-04"),
      tx("E1", "advance-deduction", 300, "2026-01-05"),
    ]);
    expect(rows.map((r) => r.credit)).toEqual([3000, 200, 500, 0, 0]);
    expect(rows.map((r) => r.debit)).toEqual([0, 0, 0, 100, 300]);
  });

  it("tracks a running outstanding-advance balance (advance adds, repayment subtracts)", () => {
    const rows = buildEmployeeStatementRows("E1", [
      tx("E1", "advance", 1000, "2026-01-01"),
      tx("E1", "salary", 3000, "2026-01-02"),       // does not affect the advance
      tx("E1", "advance-deduction", 400, "2026-01-03"),
      tx("E1", "advance", 200, "2026-01-04"),
    ]);
    expect(rows.map((r) => r.outstandingAdvance)).toEqual([1000, 1000, 600, 800]);
  });

  it("never lets the running advance go negative (over-repayment floors at 0)", () => {
    const rows = buildEmployeeStatementRows("E1", [
      tx("E1", "advance", 300, "2026-01-01"),
      tx("E1", "advance-deduction", 500, "2026-01-02"),
    ]);
    expect(rows.map((r) => r.outstandingAdvance)).toEqual([300, 0]);
  });

  it("only includes the requested employee's transactions", () => {
    const rows = buildEmployeeStatementRows("E1", [
      tx("E1", "salary", 3000, "2026-01-01"),
      tx("E2", "salary", 9999, "2026-01-01"),
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0].credit).toBe(3000);
  });

  it("final outstandingAdvance matches the summary's outstandingAdvance", () => {
    const txs = [
      tx("E1", "advance", 1000, "2026-01-01"),
      tx("E1", "advance-deduction", 250, "2026-02-01"),
      tx("E1", "advance", 150, "2026-03-01"),
    ];
    const rows = buildEmployeeStatementRows("E1", txs);
    const summary = computeOfflineEmployeeSummary("E1", txs);
    expect(rows[rows.length - 1].outstandingAdvance).toBe(summary.outstandingAdvance);
  });
});
