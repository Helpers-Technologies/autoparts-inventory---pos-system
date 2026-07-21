import type { Page } from "@playwright/test";

export class LoginScreen {
  constructor(private p: Page) {}

  // The username field has placeholder="Login username" (English, stable).
  usernameInput = () => this.p.getByPlaceholder("Login username");

  passwordInput = () => this.p.locator('input[type="password"]').first();

  submitButton = () =>
    this.p.getByRole("button", { name: "تسجيل الدخول" });

  toast = (text: string | RegExp) =>
    this.p.locator('[role="status"]', { hasText: text });

  async loginAs(username: string, password: string): Promise<void> {
    await this.usernameInput().fill(username);
    await this.passwordInput().fill(password);
    await this.submitButton().click();
  }
}
