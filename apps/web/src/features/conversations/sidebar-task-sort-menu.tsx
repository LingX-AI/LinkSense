import { useTranslation } from "react-i18next"

import { Button } from "@/components/ui/button"
import { DesignIcon, type DesignIconName } from "@/components/ui/design-icon"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  sidebarTaskSortModeSchema,
  type SidebarTaskSortMode,
} from "./sidebar-task-sort-preference"

const modes = ["priority", "updated_at", "manual"] as const
const modeIcons = {
  priority: "sort-priority",
  updated_at: "sort-updated",
  manual: "sort-manual",
} satisfies Record<SidebarTaskSortMode, DesignIconName>

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
        side="bottom"
        align="start"
        sideOffset={8}
        className="w-55 rounded-xl border border-border p-2 shadow-(--app-dialog-shadow) ring-0"
      >
        <DropdownMenuGroup className="flex flex-col gap-1">
          <DropdownMenuLabel className="flex h-7 items-center py-0 leading-[var(--app-line-18)] font-normal">
            {t("conversation.taskSort.label")}
          </DropdownMenuLabel>
          <DropdownMenuSeparator className="m-0 h-px" />
          <DropdownMenuRadioGroup
            className="flex flex-col gap-1"
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
                className="min-h-8 py-1.25 leading-[var(--app-line-22)] font-normal focus-visible:bg-transparent focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-inset active:bg-accent [&_[data-slot=dropdown-menu-radio-item-indicator]_svg]:text-primary!"
                aria-description={
                  mode === "priority"
                    ? t("conversation.taskSort.priorityDescription")
                    : undefined
                }
              >
                <DesignIcon name={modeIcons[mode]} />
                {t(`conversation.taskSort.${mode}`)}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
