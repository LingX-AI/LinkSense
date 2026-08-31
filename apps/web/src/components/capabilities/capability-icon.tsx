import { useState, type ComponentProps } from "react"

import type { CapabilitySummary } from "@/api/contracts"
import mcpIconUrl from "@/assets/capabilities/mcp-icon.svg"
import pluginIconUrl from "@/assets/capabilities/plugin-icon.png"
import skillIconUrl from "@/assets/capabilities/skill-icon.png"

const defaultIconUrls: Record<CapabilitySummary["type"], string> = {
  plugin: pluginIconUrl,
  skill: skillIconUrl,
}

export function McpIcon({
  className,
  ...props
}: Omit<ComponentProps<"img">, "alt" | "src">) {
  return (
    <img
      src={mcpIconUrl}
      alt=""
      width="24"
      height="24"
      className={className}
      data-default-capability-icon="mcp"
      aria-hidden="true"
      {...props}
    />
  )
}

export function CapabilityIcon({
  type,
  logoUrl,
  className,
}: {
  type: CapabilitySummary["type"]
  logoUrl?: string | null
  className?: string
}) {
  const customLogoUrl = logoUrl?.trim() || null
  const [failedLogoUrl, setFailedLogoUrl] = useState<string | null>(null)
  const source =
    customLogoUrl !== null && customLogoUrl !== failedLogoUrl
      ? customLogoUrl
      : defaultIconUrls[type]

  return (
    <img
      src={source}
      width="24"
      height="24"
      className={className}
      data-default-capability-icon={
        source === defaultIconUrls[type] ? type : undefined
      }
      alt=""
      aria-hidden="true"
      decoding="async"
      draggable={false}
      onError={() => {
        if (customLogoUrl !== null && source === customLogoUrl) {
          setFailedLogoUrl(customLogoUrl)
        }
      }}
    />
  )
}
