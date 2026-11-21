import { useEffect, useRef, useSyncExternalStore } from "react"
import { useTranslation } from "react-i18next"
import { useNavigate } from "react-router-dom"
import {
  getDesktopUpdateRequired,
  isMacDesktopHost,
  subscribeDesktopUpdate,
} from "@/adapters/desktop/desktop-adapter"
import { useProductName } from "@/app/product-branding"
import { notify } from "@/components/feedback/notification"
import { Button } from "@/components/ui/button"
import { Dialog } from "@/components/ui/dialog"
import { DesktopUpdateControl } from "@/features/desktop-update/desktop-update-control"
import { useDesktopUpdateState } from "@/features/desktop-update/desktop-update-state"
import { SystemNoticeDialogContent } from "./system-notice-dialog-content"

const desktopUpdateToastId = "desktop-update-available"

export function DesktopUpdateNotice() {
  const required = useSyncExternalStore(
    subscribeDesktopUpdate,
    getDesktopUpdateRequired,
    () => false
  )
  if (required) return <RequiredDesktopUpdateNotice />
  if (!isMacDesktopHost()) return null
  return <AvailableDesktopUpdateToast />
}

function RequiredDesktopUpdateNotice() {
  const { t } = useTranslation()
  const productName = useProductName()
  // The blocking compatibility dialog replaces any background availability
  // notice instead of stacking another update surface.
  useEffect(() => {
    notify.dismiss(desktopUpdateToastId)
  }, [])
  return (
    <Dialog open>
      <SystemNoticeDialogContent
        title={t("bootstrap.unavailableTitle", { productName })}
        description={t("errors.desktopUpdateRequired")}
        footer={
          <div className="grid min-w-0 gap-3 sm:flex sm:items-start sm:justify-between">
            <DesktopUpdateControl />
            <Button onClick={() => window.location.reload()}>
              {t("common.retry")}
            </Button>
          </div>
        }
      />
    </Dialog>
  )
}

// Background availability uses the existing toast surface so it never covers
// content, steals focus, or grows a second dialog. Settings remains the place
// to see staged/progress state.
function AvailableDesktopUpdateToast() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const state = useDesktopUpdateState()
  const notifiedVersion = useRef<string | null>(null)
  const availableVersion =
    state?.state === "available" ? (state.version ?? null) : null
  const stateKind = state?.state

  useEffect(() => {
    if (availableVersion) {
      if (notifiedVersion.current === availableVersion) return
      notifiedVersion.current = availableVersion
      notify.info(t("desktopUpdate.noticeAction"), {
        id: desktopUpdateToastId,
        description: t("desktopUpdate.updateAvailable", {
          version: availableVersion,
        }),
        action: {
          label: t("common.view"),
          onClick: () => {
            notify.dismiss(desktopUpdateToastId)
            navigate("/settings/general")
          },
        },
      })
      return
    }
    // A background cadence may briefly report checking. Keep the same notice
    // and its version dedupe instead of stacking another toast.
    if (stateKind === "checking") return
    if (notifiedVersion.current !== null) {
      notifiedVersion.current = null
      notify.dismiss(desktopUpdateToastId)
    }
  }, [availableVersion, navigate, stateKind, t])

  return null
}
