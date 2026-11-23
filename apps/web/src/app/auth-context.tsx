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
  beginLoginSession,
  getAccessToken,
  getLoginSessionBoundary,
  isLoginSessionCurrent,
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
  isMacDesktopHost,
} from "@/adapters/desktop/desktop-adapter"
import { resumeDesktopDeviceForAuthRestore } from "@/adapters/desktop/desktop-device-adapter"
import type { MacSignOutOptions } from "@/adapters/desktop/mygo"

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
  // Explicit Retry increments this revision so the same bounded restore effect
  // runs again without reloading the document that holds a pending launch link.
  const [restoreRevision, setRestoreRevision] = useState(0)
  // Explicitly accepted replacement logins are recorded independently of the
  // token so a definitive clear can be distinguished from a new login.
  const lastAcceptedLoginRef = useRef<LoginSessionBoundary | null>(null)
  // A Mac sign-out owns the session until its logout request and native
  // ClearSession both settle. The ref is synchronous so a late clear or a
  // login acceptance in the same turn cannot expose the login early.
  const signOutPendingRef = useRef(false)
  const resumedDesktopOwnerRef = useRef<string | null>(null)

  const resetAccountState = useCallback(
    async (nextStatus: "anonymous" | "loading" = "anonymous") => {
      // Removal is synchronous: QueryCache.remove destroys each matched query
      // and cancels its retryer in the same turn, aborting in-flight account
      // reads. A replacement login accepted afterwards therefore cannot see, or
      // later repopulate, the ended account's cache. Only bootstrap (which is
      // not account-scoped) survives.
      queryClient.removeQueries({ predicate: isAccountScopedQuery })
      queryClient.getMutationCache().clear()
      setUser(null)
      setStatus(nextStatus)
    },
    [queryClient]
  )

  const retryRestore = useCallback(() => {
    // The status guard consumes one click and prevents a parallel restore.
    if (status !== "error") return
    setStatus("loading")
    setRestoreRevision((revision) => revision + 1)
  }, [status])

  const refreshUser = useCallback(
    async (options?: { signal?: AbortSignal }) => {
      // A Mac sign-out owns the boundary until logout and native cleanup
      // settle. A Settings mutation that completes during either hold must not
      // start a /me with the outgoing bearer, or its profile could reopen the
      // protected routes while cleanup is still running.
      if (signOutPendingRef.current) return
      const loginSessionBoundary = getLoginSessionBoundary()
      const nextUser = await apiRequest("/me", {
        schema: userSchema,
        signal: options?.signal,
        loginSessionBoundary,
      })
      if (
        options?.signal?.aborted ||
        !isLoginSessionCurrent(loginSessionBoundary)
      )
        return
      if (nextUser.language) await setAppLanguage(nextUser.language)
      if (
        options?.signal?.aborted ||
        !isLoginSessionCurrent(loginSessionBoundary)
      )
        return
      setUser((currentUser) => replaceEqualDeep(currentUser, nextUser))
      setStatus("authenticated")
    },
    []
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
      const loginSessionBoundary = beginLoginSession()
      lastAcceptedLoginRef.current = loginSessionBoundary
      if (!(await applySessionCredentials(session, loginSessionBoundary)))
        return
      await refreshUser()
    },
    [applySessionCredentials, refreshUser]
  )

  const signOut = useCallback(async (options?: MacSignOutOptions) => {
    // The Mac's first sign-out owns the session until its logout request and
    // native ClearSession both settle. A concurrent invocation must not
    // advance the boundary, send a second logout, or enter ClearSession again:
    // its earlier completion would release the login while native cleanup is
    // still running.
    const closesLocally = isMacDesktopHost()
    if (closesLocally && signOutPendingRef.current) return
    // Sign-out intent invalidates admitted work immediately, before the logout
    // request or native cleanup can pause. A later explicit login advances the
    // boundary again, so this older flow must not clear its credentials.
    const loginSessionBoundary = beginLoginSession()
    // A definitive token clear during the logout request ends this same login,
    // so native cleanup still belongs to it. Only an explicitly accepted
    // replacement makes the native session belong to someone else.
    const replacementAccepted = () => {
      const acceptedBoundary = lastAcceptedLoginRef.current
      return (
        acceptedBoundary !== null && acceptedBoundary > loginSessionBoundary
      )
    }
    // The Mac keeps the protected view and the login control closed until the
    // logout request and native ClearSession both settle. Closing happens in
    // the same turn as the intent so menu navigation that was already
    // delivered cannot admit a new task.
    if (closesLocally) {
      signOutPendingRef.current = true
      void resetAccountState("loading")
    }
    try {
      await apiRequest("/auth/logout", {
        method: "POST",
        schema: z.unknown(),
        skipRefresh: true,
        loginSessionBoundary,
      })
    } finally {
      try {
        if (!replacementAccepted()) {
          try {
            await clearDesktopSession(options)
          } finally {
            if (!replacementAccepted()) {
              // Notifying an already-cleared token would re-enter the account
              // reset from the token listener.
              if (getAccessToken() !== null) setAccessToken(null)
              await resetAccountState()
            }
          }
        }
      } finally {
        if (closesLocally) signOutPendingRef.current = false
      }
    }
  }, [resetAccountState])

  useEffect(() => {
    if (bootstrapInitialized !== true) return

    let cancelled = false
    let retryTimer: number | null = null
    let attempt = 0
    const loginSessionBoundary = getLoginSessionBoundary()
    const restoreSession = async () => {
      if (!isLoginSessionCurrent(loginSessionBoundary)) return
      attempt += 1
      try {
        if (getAccessToken()) {
          await refreshUser()
          if (!isLoginSessionCurrent(loginSessionBoundary)) return
        } else {
          const session = await refreshSession()
          if (cancelled || !isLoginSessionCurrent(loginSessionBoundary)) return
          if (!(await applySessionCredentials(session, loginSessionBoundary)))
            return
          if (cancelled || !isLoginSessionCurrent(loginSessionBoundary)) return
          await refreshUser()
          if (cancelled || !isLoginSessionCurrent(loginSessionBoundary)) return
        }
      } catch (error) {
        if (cancelled || !isLoginSessionCurrent(loginSessionBoundary)) return

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
  }, [
    applySessionCredentials,
    bootstrapInitialized,
    refreshUser,
    resetAccountState,
    restoreRevision,
  ])

  useEffect(
    () =>
      subscribeToAccessToken((token, reason) => {
        if (token || status !== "authenticated") return
        // A Mac sign-out owns the transition until logout and ClearSession
        // settle; a definitive clear must not expose the login early.
        if (signOutPendingRef.current) return
        // A "storage" clear only synchronizes an empty localStorage read and is
        // not a verified session ending. Silent access expiry never notifies,
        // and rotation carries a token. An explicit clear while a verified
        // session is live means a definitive refresh rejection or sign-out
        // ended it. Advance the boundary before the synchronous reset so
        // admitted Mac work whose response arrives later is already stale.
        if (reason === "session") beginLoginSession()
        void resetAccountState()
      }),
    [resetAccountState, status]
  )

  // Resume the Mac's stored device credential only after a verified Web
  // session names the owner. The native host fences the owner and sign-out
  // again; this never pairs a device or retries beyond one native call.
  useEffect(() => {
    if (status !== "authenticated" || !user?.id) {
      resumedDesktopOwnerRef.current = null
      return
    }
    if (resumedDesktopOwnerRef.current === user.id) return
    resumedDesktopOwnerRef.current = user.id
    void resumeDesktopDeviceForAuthRestore(user.id).catch(() => {
      if (resumedDesktopOwnerRef.current === user.id) {
        resumedDesktopOwnerRef.current = null
      }
    })
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
