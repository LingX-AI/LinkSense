import { useState, type FormEvent } from "react"
import { useTranslation } from "react-i18next"
import { AiFillDingtalkCircle, AiFillWechatWork } from "react-icons/ai"
import { BiLogoMicrosoftTeams } from "react-icons/bi"
import {
  botChannelCreateSchema,
  type BotChannelConnection,
  type BotChannelProvider,
} from "@linksense/shared"
import { getErrorMessage } from "@/api/error-message"
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
import { useBotChannels } from "./use-bot-channels"

const channels = [
  { provider: "wecom", icon: AiFillWechatWork },
  { provider: "dingtalk", icon: AiFillDingtalkCircle },
  { provider: "teams", icon: BiLogoMicrosoftTeams },
] as const

export function BotChannelCards() {
  const controls = useBotChannels()
  const { t } = useTranslation()
  return (
    <>
      {controls.query.isPending && <Spinner aria-label={t("common.loading")} />}
      {controls.query.isError && (
        <Alert variant="destructive">
          <AlertDescription>
            {getErrorMessage(controls.query.error, t)}
            <Button
              variant="outline"
              onClick={() => void controls.query.refetch()}
            >
              {t("botChannels.retry")}
            </Button>
          </AlertDescription>
        </Alert>
      )}
      {channels.map(({ provider, icon: Icon }) => (
        <BotChannelCard
          key={provider}
          provider={provider}
          connection={
            controls.query.data?.items.find(
              (item) => item.provider === provider
            ) ?? null
          }
          controls={controls}
          icon={<Icon />}
        />
      ))}
    </>
  )
}

function BotChannelCard({
  provider,
  connection,
  controls,
  icon,
}: {
  provider: BotChannelProvider
  connection: BotChannelConnection | null
  controls: ReturnType<typeof useBotChannels>
  icon: React.ReactNode
}) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [confirmDisconnect, setConfirmDisconnect] = useState(false)
  const [appId, setAppId] = useState("")
  const [secret, setSecret] = useState("")
  const [tenantId, setTenantId] = useState("")
  const [senderId, setSenderId] = useState("")
  const [groups, setGroups] = useState(true)
  const [invalid, setInvalid] = useState(false)
  const name = t(`channelAccess.${provider}.name`)
  const busy = controls.create.isPending || controls.disconnect.isPending
  const openSettings = () => {
    controls.create.reset()
    setInvalid(false)
    setSecret("")
    setOpen(true)
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy) return
    const access = { allowed_sender_id: senderId, allow_group_messages: groups }
    const parsed = botChannelCreateSchema.safeParse(
      provider === "wecom"
        ? { provider, bot_id: appId, secret, ...access }
        : provider === "dingtalk"
          ? { provider, client_id: appId, client_secret: secret, ...access }
          : {
              provider,
              client_id: appId,
              client_secret: secret,
              tenant_id: tenantId,
              ...access,
            }
    )
    setInvalid(!parsed.success)
    if (!parsed.success) return
    try {
      await controls.create.mutateAsync(parsed.data)
      controls.create.reset()
      setSecret("")
      setOpen(false)
    } catch {
      /* Mutation error is rendered in the dialog. */
    }
  }
  return (
    <>
      <article className="channel-access-card">
        <div className="channel-access-card-header">
          <div className="channel-access-heading">
            <span
              className="channel-access-icon"
              data-channel={provider}
              aria-hidden="true"
            >
              {icon}
            </span>
            <div className="min-w-0">
              <div className="channel-access-title-row">
                <h2>{name}</h2>
                <Badge variant="secondary">
                  {t(
                    connection
                      ? `botChannels.status.${connection.runtime_status}`
                      : "botChannels.status.disconnected"
                  )}
                </Badge>
              </div>
              <p>{t(`botChannels.description.${provider}`)}</p>
            </div>
          </div>
          <div className="flex shrink-0 flex-wrap gap-2">
            <Button
              variant="outline"
              disabled={busy || !controls.query.isSuccess}
              onClick={openSettings}
            >
              {t(connection ? "botChannels.settings" : "botChannels.connect", {
                name,
              })}
            </Button>
            {connection && (
              <Button
                variant="ghost"
                disabled={busy}
                onClick={() => {
                  controls.disconnect.reset()
                  setConfirmDisconnect(true)
                }}
              >
                {t("botChannels.disconnect", { name })}
              </Button>
            )}
          </div>
        </div>
      </article>
      <Dialog
        open={open}
        onOpenChange={(value) => {
          if (!busy) {
            setOpen(value)
            if (!value) setSecret("")
          }
        }}
      >
        <DialogContent
          closeLabel={t("common.close")}
          className="max-h-[90dvh] overflow-y-auto"
        >
          <DialogHeader>
            <DialogTitle>{t("botChannels.setupTitle", { name })}</DialogTitle>
            <DialogDescription>
              {t(`botChannels.setup.${provider}`)}
            </DialogDescription>
          </DialogHeader>
          {connection ? (
            <FieldGroup>
              <Field>
                <FieldLabel>{t("botChannels.account")}</FieldLabel>
                <p className="break-all">{connection.account_hint}</p>
              </Field>
              <Field>
                <FieldLabel>{t("botChannels.sender")}</FieldLabel>
                <p className="break-all">{connection.allowed_sender_id}</p>
              </Field>
              {connection.callback_url && (
                <Field>
                  <FieldLabel htmlFor={`${provider}-callback`}>
                    {t("botChannels.callback")}
                  </FieldLabel>
                  <Input
                    id={`${provider}-callback`}
                    value={connection.callback_url}
                    readOnly
                  />
                  <FieldDescription>
                    {t("botChannels.callbackHelp")}
                  </FieldDescription>
                </Field>
              )}
              <Alert>
                <AlertDescription>
                  {connection.last_error_code
                    ? t("botChannels.connectionError")
                    : t(`botChannels.status.${connection.runtime_status}`)}
                </AlertDescription>
              </Alert>
              <FieldDescription>
                {t("botChannels.replaceHelp")}
              </FieldDescription>
            </FieldGroup>
          ) : (
            <form
              onSubmit={(event) => void submit(event)}
              className="flex flex-col gap-6"
            >
              <FieldGroup>
                <Field data-invalid={invalid}>
                  <FieldLabel htmlFor={`${provider}-app`}>
                    {t(
                      provider === "wecom"
                        ? "botChannels.botId"
                        : "botChannels.clientId"
                    )}
                  </FieldLabel>
                  <Input
                    id={`${provider}-app`}
                    required
                    maxLength={128}
                    value={appId}
                    onChange={(event) => setAppId(event.target.value)}
                    aria-invalid={invalid}
                    disabled={busy}
                  />
                </Field>
                <Field data-invalid={invalid}>
                  <FieldLabel htmlFor={`${provider}-secret`}>
                    {t("botChannels.secret")}
                  </FieldLabel>
                  <Input
                    id={`${provider}-secret`}
                    type="password"
                    autoComplete="new-password"
                    required
                    maxLength={4096}
                    value={secret}
                    onChange={(event) => setSecret(event.target.value)}
                    aria-invalid={invalid}
                    disabled={busy}
                  />
                </Field>
                {provider === "teams" && (
                  <Field data-invalid={invalid}>
                    <FieldLabel htmlFor="teams-tenant">
                      {t("botChannels.tenantId")}
                    </FieldLabel>
                    <Input
                      id="teams-tenant"
                      required
                      value={tenantId}
                      onChange={(event) => setTenantId(event.target.value)}
                      aria-invalid={invalid}
                      disabled={busy}
                    />
                  </Field>
                )}
                <Field data-invalid={invalid}>
                  <FieldLabel htmlFor={`${provider}-sender`}>
                    {t("botChannels.sender")}
                  </FieldLabel>
                  <Input
                    id={`${provider}-sender`}
                    required
                    maxLength={256}
                    value={senderId}
                    onChange={(event) => setSenderId(event.target.value)}
                    aria-invalid={invalid}
                    disabled={busy}
                  />
                  <FieldDescription>
                    {t(`botChannels.senderHelp.${provider}`)}
                  </FieldDescription>
                </Field>
                <Field orientation="horizontal">
                  <Checkbox
                    id={`${provider}-groups`}
                    checked={groups}
                    onCheckedChange={setGroups}
                    disabled={busy}
                  />
                  <FieldLabel htmlFor={`${provider}-groups`}>
                    {t("botChannels.groups")}
                  </FieldLabel>
                </Field>
              </FieldGroup>
              {invalid && (
                <Alert variant="destructive">
                  <AlertDescription>
                    {t("botChannels.invalid")}
                  </AlertDescription>
                </Alert>
              )}
              {controls.create.isError && (
                <Alert variant="destructive">
                  <AlertDescription>
                    {getErrorMessage(controls.create.error, t)}
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
          )}
        </DialogContent>
      </Dialog>
      <Dialog
        open={confirmDisconnect}
        onOpenChange={(value) => {
          if (!busy) setConfirmDisconnect(value)
        }}
      >
        <DialogContent closeLabel={t("common.close")}>
          <DialogHeader>
            <DialogTitle>{t("botChannels.disconnect", { name })}</DialogTitle>
            <DialogDescription>
              {t("botChannels.disconnectHelp")}
            </DialogDescription>
          </DialogHeader>
          {controls.disconnect.isError && (
            <Alert variant="destructive">
              <AlertDescription>
                {getErrorMessage(controls.disconnect.error, t)}
              </AlertDescription>
            </Alert>
          )}
          <DialogFooter>
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => setConfirmDisconnect(false)}
            >
              {t("botChannels.cancel")}
            </Button>
            <Button
              variant="destructive"
              disabled={busy}
              onClick={async () => {
                if (!connection || busy) return
                try {
                  await controls.disconnect.mutateAsync(connection.id)
                  setConfirmDisconnect(false)
                } catch {
                  /* Render mutation error. */
                }
              }}
            >
              {busy && <Spinner data-icon="inline-start" />}
              {t("botChannels.confirmDisconnect")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
