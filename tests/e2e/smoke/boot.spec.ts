/**
 * @smoke
 * TC-E2E-BOOT-001  App launches with a fresh DB and shows the first-run setup page.
 *
 * Preconditions: no existing DB (every run gets a unique temp path).
 * Expected: FirstRunSetupPage renders the owner-creation form.
 */
import { test, expect } from "@playwright/test";
import { launchElectron, closeElectron } from "../../helpers/electron-app";
import { FirstRunScreen } from "../screens/FirstRunScreen";

test("@smoke app boots with fresh DB and renders first-run setup page", async () => {
  const handle = await launchElectron();
  try {
    const screen = new FirstRunScreen(handle.window);

    // The step-1 (admin account) heading must be visible within the timeout.
    await expect(screen.heading()).toBeVisible();

    // The wizard is actionable: step 1's "next" button is present. (The final
    // submit button — "إضافة الموظف وفتح النظام" — lives on step 5, not here.)
    await expect(screen.nextButton()).toBeVisible();
  } finally {
    await closeElectron(handle);
  }
});
