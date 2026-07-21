import { vi } from "vitest";

/**
 * Creates a typed mock of window.desktopAPI and installs it as a global.
 * Call in beforeEach; always pair with vi.unstubAllGlobals() in afterEach.
 *
 * Pass partial overrides to customise specific channels per test.
 */
export function mockDesktopAPI(overrides: Record<string, unknown> = {}) {
  const api = {
    license: {
      getMachineCode: vi.fn().mockResolvedValue("APW-TEST-CODE"),
      getStatus: vi.fn().mockResolvedValue({ state: "active", machineCode: "APW-TEST-CODE" }),
      activate: vi.fn().mockResolvedValue({ ok: true }),
    },
    setup: {
      hasOwner: vi.fn().mockResolvedValue(true),
      createOwner: vi.fn().mockResolvedValue({ ok: true }),
      selectDirectory: vi.fn().mockResolvedValue(null),
    },
    auth: {
      login: vi.fn().mockResolvedValue({ ok: true, user: { id: "u1", role: "owner", name: "Owner", username: "owner" } }),
      logout: vi.fn().mockResolvedValue({ ok: true }),
      hashPassword: vi.fn().mockResolvedValue("hashed"),
      changePassword: vi.fn().mockResolvedValue({ ok: true }),
      updateProfile: vi.fn().mockResolvedValue({ ok: true }),
      resetOwnerPassword: vi.fn().mockResolvedValue({ ok: true }),
    },
    storage: {
      get: vi.fn().mockReturnValue(null),
      set: vi.fn().mockResolvedValue(true),
      remove: vi.fn().mockResolvedValue(true),
      clearPrefix: vi.fn().mockResolvedValue(true),
      export: vi.fn().mockResolvedValue({ version: 1, rows: [] }),
      import: vi.fn().mockResolvedValue({ ok: true }),
    },
    print: {
      route: vi.fn().mockResolvedValue({ ok: true }),
      currentWindow: vi.fn().mockResolvedValue({ ok: true }),
      saveCurrentPdf: vi.fn().mockResolvedValue({ ok: true }),
      closeCurrentWindow: vi.fn().mockResolvedValue({ ok: true }),
    },
    ...overrides,
  };

  vi.stubGlobal("window", { desktopAPI: api });
  return api;
}
