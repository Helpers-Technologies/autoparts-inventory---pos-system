/**
 * E2E-011  Customer account statement (V5 Bug-2 redesign).
 *
 * Covers: owner creates a customer, then opens that customer's account
 * statement and sees the REDESIGNED layout — the clearer "على العميل" /
 * "للعميل" wording that replaced the مدين/دائن accounting jargon.
 *
 * TC-E2E-011 — P1 / e2e / v5-feature
 */
import { test, expect } from "@playwright/test";
import { launchElectron, closeElectron } from "../../helpers/electron-app";
import { FirstRunScreen } from "../screens/FirstRunScreen";

const OWNER_USERNAME = "stmt_owner";
const OWNER_PASSWORD = "Owner!Stmt26";

test("E2E-011: owner creates a customer and opens the redesigned account statement", async () => {
  const handle = await launchElectron();
  try {
    const { window } = handle;

    // ── Setup: owner + dismiss What's New ───────────────────────────────────
    const setup = new FirstRunScreen(window);
    await expect(setup.heading()).toBeVisible();
    await setup.createOwner(OWNER_USERNAME, OWNER_PASSWORD);
    await expect(window.getByText(/أهلاً بك في/)).toBeVisible();
    await window.getByRole("button", { name: "تمام، فهمت" }).click();

    // ── Step 1: Go to the customers page ────────────────────────────────────
    await window.evaluate(() => { window.location.hash = "#/customers"; });
    // "العملاء" appears as both the topbar h1 and the page-header h2 — first() is enough.
    await expect(window.getByRole("heading", { name: "العملاء" }).first()).toBeVisible();

    // ── Step 2: Add a customer (name + phone + address + shipping) ───────────
    await window.getByRole("button", { name: "إضافة عميل" }).first().click();
    const dialog = window.getByRole("dialog");
    await expect(dialog).toBeVisible();
    const editable = dialog.locator('input:not([readonly])');
    await editable.nth(0).fill("أحمد العميل");   // الاسم
    await editable.nth(1).fill("01000000000");    // الهاتف
    await editable.nth(2).fill("القاهرة");        // العنوان
    await dialog.locator("select").selectOption("qibli"); // اتجاه الشحن
    await window.getByRole("button", { name: "إضافة", exact: true }).click();

    // The customer now appears in the table.
    await expect(window.getByText("أحمد العميل")).toBeVisible();

    // ── Step 3: Open that customer's account statement ──────────────────────
    await window.getByRole("link", { name: "كشف حساب" }).first().click();

    // ── Step 4: The redesigned statement renders with the new wording ───────
    await expect(window.getByText("كشف حساب عميل")).toBeVisible();
    // The redesigned column header replaced مدين/دائن with "على العميل".
    await expect(window.getByText("على العميل").first()).toBeVisible();
    // A brand-new customer has no movements yet.
    await expect(window.getByText("لا توجد حركات مسجلة")).toBeVisible();
  } finally {
    await closeElectron(handle);
  }
});
