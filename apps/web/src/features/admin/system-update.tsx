import { useState } from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { systemUpdateStatusSchema } from "@linksense/shared"
import {
  CircleAlertIcon,
  ExternalLinkIcon,
  RefreshCwIcon,
  ShieldCheckIcon,
  SparklesIcon,
  XIcon,
} from "lucide-react"
import { useTranslation } from "react-i18next"
import { NavLink } from "react-router-dom"

import { apiRequest } from "@/api/client"
import { getErrorMessage } from "@/api/error-message"
import { useAuth } from "@/app/auth-state"
import { ErrorState, LoadingState } from "@/components/feedback/page-state"
import {
  Alert,
  AlertAction,
  AlertDescription,
  AlertTitle,
} from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Spinner } from "@/components/ui/spinner"
import { normalizeLanguage } from "@/i18n"
import { formatDateTime } from "@/i18n/date"
import { cn } from "@/lib/utils"
import {
  systemUpdateQueryKey,
  useSystemUpdateStatus,
} from "@/features/admin/system-update-query"

const UPDATE_NOTICE_STORAGE_PREFIX = "linksense.system-update.dismissed."

export function SystemUpdateNotice({
  placement = "app",
}: {
  placement?: "app" | "settings"
}) {
  const { t } = useTranslation()
  const { user } = useAuth()
  const query = useSystemUpdateStatus()
  const version =
    query.data?.status === "update_available"
      ? query.data.latest_release.version
      : null
  const storageKey = version
    ? `${UPDATE_NOTICE_STORAGE_PREFIX}${user?.id ?? "unknown"}.${version}`
    : null
  const [dismissedKey, setDismissedKey] = useState<string | null>(null)
  const dismissed =
    storageKey !== null &&
    (dismissedKey === storageKey || isStoredUpdateNoticeDismissed(storageKey))

  if (!version || dismissed) return null
  return (
    <Alert
      appearance="soft"
      className={cn(
        "system-update-notice z-60 shadow-lg",
        placement === "app"
          ? "absolute top-16 left-1/2 w-[min(calc(100%-1.5rem),48rem)] -translate-x-1/2"
          : "mx-auto mt-4 w-[calc(100%-2rem)]"
      )}
    >
      <SparklesIcon aria-hidden="true" />
      <AlertTitle>{t("systemUpdate.notice.title", { version })}</AlertTitle>
      <AlertDescription className="flex flex-wrap items-center gap-3">
        <span>{t("systemUpdate.notice.description")}</span>
        <Button
          size="sm"
          variant="outline"
          render={<NavLink to="/admin/system-update" />}
        >
          {t("systemUpdate.notice.action")}
        </Button>
      </AlertDescription>
      <AlertAction>
        <Button
          type="button"
          size="icon-xs"
          variant="ghost"
          aria-label={t("systemUpdate.notice.dismiss")}
          onClick={() => {
            if (storageKey) {
              try {
                window.localStorage.setItem(storageKey, "true")
              } catch {
                // Dismissal remains effective for this page when storage fails.
              }
            }
            setDismissedKey(storageKey)
          }}
        >
          <XIcon aria-hidden="true" />
        </Button>
      </AlertAction>
    </Alert>
  )
}

function isStoredUpdateNoticeDismissed(storageKey: string): boolean {
  try {
    return window.localStorage.getItem(storageKey) === "true"
  } catch {
    return false
  }
}

export function SystemUpdateSettings() {
  const { t, i18n } = useTranslation()
  const language = normalizeLanguage(i18n.resolvedLanguage) ?? "zh-CN"
  const queryClient = useQueryClient()
  const query = useSystemUpdateStatus()
  const refresh = useMutation({
    mutationFn: () =>
      apiRequest("/admin/system-update/check", {
        method: "POST",
        schema: systemUpdateStatusSchema,
      }),
    onSuccess: (status) => {
      queryClient.setQueryData(systemUpdateQueryKey, status)
    },
  })

  if (query.isLoading) return <LoadingState />
  if (query.error) {
    return (
      <ErrorState
        message={getErrorMessage(query.error, t)}
        onRetry={() => void query.refetch()}
      />
    )
  }
  if (!query.data) return null

  const status = refresh.data ?? query.data
  const release = status.latest_release
  const statusLabel = t(`systemUpdate.status.${status.status}`)
  return (
    <div className="flex min-w-0 flex-col gap-4">
      {refresh.error && (
        <Alert variant="destructive" appearance="soft">
          <CircleAlertIcon aria-hidden="true" />
          <AlertTitle>{t("systemUpdate.refreshFailed")}</AlertTitle>
          <AlertDescription>
            {getErrorMessage(refresh.error, t)}
          </AlertDescription>
        </Alert>
      )}
      {status.status === "check_failed" && (
        <Alert appearance="soft">
          <CircleAlertIcon aria-hidden="true" />
          <AlertTitle>{t("systemUpdate.checkFailed.title")}</AlertTitle>
          <AlertDescription>
            {t(`systemUpdate.checkFailed.${status.error_code}`)}
          </AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader>
          <CardTitle>{t("systemUpdate.overview.title")}</CardTitle>
          <CardDescription>
            {t("systemUpdate.overview.description")}
          </CardDescription>
          <CardAction>
            <Badge
              variant={
                status.status === "update_available" ? "default" : "secondary"
              }
            >
              {statusLabel}
            </Badge>
          </CardAction>
        </CardHeader>
        <CardContent>
          <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <VersionDetail
              label={t("systemUpdate.currentVersion")}
              value={status.current_version}
            />
            <VersionDetail
              label={t("systemUpdate.latestVersion")}
              value={release?.version ?? "—"}
            />
            <VersionDetail
              label={t("systemUpdate.checkedAt")}
              value={formatDateTime(status.checked_at, language)}
            />
            {release && (
              <VersionDetail
                label={t("systemUpdate.publishedAt")}
                value={formatDateTime(release.published_at, language)}
              />
            )}
          </dl>
        </CardContent>
        <CardFooter className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            disabled={refresh.isPending}
            onClick={() => refresh.mutate()}
          >
            {refresh.isPending ? (
              <Spinner data-icon="inline-start" />
            ) : (
              <RefreshCwIcon data-icon="inline-start" />
            )}
            {t("systemUpdate.checkNow")}
          </Button>
          {release && (
            <Button
              variant="ghost"
              render={
                <a
                  href={release.url}
                  target="_blank"
                  rel="noreferrer noopener"
                />
              }
            >
              {t("systemUpdate.openRelease")}
              <ExternalLinkIcon data-icon="inline-end" />
            </Button>
          )}
        </CardFooter>
      </Card>

      {release?.release_notes && (
        <Card>
          <CardHeader>
            <CardTitle>{release.name}</CardTitle>
            <CardDescription>{t("systemUpdate.releaseNotes")}</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="max-h-80 overflow-auto text-sm whitespace-pre-wrap text-muted-foreground">
              {release.release_notes}
            </div>
          </CardContent>
        </Card>
      )}

      {status.status === "update_available" && (
        <Card>
          <CardHeader>
            <CardTitle>{t("systemUpdate.tutorial.title")}</CardTitle>
            <CardDescription>
              {t("systemUpdate.tutorial.description")}
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-5">
            <Alert appearance="borderless">
              <ShieldCheckIcon aria-hidden="true" />
              <AlertTitle>{t("systemUpdate.tutorial.safetyTitle")}</AlertTitle>
              <AlertDescription>
                {t("systemUpdate.tutorial.safetyDescription")}
              </AlertDescription>
            </Alert>
            <TutorialCommand
              title={t("systemUpdate.tutorial.linux")}
              command="curl -fsSL https://raw.githubusercontent.com/LingX-AI/linksense/main/upgrade.sh | sudo sh"
            />
            <TutorialCommand
              title={t("systemUpdate.tutorial.macos")}
              command="curl -fsSL https://raw.githubusercontent.com/LingX-AI/linksense/main/upgrade.sh | sh"
            />
            <ol className="list-decimal pl-5 text-sm text-muted-foreground">
              <li>{t("systemUpdate.tutorial.steps.maintenance")}</li>
              <li>{t("systemUpdate.tutorial.steps.run")}</li>
              <li>{t("systemUpdate.tutorial.steps.backup")}</li>
              <li>{t("systemUpdate.tutorial.steps.health")}</li>
            </ol>
          </CardContent>
        </Card>
      )}
    </div>
  )
}

function VersionDetail({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="font-medium break-words">{value}</dd>
    </div>
  )
}

function TutorialCommand({
  title,
  command,
}: {
  title: string
  command: string
}) {
  return (
    <section className="flex min-w-0 flex-col gap-2">
      <h3 className="font-medium">{title}</h3>
      <pre className="overflow-x-auto rounded-xl bg-background p-3 text-sm">
        <code>{command}</code>
      </pre>
    </section>
  )
}
