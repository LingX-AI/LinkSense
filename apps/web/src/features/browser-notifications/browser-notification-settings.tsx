import { useTranslation } from "react-i18next"
import { BellIcon } from "lucide-react"

import { StatusBanner } from "@/components/feedback/status-banner"
import { SettingsSectionHeader } from "@/components/settings/settings-section-header"
import { SettingsCard } from "@/components/settings/settings-card"
import { Switch } from "@/components/ui/switch"
import { useBrowserNotificationActivation } from "@/features/browser-notifications/use-browser-notification-activation"

export function BrowserNotificationSettings({
  userId,
}: {
  userId: string | undefined
}) {
  const { t } = useTranslation()
  const {
    preference,
    requestPending,
    feedback,
    clearFeedback,
    disable,
    requestPermissionAndActivate,
  } = useBrowserNotificationActivation(userId)

  const unavailable =
    !userId ||
    requestPending ||
    ((!preference.supported || preference.permission === "denied") &&
      !preference.enabled)
  const statusMessage =
    feedback === "storageError"
      ? t("browserNotifications.storageError")
      : feedback === "deliveryError"
        ? t("browserNotifications.deliveryError")
        : feedback === "feedError"
          ? t("browserNotifications.feedError")
          : feedback === "error"
            ? t("browserNotifications.permissionError")
            : feedback === "dismissed"
              ? t("browserNotifications.permissionDismissed")
              : feedback === "testSent"
                ? t("browserNotifications.testSent")
                : !preference.supported
                  ? t("browserNotifications.unsupported")
                  : preference.permission === "denied"
                    ? t("browserNotifications.permissionDenied")
                    : preference.enabled && preference.permission === "default"
                      ? t("browserNotifications.permissionRequired")
                      : null

  return (
    <SettingsCard
      layout="split"
      icon={<BellIcon />}
      aria-labelledby="browser-notifications-heading"
      header={
        <SettingsSectionHeader
          id="browser-notifications-heading"
          title={t("browserNotifications.settingsTitle")}
          description={t("browserNotifications.settingsDescription")}
          descriptionId="browser-notifications-description"
        />
      }
    >
      <div className="flex min-h-20 items-center justify-between gap-6 py-4">
        <span className="min-w-0 text-sm font-medium">
          {t("browserNotifications.enable")}
        </span>
        <Switch
          id="browser-notifications-enabled"
          checked={preference.enabled}
          disabled={unavailable}
          aria-label={t("browserNotifications.enable")}
          aria-describedby="browser-notifications-description"
          onCheckedChange={(checked) => {
            clearFeedback()
            if (!checked) {
              disable()
              return
            }
            requestPermissionAndActivate()
          }}
        />
      </div>
      {statusMessage && (
        <StatusBanner
          variant={
            feedback === "testSent"
              ? "success"
              : feedback === "error" ||
                  feedback === "storageError" ||
                  feedback === "deliveryError" ||
                  feedback === "feedError"
                ? "error"
                : "warning"
          }
          className="mt-4"
        >
          {statusMessage}
        </StatusBanner>
      )}
    </SettingsCard>
  )
}
