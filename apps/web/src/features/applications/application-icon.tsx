import type { ApplicationIcon, ApplicationIconPreset } from "@linksense/shared"

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { applicationIconPresetDefinitions } from "@/features/applications/application-icon-presets"
import { cn } from "@/lib/utils"

export function ApplicationIconDisplay({
  icon,
  className,
  compact = false,
}: {
  icon: ApplicationIcon
  className?: string
  compact?: boolean
}) {
  const preset = icon.type === "custom" ? icon.fallback_preset : icon.preset
  const definition = applicationIconPresetDefinitions[preset]
  const PresetIcon = definition.icon
  const radiusClass = compact
    ? "rounded-[calc(var(--radius)*0.4)]"
    : "rounded-[calc(var(--radius)*0.7)]"

  return (
    <Avatar
      className={cn(
        radiusClass,
        "bg-transparent after:border-border/60",
        compact
          ? "[&_svg]:size-5"
          : "after:rounded-[calc(var(--radius)*0.7)] [&_svg]:size-[68%]",
        className
      )}
    >
      {icon.type === "custom" && (
        <AvatarImage className={radiusClass} src={icon.url} alt="" />
      )}
      <AvatarFallback
        data-application-icon-preset={preset}
        className={cn(radiusClass, "bg-transparent")}
      >
        <PresetIcon aria-hidden="true" />
      </AvatarFallback>
    </Avatar>
  )
}

export function ApplicationPresetIcon({
  preset,
}: {
  preset: ApplicationIconPreset
}) {
  const definition = applicationIconPresetDefinitions[preset]
  const PresetIcon = definition.icon
  return (
    <span
      data-application-icon-preset={preset}
      className="inline-flex size-8 items-center justify-center rounded-lg border border-border/60 bg-transparent p-1"
      aria-hidden="true"
    >
      <PresetIcon className="size-full" />
    </span>
  )
}
