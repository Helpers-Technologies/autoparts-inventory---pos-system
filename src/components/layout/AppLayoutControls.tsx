import { createContext, useContext, type ReactNode } from "react";

type AppLayoutControlsValue = {
  sidebarOpen: boolean;
  toggleSidebar: () => void;
};

const AppLayoutControlsContext = createContext<AppLayoutControlsValue>({
  sidebarOpen: false,
  toggleSidebar: () => undefined,
});

export function AppLayoutControlsProvider({
  value,
  children,
}: {
  value: AppLayoutControlsValue;
  children: ReactNode;
}) {
  return (
    <AppLayoutControlsContext.Provider value={value}>
      {children}
    </AppLayoutControlsContext.Provider>
  );
}

export function useAppLayoutControls() {
  return useContext(AppLayoutControlsContext);
}
