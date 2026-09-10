import type { ReactNode } from "react"
import { toast, type ExternalToast } from "sonner"

export const notificationDuration = 1_500
export const actionableNotificationDuration = 5_000

export type NotificationVariant = "success" | "error" | "info" | "warning"

export type NotificationOptions = Omit<ExternalToast, "duration">

function withoutTrailingPeriod(content: ReactNode): ReactNode {
  return typeof content === "string"
    ? content.replace(/[。.]+\s*$/u, "")
    : content
}

function withoutTrailingDescriptionPeriod(
  options?: NotificationOptions
): NotificationOptions | undefined {
  if (!options || typeof options.description !== "string") return options

  return {
    ...options,
    description: withoutTrailingPeriod(options.description),
  }
}

function withNotificationDuration(
  options?: NotificationOptions
): ExternalToast {
  return {
    ...withoutTrailingDescriptionPeriod(options),
    duration:
      options?.action || options?.cancel
        ? actionableNotificationDuration
        : notificationDuration,
  }
}

export const notify = {
  loading(message: ReactNode, options?: NotificationOptions) {
    return toast.loading(withoutTrailingPeriod(message), {
      ...withoutTrailingDescriptionPeriod(options),
      duration: Infinity,
    })
  },
  success(message: ReactNode, options?: NotificationOptions) {
    return toast.success(
      withoutTrailingPeriod(message),
      withNotificationDuration(options)
    )
  },
  error(message: ReactNode, options?: NotificationOptions) {
    return toast.error(withoutTrailingPeriod(message), {
      closeButton: true,
      ...withNotificationDuration(options),
    })
  },
  info(message: ReactNode, options?: NotificationOptions) {
    return toast.info(
      withoutTrailingPeriod(message),
      withNotificationDuration(options)
    )
  },
  warning(message: ReactNode, options?: NotificationOptions) {
    return toast.warning(
      withoutTrailingPeriod(message),
      withNotificationDuration(options)
    )
  },
  dismiss(id?: string | number) {
    return toast.dismiss(id)
  },
}
