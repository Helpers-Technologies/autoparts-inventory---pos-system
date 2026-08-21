/**
 * Opt-in regression audit for post-login storage hydration.
 *
 * A desktop renderer starts before it has an authenticated storage session.
 * Every provider must therefore reload its authoritative rows after login and
 * must not persist fallback state over the encrypted database. This test puts
 * sentinels into the real encrypted store, restarts Electron, signs in through
 * the UI, and proves those rows survive the providers' debounced flushes.
 *
 * Run with:
 *   PARTFLOW_DATA_PRESERVATION_AUDIT=1 \
 *   npx playwright test tests/e2e/flows/login-data-preservation.spec.ts
 */
import { expect, test } from "@playwright/test";
import {
  authenticatedShellMarker,
  closeElectron,
  dismissWhatsNewIfPresent,
  launchElectron,
} from "../../helpers/electron-app";
import { FirstRunScreen } from "../screens/FirstRunScreen";
import { LoginScreen } from "../screens/LoginScreen";

const enabled = process.env.PARTFLOW_DATA_PRESERVATION_AUDIT === "1";
const USERNAME = "preservation_owner";
const PASSWORD = "Owner!Preserve26";
const PREFIX = "autoparts_inventory_v1::";

const sentinels: Record<string, string> = {
  [`${PREFIX}offlineEmployees`]: JSON.stringify([
    { id: "audit-employee", name: "موظف يجب ألا يُحذف" },
  ]),
  [`${PREFIX}offlineTransactions`]: JSON.stringify([
    { id: "audit-transaction", employeeId: "audit-employee", amount: 321 },
  ]),
  [`${PREFIX}vehicleEngines`]: JSON.stringify([
    { id: "audit-engine", generationId: "audit-generation", name: "AUDIT-ENGINE" },
  ]),
  [`${PREFIX}productAlternatives`]: JSON.stringify([
    { id: "audit-alternative", productId: "audit-product", alternativeProductId: "audit-other" },
  ]),
};

async function readSentinels(page: import("@playwright/test").Page) {
  return page.evaluate((keys) => {
    const storage = window.desktopAPI?.storage;
    if (!storage) throw new Error("desktop storage API unavailable");
    return Object.fromEntries(keys.map((key) => [key, storage.get(key)]));
  }, Object.keys(sentinels));
}

test.describe("opt-in post-login data preservation audit", () => {
  test.skip(!enabled, "Set PARTFLOW_DATA_PRESERVATION_AUDIT=1 to run this destructive-on-a-temp-DB audit");

  test("login does not replace authenticated collections with pre-login fallbacks", async () => {
    test.setTimeout(3 * 60_000);
    const first = await launchElectron();
    const dbPath = first.dbPath;
    try {
      const setup = new FirstRunScreen(first.window);
      await expect(setup.heading()).toBeVisible();
      await setup.createOwner(USERNAME, PASSWORD);
      await expect(authenticatedShellMarker(first.window)).toBeVisible();
      await dismissWhatsNewIfPresent(first.window);

      // Let first-run state finish its normal debounced persistence before the
      // sentinels are inserted directly into the encrypted renderer store.
      await first.window.waitForTimeout(2_600);
      const wrote = await first.window.evaluate(async (entries) => {
        const storage = window.desktopAPI?.storage;
        if (!storage) throw new Error("desktop storage API unavailable");
        return storage.setBatch(entries);
      }, sentinels);
      expect(wrote).toBe(true);
      expect(await readSentinels(first.window)).toEqual(sentinels);

      // End the renderer session before closing. The sentinels are injected at
      // the persistence boundary on purpose; leaving React authenticated would
      // make the normal close flush overwrite that out-of-band setup with its
      // still-current in-memory state, testing shutdown conflict semantics
      // instead of the post-login hydration race this spec is about.
      await authenticatedShellMarker(first.window).click();
      await expect(first.window.getByPlaceholder("Login username")).toBeVisible();
    } finally {
      await closeElectron(first);
    }

    const second = await launchElectron({ dbPath });
    try {
      const login = new LoginScreen(second.window);
      await expect(login.usernameInput()).toBeVisible();
      await login.loginAs(USERNAME, PASSWORD);
      await expect(authenticatedShellMarker(second.window)).toBeVisible();

      // Both provider flush windows (1.2s and 2s) have now elapsed. Any value
      // read here must still be the authoritative value written above.
      await second.window.waitForTimeout(2_600);
      expect(await readSentinels(second.window)).toEqual(sentinels);
    } finally {
      await closeElectron(second);
    }
  });
});
