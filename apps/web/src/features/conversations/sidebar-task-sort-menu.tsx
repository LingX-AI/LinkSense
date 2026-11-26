import { useTranslation } from "react-i18next"

import { Button } from "@/components/ui/button"
import { SidebarMoreIcon } from "@/components/shell/sidebar-more-icon"
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
            className="hover:bg-transparent aria-expanded:bg-transparent"
            title={t("conversation.taskSort.open", {
              section: sectionLabel,
            })}
            aria-label={t("conversation.taskSort.open", {
              section: sectionLabel,
            })}
          />
        }
      >
        <SidebarMoreIcon />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        side="bottom"
        align="start"
        sideOffset={8}
        className="w-[220px] rounded-xl border border-border p-1.5 shadow-(--app-dialog-shadow) ring-0"
      >
        <DropdownMenuGroup className="flex flex-col gap-0.5">
          <DropdownMenuLabel className="flex h-6 items-center px-2 py-0 text-xs leading-[var(--app-line-18)] font-normal">
            {t("conversation.taskSort.label")}
          </DropdownMenuLabel>
          <DropdownMenuSeparator className="m-0 h-px" />
          <DropdownMenuRadioGroup
            className="flex flex-col gap-0.5"
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
                className="min-h-6 gap-1.5 py-1 pr-7 pl-2 text-[length:var(--app-font-13)] leading-[var(--app-line-18)] font-normal focus-visible:bg-transparent focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-inset active:bg-accent [&_[data-slot=dropdown-menu-radio-item-indicator]_svg]:size-3.5 [&_[data-slot=dropdown-menu-radio-item-indicator]_svg]:text-primary!"
                aria-description={
                  mode === "priority"
                    ? t("conversation.taskSort.priorityDescription")
                    : undefined
                }
              >
                <DesignIcon name={modeIcons[mode]} className="size-3.5" />
                {t(`conversation.taskSort.${mode}`)}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
