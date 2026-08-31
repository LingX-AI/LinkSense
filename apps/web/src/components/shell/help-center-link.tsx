import { CircleHelpIcon } from "lucide-react"
import { useTranslation } from "react-i18next"
import { useLocation } from "react-router-dom"

import { buttonVariants } from "@/components/ui/button"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { normalizeLanguage } from "@/i18n"
import { buildHelpCenterHref } from "@/lib/help-center"
import { cn } from "@/lib/utils"

type HelpCenterLinkProps = {
  showLabel?: boolean
  className?: string
  onNavigate?: () => void
}

export function HelpCenterLink({
  showLabel = false,
  className,
  onNavigate,
}: HelpCenterLinkProps) {
  const { t, i18n } = useTranslation()
  const location = useLocation()
  const language = normalizeLanguage(i18n.resolvedLanguage) ?? "zh-CN"
  const href = buildHelpCenterHref(location.pathname, language)
  const label = t("nav.helpCenter")
  const link = (
    <a
      href={href}
      target="_blank"
      rel="noreferrer noopener"
      aria-label={showLabel ? undefined : t("nav.helpCenterNewTab")}
      onClick={onNavigate}
      className={cn(
        buttonVariants({
          variant: "ghost",
          size: showLabel ? "sm" : "icon",
        }),
        showLabel && "justify-start",
        className
      )}
    >
      <CircleHelpIcon aria-hidden="true" />
      {showLabel && <span>{label}</span>}
    </a>
  )

  if (showLabel) return link

  return (
    <Tooltip>
      <TooltipTrigger render={link} />
      <TooltipContent side="top">{label}</TooltipContent>
    </Tooltip>
  )
}
