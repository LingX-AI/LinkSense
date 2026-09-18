import { useRef, useState } from "react"
import { InfoIcon, Settings2Icon, XIcon } from "lucide-react"
import { useTranslation } from "react-i18next"
import { useLocation, useNavigate } from "react-router-dom"
import { toast } from "sonner"

import { useAuth } from "@/app/auth-state"
import { useBootstrap } from "@/app/bootstrap-state"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { SystemNoticeDialogContent } from "./system-notice-dialog-content"
import { useClientUpdate } from "@/app/use-client-update"
import {
  rememberDismissedMaintenance,
  useDismissedMaintenance,
} from "./maintenance-notice-preference"
import { Dialog, DialogClose } from "@/components/ui/dialog"

export function MaintenanceNoticeDialog() {
  const clientUpdate = useClientUpdate()
  const { status, user } = useAuth()
  const { bootstrap } = useBootstrap()
  const location = useLocation()
  const pathname = location.pathname.replace(/\/+$/, "")
  const isMaintenanceSettingsPage =
    pathname === "/admin/settings" &&
    new URLSearchParams(location.search).get("section") === "maintenance"

  if (
    clientUpdate ||
    status !== "authenticated" ||
    user?.role !== "admin" ||
    user.status !== "active" ||
    !bootstrap?.maintenance?.active ||
    !bootstrap.maintenance_id ||
    pathname === "/login" ||
    isMaintenanceSettingsPage
  ) {
    return null
  }

  // Temporary closure belongs to a page entry. Persisted dismissal belongs to
  // the administrator and maintenance period, independent of polling or navigation.
  return (
    <MaintenanceNotice
      key={`${user.id}:${bootstrap.maintenance_id}:${location.key}`}
      userId={user.id}
      maintenanceId={bootstrap.maintenance_id}
      reason={bootstrap.maintenance.reason}
    />
  )
}

function MaintenanceNotice({
  reason,
  userId,
  maintenanceId,
}: {
  reason: string | null
  userId: string
  maintenanceId: string
}) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [open, setOpen] = useState(true)
  const dismissedMaintenance = useDismissedMaintenance(userId)
  const dismissButtonRef = useRef<HTMLButtonElement>(null)

  return (
    <Dialog
      open={open && dismissedMaintenance !== maintenanceId}
      onOpenChange={setOpen}
    >
      <SystemNoticeDialogContent
        initialFocus={dismissButtonRef}
        title={t("maintenance.dialogTitle")}
        description={t("maintenance.dialogDescription")}
        notice={
          reason?.trim() && (
            <Alert appearance="soft" role="note" className="w-full">
              <InfoIcon aria-hidden="true" />
              <AlertTitle>{t("maintenance.reasonLabel")}</AlertTitle>
              <AlertDescription className="min-w-0 wrap-anywhere whitespace-pre-wrap">
                {reason}
              </AlertDescription>
            </Alert>
          )
        }
        footer={
          <>
            <Button
              variant="ghost"
              size="lg"
              className="rounded-full"
              onClick={() => {
                setOpen(false)
                navigate("/admin/settings?section=maintenance")
              }}
            >
              <Settings2Icon data-icon="inline-start" aria-hidden="true" />
              {t("maintenance.openSettings")}
            </Button>
            <Button
              ref={dismissButtonRef}
              size="lg"
              className="min-w-32 rounded-full"
              onClick={() => {
                if (rememberDismissedMaintenance(userId, maintenanceId)) {
                  setOpen(false)
                } else {
                  toast.error(t("maintenance.rememberFailed"))
                }
              }}
            >
              {t("maintenance.doNotShowAgain")}
            </Button>
          </>
        }
        closeControl={
          <DialogClose
            render={
              <Button
                variant="ghost"
                size="icon"
                className="absolute top-4 right-4 rounded-full text-maintenance-hero-ink hover:bg-maintenance-hero-ink/15 hover:text-maintenance-hero-ink"
              />
            }
          >
            <XIcon />
            <span className="sr-only">{t("common.close")}</span>
          </DialogClose>
        }
      />
    </Dialog>
  )
}
