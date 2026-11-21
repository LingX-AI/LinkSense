import { useQuery } from "@tanstack/react-query"

import { isMacDesktopHost } from "@/adapters/desktop/desktop-adapter"
import { readDesktopDeviceStatus } from "@/adapters/desktop/desktop-device-adapter"

export const desktopDeviceStatusQueryKey = (ownerId: string | undefined) =>
  ["desktop-device-status", ownerId] as const

/**
 * Reads the native, owner-keyed Mac device status. Data exposes `deviceId`,
 * `state`, and optional `executionReady`; an older host that omits readiness
 * yields false. The query is disabled outside a macOS host and without a
 * signed-in account, so a plain Web or Windows window never calls the native
 * bridge or polls.
 */
export function useDesktopDeviceStatus(ownerId?: string) {
  const enabled = isMacDesktopHost() && Boolean(ownerId)
  return useQuery({
    queryKey: desktopDeviceStatusQueryKey(ownerId),
    queryFn: readDesktopDeviceStatus,
    enabled,
    retry: false,
    staleTime: 0,
    refetchInterval: enabled ? 5_000 : false,
    refetchIntervalInBackground: false,
  })
}
