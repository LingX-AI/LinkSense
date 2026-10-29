import { useState, type FormEvent } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useTranslation } from "react-i18next"
import { z } from "zod"
import {
  botChannelAdminConnectionListSchema,
  botChannelAdminConnectionSchema,
  botChannelAdminCreateSchema,
  type BotChannelAdminConnection,
  type BotChannelAdminCreate,
} from "@linksense/shared"
import { apiRequest } from "@/api/client"
import { getErrorMessage } from "@/api/error-message"
import { SettingsCard } from "@/components/settings/settings-card"
import { SettingsSectionHeader } from "@/components/settings/settings-section-header"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Spinner } from "@/components/ui/spinner"
import { botChannelKeys } from "./use-bot-channels"
export function AdminBotChannels() {
  const { t } = useTranslation()
  const client = useQueryClient()
  const refresh = async () => {
    await Promise.all([
      client.invalidateQueries({ queryKey: botChannelKeys.organization }),
      client.invalidateQueries({ queryKey: botChannelKeys.connections }),
    ])
  }
  const query = useQuery({
    queryKey: botChannelKeys.organization,
    queryFn: ({ signal }) =>
      apiRequest("/bot-channels/organization", {
        schema: botChannelAdminConnectionListSchema,
        signal,
      }),
    refetchInterval: 5000,
  })
  return (
    <div className="flex min-w-0 flex-col gap-6">
      <SettingsSectionHeader
        id="organization-bot-channels"
        title={t("botChannels.adminTitle")}
        description={t("botChannels.adminHelp")}
      />
      {query.isPending && <Spinner aria-label={t("common.loading")} />}
      {query.isError && (
        <Alert variant="destructive">
          <AlertDescription>
            {getErrorMessage(query.error, t)}
            <Button variant="outline" onClick={() => void query.refetch()}>
              {t("botChannels.retry")}
            </Button>
          </AlertDescription>
        </Alert>
      )}
      {(["wecom", "teams"] as const).map((provider) => (
        <OrganizationBot
          key={provider}
          provider={provider}
          connection={
            query.data?.items.find((item) => item.provider === provider) ?? null
          }
          ready={query.isSuccess}
          refresh={refresh}
        />
      ))}
    </div>
  )
}
function OrganizationBot({
  provider,
  connection,
  ready,
  refresh,
}: {
  provider: "wecom" | "teams"
  connection: BotChannelAdminConnection | null
  ready: boolean
  refresh(): Promise<void>
}) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [removing, setRemoving] = useState(false)
  const [appId, setAppId] = useState("")
  const [secret, setSecret] = useState("")
  const [tenant, setTenant] = useState("")
  const [groups, setGroups] = useState(true)
  const [invalid, setInvalid] = useState(false)
  const create = useMutation({
    mutationFn: (body: BotChannelAdminCreate) =>
      apiRequest("/bot-channels/organization", {
        method: "POST",
        body,
        schema: botChannelAdminConnectionSchema,
      }),
    onSuccess: refresh,
    gcTime: 0,
  })
  const remove = useMutation({
    mutationFn: () =>
      apiRequest(`/bot-channels/organization/${connection?.id}`, {
        method: "DELETE",
        schema: z.null(),
      }),
    onSuccess: refresh,
  })
  const enable = useMutation({
    mutationFn: (enabled: boolean) =>
      apiRequest(`/bot-channels/organization/${connection?.id}`, {
        method: "PATCH",
        body: { enabled },
        schema: z.null(),
      }),
    onSuccess: refresh,
  })
  const busy = create.isPending || remove.isPending || enable.isPending
  const error = create.error ?? remove.error ?? enable.error
  const name = t(`channelAccess.${provider}.name`)
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy) return
    const body =
      provider === "wecom"
        ? { provider, bot_id: appId, secret, allow_group_messages: groups }
        : {
            provider,
            client_id: appId,
            client_secret: secret,
            tenant_id: tenant,
            allow_group_messages: groups,
          }
    const parsed = botChannelAdminCreateSchema.safeParse(body)
    setInvalid(!parsed.success)
    if (!parsed.success) return
    try {
      await create.mutateAsync(parsed.data)
      setSecret("")
      create.reset()
      setOpen(false)
    } catch {
      /* Shown in dialog. */
    }
  }
  const actions = (
    <div className="flex flex-wrap justify-end gap-2">
      {connection ? (
        <>
          <Button
            variant="outline"
            disabled={busy}
            onClick={() =>
              enable.mutate(connection.runtime_status === "disabled")
            }
          >
            {t(
              connection.runtime_status === "disabled"
                ? "botChannels.enable"
                : "botChannels.pause"
            )}
          </Button>
          <Button
            variant="destructive"
            disabled={busy}
            onClick={() => setRemoving(true)}
          >
            {t("botChannels.disconnect", { name })}
          </Button>
        </>
      ) : (
        <Button
          disabled={!ready || busy}
          onClick={() => {
            create.reset()
            setInvalid(false)
            setOpen(true)
          }}
        >
          {t("botChannels.setupTitle", { name })}
        </Button>
      )}
    </div>
  )
  const header = (
    <SettingsSectionHeader
      id={`${provider}-organization-bot`}
      title={name}
      description={t(`botChannels.setup.${provider}`)}
      action={connection ? undefined : actions}
    />
  )
  return (
    <>
      {connection ? (
        <SettingsCard header={header}>
          <div className="flex min-w-0 flex-col gap-4">
            <Badge variant="secondary">
              {t(`botChannels.status.${connection.runtime_status}`)}
            </Badge>
            <Field>
              <FieldLabel htmlFor={`${provider}-account`}>
                {t("botChannels.account")}
              </FieldLabel>
              <Input
                id={`${provider}-account`}
                readOnly
                value={connection.account_hint}
              />
            </Field>
            {connection.callback_url && (
              <Field>
                <FieldLabel htmlFor={`${provider}-callback`}>
                  {t("botChannels.callback")}
                </FieldLabel>
                <Input
                  id={`${provider}-callback`}
                  readOnly
                  value={connection.callback_url}
                />
                <FieldDescription>
                  {t("botChannels.callbackHelp")}
                </FieldDescription>
              </Field>
            )}
            <p className="text-sm text-muted-foreground">
              {t("botChannels.replaceHelp")}
            </p>
          </div>

          {error && !open && (
            <Alert variant="destructive">
              <AlertDescription>{getErrorMessage(error, t)}</AlertDescription>
            </Alert>
          )}
          {actions}
        </SettingsCard>
      ) : (
        <section
          className="grid min-w-0 gap-3"
          data-slot="settings-card"
          aria-labelledby={`${provider}-organization-bot`}
        >
          {header}
          {error && !open && (
            <Alert variant="destructive">
              <AlertDescription>{getErrorMessage(error, t)}</AlertDescription>
            </Alert>
          )}
        </section>
      )}
      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (!busy) {
            setOpen(next)
            if (!next) {
              setSecret("")
              create.reset()
            }
          }
        }}
      >
        <DialogContent
          closeLabel={t("common.close")}
          className="max-h-[calc(100dvh-2rem)] overflow-y-auto"
        >
          <DialogHeader>
            <DialogTitle>{t("botChannels.setupTitle", { name })}</DialogTitle>
            <DialogDescription>
              {t(`botChannels.setup.${provider}`)}
            </DialogDescription>
          </DialogHeader>
          <form
            onSubmit={(event) => void submit(event)}
            className="flex flex-col gap-6"
          >
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor={`${provider}-app`} required>
                  {t(
                    provider === "wecom"
                      ? "botChannels.botId"
                      : "botChannels.clientId"
                  )}
                </FieldLabel>
                <Input
                  id={`${provider}-app`}
                  value={appId}
                  onChange={(event) => setAppId(event.target.value)}
                  required
                  autoComplete="off"
                  disabled={busy}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor={`${provider}-secret`} required>
                  {t("botChannels.secret")}
                </FieldLabel>
                <Input
                  id={`${provider}-secret`}
                  type="password"
                  value={secret}
                  onChange={(event) => setSecret(event.target.value)}
                  required
                  autoComplete="new-password"
                  disabled={busy}
                />
              </Field>
              {provider === "teams" && (
                <Field>
                  <FieldLabel htmlFor="teams-tenant" required>
                    {t("botChannels.tenantId")}
                  </FieldLabel>
                  <Input
                    id="teams-tenant"
                    value={tenant}
                    onChange={(event) => setTenant(event.target.value)}
                    required
                    autoComplete="off"
                    disabled={busy}
                  />
                </Field>
              )}
              <Field orientation="horizontal">
                <Checkbox
                  id={`${provider}-groups`}
                  checked={groups}
                  onCheckedChange={(checked) => setGroups(checked === true)}
                  disabled={busy}
                />
                <FieldLabel htmlFor={`${provider}-groups`}>
                  {t("botChannels.groups")}
                </FieldLabel>
              </Field>
            </FieldGroup>
            {invalid && (
              <p role="alert" className="text-destructive">
                {t("botChannels.invalid")}
              </p>
            )}
            {create.isError && (
              <Alert variant="destructive">
                <AlertDescription>
                  {getErrorMessage(create.error, t)}
                </AlertDescription>
              </Alert>
            )}
            <DialogFooter>
              <Button type="submit" disabled={busy}>
                {busy && <Spinner data-icon="inline-start" />}
                {t("botChannels.save")}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      <Dialog
        open={removing}
        onOpenChange={(next) => {
          if (!busy) setRemoving(next)
        }}
      >
        <DialogContent closeLabel={t("common.close")}>
          <DialogHeader>
            <DialogTitle>{t("botChannels.confirmDisconnect")}</DialogTitle>
            <DialogDescription>
              {t("botChannels.disconnectHelp")}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => setRemoving(false)}
            >
              {t("common.cancel")}
            </Button>
            <Button
              variant="destructive"
              disabled={busy}
              onClick={() =>
                remove.mutate(undefined, {
                  onSuccess: () => setRemoving(false),
                })
              }
            >
              {t("botChannels.confirmDisconnect")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
