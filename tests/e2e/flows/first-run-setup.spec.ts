/**
 * E2E-001  First-run setup → owner creation → auto-login → manual re-login.
 *
 * Covers the complete activation path for a brand-new installation:
 *   1. Fresh DB  →  FirstRunSetupPage is shown (license bypassed in E2E mode).
 *   2. Owner creates account  →  success toast and the session opens
 *      automatically (no login screen) landing on the dashboard.
 *   3. Logout  →  LoginPage appears.
 *   4. Owner logs back in with the same credentials  →  dashboard again.
 *
 * TC-E2E-001 — P0 / e2e
 */
import { test, expect } from "@playwright/test";
import { launchElectron, closeElectron } from "../../helpers/electron-app";
import { FirstRunScreen } from "../screens/FirstRunScreen";
import { LoginScreen } from "../screens/LoginScreen";

const OWNER_USERNAME = "test_owner";
const OWNER_PASSWORD = "Owner!E2E26";

test("E2E-001: first-run setup → owner creation → auto-login → manual re-login", async () => {
  const handle = await launchElectron();
  try {
    const { window } = handle;

    // ── Step 1: First-run setup page is visible ─────────────────────────
    const setup = new FirstRunScreen(window);
    await expect(setup.heading()).toBeVisible();

    // ── Step 2: Create the owner account ────────────────────────────────
    await setup.createOwner(OWNER_USERNAME, OWNER_PASSWORD);

    // Success toast confirms owner was created and the session opened.
    await expect(setup.toast(/تم إنشاء المدير/)).toBeVisible();

    // ── Step 3: Auto-login lands directly on the dashboard ──────────────
    // The dashboard greeting contains "أهلاً بك في" followed by the company name.
    await expect(window.getByText(/أهلاً بك في/)).toBeVisible();

    // First run auto-opens the "What's New" dialog over the dashboard (the app
    // version has a changelog entry). Dismiss it so its backdrop doesn't
    // intercept clicks on the dashboard underneath.
    const whatsNewButton = window.getByRole("button", { name: "تمام، فهمت" });
    if (await whatsNewButton.isVisible({ timeout: 1500 }).catch(() => false)) {
      await whatsNewButton.click();
    }

    // ── Step 4: Logout shows the login page ─────────────────────────────
    await window.getByRole("button", { name: "تسجيل الخروج" }).click();
    const login = new LoginScreen(window);
    await expect(login.usernameInput()).toBeVisible();

    // ── Step 5: Manual login with the created credentials works ─────────
    await login.loginAs(OWNER_USERNAME, OWNER_PASSWORD);
    await expect(window.getByText(/أهلاً بك في/)).toBeVisible();
  } finally {
    await closeElectron(handle);
  }
});
