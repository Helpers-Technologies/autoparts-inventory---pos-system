import { useCallback } from "react";
import { useSettings } from "../store/SettingsContext";
import { useAuth } from "../store/AuthContext";
import { isFeatureEnabled, isAllowedByLicense, type FeatureKey } from "./features";

/**
 * Resolves module availability against both the signed license cap and the
 * owner's settings preferences. Use {@link isEnabled} to gate nav/routes/UI and
 * {@link isAllowed} to tell whether a disabled module could be turned on (i.e.
 * it is within the client's package).
 */
export function useFeatures() {
  const { settings } = useSettings();
  const { licenseStatus } = useAuth();
  const license = licenseStatus?.license ?? null;

  const isEnabled = useCallback(
    (key: FeatureKey) => isFeatureEnabled(key, settings, license),
    [settings, license]
  );

  const isAllowed = useCallback(
    (key: FeatureKey) => isAllowedByLicense(key, license),
    [license]
  );

  return { isEnabled, isAllowed };
}
