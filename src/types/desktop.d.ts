import type { AppUser, LicenseStatus, LoginResult } from "./index";

export {};

declare global {
  interface Window {
    desktopAPI?: {
      platform: "electron";
      /**
       * True only inside the hidden renderer that the main process spawns to
       * render a document for PDF export. That window is authorized by the
       * main-side session+permission check before it is created, so the print
       * pages may render without an interactive login. Undefined/false in the
       * normal app window.
       */
      isInternalPrint?: boolean;
      license: {
        getMachineCode: () => Promise<string>;
        getStatus: () => Promise<LicenseStatus>;
        activate: (serial: string) => Promise<{ ok: boolean; status: LicenseStatus }>;
        onRevoked: (cb: () => void) => () => void;
        onRestored: (cb: () => void) => () => void;
      };
      setup: {
        createOwner: (
          username: string,
          password: string
        ) => Promise<{ ok: boolean; user?: AppUser; error?: string }>;
        hasOwner: () => Promise<boolean>;
        selectDirectory: () => Promise<string | null>;
      };
      auth: {
        login: (
          username: string,
          password: string
        ) => Promise<LoginResult & { user?: AppUser }>;
        logout: () => Promise<{ ok: boolean }>;
        hashPassword: (password: string) => Promise<string>;
        changePassword: (
          userId: string,
          currentPassword: string,
          newPassword: string
        ) => Promise<{
          ok: boolean;
          user?: AppUser;
          error?: "invalid_input" | "user_missing" | "invalid_current_password" | "not_authorized";
        }>;
        updateProfile: (
          userId: string,
          name: string,
          currentPassword?: string,
          newPassword?: string
        ) => Promise<{
          ok: boolean;
          user?: AppUser;
          error?: "invalid_input" | "user_missing" | "invalid_current_password" | "not_authorized";
        }>;
        resetOwnerPassword: (
          supportCode: string,
          username: string,
          password: string
        ) => Promise<{
          ok: boolean;
          user?: AppUser;
          error?:
            | "invalid_support_code"
            | "machine_mismatch"
            | "support_code_expired"
            | "owner_missing"
            | "invalid_input"
            | "rate_limited";
          remainSeconds?: number;
        }>;
      };
      print: {
        route: (route: string) => Promise<{ ok: boolean; error?: string }>;
        savePdfRoute: (route: string) => Promise<{ ok: boolean; error?: string; path?: string }>;
      };
      storage: {
        get: (key: string) => string | null;
        set: (key: string, value: string) => boolean;
        remove: (key: string) => boolean;
        clearPrefix: (prefix: string) => boolean;
        export: () => Promise<{
          version: number;
          timestamp: string;
          rows: { key: string; value: string; updated_at: string }[];
        }>;
        import: (payload: unknown) => Promise<{ ok: boolean }>;
        getBatch: () => Promise<Record<string, string>>;
        setBatch: (entries: Record<string, string>) => Promise<boolean>;
      };
      backup: {
        writeFile: (
          dir: string,
          fileName: string,
          content: string,
          passphrase?: string
        ) => Promise<{ ok: boolean; path?: string; error?: string }>;
        selectDirectory: () => Promise<string | null>;
        encryptContent: (
          content: string,
          passphrase?: string
        ) => Promise<{ ok: boolean; encrypted?: string; error?: string }>;
        decryptContent: (
          content: string,
          passphrase?: string
        ) => Promise<{ ok: boolean; plaintext?: string; error?: "passphrase_required" | "decrypt_failed" | "not_authorized" | "invalid_input" }>;
      };
      app: {
        onRunCloseBackup: (cb: () => void) => () => void;
        closeBackupDone: () => void;
      };
    };
  }
}
