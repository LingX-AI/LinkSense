import { createContext, useContext } from "react"

import type { BootstrapStatus } from "@/api/contracts"

export type BootstrapContextValue = {
  bootstrap?: BootstrapStatus
  isLoading: boolean
  error: unknown
  refetch: () => void
}

/** Single source of truth for the bootstrap query cache entry. */
export const bootstrapQueryKey = ["system", "bootstrap"] as const

export const BootstrapContext = createContext<BootstrapContextValue | null>(null)

export function useBootstrap() {
  const value = useContext(BootstrapContext)
  if (!value) throw new Error("BootstrapProvider is missing")
  return value
}
