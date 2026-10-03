import React, { type ComponentProps } from "react";
import { render, type RenderOptions } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { ToastProvider } from "../../src/components/ui/Toast";
import { DEFERRED_COLLECTIONS, HydrationContext, type HydrationContextValue } from "../../src/store/HydrationContext";
import "@testing-library/jest-dom/vitest";

type InitialEntry = NonNullable<ComponentProps<typeof MemoryRouter>["initialEntries"]>[number];

const loadedCollections = Object.fromEntries(DEFERRED_COLLECTIONS.map((name) => [name, "loaded"])) as HydrationContextValue["collectionState"];
const hydrationValue: HydrationContextValue = {
  collectionState: loadedCollections,
  hydrateCollections: async () => true,
  areCollectionsLoaded: () => true,
};

/**
 * Custom render that wraps components in the providers required by most pages:
 * - MemoryRouter (react-router-dom v6)
 * - ToastProvider
 *
 * Does NOT include AppProvider — mock useApp() with vi.mock at module level instead.
 */
export function renderWithProviders(
  ui: React.ReactElement,
  options?: Omit<RenderOptions, "wrapper"> & { initialEntries?: InitialEntry[] }
) {
  const { initialEntries = ["/"], ...rest } = options ?? {};

  function Wrapper({ children }: { children: React.ReactNode }) {
    return (
      <MemoryRouter initialEntries={initialEntries}>
        <HydrationContext.Provider value={hydrationValue}>
          <ToastProvider>{children}</ToastProvider>
        </HydrationContext.Provider>
      </MemoryRouter>
    );
  }

  return render(ui, { wrapper: Wrapper, ...rest });
}

export * from "@testing-library/react";
