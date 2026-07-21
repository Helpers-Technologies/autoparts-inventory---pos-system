import React from "react";
import { render, type RenderOptions } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { ToastProvider } from "../../src/components/ui/Toast";

/**
 * Custom render that wraps components in the providers required by most pages:
 * - MemoryRouter (react-router-dom v6)
 * - ToastProvider
 *
 * Does NOT include AppProvider — mock useApp() with vi.mock at module level instead.
 */
export function renderWithProviders(
  ui: React.ReactElement,
  options?: Omit<RenderOptions, "wrapper"> & { initialEntries?: string[] }
) {
  const { initialEntries = ["/"], ...rest } = options ?? {};

  function Wrapper({ children }: { children: React.ReactNode }) {
    return (
      <MemoryRouter initialEntries={initialEntries}>
        <ToastProvider>{children}</ToastProvider>
      </MemoryRouter>
    );
  }

  return render(ui, { wrapper: Wrapper, ...rest });
}

export * from "@testing-library/react";
