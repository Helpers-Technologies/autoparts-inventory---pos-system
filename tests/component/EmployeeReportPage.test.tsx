// @vitest-environment jsdom
/**
 * EmployeeReportPage component tests.
 *
 * Covers the batching regression: this page used to call employeeSalesStats(id, month)
 * once per employee inside .map() (re-scanning all invoices per employee). It was
 * changed to call the new employeeSalesStatsBatch(employeeIds, month) exactly ONCE via
 * useMemo, then look up each employee's stats from the returned Map.
 *
 * TC-COMP-EMPREPORT-001
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { screen, cleanup } from "@testing-library/react";
import { EmployeeReportPage } from "../../src/pages/EmployeeReportPage";
import { renderWithProviders } from "../helpers/render";
import { createPermissions } from "../../src/lib/permissions";
import type { AppUser, Settings } from "../../src/types";

// ── Fixtures ──────────────────────────────────────────────────────────────────

const employeeOne: AppUser = {
  id: "emp-1",
  name: "Ahmed Hassan",
  username: "ahmed",
  passwordHash: "[REDACTED]",
  role: "employee",
  permissions: createPermissions(false),
  createdAt: "2026-01-01T00:00:00.000Z",
};

const employeeTwo: AppUser = {
  id: "emp-2",
  name: "Sara Youssef",
  username: "sara",
  passwordHash: "[REDACTED]",
  role: "employee",
  permissions: createPermissions(false),
  createdAt: "2026-01-01T00:00:00.000Z",
};

const settings = {
  currency: "ج.م",
} as Settings;

const statsMap = new Map([
  [
    "emp-1",
    {
      totalCollected: 5000,
      commissionEarned: 200,
      commissionPct: 4,
      target: 4000,
      salary: 3000,
      totalEarnings: 3200,
      monthLabel: "يوليو 2026",
    },
  ],
  [
    "emp-2",
    {
      totalCollected: 8000,
      commissionEarned: 400,
      commissionPct: 5,
      target: 6000,
      salary: 3500,
      totalEarnings: 3900,
      monthLabel: "يوليو 2026",
    },
  ],
]);

// ── Module-level mocks ────────────────────────────────────────────────────────

const mockEmployeeSalesStatsBatch = vi.fn(() => statsMap);

vi.mock("../../src/store/UsersContext", () => ({
  useUsers: () => ({
    users: [employeeOne, employeeTwo],
  }),
}));

vi.mock("../../src/store/ReportingContext", () => ({
  useReporting: () => ({
    employeeSalesStatsBatch: mockEmployeeSalesStatsBatch,
  }),
}));

vi.mock("../../src/store/SettingsContext", () => ({
  useSettings: () => ({ settings }),
}));

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("EmployeeReportPage — TC-COMP-EMPREPORT", () => {
  afterEach(() => {
    cleanup();
    mockEmployeeSalesStatsBatch.mockClear();
  });

  it("TC-COMP-EMPREPORT-001 — calls employeeSalesStatsBatch exactly once (batched, not per-employee) and renders both employee names", () => {
    renderWithProviders(<EmployeeReportPage />);

    // Regression check: previously employeeSalesStats was called once per employee
    // inside .map(); the batched version must be called exactly once for the whole page.
    expect(mockEmployeeSalesStatsBatch).toHaveBeenCalledTimes(1);
    expect(mockEmployeeSalesStatsBatch).toHaveBeenCalledWith(
      ["emp-1", "emp-2"],
      expect.any(String)
    );

    expect(screen.getByText("Ahmed Hassan")).toBeInTheDocument();
    expect(screen.getByText("Sara Youssef")).toBeInTheDocument();
  });
});
