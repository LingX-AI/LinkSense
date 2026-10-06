import { useState } from "react"
import { CheckIcon, XIcon } from "lucide-react"
import { useTranslation } from "react-i18next"
import { Link } from "react-router-dom"
import type { ModelPreference } from "@linksense/shared"

import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"

function storageKey(userId: string) {
  return `linksense.first-use.${userId}`
}

function isDismissed(userId: string): boolean {
  try {
    return window.localStorage.getItem(storageKey(userId)) === "dismissed"
  } catch {
    return false
  }
}

export function FirstUseGuide({
  userId,
  isAdmin,
  preference,
  loading,
  failed,
  force = false,
  onRetry,
  onDismiss,
}: {
  userId: string
  isAdmin: boolean
  preference?: ModelPreference
  loading: boolean
  failed: boolean
  force?: boolean
  onRetry: () => void
  onDismiss?: () => void
}) {
  const { t } = useTranslation()
  const [visibility, setVisibility] = useState(() => ({
    force,
    dismissed: !force && isDismissed(userId),
  }))
  const dismissed =
    visibility.force !== force && force ? false : visibility.dismissed
  if (visibility.force !== force) setVisibility({ force, dismissed })
  if (!isAdmin || dismissed || loading || preference?.configured) return null
  return (
    <Card
      className="w-full max-w-xl gap-3 p-4 text-left sm:p-5"
      aria-label={t("onboarding.title")}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="font-semibold">{t("onboarding.title")}</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            {t("onboarding.description")}
          </p>
        </div>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={t("onboarding.dismiss")}
          onClick={() => {
            setVisibility({ force, dismissed: true })
            try {
              window.localStorage.setItem(storageKey(userId), "dismissed")
            } catch {
              // Dismissal still works for this visit when storage is unavailable.
            }
            onDismiss?.()
          }}
        >
          <XIcon aria-hidden="true" />
        </Button>
      </div>
      <p className="flex items-center gap-2 text-sm">
        <CheckIcon className="size-4 text-primary" aria-hidden="true" />
        {t("onboarding.accountReady")}
      </p>
      {failed ? (
        <div className="flex flex-wrap items-center gap-2" role="alert">
          <p className="text-sm text-destructive">{t("errors.unknown")}</p>
          <Button variant="secondary" size="sm" onClick={onRetry}>
            {t("common.retry")}
          </Button>
        </div>
      ) : (
        <div className="flex flex-col items-start gap-3">
          <p className="text-sm font-medium">{t("onboarding.modelNeeded")}</p>
          <p className="text-sm text-muted-foreground">
            {t("onboarding.adminHelp")}
          </p>
          <Button
            nativeButton={false}
            role="link"
            size="sm"
            render={<Link to="/admin/models" />}
          >
            {t("onboarding.configureModel")}
          </Button>
        </div>
      )}
    </Card>
  )
}
