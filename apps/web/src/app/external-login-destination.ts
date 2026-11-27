import { browserExtensionSettingsPath } from "@/features/browser-use/settings-path"

const setupReturnKey = "linksense.browser-use-login-return"
const setupReturnLifetimeMs = 15 * 60_000

export function rememberBrowserUseLoginReturn(state: unknown): void {
  try {
    if (
      typeof state === "object" &&
      state !== null &&
      "from" in state &&
      state.from === browserExtensionSettingsPath &&
      (!("fromUserId" in state) || state.fromUserId === undefined)
    ) {
      sessionStorage.setItem(
        setupReturnKey,
        String(Date.now() + setupReturnLifetimeMs)
      )
    } else {
      sessionStorage.removeItem(setupReturnKey)
    }
  } catch {
    return
  }
}

export function externalLoginDestination(): string {
  const returnToSetup = takeBrowserUseLoginReturn()
  return returnToSetup ? browserExtensionSettingsPath : "/conversations/new"
}

function takeBrowserUseLoginReturn(): boolean {
  try {
    const expiresAt = Number(sessionStorage.getItem(setupReturnKey))
    sessionStorage.removeItem(setupReturnKey)
    return Number.isFinite(expiresAt) && expiresAt > Date.now()
  } catch {
    return false
  }
}
