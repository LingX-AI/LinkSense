import { act, cleanup, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import {
  applyThemePreference,
  initializeTheme,
  normalizeThemePreference,
  readStoredThemePreference,
  resolveThemePreference,
} from "@/app/theme"
import { ThemeProvider } from "@/app/theme-context"
import { useTheme } from "@/app/theme-state"

function installMatchMedia(initialMatches: boolean) {
  let matches = initialMatches
  const listeners = new Set<EventListener>()
  const mediaQuery = {
    get matches() {
      return matches
    },
    media: "(prefers-color-scheme: dark)",
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(
      (_type: string, listener: EventListenerOrEventListenerObject) => {
        if (typeof listener === "function") listeners.add(listener)
      }
    ),
    removeEventListener: vi.fn(
      (_type: string, listener: EventListenerOrEventListenerObject) => {
        if (typeof listener === "function") listeners.delete(listener)
      }
    ),
    dispatchEvent: vi.fn(),
  } as unknown as MediaQueryList

  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => mediaQuery)
  )

  return {
    mediaQuery,
    setMatches(nextMatches: boolean) {
      matches = nextMatches
      const event = new Event("change")
      listeners.forEach((listener) => listener(event))
    },
  }
}

function ThemeProbe() {
  const { theme, setTheme, uiFontSize, setUiFontSize } = useTheme()
  return (
    <div>
      <output>{theme}</output>
      <output data-testid="ui-font-size">{uiFontSize}</output>
      <button type="button" onClick={() => setTheme("system")}>
        system
      </button>
      <button type="button" onClick={() => setTheme("light")}>
        light
      </button>
      <button type="button" onClick={() => setTheme("dark")}>
        dark
      </button>
      <button type="button" onClick={() => setUiFontSize(18)}>
        font-18
      </button>
    </div>
  )
}

describe("theme preferences", () => {
  beforeEach(() => {
    window.localStorage.clear()
    document.documentElement.classList.remove("dark")
    delete document.documentElement.dataset.theme
    delete document.documentElement.dataset.themePreference
    delete document.documentElement.dataset.uiFontSize
    document.documentElement.style.removeProperty("--app-ui-font-size")
    document.documentElement.style.colorScheme = ""
    document.querySelector('meta[name="theme-color"]')?.remove()
  })

  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
    document.documentElement.classList.remove("dark")
    delete document.documentElement.dataset.theme
    delete document.documentElement.dataset.themePreference
    delete document.documentElement.dataset.uiFontSize
    document.documentElement.style.removeProperty("--app-ui-font-size")
    document.documentElement.style.colorScheme = ""
    document.querySelector('meta[name="theme-color"]')?.remove()
  })

  it("normalizes only supported values and resolves the system preference", () => {
    expect(normalizeThemePreference("system")).toBe("system")
    expect(normalizeThemePreference("light")).toBe("light")
    expect(normalizeThemePreference("dark")).toBe("dark")
    expect(normalizeThemePreference("sepia")).toBeNull()
    expect(normalizeThemePreference(null)).toBeNull()
    expect(resolveThemePreference("system", false)).toBe("light")
    expect(resolveThemePreference("system", true)).toBe("dark")
    expect(resolveThemePreference("light", true)).toBe("light")
    expect(resolveThemePreference("dark", false)).toBe("dark")
  })

  it("falls back to system when storage is empty, invalid, or unavailable", () => {
    expect(readStoredThemePreference()).toBe("system")
    window.localStorage.setItem("linksense.theme", "sepia")
    expect(readStoredThemePreference()).toBe("system")
    vi.spyOn(window.localStorage, "getItem").mockImplementation(() => {
      throw new Error("storage blocked")
    })
    expect(readStoredThemePreference()).toBe("system")
  })

  it("initializes the saved theme before React renders", () => {
    installMatchMedia(false)
    window.localStorage.setItem("linksense.theme", "dark")

    expect(initializeTheme()).toBe("dark")
    expect(document.documentElement).toHaveClass("dark")
    expect(document.documentElement).toHaveAttribute("data-theme", "dark")
    expect(document.documentElement).toHaveAttribute(
      "data-theme-preference",
      "dark"
    )
    expect(document.documentElement.style.colorScheme).toBe("dark")
  })

  it("applies each resolved theme to the document root", () => {
    applyThemePreference("system", true)
    expect(document.documentElement).toHaveClass("dark")
    expect(document.documentElement.dataset.theme).toBe("dark")
    expect(document.documentElement.dataset.themePreference).toBe("system")
    expect(document.querySelector('meta[name="theme-color"]')).toHaveAttribute(
      "content",
      "#141414"
    )

    applyThemePreference("light", true)
    expect(document.documentElement).not.toHaveClass("dark")
    expect(document.documentElement.dataset.theme).toBe("light")
    expect(document.documentElement.dataset.themePreference).toBe("light")
    expect(document.documentElement.style.colorScheme).toBe("light")
    expect(document.querySelector('meta[name="theme-color"]')).toHaveAttribute(
      "content",
      "#ffffff"
    )
  })

  it("switches immediately, persists the choice, and follows system changes", async () => {
    const media = installMatchMedia(false)
    const interaction = userEvent.setup()
    render(
      <ThemeProvider>
        <ThemeProbe />
      </ThemeProvider>
    )

    expect(screen.getByText("system", { selector: "output" })).toBeVisible()
    expect(document.documentElement.dataset.theme).toBe("light")

    await interaction.click(screen.getByRole("button", { name: "dark" }))
    expect(document.documentElement).toHaveClass("dark")
    expect(window.localStorage.getItem("linksense.theme")).toBe("dark")

    await interaction.click(screen.getByRole("button", { name: "system" }))
    expect(window.localStorage.getItem("linksense.theme")).toBe("system")
    expect(document.documentElement).not.toHaveClass("dark")

    act(() => media.setMatches(true))
    expect(document.documentElement).toHaveClass("dark")
    expect(document.documentElement.dataset.theme).toBe("dark")
  })

  it("stops following the system for a fixed theme and removes listeners", async () => {
    const media = installMatchMedia(false)
    const interaction = userEvent.setup()
    const { unmount } = render(
      <ThemeProvider>
        <ThemeProbe />
      </ThemeProvider>
    )

    expect(media.mediaQuery.addEventListener).toHaveBeenCalledWith(
      "change",
      expect.any(Function)
    )
    await interaction.click(screen.getByRole("button", { name: "light" }))
    expect(media.mediaQuery.removeEventListener).toHaveBeenCalledWith(
      "change",
      expect.any(Function)
    )

    act(() => media.setMatches(true))
    expect(document.documentElement).not.toHaveClass("dark")
    unmount()
  })

  it("keeps the current-page theme available when persistence is blocked", async () => {
    installMatchMedia(false)
    vi.spyOn(window.localStorage, "setItem").mockImplementation(() => {
      throw new Error("storage blocked")
    })
    const interaction = userEvent.setup()
    render(
      <ThemeProvider>
        <ThemeProbe />
      </ThemeProvider>
    )

    await interaction.click(screen.getByRole("button", { name: "dark" }))
    expect(document.documentElement).toHaveClass("dark")
    expect(screen.getByText("dark", { selector: "output" })).toBeVisible()
  })

  it("restores, applies, and persists the UI font size", async () => {
    installMatchMedia(false)
    window.localStorage.setItem("linksense.uiFontSize", "12")
    const interaction = userEvent.setup()
    render(
      <ThemeProvider>
        <ThemeProbe />
      </ThemeProvider>
    )

    expect(screen.getByTestId("ui-font-size")).toHaveTextContent("12")
    expect(document.documentElement.dataset.uiFontSize).toBe("12")
    expect(
      document.documentElement.style.getPropertyValue("--app-ui-font-size")
    ).toBe("12px")

    await interaction.click(screen.getByRole("button", { name: "font-18" }))
    expect(screen.getByTestId("ui-font-size")).toHaveTextContent("18")
    expect(window.localStorage.getItem("linksense.uiFontSize")).toBe("18")
    expect(document.documentElement.dataset.uiFontSize).toBe("18")
  })

  it("keeps the current-page UI font size when persistence is blocked", async () => {
    installMatchMedia(false)
    vi.spyOn(window.localStorage, "setItem").mockImplementation(() => {
      throw new Error("storage blocked")
    })
    const interaction = userEvent.setup()
    render(
      <ThemeProvider>
        <ThemeProbe />
      </ThemeProvider>
    )

    await interaction.click(screen.getByRole("button", { name: "font-18" }))
    expect(screen.getByTestId("ui-font-size")).toHaveTextContent("18")
    expect(document.documentElement.dataset.uiFontSize).toBe("18")
  })
})
