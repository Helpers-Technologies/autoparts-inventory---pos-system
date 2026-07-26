import { createContext, useContext } from "react";
import type { CashierShift } from "../types";

export interface ShiftsContextValue {
  shifts: CashierShift[];
  activeShift: CashierShift | null;
  openShift: (opts: { openingCash: number | string; note?: string; branchId?: string; branchName?: string }) => CashierShift;
  closeShift: (shiftId: string, closingCashActual: number | string, note?: string) => CashierShift;
  getShiftSummary: (shiftId: string) => any;
}

export const ShiftsContext = createContext<ShiftsContextValue | null>(null);

export function useShifts(): ShiftsContextValue {
  const ctx = useContext(ShiftsContext);
  if (!ctx) {
    throw new Error("useShifts must be used within an AppProvider");
  }
  return ctx;
}
