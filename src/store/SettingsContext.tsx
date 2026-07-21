import { createContext, useContext } from "react";
import type { Settings } from "../types";

/**
 * Specialised context for application settings — the first slice peeled off the
 * monolithic {@link useApp} store (roadmap F3-6).
 *
 * Components that only need settings should consume {@link useSettings} instead of
 * {@link useApp}: they then re-render solely when settings change, not on every
 * product/invoice/cash mutation in the main store. The settings state itself still
 * lives in `AppProvider`, which supplies this context with a memoised slice, so the
 * two views stay in sync while the wider split proceeds incrementally.
 */
export interface SettingsContextValue {
  settings: Settings;
  updateSettings: (patch: Partial<Settings>) => void;
}

export const SettingsContext = createContext<SettingsContextValue | null>(null);

export function useSettings(): SettingsContextValue {
  const ctx = useContext(SettingsContext);
  if (!ctx) {
    throw new Error("useSettings must be used within an AppProvider");
  }
  return ctx;
}
