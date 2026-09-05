import { cleanup } from "@testing-library/react"
import { afterAll, afterEach, beforeEach, vi } from "vitest"
import i18n from "@/i18n"
import { setAccessToken } from "@/api/session"

beforeEach(async () => {
  await i18n.changeLanguage("zh-CN")
  window.localStorage.clear()
  window.sessionStorage.clear()
})

// RTL's automatic hook is registered only on its first module import. Register
// it for every file when the module graph and jsdom window are reused.
afterEach(cleanup)

afterAll(() => {
  setAccessToken(null)
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
  window.history.replaceState(null, "", "/")
  // Layout and dialog tests also write directly to the document outside RTL.
  document.body.replaceChildren()
  for (const attribute of [...document.body.attributes]) {
    document.body.removeAttribute(attribute.name)
  }
  document.documentElement.classList.remove("dark")
  delete document.documentElement.dataset.theme
  delete document.documentElement.dataset.themePreference
  delete document.documentElement.dataset.uiFontSize
  document.documentElement.style.removeProperty("--app-ui-font-size")
  document.documentElement.style.colorScheme = ""
})
