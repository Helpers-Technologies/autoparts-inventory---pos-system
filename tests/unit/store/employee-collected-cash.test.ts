/**
 * employeeCollectedCash — THE single commission base (OBS-02, report 09):
 * net cash the employee collected in a period. Shared by EmployeeReportPage
 * (quarters, via employeeSalesStats) and ReportsPage (free date range).
 */
import { describe, it, expect } from "vitest";
import { employeeCollectedCash } from "../../../src/store/_pure";

const EMP = "usr_emp1";

const invoices = [
  { id: "inv1", createdByUserId: EMP, cancelled: undefined },
  { id: "inv2", createdByUserId: EMP, cancelled: true },
  { id: "inv3", createdByUserId: "usr_other", cancelled: undefined },
  { id: "inv4", createdByUserId: undefined, cancelled: undefined },
];

const returns = [
  { id: "ret1", originalInvoiceId: "inv1" },
  { id: "ret2", originalInvoiceId: "inv3" },
];

function entry(referenceId: string, date: string, type: "sales-receipt" | "adjustment", amount: number) {
  return { referenceId, date, type, amount } as const;
}

describe("employeeCollectedCash — TC-UNIT-ECC", () => {
  it("TC-ECC-001 — sums receipts on the employee's invoices inside the range", () => {
    const cash = [
      entry("inv1", "2026-05-01", "sales-receipt", 300),
      entry("inv1", "2026-05-20", "sales-receipt", 200),
    ];
    expect(employeeCollectedCash(invoices, returns, cash, EMP, "2026-05-01", "2026-05-31")).toBe(500);
  });

  it("TC-ECC-002 — range boundaries are inclusive on both ends", () => {
    const cash = [
      entry("inv1", "2026-04-30", "sales-receipt", 50),
      entry("inv1", "2026-05-01", "sales-receipt", 100),
      entry("inv1", "2026-05-31", "sales-receipt", 200),
      entry("inv1", "2026-06-01", "sales-receipt", 400),
    ];
    expect(employeeCollectedCash(invoices, returns, cash, EMP, "2026-05-01", "2026-05-31")).toBe(300);
  });

  it("TC-ECC-003 — cancelled invoices and other employees' invoices are excluded", () => {
    const cash = [
      entry("inv2", "2026-05-10", "sales-receipt", 900), // cancelled
      entry("inv3", "2026-05-10", "sales-receipt", 700), // other employee
      entry("inv4", "2026-05-10", "sales-receipt", 600), // unattributed
    ];
    expect(employeeCollectedCash(invoices, returns, cash, EMP, "2026-05-01", "2026-05-31")).toBe(0);
  });

  it("TC-ECC-004 — refund adjustments on the employee's returns are deducted", () => {
    const cash = [
      entry("inv1", "2026-05-05", "sales-receipt", 500),
      entry("ret1", "2026-05-08", "adjustment", -150), // refund for inv1's return
      entry("ret2", "2026-05-08", "adjustment", -999), // other employee's return
    ];
    expect(employeeCollectedCash(invoices, returns, cash, EMP, "2026-05-01", "2026-05-31")).toBe(350);
  });

  it("TC-ECC-005 — edit/cancellation adjustments on the invoice itself count", () => {
    const cash = [
      entry("inv1", "2026-05-05", "sales-receipt", 500),
      entry("inv1", "2026-05-09", "adjustment", -80), // invoice-edit cash delta
    ];
    expect(employeeCollectedCash(invoices, returns, cash, EMP, "2026-05-01", "2026-05-31")).toBe(420);
  });

  it("TC-ECC-006 — entries with no referenceId or unrelated references are ignored", () => {
    const cash = [
      { referenceId: undefined, date: "2026-05-05", type: "sales-receipt", amount: 1000 } as const,
      entry("something-else", "2026-05-05", "sales-receipt", 1000),
    ];
    expect(employeeCollectedCash(invoices, returns, cash, EMP, "2026-05-01", "2026-05-31")).toBe(0);
  });
});
