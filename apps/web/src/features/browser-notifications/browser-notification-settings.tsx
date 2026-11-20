import { useTranslation } from "react-i18next"
import { BellIcon } from "lucide-react"
import { DEFAULT_ORGANIZATION_DISPLAY_NAME } from "@linksense/shared"

import { isMacDesktopHost } from "@/adapters/desktop/desktop-adapter"
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
  const desktop = isMacDesktopHost()
  const {
    preference,
    requestPending,
    feedback,
    feedbackMessage,
    clearFeedback,
    disable,
    requestPermissionAndActivate,
  } = useBrowserNotificationActivation(userId)

  const unavailable =
    !userId ||
    requestPending ||
    ((!preference.supported ||
      (!desktop && preference.permission === "denied")) &&
      !preference.enabled)
  const toggleLabel = t(
    desktop
      ? "browserNotifications.desktopEnable"
      : "browserNotifications.enable"
  )
  const statusMessage =
    feedbackMessage ??
    (!preference.supported
      ? t(
          desktop
            ? "browserNotifications.desktopUnsupported"
            : "browserNotifications.unsupported"
        )
      : preference.permission === "denied"
        ? t(
            desktop
              ? "browserNotifications.desktopPermissionDenied"
              : "browserNotifications.permissionDenied",
            { productName: DEFAULT_ORGANIZATION_DISPLAY_NAME }
          )
        : preference.enabled && preference.permission === "default"
          ? t("browserNotifications.permissionRequired")
          : null)

  return (
    <SettingsCard
      layout="split"
      icon={<BellIcon />}
      aria-labelledby="browser-notifications-heading"
      header={
        <SettingsSectionHeader
          id="browser-notifications-heading"
          title={t(
            desktop
              ? "browserNotifications.desktopTitle"
              : "browserNotifications.settingsTitle"
          )}
          description={t(
            desktop
              ? "browserNotifications.desktopDescription"
              : "browserNotifications.settingsDescription"
          )}
          descriptionId="browser-notifications-description"
        />
      }
    >
      <div className="flex items-center justify-between gap-6">
        <span className="min-w-0 text-sm font-medium">{toggleLabel}</span>
        <Switch
          id="browser-notifications-enabled"
          checked={preference.enabled}
          disabled={unavailable}
          aria-label={toggleLabel}
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
                  feedback === "feedError" ||
                  feedback === "denied" ||
                  feedback === "unsupported"
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
