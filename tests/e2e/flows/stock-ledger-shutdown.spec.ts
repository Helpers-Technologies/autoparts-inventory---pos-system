import { expect, test } from "@playwright/test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  authenticatedShellMarker,
  closeElectron,
  dismissWhatsNewIfPresent,
  launchElectron,
} from "../../helpers/electron-app";
import { fingerprintCollectionOnDisk } from "../helpers/profileDb";
import { LoginScreen } from "../screens/LoginScreen";

const sourceDb = process.env.PARTFLOW_LEDGER_REGRESSION_DB;
const username = process.env.PARTFLOW_LEDGER_REGRESSION_USER || "admin";
const password = process.env.PARTFLOW_LEDGER_REGRESSION_PASSWORD || "stress123";

async function signIn(handle: Awaited<ReturnType<typeof launchElectron>>) {
  const login = new LoginScreen(handle.window);
  await expect(login.usernameInput()).toBeVisible({ timeout: 180_000 });
  await login.loginAs(username, password);
  await expect(authenticatedShellMarker(handle.window)).toBeVisible({ timeout: 240_000 });
  await dismissWhatsNewIfPresent(handle.window);
}

async function completeSale(handle: Awaited<ReturnType<typeof launchElectron>>) {
  const page = handle.window;
  await page.evaluate(() => { window.location.hash = "/pos"; });
  await page.getByPlaceholder("ابحث عن منتج بالاسم أو الرمز...").waitFor({ timeout: 90_000 });
  const openingFloat = page.getByPlaceholder("مثال: 500");
  if (!(await openingFloat.isVisible().catch(() => false))) {
    const open = page.getByRole("button", { name: "فتح وردية", exact: true }).first();
    if (await open.isVisible().catch(() => false)) await open.click();
  }
  if (await openingFloat.isVisible().catch(() => false)) {
    await openingFloat.fill("2000");
    await page.getByRole("button", { name: /بدء الوردية الآن/ }).click();
    await openingFloat.waitFor({ state: "hidden" });
  }
  const tiles = page.locator('[data-testid="pos-product-tile"]');
  const index = await tiles.evaluateAll((items) => items.findIndex((element) =>
    !element.hasAttribute("disabled") &&
    Number((element.textContent?.match(/متاح:\s*([\d.,]+)/) ?? [])[1]?.replaceAll(",", "")) > 0,
  ));
  expect(index).toBeGreaterThanOrEqual(0);
  await tiles.nth(index).click();
  const complete = page.getByRole("button", { name: /إتمام البيع/ });
  await expect(complete).toBeEnabled();
  await complete.click();
  await expect(page.getByRole("button", { name: "عملية بيع جديدة", exact: true }))
    .toBeVisible({ timeout: 45_000 });
}

test.describe("stock ledger shutdown durability", () => {
  test.skip(!sourceDb, "Set PARTFLOW_LEDGER_REGRESSION_DB to an isolated fixture source");

  test("an unopened lazy ledger keeps every record across graceful close and reopen", async () => {
    test.setTimeout(6 * 60_000);
    if (!sourceDb) return;
    const folder = fs.mkdtempSync(path.join(os.tmpdir(), "partflow-ledger-close-"));
    const dbPath = path.join(folder, "autoparts-inventory.secure.sqlite");
    fs.copyFileSync(path.resolve(sourceDb), dbPath);
    const before = fingerprintCollectionOnDisk(dbPath, "stockMovements");
    expect(before.count).toBeGreaterThan(0);

    let handle = await launchElectron({ dbPath });
    try {
      await signIn(handle);
      // Inventory history is deliberately never visited or hydrated.
    } finally {
      await closeElectron(handle);
    }
    const afterClose = fingerprintCollectionOnDisk(dbPath, "stockMovements");
    expect(afterClose).toEqual(before);

    handle = await launchElectron({ dbPath });
    try {
      await signIn(handle);
    } finally {
      await closeElectron(handle);
    }
    expect(fingerprintCollectionOnDisk(dbPath, "stockMovements")).toEqual(before);
  });

  test("a real sale adds one durable movement that survives immediate graceful close", async () => {
    test.setTimeout(6 * 60_000);
    if (!sourceDb) return;
    const folder = fs.mkdtempSync(path.join(os.tmpdir(), "partflow-ledger-sale-"));
    const dbPath = path.join(folder, "autoparts-inventory.secure.sqlite");
    fs.copyFileSync(path.resolve(sourceDb), dbPath);
    const before = fingerprintCollectionOnDisk(dbPath, "stockMovements");

    let handle = await launchElectron({ dbPath });
    try {
      await signIn(handle);
      await completeSale(handle);
    } finally {
      await closeElectron(handle);
    }
    const afterSaleClose = fingerprintCollectionOnDisk(dbPath, "stockMovements");
    expect(afterSaleClose.count).toBe(before.count + 1);
    expect(afterSaleClose.idsSha256).not.toBe(before.idsSha256);

    handle = await launchElectron({ dbPath });
    try {
      await signIn(handle);
    } finally {
      await closeElectron(handle);
    }
    expect(fingerprintCollectionOnDisk(dbPath, "stockMovements"))
      .toEqual(afterSaleClose);
  });
});
