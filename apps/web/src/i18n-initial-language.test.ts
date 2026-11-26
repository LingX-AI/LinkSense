import { afterEach, describe, expect, it, vi } from "vitest"

function setNativeRuntime(platform: string, locale: string) {
  Object.defineProperty(window, "mygo", {
    configurable: true,
    value: { platform, locale },
  })
}

afterEach(() => {
  delete (window as { mygo?: unknown }).mygo
  window.localStorage.clear()
  vi.resetModules()
})

describe("initial application language", () => {
  it("starts from MyGo's macOS language when nothing is saved", async () => {
    window.localStorage.clear()
    setNativeRuntime("darwin", "ja-JP")

    const { default: i18n } = await import("@/i18n")

    expect(i18n.language).toBe("ja-JP")
    expect(document.documentElement.lang).toBe("ja-JP")
    expect(window.localStorage.getItem("linksense.language")).toBeNull()
  })

  it("prefers the saved Web preference over the native language", async () => {
    window.localStorage.setItem("linksense.language", "fr-FR")
    setNativeRuntime("darwin", "ja-JP")

    const { default: i18n } = await import("@/i18n")

    expect(i18n.language).toBe("fr-FR")
    expect(document.documentElement.lang).toBe("fr-FR")
    expect(window.localStorage.getItem("linksense.language")).toBe("fr-FR")
  })

  it("ignores a Windows runtime locale", async () => {
    window.localStorage.clear()
    setNativeRuntime("win32", "ja-JP")

    const { default: i18n, resolveBrowserLanguage } = await import("@/i18n")

    expect(i18n.language).toBe(
      resolveBrowserLanguage(window.navigator.languages, window.navigator.language)
    )
    expect(i18n.language).not.toBe("ja-JP")
    expect(window.localStorage.getItem("linksense.language")).toBeNull()
  })
})
