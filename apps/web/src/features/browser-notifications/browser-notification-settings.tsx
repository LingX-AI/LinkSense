import { useState } from "react"
import { useTranslation } from "react-i18next"
import { BellIcon } from "lucide-react"
import { DEFAULT_ORGANIZATION_DISPLAY_NAME } from "@linksense/shared"

import { isMacDesktopHost } from "@/adapters/desktop/desktop-adapter"
import { StatusBanner } from "@/components/feedback/status-banner"
import { SettingsSectionHeader } from "@/components/settings/settings-section-header"
import { SettingsCard } from "@/components/settings/settings-card"
import { Switch } from "@/components/ui/switch"
import { useBrowserNotificationActivation } from "@/features/browser-notifications/use-browser-notification-activation"
import { useDesktopApprovalReminder } from "@/features/browser-notifications/use-desktop-approval-notification"

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
  const approval = useDesktopApprovalReminder(userId)
  const [approvalStorageError, setApprovalStorageError] = useState(false)
  const approvalLabel = t("browserNotifications.approvalEnable")

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
      {desktop && preference.supported && (
        <div className="mt-4 border-t border-border/60 pt-4">
          <div className="flex items-center justify-between gap-6">
            <div className="min-w-0">
              <span className="text-sm font-medium">{approvalLabel}</span>
              <p
                id="desktop-approval-reminders-description"
                className="mt-1 text-sm text-muted-foreground"
              >
                {t("browserNotifications.approvalDescription")}
              </p>
              {approval.enabled && !preference.effectiveEnabled && (
                <p
                  id="desktop-approval-reminders-paused"
                  className="mt-1 text-sm text-muted-foreground"
                >
                  {t("browserNotifications.approvalPaused")}
                </p>
              )}
            </div>
            <Switch
              id="desktop-approval-reminders-enabled"
              checked={approval.enabled}
              disabled={!userId || requestPending}
              aria-label={approvalLabel}
              aria-describedby={
                approval.enabled && !preference.effectiveEnabled
                  ? "desktop-approval-reminders-description desktop-approval-reminders-paused"
                  : "desktop-approval-reminders-description"
              }
              onCheckedChange={(checked) => {
                setApprovalStorageError(false)
                if (!approval.persist(checked)) setApprovalStorageError(true)
              }}
            />
          </div>
          {approvalStorageError && (
            <StatusBanner variant="error" className="mt-4">
              {t("browserNotifications.storageError")}
            </StatusBanner>
          )}
        </div>
      )}
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
