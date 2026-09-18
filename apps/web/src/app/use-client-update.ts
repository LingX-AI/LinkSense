import { useSyncExternalStore } from "react"
import { getPendingClientBuild, subscribeToClientBuild } from "./client-build"

export function useClientUpdate(): string | null {
  return useSyncExternalStore(
    subscribeToClientBuild,
    getPendingClientBuild,
    () => null
  )
}
