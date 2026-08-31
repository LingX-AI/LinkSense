export const BROWSER_NOTIFICATION_PROMPT_DISMISSED_STORAGE_KEY_PREFIX =
  "linksense.browserNotifications.promptDismissed"

const transientDismissedUsers = new Set<string>()

export function browserNotificationPromptDismissedStorageKey(userId: string) {
  return `${BROWSER_NOTIFICATION_PROMPT_DISMISSED_STORAGE_KEY_PREFIX}:${userId}`
}

export function readBrowserNotificationPromptDismissed(userId: string) {
  if (transientDismissedUsers.has(userId)) return true
  try {
    return (
      window.sessionStorage.getItem(
        browserNotificationPromptDismissedStorageKey(userId)
      ) === "true"
    )
  } catch {
    return false
  }
}

export function dismissBrowserNotificationPrompt(userId: string) {
  try {
    const storageKey = browserNotificationPromptDismissedStorageKey(userId)
    window.sessionStorage.setItem(storageKey, "true")
    if (window.sessionStorage.getItem(storageKey) === "true") return true
  } catch {
    transientDismissedUsers.add(userId)
    return false
  }
  transientDismissedUsers.add(userId)
  return false
}
