import { useTranslation } from "react-i18next"
import { Link } from "react-router-dom"

import { useAuth } from "@/app/auth-state"
import { useBootstrap } from "@/app/bootstrap-state"

export function MaintenanceIndicator() {
  const { t } = useTranslation()
  const { status, user } = useAuth()
  const { bootstrap } = useBootstrap()

  if (
    status !== "authenticated" ||
    user?.role !== "admin" ||
    user.status !== "active" ||
    !bootstrap?.maintenance?.active
  ) {
    return null
  }

  return (
    <Link
      to="/admin/settings?section=maintenance"
      title={t("maintenance.openSettings")}
      className="fixed right-[max(1rem,var(--app-safe-area-right))] bottom-[max(1rem,var(--app-safe-area-bottom))] z-40 inline-flex min-h-8 max-w-[calc(100vw-2rem)] items-center px-3 py-1 text-sm leading-5 font-normal text-foreground/40 transition-colors hover:text-foreground/65 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:outline-none"
    >
      <span className="truncate">{t("maintenance.indicatorLabel")}</span>
    </Link>
  )
}
