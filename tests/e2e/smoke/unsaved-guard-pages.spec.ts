/**
 * @smoke
 * TC-E2E-BLOCKER-001  Pages using the unsaved-changes guard render without crashing.
 *
 * Regression test for a production crash: the five pages that call
 * react-router's useBlocker (sales/purchase invoice new+edit, quotation new)
 * threw a blank invariant Error and tripped the global error boundary,
 * because useBlocker only works inside a data router. main.tsx must mount
 * the app via createHashRouter + RouterProvider, not plain <HashRouter>.
 *
 * Scenario: owner is created and logs in, then each guarded "new" page is
 * opened via hash navigation and must show its heading instead of the
 * error boundary.
 */
import { test, expect } from "@playwright/test";
import { launchElectron, closeElectron } from "../../helpers/electron-app";
import { FirstRunScreen } from "../screens/FirstRunScreen";

const OWNER_USERNAME = "blocker_owner";
const OWNER_PASSWORD = "Owner!Block26";

// Both pages mount inside the SAME createHashRouter data router, so either one
// proves useBlocker no longer throws. quotations/new also uses the guard but is
// feature-gated OFF by default (FEATURES: quotations.defaultEnabled === false),
// so it can't be reached here without enabling the feature.
const GUARDED_PAGES: Array<{ hash: string; heading: RegExp }> = [
  { hash: "#/sales/new", heading: /فاتورة مبيعات جديدة/ },
  { hash: "#/purchases/new", heading: /فاتورة مشتريات جديدة/ },
];

test("@smoke unsaved-changes-guard pages render without tripping the error boundary", async () => {
  const handle = await launchElectron();
  try {
    const { window } = handle;

    // Owner creation logs in automatically and lands on the dashboard.
    const setup = new FirstRunScreen(window);
    await expect(setup.heading()).toBeVisible();
    await setup.createOwner(OWNER_USERNAME, OWNER_PASSWORD);
    await expect(window.getByText(/أهلاً بك في/)).toBeVisible();

    for (const { hash, heading } of GUARDED_PAGES) {
      await window.evaluate((h) => {
        window.location.hash = h;
      }, hash);
      await expect(window.getByRole("heading", { name: heading })).toBeVisible();
      await expect(window.getByText("حدث خطأ غير متوقع")).not.toBeVisible();
    }
  } finally {
    await closeElectron(handle);
  }
});
