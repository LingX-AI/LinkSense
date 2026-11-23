import { createContext, useContext } from "react"

import type { MacSignOutOptions } from "@/adapters/desktop/mygo"
import type { AccessSession, User } from "@/api/contracts"

export type AuthContextValue = {
  status: "loading" | "authenticated" | "anonymous" | "error"
  user: User | null
  acceptSession: (session: AccessSession) => Promise<void>
  refreshUser: (options?: { signal?: AbortSignal }) => Promise<void>
  // Optional only for state-only context fixtures; AuthProvider always supplies
  // the bounded retry routine used by the restore-error screen.
  retryRestore?: () => void
  signOut: (options?: MacSignOutOptions) => Promise<void>
}

export const AuthContext = createContext<AuthContextValue | null>(null)

export function useAuth() {
  const value = useContext(AuthContext)
  if (!value) throw new Error("AuthProvider is missing")
  return value
}
