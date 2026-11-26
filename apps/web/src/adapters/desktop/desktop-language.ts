import { onLocaleChange } from "mygo-runtime"

import {
  getStoredLanguagePreference,
  normalizeLanguage,
  setAppLanguage,
  setNativeLanguageSync,
  type SupportedLanguage,
} from "@/i18n"

import { Desktop } from "./mygo"

function isMacDesktopLanguageHost() {
  // The runtime is present before the MyGo document starts, so the shell
  // language can be read and synced without waiting for Desktop.info.
  return window.mygo?.platform === "darwin"
}

let disposeDesktopLanguage: (() => void) | null = null

/**
 * Connects the shared main document to the macOS app language:
 *
 * - an explicit Web/account choice (the persisted `linksense.language`) is
 *   also applied to the native app, tray, menus, and app-owned notifications;
 * - while no explicit choice exists, native/system changes reach the Web UI
 *   without being persisted or echoed back;
 * - an existing saved Web preference wins over the native startup locale and
 *   is replayed once, so upgraded installs need no reload or resave.
 *
 * Native writes run one at a time: MyGo starts each IPC call on its own
 * goroutine and applies `SetLocale` in the order those goroutines reach the
 * main thread, so two writes can otherwise apply out of order. The tail keeps
 * one write outstanding and the revision drops a queued choice a newer one
 * replaced, which also keeps a disposed adapter from writing.
 *
 * Returns the one subscription's cleanup. Browsers and Windows keep their
 * existing behavior.
 */
export function installDesktopLanguageSync(): () => void {
  if (disposeDesktopLanguage) return disposeDesktopLanguage
  if (!isMacDesktopLanguageHost()) return () => undefined

  const stored = getStoredLanguagePreference()
  let disposed = false
  let explicitLanguageActive = stored !== null
  let writeTail: Promise<void> = Promise.resolve()
  let writeRevision = 0

  const syncNativeLanguage = (language: SupportedLanguage) => {
    const revision = ++writeRevision
    writeTail = writeTail
      .then(() => {
        if (disposed || revision !== writeRevision) return
        return Desktop.setLocale(language)
      })
      .catch(() => undefined)
  }

  setNativeLanguageSync((language) => {
    explicitLanguageActive = true
    syncNativeLanguage(language)
  })

  let unsubscribe: () => void = () => undefined
  try {
    unsubscribe = onLocaleChange((tag) => {
      if (explicitLanguageActive) return
      const language = normalizeLanguage(tag)
      if (!language) return
      void setAppLanguage(language, { persist: false }).catch(() => undefined)
    })
  } catch {
    // An older host keeps the current Web language and never blocks rendering.
  }

  if (stored) syncNativeLanguage(stored)

  const dispose = () => {
    disposed = true
    unsubscribe()
    setNativeLanguageSync(null)
    if (disposeDesktopLanguage === dispose) disposeDesktopLanguage = null
  }
  disposeDesktopLanguage = dispose
  return dispose
}
