import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import type { ReactNode } from "react"
import {
  replaceEqualDeep,
  useQueryClient,
  type Query,
} from "@tanstack/react-query"

import {
  apiRequest,
  isDefinitiveAuthenticationError,
  isRetryableApiError,
  refreshSession,
} from "@/api/client"
import { userSchema, type AccessSession, type User } from "@/api/contracts"
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
const AUTH_RESTORE_MAX_ATTEMPTS = 3

function isAccountScopedQuery(query: Query) {
  return !(query.queryKey[0] === "system" && query.queryKey[1] === "bootstrap")
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const { bootstrap } = useBootstrap()
  const queryClient = useQueryClient()
  const bootstrapInitialized = bootstrap?.initialized
  const [status, setStatus] = useState<AuthContextValue["status"]>("loading")
  const [user, setUser] = useState<User | null>(null)
  const accountResetPromiseRef = useRef<Promise<void> | null>(null)

  const resetAccountState = useCallback(() => {
    if (accountResetPromiseRef.current) {
      return accountResetPromiseRef.current
    }

    const resetPromise = (async () => {
      try {
        await queryClient.cancelQueries({ predicate: isAccountScopedQuery })
      } finally {
        queryClient.removeQueries({ predicate: isAccountScopedQuery })
        queryClient.getMutationCache().clear()
        setUser(null)
        setStatus("anonymous")
      }
    })()
    accountResetPromiseRef.current = resetPromise
    void resetPromise.then(
      () => {
        if (accountResetPromiseRef.current === resetPromise) {
          accountResetPromiseRef.current = null
        }
      },
      () => {
        if (accountResetPromiseRef.current === resetPromise) {
          accountResetPromiseRef.current = null
        }
      }
    )
    return resetPromise
  }, [queryClient])

  const refreshUser = useCallback(async () => {
    const nextUser = await apiRequest("/me", { schema: userSchema })
    if (nextUser.language) await setAppLanguage(nextUser.language)
    setUser((currentUser) => replaceEqualDeep(currentUser, nextUser))
    setStatus("authenticated")
  }, [])

  const acceptSession = useCallback(
    async (session: AccessSession) => {
      setAccessToken(session.access_token, session.access_token_expires_at)
      if (session.user?.preferred_locale) {
        await setAppLanguage(session.user.preferred_locale)
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
      await resetAccountState()
    }
  }, [resetAccountState])

  useEffect(() => {
    if (bootstrapInitialized !== true) return

    let cancelled = false
    let retryTimer: number | null = null
    let attempt = 0

    const restoreSession = async () => {
      attempt += 1
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
          await resetAccountState()
          return
        }

        if (
          !isRetryableApiError(error) ||
          attempt >= AUTH_RESTORE_MAX_ATTEMPTS
        ) {
          setStatus("error")
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
  }, [acceptSession, bootstrapInitialized, refreshUser, resetAccountState])

  useEffect(
    () =>
      subscribeToAccessToken((token) => {
        if (!token && status === "authenticated") {
          void resetAccountState()
        }
      }),
    [resetAccountState, status]
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
