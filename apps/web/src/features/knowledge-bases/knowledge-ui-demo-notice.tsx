import { useEffect } from "react"
import { useTranslation } from "react-i18next"

import { StatusBanner } from "@/components/feedback/status-banner"
import { Button } from "@/components/ui/button"
import { isWorkspaceUiDemoEnabled } from "@/features/ui-demo/workspace-ui-demo-mode"
import { WorkspaceUiDemoNotice } from "@/features/ui-demo/workspace-ui-demo-notice"
import {
  exitKnowledgeUiDemo,
  isKnowledgeUiDemoEnabled,
  rememberKnowledgeUiDemo,
} from "./knowledge-ui-demo-mode"

export function KnowledgeUiDemoNotice({
  showWorkspaceNotice = true,
}: { showWorkspaceNotice?: boolean } = {}) {
  const { t } = useTranslation()
  const enabled = isKnowledgeUiDemoEnabled()
  useEffect(() => {
    if (enabled) rememberKnowledgeUiDemo()
  }, [enabled])
  if (!enabled) return null
  if (isWorkspaceUiDemoEnabled())
    return showWorkspaceNotice ? <WorkspaceUiDemoNotice /> : null

  return (
    <StatusBanner variant="info" className="mb-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span>{t("knowledge.uiDemo.readOnly")}</span>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={exitKnowledgeUiDemo}
        >
          {t("knowledge.uiDemo.exit")}
        </Button>
      </div>
    </StatusBanner>
  )
}
