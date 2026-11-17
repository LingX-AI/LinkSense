import { useEffect, useRef, useState } from "react"
import { useMutation } from "@tanstack/react-query"
import { useTranslation } from "react-i18next"
import { Navigate, useLocation } from "react-router-dom"
import { desktopLoginCodeSchema } from "@linksense/shared"

import { Desktop } from "@/adapters/desktop/mygo"
import { isDesktopHost } from "@/adapters/desktop/desktop-adapter"
import { apiRequest, refreshSession } from "@/api/client"
import { getErrorMessage } from "@/api/error-message"
import { useAuth } from "@/app/auth-state"
import {
  AccountAccessHeading,
  AccountAccessLayout,
} from "@/components/auth/account-access-layout"
import { LoadingState } from "@/components/feedback/page-state"
import { StatusBanner } from "@/components/feedback/status-banner"
import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import {
  clearDesktopLoginReturn,
  readDesktopLoginRequest,
  rememberDesktopLoginReturn,
} from "./return-destination"

export function DesktopSignInPage() {
  const { t } = useTranslation()
  const { acceptSession, signOut } = useAuth()
  const cancelled = useRef(false)
  const attempt = useRef<Promise<void> | null>(null)
  const [pending, setPending] = useState(false)
  const [cancelling, setCancelling] = useState(false)
  const [error, setError] = useState(false)
  useEffect(
    () => () => {
      cancelled.current = true
      void Desktop.cancelSignIn().catch(() => undefined)
    },
    []
  )

  const signIn = async () => {
    cancelled.current = false
    setError(false)
    setPending(true)
    try {
      await Desktop.signIn()
      if (cancelled.current) return
      const session = await refreshSession()
      if (!cancelled.current) await acceptSession(session)
    } catch {
      if (!cancelled.current) setError(true)
    } finally {
      setPending(false)
    }
  }

  return (
    <AccountAccessLayout>
      <AccountAccessHeading
        title={t("desktopLogin.title")}
        description={t("desktopLogin.description")}
      />
      {error && (
        <StatusBanner variant="error">{t("desktopLogin.failed")}</StatusBanner>
      )}
      {pending && (
        <p role="status" className="text-sm text-muted-foreground">
          {t("desktopLogin.waiting")}
        </p>
      )}
      <Button
        data-desktop-sign-in
        size="lg"
        disabled={pending || cancelling}
        onClick={() => {
          attempt.current = signIn()
        }}
      >
        {pending && <Spinner data-icon="inline-start" />}
        {t("desktopLogin.openBrowser")}
      </Button>
      {pending && (
        <Button
          variant="secondary"
          disabled={cancelling}
          onClick={async () => {
            cancelled.current = true
            setCancelling(true)
            try {
              await Desktop.cancelSignIn()
              await attempt.current
              await signOut()
            } catch {
              setError(true)
            } finally {
              setCancelling(false)
            }
          }}
        >
          {t("common.cancel")}
        </Button>
      )}
    </AccountAccessLayout>
  )
}

export function DesktopAuthorizePage() {
  const { t } = useTranslation()
  const location = useLocation()
  const { status } = useAuth()
  const request = readDesktopLoginRequest(location.search)
  const attempted = useRef(false)
  const authorize = useMutation({
    mutationFn: async () => {
      if (!request || isDesktopHost())
        throw new Error("DESKTOP_LOGIN_REQUEST_INVALID")
      const { code } = await apiRequest("/auth/desktop/authorize", {
        method: "POST",
        body: request,
        schema: desktopLoginCodeSchema,
      })
      const callback = new URL(request.redirect_uri)
      callback.searchParams.set("code", code)
      callback.searchParams.set("state", request.state)
      return callback.href
    },
    onSuccess: (callback) => {
      clearDesktopLoginReturn()
      try {
        window.location.replace(callback)
      } catch {
        // The link remains available when the browser blocks automatic app launch.
      }
    },
  })
  const { mutate } = authorize
  useEffect(() => {
    if (!request || isDesktopHost()) return
    if (status === "anonymous") rememberDesktopLoginReturn(location.search)
    if (status === "authenticated" && !attempted.current) {
      attempted.current = true
      mutate()
    }
  }, [request, location.search, status, mutate])

  if (request && !isDesktopHost() && status === "anonymous") {
    return (
      <Navigate
        to="/login"
        replace
        state={{ from: `${location.pathname}${location.search}` }}
      />
    )
  }
  if (status === "loading") return <LoadingState fullScreen />
  return (
    <AccountAccessLayout>
      <meta name="referrer" content="no-referrer" />
      <AccountAccessHeading
        title={t("desktopLogin.authorizing")}
        description={t(
          authorize.data
            ? "desktopLogin.browserConfirmed"
            : "desktopLogin.authorizeDescription"
        )}
      />
      {!request || isDesktopHost() ? (
        <StatusBanner variant="error">{t("desktopLogin.invalid")}</StatusBanner>
      ) : status === "error" ? (
        <StatusBanner
          variant="error"
          actions={
            <Button onClick={() => window.location.reload()}>
              {t("common.retry")}
            </Button>
          }
        >
          {t("auth.sessionRestoreFailed")}
        </StatusBanner>
      ) : authorize.error ? (
        <StatusBanner
          variant="error"
          actions={
            <Button onClick={() => mutate()}>{t("common.retry")}</Button>
          }
        >
          {getErrorMessage(authorize.error, t)}
        </StatusBanner>
      ) : authorize.data ? (
        <a
          className="public-link"
          href={authorize.data}
          referrerPolicy="no-referrer"
        >
          {t("desktopLogin.returnToApp")}
        </a>
      ) : (
        <Spinner className="mx-auto" />
      )}
    </AccountAccessLayout>
  )
}
