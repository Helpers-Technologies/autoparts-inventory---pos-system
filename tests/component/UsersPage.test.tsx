// @vitest-environment jsdom
/**
 * UsersPage component tests.
 *
 * Covers:
 *  - The users list renders each mock user's name, username and role badge.
 *  - Opening "add user" shows the branch-assignment Select only when there is
 *    more than one active branch (useAutoPartsPro().branches).
 *  - Opening "add user" with a single active branch hides the branch Select.
 *  - Confirming deletion of a user that deleteUser() blocks (returns false,
 *    e.g. because they have shifts/invoices referencing them) shows an error
 *    toast instead of the success toast, and does not report success.
 *
 * TC-COMP-USERS-001 through TC-COMP-USERS-004
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import userEvent from "@testing-library/user-event";
import { screen, within, cleanup } from "@testing-library/react";
import { UsersPage } from "../../src/pages/UsersPage";
import { renderWithProviders } from "../helpers/render";
import { createPermissions } from "../../src/lib/permissions";
import type { AppUser, Branch } from "../../src/types";

// ── Module-level mocks ────────────────────────────────────────────────────────

const mockUseUsers = vi.fn();
const mockUseAutoPartsPro = vi.fn();
const mockUseFeatures = vi.fn();

vi.mock("../../src/store/UsersContext", () => ({
  useUsers: () => mockUseUsers(),
}));

vi.mock("../../src/store/AutoPartsProContext", () => ({
  useAutoPartsPro: () => mockUseAutoPartsPro(),
}));

vi.mock("../../src/lib/useFeatures", () => ({
  useFeatures: () => mockUseFeatures(),
}));

// ── Fixtures ──────────────────────────────────────────────────────────────────

const EMPLOYEE_A: AppUser = {
  id: "u-emp-1",
  name: "أحمد محمد",
  username: "ahmed",
  passwordHash: "[REDACTED]",
  role: "employee",
  permissions: createPermissions(false),
  createdAt: "2026-01-01T00:00:00.000Z",
};

const EMPLOYEE_B: AppUser = {
  id: "u-emp-2",
  name: "سارة علي",
  username: "sara",
  passwordHash: "[REDACTED]",
  role: "employee",
  permissions: createPermissions(false),
  createdAt: "2026-01-02T00:00:00.000Z",
};

const OWNER: AppUser = {
  id: "u-owner",
  name: "المالك",
  username: "owner",
  passwordHash: "[REDACTED]",
  role: "owner",
  permissions: createPermissions(true),
  createdAt: "2026-01-01T00:00:00.000Z",
};

function branch(id: string, name: string, active = true): Branch {
  return { id, code: id.toUpperCase(), name, isMain: id === "branch_main", active, createdAt: "2026-01-01T00:00:00.000Z" };
}

function autoPartsPro(branches: Branch[]) {
  return {
    branches,
    customerVehicles: [],
    warrantyClaims: [],
    branchStocks: [],
    stockTransfers: [],
    priceTiers: [],
  };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function rowFor(name: string): HTMLElement {
  const cell = screen.getByText(name);
  const row = cell.closest("tr");
  if (!row) throw new Error(`No <tr> found for "${name}"`);
  return row as HTMLElement;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("UsersPage — TC-COMP-USERS", () => {
  let mockDeleteUser: ReturnType<typeof vi.fn>;
  let mockAddUser: ReturnType<typeof vi.fn>;
  let mockUpdateUser: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.resetAllMocks();
    mockDeleteUser = vi.fn();
    mockAddUser = vi.fn();
    mockUpdateUser = vi.fn();
    mockUseUsers.mockReturnValue({
      users: [OWNER, EMPLOYEE_A, EMPLOYEE_B],
      addUser: mockAddUser,
      updateUser: mockUpdateUser,
      deleteUser: mockDeleteUser,
    });
    mockUseAutoPartsPro.mockReturnValue(autoPartsPro([branch("branch_main", "الفرع الرئيسي")]));
    // Two-factor auth off by default — keeps rows/columns simple for tests
    // that don't care about the MFA badge/reset flow.
    mockUseFeatures.mockReturnValue({ isEnabled: () => true, isAllowed: () => false });
    (window as unknown as Record<string, unknown>).desktopAPI = undefined;
  });

  afterEach(() => {
    cleanup();
    delete (window as unknown as Record<string, unknown>).desktopAPI;
  });

  it("TC-COMP-USERS-001 — renders the users list with name, username and role for each mock user", () => {
    renderWithProviders(<UsersPage />);

    expect(screen.getByText("أحمد محمد")).toBeInTheDocument();
    expect(screen.getByText("ahmed")).toBeInTheDocument();
    expect(screen.getByText("سارة علي")).toBeInTheDocument();
    expect(screen.getByText("sara")).toBeInTheDocument();
    expect(screen.getByText("المالك")).toBeInTheDocument();
    expect(screen.getByText("owner")).toBeInTheDocument();

    // Owner gets the "مدير النظام" badge, employees get "موظف".
    expect(within(rowFor("المالك")).getByText("مدير النظام")).toBeInTheDocument();
    expect(within(rowFor("أحمد محمد")).getByText("موظف")).toBeInTheDocument();
  });

  it("TC-COMP-USERS-002 — add-user form shows the branch Select when there are 2+ active branches", async () => {
    mockUseAutoPartsPro.mockReturnValue(
      autoPartsPro([
        branch("branch_main", "الفرع الرئيسي"),
        branch("branch_2", "فرع المعادي"),
      ])
    );
    const user = userEvent.setup();
    renderWithProviders(<UsersPage />);

    await user.click(screen.getByRole("button", { name: /إضافة مستخدم/ }));

    const dialog = screen.getByRole("dialog", { name: "إضافة مستخدم جديد" });
    expect(within(dialog).getByText("الفرع")).toBeInTheDocument();
    const branchSelect = within(dialog).getByRole("combobox");
    expect(within(branchSelect).getByText("فرع المعادي")).toBeInTheDocument();
  });

  it("TC-COMP-USERS-003 — add-user form hides the branch Select when there is only one active branch", async () => {
    // Default mock already has a single active branch.
    const user = userEvent.setup();
    renderWithProviders(<UsersPage />);

    await user.click(screen.getByRole("button", { name: /إضافة مستخدم/ }));

    const dialog = screen.getByRole("dialog", { name: "إضافة مستخدم جديد" });
    expect(within(dialog).queryByText("الفرع")).not.toBeInTheDocument();
    expect(within(dialog).queryByRole("combobox")).not.toBeInTheDocument();
  });

  it("TC-COMP-USERS-004 — deleting a user blocked by deleteUser() (shifts/invoices) shows an error toast, not success", async () => {
    mockDeleteUser.mockReturnValue(false);
    const user = userEvent.setup();
    renderWithProviders(<UsersPage />);

    const row = rowFor("أحمد محمد");
    const buttons = within(row).getAllByRole("button");
    // Row actions for a non-owner with MFA off: [الأداء link is an <a>, edit, delete].
    // The trash/delete button is the last icon-only button in the row.
    await user.click(buttons[buttons.length - 1]);

    const confirmDialog = screen.getByRole("dialog", { name: "حذف المستخدم" });
    await user.click(within(confirmDialog).getByRole("button", { name: "حذف" }));

    expect(mockDeleteUser).toHaveBeenCalledWith("u-emp-1");
    const toastEl = await screen.findByRole("status");
    expect(toastEl).toHaveTextContent("لا يمكن حذف مستخدم لديه ورديات أو فواتير مرتبطة");
    expect(screen.queryByText("تم حذف المستخدم")).not.toBeInTheDocument();
  });
});
