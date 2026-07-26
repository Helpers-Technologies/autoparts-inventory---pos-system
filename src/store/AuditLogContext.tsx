import { createContext, useContext } from "react";
import type { AuditAction, AuditLog, AuditSnapshot, AppUser } from "../types";

/**
 * Specialised context exposing the audit-log history (roadmap F3-6).
 *
 * This is the read side only: `logAudit` (the writer) stays inside `AppProvider`
 * because it is called from nearly every store action. The audit-log page consumes
 * {@link useAuditLog} so it re-renders only when new entries are appended, not on
 * unrelated store activity. The list itself still lives in `AppProvider`, which
 * supplies this context with a memoised slice.
 */

export interface AuditLogContextValue {
  auditLogs: AuditLog[];
  /** Restore a deleted invoice from its snapshot entry; false if not restorable. */
  restoreDeletedInvoice: (auditId: string) => boolean;
  clearAuditLogs: (daysOlderThan?: number) => void;
  logAudit?: (action: AuditAction, entityLabel: string, details?: string, snapshot?: AuditSnapshot, overrideUser?: AppUser) => void;
}

export const AuditLogContext = createContext<AuditLogContextValue | null>(null);

export function useAuditLog(): AuditLogContextValue {
  const ctx = useContext(AuditLogContext);
  if (!ctx) {
    throw new Error("useAuditLog must be used within an AppProvider");
  }
  return ctx;
}
