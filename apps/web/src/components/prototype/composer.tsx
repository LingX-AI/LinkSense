import { useMemo, useState } from "react"
import {
  ArrowUpIcon,
  MicIcon,
  PaperclipIcon,
  PlusIcon,
  SquareIcon,
  XIcon,
} from "lucide-react"
import { useTranslation } from "react-i18next"

import { CapabilityIcon } from "@/components/capabilities/capability-icon"
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
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from "@/components/ui/popover"
import { Textarea } from "@/components/ui/textarea"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { capabilities } from "@/data/mock-data"
import { cn } from "@/lib/utils"

type ComposerProps = {
  isRunning: boolean
  onStop: () => void
  onStart: () => void
}

export function Composer({ isRunning, onStop, onStart }: ComposerProps) {
  const { t } = useTranslation()
  const [value, setValue] = useState("")
  const [menuOpen, setMenuOpen] = useState(false)
  const [isListening, setIsListening] = useState(false)
  const [selectedCapabilityIds, setSelectedCapabilityIds] = useState<string[]>([
    "document-analysis",
  ])

  const selectedCapabilities = useMemo(
    () =>
      capabilities.filter((capability) =>
        selectedCapabilityIds.includes(capability.id)
      ),
    [selectedCapabilityIds]
  )

  const selectCapability = (capabilityId: string) => {
    setSelectedCapabilityIds((current) =>
      current.includes(capabilityId)
        ? current.filter((id) => id !== capabilityId)
        : [...current, capabilityId]
    )
  }

  const removeCapability = (capabilityId: string) => {
    setSelectedCapabilityIds((current) =>
      current.filter((id) => id !== capabilityId)
    )
  }

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (isRunning || value.trim().length === 0) {
      return
    }

    onStart()
    setValue("")
  }

  return (
    <form
      className="composer-shell"
      aria-label={t("composer.label")}
      onSubmit={handleSubmit}
    >
      {selectedCapabilities.length > 0 && (
        <div className="mb-1 flex flex-wrap gap-1.5 px-1">
          {selectedCapabilities.map((capability) => {
            const name = t(capability.nameKey)
            return (
              <span key={capability.id} className="capability-chip">
                <CapabilityIcon
                  type={capability.kind}
                  className="capability-chip-icon"
                />
                <span className="min-w-0 truncate">{name}</span>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  className="ml-0.5 size-5 rounded-md p-0 hover:bg-hover"
                  aria-label={t("composer.removeCapability", { name })}
                  onClick={() => removeCapability(capability.id)}
                >
                  <XIcon className="size-2.5" aria-hidden="true" />
                </Button>
              </span>
            )
          })}
        </div>
      )}

      <Textarea
        value={value}
        onChange={(event) => setValue(event.target.value)}
        aria-label={t("composer.label")}
        placeholder={t("composer.placeholder")}
        className="composer-input min-h-14 border-0 bg-transparent px-1 py-2 text-sm leading-6 shadow-none focus-visible:bg-transparent focus-visible:ring-0"
      />

      <div className="mt-1 flex items-center justify-between gap-3">
        <div className="flex items-center gap-1">
          <Popover open={menuOpen} onOpenChange={setMenuOpen}>
            <PopoverTrigger
              render={
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  className="composer-control border-0 shadow-none"
                  aria-label={t("composer.addCapability")}
                />
              }
            >
              <PlusIcon aria-hidden="true" />
            </PopoverTrigger>
            <PopoverContent
              side="top"
              align="start"
              sideOffset={10}
              className="w-[min(340px,calc(100vw-2rem))] gap-2 border-0 bg-[var(--app-popover)] p-2 text-[var(--app-text)] ring-0"
            >
              <PopoverHeader className="px-2 pt-1">
                <PopoverTitle className="text-sm">
                  {t("capabilityMenu.title")}
                </PopoverTitle>
                <PopoverDescription className="text-[length:var(--app-font-11)] text-[var(--app-muted)]">
                  {t("capabilityMenu.description")}
                </PopoverDescription>
              </PopoverHeader>
              <Command className="bg-transparent p-0">
                <CommandInput
                  placeholder={t("capabilityMenu.search")}
                  autoFocus
                />
                <CommandList>
                  <CommandEmpty>{t("capabilityMenu.empty")}</CommandEmpty>
                  {(["plugin", "skill"] as const).map((kind) => (
                    <CommandGroup
                      key={kind}
                      heading={t(
                        kind === "plugin"
                          ? "capabilityMenu.plugins"
                          : "capabilityMenu.skills"
                      )}
                    >
                      {capabilities
                        .filter((capability) => capability.kind === kind)
                        .map((capability) => {
                          const selected = selectedCapabilityIds.includes(
                            capability.id
                          )
                          return (
                            <CommandItem
                              key={capability.id}
                              value={`${t(capability.nameKey)} ${t(capability.descriptionKey)}`}
                              data-checked={selected || undefined}
                              onSelect={() => selectCapability(capability.id)}
                              className="py-2"
                            >
                              <span className="flex size-7 items-center justify-center overflow-hidden rounded-xl bg-[var(--app-control-surface)] text-[var(--app-muted)]">
                                <CapabilityIcon
                                  type={kind}
                                  className="size-full object-contain"
                                />
                              </span>
                              <span className="min-w-0">
                                <span className="block text-xs font-medium">
                                  {t(capability.nameKey)}
                                </span>
                                <span className="block truncate text-[length:var(--app-font-10)] font-normal text-[var(--app-muted)]">
                                  {t(capability.descriptionKey)}
                                </span>
                              </span>
                            </CommandItem>
                          )
                        })}
                    </CommandGroup>
                  ))}
                </CommandList>
              </Command>
            </PopoverContent>
          </Popover>

          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  className="composer-control border-0 shadow-none"
                  aria-label={t("composer.attachFile")}
                />
              }
            >
              <PaperclipIcon aria-hidden="true" />
            </TooltipTrigger>
            <TooltipContent>{t("composer.attachFile")}</TooltipContent>
          </Tooltip>
        </div>

        <div className="flex items-center gap-1.5">
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-pressed={isListening}
                  className={cn(
                    "composer-control border-0 shadow-none",
                    isListening &&
                      "bg-[var(--app-active)] text-[var(--app-accent)]"
                  )}
                  aria-label={t("composer.voiceInput")}
                  onClick={() => setIsListening((current) => !current)}
                />
              }
            >
              <MicIcon aria-hidden="true" />
            </TooltipTrigger>
            <TooltipContent>{t("composer.voiceInput")}</TooltipContent>
          </Tooltip>

          {isRunning ? (
            <Button
              type="button"
              size="icon"
              className="send-button rounded-full border-0 shadow-none"
              aria-label={t("composer.stop")}
              onClick={onStop}
            >
              <SquareIcon className="size-3 fill-current" aria-hidden="true" />
            </Button>
          ) : (
            <Button
              type="submit"
              size="icon"
              className="send-button rounded-full border-0 shadow-none"
              aria-label={t("composer.send")}
              disabled={value.trim().length === 0}
            >
              <ArrowUpIcon aria-hidden="true" />
            </Button>
          )}
        </div>
      </div>
    </form>
  )
}
