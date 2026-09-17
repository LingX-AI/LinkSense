import { useRef, useState } from "react"
import {
  InfoIcon,
  Settings2Icon,
  ShieldCheckIcon,
  WrenchIcon,
  XIcon,
} from "lucide-react"
import { useTranslation } from "react-i18next"
import { useLocation, useNavigate } from "react-router-dom"
import { toast } from "sonner"

import { useAuth } from "@/app/auth-state"
import { useBootstrap } from "@/app/bootstrap-state"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import {
  rememberDismissedMaintenance,
  useDismissedMaintenance,
} from "./maintenance-notice-preference"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"

export function MaintenanceNoticeDialog() {
  const { status, user } = useAuth()
  const { bootstrap } = useBootstrap()
  const location = useLocation()

  if (
    status !== "authenticated" ||
    user?.role !== "admin" ||
    user.status !== "active" ||
    !bootstrap?.maintenance?.active ||
    !bootstrap.maintenance_id ||
    location.pathname.replace(/\/+$/, "") === "/login"
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
      <DialogContent
        showCloseButton={false}
        initialFocus={dismissButtonRef}
        className="max-h-[calc(100dvh-2rem)] grid-rows-[minmax(0,1fr)_auto] gap-0 overflow-hidden p-0 sm:max-w-xl"
      >
        <div className="min-h-0 overflow-y-auto overscroll-contain">
          <div
            className="pointer-events-none relative isolate flex h-44 items-center justify-center overflow-hidden bg-warning/25 sm:h-56"
            aria-hidden="true"
          >
            <div className="absolute inset-0 bg-linear-to-br from-warning/10 via-warning/25 to-warning/50" />
            {/* Neutral light and shadow share a top-left source in both themes. */}
            <div className="absolute inset-0 bg-radial-[at_18%_0%] from-white/70 via-white/15 to-transparent to-70% dark:opacity-40" />
            <div className="absolute -top-1/2 -left-1/4 h-[180%] w-2/3 -rotate-35 bg-linear-to-r from-transparent via-white/35 to-transparent blur-xl dark:opacity-30" />
            <div className="absolute top-1/2 left-1/2 h-40 w-64 -translate-x-1/2 -translate-y-1/2 rounded-full bg-warning/30 blur-3xl sm:w-80" />
            <div className="absolute inset-0 bg-linear-to-br from-transparent via-transparent to-black/10" />
            <div className="relative flex size-24 items-center justify-center rounded-3xl bg-popover/95 text-foreground shadow-[12px_20px_32px_-10px] ring-1 shadow-black/25 ring-warning/30 before:pointer-events-none before:absolute before:inset-0 before:rounded-[inherit] before:inset-shadow-[1px_1px_0_0] before:inset-shadow-white/50 sm:size-28">
              <WrenchIcon className="size-12 sm:size-14" strokeWidth={1.5} />
              <div className="absolute -right-2 -bottom-2 flex size-9 items-center justify-center rounded-full bg-popover text-warning shadow-[4px_8px_12px_-4px] ring-4 shadow-black/20 ring-warning/20 sm:size-10">
                <ShieldCheckIcon className="size-4 sm:size-5" />
              </div>
            </div>
          </div>
          <div className="flex flex-col items-center gap-6 px-6 py-7 sm:px-10 sm:py-8">
            {reason?.trim() && (
              <Alert appearance="soft" role="note" className="w-full">
                <InfoIcon aria-hidden="true" />
                <AlertTitle>{t("maintenance.reasonLabel")}</AlertTitle>
                <AlertDescription className="min-w-0 wrap-anywhere whitespace-pre-wrap">
                  {reason}
                </AlertDescription>
              </Alert>
            )}
            <DialogHeader className="items-center gap-3 text-center">
              <DialogTitle className="text-xl leading-snug font-semibold tracking-tight sm:text-2xl">
                {t("maintenance.dialogTitle")}
              </DialogTitle>
              <DialogDescription className="max-w-md leading-relaxed">
                {t("maintenance.dialogDescription")}
              </DialogDescription>
            </DialogHeader>
          </div>
        </div>
        <DialogFooter className="gap-3 px-6 pb-7 sm:justify-center sm:px-10 sm:pb-8">
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
        </DialogFooter>
        <DialogClose
          render={
            <Button
              variant="ghost"
              size="icon"
              className="absolute top-4 right-4 rounded-full"
            />
          }
        >
          <XIcon />
          <span className="sr-only">{t("common.close")}</span>
        </DialogClose>
      </DialogContent>
    </Dialog>
  )
}
