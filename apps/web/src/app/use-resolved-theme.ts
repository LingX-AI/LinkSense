import { useEffect, useState } from "react"
import { SYSTEM_THEME_QUERY } from "@/app/theme"

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

export function useResolvedTheme() {
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
