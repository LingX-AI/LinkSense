import { useRef, useState } from "react"
import { useMutation } from "@tanstack/react-query"
import type { ConnectionProvider } from "@linksense/shared"
import { connectionsApi } from "./api"

export function useConnectionAuthorization() {
  const inFlight = useRef(false)
  const [blockedProvider, setBlockedProvider] =
    useState<ConnectionProvider | null>(null)
  const mutation = useMutation({
    mutationFn: async ({
      provider,
      tab,
    }: {
      provider: ConnectionProvider
      tab: Window
    }) => {
      try {
        const { authorization_url } = await connectionsApi.authorize(provider)
        if (!tab.closed) tab.location.replace(authorization_url)
      } catch (error) {
        tab.close()
        throw error
      } finally {
        inFlight.current = false
      }
    },
  })

  function start(provider: ConnectionProvider) {
    if (inFlight.current) return
    // Reserve the tab during the user gesture, before awaiting the API. Using
    // noopener in window.open would discard the handle needed for navigation.
    const tab = window.open("about:blank", "_blank")
    if (!tab) {
      setBlockedProvider(provider)
      return
    }
    tab.opener = null
    setBlockedProvider(null)
    inFlight.current = true
    mutation.mutate({ provider, tab })
  }

  return {
    start,
    tabBlocked: blockedProvider !== null,
    blockedProvider,
    isPending: mutation.isPending,
    provider: mutation.variables?.provider,
    error: mutation.error,
  }
}
