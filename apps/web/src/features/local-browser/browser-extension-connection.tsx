import { useEffect } from "react"
import { useQuery } from "@tanstack/react-query"
import { localBrowserPairingSchema } from "@linksense/shared"
import { apiRequest } from "@/api/client"
import { useAuth } from "@/app/auth-state"
import { browserExtensionRequest } from "./bridge"
import { browserExtensionConnectionKey } from "./extension-state"
import { browserUseBrowser } from "./browser-support"

export function BrowserExtensionConnection() {
  const { status, user } = useAuth()
  const ownerId = status === "authenticated" ? user?.id : undefined
  const supportedBrowser = browserUseBrowser() !== null
  const secure =
    location.protocol === "https:" ||
    ["localhost", "127.0.0.1", "[::1]"].includes(location.hostname)
  const { refetch } = useQuery({
    queryKey: browserExtensionConnectionKey(ownerId),
    enabled: Boolean(ownerId) && secure && supportedBrowser,
    retry: false,
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
    queryFn: async ({ signal }) => {
      if (!ownerId) return null
      const options = { owner_id: ownerId, automatic: true }
      const detected = await browserExtensionRequest(
        "detect",
        undefined,
        options
      )
      if (
        !detected.detected ||
        !["automatic", "confirmation"].includes(detected.pairing_mode ?? "")
      )
        return detected
      const pairing = await apiRequest("/local-browser/pairing", {
        method: "POST",
        body: {},
        schema: localBrowserPairingSchema,
        signal,
      })
      if (signal.aborted) return null
      await browserExtensionRequest("pair", pairing, options)
      return browserExtensionRequest("detect", undefined, { owner_id: ownerId })
    },
  })
  useEffect(() => {
    if (!ownerId || !secure || !supportedBrowser) return
    const resume = () => {
      void browserExtensionRequest("detect", undefined, {
        owner_id: ownerId,
        resume: true,
      })
    }
    const requested = (event: MessageEvent<unknown>) => {
      if (
        event.source !== window ||
        event.origin !== location.origin ||
        !event.data ||
        typeof event.data !== "object"
      )
        return
      if (
        "source" in event.data &&
        event.data.source === "linksense-extension" &&
        "type" in event.data &&
        event.data.type === "reconnect"
      )
        void refetch()
    }
    window.addEventListener("online", resume)
    window.addEventListener("focus", resume)
    window.addEventListener("message", requested)
    return () => {
      window.removeEventListener("online", resume)
      window.removeEventListener("focus", resume)
      window.removeEventListener("message", requested)
    }
  }, [ownerId, secure, supportedBrowser, refetch])
  return null
}
