import { useId, useRef, useState, type FormEvent } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useTranslation } from "react-i18next"
import {
  desktopDeviceRenameInputSchema,
  type DesktopDevice,
} from "@linksense/shared"

import { ApiError } from "@/api/client"
import { getErrorMessage } from "@/api/error-message"
import { isMacDesktopHost } from "@/adapters/desktop/desktop-adapter"
import {
  pairDesktopDevice,
  type DesktopDeviceStatus,
} from "@/adapters/desktop/desktop-device-adapter"
import { StatusBanner } from "@/components/feedback/status-banner"
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty"
import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Spinner } from "@/components/ui/spinner"
import { normalizeLanguage } from "@/i18n"
import { formatDateTime } from "@/i18n/date"

import {
  createDesktopPairing,
  desktopDeviceKeys,
  listDesktopDevices,
  renameDesktopDevice,
  revokeDesktopDevice,
} from "./desktop-device-api"
import {
  desktopDeviceStatusQueryKey,
  useDesktopDeviceStatus,
} from "./use-desktop-device-status"

const statusKeys = {
  unpaired: "statusUnpaired",
  connecting: "statusConnecting",
  online: "statusOnline",
  offline: "statusOffline",
  revoked: "statusRevoked",
} as const

function statusVariant(
  state: keyof typeof statusKeys
): "success" | "secondary" | "destructive" | "outline" {
  if (state === "online") return "success"
  if (state === "revoked") return "destructive"
  if (state === "offline") return "secondary"
  return "outline"
}

function rowState(
  device: DesktopDevice,
  nativeStatus: DesktopDeviceStatus | undefined
): keyof typeof statusKeys {
  if (device.revoked_at) return "revoked"
  if (nativeStatus?.deviceId === device.id) return nativeStatus.state
  return device.online ? "online" : "offline"
}

function actionError(
  error: unknown,
  t: ReturnType<typeof useTranslation>["t"],
  fallbackKey: string
) {
  return error instanceof ApiError ? getErrorMessage(error, t) : t(fallbackKey)
}

function LoadingStatus({ label }: Readonly<{ label: string }>) {
  return (
    <span role="status" className="inline-flex items-center">
      <Spinner />
      <span className="sr-only">{label}</span>
    </span>
  )
}

export function DesktopDevicesSettings({
  ownerId,
}: Readonly<{ ownerId?: string }>) {
  const { t, i18n } = useTranslation()
  const client = useQueryClient()
  const mac = isMacDesktopHost()
  const statusQuery = useDesktopDeviceStatus(ownerId)
  const devicesQuery = useQuery({
    queryKey: desktopDeviceKeys.list(ownerId),
    queryFn: ({ signal }) => listDesktopDevices(signal),
    enabled: mac && Boolean(ownerId),
    retry: false,
    refetchInterval: mac && ownerId ? 15_000 : false,
    refetchIntervalInBackground: false,
  })
  const [renaming, setRenaming] = useState<DesktopDevice | null>(null)
  const [revoking, setRevoking] = useState<DesktopDevice | null>(null)
  const language = normalizeLanguage(i18n.resolvedLanguage) ?? "zh-CN"

  if (!mac || !ownerId) return null

  const status = statusQuery.data
  const pairingAvailable =
    status?.state === "unpaired" || status?.state === "revoked"
  const refreshDevices = () =>
    client.invalidateQueries({ queryKey: desktopDeviceKeys.list(ownerId) })

  return (
    <div className="grid min-w-0 gap-6">
      <section
        className="grid min-w-0 gap-3"
        aria-label={t("desktopDevices.title")}
      >
        {statusQuery.isPending ? (
          <LoadingStatus label={t("common.loading")} />
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
        ) : status ? (
          <>
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <Badge variant={statusVariant(status.state)}>
                {t(`desktopDevices.${statusKeys[status.state]}`)}
              </Badge>
            </div>
            {status.state === "online" ? (
              <p className="text-sm text-muted-foreground">
                {status.executionReady === true
                  ? t("desktopDevices.executionReady")
                  : t("desktopDevices.executionNotReady")}
              </p>
            ) : null}
            {status.state === "revoked" ? (
              <p className="text-sm text-muted-foreground">
                {t("desktopDevices.statusRevokedHint")}
              </p>
            ) : null}
            {pairingAvailable ? (
              <PairDeviceForm
                onPaired={(next) => {
                  client.setQueryData(
                    desktopDeviceStatusQueryKey(ownerId),
                    next
                  )
                  void refreshDevices()
                }}
              />
            ) : null}
          </>
        ) : null}
      </section>

      <section
        className="grid min-w-0 gap-3"
        aria-labelledby="desktop-paired-devices-heading"
      >
        <div className="space-y-1">
          <h3
            id="desktop-paired-devices-heading"
            className="text-sm leading-5 font-semibold text-foreground"
          >
            {t("desktopDevices.devicesTitle")}
          </h3>
          <p className="form-hint max-w-3xl text-pretty">
            {t("desktopDevices.devicesDescription")}
          </p>
        </div>
        {devicesQuery.isPending ? (
          <LoadingStatus label={t("common.loading")} />
        ) : devicesQuery.isError ? (
          <Alert variant="destructive">
            <AlertDescription className="grid justify-items-start gap-2">
              <p>
                {devicesQuery.error instanceof ApiError
                  ? getErrorMessage(devicesQuery.error, t)
                  : t("desktopDevices.devicesLoadFailed")}
              </p>
              <Button
                type="button"
                variant="outline"
                onClick={() => void devicesQuery.refetch()}
              >
                {t("common.retry")}
              </Button>
            </AlertDescription>
          </Alert>
        ) : devicesQuery.data.length === 0 ? (
          <Empty>
            <EmptyHeader>
              <EmptyTitle>{t("desktopDevices.devicesEmptyTitle")}</EmptyTitle>
              <EmptyDescription>
                {t("desktopDevices.devicesEmptyDescription")}
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <ul className="@container/desktop-devices divide-y divide-[color:var(--app-divider)]">
            {devicesQuery.data.map((device) => {
              const state = rowState(device, status)
              const isThisMac = status?.deviceId === device.id
              return (
                <li
                  key={device.id}
                  className="flex min-w-0 flex-col gap-3 py-3 first:pt-0 last:pb-0 @2xl/desktop-devices:flex-row @2xl/desktop-devices:items-start @2xl/desktop-devices:justify-between"
                >
                  <div className="min-w-0 space-y-1">
                    <div className="flex min-w-0 flex-wrap items-center gap-2">
                      <span className="min-w-0 text-sm leading-5 font-medium break-words text-foreground">
                        {device.name}
                      </span>
                      {isThisMac ? (
                        <Badge variant="outline">
                          {t("desktopDevices.thisMac")}
                        </Badge>
                      ) : null}
                      <Badge variant={statusVariant(state)}>
                        {t(`desktopDevices.${statusKeys[state]}`)}
                      </Badge>
                    </div>
                    <p className="text-xs leading-5 text-muted-foreground">
                      {device.platform === "darwin"
                        ? t("desktopDevices.platformDarwin")
                        : t("desktopDevices.platformWindows")}
                      {" · "}
                      {t("desktopDevices.appVersion", {
                        version: device.app_version,
                      })}
                    </p>
                    <p className="text-xs leading-5 text-muted-foreground">
                      {device.last_seen_at
                        ? t("desktopDevices.lastSeen", {
                            date: formatDateTime(device.last_seen_at, language),
                          })
                        : t("desktopDevices.neverSeen")}
                    </p>
                  </div>
                  {device.revoked_at === null ? (
                    <div className="flex shrink-0 flex-wrap gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => setRenaming(device)}
                      >
                        {t("desktopDevices.rename")}
                      </Button>
                      <Button
                        type="button"
                        variant="destructive-ghost"
                        size="sm"
                        onClick={() => setRevoking(device)}
                      >
                        {t("desktopDevices.revoke")}
                      </Button>
                    </div>
                  ) : null}
                </li>
              )
            })}
          </ul>
        )}
      </section>

      {renaming ? (
        <RenameDeviceDialog
          key={renaming.id}
          ownerId={ownerId}
          device={renaming}
          onClose={() => setRenaming(null)}
        />
      ) : null}
      {revoking ? (
        <RevokeDeviceDialog
          key={revoking.id}
          ownerId={ownerId}
          device={revoking}
          onClose={() => setRevoking(null)}
        />
      ) : null}
    </div>
  )
}

function PairDeviceForm({
  onPaired,
}: Readonly<{
  onPaired: (status: DesktopDeviceStatus) => void
}>) {
  const { t } = useTranslation()
  const inputId = useId()
  const titleId = useId()
  const hintId = `${inputId}-hint`
  const errorId = `${inputId}-error`
  const inputRef = useRef<HTMLInputElement>(null)
  const [name, setName] = useState("")
  const [nameError, setNameError] = useState<string | null>(null)
  const pair = useMutation({
    mutationFn: async (deviceName: string) => {
      const pairing = await createDesktopPairing()
      return pairDesktopDevice(pairing.code, deviceName)
    },
    retry: false,
    onSuccess: onPaired,
  })

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const trimmed = name.trim()
    if (!trimmed) {
      setNameError(t("desktopDevices.pairNameRequired"))
      inputRef.current?.focus()
      return
    }
    const parsed = desktopDeviceRenameInputSchema.safeParse({ name: trimmed })
    if (!parsed.success) {
      setNameError(t("desktopDevices.pairNameInvalid"))
      inputRef.current?.focus()
      return
    }
    setNameError(null)
    pair.mutate(parsed.data.name)
  }

  return (
    <form
      noValidate
      aria-labelledby={titleId}
      className="grid min-w-0 gap-3"
      onSubmit={submit}
    >
      <div className="space-y-1">
        <h3
          id={titleId}
          className="text-sm leading-5 font-semibold text-foreground"
        >
          {t("desktopDevices.pairTitle")}
        </h3>
        <p className="form-hint max-w-3xl text-pretty">
          {t("desktopDevices.pairDescription")}
        </p>
      </div>
      <Field data-invalid={nameError ? true : undefined}>
        <FieldLabel htmlFor={inputId} className="form-label" required>
          {t("desktopDevices.pairNameLabel")}
        </FieldLabel>
        <Input
          id={inputId}
          ref={inputRef}
          name="deviceName"
          value={name}
          required
          maxLength={120}
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          placeholder={t("desktopDevices.pairNamePlaceholder")}
          aria-invalid={nameError ? true : false}
          aria-describedby={nameError ? `${hintId} ${errorId}` : hintId}
          disabled={pair.isPending}
          onChange={(event) => {
            setName(event.target.value)
            setNameError(null)
            if (pair.error) pair.reset()
          }}
        />
        <FieldDescription id={hintId}>
          {t("desktopDevices.pairNameHint")}
        </FieldDescription>
        {nameError ? <FieldError id={errorId}>{nameError}</FieldError> : null}
      </Field>
      {pair.error ? (
        <StatusBanner variant="error">
          {actionError(pair.error, t, "desktopDevices.pairFailed")}
        </StatusBanner>
      ) : null}
      <div>
        <Button type="submit" disabled={pair.isPending}>
          {pair.isPending ? <Spinner data-icon="inline-start" /> : null}
          {pair.isPending
            ? t("desktopDevices.pairing")
            : t("desktopDevices.pairAction")}
        </Button>
      </div>
    </form>
  )
}

function RenameDeviceDialog({
  ownerId,
  device,
  onClose,
}: Readonly<{
  ownerId: string
  device: DesktopDevice
  onClose: () => void
}>) {
  const { t } = useTranslation()
  const client = useQueryClient()
  const inputId = useId()
  const hintId = `${inputId}-hint`
  const errorId = `${inputId}-error`
  const inputRef = useRef<HTMLInputElement>(null)
  const [name, setName] = useState(device.name)
  const [nameError, setNameError] = useState<string | null>(null)
  const rename = useMutation({
    mutationFn: (nextName: string) => renameDesktopDevice(device.id, nextName),
    retry: false,
    onSuccess: async () => {
      await client.invalidateQueries({
        queryKey: desktopDeviceKeys.list(ownerId),
      })
      onClose()
    },
  })

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const trimmed = name.trim()
    if (!trimmed) {
      setNameError(t("desktopDevices.pairNameRequired"))
      inputRef.current?.focus()
      return
    }
    const parsed = desktopDeviceRenameInputSchema.safeParse({ name: trimmed })
    if (!parsed.success) {
      setNameError(t("desktopDevices.pairNameInvalid"))
      inputRef.current?.focus()
      return
    }
    setNameError(null)
    rename.mutate(parsed.data.name)
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !rename.isPending) onClose()
      }}
    >
      <DialogContent variant="workspace" closeLabel={t("common.close")}>
        <DialogHeader>
          <DialogTitle>{t("desktopDevices.renameTitle")}</DialogTitle>
          <DialogDescription>
            {t("desktopDevices.renameDescription")}
          </DialogDescription>
        </DialogHeader>
        <form noValidate className="grid min-w-0 gap-5" onSubmit={submit}>
          <Field data-invalid={nameError ? true : undefined}>
            <FieldLabel htmlFor={inputId} className="form-label" required>
              {t("desktopDevices.renameNameLabel")}
            </FieldLabel>
            <Input
              id={inputId}
              ref={inputRef}
              name="deviceName"
              autoFocus
              value={name}
              required
              maxLength={120}
              autoComplete="off"
              autoCorrect="off"
              spellCheck={false}
              aria-invalid={nameError ? true : false}
              aria-describedby={nameError ? `${hintId} ${errorId}` : hintId}
              disabled={rename.isPending}
              onChange={(event) => {
                setName(event.target.value)
                setNameError(null)
                if (rename.error) rename.reset()
              }}
            />
            <FieldDescription id={hintId}>
              {t("desktopDevices.renameNameHint")}
            </FieldDescription>
            {nameError ? (
              <FieldError id={errorId}>{nameError}</FieldError>
            ) : null}
          </Field>
          {rename.error ? (
            <StatusBanner variant="error">
              {actionError(rename.error, t, "desktopDevices.renameFailed")}
            </StatusBanner>
          ) : null}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={rename.isPending}
              onClick={onClose}
            >
              {t("common.cancel")}
            </Button>
            <Button type="submit" disabled={rename.isPending}>
              {rename.isPending ? <Spinner data-icon="inline-start" /> : null}
              {rename.isPending ? t("common.saving") : t("common.save")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function RevokeDeviceDialog({
  ownerId,
  device,
  onClose,
}: Readonly<{
  ownerId: string
  device: DesktopDevice
  onClose: () => void
}>) {
  const { t } = useTranslation()
  const client = useQueryClient()
  const revoke = useMutation({
    mutationFn: () => revokeDesktopDevice(device.id),
    retry: false,
    onSuccess: async () => {
      await Promise.all([
        client.invalidateQueries({
          queryKey: desktopDeviceKeys.list(ownerId),
        }),
        client.invalidateQueries({
          queryKey: desktopDeviceStatusQueryKey(ownerId),
        }),
      ])
      onClose()
    },
  })

  return (
    <AlertDialog
      open
      onOpenChange={(open) => {
        if (!open && !revoke.isPending) onClose()
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t("desktopDevices.revokeTitle")}</AlertDialogTitle>
          <AlertDialogDescription>
            {t("desktopDevices.revokeDescription", { name: device.name })}
          </AlertDialogDescription>
        </AlertDialogHeader>
        {revoke.error ? (
          <StatusBanner variant="error">
            {actionError(revoke.error, t, "desktopDevices.revokeFailed")}
          </StatusBanner>
        ) : null}
        <AlertDialogFooter>
          <AlertDialogCancel autoFocus disabled={revoke.isPending}>
            {t("common.cancel")}
          </AlertDialogCancel>
          <Button
            type="button"
            variant="destructive"
            disabled={revoke.isPending}
            onClick={() => revoke.mutate()}
          >
            {revoke.isPending ? <Spinner data-icon="inline-start" /> : null}
            {revoke.isPending
              ? t("desktopDevices.revoking")
              : t("desktopDevices.revokeConfirm")}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
