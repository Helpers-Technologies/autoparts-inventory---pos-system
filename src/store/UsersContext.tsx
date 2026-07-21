import { createContext, useContext } from "react";
import type { AppUser } from "../types";

export interface UsersContextValue {
  users: AppUser[];
  addUser: (u: Omit<AppUser, "id" | "createdAt">) => AppUser;
  updateUser: (id: string, patch: Partial<AppUser>) => void;
  deleteUser: (id: string) => boolean;
}

export const UsersContext = createContext<UsersContextValue | null>(null);

export function useUsers(): UsersContextValue {
  const ctx = useContext(UsersContext);
  if (!ctx) throw new Error("useUsers must be used within AppProvider");
  return ctx;
}
