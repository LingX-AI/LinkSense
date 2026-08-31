import { createContext, useContext } from "react"

import type { ThemePreference } from "@/app/theme"

export type ThemeContextValue = {
  theme: ThemePreference
  setTheme: (theme: ThemePreference) => void
  uiFontSize: number
  setUiFontSize: (fontSize: number) => void
}

export const ThemeContext = createContext<ThemeContextValue | null>(null)

export function useTheme() {
  const context = useContext(ThemeContext)
  if (!context) {
    throw new Error("useTheme must be used within ThemeProvider")
  }
  return context
}
