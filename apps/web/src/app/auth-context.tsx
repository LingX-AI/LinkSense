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
  beginLoginSession,
  captureAccessSessionGuard,
  getAccessToken,
  getLoginSessionBoundary,
  isLoginSessionCurrent,
  readAccessTokenIdentity,
  setAccessToken,
  subscribeToAccessToken,
  type LoginSessionBoundary,
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
  // Explicitly accepted replacement logins are recorded independently of the
  // token so a definitive clear can be distinguished from a new login.
  const lastAcceptedLoginRef = useRef<LoginSessionBoundary | null>(null)
  // A definitive clear can arrive while an explicit sign-out owns the ending
  // login; this records that the clear belongs to the sign-out intent.
  const signOutClearRef = useRef(false)
  // An in-flight sign-out still owns the ending login, so a definitive clear
  // during it must invalidate admitted work for that same login.
  const signOutInFlightRef = useRef(false)
  const statusRef = useRef(status)

  useEffect(() => {
    statusRef.current = status
  }, [status])

  const clearAccount = useCallback(() => {
    // Removal is synchronous: QueryCache.remove destroys each matched query
    // and cancels its retryer in the same turn, aborting in-flight account
    // reads. A replacement login accepted afterwards therefore cannot see, or
    // later repopulate, the ended account's cache. Only bootstrap (which is
    // not account-scoped) survives.
    queryClient.removeQueries({ predicate: isAccountScopedQuery })
    queryClient.getMutationCache().clear()
    verifiedUser.current = null
    setUser(null)
  }, [queryClient])

  const resetAccountState = useCallback(
    async (nextStatus: "anonymous" | "loading" = "anonymous") => {
      clearAccount()
      setStatus(nextStatus)
    },
    [clearAccount]
  )

  const refreshUser = useCallback(
    async (
      options: {
        signal?: AbortSignal
        preferredLanguage?: SupportedLanguage | null
        skipRefresh?: boolean
      } = {}
    ) => {
      if (options.signal?.aborted) return
      const loginSessionBoundary = getLoginSessionBoundary()
      const token = getAccessToken()
      const current = profileRequest.current
      if (
        current?.token === token &&
        !current.controller.signal.aborted &&
        !options.signal
      ) {
        return current.promise
      }

      current?.controller.abort()
      const controller = new AbortController()
      const isCurrent = captureAccessSessionGuard()
      const canApplyProfile = () =>
        !controller.signal.aborted &&
        isLoginSessionCurrent(loginSessionBoundary) &&
        isCurrent()
      const abort = () => controller.abort()
      options.signal?.addEventListener("abort", abort, { once: true })

      const promise = (async () => {
        if (!canApplyProfile()) return
        if (options.preferredLanguage) {
          await setAppLanguage(options.preferredLanguage)
        }
        if (!canApplyProfile()) return
        const nextUser = await apiRequest("/me", {
          schema: userSchema,
          signal: controller.signal,
          skipRefresh: options.skipRefresh,
          loginSessionBoundary,
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
        options.signal?.removeEventListener("abort", abort)
        if (profileRequest.current?.controller === controller) {
          profileRequest.current = null
        }
      }
    },
    [clearAccount]
  )

  const applySessionCredentials = useCallback(
    async (
      session: AccessSession,
      loginSessionBoundary: LoginSessionBoundary
    ) => {
      if (!isLoginSessionCurrent(loginSessionBoundary)) return false
      setAccessToken(session.access_token, session.access_token_expires_at)
      if (!isLoginSessionCurrent(loginSessionBoundary)) return false
      if (session.user?.preferred_locale) {
        await setAppLanguage(session.user.preferred_locale)
        if (!isLoginSessionCurrent(loginSessionBoundary)) return false
      }
      return true
    },
    []
  )

  const acceptSession = useCallback(
    async (session: AccessSession) => {
      const loginSessionBoundary = beginLoginSession("sign-in")
      lastAcceptedLoginRef.current = loginSessionBoundary
      // An explicitly accepted login owns its incoming profile; this is not a
      // foreign account change that should discard admitted data.
      verifiedUser.current = null
      acceptingToken.current = session.access_token
      try {
        if (!(await applySessionCredentials(session, loginSessionBoundary)))
          return
      } finally {
        acceptingToken.current = null
      }
      if (getAccessToken() !== session.access_token) return
      await refreshUser()
    },
    [applySessionCredentials, refreshUser]
  )

  const signOut = useCallback(async () => {
    const signedOutToken = getAccessToken()
    // Sign-out intent invalidates admitted work immediately, before the logout
    // request can pause. A later explicit login advances the boundary again, so
    // this older flow must not clear its credentials.
    const loginSessionBoundary = beginLoginSession("sign-out")
    // A definitive token clear during the logout request ends this same login.
    // Only an explicitly accepted replacement makes the session belong to
    // someone else.
    const replacementAccepted = () => {
      const acceptedBoundary = lastAcceptedLoginRef.current
      return (
        acceptedBoundary !== null && acceptedBoundary > loginSessionBoundary
      )
    }
    // A replacement login (or a newer token in this tab) owns the session
    // after it appears; this sign-out must not clear or reset it.
    const ownsCurrentSession = () => {
      if (replacementAccepted()) return false
      const currentToken = getAccessToken()
      return currentToken === null || currentToken === signedOutToken
    }
    signOutInFlightRef.current = true
    let request: Promise<unknown>
    try {
      request = apiRequest("/auth/logout", {
        method: "POST",
        schema: z.unknown(),
        skipRefresh: true,
        loginSessionBoundary,
      })
    } catch (error) {
      signOutInFlightRef.current = false
      throw error
    }
    if (signedOutToken && isLoginSessionCurrent(loginSessionBoundary)) {
      // Browsers drop the bearer immediately. The listener owns the account
      // reset, but this clear must not count as another login replacement.
      signOutClearRef.current = true
      try {
        setAccessToken(null)
      } finally {
        signOutClearRef.current = false
      }
    }
    try {
      await request
    } finally {
      try {
        if (ownsCurrentSession()) {
          if (ownsCurrentSession() && getAccessToken() !== null) {
            // Notifying an already-cleared token would re-enter the account
            // reset from the token listener.
            setAccessToken(null)
          }
          if (ownsCurrentSession()) await resetAccountState()
        }
      } finally {
        signOutInFlightRef.current = false
      }
    }
  }, [resetAccountState])

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
      const loginSessionBoundary = getLoginSessionBoundary()
      const currentToken = getAccessToken()
      const restoreGeneration = generation
      const isCurrent = captureAccessSessionGuard()
      try {
        if (currentToken) {
          await refreshUser({ skipRefresh })
          if (
            restoreGeneration !== generation ||
            !isLoginSessionCurrent(loginSessionBoundary)
          ) {
            return
          }
        } else {
          const session = await refreshSession()
          if (
            restoreGeneration !== generation ||
            !isLoginSessionCurrent(loginSessionBoundary)
          ) {
            return
          }
          // The client normally publishes the rotated token itself, which the
          // token listener verifies. Only an unpublished session is applied and
          // verified here, and it must belong to the same login.
          if (getAccessToken() !== session.access_token) {
            if (!(await applySessionCredentials(session, loginSessionBoundary))) return
          }
          if (
            restoreGeneration !== generation ||
            !isLoginSessionCurrent(loginSessionBoundary)
          ) {
            return
          }
        }
      } catch (error) {
        if (restoreGeneration !== generation || !isCurrent()) return
        if (!isLoginSessionCurrent(loginSessionBoundary)) return

        if (isDefinitiveAuthenticationError(error)) {
          setAccessToken(null)
          await resetAccountState()
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

    const unsubscribe = subscribeToAccessToken((nextToken, reason) => {
      if (nextToken && nextToken === token) return
      const previousIdentity = readAccessTokenIdentity(token)
      token = nextToken
      cancelRestore()
      if (!nextToken) {
        if (signOutClearRef.current) {
          // The sign-out intent already invalidated this login; avoid advancing
          // the boundary twice for the same clear.
          return
        }
        // A definitive clear while a verified session is live ends it. A
        // "storage" clear only synchronizes an empty localStorage read, so it is
        // not a verified session ending and must not advance the boundary. An
        // in-flight sign-out also owns its ending login while its view is held
        // in the loading state.
        if (
          reason === "session" &&
          (statusRef.current === "authenticated" || signOutInFlightRef.current)
        ) {
          beginLoginSession("sign-out")
        }
        void resetAccountState()
        return
      }
      if (nextToken === acceptingToken.current) return
      // A verified account is discarded when the previous token identified it
      // and the new token does not. An opaque rotation of an opaque session
      // cannot establish a different account, so it keeps the verified view.
      if (
        verifiedUser.current &&
        previousIdentity &&
        !matchesAccount(verifiedUser.current, readAccessTokenIdentity(nextToken))
      ) {
        clearAccount()
        setStatus("loading")
      }
      if (!verifiedUser.current) setStatus("loading")
      void restoreSession(true)
    })
    void restoreSession(false)
    return () => {
      unsubscribe()
      cancelRestore()
    }
  }, [
    applySessionCredentials,
    bootstrapInitialized,
    clearAccount,
    refreshUser,
    resetAccountState,
  ])

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
