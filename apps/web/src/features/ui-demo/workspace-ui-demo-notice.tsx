import { useEffect } from "react"
import { useTranslation } from "react-i18next"
import { StatusBanner } from "@/components/feedback/status-banner"
import { Button } from "@/components/ui/button"
import {
  exitWorkspaceUiDemo,
  isWorkspaceUiDemoEnabled,
  rememberWorkspaceUiDemo,
} from "./workspace-ui-demo-mode"

export function WorkspaceUiDemoNotice() {
  const { t } = useTranslation()
  const enabled = isWorkspaceUiDemoEnabled()
  useEffect(() => {
    if (enabled) rememberWorkspaceUiDemo()
  }, [enabled])
  if (!enabled) return null
  return (
    <StatusBanner variant="info" className="mb-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span>{t("workspaceUiDemo.readOnly")}</span>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={exitWorkspaceUiDemo}
        >
          {t("workspaceUiDemo.exit")}
        </Button>
      </div>
    </StatusBanner>
  )
}
