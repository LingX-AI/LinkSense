import type { ReactNode } from "react"
import { useTranslation } from "react-i18next"

import type { CapabilitySummary } from "@/api/contracts"
import {
  CapabilityIcon,
  McpIcon,
} from "@/components/capabilities/capability-icon"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

type CapabilityType = CapabilitySummary["type"]

export function CapabilityLogo({
  type,
  logoUrl,
}: {
  type: CapabilityType
  logoUrl?: string | null
}) {
  return (
    <span className="capability-logo">
      <CapabilityIcon type={type} logoUrl={logoUrl} />
    </span>
  )
}

export function McpLogo() {
  return (
    <span className="capability-logo">
      <McpIcon />
    </span>
  )
}

export function CapabilityLibraryItem({
  name,
  type,
  logoUrl,
  logo,
  typeLabel,
  showTypeLabel = true,
  description,
  badges,
  metadata,
  notice,
  noticeVariant = "default",
  status,
  statusPlacement = "inline",
  actions,
  inspectLabel,
  onInspect,
}: {
  name: string
  type: CapabilityType
  logoUrl?: string | null
  logo?: ReactNode
  typeLabel?: string
  showTypeLabel?: boolean
  description: string
  badges?: ReactNode
  metadata?: ReactNode
  notice?: ReactNode
  noticeVariant?: "default" | "destructive"
  status?: ReactNode
  statusPlacement?: "inline" | "top-right" | "bottom-right"
  actions?: ReactNode
  inspectLabel?: string
  onInspect?: () => void
}) {
  const { t } = useTranslation()
  const resolvedTypeLabel =
    typeLabel ?? t(type === "plugin" ? "capability.plugin" : "capability.skill")
  const actionMenu = actions && (
    <div className="capability-library-actions">{actions}</div>
  )

  return (
    <article
      className={cn(
        "capability-library-row",
        (metadata || notice) && "capability-library-row-detailed"
      )}
      aria-label={name}
    >
      {onInspect && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="capability-library-card-trigger"
          aria-label={inspectLabel ?? name}
          onClick={onInspect}
        />
      )}
      {logo ?? <CapabilityLogo type={type} logoUrl={logoUrl} />}
      <div className="capability-library-body">
        <div className="capability-library-title-row">
          <h3 className="capability-library-name">{name}</h3>
          {showTypeLabel && (
            <span className="capability-library-type">{resolvedTypeLabel}</span>
          )}
          {badges}
        </div>
        <p className="capability-library-description">{description}</p>
        {metadata && <div className="capability-library-meta">{metadata}</div>}
        {notice && (
          <div
            className={cn(
              "capability-library-notice",
              noticeVariant === "destructive" &&
                "capability-library-notice-destructive"
            )}
          >
            {notice}
          </div>
        )}
      </div>
      {(status || actions) && (
        <div
          className={cn(
            "capability-library-tail",
            statusPlacement === "top-right" &&
              "capability-library-tail-status-top-right",
            statusPlacement === "bottom-right" &&
              "capability-library-tail-status-bottom-right"
          )}
        >
          {statusPlacement === "bottom-right" ? actionMenu : status}
          {statusPlacement === "bottom-right" ? status : actionMenu}
        </div>
      )}
    </article>
  )
}
