// @vitest-environment jsdom
/**
 * ProtectedShell component tests.
 *
 * Covers:
 *  - Unauthenticated user is redirected to /login.
 *  - Authenticated owner can access ownerOnly routes.
 *  - Authenticated owner can access permission-gated routes regardless of permissions.
 *  - Employee without permission is redirected to /.
 *  - Employee with the required permission can access the route.
 *  - Employee is redirected from ownerOnly routes regardless of permissions.
 *  - Employee with no permission prop set can access a basic authenticated route.
 *
 * TC-COMP-PSHELL-001 through TC-COMP-PSHELL-007
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { ProtectedShell } from "../../src/components/layout/ProtectedShell";
import { ToastProvider } from "../../src/components/ui/Toast";
import { createPermissions } from "../../src/lib/permissions";
import type { AppUser, UserPermissions } from "../../src/types";

// ── Module-level mocks ────────────────────────────────────────────────────────

vi.mock("../../src/components/layout/AppLayout", () => ({
  AppLayout: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="app-layout">{children}</div>
  ),
}));

const mockUseAuth = vi.fn();

vi.mock("../../src/store/AuthContext", () => ({
  useAuth: () => mockUseAuth(),
}));

// ProtectedShell resolves module availability through useFeatures (license +
// settings). These tests focus on auth/permission logic, so default every
// feature to enabled; individual tests override to exercise feature gating.
const mockUseFeatures = vi.fn();

vi.mock("../../src/lib/useFeatures", () => ({
  useFeatures: () => mockUseFeatures(),
}));

// ── Fixtures ──────────────────────────────────────────────────────────────────

const OWNER: AppUser = {
  id: "u1",
  username: "owner",
  name: "Owner",
  role: "owner",
  passwordHash: "[REDACTED]",
  permissions: createPermissions(true),
  createdAt: "2026-01-01T00:00:00.000Z",
};

const employee = (overrides?: (p: UserPermissions) => void): AppUser => {
  const permissions = createPermissions(false);
  overrides?.(permissions);
  return {
    id: "u2", username: "emp", name: "Employee", role: "employee",
    passwordHash: "[REDACTED]", permissions,
    createdAt: "2026-01-01T00:00:00.000Z",
  };
};

const authenticatedAs = (user: AppUser) => ({
  auth: { isAuthenticated: true },
  currentUser: user,
});

const unauthenticated = () => ({
  auth: { isAuthenticated: false },
  currentUser: null,
});

// ── Render helper ─────────────────────────────────────────────────────────────

function renderProtected(
  // `children` is supplied by the helper below, so a caller only chooses the
  // gate it is testing.
  shellProps: Omit<React.ComponentProps<typeof ProtectedShell>, "children">,
  initialPath = "/target"
) {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <ToastProvider>
        <Routes>
          <Route
            path="/target"
            element={
              <ProtectedShell {...shellProps}>
                <div data-testid="protected-content">Protected</div>
              </ProtectedShell>
            }
          />
          <Route path="/" element={<div data-testid="dashboard">Dashboard</div>} />
          <Route path="/login" element={<div data-testid="login-page">Login</div>} />
        </Routes>
      </ToastProvider>
    </MemoryRouter>
  );
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("ProtectedShell — TC-COMP-PSHELL", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockUseFeatures.mockReturnValue({ isEnabled: () => true, isAllowed: () => true });
  });

  afterEach(() => {
    cleanup();
  });

  it("TC-COMP-PSHELL-001 — unauthenticated user is redirected to /login", () => {
    mockUseAuth.mockReturnValue(unauthenticated());
    renderProtected({});
    expect(screen.getByTestId("login-page")).toBeInTheDocument();
    expect(screen.queryByTestId("protected-content")).not.toBeInTheDocument();
  });

  it("TC-COMP-PSHELL-002 — owner can access ownerOnly routes", async () => {
    mockUseAuth.mockReturnValue(authenticatedAs(OWNER));
    renderProtected({ ownerOnly: true });
    // findBy, not getBy: the shell paints its boot screen first and mounts the
    // route on the next frame, so the first screen of a session is never a
    // blank window while a heavy page renders.
    expect(await screen.findByTestId("protected-content")).toBeInTheDocument();
    expect(screen.queryByTestId("dashboard")).not.toBeInTheDocument();
  });

  it("TC-COMP-PSHELL-003 — owner can access permission-gated routes regardless of permissions object", async () => {
    mockUseAuth.mockReturnValue(authenticatedAs(OWNER));
    renderProtected({ permission: "salesInvoices", permissionAction: "add" });
    expect(await screen.findByTestId("protected-content")).toBeInTheDocument();
  });

  it("TC-COMP-PSHELL-004 — employee without the required permission is redirected to /", () => {
    // employee has view but not add for salesInvoices
    mockUseAuth.mockReturnValue(authenticatedAs(employee((p) => { p.salesInvoices.view = true; })));
    renderProtected({ permission: "salesInvoices", permissionAction: "add" });
    expect(screen.getByTestId("dashboard")).toBeInTheDocument();
    expect(screen.queryByTestId("protected-content")).not.toBeInTheDocument();
  });

  it("TC-COMP-PSHELL-005 — employee with the required permission can access the route", async () => {
    // employee has both view and add for salesInvoices
    mockUseAuth.mockReturnValue(authenticatedAs(employee((p) => { p.salesInvoices.view = true; p.salesInvoices.add = true; })));
    renderProtected({ permission: "salesInvoices", permissionAction: "add" });
    expect(await screen.findByTestId("protected-content")).toBeInTheDocument();
    expect(screen.queryByTestId("dashboard")).not.toBeInTheDocument();
  });

  it("TC-COMP-PSHELL-006 — employee is blocked from ownerOnly routes regardless of permissions", () => {
    // even with all permissions enabled, employees can't reach ownerOnly routes
    mockUseAuth.mockReturnValue(authenticatedAs(employee((p) => { Object.assign(p, createPermissions(true)); })));
    renderProtected({ ownerOnly: true });
    expect(screen.getByTestId("dashboard")).toBeInTheDocument();
    expect(screen.queryByTestId("protected-content")).not.toBeInTheDocument();
  });

  it("TC-COMP-PSHELL-007 — authenticated employee without a permission prop can access the route", async () => {
    mockUseAuth.mockReturnValue(authenticatedAs(employee()));
    renderProtected({});
    expect(await screen.findByTestId("protected-content")).toBeInTheDocument();
  });

  it("TC-COMP-PSHELL-008 — route is redirected to / when its feature is disabled, even for the owner", () => {
    mockUseAuth.mockReturnValue(authenticatedAs(OWNER));
    mockUseFeatures.mockReturnValue({ isEnabled: () => false, isAllowed: () => false });
    renderProtected({ feature: "quotations" });
    expect(screen.getByTestId("dashboard")).toBeInTheDocument();
    expect(screen.queryByTestId("protected-content")).not.toBeInTheDocument();
  });

  it("TC-COMP-PSHELL-009 — a refused route says so ONCE and does not storm the toast queue", async () => {
    // The refusal used to raise its toast during render:
    //   setTimeout(() => toast.error(...), 0); return <Navigate to="/" />
    // Each toast re-rendered every useToast() consumer (the provider's context
    // value was a fresh literal), which re-rendered this component, which
    // scheduled another toast. Meanwhile React Router commits its redirect in
    // a startTransition, and each default-priority toast update preempted it —
    // so the redirect never landed and the window went blank with a pile of
    // toasts portalled over it. In the real app that was ~105 pushes and an
    // empty #root.
    //
    // One refusal must produce exactly one message.
    mockUseAuth.mockReturnValue(
      authenticatedAs(employee((p) => { Object.assign(p, createPermissions(true)); })),
    );
    renderProtected({ ownerOnly: true });

    // The redirect actually lands.
    expect(await screen.findByTestId("dashboard")).toBeInTheDocument();

    // Give any scheduled storm time to show itself before counting.
    await new Promise((resolve) => setTimeout(resolve, 250));
    expect(screen.getAllByText("ليس لديك صلاحية")).toHaveLength(1);
    expect(screen.queryByTestId("protected-content")).not.toBeInTheDocument();
  });
});
