import type { ApplicationIcon, ApplicationIconPreset } from "@linksense/shared"
import { useState } from "react"

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { applicationIconPresetDefinitions } from "@/features/applications/application-icon-presets"
import { cn } from "@/lib/utils"

function iconResourceKey(url: string): string {
  const resource = new URL(url)
  // Uploaded icons have immutable object paths. Only signing metadata changes
  // during polling; preserve content selectors such as versionId in the key.
  if (!resource.searchParams.has("X-Amz-Signature")) return url
  for (const parameter of [
    "X-Amz-Algorithm",
    "X-Amz-Credential",
    "X-Amz-Date",
    "X-Amz-Expires",
    "X-Amz-SignedHeaders",
    "X-Amz-Signature",
    "X-Amz-Security-Token",
  ]) {
    resource.searchParams.delete(parameter)
  }
  resource.searchParams.sort()
  return resource.href
}

function ApplicationIconImage({
  url,
  className,
}: {
  url: string
  className: string
}) {
  const [source, setSource] = useState(url)
  const [failed, setFailed] = useState(false)
  // Base UI reloads and shows its fallback on every src change. Retain the
  // current load for this object; a failed load can use a renewed signed URL.
  // Remounting (including a different resource key) always uses the latest URL.
  if (failed && source !== url) {
    setSource(url)
    setFailed(false)
  }
  return (
    <AvatarImage
      className={className}
      src={source}
      alt=""
      onLoadingStatusChange={(status) => {
        if (status === "error") setFailed(true)
      }}
    />
  )
}

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
        "items-center justify-center overflow-hidden bg-transparent after:border-border/60",
        !compact && "after:rounded-[calc(var(--radius)*0.7)]",
        className
      )}
    >
      {icon.type === "custom" && (
        <ApplicationIconImage
          key={iconResourceKey(icon.url)}
          className={cn(radiusClass, "size-[80%] object-contain")}
          url={icon.url}
        />
      )}
      <AvatarFallback
        data-application-icon-preset={preset}
        className={cn(radiusClass, "bg-transparent")}
      >
        <PresetIcon aria-hidden="true" className="size-full" />
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
      className="inline-flex size-8 items-center justify-center rounded-lg border border-border/60 bg-transparent p-0.5"
      aria-hidden="true"
    >
      <PresetIcon className="size-full" />
    </span>
  )
}
