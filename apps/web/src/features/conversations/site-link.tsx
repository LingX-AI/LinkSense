import { useEffect, useState, type ComponentPropsWithoutRef } from "react"
import { LinkIcon } from "lucide-react"

import {
  getHttpsSiteIconOrigin,
  isExternalHttpLink,
  loadSiteIcon,
} from "@/features/conversations/site-link-utils"

type SiteIconState = Readonly<{ origin: string; objectUrl: string }> | null

export function SiteLink({
  href,
  children,
  siteIconEnabled = true,
  ...props
}: ComponentPropsWithoutRef<"a"> & { siteIconEnabled?: boolean }) {
  const iconOrigin = getHttpsSiteIconOrigin(href)
  const [icon, setIcon] = useState<SiteIconState>(null)
  const iconUrl =
    siteIconEnabled && icon?.origin === iconOrigin ? icon.objectUrl : null
  const shouldShowIcon = isExternalHttpLink(href)

  useEffect(() => {
    if (!siteIconEnabled || !iconOrigin) return

    let cancelled = false
    let objectUrl: string | null = null

    void loadSiteIcon(iconOrigin).then((blob) => {
      if (!blob || cancelled) return

      objectUrl = URL.createObjectURL(blob)
      if (cancelled) {
        URL.revokeObjectURL(objectUrl)
        return
      }

      setIcon({ origin: iconOrigin, objectUrl })
    })

    return () => {
      cancelled = true
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl)
      }
    }
  }, [iconOrigin, siteIconEnabled])

  return (
    <a {...props} href={href}>
      {shouldShowIcon && (
        <span
          className="site-link-icon"
          data-slot="site-link-icon"
          aria-hidden="true"
        >
          {iconUrl ? (
            <img src={iconUrl} alt="" width="16" height="16" decoding="async" />
          ) : (
            <LinkIcon strokeWidth={1.75} />
          )}
        </span>
      )}
      {children}
    </a>
  )
}
