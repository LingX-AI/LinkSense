import type { ReactNode } from "react"
import { ArchiveIcon, EllipsisIcon, PencilIcon, Trash2Icon } from "lucide-react"
import { useTranslation } from "react-i18next"

import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"

type TopBarProps = {
  mobileNavigation?: ReactNode
}

function ActionButton({
  label,
  children,
}: {
  label: string
  children: ReactNode
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="top-bar-action border-0 bg-transparent shadow-none"
            aria-label={label}
          />
        }
      >
        {children}
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}

export function TopBar({ mobileNavigation }: TopBarProps) {
  const { t } = useTranslation()

  return (
    <header className="app-top-bar">
      <div className="flex min-w-0 items-center gap-2">
        {mobileNavigation}
        <h1 className="truncate text-[length:var(--app-font-13)] font-semibold tracking-[-0.01em] text-[var(--app-text)] sm:text-sm">
          {t("conversation.title")}
        </h1>
      </div>

      <div className="flex items-center gap-0.5">
        <ActionButton label={t("conversation.rename")}>
          <PencilIcon aria-hidden="true" />
        </ActionButton>
        <ActionButton label={t("conversation.archive")}>
          <ArchiveIcon aria-hidden="true" />
        </ActionButton>
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                className="top-bar-action border-0 bg-transparent shadow-none"
                aria-label={t("conversation.menu")}
              />
            }
          >
            <EllipsisIcon aria-hidden="true" />
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="end"
            className="w-44 border-0 bg-[var(--app-popover)] text-[var(--app-text)] ring-0"
          >
            <DropdownMenuItem>
              <PencilIcon aria-hidden="true" />
              {t("conversation.rename")}
            </DropdownMenuItem>
            <DropdownMenuItem>
              <ArchiveIcon aria-hidden="true" />
              {t("conversation.archive")}
            </DropdownMenuItem>
            <DropdownMenuItem variant="destructive">
              <Trash2Icon aria-hidden="true" />
              {t("conversation.delete")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  )
}
