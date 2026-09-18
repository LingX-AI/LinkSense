import { useTranslation } from "react-i18next"
import {
  BugIcon,
  MoreHorizontalIcon,
  HistoryIcon,
  MessageSquarePlusIcon,
  Settings2Icon,
  UploadIcon,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"

export type ApplicationDevelopmentView = "preview" | "tests" | "diagnostics"

export function ApplicationDevelopmentToolbar({
  view,
  onViewChange,
  diagnosticCount,
  onNewConversation,
  newConversationDisabled,
  onConfigure,
  configureDisabled = false,
  onPublish,
  publishDisabled,
  publishLabel,
}: {
  view: ApplicationDevelopmentView
  onViewChange: (view: ApplicationDevelopmentView) => void
  diagnosticCount: number
  onNewConversation: () => void
  newConversationDisabled: boolean
  onConfigure: () => void
  configureDisabled?: boolean
  onPublish: () => void
  publishDisabled: boolean
  publishLabel: string
}) {
  const { t } = useTranslation()
  const diagnosticsLabel = t("applicationDevelopment.diagnostics", {
    count: diagnosticCount,
  })
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="ghost"
            size="icon"
            aria-label={t("applicationDevelopment.actions")}
          />
        }
      >
        <MoreHorizontalIcon aria-hidden="true" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-auto min-w-48">
        <DropdownMenuGroup>
          <DropdownMenuItem disabled={publishDisabled} onClick={onPublish}>
            <UploadIcon />
            {publishLabel}
          </DropdownMenuItem>
          <DropdownMenuItem disabled={configureDisabled} onClick={onConfigure}>
            <Settings2Icon />
            {t("applicationDevelopment.capabilities")}
          </DropdownMenuItem>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuLabel>
            {t("applicationDevelopment.debug")}
          </DropdownMenuLabel>
          <DropdownMenuItem
            disabled={newConversationDisabled}
            onClick={onNewConversation}
          >
            <MessageSquarePlusIcon />
            {t("applicationDevelopment.tests.restart")}
          </DropdownMenuItem>
          <DropdownMenuRadioGroup
            value={view}
            onValueChange={(value) => {
              if (value === "tests" || value === "diagnostics") {
                onViewChange(value)
              }
            }}
          >
            <DropdownMenuRadioItem value="tests" closeOnClick>
              <HistoryIcon />
              {t("applicationDevelopment.tests.title")}
            </DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="diagnostics" closeOnClick>
              <BugIcon />
              {diagnosticsLabel}
            </DropdownMenuRadioItem>
          </DropdownMenuRadioGroup>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
