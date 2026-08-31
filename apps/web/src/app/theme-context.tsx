import {
  useCallback,
  useLayoutEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react"

import {
  SYSTEM_THEME_QUERY,
  applyThemePreference,
  persistThemePreference,
  readStoredThemePreference,
  type ThemePreference,
} from "@/app/theme"
import {
  applyUiFontSize,
  clampUiFontSize,
  persistUiFontSize,
  readStoredUiFontSize,
} from "@/app/ui-font-size"
import { ThemeContext } from "@/app/theme-state"

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<ThemePreference>(
    readStoredThemePreference
  )
  const [uiFontSize, setUiFontSizeState] = useState(readStoredUiFontSize)

  useLayoutEffect(() => {
    const mediaQuery = window.matchMedia(SYSTEM_THEME_QUERY)
    const applyCurrentTheme = () =>
      applyThemePreference(theme, mediaQuery.matches)

    applyCurrentTheme()
    if (theme !== "system") return

    mediaQuery.addEventListener("change", applyCurrentTheme)
    return () => mediaQuery.removeEventListener("change", applyCurrentTheme)
  }, [theme])

  useLayoutEffect(() => {
    applyUiFontSize(uiFontSize)
  }, [uiFontSize])

  const setTheme = useCallback((nextTheme: ThemePreference) => {
    persistThemePreference(nextTheme)
    applyThemePreference(nextTheme)
    setThemeState(nextTheme)
  }, [])

  const setUiFontSize = useCallback((nextFontSize: number) => {
    const fontSize = clampUiFontSize(nextFontSize)
    persistUiFontSize(fontSize)
    setUiFontSizeState(fontSize)
  }, [])

  const value = useMemo(
    () => ({ theme, setTheme, uiFontSize, setUiFontSize }),
    [setTheme, setUiFontSize, theme, uiFontSize]
  )

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}
