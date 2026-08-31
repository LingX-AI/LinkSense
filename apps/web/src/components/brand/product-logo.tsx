import { useContext, useEffect, useState } from "react"

import { BootstrapContext } from "@/app/bootstrap-state"
import { SYSTEM_THEME_QUERY } from "@/app/theme"
import linksenseLockupOnDark from "@/assets/brand/linksense-lockup-on-dark.svg"
import linksenseLockupPrimary from "@/assets/brand/linksense-lockup-primary.svg"
import { cn } from "@/lib/utils"

type ProductLogoProps = {
  productName: string
  logoUrl?: string | null
  className?: string
}

function readResolvedTheme(): "light" | "dark" {
  if (typeof document !== "undefined") {
    const theme = document.documentElement.dataset.theme
    if (theme === "dark" || theme === "light") return theme
    if (document.documentElement.classList.contains("dark")) return "dark"
  }

  if (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function"
  ) {
    return window.matchMedia(SYSTEM_THEME_QUERY).matches ? "dark" : "light"
  }

  return "light"
}

function useResolvedTheme() {
  const [resolvedTheme, setResolvedTheme] = useState(readResolvedTheme)

  useEffect(() => {
    const syncTheme = () => setResolvedTheme(readResolvedTheme())
    syncTheme()

    const root = document.documentElement
    const observer = new MutationObserver(syncTheme)
    observer.observe(root, {
      attributes: true,
      attributeFilter: ["class", "data-theme"],
    })

    const mediaQuery =
      typeof window.matchMedia === "function"
        ? window.matchMedia(SYSTEM_THEME_QUERY)
        : null
    mediaQuery?.addEventListener("change", syncTheme)

    return () => {
      observer.disconnect()
      mediaQuery?.removeEventListener("change", syncTheme)
    }
  }, [])

  return resolvedTheme
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
