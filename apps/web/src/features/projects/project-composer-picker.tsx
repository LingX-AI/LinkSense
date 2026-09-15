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
import { useProjects } from "./project-api"
import { ProjectDialog } from "./project-dialog"
import { cn } from "@/lib/utils"

export function ProjectComposerPicker({
  value,
  onChange,
  disabled = false,
}: {
  value: string | null
  onChange: (id: string | null) => void
  disabled?: boolean
}) {
  const { t } = useTranslation()
  const query = useProjects()
  const projects = query.data ?? []
  const selected = projects.find((project) => project.id === value)
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
      <div className="conversation-project-dock flex min-h-10 min-w-0 flex-wrap items-center gap-2 px-2 py-1">
        <Popover open={open && !disabled} onOpenChange={setOpen}>
          <div className="group/project-picker relative flex max-w-full min-w-0">
            <PopoverTrigger
              ref={triggerRef}
              render={<Button variant="ghost" />}
              role="combobox"
              aria-label={t("projects.choose")}
              disabled={disabled || query.isPending}
              className="max-w-full min-w-0 gap-2 bg-transparent px-1.5 text-[length:var(--app-font-13)] font-medium hover:bg-hover focus-visible:bg-hover data-popup-open:bg-hover"
            >
              <FolderClosedIcon
                aria-hidden="true"
                className={cn(
                  "size-3.5 shrink-0",
                  canClear &&
                    "group-hover/project-picker:opacity-0 group-has-[:focus-visible]/project-picker:opacity-0 [@media(hover:none)]:opacity-0"
                )}
              />
              <span className="truncate">
                {query.isPending
                  ? t("common.loading")
                  : value === null
                    ? t("projects.projectlessTask")
                    : (selected?.name ?? t("projects.unavailable"))}
              </span>
            </PopoverTrigger>
            {canClear && (
              <Button
                type="button"
                variant="secondary"
                size="icon-xs"
                aria-label={t("projects.clearSelection")}
                className="pointer-events-none absolute top-1/2 left-1 size-5 -translate-y-1/2 rounded-full opacity-0 group-hover/project-picker:pointer-events-auto group-hover/project-picker:opacity-100 group-has-[:focus-visible]/project-picker:pointer-events-auto group-has-[:focus-visible]/project-picker:opacity-100 [@media(hover:none)]:pointer-events-auto [@media(hover:none)]:opacity-100"
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
            aria-label={t("projects.choose")}
            className="w-64 max-w-[calc(100vw-2rem)] gap-0 overflow-hidden rounded-2xl p-1 text-[length:var(--app-font-13)]"
          >
            <Command
              label={t("projects.search")}
              defaultValue={selected?.name}
              className="min-h-0 rounded-none p-0 [&_[data-slot=command-input-wrapper]]:p-0 [&_[data-slot=input-group-addon]>svg]:size-3.5 [&_[data-slot=input-group]]:gap-2 [&_[data-slot=input-group]]:border-0 [&_[data-slot=input-group]]:bg-transparent [&_[data-slot=input-group]]:shadow-none [&_[data-slot=input-group]]:ring-0"
            >
              <CommandInput
                ref={searchRef}
                aria-label={t("projects.search")}
                placeholder={t("projects.search")}
                className="pl-0! text-[length:var(--app-font-13)] font-medium"
              />
              <CommandList className="max-h-[min(15rem,calc(var(--available-height)-8rem))]">
                <CommandEmpty className="py-4 text-[length:var(--app-font-13)] font-medium text-muted-foreground">
                  {t("projects.noResults")}
                </CommandEmpty>
                <CommandGroup className="p-0">
                  {projects.map((project) => (
                    <CommandItem
                      key={project.id}
                      value={project.name}
                      data-checked={project.id === value}
                      disabled={disabled}
                      onSelect={() => choose(project.id)}
                      className="min-h-7 gap-2 rounded-xl px-2 py-1 text-[length:var(--app-font-13)] font-medium data-[checked=true]:bg-hover [&_svg]:size-3.5"
                    >
                      <FolderClosedIcon
                        aria-hidden="true"
                        className="size-3.5"
                      />
                      <span className="truncate" title={project.name}>
                        {project.name}
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
                {t("projects.create")}
              </Button>
            </div>
          </PopoverContent>
        </Popover>
        {query.isError && (
          <div
            role="alert"
            className="flex min-w-0 flex-wrap items-center gap-1 text-sm text-destructive"
          >
            <span>{t("projects.loadError")}</span>
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
        <ProjectDialog
          action={{ mode: "create" }}
          onCreated={(project) => onChange(project.id)}
          onClose={() => {
            setCreating(false)
            triggerRef.current?.focus()
          }}
        />
      )}
    </>
  )
}
