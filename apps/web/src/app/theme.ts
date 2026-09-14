export const themePreferences = ["system", "light", "dark"] as const

export type ThemePreference = (typeof themePreferences)[number]
export type ResolvedTheme = Exclude<ThemePreference, "system">

const THEME_STORAGE_KEY = "linksense.theme"
const THEME_COLORS: Record<ResolvedTheme, string> = {
  light: "#ffffff",
  dark: "#141414",
}
export const SYSTEM_THEME_QUERY = "(prefers-color-scheme: dark)"

function applyThemeColor(resolvedTheme: ResolvedTheme) {
  const metadata =
    document.querySelector<HTMLMetaElement>('meta[name="theme-color"]') ??
    document.head.appendChild(document.createElement("meta"))
  metadata.name = "theme-color"
  metadata.content = THEME_COLORS[resolvedTheme]
}

export function normalizeThemePreference(
  value: string | null | undefined
): ThemePreference | null {
  return themePreferences.find((theme) => theme === value) ?? null
}

export function readStoredThemePreference(): ThemePreference {
  try {
    return (
      normalizeThemePreference(
        window.localStorage?.getItem(THEME_STORAGE_KEY)
      ) ?? "system"
    )
  } catch {
    return "system"
  }
}

export function resolveThemePreference(
  preference: ThemePreference,
  systemPrefersDark: boolean
): ResolvedTheme {
  if (preference === "system") return systemPrefersDark ? "dark" : "light"
  return preference
}

export function applyThemePreference(
  preference: ThemePreference,
  systemPrefersDark = window.matchMedia(SYSTEM_THEME_QUERY).matches
) {
  const resolvedTheme = resolveThemePreference(preference, systemPrefersDark)
  const root = document.documentElement
  root.classList.toggle("dark", resolvedTheme === "dark")
  root.dataset.theme = resolvedTheme
  root.dataset.themePreference = preference
  root.style.colorScheme = resolvedTheme
  applyThemeColor(resolvedTheme)
}

export function initializeTheme() {
  const preference = readStoredThemePreference()
  applyThemePreference(preference)
  return preference
}

export function persistThemePreference(preference: ThemePreference) {
  try {
    window.localStorage?.setItem(THEME_STORAGE_KEY, preference)
  } catch {
    // Theme switching remains available when browser storage is disabled.
  }
}
