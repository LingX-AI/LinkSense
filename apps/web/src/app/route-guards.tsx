import { useEffect, useState } from "react"
import { Navigate, Outlet, useLocation, useNavigate } from "react-router-dom"
import { useTranslation } from "react-i18next"

import { useAuth } from "@/app/auth-state"
import { useBootstrap } from "@/app/bootstrap-state"
import { hasMaintenanceAdminEntry } from "@/app/maintenance-admin-entry"
import { useProductName } from "@/app/product-branding"
import { ErrorState, LoadingState } from "@/components/feedback/page-state"
import { MaintenancePage } from "@/pages/maintenance-page"
import { MaintenanceIndicator } from "@/components/shell/maintenance-indicator"
import { MaintenanceNoticeDialog } from "@/components/shell/maintenance-notice-dialog"

const maintenanceAdminAuthPaths = new Set([
  "/login",
  "/forgot-password",
  "/reset-password",
  "/auth/oidc/callback",
  "/auth/saml/callback",
  "/auth/social/callback",
])

export function BootstrapGate() {
  const { t } = useTranslation()
  const productName = useProductName()
  const { bootstrap, isLoading, refetch } = useBootstrap()
  const { status, user } = useAuth()
  const location = useLocation()
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
      <div className="public-shell">
        <div className="public-panel">
          <h1>{t("bootstrap.unavailableTitle", { productName })}</h1>
          <ErrorState
            message={t("bootstrap.unavailableDescription", { productName })}
            onRetry={refetch}
          />
        </div>
      </div>
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
  const [destinationUserId, setDestinationUserId] = useState(user?.id)
  if (status === "authenticated" && user?.id && destinationUserId !== user.id) {
    setDestinationUserId(user.id)
  }
  if (status === "loading") return <LoadingState fullScreen />
  if (status === "error") return <SessionRestoreError />
  if (status === "anonymous") {
    return (
      <Navigate
        to="/login"
        replace
        state={{ from: location.pathname, fromUserId: destinationUserId }}
      />
    )
  }
  if (bootstrap?.maintenance?.active && user?.role !== "admin") {
    return <MaintenancePage maintenance={bootstrap.maintenance} />
  }
  return (
    <>
      <Outlet />
      <MaintenanceIndicator />
    </>
  )
}

export function PublicAuthRoute() {
  const { status } = useAuth()
  const location = useLocation()

  if (status === "loading") return <LoadingState fullScreen />
  if (status === "error") return <SessionRestoreError />
  if (status === "authenticated") {
    return <AuthenticatedRedirect state={location.state} />
  }
  return <Outlet />
}

function SessionRestoreError() {
  const { t } = useTranslation()

  return (
    <div className="public-shell">
      <div className="public-panel">
        <ErrorState
          message={t("auth.sessionRestoreFailed")}
          onRetry={() => window.location.reload()}
        />
      </div>
    </div>
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
  const fallback = "/conversations/new"
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

  const destination = new URL(state.from, window.location.origin)
  if (
    destination.origin !== window.location.origin ||
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
