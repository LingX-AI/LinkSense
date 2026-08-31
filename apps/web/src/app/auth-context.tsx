import { useCallback, useEffect, useMemo, useState } from "react"
import type { ReactNode } from "react"

import {
  apiRequest,
  isDefinitiveAuthenticationError,
  refreshSession,
} from "@/api/client"
import { userSchema, type AuthSession, type User } from "@/api/contracts"
import {
  getAccessToken,
  setAccessToken,
  subscribeToAccessToken,
} from "@/api/session"
import { AuthContext, type AuthContextValue } from "@/app/auth-state"
import { useBootstrap } from "@/app/bootstrap-state"
import { setAppLanguage } from "@/i18n"
import { z } from "zod"

const AUTH_RESTORE_RETRY_DELAY_MS = 2_000

export function AuthProvider({ children }: { children: ReactNode }) {
  const { bootstrap } = useBootstrap()
  const bootstrapInitialized = bootstrap?.initialized
  const [status, setStatus] = useState<AuthContextValue["status"]>("loading")
  const [user, setUser] = useState<User | null>(null)

  const refreshUser = useCallback(async () => {
    const nextUser = await apiRequest("/me", { schema: userSchema })
    if (nextUser.language) await setAppLanguage(nextUser.language)
    setUser(nextUser)
    setStatus("authenticated")
  }, [])

  const acceptSession = useCallback(
    async (session: AuthSession) => {
      setAccessToken(
        session.access_token ?? null,
        session.access_token_expires_at
      )
      if (session.user?.language) {
        await setAppLanguage(session.user.language)
      }
      await refreshUser()
    },
    [refreshUser]
  )

  const signOut = useCallback(async () => {
    try {
      await apiRequest("/auth/logout", {
        method: "POST",
        schema: z.unknown(),
        skipRefresh: true,
      })
    } finally {
      setAccessToken(null)
      setUser(null)
      setStatus("anonymous")
    }
  }, [])

  useEffect(() => {
    if (bootstrapInitialized !== true) return

    let cancelled = false
    let retryTimer: number | null = null

    const restoreSession = async () => {
      try {
        if (getAccessToken()) {
          await refreshUser()
        } else {
          const session = await refreshSession()
          if (cancelled) return
          await acceptSession(session)
        }
      } catch (error) {
        if (cancelled) return

        if (isDefinitiveAuthenticationError(error)) {
          setAccessToken(null)
          setUser(null)
          setStatus("anonymous")
          return
        }

        setStatus("loading")
        retryTimer = window.setTimeout(() => {
          retryTimer = null
          void restoreSession()
        }, AUTH_RESTORE_RETRY_DELAY_MS)
      }
    }

    void restoreSession()

    return () => {
      cancelled = true
      if (retryTimer !== null) window.clearTimeout(retryTimer)
    }
  }, [acceptSession, bootstrapInitialized, refreshUser])

  useEffect(
    () =>
      subscribeToAccessToken((token) => {
        if (!token && status === "authenticated") {
          setUser(null)
          setStatus("anonymous")
        }
      }),
    [status]
  )

  const effectiveStatus =
    bootstrap && !bootstrap.initialized ? "anonymous" : status
  const value = useMemo<AuthContextValue>(
    () => ({
      status: effectiveStatus,
      user,
      acceptSession,
      refreshUser,
      signOut,
    }),
    [acceptSession, effectiveStatus, refreshUser, signOut, user]
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
