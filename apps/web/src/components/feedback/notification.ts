import type { ReactNode } from "react"
import { toast, type ExternalToast } from "sonner"

export const notificationDuration = 1_500

export type NotificationVariant = "success" | "error" | "info" | "warning"

export type NotificationOptions = Omit<ExternalToast, "duration">

function withNotificationDuration(
  options?: NotificationOptions
): ExternalToast {
  return {
    ...options,
    duration: notificationDuration,
  }
}

export const notify = {
  loading(message: ReactNode, options?: NotificationOptions) {
    return toast.loading(message, { ...options, duration: Infinity })
  },
  success(message: ReactNode, options?: NotificationOptions) {
    return toast.success(message, withNotificationDuration(options))
  },
  error(message: ReactNode, options?: NotificationOptions) {
    return toast.error(message, {
      closeButton: true,
      ...withNotificationDuration(options),
    })
  },
  info(message: ReactNode, options?: NotificationOptions) {
    return toast.info(message, withNotificationDuration(options))
  },
  warning(message: ReactNode, options?: NotificationOptions) {
    return toast.warning(message, withNotificationDuration(options))
  },
  dismiss(id?: string | number) {
    return toast.dismiss(id)
  },
}
