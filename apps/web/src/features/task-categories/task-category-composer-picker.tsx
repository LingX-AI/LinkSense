import { useRef, useState } from "react"
import { FolderClosedIcon, PlusIcon, XIcon } from "lucide-react"
import { useTranslation } from "react-i18next"

import { Button } from "@/components/ui/button"
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { useTaskCategories } from "./task-category-api"
import { TaskCategoryDialog } from "./task-category-dialog"
import { cn } from "@/lib/utils"

export function TaskCategoryComposerPicker({
  value,
  onChange,
  disabled = false,
}: {
  value: string | null
  onChange: (id: string | null) => void
  disabled?: boolean
}) {
  const { t } = useTranslation()
  const query = useTaskCategories()
  const categories = query.data ?? []
  const selected = categories.find((category) => category.id === value)
  const [open, setOpen] = useState(false)
  const [creating, setCreating] = useState(false)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const canClear = value !== null && !disabled && !query.isPending
  const choose = (id: string | null) => {
    if (disabled) return
    onChange(id)
    setOpen(false)
  }

  return (
    <>
      <div className="conversation-category-dock flex min-h-10 min-w-0 flex-wrap items-center gap-2 px-2 py-1">
        <Popover open={open && !disabled} onOpenChange={setOpen}>
          <div className="group/category-picker relative flex max-w-full min-w-0">
            <PopoverTrigger
              ref={triggerRef}
              render={<Button variant="ghost" />}
              role="combobox"
              aria-label={t("taskCategories.choose")}
              disabled={disabled || query.isPending}
              className="max-w-full min-w-0 gap-2 bg-transparent px-1.5 text-[length:var(--app-font-13)] font-medium hover:bg-hover focus-visible:bg-hover data-popup-open:bg-hover"
            >
              <FolderClosedIcon
                aria-hidden="true"
                className={cn(
                  "size-3.5 shrink-0",
                  canClear &&
                    "group-hover/category-picker:opacity-0 group-has-[:focus-visible]/category-picker:opacity-0 [@media(hover:none)]:opacity-0"
                )}
              />
              <span className="truncate">
                {query.isPending
                  ? t("common.loading")
                  : value === null
                    ? t("taskCategories.unclassified")
                    : (selected?.name ?? t("taskCategories.unavailable"))}
              </span>
            </PopoverTrigger>
            {canClear && (
              <Button
                type="button"
                variant="secondary"
                size="icon-xs"
                aria-label={t("taskCategories.clearSelection")}
                className="pointer-events-none absolute top-1/2 left-1 size-5 -translate-y-1/2 rounded-full opacity-0 group-hover/category-picker:pointer-events-auto group-hover/category-picker:opacity-100 group-has-[:focus-visible]/category-picker:pointer-events-auto group-has-[:focus-visible]/category-picker:opacity-100 [@media(hover:none)]:pointer-events-auto [@media(hover:none)]:opacity-100"
                onClick={() => {
                  choose(null)
                  triggerRef.current?.focus()
                }}
              >
                <XIcon aria-hidden="true" />
              </Button>
            )}
          </div>
          <PopoverContent
            side="top"
            align="start"
            sideOffset={6}
            initialFocus={searchRef}
            aria-label={t("taskCategories.choose")}
            className="w-64 max-w-[calc(100vw-2rem)] gap-0 overflow-hidden rounded-2xl p-1 text-[length:var(--app-font-13)]"
          >
            <Command
              label={t("taskCategories.search")}
              defaultValue={selected?.name}
              className="min-h-0 rounded-none p-0 [&_[data-slot=command-input-wrapper]]:p-0 [&_[data-slot=input-group-addon]>svg]:size-3.5 [&_[data-slot=input-group]]:gap-2 [&_[data-slot=input-group]]:border-0 [&_[data-slot=input-group]]:bg-transparent [&_[data-slot=input-group]]:shadow-none [&_[data-slot=input-group]]:ring-0"
            >
              <CommandInput
                ref={searchRef}
                aria-label={t("taskCategories.search")}
                placeholder={t("taskCategories.search")}
                className="text-[length:var(--app-font-13)] font-medium"
              />
              <CommandList className="max-h-[min(15rem,calc(var(--available-height)-8rem))]">
                <CommandEmpty className="py-4 text-[length:var(--app-font-13)] font-medium text-muted-foreground">
                  {t("taskCategories.noResults")}
                </CommandEmpty>
                <CommandGroup className="p-0">
                  {categories.map((category) => (
                    <CommandItem
                      key={category.id}
                      value={category.name}
                      data-checked={category.id === value}
                      disabled={disabled}
                      onSelect={() => choose(category.id)}
                      className="min-h-7 gap-2 rounded-xl px-2 py-1 text-[length:var(--app-font-13)] font-medium data-[checked=true]:bg-hover [&_svg]:size-3.5"
                    >
                      <FolderClosedIcon
                        aria-hidden="true"
                        className="size-3.5"
                      />
                      <span className="truncate" title={category.name}>
                        {category.name}
                      </span>
                    </CommandItem>
                  ))}
                </CommandGroup>
              </CommandList>
            </Command>
            <div
              className="mx-2 my-1 h-px shrink-0 bg-divider"
              role="separator"
            />
            <div className="flex shrink-0 flex-col">
              <Button
                variant="ghost"
                disabled={disabled}
                className="h-7 justify-start gap-2 rounded-xl border-0 px-2 text-[length:var(--app-font-13)] font-medium text-muted-foreground"
                onClick={() => {
                  setOpen(false)
                  setCreating(true)
                }}
              >
                <PlusIcon aria-hidden="true" className="size-3.5" />
                {t("taskCategories.create")}
              </Button>
            </div>
          </PopoverContent>
        </Popover>
        {query.isError && (
          <div
            role="alert"
            className="flex min-w-0 flex-wrap items-center gap-1 text-sm text-destructive"
          >
            <span>{t("taskCategories.loadError")}</span>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={disabled || query.isFetching}
              onClick={() => void query.refetch()}
            >
              {t("common.retry")}
            </Button>
          </div>
        )}
      </div>
      {creating && (
        <TaskCategoryDialog
          action={{ mode: "create" }}
          onCreated={(category) => onChange(category.id)}
          onClose={() => {
            setCreating(false)
            triggerRef.current?.focus()
          }}
        />
      )}
    </>
  )
}
