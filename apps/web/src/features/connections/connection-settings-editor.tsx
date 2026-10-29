import { useId, useState, type FormEvent } from "react"
import { useTranslation } from "react-i18next"
import { CopyIcon, ExternalLinkIcon } from "lucide-react"
import {
  updateConnectionSettingsSchema,
  type ConnectionProviderSettings,
} from "@linksense/shared"
import { getErrorMessage } from "@/api/error-message"
import { ApiError } from "@/api/client"
import { notify } from "@/components/feedback/notification"
import { StatusBanner } from "@/components/feedback/status-banner"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { dialogBodyStyles } from "@/components/ui/dialog-layout"
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Spinner } from "@/components/ui/spinner"
import { ConnectionIcon } from "./connection-icon"
import { useUpdateConnectionSettings } from "./admin-settings-api"

export function ConnectionSettingsEditor({
  settings,
  onClose,
}: {
  settings: ConnectionProviderSettings
  onClose: () => void
}) {
  const { t } = useTranslation()
  const prefix = useId()
  const [clientId, setClientId] = useState(settings.client_id)
  const [secret, setSecret] = useState("")
  const [acknowledged, setAcknowledged] = useState(false)
  const [invalid, setInvalid] = useState({ client: false, secret: false })
  const mutation = useUpdateConnectionSettings(settings.provider)
  const providerName = t(`connections.${settings.provider}`)
  const clientChanged = Boolean(
    settings.client_id && clientId.trim() !== settings.client_id
  )
  const secretRequired = !settings.secret_configured || clientChanged
  const conflictCount =
    mutation.error instanceof ApiError &&
    mutation.error.errorCode ===
      "CONNECTION_CLIENT_CHANGE_REQUIRES_CONFIRMATION" &&
    typeof mutation.error.params?.count === "number"
      ? mutation.error.params.count
      : 0
  const accountCount = Math.max(settings.connected_account_count, conflictCount)
  const needsAcknowledgement = clientChanged && accountCount > 0
  const isGoogle =
    settings.provider === "google_docs" || settings.provider === "gmail"

  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (mutation.isPending || (needsAcknowledgement && !acknowledged)) return
    const input = updateConnectionSettingsSchema.safeParse({
      expected_revision: settings.revision,
      client_id: clientId,
      ...(secret ? { client_secret: secret } : {}),
      acknowledge_reauthorization: needsAcknowledgement && acknowledged,
    })
    const errors = {
      client:
        !clientId.trim() ||
        (!input.success &&
          input.error.issues.some((issue) => issue.path[0] === "client_id")),
      secret:
        (secretRequired && !secret.trim()) ||
        (!input.success &&
          input.error.issues.some(
            (issue) => issue.path[0] === "client_secret"
          )),
    }
    setInvalid(errors)
    if (!input.success || errors.client || errors.secret) return
    mutation.mutate(input.data, {
      onSuccess: () => {
        setSecret("")
        notify.success(t("adminConnections.saved"))
        onClose()
      },
    })
  }

  const copyCallback = async () => {
    try {
      await navigator.clipboard.writeText(settings.redirect_uri)
      notify.success(t("adminConnections.callbackCopied"))
    } catch {
      notify.error(t("adminConnections.copyFailed"))
    }
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !mutation.isPending) onClose()
      }}
    >
      <DialogContent
        closeLabel={t("common.close")}
        showCloseButton={!mutation.isPending}
        className="max-h-[calc(100svh-2rem)] w-[calc(100%-2rem)] grid-rows-[auto_minmax(0,1fr)] sm:max-w-3xl"
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-3">
            <ConnectionIcon provider={settings.provider} />
            {t("adminConnections.configureProvider", {
              provider: providerName,
            })}
          </DialogTitle>
          <DialogDescription>
            {t(`adminConnections.setup.${settings.provider}`)}
          </DialogDescription>
        </DialogHeader>
        <div className={dialogBodyStyles("grid gap-5")}>
          <Button
            variant="outline"
            className="w-fit"
            nativeButton={false}
            render={
              <a
                href={
                  isGoogle
                    ? "https://console.cloud.google.com/auth/clients"
                    : "https://entra.microsoft.com/"
                }
                target="_blank"
                rel="noreferrer"
              />
            }
          >
            <ExternalLinkIcon data-icon="inline-start" />
            {t("adminConnections.openConsole")}
          </Button>
          <form noValidate onSubmit={submit} className="grid min-w-0 gap-5">
            <FieldGroup>
              <Field
                data-invalid={invalid.client || undefined}
                data-disabled={mutation.isPending || undefined}
              >
                <FieldLabel htmlFor={`${prefix}-client`} required>
                  {t("adminConnections.clientId")}
                </FieldLabel>
                <Input
                  id={`${prefix}-client`}
                  value={clientId}
                  autoComplete="off"
                  maxLength={512}
                  required
                  disabled={mutation.isPending}
                  aria-invalid={invalid.client || undefined}
                  onChange={(event) => {
                    setClientId(event.target.value)
                    setAcknowledged(false)
                  }}
                />
                <FieldDescription>
                  {t("adminConnections.clientIdHelp")}
                </FieldDescription>
                {invalid.client && (
                  <FieldError>
                    {t("adminConnections.clientIdRequired")}
                  </FieldError>
                )}
              </Field>
              <Field
                data-invalid={invalid.secret || undefined}
                data-disabled={mutation.isPending || undefined}
              >
                <FieldLabel
                  htmlFor={`${prefix}-secret`}
                  required={secretRequired}
                >
                  {t("adminConnections.clientSecret")}
                </FieldLabel>
                <Input
                  id={`${prefix}-secret`}
                  type="password"
                  value={secret}
                  placeholder={secretRequired ? undefined : "••••••••"}
                  className="placeholder:text-foreground"
                  autoComplete="new-password"
                  maxLength={16_384}
                  required={secretRequired}
                  disabled={mutation.isPending}
                  aria-invalid={invalid.secret || undefined}
                  onChange={(event) => setSecret(event.target.value)}
                />
                <FieldDescription>
                  {t(
                    secretRequired
                      ? "adminConnections.secretNewHelp"
                      : "adminConnections.secretSavedHelp"
                  )}
                </FieldDescription>
                {invalid.secret && (
                  <FieldError>
                    {t("adminConnections.secretRequired")}
                  </FieldError>
                )}
              </Field>
              <Field>
                <FieldLabel htmlFor={`${prefix}-callback`}>
                  {t("adminConnections.redirectUri")}
                </FieldLabel>
                <div className="flex min-w-0 items-center gap-2">
                  <Input
                    id={`${prefix}-callback`}
                    readOnly
                    value={settings.redirect_uri}
                    className="min-w-0 flex-1"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    aria-label={t("adminConnections.copyCallback")}
                    title={t("adminConnections.copyCallback")}
                    disabled={mutation.isPending}
                    onClick={() => void copyCallback()}
                  >
                    <CopyIcon aria-hidden="true" />
                  </Button>
                </div>
                <FieldDescription>
                  {t("adminConnections.redirectHelp")}
                </FieldDescription>
              </Field>
              <Field>
                <FieldLabel id={`${prefix}-permissions`}>
                  {t("adminConnections.requiredPermissions")}
                </FieldLabel>
                <ul
                  aria-labelledby={`${prefix}-permissions`}
                  className="grid min-w-0 gap-1"
                >
                  {settings.required_scopes.map((scope) => (
                    <li
                      key={scope}
                      className="font-mono text-xs break-all text-muted-foreground"
                    >
                      {scope}
                    </li>
                  ))}
                </ul>
                <FieldDescription>
                  {t("adminConnections.permissionsHelp")}
                </FieldDescription>
              </Field>
              {needsAcknowledgement && (
                <Field>
                  <StatusBanner variant="warning">
                    {t("adminConnections.reauthorizationRequired", {
                      count: accountCount,
                    })}
                  </StatusBanner>
                  <Field
                    orientation="horizontal"
                    data-disabled={mutation.isPending || undefined}
                  >
                    <Checkbox
                      id={`${prefix}-acknowledge`}
                      checked={acknowledged}
                      disabled={mutation.isPending}
                      onCheckedChange={setAcknowledged}
                    />
                    <FieldLabel htmlFor={`${prefix}-acknowledge`}>
                      {t("adminConnections.acknowledgeReauthorization")}
                    </FieldLabel>
                  </Field>
                </Field>
              )}
            </FieldGroup>
            <p className="text-sm text-muted-foreground">
              {t("adminConnections.changeClientHelp")}
            </p>
            {mutation.isError && (
              <StatusBanner variant="error">
                {getErrorMessage(mutation.error, t)}
              </StatusBanner>
            )}
            <div className="flex flex-wrap justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                disabled={mutation.isPending}
                onClick={onClose}
              >
                {t("common.cancel")}
              </Button>
              <Button
                type="submit"
                disabled={
                  mutation.isPending || (needsAcknowledgement && !acknowledged)
                }
              >
                {mutation.isPending && <Spinner data-icon="inline-start" />}
                {t("common.save")}
              </Button>
            </div>
          </form>
        </div>
      </DialogContent>
    </Dialog>
  )
}
