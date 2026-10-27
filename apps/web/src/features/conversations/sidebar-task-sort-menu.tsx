import { useTranslation } from "react-i18next"

import { Button } from "@/components/ui/button"
import { DesignIcon } from "@/components/ui/design-icon"
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
            size="icon"
            aria-label={t("conversation.taskSort.open", {
              section: sectionLabel,
            })}
          />
        }
      >
        <DesignIcon name="more" />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        sideOffset={8}
        className="w-55 p-2 [&_[data-slot=dropdown-menu-radio-item]]:min-h-8 [&_[data-slot=dropdown-menu-radio-item]]:font-normal"
      >
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
