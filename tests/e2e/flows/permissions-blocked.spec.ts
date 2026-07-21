/**
 * E2E-009  Employee with no permissions is blocked from ownerOnly routes.
 *
 * Scenario:
 *   1. First-run setup — owner account created, session auto-opens on dashboard.
 *   2. Owner creates an employee account with ALL permissions disabled.
 *   3. Owner logs out.
 *   4. Employee logs in.
 *   5. Employee attempts to navigate to /users (ownerOnly).
 *   6. ProtectedShell redirects to / and shows an authorization toast.
 *   7. "المستخدمين" link is NOT visible in the employee's sidebar.
 *
 * TC-E2E-009 — P0 / e2e / security
 */
import { test, expect } from "@playwright/test";
import { launchElectron, closeElectron } from "../../helpers/electron-app";
import { FirstRunScreen } from "../screens/FirstRunScreen";
import { LoginScreen } from "../screens/LoginScreen";

const OWNER_USERNAME = "perm_test_owner";
const OWNER_PASSWORD = "Owner!Perm26";
const EMP_USERNAME = "emp_noperms";
const EMP_PASSWORD = "Emp!Pass26";

test("E2E-009: employee without permissions is blocked from ownerOnly routes", async () => {
  const handle = await launchElectron();
  try {
    const { window } = handle;

    // ── Step 1: First-run setup (auto-logs into the dashboard as owner) ───
    const setup = new FirstRunScreen(window);
    await expect(setup.heading()).toBeVisible();
    await setup.createOwner(OWNER_USERNAME, OWNER_PASSWORD);
    await expect(window.getByText(/أهلاً بك في/)).toBeVisible();

    const login = new LoginScreen(window);

    // ── Step 2: Navigate to /users page ───────────────────────────────────
    await window.getByRole("link", { name: "المستخدمين" }).click();
    await expect(window.getByRole("heading", { name: /مستخدمي النظام/ })).toBeVisible();

    // ── Step 3: Open the "add user" dialog ────────────────────────────────
    await window.getByRole("button", { name: /إضافة مستخدم/ }).click();

    const dialog = window.getByRole("dialog");
    await expect(dialog).toBeVisible();

    // ── Step 4: Fill in the employee form (no permissions granted) ────────
    await dialog.getByPlaceholder("مثال: أحمد محمد").fill("موظف اختبار");

    // Username input: second non-password input in the dialog.
    const nonPasswordInputs = dialog.locator('input:not([type="password"])');
    await nonPasswordInputs.nth(1).fill(EMP_USERNAME);

    await dialog.locator('input[type="password"]').first().fill(EMP_PASSWORD);

    // Permissions are all unchecked by default — leave them as-is.
    await dialog.getByRole("button", { name: "حفظ" }).click();

    await expect(window.locator('[role="status"]', { hasText: /تم إضافة المستخدم/ })).toBeVisible();

    // State reaches the encrypted store (which auth:login validates against)
    // on a 2-second debounced flush — wait it out before logging out, or the
    // freshly created employee won't exist yet for the login below.
    await window.waitForTimeout(2_600);

    // ── Step 5: Logout as owner ────────────────────────────────────────────
    await window.getByRole("button", { name: "تسجيل الخروج" }).click();
    await expect(login.usernameInput()).toBeVisible();

    // ── Step 6: Login as employee ──────────────────────────────────────────
    await login.loginAs(EMP_USERNAME, EMP_PASSWORD);
    await expect(window.getByText(/أهلاً بك في/)).toBeVisible();

    // ── Step 7: Verify sidebar does NOT show ownerOnly links ───────────────
    await expect(window.getByRole("link", { name: "المستخدمين" })).not.toBeVisible();
    await expect(window.getByRole("link", { name: "الإعدادات" })).not.toBeVisible();
    await expect(window.getByRole("link", { name: /تقرير الموظفين/ })).not.toBeVisible();

    // ── Step 8: Directly navigate to /users via hash and verify redirect ───
    await window.evaluate(() => {
      window.location.hash = "#/users";
    });

    // ProtectedShell redirects the employee back to "/" with a toast.
    await expect(window.locator('[role="status"]', { hasText: /ليس لديك صلاحية/ })).toBeVisible({
      timeout: 6_000,
    });
    // Hash should resolve back to / (dashboard shown).
    await expect(window.getByText(/أهلاً بك في/)).toBeVisible();
  } finally {
    await closeElectron(handle);
  }
});
