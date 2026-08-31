import { useEffect } from "react"

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
}: {
  message?: string | null
  description?: string
  id?: string | number
  variant?: NotificationVariant
}) {
  useEffect(() => {
    if (!message) return
    notify[variant](message, { description, id })
  }, [description, id, message, variant])

  return null
}
