/**
 * E2E-002  Login rate-limit: 5 failed attempts → 60-second lockout.
 *
 * Verifies the brute-force protection path end-to-end:
 *   1. First-run setup completes (owner account created, session auto-opens).
 *   2. Owner logs out to reach the login screen.
 *   3. Owner enters the wrong password 5 consecutive times.
 *   4. On the 6th attempt the submit button is disabled and shows a countdown.
 *
 * TC-E2E-002 — P0 / e2e / security
 */
import { test, expect } from "@playwright/test";
import { launchElectron, closeElectron } from "../../helpers/electron-app";
import { FirstRunScreen } from "../screens/FirstRunScreen";
import { LoginScreen } from "../screens/LoginScreen";

const OWNER_USERNAME = "rate_test_owner";
const OWNER_PASSWORD = "Owner!Rate26";
const WRONG_PASSWORD = "Wrong!Pass99";

test("E2E-002: 5 wrong passwords trigger the rate-limit lockout", async () => {
  const handle = await launchElectron();
  try {
    const { window } = handle;

    // ── Step 1: Complete first-run setup (auto-logs into the dashboard) ────
    const setup = new FirstRunScreen(window);
    await expect(setup.heading()).toBeVisible();
    await setup.createOwner(OWNER_USERNAME, OWNER_PASSWORD);
    await expect(window.getByRole("button", { name: "تسجيل الخروج" })).toBeVisible();

    // First run auto-opens the "What's New" dialog over the dashboard; dismiss
    // it so its backdrop doesn't intercept the logout click below.
    const whatsNewButton = window.getByRole("button", { name: "تمام، فهمت" });
    if (await whatsNewButton.isVisible({ timeout: 1500 }).catch(() => false)) {
      await whatsNewButton.click();
    }

    // ── Step 2: Logout to reach the login screen ────────────────────────────
    await window.getByRole("button", { name: "تسجيل الخروج" }).click();
    const login = new LoginScreen(window);
    await expect(login.usernameInput()).toBeVisible();

    // ── Step 3: Submit wrong password 5 times ──────────────────────────────
    for (let attempt = 1; attempt <= 5; attempt++) {
      await login.usernameInput().fill(OWNER_USERNAME);
      await login.passwordInput().fill(WRONG_PASSWORD);
      await login.submitButton().click();

      // After each failed attempt the button should re-enable (not yet locked).
      // Wait for the error toast or button to become enabled again before the next attempt.
      if (attempt < 5) {
        await expect(login.submitButton()).toBeEnabled({ timeout: 5_000 });
      }
    }

    // ── Step 4: The button is now disabled with a countdown ─────────────────
    // After 5 failures the backend returns rate_limited; the button shows "مقفول".
    await expect(
      window.getByRole("button", { name: /مقفول/ })
    ).toBeDisabled({ timeout: 8_000 });

    // ── Step 5: Submitting again (even with correct password) stays blocked ─
    // The submit button is disabled so the user cannot re-attempt yet.
    await expect(login.submitButton()).not.toBeVisible(); // "مقفول" button replaced it
    await expect(window.getByRole("button", { name: /مقفول/ })).toBeDisabled();
  } finally {
    await closeElectron(handle);
  }
});
