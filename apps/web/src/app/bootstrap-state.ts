import { createContext, useContext } from "react"

import type { BootstrapStatus } from "@/api/contracts"

export type BootstrapContextValue = {
  bootstrap?: BootstrapStatus
  isLoading: boolean
  error: unknown
  refetch: () => void
}

export const BootstrapContext = createContext<BootstrapContextValue | null>(null)

export function useBootstrap() {
  const value = useContext(BootstrapContext)
  if (!value) throw new Error("BootstrapProvider is missing")
  return value
}
