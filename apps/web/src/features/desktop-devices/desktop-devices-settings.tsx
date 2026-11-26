import { useMutation, useQueryClient } from "@tanstack/react-query"
import { useTranslation } from "react-i18next"

import { getErrorMessage } from "@/api/error-message"
import { isMacDesktopHost } from "@/adapters/desktop/desktop-adapter"
import {
  setDesktopLocalToolsEnabled,
  type DesktopDeviceStatus,
} from "@/adapters/desktop/desktop-device-adapter"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import { Switch } from "@/components/ui/switch"
import {
  SettingsFieldGroup,
  SettingsFieldRow,
} from "@/components/forms/form-field"

import {
  desktopDeviceStatusQueryKey,
  useDesktopDeviceStatus,
} from "./use-desktop-device-status"

function statusLabelKey(
  status: DesktopDeviceStatus | undefined
): "statusPreparing" | "statusConnecting" | "statusOnline" | "statusOffline" | "statusDisabled" | "statusRevoked" {
  if (!status) return "statusPreparing"
  if (status.localToolsDisabled || status.errorCode === "DESKTOP_LOCAL_TOOLS_DISABLED") {
    return "statusDisabled"
  }
  switch (status.state) {
    case "online":
      return "statusOnline"
    case "connecting":
      return "statusConnecting"
    case "offline":
      return "statusOffline"
    case "revoked":
      return "statusRevoked"
    default:
      return "statusPreparing"
  }
}

function statusVariant(
  key: ReturnType<typeof statusLabelKey>
): "success" | "secondary" | "destructive" | "outline" {
  if (key === "statusOnline") return "success"
  if (key === "statusOffline") return "secondary"
  if (key === "statusRevoked") return "destructive"
  return "outline"
}

export function DesktopDevicesSettings({
  ownerId,
}: Readonly<{ ownerId?: string }>) {
  const { t } = useTranslation()
  const client = useQueryClient()
  const mac = isMacDesktopHost()
  const statusQuery = useDesktopDeviceStatus(ownerId)
  const toggle = useMutation({
    mutationFn: (enabled: boolean) => setDesktopLocalToolsEnabled(enabled),
    onSuccess: (next) => {
      client.setQueryData(desktopDeviceStatusQueryKey(ownerId), next)
    },
  })

  if (!mac || !ownerId) return null

  const status = statusQuery.data
  const labelKey = statusLabelKey(status)
  const disabled =
    labelKey === "statusDisabled" || labelKey === "statusRevoked"
  const toggleErrorMessage = toggle.error
    ? getErrorMessage(toggle.error, t)
    : null

  return (
    <div className="grid min-w-0 gap-4">
      {statusQuery.isPending ? (
        <span role="status" className="inline-flex items-center">
          <Spinner />
          <span className="sr-only">{t("common.loading")}</span>
        </span>
      ) : statusQuery.isError ? (
        <Alert variant="destructive">
          <AlertDescription className="grid justify-items-start gap-2">
            <p>{t("desktopDevices.statusUnavailable")}</p>
            <Button
              type="button"
              variant="outline"
              onClick={() => void statusQuery.refetch()}
            >
              {t("common.retry")}
            </Button>
          </AlertDescription>
        </Alert>
      ) : (
        <>
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <Badge variant={statusVariant(labelKey)}>
              {t(`desktopDevices.${labelKey}`)}
            </Badge>
          </div>
          {labelKey === "statusRevoked" ? (
            <p className="text-sm text-muted-foreground">
              {t("desktopDevices.statusRevokedHint")}
            </p>
          ) : null}
        </>
      )}

      <SettingsFieldGroup>
        <SettingsFieldRow
          id="desktop-local-tools-enabled"
          label={t("desktopDevices.toggleLabel")}
          hint={
            disabled
              ? t("desktopDevices.toggleDescriptionDisabled")
              : t("desktopDevices.toggleDescription")
          }
          controlWidth="compact"
        >
          <Switch
            id="desktop-local-tools-enabled"
            checked={!disabled}
            disabled={statusQuery.isPending || toggle.isPending}
            onCheckedChange={(checked) => {
              toggle.mutate(checked)
            }}
          />
        </SettingsFieldRow>
      </SettingsFieldGroup>

      {toggleErrorMessage ? (
        <Alert variant="destructive">
          <AlertDescription>
            {toggleErrorMessage === t("errors.unknown")
              ? t("desktopDevices.toggleFailed")
              : toggleErrorMessage}
          </AlertDescription>
        </Alert>
      ) : null}
    </div>
  )
}
