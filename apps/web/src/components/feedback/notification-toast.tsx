import { useEffect, useRef } from "react"

import {
  notificationDuration,
  notify,
  type NotificationVariant,
} from "@/components/feedback/notification"
import { Toaster } from "@/components/ui/sonner"

export function NotificationCenter() {
  return <Toaster position="top-center" duration={notificationDuration} />
}

export function NotificationToast({
  message,
  description,
  id,
  variant = "success",
  onDismiss,
}: {
  message?: string | null
  description?: string
  id?: string | number
  variant?: NotificationVariant
  onDismiss?: (message: string) => void
}) {
  const activeToastId = useRef<string | number | null>(null)

  useEffect(() => {
    if (!message) {
      if (activeToastId.current !== null) {
        notify.dismiss(activeToastId.current)
        activeToastId.current = null
      }
      return
    }

    const handleDismiss = () => {
      if (activeToastId.current !== toastId) return
      activeToastId.current = null
      onDismiss?.(message)
    }
    const toastId = notify[variant](message, {
      description,
      id,
      ...(onDismiss && {
        onDismiss: handleDismiss,
        onAutoClose: handleDismiss,
      }),
    })
    activeToastId.current = toastId
  }, [description, id, message, onDismiss, variant])

  return null
}
