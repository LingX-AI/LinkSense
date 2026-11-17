import { useSyncExternalStore } from "react"
import { useTranslation } from "react-i18next"
import {
  getDesktopUpdateRequired,
  subscribeDesktopUpdate,
} from "@/adapters/desktop/desktop-adapter"
import { useProductName } from "@/app/product-branding"
import { Button } from "@/components/ui/button"
import { Dialog } from "@/components/ui/dialog"
import { DesktopUpdateControl } from "@/features/desktop-update/desktop-update-control"
import { SystemNoticeDialogContent } from "./system-notice-dialog-content"

export function DesktopUpdateNotice() {
  const required = useSyncExternalStore(
    subscribeDesktopUpdate,
    getDesktopUpdateRequired,
    () => false
  )
  const { t } = useTranslation()
  const productName = useProductName()
  if (!required) return null
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
