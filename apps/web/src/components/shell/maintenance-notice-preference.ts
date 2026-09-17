import { useCallback, useSyncExternalStore } from "react"
import { z } from "zod"

const preferenceChangedEvent = "linksense:maintenance-notice-preference-changed"
const periodSchema = z.uuid()

export function maintenanceNoticeStorageKey(userId: string): string {
  return `linksense.maintenance-notice.dismissed:${encodeURIComponent(userId)}`
}

function readDismissedPeriod(userId: string): string | null {
  try {
    const parsed = periodSchema.safeParse(
      window.localStorage.getItem(maintenanceNoticeStorageKey(userId))
    )
    return parsed.success ? parsed.data : null
  } catch {
    // Storage may be blocked. The reminder must still be usable.
    return null
  }
}

export function rememberDismissedMaintenance(
  userId: string,
  periodId: string
): boolean {
  const parsed = periodSchema.safeParse(periodId)
  if (!parsed.success) return false
  try {
    window.localStorage.setItem(
      maintenanceNoticeStorageKey(userId),
      parsed.data
    )
    if (readDismissedPeriod(userId) !== parsed.data) return false
  } catch {
    return false
  }
  // Native storage events notify other tabs; this notifies this tab's subscribers.
  window.dispatchEvent(new Event(preferenceChangedEvent))
  return true
}

export function useDismissedMaintenance(userId: string): string | null {
  const subscribe = useCallback(
    (onChange: () => void) => {
      const onStorage = (event: StorageEvent) => {
        if (event.storageArea !== window.localStorage) return
        if (
          event.key === null ||
          event.key === maintenanceNoticeStorageKey(userId)
        )
          onChange()
      }
      window.addEventListener("storage", onStorage)
      window.addEventListener(preferenceChangedEvent, onChange)
      return () => {
        window.removeEventListener("storage", onStorage)
        window.removeEventListener(preferenceChangedEvent, onChange)
      }
    },
    [userId]
  )
  const getSnapshot = useCallback(() => readDismissedPeriod(userId), [userId])
  return useSyncExternalStore(subscribe, getSnapshot, () => null)
}
