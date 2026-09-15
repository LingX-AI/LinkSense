import { useContext, useState } from "react"

import { BootstrapContext } from "@/app/bootstrap-state"
import { useResolvedTheme } from "@/app/use-resolved-theme"
import linksenseLockupOnDark from "@/assets/brand/linksense-lockup-on-dark.svg"
import linksenseLockupPrimary from "@/assets/brand/linksense-lockup-primary.svg"
import { cn } from "@/lib/utils"

type ProductLogoProps = {
  productName: string
  logoUrl?: string | null
  className?: string
}

export function ProductLogo({
  productName,
  logoUrl,
  className,
}: ProductLogoProps) {
  const bootstrap = useContext(BootstrapContext)
  const resolvedTheme = useResolvedTheme()
  const configuredLogoUrl = logoUrl ?? bootstrap?.bootstrap?.logo_url ?? null
  const [failedLogoUrl, setFailedLogoUrl] = useState<string | null>(null)
  const defaultLogoUrl =
    resolvedTheme === "dark" ? linksenseLockupOnDark : linksenseLockupPrimary
  const src =
    configuredLogoUrl && configuredLogoUrl !== failedLogoUrl
      ? configuredLogoUrl
      : defaultLogoUrl

  return (
    <img
      src={src}
      alt={productName}
      width="348"
      height="94"
      className={cn("product-logo", className)}
      decoding="async"
      fetchPriority="high"
      onError={() => {
        if (configuredLogoUrl) setFailedLogoUrl(configuredLogoUrl)
      }}
    />
  )
}
