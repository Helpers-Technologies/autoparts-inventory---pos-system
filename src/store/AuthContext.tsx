import { createContext, useContext } from "react";
import type { AppUser, LicenseStatus, LoginResult } from "../types";

export interface AuthState {
  isAuthenticated: boolean;
  userId?: string;
  username?: string;
}

export type UpdateCurrentUserProfileResult = {
  ok: boolean;
  error?:
    | "not_authenticated"
    | "invalid_name"
    | "invalid_current_password"
    | "password_too_short"
    | "user_missing";
};

/**
 * Specialised context for session / identity / licensing (roadmap F3-6).
 *
 * Bundles the values that gate access — auth session, current user, desktop flag,
 * license status, owner existence — together with the actions that change them.
 * Components that only deal with login/session/license (App shell, ProtectedShell,
 * LoginPage, ActivationPage) consume {@link useAuth} so they no longer re-render on
 * product/invoice/cash mutations. The underlying state still lives in `AppProvider`,
 * which supplies this context with a memoised slice. Employee/user management
 * (addUser/updateUser/deleteUser) stays on {@link useApp} as a separate concern.
 */
export interface AuthContextValue {
  auth: AuthState;
  currentUser: AppUser | null;
  isDesktop: boolean;
  licenseStatus: LicenseStatus | null;
  ownerExists: boolean;
  ownerCheckPending: boolean;
  isLocked: boolean;
  login: (username: string, password: string) => Promise<LoginResult>;
  logout: () => void;
  lockSession: () => void;
  unlockSession: (username: string, password: string) => Promise<LoginResult>;
  createOwner: (username: string, password: string) => Promise<boolean>;
  activateLicense: (serial: string) => Promise<{ ok: boolean; status: LicenseStatus }>;
  refreshLicenseStatus: () => Promise<LicenseStatus | null>;
  updateCurrentUserProfile: (patch: {
    name: string;
    currentPassword?: string;
    newPassword?: string;
  }) => Promise<UpdateCurrentUserProfileResult>;
}

export const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useAuth must be used within an AppProvider");
  }
  return ctx;
}
