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
import {
  userSchema,
  type AccessSession,
  type SupportedLanguage,
  type User,
} from "@/api/contracts"
import {
  captureAccessSessionGuard,
  getAccessToken,
  readAccessTokenIdentity,
  setAccessToken,
  subscribeToAccessToken,
} from "@/api/session"
import { AuthContext, type AuthContextValue } from "@/app/auth-state"
import { useBootstrap } from "@/app/bootstrap-state"
import { setAppLanguage } from "@/i18n"
import { z } from "zod"

const AUTH_RESTORE_RETRY_DELAY_MS = 2_000
const AUTH_RESTORE_MAX_ATTEMPTS = 3
type AccountIdentity = Pick<User, "id" | "role">

function isAccountScopedQuery(query: Query) {
  return !(query.queryKey[0] === "system" && query.queryKey[1] === "bootstrap")
}

function matchesAccount(current: AccountIdentity, next: AccountIdentity | null) {
  return current.id === next?.id && current.role === next.role
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const { bootstrap } = useBootstrap()
  const queryClient = useQueryClient()
  const bootstrapInitialized = bootstrap?.initialized
  const [status, setStatus] = useState<AuthContextValue["status"]>("loading")
  const [user, setUser] = useState<User | null>(null)
  const verifiedUser = useRef<User | null>(null)
  const acceptingToken = useRef<string | null>(null)
  const profileRequest = useRef<{
    token: string | null
    controller: AbortController
    promise: Promise<void>
  } | null>(null)

  const clearAccount = useCallback(() => {
    queryClient.removeQueries({ predicate: isAccountScopedQuery })
    queryClient.getMutationCache().clear()
    verifiedUser.current = null
    setUser(null)
  }, [queryClient])

  const refreshUser = useCallback(
    async ({
      signal,
      preferredLanguage,
      skipRefresh,
    }: {
      signal?: AbortSignal
      preferredLanguage?: SupportedLanguage | null
      skipRefresh?: boolean
    } = {}) => {
      if (signal?.aborted) return
      const token = getAccessToken()
      const current = profileRequest.current
      if (
        current?.token === token &&
        !current.controller.signal.aborted &&
        !signal
      ) {
        return current.promise
      }

      current?.controller.abort()
      const controller = new AbortController()
      const isCurrent = captureAccessSessionGuard()
      const canApplyProfile = () => !controller.signal.aborted && isCurrent()
      const abort = () => controller.abort()
      signal?.addEventListener("abort", abort, { once: true })

      const promise = (async () => {
        if (!canApplyProfile()) return
        if (preferredLanguage) await setAppLanguage(preferredLanguage)
        if (!canApplyProfile()) return
        const nextUser = await apiRequest("/me", {
          schema: userSchema,
          signal: controller.signal,
          skipRefresh,
        })
        if (!canApplyProfile()) return
        if (
          verifiedUser.current &&
          !matchesAccount(verifiedUser.current, nextUser)
        ) {
          clearAccount()
          setStatus("loading")
        }
        if (nextUser.language) await setAppLanguage(nextUser.language)
        if (!canApplyProfile()) return
        const snapshot = replaceEqualDeep(verifiedUser.current, nextUser)
        verifiedUser.current = snapshot
        setUser(snapshot)
        setStatus("authenticated")
      })().catch((error: unknown) => {
        if (canApplyProfile()) throw error
      })
      profileRequest.current = { token, controller, promise }
      try {
        await promise
      } finally {
        signal?.removeEventListener("abort", abort)
        if (profileRequest.current?.controller === controller) {
          profileRequest.current = null
        }
      }
    },
    [clearAccount]
  )

  const acceptSession = useCallback(
    async (session: AccessSession) => {
      acceptingToken.current = session.access_token
      try {
        setAccessToken(session.access_token, session.access_token_expires_at)
      } finally {
        acceptingToken.current = null
      }
      if (getAccessToken() !== session.access_token) return
      await refreshUser({ preferredLanguage: session.user?.preferred_locale })
    },
    [refreshUser]
  )

  const signOut = useCallback(async () => {
    const isCurrent = captureAccessSessionGuard()
    if (!isCurrent()) return
    const request = apiRequest("/auth/logout", {
      method: "POST",
      schema: z.unknown(),
      skipRefresh: true,
    })
    if (isCurrent()) setAccessToken(null)
    await request
  }, [])

  useEffect(() => {
    if (bootstrapInitialized !== true) return

    let token = getAccessToken()
    let generation = 0
    let retryTimer: number | null = null
    const cancelRestore = () => {
      generation += 1
      if (retryTimer !== null) {
        window.clearTimeout(retryTimer)
        retryTimer = null
      }
      profileRequest.current?.controller.abort()
    }

    const restoreSession = async (skipRefresh: boolean, attempt = 1) => {
      const currentToken = getAccessToken()
      const restoreGeneration = generation
      const isCurrent = captureAccessSessionGuard()
      try {
        if (currentToken) {
          await refreshUser({ skipRefresh })
        } else {
          await refreshSession()
        }
      } catch (error) {
        if (restoreGeneration !== generation || !isCurrent()) return

        if (isDefinitiveAuthenticationError(error)) {
          setAccessToken(null)
          return
        }

        if (
          !isRetryableApiError(error) ||
          attempt >= AUTH_RESTORE_MAX_ATTEMPTS
        ) {
          if (!verifiedUser.current) setStatus("error")
          return
        }

        retryTimer = window.setTimeout(() => {
          retryTimer = null
          void restoreSession(skipRefresh, attempt + 1)
        }, AUTH_RESTORE_RETRY_DELAY_MS)
      }
    }

    const unsubscribe = subscribeToAccessToken((nextToken) => {
      if (nextToken && nextToken === token) return
      token = nextToken
      cancelRestore()
      if (!nextToken) {
        clearAccount()
        setStatus("anonymous")
        return
      }
      if (
        verifiedUser.current &&
        !matchesAccount(verifiedUser.current, readAccessTokenIdentity(nextToken))
      ) {
        clearAccount()
        setStatus("loading")
      }
      if (nextToken === acceptingToken.current) return
      if (!verifiedUser.current) setStatus("loading")
      void restoreSession(true)
    })
    void restoreSession(false)
    return () => {
      unsubscribe()
      cancelRestore()
    }
  }, [bootstrapInitialized, clearAccount, refreshUser])

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
