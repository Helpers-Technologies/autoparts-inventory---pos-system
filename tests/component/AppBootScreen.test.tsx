// @vitest-environment jsdom
/**
 * The screen that fills the gap after sign-in.
 *
 * Signing in on a shop with years of history unmounted the login page and then
 * blocked the main thread building the dashboard. For all of that time the
 * window was blank white, which is what a crashed app looks like. The fallback
 * returned null on purpose — "so no spinners ever flash" — and that intent is
 * preserved here: nothing is drawn for a fast load, everything is drawn for a
 * slow one.
 *
 * TC-BOOT-001 through TC-BOOT-004
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import "@testing-library/jest-dom/vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import { AppBootScreen } from "../../src/components/layout/AppBootScreen";
import { SettingsContext } from "../../src/store/SettingsContext";
import { seedSettings } from "../../src/data/seed";
import type { Settings } from "../../src/types";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function renderWithSettings(settings: Settings | null, delayMs = 0) {
  const ui = <AppBootScreen delayMs={delayMs} />;
  if (!settings) return render(ui);
  return render(
    <SettingsContext.Provider value={{ settings, updateSettings: vi.fn() }}>
      {ui}
    </SettingsContext.Provider>,
  );
}

describe("AppBootScreen — TC-BOOT", () => {
  it("TC-BOOT-001: draws nothing during the first moments of a fast load", () => {
    vi.useFakeTimers();
    renderWithSettings(null, 250);
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("TC-BOOT-002: appears once the load has clearly taken a while", () => {
    vi.useFakeTimers();
    renderWithSettings(null, 250);
    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(screen.getByRole("status")).toBeInTheDocument();
    expect(screen.getByText("جاري تحميل بيانات المحل...")).toBeInTheDocument();
  });

  it("TC-BOOT-003: shows the shop's own name and logo text when they are known", () => {
    renderWithSettings({
      ...seedSettings,
      arabicLabels: true,
      companyNameAr: "هيلبرز اوتو لقطع الغيار",
      logoText: "هي",
    });
    expect(screen.getByText("هيلبرز اوتو لقطع الغيار")).toBeInTheDocument();
    expect(screen.getByText("هي")).toBeInTheDocument();
  });

  it("TC-BOOT-004: renders above the provider too, without throwing", () => {
    // It doubles as a Suspense fallback, and a fallback can be rendered
    // outside AppProvider — reading settings through the throwing hook would
    // turn a slow load into a crash.
    expect(() => renderWithSettings(null)).not.toThrow();
    expect(screen.getByText("PartFlow")).toBeInTheDocument();
  });
});
