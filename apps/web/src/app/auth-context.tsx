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
  getAccessTokenSubject,
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
  const accountVersionRef = useRef(0)
  const accountIdRef = useRef<string | null>(null)
  const accountRoleRef = useRef<User["role"] | null>(null)
  const resolvedTokenRef = useRef<string | null>(null)
  const profileRequestRef = useRef<{
    token: string | null
    controller: AbortController
    promise: Promise<void>
  } | null>(null)

  const clearAccountCaches = useCallback(async () => {
    try {
      await queryClient.cancelQueries({ predicate: isAccountScopedQuery })
    } finally {
      queryClient.removeQueries({ predicate: isAccountScopedQuery })
      queryClient.getMutationCache().clear()
    }
  }, [queryClient])

  const resetAccountState = useCallback(() => {
    if (accountResetPromiseRef.current) {
      return accountResetPromiseRef.current
    }

    const version = ++accountVersionRef.current
    profileRequestRef.current?.controller.abort()
    accountIdRef.current = null
    accountRoleRef.current = null
    resolvedTokenRef.current = null

    const resetPromise = (async () => {
      try {
        await clearAccountCaches()
      } finally {
        if (version === accountVersionRef.current) {
          setUser(null)
          setStatus("anonymous")
        }
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
  }, [clearAccountCaches])

  const refreshUser = useCallback(
    (options?: { signal?: AbortSignal }): Promise<void> => {
      const token = getAccessToken()
      const previous = profileRequestRef.current
      if (
        !options?.signal &&
        previous?.token === token &&
        !previous.controller.signal.aborted
      ) {
        return previous.promise
      }
      previous?.controller.abort()
      const controller = new AbortController()
      const version = ++accountVersionRef.current
      const subject = getAccessTokenSubject(token)
      const changesAccount =
        accountIdRef.current !== null &&
        (subject
          ? subject !== accountIdRef.current
          : token !== resolvedTokenRef.current)
      if (changesAccount) {
        setUser(null)
        setStatus("loading")
      }
      const signal = options?.signal
        ? AbortSignal.any([options.signal, controller.signal])
        : controller.signal
      const current = () =>
        !signal.aborted &&
        !controller.signal.aborted &&
        version === accountVersionRef.current
      const promise = (async () => {
        try {
          if (accountResetPromiseRef.current)
            await accountResetPromiseRef.current
          if (changesAccount) await clearAccountCaches()
          if (!current()) return
          const nextUser = await apiRequest("/me", {
            schema: userSchema,
            signal,
          })
          if (!current()) return
          if (
            accountIdRef.current &&
            (accountIdRef.current !== nextUser.id ||
              accountRoleRef.current !== nextUser.role) &&
            !changesAccount
          ) {
            await clearAccountCaches()
          }
          if (!current()) return
          if (nextUser.language) await setAppLanguage(nextUser.language)
          if (!current()) return
          accountIdRef.current = nextUser.id
          accountRoleRef.current = nextUser.role
          resolvedTokenRef.current = getAccessToken()
          setUser((currentUser) => replaceEqualDeep(currentUser, nextUser))
          setStatus("authenticated")
        } catch (error) {
          if (!current()) return
          throw error
        }
      })().finally(() => {
        if (profileRequestRef.current?.controller === controller)
          profileRequestRef.current = null
      })
      profileRequestRef.current = { token, controller, promise }
      return promise
    },
    [clearAccountCaches]
  )

  const acceptSession = useCallback(
    async (session: AccessSession) => {
      setAccessToken(session.access_token, session.access_token_expires_at)
      if (getAccessToken() !== session.access_token) return
      if (session.user?.preferred_locale) {
        await setAppLanguage(session.user.preferred_locale)
      }
      if (getAccessToken() !== session.access_token) return
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
      let expectedToken = getAccessToken()
      try {
        if (expectedToken) {
          await refreshUser()
        } else {
          const session = await refreshSession()
          if (cancelled) return
          const token = getAccessToken()
          if (token && token !== session.access_token) return
          expectedToken = session.access_token
          await acceptSession(session)
        }
      } catch (error) {
        if (cancelled || getAccessToken() !== expectedToken) return

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
      profileRequestRef.current?.controller.abort()
      accountVersionRef.current += 1
      if (retryTimer !== null) window.clearTimeout(retryTimer)
    }
  }, [acceptSession, bootstrapInitialized, refreshUser, resetAccountState])

  useEffect(
    () =>
      subscribeToAccessToken((token) => {
        if (!token) {
          void resetAccountState().catch(() => {
            if (!getAccessToken()) setStatus("error")
          })
          return
        }
        void refreshUser()
          .catch(async (error: unknown) => {
            if (getAccessToken() !== token) return
            if (isDefinitiveAuthenticationError(error)) {
              setAccessToken(null)
              await resetAccountState()
            } else setStatus("error")
          })
          .catch(() => {
            if (getAccessToken() === token) setStatus("error")
          })
      }),
    [resetAccountState, refreshUser]
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
