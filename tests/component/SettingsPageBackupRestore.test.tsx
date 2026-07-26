// @vitest-environment jsdom
/**
 * SettingsPage — backup restore confirmation regression test.
 *
 * APPROACH TAKEN: full-page render (not an isolated-component test).
 * SettingsPage.tsx is ~1440 lines, but it only reaches into the store layer
 * via two hooks: `useApp()` (src/store/AppContext) and `useToast()`
 * (src/components/ui/Toast — already provided for free by
 * renderWithProviders' <ToastProvider>). The two security sub-panels it
 * renders (MfaPolicyCard, TwoFactorSecurityPanel) only call `useToast()`
 * themselves and are gated behind `currentUser` being truthy, so mocking
 * `useApp()` to return `currentUser: null` both (a) fully satisfies what the
 * page needs to render without crashing and (b) skips mounting those heavier
 * MFA sub-panels entirely, keeping this a fast, narrow test. Because the
 * full page renders cheaply once mocked this way, there was no need to fall
 * back to extracting an isolated sub-component.
 *
 * What changed tonight: restoring a backup used to call importBackup()
 * immediately. Now both restore paths (file import, and the "استعادة من
 * النسخة التلقائية الداخلية" internal-backup button) stage the restore in
 * React state and require confirming a <ConfirmDialog> before importBackup()
 * actually runs. This test exercises the internal-backup path end to end:
 * click the button -> importBackup must NOT have been called yet (a
 * ConfirmDialog appeared instead) -> confirm -> importBackup WAS called.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import "@testing-library/jest-dom/vitest";
import userEvent from "@testing-library/user-event";
import { screen, waitFor, cleanup } from "@testing-library/react";
import { SettingsPage } from "../../src/pages/SettingsPage";
import { renderWithProviders } from "../helpers/render";
import { lsSet } from "../../src/lib/storage";
import { seedSettings } from "../../src/data/seed";

// ── Module-level mocks ────────────────────────────────────────────────────────

const mockImportBackup = vi.fn();
const mockExportBackup = vi.fn();
const mockBackupToPath = vi.fn();
const mockExportToExcel = vi.fn();
const mockUpdateSettings = vi.fn();
const mockActivateLicense = vi.fn();

vi.mock("../../src/store/AppContext", () => ({
  useApp: () => ({
    settings: seedSettings,
    updateSettings: mockUpdateSettings,
    exportBackup: mockExportBackup,
    importBackup: mockImportBackup,
    backupToPath: mockBackupToPath,
    exportToExcel: mockExportToExcel,
    licenseStatus: null,
    activateLicense: mockActivateLicense,
    // null skips the MFA sub-panels (MfaPolicyCard / TwoFactorSecurityPanel),
    // which is fine — this test only covers the backup-restore confirmation flow.
    currentUser: null,
  }),
}));

vi.mock("../../src/store/AuditLogContext", () => ({
  useAuditLog: () => ({
    auditLogs: [],
    clearAuditLogs: vi.fn(),
    restoreDeletedInvoice: vi.fn(),
  }),
}));

// ── Helpers ───────────────────────────────────────────────────────────────────

const INTERNAL_BACKUP_BUTTON = "استعادة من النسخة التلقائية الداخلية";
const CONFIRM_BUTTON = "استبدال كل البيانات";

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("SettingsPage — internal backup restore confirmation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockImportBackup.mockResolvedValue(true);
    // jsdom's window.location.reload throws "Not implemented" if actually
    // invoked; the page schedules it 900ms after a successful restore, which
    // is outside this test's window but stub it out defensively anyway.
    vi.spyOn(window, "location", "get").mockReturnValue({
      ...window.location,
      reload: vi.fn(),
    } as unknown as Location);
  });

  afterEach(() => {
    cleanup();
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it("stages the restore behind a ConfirmDialog instead of calling importBackup immediately, then imports only after confirming", async () => {
    // Seed a fake internal auto-backup so the button doesn't just show the
    // "no backup" error toast.
    lsSet("inventory_auto_backup_internal", { fake: "backup-payload" });

    const user = userEvent.setup();
    renderWithProviders(<SettingsPage />);

    await user.click(screen.getByRole("button", { name: INTERNAL_BACKUP_BUTTON }));

    // A ConfirmDialog appeared instead of restoring immediately.
    expect(
      await screen.findByText(
        "هذا الإجراء سيستبدل كل البيانات الحيّة الحالية بآخر نسخة تلقائية داخلية محفوظة، ولا يمكن التراجع عنه. هل أنت متأكد؟"
      )
    ).toBeInTheDocument();
    expect(mockImportBackup).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: CONFIRM_BUTTON }));

    await waitFor(() => expect(mockImportBackup).toHaveBeenCalledTimes(1));
    const [file] = mockImportBackup.mock.calls[0];
    expect(file).toBeInstanceOf(File);
    expect(file.name).toBe("internal_backup.json");
  });

  it("shows a 'no backup' error toast and never opens the ConfirmDialog when no internal backup is stored", async () => {
    const user = userEvent.setup();
    renderWithProviders(<SettingsPage />);

    await user.click(screen.getByRole("button", { name: INTERNAL_BACKUP_BUTTON }));

    expect(await screen.findByText("لا توجد نسخة تلقائية مخزنة حالياً")).toBeInTheDocument();
    expect(
      screen.queryByText(
        "هذا الإجراء سيستبدل كل البيانات الحيّة الحالية بآخر نسخة تلقائية داخلية محفوظة، ولا يمكن التراجع عنه. هل أنت متأكد؟"
      )
    ).not.toBeInTheDocument();
    expect(mockImportBackup).not.toHaveBeenCalled();
  });
});
