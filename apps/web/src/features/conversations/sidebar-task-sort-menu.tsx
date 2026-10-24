import { MoreHorizontalIcon } from "lucide-react"
import { useTranslation } from "react-i18next"

import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  sidebarTaskSortModeSchema,
  type SidebarTaskSortMode,
} from "./sidebar-task-sort-preference"

const modes = ["priority", "updated_at", "manual"] as const

export function SidebarTaskSortMenu({
  sectionLabel,
  value,
  onValueChange,
}: {
  sectionLabel: string
  value: SidebarTaskSortMode
  onValueChange: (value: SidebarTaskSortMode) => void
}) {
  const { t } = useTranslation()
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={t("conversation.taskSort.open", {
              section: sectionLabel,
            })}
          />
        }
      >
        <MoreHorizontalIcon aria-hidden="true" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-36">
        <DropdownMenuGroup>
          <DropdownMenuLabel>
            {t("conversation.taskSort.label")}
          </DropdownMenuLabel>
          <DropdownMenuRadioGroup
            value={value}
            onValueChange={(nextValue) => {
              const parsed = sidebarTaskSortModeSchema.safeParse(nextValue)
              if (parsed.success) onValueChange(parsed.data)
            }}
          >
            {modes.map((mode) => (
              <DropdownMenuRadioItem
                key={mode}
                value={mode}
                closeOnClick
                aria-description={
                  mode === "priority"
                    ? t("conversation.taskSort.priorityDescription")
                    : undefined
                }
              >
                {t(`conversation.taskSort.${mode}`)}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
