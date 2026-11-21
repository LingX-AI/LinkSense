import { useId, useState } from "react"
import {
  ChevronDownIcon,
  CircleAlertIcon,
  CloudIcon,
  LaptopIcon,
  SettingsIcon,
} from "lucide-react"
import { useTranslation } from "react-i18next"
import { Link } from "react-router-dom"
import type { ConversationExecutionTarget } from "@linksense/shared"

import { Button } from "@/components/ui/button"
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from "@/components/ui/popover"
import {
  RadioGroup,
  RadioGroupItem,
  RadioGroupOption,
} from "@/components/ui/radio-group"
import { cn } from "@/lib/utils"

import {
  desktopDeviceSettingsHref,
  desktopExecutionAvailabilityMessageKey,
  type DesktopExecutionDeviceAvailability,
} from "./desktop-execution-target"

const settingsReasons = new Set([
  "offline",
  "unpaired",
  "revoked",
  "status_unavailable",
])

export function DesktopExecutionTargetPicker({
  value,
  onValueChange,
  availability,
  disabled = false,
}: Readonly<{
  value: ConversationExecutionTarget
  onValueChange: (target: ConversationExecutionTarget) => void
  availability: DesktopExecutionDeviceAvailability
  disabled?: boolean
}>) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const id = useId()
  const titleId = `${id}-title`
  const descriptionId = `${id}-description`
  const cloudLabelId = `${id}-cloud-label`
  const cloudDescriptionId = `${id}-cloud-description`
  const localLabelId = `${id}-local-label`
  const localDescriptionId = `${id}-local-description`
  const targetLabel =
    value === "local"
      ? t("desktopExecution.local")
      : t("desktopExecution.cloud")
  const triggerLabel = t("desktopExecution.targetBadge", {
    target: targetLabel,
  })
  const TargetIcon = value === "local" ? LaptopIcon : CloudIcon
  const localAvailable = availability.kind === "ready"
  const localDisabled = disabled || !localAvailable
  const availabilityKey = desktopExecutionAvailabilityMessageKey(availability)
  const localDescription = availabilityKey
    ? t(availabilityKey)
    : t("desktopExecution.localDescription")
  const localDegraded = value === "local" && !localAvailable
  const showSettings =
    availability.kind === "unavailable" &&
    settingsReasons.has(availability.reason)

  const select = (next: string) => {
    if (next !== "cloud" && next !== "local") return
    if (next === "local" && !localAvailable) return
    onValueChange(next)
    setOpen(false)
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="composer-control h-7 max-w-40 gap-1.5 px-1.5 font-normal @max-[28rem]/conversation-workspace:max-w-28"
            aria-label={triggerLabel}
            disabled={disabled}
          />
        }
      >
        <TargetIcon
          className="size-3.5 shrink-0 text-foreground"
          aria-hidden="true"
        />
        <span className="min-w-0 truncate">{targetLabel}</span>
        {localDegraded ? (
          <CircleAlertIcon
            className="size-3.5 shrink-0 text-destructive"
            aria-hidden="true"
          />
        ) : null}
        <ChevronDownIcon
          className={cn(
            "size-3.5 shrink-0 text-muted-foreground transition-transform duration-150 motion-reduce:transition-none",
            open && "rotate-180"
          )}
          aria-hidden="true"
        />
      </PopoverTrigger>
      <PopoverContent
        side="top"
        align="start"
        sideOffset={8}
        className="w-[min(20rem,calc(100vw-2rem))] gap-3 rounded-2xl p-3"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
      >
        <PopoverHeader className="gap-1">
          <PopoverTitle id={titleId} className="text-sm">
            {t("desktopExecution.targetSelectorTitle")}
          </PopoverTitle>
          <PopoverDescription
            id={descriptionId}
            className="text-xs leading-5 text-muted-foreground"
          >
            {t("desktopExecution.targetSelectorDescription")}
          </PopoverDescription>
        </PopoverHeader>
        <RadioGroup
          value={value}
          onValueChange={select}
          aria-labelledby={titleId}
          aria-describedby={descriptionId}
          disabled={disabled}
          className="flex-col flex-nowrap gap-2"
        >
          <RadioGroupOption
            htmlFor={`${id}-cloud`}
            className="w-full items-start gap-2.5 rounded-xl px-3 py-2.5"
          >
            <RadioGroupItem
              id={`${id}-cloud`}
              value="cloud"
              className="mt-0.5"
              aria-labelledby={cloudLabelId}
              aria-describedby={cloudDescriptionId}
            />
            <span className="grid min-w-0 gap-0.5">
              <span
                id={cloudLabelId}
                className="text-[length:var(--app-font-13)] font-medium"
              >
                {t("desktopExecution.cloud")}
              </span>
              <span
                id={cloudDescriptionId}
                className="text-xs leading-5 text-muted-foreground"
              >
                {t("desktopExecution.cloudDescription")}
              </span>
            </span>
          </RadioGroupOption>
          <RadioGroupOption
            htmlFor={`${id}-local`}
            className={cn(
              "w-full items-start gap-2.5 rounded-xl px-3 py-2.5",
              localDisabled && "cursor-not-allowed opacity-60"
            )}
          >
            <RadioGroupItem
              id={`${id}-local`}
              value="local"
              className="mt-0.5"
              disabled={localDisabled}
              aria-labelledby={localLabelId}
              aria-describedby={localDescriptionId}
            />
            <span className="grid min-w-0 gap-0.5">
              <span
                id={localLabelId}
                className="text-[length:var(--app-font-13)] font-medium"
              >
                {t("desktopExecution.local")}
              </span>
              <span
                id={localDescriptionId}
                className="text-xs leading-5 text-muted-foreground"
              >
                {localDescription}
              </span>
            </span>
          </RadioGroupOption>
        </RadioGroup>
        {showSettings && (
          <Button
            nativeButton={false}
            role="link"
            variant="link"
            size="sm"
            className="h-auto justify-start gap-1.5 p-0 text-xs font-normal"
            render={
              <Link
                to={desktopDeviceSettingsHref}
                onClick={() => setOpen(false)}
              />
            }
          >
            <SettingsIcon className="size-3.5" aria-hidden="true" />
            {t("desktopExecution.manageDevices")}
          </Button>
        )}
      </PopoverContent>
    </Popover>
  )
}
