import { useState } from "react"
import { BellRingIcon } from "lucide-react"
import { useTranslation } from "react-i18next"

import { useAuth } from "@/app/auth-state"
import { StatusBanner } from "@/components/feedback/status-banner"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Spinner } from "@/components/ui/spinner"
import {
  dismissBrowserNotificationPrompt,
  readBrowserNotificationPromptDismissed,
} from "@/features/browser-notifications/browser-notification-prompt-preference"
import { useBrowserNotificationActivation } from "@/features/browser-notifications/use-browser-notification-activation"

export function BrowserNotificationPrompt() {
  const { status, user } = useAuth()
  if (status !== "authenticated" || !user) return null
  return <ActiveBrowserNotificationPrompt key={user.id} userId={user.id} />
}

function ActiveBrowserNotificationPrompt({ userId }: { userId: string }) {
  const { t } = useTranslation()
  const {
    preference,
    requestPending,
    feedback,
    feedbackMessage,
    requestPermissionAndActivate,
  } = useBrowserNotificationActivation(userId)
  const [dismissed, setDismissed] = useState(() =>
    readBrowserNotificationPromptDismissed(userId)
  )

  if (
    dismissed ||
    preference.effectiveEnabled ||
    !preference.supported ||
    preference.permission === "denied"
  ) {
    return null
  }

  return (
    <Card
      size="sm"
      role="region"
      aria-labelledby="browser-notification-prompt-title"
      className="browser-notification-prompt fixed right-3 bottom-[max(0.75rem,env(safe-area-inset-bottom))] left-3 z-40 motion-safe:animate-in motion-safe:duration-200 motion-safe:fade-in motion-safe:slide-in-from-bottom-2 md:right-6 md:bottom-6 md:left-auto md:w-[300px]"
    >
      <CardHeader className="grid grid-cols-[auto_1fr] items-start">
        <BellRingIcon
          className="browser-notification-prompt-icon"
          strokeWidth={1.8}
          aria-hidden="true"
        />
        <CardTitle id="browser-notification-prompt-title">
          {t("browserNotifications.promptMessage")}
        </CardTitle>
      </CardHeader>
      {feedbackMessage && (
        <CardContent>
          <StatusBanner
            variant={
              feedback === "dismissed"
                ? "warning"
                : feedback === "testSent"
                  ? "success"
                  : "error"
            }
          >
            {feedbackMessage}
          </StatusBanner>
        </CardContent>
      )}
      <CardFooter className="grid grid-cols-2 gap-2">
        <Button
          type="button"
          variant="outline"
          className="browser-notification-prompt-dismiss w-full"
          disabled={requestPending}
          onClick={() => {
            dismissBrowserNotificationPrompt(userId)
            setDismissed(true)
          }}
        >
          {t("browserNotifications.promptDismiss")}
        </Button>
        <Button
          type="button"
          className="w-full"
          disabled={requestPending}
          onClick={requestPermissionAndActivate}
        >
          {requestPending && <Spinner data-icon="inline-start" />}
          {t(
            requestPending
              ? "browserNotifications.promptEnabling"
              : "browserNotifications.promptEnable"
          )}
        </Button>
      </CardFooter>
    </Card>
  )
}
