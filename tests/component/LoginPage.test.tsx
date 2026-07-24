// @vitest-environment jsdom
/**
 * LoginPage component tests.
 *
 * Covers:
 *  - Form renders with all required fields and the submit button.
 *  - Successful login calls login() and navigates to "/".
 *  - Invalid credentials shows an error toast; button stays enabled.
 *  - Rate-limit response (rate_limited) disables the button and shows countdown text.
 *  - Countdown text changes as remainSeconds is returned from the IPC call.
 *
 * TC-COMP-LOGIN-001 through TC-COMP-LOGIN-005
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import userEvent from "@testing-library/user-event";
import { screen, waitFor, cleanup } from "@testing-library/react";
import { LoginPage } from "../../src/pages/LoginPage";
import { renderWithProviders } from "../helpers/render";

// ── Module-level mocks ────────────────────────────────────────────────────────

const mockLogin = vi.fn();
const mockVerifySecondFactor = vi.fn();
const mockResumeDesktopSession = vi.fn();
const mockNavigate = vi.fn();

vi.mock("../../src/store/AuthContext", () => ({
  useAuth: () => ({
    login: mockLogin,
    verifySecondFactor: mockVerifySecondFactor,
    resumeDesktopSession: mockResumeDesktopSession,
  }),
}));

vi.mock("react-router-dom", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-router-dom")>();
  return { ...actual, useNavigate: () => mockNavigate };
});

// ── Helpers ───────────────────────────────────────────────────────────────────

function setup() {
  const user = userEvent.setup();
  renderWithProviders(<LoginPage />);
  return {
    user,
    usernameInput: () => screen.getByPlaceholderText("Login username"),
    passwordInput: () => screen.getByPlaceholderText("••••••••"),
    submitButton: () => screen.getByRole("button", { name: "تسجيل الدخول" }),
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("LoginPage — TC-COMP-LOGIN", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    // Set desktopAPI directly — vi.stubGlobal("window", …) replaces the jsdom window
    // object entirely, breaking React rendering. Direct assignment preserves the environment.
    (window as unknown as Record<string, unknown>).desktopAPI = undefined;
  });

  afterEach(() => {
    vi.useRealTimers();
    cleanup();
    delete (window as unknown as Record<string, unknown>).desktopAPI;
  });

  it("TC-COMP-LOGIN-001 — renders the login form with all required inputs", () => {
    setup();
    expect(screen.getByPlaceholderText("Login username")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("••••••••")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "تسجيل الدخول" })).toBeInTheDocument();
  });

  it("TC-COMP-LOGIN-002 — successful login navigates to /", async () => {
    mockLogin.mockResolvedValue({ ok: true });
    const { user, usernameInput, passwordInput, submitButton } = setup();

    await user.type(usernameInput(), "owner");
    await user.type(passwordInput(), "Secret1!");
    await user.click(submitButton());

    await waitFor(() => expect(mockLogin).toHaveBeenCalledWith("owner", "Secret1!"));
    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith("/", { replace: true }));
  });

  it("TC-COMP-LOGIN-003 — invalid credentials keeps button enabled and does not navigate", async () => {
    mockLogin.mockResolvedValue({
      ok: false,
      error: "invalid_credentials",
      attemptsRemaining: 4,
    });
    const { user, usernameInput, passwordInput, submitButton } = setup();

    await user.type(usernameInput(), "owner");
    await user.type(passwordInput(), "WrongPass");
    await user.click(submitButton());

    await waitFor(() => expect(mockLogin).toHaveBeenCalledTimes(1));
    expect(mockNavigate).not.toHaveBeenCalled();
    // Button is not disabled after a simple invalid-credentials failure.
    expect(submitButton()).not.toBeDisabled();
  });

  it("TC-COMP-LOGIN-004 — rate_limited response disables the submit button", async () => {
    mockLogin.mockResolvedValue({
      ok: false,
      error: "rate_limited",
      remainSeconds: 60,
    });
    const { user, usernameInput, passwordInput } = setup();

    await user.type(usernameInput(), "owner");
    await user.type(passwordInput(), "WrongPass");

    // Click using the real element since the button text will change after submit.
    const btn = screen.getByRole("button", { name: "تسجيل الدخول" });
    await user.click(btn);

    await waitFor(() => expect(mockLogin).toHaveBeenCalledTimes(1));

    // After rate_limited, the button becomes disabled and shows the countdown.
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /مقفول/ })).toBeDisabled()
    );
  });

  it("TC-COMP-LOGIN-005 — empty username prevents login() from being called", async () => {
    const { user, passwordInput, submitButton } = setup();
    await user.type(passwordInput(), "Secret1!");
    await user.click(submitButton());

    // useAuth().login should not be called when username is blank.
    expect(mockLogin).not.toHaveBeenCalled();
  });

  it("TC-COMP-LOGIN-006 — password success requiring 2FA does not navigate before factor verification", async () => {
    mockLogin.mockResolvedValue({
      ok: false,
      error: "second_factor_required",
      requiresSecondFactor: true,
      challengeId: "challenge-1",
    });
    mockVerifySecondFactor.mockResolvedValue({ ok: true });
    const { user, usernameInput, passwordInput, submitButton } = setup();

    await user.type(usernameInput(), "owner");
    await user.type(passwordInput(), "Secret1!");
    await user.click(submitButton());

    expect(await screen.findByRole("heading", { name: "التحقق بخطوتين" })).toBeInTheDocument();
    expect(mockNavigate).not.toHaveBeenCalled();

    await user.type(
      screen.getByPlaceholderText("000000 أو XXXX-XXXX-XXXX-XXXX"),
      "123456"
    );
    await user.click(screen.getByRole("button", { name: "تحقق وسجّل الدخول" }));

    await waitFor(() =>
      expect(mockVerifySecondFactor).toHaveBeenCalledWith("challenge-1", "123456")
    );
    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith("/", { replace: true }));
  });

  it("TC-COMP-LOGIN-007 — recovery code can identify the account and reset password without old credentials", async () => {
    const beginAccountRecovery = vi.fn().mockResolvedValue({
      ok: true,
      challengeId: "recovery-1",
      username: "forgotten-owner",
    });
    const completeAccountRecovery = vi.fn().mockResolvedValue({
      ok: true,
      username: "forgotten-owner",
      mfaReset: true,
    });
    (window as unknown as { desktopAPI: unknown }).desktopAPI = {
      auth: { beginAccountRecovery, completeAccountRecovery },
    };
    const { user, usernameInput } = setup();

    await user.click(
      screen.getByRole("button", {
        name: "نسيت اسم الدخول أو كلمة المرور؟ استخدم كودًا احتياطيًا",
      })
    );
    await user.type(screen.getByPlaceholderText("XXXX-XXXX-XXXX-XXXX"), "ABCD-EFGH-JKLM-NPQR");
    await user.click(screen.getByRole("button", { name: "تحقق من الكود" }));

    expect(await screen.findByText("forgotten-owner")).toBeInTheDocument();
    const modal = screen.getByRole("dialog", { name: "استرداد الحساب بكود احتياطي" });
    const passwordInputs = modal.querySelectorAll<HTMLInputElement>('input[type="password"]');
    await user.type(passwordInputs[0], "NewSecret1!");
    await user.type(passwordInputs[1], "NewSecret1!");
    await user.click(screen.getByRole("button", { name: "تعيين كلمة المرور واسترداد الحساب" }));

    await waitFor(() =>
      expect(completeAccountRecovery).toHaveBeenCalledWith(
        "recovery-1",
        "NewSecret1!",
        true
      )
    );
    await waitFor(() => expect(usernameInput()).toHaveValue("forgotten-owner"));
  });
});
