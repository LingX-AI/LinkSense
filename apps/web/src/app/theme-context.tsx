import {
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react"
import { flushSync } from "react-dom"

import {
  SYSTEM_THEME_QUERY,
  applyThemePreference,
  persistThemePreference,
  readStoredThemePreference,
  resolveThemePreference,
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
  const latestTheme = useRef(theme)
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
    latestTheme.current = nextTheme
    persistThemePreference(nextTheme)
    const updateTheme = () => {
      if (latestTheme.current !== nextTheme) return
      applyThemePreference(nextTheme)
      setThemeState(nextTheme)
    }
    const resolvedTheme = resolveThemePreference(
      nextTheme,
      window.matchMedia(SYSTEM_THEME_QUERY).matches
    )
    if (
      typeof document.startViewTransition !== "function" ||
      window.matchMedia("(prefers-reduced-motion: reduce)").matches ||
      document.documentElement.dataset.theme === resolvedTheme
    ) {
      updateTheme()
      return
    }
    const transition = document.startViewTransition(() => flushSync(updateTheme))
    void transition.ready.catch(() => transition.skipTransition())
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
