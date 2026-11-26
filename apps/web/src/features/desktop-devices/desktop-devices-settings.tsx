import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { FolderPlus, Trash2 } from "lucide-react"
import type { TFunction } from "i18next"
import { useState } from "react"
import { useTranslation } from "react-i18next"

import { getErrorMessage } from "@/api/error-message"
import { isMacDesktopHost } from "@/adapters/desktop/desktop-adapter"
import {
  addDesktopFileRoot,
  removeDesktopFileRoot,
  setDesktopLocalToolsEnabled,
  type DesktopDeviceStatus,
} from "@/adapters/desktop/desktop-device-adapter"
import { Alert, AlertDescription } from "@/components/ui/alert"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Spinner } from "@/components/ui/spinner"
import { Switch } from "@/components/ui/switch"
import { checkComputerPermission } from "@/features/desktop-computer-permissions/computer-permission-adapter"
import { DesktopComputerPermissionGuide } from "@/features/desktop-computer-permissions/desktop-computer-permission-guide"
import {
  SettingsFieldGroup,
  SettingsFieldRow,
} from "@/components/forms/form-field"

import {
  listDesktopFileRoots,
  updateDesktopFileRoot,
} from "./desktop-file-root-api"
import {
  desktopDeviceStatusQueryKey,
  useDesktopDeviceStatus,
} from "./use-desktop-device-status"

const desktopFileRootsQueryKey = (ownerId: string) =>
  ["desktop-file-roots", ownerId] as const

function mutationMessage(error: unknown, t: TFunction): string | null {
  if (!error) return null
  if (error instanceof Error && error.message === "DESKTOP_FILE_PICKER_CANCELLED") {
    return null
  }
  return getErrorMessage(error, t)
}

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
  const status = statusQuery.data
  const [addMode, setAddMode] = useState<"read" | "write">("read")
  const [permissionGuideOpen, setPermissionGuideOpen] = useState(false)
  const permission = useQuery({
    queryKey: ["desktop-computer-permission", ownerId],
    queryFn: ({ signal }) => checkComputerPermission("accessibility", signal),
    enabled: mac && Boolean(ownerId),
    retry: false,
    staleTime: 0,
  })
  const [removeTarget, setRemoveTarget] = useState<{ id: string; name: string } | null>(null)
  const roots = useQuery({
    queryKey: desktopFileRootsQueryKey(ownerId ?? ""),
    queryFn: ({ signal }) => listDesktopFileRoots(signal),
    enabled: mac && Boolean(ownerId),
  })
  const addRoot = useMutation({
    mutationFn: (mode: "read" | "write") => {
      if (!status?.deviceId) throw new Error("DESKTOP_HOST_UNAVAILABLE")
      return addDesktopFileRoot(status.deviceId, mode)
    },
    onSuccess: () => client.invalidateQueries({
      queryKey: desktopFileRootsQueryKey(ownerId ?? ""),
    }),
  })
  const changeMode = useMutation({
    mutationFn: (input: { id: string; mode: "read" | "write" }) =>
      updateDesktopFileRoot(input.id, { mode: input.mode }),
    onSuccess: () => client.invalidateQueries({
      queryKey: desktopFileRootsQueryKey(ownerId ?? ""),
    }),
  })
  const removeRoot = useMutation({
    mutationFn: (id: string) => removeDesktopFileRoot(id),
    onSuccess: () => client.invalidateQueries({
      queryKey: desktopFileRootsQueryKey(ownerId ?? ""),
    }),
  })

  if (!mac || !ownerId) return null

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

      <div className="grid min-w-0 gap-2">
        <div className="grid min-w-0 gap-1">
          <h3 className="text-sm font-medium">
            {t("desktopDevices.foldersTitle")}
          </h3>
          <p className="form-hint">{t("desktopDevices.foldersDescription")}</p>
        </div>
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <Select
            value={addMode}
            onValueChange={(value) => setAddMode(value === "write" ? "write" : "read")}
            items={[
              { value: "read", label: t("desktopDevices.modeRead") },
              { value: "write", label: t("desktopDevices.modeWrite") },
            ]}
            disabled={!status?.deviceId || addRoot.isPending}
          >
            <SelectTrigger
              className="w-40"
              aria-label={t("desktopDevices.addFolderMode")}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                <SelectItem value="read">{t("desktopDevices.modeRead")}</SelectItem>
                <SelectItem value="write">{t("desktopDevices.modeWrite")}</SelectItem>
              </SelectGroup>
            </SelectContent>
          </Select>
          <Button
            type="button"
            variant="outline"
            disabled={!status?.deviceId || addRoot.isPending}
            onClick={() => addRoot.mutate(addMode)}
          >
            {addRoot.isPending ? <Spinner /> : <FolderPlus aria-hidden="true" />}
            {t("desktopDevices.addFolder")}
          </Button>
        </div>
        {mutationMessage(addRoot.error, t) ? (
          <Alert variant="destructive">
            <AlertDescription>
              {mutationMessage(addRoot.error, t) === t("errors.unknown")
                ? t("desktopDevices.folderAddFailed")
                : mutationMessage(addRoot.error, t)}
            </AlertDescription>
          </Alert>
        ) : null}
        {roots.isPending ? (
          <span role="status" className="inline-flex items-center">
            <Spinner />
            <span className="sr-only">{t("common.loading")}</span>
          </span>
        ) : roots.isError ? (
          <Alert variant="destructive">
            <AlertDescription className="grid justify-items-start gap-2">
              <p>{t("desktopDevices.foldersUnavailable")}</p>
              <Button
                type="button"
                variant="outline"
                onClick={() => void roots.refetch()}
              >
                {t("common.retry")}
              </Button>
            </AlertDescription>
          </Alert>
        ) : roots.data.items.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {t("desktopDevices.foldersEmpty")}
          </p>
        ) : (
          <SettingsFieldGroup>
            {roots.data.items.map((root) => (
              <SettingsFieldRow
                key={root.id}
                id={`desktop-file-root-${root.id}`}
                label={root.name}
                controlWidth="compact"
              >
                <div className="flex min-w-0 items-center gap-1">
                  <Select
                    value={root.mode}
                    onValueChange={(value) => {
                      const mode = value === "write" ? "write" : "read"
                      if (mode !== root.mode) changeMode.mutate({ id: root.id, mode })
                    }}
                    items={[
                      { value: "read", label: t("desktopDevices.modeRead") },
                      { value: "write", label: t("desktopDevices.modeWrite") },
                    ]}
                    disabled={changeMode.isPending}
                  >
                    <SelectTrigger
                      className="w-36"
                      aria-label={t("desktopDevices.folderModeLabel")}
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectGroup>
                        <SelectItem value="read">{t("desktopDevices.modeRead")}</SelectItem>
                        <SelectItem value="write">{t("desktopDevices.modeWrite")}</SelectItem>
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label={t("desktopDevices.removeFolder")}
                    onClick={() => setRemoveTarget({ id: root.id, name: root.name })}
                  >
                    <Trash2 aria-hidden="true" />
                  </Button>
                </div>
              </SettingsFieldRow>
            ))}
          </SettingsFieldGroup>
        )}
        {mutationMessage(changeMode.error, t) ? (
          <Alert variant="destructive">
            <AlertDescription>
              {mutationMessage(changeMode.error, t) === t("errors.unknown")
                ? t("desktopDevices.folderModeFailed")
                : mutationMessage(changeMode.error, t)}
            </AlertDescription>
          </Alert>
        ) : null}
        <p className="form-hint">{t("desktopDevices.folderAccessHint")}</p>
      </div>

      <SettingsFieldGroup>
        <SettingsFieldRow
          id="desktop-computer-permission"
          label={t("desktopDevices.desktopPermissionTitle")}
          hint={t("desktopDevices.desktopPermissionDescription")}
          controlWidth="compact"
        >
          <div className="flex min-w-0 items-center gap-2">
            <Badge
              variant={
                permission.data?.status === "granted"
                  ? "success"
                  : permission.data?.reason === "unsupported" ||
                      permission.data?.reason === "notPackaged"
                    ? "outline"
                    : "secondary"
              }
            >
              {permission.data?.status === "granted"
                ? t("desktopDevices.desktopPermissionGranted")
                : permission.data?.reason === "unsupported" ||
                    permission.data?.reason === "notPackaged"
                  ? t("desktopDevices.desktopPermissionUnavailable")
                  : t("desktopDevices.desktopPermissionMissing")}
            </Badge>
            {permission.data?.status !== "granted" ? (
              <Button
                type="button"
                variant="outline"
                onClick={() => setPermissionGuideOpen(true)}
              >
                {t("desktopDevices.desktopPermissionAction")}
              </Button>
            ) : null}
          </div>
        </SettingsFieldRow>
      </SettingsFieldGroup>
      <DesktopComputerPermissionGuide
        kind="accessibility"
        open={permissionGuideOpen}
        onOpenChange={(open) => {
          setPermissionGuideOpen(open)
          if (!open) void permission.refetch()
        }}
      />

      <AlertDialog
        open={removeTarget !== null}
        onOpenChange={(open) => {
          if (!open) setRemoveTarget(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("desktopDevices.removeFolderTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("desktopDevices.removeFolderDescription", {
                name: removeTarget?.name ?? "",
              })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("desktopDevices.removeFolderCancel")}</AlertDialogCancel>
            <AlertDialogAction
              disabled={removeRoot.isPending}
              onClick={() => {
                if (!removeTarget) return
                removeRoot.mutate(removeTarget.id, {
                  onSettled: () => setRemoveTarget(null),
                })
              }}
            >
              {t("desktopDevices.removeFolderConfirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      {mutationMessage(removeRoot.error, t) ? (
        <Alert variant="destructive">
          <AlertDescription>
            {mutationMessage(removeRoot.error, t) === t("errors.unknown")
              ? t("desktopDevices.removeFolderFailed")
              : mutationMessage(removeRoot.error, t)}
          </AlertDescription>
        </Alert>
      ) : null}
    </div>
  )
}
