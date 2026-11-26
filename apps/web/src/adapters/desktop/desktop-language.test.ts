import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import i18n, { setAppLanguage, supportedLanguages } from "@/i18n"
import { installDesktopLanguageSync } from "./desktop-language"

const native = vi.hoisted(() => ({
  subscribeThrows: false,
  listener: null as ((locale: string) => void) | null,
  unsubscribe: vi.fn(),
  setLocale: vi.fn<(tag: string) => Promise<void>>(),
}))

vi.mock("mygo-runtime", () => ({
  onLocaleChange: (listener: (locale: string) => void) => {
    if (native.subscribeThrows) throw new Error("DESKTOP_LOCALE_UNSUPPORTED")
    native.listener = listener
    return native.unsubscribe
  },
}))
vi.mock("./mygo", () => ({ Desktop: { setLocale: native.setLocale } }))

function setNativePlatform(platform: "darwin" | "win32" | null) {
  if (platform === null) {
    delete (window as { mygo?: unknown }).mygo
    return
  }
  Object.defineProperty(window, "mygo", {
    configurable: true,
    value: { platform },
  })
}

// The host applies each write when its reply settles: a delayed reply means a
// late native apply. A later call that is sent while an older one is held is
// applied by MyGo as soon as the main thread reaches it, even if the older
// goroutine reports later, which is the ordering this adapter must prevent.
type HeldWrite = { locale: string; release: () => void }
let heldWrites: HeldWrite[] = []
let appliedWrites: string[] = []
let holdNextWrite = false

function deferNativeApplication() {
  holdNextWrite = true
  native.setLocale.mockImplementation((locale: string) => {
    if (holdNextWrite) {
      holdNextWrite = false
      return new Promise<void>((resolve) => {
        heldWrites.push({
          locale,
          release: () => {
            appliedWrites.push(locale)
            resolve()
          },
        })
      })
    }
    appliedWrites.push(locale)
    return Promise.resolve()
  })
}

let dispose: (() => void) | null = null

beforeEach(async () => {
  window.localStorage.clear()
  native.listener = null
  native.subscribeThrows = false
  native.unsubscribe.mockClear()
  native.setLocale.mockReset()
  heldWrites = []
  appliedWrites = []
  holdNextWrite = false
  native.setLocale.mockImplementation(async (locale: string) => {
    appliedWrites.push(locale)
  })
  setNativePlatform("darwin")
  await i18n.changeLanguage("zh-CN")
})

afterEach(() => {
  dispose?.()
  dispose = null
  setNativePlatform(null)
  window.localStorage.clear()
})

describe("macOS app language synchronization", () => {
  it.each(supportedLanguages)(
    "makes an explicit %s choice native at once",
    async (locale) => {
      dispose = installDesktopLanguageSync()
      expect(native.setLocale).not.toHaveBeenCalled()

      await setAppLanguage(locale)

      expect(native.setLocale).toHaveBeenCalledTimes(1)
      expect(native.setLocale).toHaveBeenCalledWith(locale)
      expect(i18n.language).toBe(locale)
      expect(document.documentElement.lang).toBe(locale)
      expect(window.localStorage.getItem("linksense.language")).toBe(locale)
    }
  )

  it("replays a saved Web preference at initialization", async () => {
    window.localStorage.setItem("linksense.language", "en-US")
    await i18n.changeLanguage("en-US")

    dispose = installDesktopLanguageSync()

    await vi.waitFor(() =>
      expect(native.setLocale).toHaveBeenCalledWith("en-US")
    )
    expect(window.localStorage.getItem("linksense.language")).toBe("en-US")
    expect(i18n.language).toBe("en-US")
  })

  it("follows native changes while no explicit preference exists", async () => {
    dispose = installDesktopLanguageSync()
    native.listener?.("es-ES")

    await vi.waitFor(() => expect(i18n.language).toBe("es-ES"))
    expect(document.documentElement.lang).toBe("es-ES")
    expect(window.localStorage.getItem("linksense.language")).toBeNull()
    expect(native.setLocale).not.toHaveBeenCalled()
  })

  it("ignores native changes after an explicit choice", async () => {
    window.localStorage.setItem("linksense.language", "fr-FR")
    await i18n.changeLanguage("fr-FR")
    dispose = installDesktopLanguageSync()
    await vi.waitFor(() =>
      expect(native.setLocale).toHaveBeenCalledWith("fr-FR")
    )
    native.setLocale.mockClear()

    native.listener?.("ja-JP")
    await Promise.resolve()
    await Promise.resolve()

    expect(i18n.language).toBe("fr-FR")
    expect(document.documentElement.lang).toBe("fr-FR")
    expect(native.setLocale).not.toHaveBeenCalled()
  })

  it("ignores unsupported or missing native language values", async () => {
    dispose = installDesktopLanguageSync()
    native.listener?.("de-DE")
    native.listener?.("")
    await Promise.resolve()
    await Promise.resolve()

    expect(i18n.language).toBe("zh-CN")
    expect(document.documentElement.lang).toBe("zh-CN")
  })

  it("keeps non-persistent callers off native storage", async () => {
    dispose = installDesktopLanguageSync()

    await setAppLanguage("en-US", { persist: false })

    expect(i18n.language).toBe("en-US")
    expect(document.documentElement.lang).toBe("en-US")
    expect(window.localStorage.getItem("linksense.language")).toBeNull()
    expect(native.setLocale).not.toHaveBeenCalled()
  })

  it("keeps working when the bridge and native sync fail", async () => {
    native.subscribeThrows = true
    native.setLocale.mockRejectedValueOnce(new Error("DESKTOP_LOCALE_FAILED"))

    dispose = installDesktopLanguageSync()
    await setAppLanguage("ja-JP")

    expect(i18n.language).toBe("ja-JP")
    expect(document.documentElement.lang).toBe("ja-JP")
    expect(window.localStorage.getItem("linksense.language")).toBe("ja-JP")
    expect(native.setLocale).toHaveBeenCalledWith("ja-JP")

    await setAppLanguage("es-ES")

    await vi.waitFor(() =>
      expect(native.setLocale).toHaveBeenLastCalledWith("es-ES")
    )
    expect(i18n.language).toBe("es-ES")
  })

  it("does not install in a browser or on Windows", async () => {
    for (const platform of ["win32", null] as const) {
      setNativePlatform(platform)
      dispose = installDesktopLanguageSync()
      expect(native.listener).toBeNull()

      await setAppLanguage("en-US")

      expect(native.setLocale).not.toHaveBeenCalled()
      expect(window.localStorage.getItem("linksense.language")).toBe("en-US")
      dispose()
      dispose = null
      window.localStorage.clear()
      await i18n.changeLanguage("zh-CN")
    }
  })

  it("sends only the latest overlapping explicit choice", async () => {
    dispose = installDesktopLanguageSync()

    const first = setAppLanguage("fr-FR")
    const second = setAppLanguage("ja-JP")
    await Promise.all([first, second])

    expect(i18n.language).toBe("ja-JP")
    expect(document.documentElement.lang).toBe("ja-JP")
    expect(window.localStorage.getItem("linksense.language")).toBe("ja-JP")
    expect(native.setLocale).toHaveBeenCalledTimes(1)
    expect(native.setLocale).toHaveBeenCalledWith("ja-JP")
  })

  it("applies a newer explicit choice after a delayed startup replay", async () => {
    window.localStorage.setItem("linksense.language", "fr-FR")
    await i18n.changeLanguage("fr-FR")
    deferNativeApplication()

    dispose = installDesktopLanguageSync()
    await vi.waitFor(() => expect(heldWrites).toHaveLength(1))
    expect(heldWrites[0].locale).toBe("fr-FR")

    await setAppLanguage("ja-JP")

    expect(i18n.language).toBe("ja-JP")
    expect(document.documentElement.lang).toBe("ja-JP")
    expect(window.localStorage.getItem("linksense.language")).toBe("ja-JP")
    // The held French write is the only one outstanding: a native write that
    // ran now could still be applied after the newer Japanese one.
    expect(native.setLocale).toHaveBeenCalledTimes(1)
    expect(appliedWrites).toEqual([])

    heldWrites[0].release()

    await vi.waitFor(() => expect(appliedWrites).toEqual(["fr-FR", "ja-JP"]))
    expect(native.setLocale).toHaveBeenCalledTimes(2)
    expect(appliedWrites.at(-1)).toBe("ja-JP")
  })

  it("orders rapid persisted changes behind an in-flight native write", async () => {
    deferNativeApplication()
    dispose = installDesktopLanguageSync()
    expect(native.setLocale).not.toHaveBeenCalled()

    await setAppLanguage("fr-FR")
    await vi.waitFor(() => expect(heldWrites).toHaveLength(1))
    expect(heldWrites[0].locale).toBe("fr-FR")

    await setAppLanguage("ja-JP")

    expect(i18n.language).toBe("ja-JP")
    expect(document.documentElement.lang).toBe("ja-JP")
    expect(window.localStorage.getItem("linksense.language")).toBe("ja-JP")
    expect(native.setLocale).toHaveBeenCalledTimes(1)

    heldWrites[0].release()

    await vi.waitFor(() => expect(appliedWrites).toEqual(["fr-FR", "ja-JP"]))
    expect(appliedWrites.at(-1)).toBe("ja-JP")
  })

  it("drops queued native writes after cleanup", async () => {
    deferNativeApplication()
    dispose = installDesktopLanguageSync()

    await setAppLanguage("fr-FR")
    await vi.waitFor(() => expect(heldWrites).toHaveLength(1))
    await setAppLanguage("ja-JP")

    dispose()
    dispose = null
    heldWrites[0].release()

    await vi.waitFor(() => expect(appliedWrites).toEqual(["fr-FR"]))
    await Promise.resolve()
    await Promise.resolve()
    expect(native.setLocale).toHaveBeenCalledTimes(1)
  })

  it("removes its subscription and native handler on cleanup", async () => {
    dispose = installDesktopLanguageSync()
    dispose()
    dispose = null

    expect(native.unsubscribe).toHaveBeenCalled()
    await setAppLanguage("es-ES")

    expect(native.setLocale).not.toHaveBeenCalled()
  })
})
