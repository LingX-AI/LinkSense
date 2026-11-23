import { CloudOffIcon } from "lucide-react"
import { useEffect, useLayoutEffect, useRef, useState } from "react"
import { Navigate, Outlet, useLocation, useNavigate } from "react-router-dom"
import { useTranslation } from "react-i18next"

import {
  desktopNotificationRouteForUser,
  isMacDesktopHost,
  subscribeDesktopConversationNavigation,
  subscribeDesktopNavigation,
  subscribeDesktopNotificationClick,
  updateDesktopConversationContext,
} from "@/adapters/desktop/desktop-adapter"
import { type User, type BootstrapStatus } from "@/api/contracts"
import { useAuth, type AuthContextValue } from "@/app/auth-state"
import { useBootstrap } from "@/app/bootstrap-state"
import { rememberBrowserUseLoginReturn } from "@/app/external-login-destination"
import { hasMaintenanceAdminEntry } from "@/app/maintenance-admin-entry"
import { useProductName } from "@/app/product-branding"
import { ProductLogo } from "@/components/brand/product-logo"
import { LoadingState } from "@/components/feedback/page-state"
import { Button } from "@/components/ui/button"
import { MaintenancePage } from "@/pages/maintenance-page"
import { MaintenanceIndicator } from "@/components/shell/maintenance-indicator"
import { MaintenanceNoticeDialog } from "@/components/shell/maintenance-notice-dialog"
import { KnowledgeUploadSessionProvider } from "@/features/knowledge-bases/knowledge-upload-session-provider"
import { ApiError } from "@/api/client"
import { getErrorMessage } from "@/api/error-message"
import { browserExtensionSettingsPath } from "@/features/browser-use/settings-path"
import { desktopLoginReturn } from "@/features/desktop-login/return-destination"

const maintenanceAdminAuthPaths = new Set([
  "/login",
  "/forgot-password",
  "/reset-password",
  "/auth/oidc/callback",
  "/auth/saml/callback",
  "/auth/social/callback",
])

// These locations may redirect as soon as auth/bootstrap settles. Let their
// own navigation commit before consuming a launch link so it cannot be
// overwritten, while stable signed-in public pages remain eligible.
const conversationRedirectPaths = new Set([
  "/",
  "/initialize",
  "/login",
  "/register",
  "/register/activate",
  "/auth/oidc/callback",
  "/auth/saml/callback",
  "/auth/social/callback",
])

// A launch link must stay pending while the app cannot show a protected
// conversation. The stable subscription lives above ProtectedRoute so it also
// covers maintenance, setup, and signed-in public pages such as the password
// setup page reached from Settings.
function useDesktopConversationNavigation({
  status,
  user,
  bootstrap,
  pathname,
}: {
  status: AuthContextValue["status"]
  user: User | null
  bootstrap: BootstrapStatus | undefined
  pathname: string
}): void {
  const navigate = useNavigate()
  const currentPathname = useRef(pathname)
  useLayoutEffect(() => {
    currentPathname.current = pathname
  }, [pathname])

  const ownerId = user?.id ?? null
  const ready =
    status === "authenticated" &&
    user !== null &&
    bootstrap?.initialized === true &&
    !(bootstrap.maintenance?.active && user.role !== "admin") &&
    !conversationRedirectPaths.has(pathname)

  useEffect(() => {
    updateDesktopConversationContext({
      authenticated: status === "authenticated",
      ownerId,
      ready,
    })
  }, [ownerId, ready, status])

  useEffect(
    () =>
      subscribeDesktopConversationNavigation((path) => {
        if (path === currentPathname.current) return
        void Promise.resolve(navigate(path)).catch(() => {
          console.error("DESKTOP_NAVIGATION_UNAVAILABLE")
        })
      }),
    [navigate]
  )
}

export function BootstrapGate() {
  const { t } = useTranslation()
  const productName = useProductName()
  const { bootstrap, isLoading, error, refetch } = useBootstrap()
  const { status, user } = useAuth()
  const location = useLocation()
  useDesktopConversationNavigation({
    status,
    user,
    bootstrap,
    pathname: location.pathname,
  })
  const content = (
    <>
      <Outlet />
      <MaintenanceNoticeDialog />
    </>
  )

  if (isLoading) return <LoadingState fullScreen />
  // A failed background check must not unmount an already initialized page.
  // TanStack Query retains the last successful status while polling recovers.
  if (!bootstrap) {
    return (
      <PublicFailureScreen
        title={t("bootstrap.unavailableTitle", { productName })}
        message={
          error instanceof ApiError &&
          error.errorCode === "DESKTOP_UPDATE_REQUIRED"
            ? getErrorMessage(error, t, { productName })
            : t("bootstrap.unavailableDescription", { productName })
        }
        onRetry={refetch}
      />
    )
  }

  if (!bootstrap.initialized && location.pathname !== "/initialize") {
    return <Navigate to="/initialize" replace />
  }
  if (bootstrap.initialized && location.pathname === "/initialize") {
    return <Navigate to="/conversations/new" replace />
  }
  if (bootstrap.maintenance?.active) {
    const isAdmin = status === "authenticated" && user?.role === "admin"
    const isAdminEntryRoute =
      maintenanceAdminAuthPaths.has(location.pathname) &&
      hasMaintenanceAdminEntry()

    if (isAdmin || isAdminEntryRoute) return content
    if (status === "loading") return <LoadingState fullScreen />
    return <MaintenancePage maintenance={bootstrap.maintenance} />
  }
  return content
}

export function ProtectedRoute() {
  const { status, user } = useAuth()
  const { bootstrap } = useBootstrap()
  const location = useLocation()
  const navigate = useNavigate()
  useEffect(() => {
    if (status !== "authenticated") return
    // Menu actions stay live-only: they are delivered only while their
    // protected route owns the listener. Conversation links use the stable
    // BootstrapGate subscription so signed-in public pages can consume them.
    return subscribeDesktopNavigation((path) => {
      if (path === location.pathname) return
      void Promise.resolve(navigate(path)).catch(() => {
        console.error("DESKTOP_NAVIGATION_UNAVAILABLE")
      })
    })
  }, [status, navigate, location.pathname])
  useEffect(() => {
    // Let the index redirect settle before consuming an app-launch click.
    if (status !== "authenticated" || !user || location.pathname === "/") return
    return subscribeDesktopNotificationClick((target) => {
      const path = desktopNotificationRouteForUser(target, user.id)
      if (!path || path === location.pathname) return
      void Promise.resolve(navigate(path)).catch(() => {
        console.error("DESKTOP_NOTIFICATION_NAVIGATION_UNAVAILABLE")
      })
    })
  }, [status, user, navigate, location.pathname])
  const [destinationUserId, setDestinationUserId] = useState(user?.id)
  if (status === "authenticated" && user?.id && destinationUserId !== user.id) {
    setDestinationUserId(user.id)
  }
  if (status === "loading") return <LoadingState fullScreen />
  if (status === "error") return <SessionRestoreError />
  if (status === "anonymous") {
    const from =
      `${location.pathname}${location.hash}` === browserExtensionSettingsPath
        ? browserExtensionSettingsPath
        : location.pathname
    return (
      <Navigate
        to="/login"
        replace
        state={{ from, fromUserId: destinationUserId }}
      />
    )
  }
  if (bootstrap?.maintenance?.active && user?.role !== "admin") {
    return <MaintenancePage maintenance={bootstrap.maintenance} />
  }
  return (
    <KnowledgeUploadSessionProvider key={user?.id}>
      <Outlet />
      <MaintenanceIndicator />
    </KnowledgeUploadSessionProvider>
  )
}

export function PublicAuthRoute() {
  const { status } = useAuth()
  const location = useLocation()

  useEffect(() => {
    if (
      location.pathname !== "/login" ||
      (status !== "anonymous" && status !== "authenticated")
    )
      return
    rememberBrowserUseLoginReturn(
      status === "anonymous" ? location.state : null
    )
  }, [location.pathname, location.state, status])

  if (status === "loading") return <LoadingState fullScreen />
  if (status === "error") return <SessionRestoreError />
  if (status === "authenticated") {
    return <AuthenticatedRedirect state={location.state} />
  }
  return <Outlet />
}

function SessionRestoreError() {
  const { t } = useTranslation()
  const productName = useProductName()
  const { retryRestore } = useAuth()

  // Only the Mac host keeps a pending launch intent in this document. Web,
  // Windows, and an unresolved platform retain the reload fallback.
  const onRetry =
    retryRestore && isMacDesktopHost()
      ? retryRestore
      : () => window.location.reload()

  return (
    <PublicFailureScreen
      title={t("bootstrap.unavailableTitle", { productName })}
      message={t("auth.sessionRestoreFailed")}
      onRetry={onRetry}
    />
  )
}

// Full-screen failure page for states reached before the app shell exists,
// mirroring the maintenance screen's centered, branded layout.
function PublicFailureScreen({
  title,
  message,
  onRetry,
}: {
  title: string
  message: string
  onRetry: () => void
}) {
  const { t } = useTranslation()
  const productName = useProductName()

  return (
    <main
      data-slot="public-failure-screen"
      className="flex h-svh flex-col overflow-y-auto bg-[var(--app-canvas)] px-5 py-10"
    >
      <section className="my-auto w-full max-w-md shrink-0 self-center px-2 py-8 text-center sm:px-8">
        <ProductLogo
          productName={productName}
          className="maintenance-brand-logo"
        />
        <div
          aria-hidden="true"
          className="mx-auto mt-8 flex size-12 items-center justify-center rounded-full bg-destructive/10 text-destructive-text"
        >
          <CloudOffIcon className="size-6" />
        </div>
        <h1 className="mt-4 text-xl font-semibold tracking-tight wrap-anywhere">
          {title}
        </h1>
        <p
          className="mt-2.5 text-sm leading-6 wrap-anywhere text-muted-foreground"
          role="alert"
        >
          {message}
        </p>
        <Button type="button" className="mt-6 min-w-24" onClick={onRetry}>
          {t("common.retry")}
        </Button>
      </section>
    </main>
  )
}

export function AdminRoute() {
  const { user } = useAuth()
  if (user?.role !== "admin" || user.status !== "active") {
    return <Navigate to="/conversations/new" replace />
  }
  return <Outlet />
}

function AuthenticatedRedirect({ state }: { state: unknown }) {
  const { user } = useAuth()
  const navigate = useNavigate()
  const destination = resolveAuthenticatedDestination(state, user?.id)

  useEffect(() => {
    navigate(destination, { replace: true })
  }, [destination, navigate])

  return <LoadingState fullScreen />
}

function resolveAuthenticatedDestination(
  state: unknown,
  userId: string | undefined
): string {
  const fallback = desktopLoginReturn() ?? "/conversations/new"
  if (
    typeof state !== "object" ||
    state === null ||
    !("from" in state) ||
    typeof state.from !== "string" ||
    !state.from.startsWith("/") ||
    state.from.startsWith("//")
  ) {
    return fallback
  }

  // A saved task address belongs to the account that was viewing it.
  if (
    "fromUserId" in state &&
    state.fromUserId !== undefined &&
    state.fromUserId !== userId
  ) {
    return fallback
  }
  const source = new URL(window.location.href)
  const destination = new URL(state.from, source)
  if (
    destination.protocol !== source.protocol ||
    destination.host !== source.host ||
    destination.pathname.startsWith("/api/") ||
    [
      "/login",
      "/initialize",
      "/forgot-password",
      "/reset-password",
      "/auth/oidc/callback",
      "/auth/saml/callback",
      "/auth/social/callback",
      "/register",
      "/register/activate",
    ].includes(destination.pathname)
  ) {
    return fallback
  }
  return `${destination.pathname}${destination.search}${destination.hash}`
}
