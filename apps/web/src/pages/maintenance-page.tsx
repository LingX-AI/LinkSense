import { useState } from "react"
import { useTranslation } from "react-i18next"
import { useNavigate } from "react-router-dom"

import type { MaintenanceStatus } from "@/api/contracts"
import { useAuth } from "@/app/auth-state"
import { enableMaintenanceAdminEntry } from "@/app/maintenance-admin-entry"
import { MaintenanceScreen } from "@/components/feedback/maintenance-screen"
import { Button } from "@/components/ui/button"

export function MaintenancePage({
  maintenance,
}: {
  maintenance: MaintenanceStatus
}) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { signOut, status } = useAuth()
  const [openingAdminEntry, setOpeningAdminEntry] = useState(false)

  const openAdminEntry = async () => {
    setOpeningAdminEntry(true)
    enableMaintenanceAdminEntry()
    try {
      if (status === "authenticated") await signOut()
    } finally {
      navigate("/login", { state: { from: "/conversations/new" } })
    }
  }

  return (
    <MaintenanceScreen maintenance={maintenance}>
      <Button
        type="button"
        variant="ghost"
        size="xs"
        className="fixed right-4 bottom-4 h-7 border border-[color:var(--app-divider)] bg-[var(--app-canvas)] px-3 text-xs text-muted-foreground hover:bg-[var(--app-hover)] hover:text-foreground"
        disabled={openingAdminEntry}
        onClick={() => void openAdminEntry()}
      >
        {t("maintenance.adminEntry")}
      </Button>
    </MaintenanceScreen>
  )
}
