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
import {
  clearDesktopSession,
  isDesktopHost,
  isMacDesktopHost,
} from "@/adapters/desktop/desktop-adapter"
import { ensureDesktopDeviceForAuthRestore } from "@/adapters/desktop/desktop-device-adapter"
import type { MacSignOutOptions } from "@/adapters/desktop/mygo"

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
  // Explicit Retry increments this revision so the same bounded restore effect
  // runs again without reloading the document that holds a pending launch link.
  const [restoreRevision, setRestoreRevision] = useState(0)
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
  // A Mac sign-out owns the session until its logout request and native
  // ClearSession both settle. The ref is synchronous so a late clear or a
  // login acceptance in the same turn cannot expose the login early.
  const signOutPendingRef = useRef(false)
  // A browser sign-out clears its bearer immediately; that clear belongs to the
  // sign-out intent rather than to a second login replacement.
  const signOutClearRef = useRef(false)
  // An in-flight sign-out still owns the ending login, so a definitive clear
  // during it must invalidate admitted work for that same login.
  const signOutInFlightRef = useRef(false)
  const resumedDesktopOwnerRef = useRef<string | null>(null)
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

  const retryRestore = useCallback(() => {
    // The status guard consumes one click and prevents a parallel restore.
    if (status !== "error") return
    setStatus("loading")
    setRestoreRevision((revision) => revision + 1)
  }, [status])

  const refreshUser = useCallback(
    async (
      options: {
        signal?: AbortSignal
        preferredLanguage?: SupportedLanguage | null
        skipRefresh?: boolean
      } = {}
    ) => {
      // A Mac sign-out owns the boundary until logout and native cleanup
      // settle. A Settings mutation that completes during either hold must not
      // start a /me with the outgoing bearer, or its profile could reopen the
      // protected routes while cleanup is still running.
      if (signOutPendingRef.current) return
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
      // A Mac sign-out owns the boundary until logout and native cleanup
      // settle. A late acceptance from the ending login must not reopen the
      // protected routes or advance past that cleanup.
      if (signOutPendingRef.current) return
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

  const signOut = useCallback(
    async (options?: MacSignOutOptions) => {
      // The Mac's first sign-out owns the session until its logout request and
      // native ClearSession both settle. A concurrent invocation must not
      // advance the boundary, send a second logout, or enter ClearSession again:
      // its earlier completion would release the login while native cleanup is
      // still running.
      const closesLocally = isMacDesktopHost()
      if (closesLocally && signOutPendingRef.current) return
      const signedOutToken = getAccessToken()
      // Sign-out intent invalidates admitted work immediately, before the logout
      // request or native cleanup can pause. A later explicit login advances the
      // boundary again, so this older flow must not clear its credentials.
      const loginSessionBoundary = beginLoginSession("sign-out")
      // A definitive token clear during the logout request ends this same login,
      // so native cleanup still belongs to it. Only an explicitly accepted
      // replacement makes the native session belong to someone else.
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
      // The Mac keeps the protected view and the login control closed until the
      // logout request and native ClearSession both settle. Closing happens in
      // the same turn as the intent so menu navigation that was already
      // delivered cannot admit a new task.
      if (closesLocally) {
        signOutPendingRef.current = true
        void resetAccountState("loading")
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
        if (closesLocally) signOutPendingRef.current = false
        throw error
      }
      if (
        !closesLocally &&
        signedOutToken &&
        isLoginSessionCurrent(loginSessionBoundary)
      ) {
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
            try {
              await clearDesktopSession(options)
            } finally {
              if (ownsCurrentSession() && getAccessToken() !== null) {
                // Notifying an already-cleared token would re-enter the account
                // reset from the token listener.
                setAccessToken(null)
              }
              if (ownsCurrentSession()) await resetAccountState()
            }
          }
        } finally {
          signOutInFlightRef.current = false
          if (closesLocally) signOutPendingRef.current = false
        }
      }
    },
    [resetAccountState]
  )

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
          // The native desktop host does not react to a published token, so
          // finish the restore here instead of waiting for the listener.
          if (isDesktopHost()) await refreshUser({ skipRefresh })
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
      // The native desktop host owns credential writes, so a published token
      // is applied by acceptSession or restoreSession rather than here.
      if (nextToken && isDesktopHost()) return
      const previousIdentity = readAccessTokenIdentity(token)
      token = nextToken
      cancelRestore()
      if (!nextToken) {
        if (signOutClearRef.current) {
          // The sign-out intent already invalidated this login; avoid advancing
          // the boundary twice for the same clear.
          return
        }
        // A Mac sign-out owns the closed view until its logout request and
        // native cleanup settle; the sign-out flow resets the account itself.
        if (signOutPendingRef.current) return
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
    restoreRevision,
  ])

  // Register and connect this Mac only after a verified Web session names the
  // owner. The native host fences the owner and sign-out again; there is no
  // pairing action. A transient network failure retries until the account or
  // route changes, without blocking the UI.
  useEffect(() => {
    if (status !== "authenticated" || !user?.id) {
      resumedDesktopOwnerRef.current = null
      return
    }
    if (resumedDesktopOwnerRef.current === user.id) return
    let retry: number | undefined
    let cancelled = false
    let attempts = 0
    const ensure = () => {
      resumedDesktopOwnerRef.current = user.id
      void ensureDesktopDeviceForAuthRestore(user.id).catch((error: unknown) => {
        if (cancelled || resumedDesktopOwnerRef.current !== user.id) return
        resumedDesktopOwnerRef.current = null
        if (
          attempts >= 2 ||
          (error instanceof Error &&
            ["FORBIDDEN", "VALIDATION_ERROR", "AUTH_REQUIRED"].includes(
              error.message
            ))
        )
          return
        attempts += 1
        retry = window.setTimeout(() => {
          if (!cancelled) ensure()
        }, 10_000 * attempts)
      })
    }
    ensure()
    return () => {
      cancelled = true
      if (retry !== undefined) window.clearTimeout(retry)
    }
  }, [status, user?.id])

  const effectiveStatus =
    bootstrap && !bootstrap.initialized ? "anonymous" : status
  const value = useMemo<AuthContextValue>(
    () => ({
      status: effectiveStatus,
      user,
      acceptSession,
      refreshUser,
      retryRestore,
      signOut,
    }),
    [acceptSession, effectiveStatus, refreshUser, retryRestore, signOut, user]
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
