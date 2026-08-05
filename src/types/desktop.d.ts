import type {
  AppUser,
  BranchActivationResult,
  BranchCreationResult,
  BranchLicenseStatus,
  BostaIntegrationConfig,
  CustomerAddressSnapshot,
  DeliveryOrder,
  LicenseStatus,
  LoginResult,
  MfaActionError,
  MfaPolicy,
  MfaPolicyMode,
  MfaStatus,
  MfaUserStatus,
} from "./index";

export {};

// Mirrors normalizeUpdateRelease() in electron/update-policy.cjs, which is
// fed straight from the portal's /api/public/updates/check response.
type DesktopUpdateRelease = {
  id: string;
  version: string;
  title: string;
  notes?: string;
  severity: "normal" | "important" | "critical" | "emergency";
  publishedAt: string | null;
  policy?: { message?: string; deadlineAt?: string };
  artifactSize?: number | null;
};

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
        getReferral: () => Promise<
          | {
              ok: true;
              code: string;
              url: string;
              currency: string;
              summary: {
                totalReferrals: number;
                pendingMinor: number;
                approvedMinor: number;
                paidMinor: number;
                totalCommissionMinor: number;
              };
              history: Array<{
                id: number;
                referredShopName: string;
                status: "invited" | "pending" | "approved" | "paid" | "cancelled";
                commissionAmountMinor: number;
                currency: string;
                createdAt: string | null;
                convertedAt: string | null;
                approvedAt: string | null;
                paidAt: string | null;
                paymentReference: string | null;
              }>;
            }
          | {
              ok: false;
              error:
                | "not_authorized"
                | "license_inactive"
                | "online_service_unavailable"
                | "referral_not_available"
                | "invalid_server_response";
            }
        >;
        getCommerceSyncStatus: () => Promise<
          | {
              ok: true;
              lastSyncedAt: string | null;
              lastError: { message: string; at: string } | null;
            }
          | { ok: false; error: "not_authorized" }
        >;
        getMobileLinkStatus: () => Promise<
          | {
              ok: true;
              allowedRole: boolean;
              featureLicensed: boolean;
              twoFactorLicensed: boolean;
              mfaEnabled: boolean;
              role: "owner" | "supervisor";
            }
          | { ok: false; error: "not_authorized" }
        >;
        createMobilePairing: (
          password: string,
          verificationCode: string,
          label?: string,
        ) => Promise<
          | {
              ok: true;
              activationCode: string;
              expiresAt: string;
              user: { name: string; username: string; role: "owner" | "employee" };
            }
          | { ok: false; error: string; remainSeconds?: number; attemptsRemaining?: number }
        >;
        activate: (
          serial: string,
        ) => Promise<{ ok: boolean; status: LicenseStatus }>;
        onRevoked: (cb: () => void) => () => void;
        onRestored: (cb: () => void) => () => void;
      };
      branchLicensing: {
        getStatus: () => Promise<BranchLicenseStatus>;
        activate: (serial: string) => Promise<BranchActivationResult>;
        createBranch: (input: {
          name: string;
          address?: string;
          phone?: string;
        }) => Promise<BranchCreationResult>;
      };
      integrations: {
        bosta: {
          getConfig: () => Promise<{
            ok: boolean;
            error?: string;
            config?: BostaIntegrationConfig;
          }>;
          saveConfig: (config: {
            apiKey?: string;
            enabled: boolean;
            autoTrackingEnabled?: boolean;
            autoTrackingIntervalMinutes?: number;
            businessLocationId?: string;
            webhookUrl?: string;
            webhookHeaderName?: string;
            webhookHeaderValue?: string;
            webhookPollToken?: string;
            defaultPackageType: NonNullable<DeliveryOrder["packageType"]>;
            allowOpenPackage: boolean;
          }) => Promise<{
            ok: boolean;
            error?: string;
            config?: BostaIntegrationConfig;
          }>;
          testConnection: () => Promise<{
            ok: boolean;
            error?: string;
            pickupLocations?: Array<{ id: string; name: string }>;
          }>;
          createDelivery: (payload: {
            businessReference: string;
            businessLocationId?: string;
            cod: number;
            goodsValue?: number;
            receiver: { fullName: string; phone: string; email?: string };
            dropOffAddress: CustomerAddressSnapshot;
            specs: {
              packageType?: DeliveryOrder["packageType"];
              itemsCount: number;
              description: string;
            };
            notes?: string;
            allowOpenPackage: boolean;
          }) => Promise<{ ok: boolean; error?: string; data?: unknown }>;
          trackDelivery: (
            reference: string,
          ) => Promise<{ ok: boolean; error?: string; data?: unknown }>;
          getCities: () => Promise<{
            ok: boolean;
            error?: string;
            data?: unknown;
          }>;
          getDistricts: (
            cityId: string,
          ) => Promise<{ ok: boolean; error?: string; data?: unknown }>;
          estimatePrice: (payload: {
            dropOffCity: string;
            cod: number;
            size: "Normal" | "Light Bulky" | "Heavy Bulky";
          }) => Promise<{ ok: boolean; error?: string; data?: unknown }>;
          getPricingPlan: (payload: {
            tierIdSelector: "c__CT4DU9I" | "yiqKg_aGM1";
            pickupSectorId: number;
            vatIncluded?: boolean;
          }) => Promise<{ ok: boolean; error?: string; data?: unknown }>;
          testWebhook: (payload?: {
            webhookUrl?: string;
            webhookPollToken?: string;
          }) => Promise<{
            ok: boolean;
            error?: string;
            stage?: "url" | "token" | "network" | "health" | "authorization" | "complete";
            status?: number;
            service?: string;
            pendingEvents?: number;
          }>;
          getWebhookEvents: () => Promise<{
            ok: boolean;
            error?: string;
            data?: unknown;
          }>;
          acknowledgeWebhookEvents: (
            ids: string[],
          ) => Promise<{ ok: boolean; error?: string; data?: unknown }>;
        };
      };
      setup: {
        createOwner: (
          username: string,
          password: string,
        ) => Promise<{ ok: boolean; user?: AppUser; error?: string }>;
        hasOwner: () => Promise<boolean>;
        selectDirectory: () => Promise<string | null>;
      };
      auth: {
        login: (
          username: string,
          password: string,
        ) => Promise<LoginResult & { user?: AppUser }>;
        getSession: () => Promise<{
          ok: boolean;
          user?: AppUser;
          error?: "not_authenticated";
        }>;
        verifySecondFactor: (
          challengeId: string,
          code: string,
        ) => Promise<
          LoginResult & {
            user?: AppUser;
            usedMethod?: "totp" | "recovery_code";
            recoveryCodesRemaining?: number;
          }
        >;
        beginAccountRecovery: (recoveryCode: string) => Promise<{
          ok: boolean;
          challengeId?: string;
          expiresAt?: string;
          username?: string;
          error?: "invalid_recovery_code" | "rate_limited";
          remainSeconds?: number;
        }>;
        beginAccountRecoveryWithTotp: (
          username: string,
          code: string,
        ) => Promise<{
          ok: boolean;
          challengeId?: string;
          expiresAt?: string;
          username?: string;
          error?:
            | "invalid_code"
            | "invalid_recovery_code"
            | "code_reused"
            | "rate_limited";
          remainSeconds?: number;
          attemptsRemaining?: number;
        }>;
        completeAccountRecovery: (
          challengeId: string,
          newPassword: string,
          resetMfa: boolean,
        ) => Promise<{
          ok: boolean;
          username?: string;
          mfaReset?: boolean;
          requiresMfaEnrollment?: boolean;
          error?:
            | "invalid_input"
            | "challenge_expired"
            | "invalid_challenge"
            | "user_missing";
        }>;
        logout: () => Promise<{ ok: boolean }>;
        hashPassword: (password: string) => Promise<string>;
        changePassword: (
          userId: string,
          currentPassword: string,
          newPassword: string,
        ) => Promise<{
          ok: boolean;
          user?: AppUser;
          error?:
            | "invalid_input"
            | "user_missing"
            | "invalid_current_password"
            | "not_authorized";
        }>;
        updateProfile: (
          userId: string,
          name: string,
          currentPassword?: string,
          newPassword?: string,
        ) => Promise<{
          ok: boolean;
          user?: AppUser;
          error?:
            | "invalid_input"
            | "user_missing"
            | "invalid_current_password"
            | "not_authorized";
        }>;
        resetOwnerPassword: (
          supportCode: string,
          username: string,
          password: string,
        ) => Promise<{
          ok: boolean;
          user?: AppUser;
          error?:
            | "invalid_support_code"
            | "machine_mismatch"
            | "support_code_expired"
            | "support_code_already_used"
            | "owner_missing"
            | "invalid_input"
            | "username_taken"
            | "rate_limited";
          remainSeconds?: number;
        }>;
      };
      mfa: {
        getOwnStatus: () => Promise<
          ({ ok: true } & MfaStatus) | { ok: false; error: MfaActionError }
        >;
        beginEnrollment: (password: string) => Promise<{
          ok: boolean;
          challengeId?: string;
          expiresAt?: string;
          manualKey?: string;
          otpauthUri?: string;
          error?: MfaActionError;
        }>;
        confirmEnrollment: (
          challengeId: string,
          code: string,
        ) => Promise<{
          ok: boolean;
          recoveryCodes?: string[];
          recoveryCodesRemaining?: number;
          user?: AppUser;
          loginCompleted?: boolean;
          error?: MfaActionError;
          attemptsRemaining?: number;
        }>;
        disableOwn: (
          password: string,
          verificationCode: string,
        ) => Promise<{
          ok: boolean;
          error?: MfaActionError;
        }>;
        regenerateRecoveryCodes: (
          password: string,
          verificationCode: string,
        ) => Promise<{
          ok: boolean;
          recoveryCodes?: string[];
          recoveryCodesRemaining?: number;
          error?: MfaActionError;
        }>;
        getPolicy: () => Promise<{
          ok: boolean;
          policy?: MfaPolicy;
          error?: MfaActionError;
        }>;
        updatePolicy: (mode: MfaPolicyMode) => Promise<{
          ok: boolean;
          policy?: MfaPolicy;
          error?: MfaActionError;
          missingUsers?: Array<Pick<AppUser, "id" | "name" | "username">>;
        }>;
        listUserStatuses: () => Promise<{
          ok: boolean;
          users?: MfaUserStatus[];
          error?: MfaActionError;
        }>;
        resetUser: (
          userId: string,
          ownerPassword: string,
          verificationCode: string,
        ) => Promise<{ ok: boolean; error?: MfaActionError }>;
      };
      print: {
        route: (route: string) => Promise<{ ok: boolean; error?: string }>;
        savePdfRoute: (
          route: string,
        ) => Promise<{ ok: boolean; error?: string; path?: string }>;
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
          passphrase?: string,
        ) => Promise<{ ok: boolean; path?: string; error?: string }>;
        selectDirectory: () => Promise<string | null>;
        encryptContent: (
          content: string,
          passphrase?: string,
        ) => Promise<{ ok: boolean; encrypted?: string; error?: string }>;
        decryptContent: (
          content: string,
          passphrase?: string,
        ) => Promise<{
          ok: boolean;
          plaintext?: string;
          error?:
            | "passphrase_required"
            | "decrypt_failed"
            | "not_authorized"
            | "invalid_input";
        }>;
      };
      app: {
        onRunCloseBackup: (cb: () => void) => () => void;
        closeBackupDone: () => void;
      };
      updates?: {
        getStatus: () => Promise<{
          ok: boolean;
          phase: "idle" | "checking" | "available" | "downloading" | "downloaded" | "installing" | "error";
          release: DesktopUpdateRelease | null;
          downloadPercent: number;
          error: string | null;
          lastCheckAt: string | null;
          preferences: {
            autoCheck: boolean;
            autoDownload: boolean;
            autoInstallOnQuit: boolean;
          };
          currentVersion: string;
          canSkip: boolean;
          blocked: boolean;
          persistent: boolean;
        }>;
        checkNow: () => Promise<{
          ok: boolean;
          updateAvailable?: boolean;
          skipped?: boolean;
          release?: DesktopUpdateRelease;
          error?: string;
        }>;
        download: () => Promise<{ ok: boolean; error?: string }>;
        cancelDownload: () => Promise<{ ok: boolean }>;
        install: () => Promise<{ ok: boolean }>;
        skipRelease: (releaseId: string) => Promise<{ ok: boolean; error?: string }>;
        getPreferences: () => Promise<{
          ok: boolean;
          preferences: {
            autoCheck: boolean;
            autoDownload: boolean;
            autoInstallOnQuit: boolean;
          };
        }>;
        setPreferences: (prefs: Partial<{
          autoCheck: boolean;
          autoDownload: boolean;
          autoInstallOnQuit: boolean;
        }>) => Promise<{
          ok: boolean;
          preferences?: {
            autoCheck: boolean;
            autoDownload: boolean;
            autoInstallOnQuit: boolean;
          };
          error?: string;
        }>;
        onStateChanged: (
          // Mirrors broadcastUpdateState()'s payload in electron/main.cjs —
          // these five fields are always present; only extra ad-hoc keys
          // (e.g. from a specific event) are ever added on top.
          cb: (state: {
            phase: "idle" | "checking" | "available" | "downloading" | "downloaded" | "installing" | "error";
            release: DesktopUpdateRelease | null;
            downloadPercent: number;
            error: string | null;
            lastCheckAt: string | null;
          }) => void
        ) => () => void;
        onAvailable: (cb: (data: { release: DesktopUpdateRelease; canSkip: boolean; persistent: boolean }) => void) => () => void;
        onDownloadProgress: (cb: (data: { percent: number; bytesPerSecond: number; transferred: number; total: number }) => void) => () => void;
        onDownloaded: (cb: (data: { release: DesktopUpdateRelease; blocked: boolean }) => void) => () => void;
        onBlocked: (cb: (data: { release: DesktopUpdateRelease }) => void) => () => void;
      };
    };
  }
}
