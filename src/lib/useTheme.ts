import { useCallback, useEffect, useState } from "react";

/**
 * App theme. "system" follows the OS preference. The resolved light/dark class
 * is toggled on <html> (Tailwind darkMode: "class"). An inline script in
 * index.html applies the stored choice before React mounts to avoid a flash.
 */
export type Theme = "light" | "dark" | "system";

const STORAGE_KEY = "hw-theme";

function systemPrefersDark(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-color-scheme: dark)").matches
  );
}

/** Toggle the `dark` class on <html> for the given theme. */
export function applyTheme(theme: Theme): void {
  const dark = theme === "dark" || (theme === "system" && systemPrefersDark());
  document.documentElement.classList.toggle("dark", dark);
}

function readStored(): Theme {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v === "light" || v === "dark" || v === "system") return v;
  } catch {
    /* localStorage unavailable — fall through */
  }
  return "system";
}

/**
 * Apply the stored theme as early as possible (call from main.tsx before render).
 * Avoids an inline <script> so the strict CSP (script-src 'self') stays intact.
 */
export function initTheme(): void {
  applyTheme(readStored());
}

export function useTheme() {
  const [theme, setThemeState] = useState<Theme>(readStored);

  const setTheme = useCallback((next: Theme) => {
    setThemeState(next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      /* ignore persistence failure */
    }
    applyTheme(next);
  }, []);

  // Follow OS changes while on "system".
  useEffect(() => {
    if (theme !== "system") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => applyTheme("system");
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [theme]);

  // Keep the DOM in sync on mount / theme change.
  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  return { theme, setTheme };
}
