import type { Page } from "@playwright/test";

export class FirstRunScreen {
  constructor(private p: Page) {}

  // The setup is a 6-step wizard. The step counter is always visible on the
  // right-hand panel regardless of viewport width.
  heading = () => this.p.getByText(/الخطوة 1 من/);

  // Field labels are not associated via htmlFor. On step 1 the username field is
  // the only non-password text input in the form.
  usernameInput = () => this.p.locator('form input:not([type="password"])').first();
  passwordInput = () => this.p.locator('input[type="password"]').first();
  confirmPasswordInput = () => this.p.locator('input[type="password"]').nth(1);

  companyNameArInput = () =>
    this.p.getByPlaceholder("مثال: النور لقطع غيار السيارات");

  nextButton = () => this.p.getByRole("button", { name: "التالي" });
  backupFolderButton = () =>
    this.p.getByRole("button", { name: "اختر مجلد النسخ الاحتياطي" });
  invoicesFolderButton = () =>
    this.p.getByRole("button", { name: "اختر مجلد حفظ الفواتير" });
  skipEmployeeButton = () => this.p.getByRole("button", { name: "تخطّي الآن" });
  submitButton = () =>
    this.p.getByRole("button", { name: "إضافة الموظف وفتح النظام" });

  toast = (text: string | RegExp) =>
    this.p.locator('[role="status"]', { hasText: text });

  /**
   * Walks the full wizard: admin account → auto-parts identity → vehicle-market
   * specialization → financial defaults → backup/invoice folders (resolved by
   * the HW_E2E directory bypass) → skip the optional employee step.
   */
  async createOwner(username: string, password: string): Promise<void> {
    // Step 1 — admin account. The username field pre-fills with "admin".
    const uField = this.usernameInput();
    await uField.clear();
    await uField.fill(username);
    await this.passwordInput().fill(password);
    await this.confirmPasswordInput().fill(password);
    await this.nextButton().click();

    // Step 2 — company (Arabic name is required).
    await this.companyNameArInput().fill("شركة الاختبار");
    await this.nextButton().click();

    // Step 3 — Chinese/Korean specialization defaults are fine as-is.
    await this.nextButton().click();

    // Step 4 — financial defaults are fine as-is.
    await this.nextButton().click();

    // Step 5 — pick the two required folders (HW_E2E returns a temp dir).
    await this.backupFolderButton().click();
    await this.invoicesFolderButton().click();
    await this.nextButton().click();

    // Step 6 — skip the optional first-employee step.
    await this.skipEmployeeButton().click();
  }
}
