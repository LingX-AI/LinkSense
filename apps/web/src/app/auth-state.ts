import { createContext, useContext } from "react"

import type { AuthSession, User } from "@/api/contracts"

export type AuthContextValue = {
  status: "loading" | "authenticated" | "anonymous"
  user: User | null
  acceptSession: (session: AuthSession) => Promise<void>
  refreshUser: () => Promise<void>
  signOut: () => Promise<void>
}

export const AuthContext = createContext<AuthContextValue | null>(null)

export function useAuth() {
  const value = useContext(AuthContext)
  if (!value) throw new Error("AuthProvider is missing")
  return value
}
