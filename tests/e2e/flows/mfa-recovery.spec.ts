import { createRequire } from "node:module";
import { expect, test } from "@playwright/test";
import { launchElectron, closeElectron } from "../../helpers/electron-app";
import { FirstRunScreen } from "../screens/FirstRunScreen";
import { LoginScreen } from "../screens/LoginScreen";

const require = createRequire(import.meta.url);
const { generateTotp } = require("../../../electron/mfa.cjs") as {
  generateTotp: (secret: string) => string;
};

const OWNER_USERNAME = "mfa_owner";
const OWNER_PASSWORD = "Owner!Mfa26";
const RECOVERED_PASSWORD = "Recovered!Mfa26";

test("MFA enrollment, two-step login, and password recovery with a backup code", async () => {
  const handle = await launchElectron();
  try {
    const { window } = handle;
    const setup = new FirstRunScreen(window);
    await setup.createOwner(OWNER_USERNAME, OWNER_PASSWORD);
    await expect(window.getByRole("button", { name: "تسجيل الخروج" })).toBeVisible();

    const whatsNewButton = window.getByRole("button", { name: "تمام، فهمت" });
    if (await whatsNewButton.isVisible().catch(() => false)) await whatsNewButton.click();

    await window.evaluate(() => {
      window.location.hash = "#/settings";
    });
    await expect(window.getByRole("heading", { name: "الإعدادات" }).first()).toBeVisible();

    const securityCard = window.getByText("المصادقة الثنائية والأكواد الاحتياطية").first();
    await expect(securityCard).toBeVisible();
    await window.getByRole("button", { name: "تفعيل المصادقة الثنائية" }).click();

    const enrollmentDialog = window.getByRole("dialog");
    await enrollmentDialog.locator('input[type="password"]').fill(OWNER_PASSWORD);
    await enrollmentDialog.getByRole("button", { name: "متابعة" }).click();

    const secret = (await enrollmentDialog.locator("code").first().textContent())?.trim() || "";
    expect(secret).toMatch(/^[A-Z2-7]{20,}$/);
    await enrollmentDialog.getByPlaceholder("000000").fill(generateTotp(secret));
    await enrollmentDialog.getByRole("button", { name: "تأكيد وتفعيل" }).click();

    const firstBackupButton = enrollmentDialog.getByRole("button", {
      name: "نسخ الكود الاحتياطي رقم 1",
      exact: true,
    });
    const recoveryCode = (await firstBackupButton.locator("code").textContent())?.trim() || "";
    expect(recoveryCode).toMatch(/^[A-Z2-9]{4}(?:-[A-Z2-9]{4}){3}$/);
    await enrollmentDialog.getByText("أؤكد أنني حفظت الأكواد في مكان آمن خارج هذا الجهاز.").click();
    await enrollmentDialog.getByRole("button", { name: "حفظت الأكواد — إنهاء" }).click();

    await window.getByRole("button", { name: "تسجيل الخروج" }).click();
    const login = new LoginScreen(window);
    await login.loginAs(OWNER_USERNAME, OWNER_PASSWORD);
    const factorDialog = window.getByRole("dialog", { name: "التحقق بخطوتين" });
    await expect(factorDialog).toBeVisible();

    // Enrollment consumes the current RFC-6238 counter to prevent replay. Wait
    // for the next 30-second step before using a fresh authenticator code.
    const waitForNextCounter = 30_000 - (Date.now() % 30_000) + 400;
    await window.waitForTimeout(waitForNextCounter);
    await factorDialog
      .getByPlaceholder("000000 أو XXXX-XXXX-XXXX-XXXX")
      .fill(generateTotp(secret));
    await factorDialog.getByRole("button", { name: "تحقق وسجّل الدخول" }).click();
    await expect(window.getByRole("button", { name: "تسجيل الخروج" })).toBeVisible();

    await window.getByRole("button", { name: "تسجيل الخروج" }).click();
    await window
      .getByRole("button", {
        name: "نسيت اسم الدخول أو كلمة المرور؟ استخدم كودًا احتياطيًا",
      })
      .click();
    const recoveryDialog = window.getByRole("dialog", { name: "استرداد الحساب بكود احتياطي" });
    await recoveryDialog.getByPlaceholder("XXXX-XXXX-XXXX-XXXX").fill(recoveryCode);
    await recoveryDialog.getByRole("button", { name: "تحقق من الكود" }).click();
    await expect(recoveryDialog.getByText(OWNER_USERNAME)).toBeVisible();

    const newPasswordInputs = recoveryDialog.locator('input[type="password"]');
    await newPasswordInputs.nth(0).fill(RECOVERED_PASSWORD);
    await newPasswordInputs.nth(1).fill(RECOVERED_PASSWORD);
    await recoveryDialog
      .getByRole("button", { name: "تعيين كلمة المرور واسترداد الحساب" })
      .click();
    await expect(recoveryDialog).toBeHidden();

    await login.loginAs(OWNER_USERNAME, RECOVERED_PASSWORD);
    await expect(window.getByRole("button", { name: "تسجيل الخروج" })).toBeVisible();
  } finally {
    await closeElectron(handle);
  }
});
