import { useQuery } from "@tanstack/react-query"
import type { browserExtensionRequest } from "./bridge"

export const browserExtensionConnectionKey = (userId?: string) =>
  ["local-browser-extension-connection", userId] as const

export function useBrowserExtensionState(userId: string) {
  return useQuery<Awaited<ReturnType<typeof browserExtensionRequest>> | null>({
    queryKey: browserExtensionConnectionKey(userId),
    // Cache-only observer: BrowserExtensionConnection owns fetching. queryFn
    // exists only so TanStack Query stops warning about a missing one.
    queryFn: async () => null,
    enabled: false,
  })
}
