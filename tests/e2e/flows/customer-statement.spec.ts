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
import {
  authenticatedShellMarker,
  closeElectron,
  dismissWhatsNewIfPresent,
  launchElectron,
} from "../../helpers/electron-app";
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
    await expect(authenticatedShellMarker(window)).toBeVisible();
    await dismissWhatsNewIfPresent(window);

    // ── Step 1: Go to the customers page ────────────────────────────────────
    await window.evaluate(() => { globalThis.location.hash = "#/customers"; });
    // "العملاء" appears as both the topbar h1 and the page-header h2 — first() is enough.
    await expect(window.getByRole("heading", { name: "العملاء" }).first()).toBeVisible();

    // ── Step 2: Add a customer (name + phone + structured address) ──────────
    await window.getByRole("button", { name: "إضافة عميل" }).first().click();
    const dialog = window.getByRole("dialog");
    await expect(dialog).toBeVisible();
    const editable = dialog.locator('input:not([readonly])');
    await editable.nth(0).fill("أحمد العميل");   // الاسم
    await editable.nth(1).fill("01000000000");    // الهاتف
    // Governorate and city are searchable pickers now, not free text: the
    // shop chooses a canonical name from the Egyptian governorate dataset so
    // the address can actually be priced and shipped. Each is a button that
    // opens a portal-rendered list with its own search box.
    // exact: the city picker's own placeholder is "اختر المحافظة أولًا", which
    // a substring match also selects.
    await dialog.getByRole("button", { name: "اختر المحافظة", exact: true }).click();
    const governorateList = window.locator("#searchable-select-portal");
    await governorateList.getByPlaceholder("ابحث عن المحافظة...").fill("القاهرة");
    await governorateList.getByRole("button", { name: "القاهرة", exact: true }).first().click();

    await dialog.getByRole("button", { name: "اختر المدينة / المركز", exact: true }).click();
    const cityList = window.locator("#searchable-select-portal");
    await cityList.getByPlaceholder(/ابحث أو اكتب اسم المدينة/).fill("مدينة نصر");
    await cityList.getByRole("button", { name: /مدينة نصر|استخدم/ }).first().click();
    await dialog
      .getByPlaceholder("الشارع، رقم العقار، علامة مميزة")
      .fill("شارع الاختبار، عقار 10");
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
