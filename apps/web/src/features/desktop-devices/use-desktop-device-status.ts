import { useQuery } from "@tanstack/react-query"

import { isMacDesktopHost } from "@/adapters/desktop/desktop-adapter"
import { readDesktopDeviceStatus } from "@/adapters/desktop/desktop-device-adapter"

export const desktopDeviceStatusQueryKey = (ownerId: string | undefined) =>
  ["desktop-device-status", ownerId] as const

/**
 * Reads the native, owner-keyed Mac device status. Data exposes `deviceId`,
 * `state`, optional `executionReady`, and the negotiated `computerReady` flag;
 * an older host that omits either capability yields false. The query is
 * disabled outside a macOS host and without a signed-in account, so a plain
 * Web or Windows window never calls the native bridge or polls.
 */
export function useDesktopDeviceStatus(ownerId?: string) {
  const enabled = isMacDesktopHost() && Boolean(ownerId)
  return useQuery({
    queryKey: desktopDeviceStatusQueryKey(ownerId),
    queryFn: () => readDesktopDeviceStatus(),
    enabled,
    retry: false,
    staleTime: 0,
    // This read is a native bridge call on the local Mac, not a server
    // request. Go owns the real link state, so the WebView's online manager
    // must never queue the initial read until a browser "reconnect".
    networkMode: "always",
    refetchInterval: enabled ? 5_000 : false,
    refetchIntervalInBackground: false,
  })
}
