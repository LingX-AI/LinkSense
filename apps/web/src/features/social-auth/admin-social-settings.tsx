import { Fragment, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useTranslation } from "react-i18next"
import {
  socialSettingsSchema,
  updateSocialProviderSchema,
  type SocialProviderSettings,
} from "@linksense/shared"
import { apiRequest } from "@/api/client"
import { getErrorMessage } from "@/api/error-message"
import { StatusBanner } from "@/components/feedback/status-banner"
import { notify } from "@/components/feedback/notification"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Separator } from "@/components/ui/separator"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { dialogBodyStyles } from "@/components/ui/dialog-layout"
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Switch } from "@/components/ui/switch"
import { Spinner } from "@/components/ui/spinner"
import { socialKeys } from "./api"
import { SocialProviderLogo } from "./social-provider-logo"

const consoles = {
  google: "https://console.cloud.google.com/auth/clients",
  apple:
    "https://developer.apple.com/account/resources/identifiers/list/serviceId",
  microsoft: "https://entra.microsoft.com/",
  facebook: "https://developers.facebook.com/apps/",
}

export function AdminSocialSettings() {
  const { t } = useTranslation()
  const query = useQuery({
    queryKey: socialKeys.settings,
    queryFn: () =>
      apiRequest("/admin/social-authentication-settings", {
        schema: socialSettingsSchema,
      }),
  })
  if (query.isPending) return <Spinner />
  if (query.isError)
    return (
      <StatusBanner variant="error">
        {getErrorMessage(query.error, t)}{" "}
        <Button variant="ghost" onClick={() => void query.refetch()}>
          {t("common.retry")}
        </Button>
      </StatusBanner>
    )
  return (
    <>
      {query.data.map((settings, index) => (
        <Fragment key={settings.provider}>
          {index > 0 && <Separator className="bg-[var(--app-divider)]" />}
          <ProviderSettings settings={settings} />
        </Fragment>
      ))}
    </>
  )
}

function ProviderSettings({ settings }: { settings: SocialProviderSettings }) {
  const { t } = useTranslation()
  const client = useQueryClient()
  const [open, setOpen] = useState(false)
  const [enabled, setEnabled] = useState(settings.enabled)
  const [clientId, setClientId] = useState(settings.client_id)
  const [secret, setSecret] = useState("")
  const [team, setTeam] = useState(settings.team_id ?? "")
  const [key, setKey] = useState(settings.key_id ?? "")
  const [version, setVersion] = useState(settings.graph_api_version ?? "")
  const [invalid, setInvalid] = useState(false)
  const mutation = useMutation({
    mutationFn: (body: unknown) =>
      apiRequest(`/admin/social-authentication-settings/${settings.provider}`, {
        method: "PUT",
        schema: socialSettingsSchema,
        body,
      }),
    onSuccess: (data) => {
      setOpen(false)
      setSecret("")
      notify.success(t("social.saved"))
      client.setQueryData(socialKeys.settings, data)
      void client.invalidateQueries({ queryKey: socialKeys.providers })
    },
  })
  const id = (name: string) => `social-${settings.provider}-${name}`
  const providerName = t(`social.providers.${settings.provider}`)
  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (mutation.isPending) return
        setOpen(nextOpen)
        setSecret("")
        if (nextOpen) {
          setEnabled(settings.enabled)
          setClientId(settings.client_id)
          setTeam(settings.team_id ?? "")
          setKey(settings.key_id ?? "")
          setVersion(settings.graph_api_version ?? "")
          setInvalid(false)
          mutation.reset()
        }
      }}
    >
      <section
        aria-labelledby={id("title")}
        className="flex min-w-0 flex-col gap-3 py-2 sm:flex-row sm:items-center sm:justify-between sm:gap-6"
      >
        <div className="grid min-w-0 gap-1">
          <h3
            id={id("title")}
            className="flex items-center gap-2 text-sm font-medium"
          >
            <SocialProviderLogo provider={settings.provider} />
            {providerName}
          </h3>
          <p className="text-sm text-muted-foreground">
            {t("social.providerDescription", { provider: providerName })}
          </p>
        </div>
        <div className="flex shrink-0 items-center justify-end gap-3">
          <Badge variant="secondary">
            {t(
              settings.enabled
                ? "social.statusEnabled"
                : settings.secret_configured
                  ? "social.statusDisabled"
                  : "social.statusNotConfigured"
            )}
          </Badge>
          <DialogTrigger
            render={<Button variant="outline" />}
            aria-label={t("social.configureProvider", {
              provider: providerName,
            })}
          >
            {t("social.configure")}
          </DialogTrigger>
        </div>
      </section>
      <DialogContent
        closeLabel={t("common.close")}
        showCloseButton={!mutation.isPending}
        className="max-h-[calc(100svh-2rem)] grid-rows-[auto_minmax(0,1fr)] sm:max-w-xl"
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <SocialProviderLogo provider={settings.provider} />
            {t("social.configureProvider", { provider: providerName })}
          </DialogTitle>
          <DialogDescription>
            {t(`social.${settings.provider}Help`)}
          </DialogDescription>
        </DialogHeader>
        <div className={dialogBodyStyles("grid gap-4")}>
          <a
            className="text-sm underline underline-offset-4"
            href={consoles[settings.provider]}
            target="_blank"
            rel="noreferrer"
          >
            {t("social.guide")}
          </a>
          <form
            className="grid gap-4"
            onSubmit={(event) => {
              event.preventDefault()
              if (mutation.isPending) return
              const result = updateSocialProviderSchema.safeParse({
                expected_revision: settings.revision,
                enabled,
                client_id: clientId,
                ...(secret ? { client_secret: secret } : {}),
                ...(team ? { team_id: team } : {}),
                ...(key ? { key_id: key } : {}),
                ...(version ? { graph_api_version: version } : {}),
              })
              const missing =
                enabled &&
                ((!secret && !settings.secret_configured) ||
                  (settings.provider === "apple" && (!team || !key)) ||
                  (settings.provider === "facebook" && !version))
              setInvalid(!result.success || missing)
              if (result.success && !missing) mutation.mutate(result.data)
            }}
          >
            <FieldGroup>
              <Field orientation="horizontal">
                <Switch
                  id={id("enabled")}
                  checked={enabled}
                  onCheckedChange={setEnabled}
                  disabled={mutation.isPending}
                />
                <FieldLabel htmlFor={id("enabled")}>
                  {t("social.enabled")}
                </FieldLabel>
              </Field>
              <FieldDescription>{t("social.disableHelp")}</FieldDescription>
              <Field>
                <FieldLabel htmlFor={id("client")}>
                  {t("social.clientId")}
                </FieldLabel>
                <Input
                  id={id("client")}
                  value={clientId}
                  onChange={(event) => setClientId(event.target.value)}
                  required={enabled}
                  disabled={mutation.isPending}
                  autoComplete="off"
                  maxLength={512}
                />
              </Field>
              {settings.provider === "apple" && (
                <>
                  <Field>
                    <FieldLabel htmlFor={id("team")}>
                      {t("social.teamId")}
                    </FieldLabel>
                    <Input
                      id={id("team")}
                      value={team}
                      onChange={(event) => setTeam(event.target.value)}
                      required={enabled}
                      disabled={mutation.isPending}
                    />
                  </Field>
                  <Field>
                    <FieldLabel htmlFor={id("key")}>
                      {t("social.keyId")}
                    </FieldLabel>
                    <Input
                      id={id("key")}
                      value={key}
                      onChange={(event) => setKey(event.target.value)}
                      required={enabled}
                      disabled={mutation.isPending}
                    />
                  </Field>
                </>
              )}
              {settings.provider === "facebook" && (
                <Field>
                  <FieldLabel htmlFor={id("version")}>
                    {t("social.graphVersion")}
                  </FieldLabel>
                  <Input
                    id={id("version")}
                    value={version}
                    onChange={(event) => setVersion(event.target.value)}
                    required={enabled}
                    disabled={mutation.isPending}
                  />
                </Field>
              )}
              <Field>
                <FieldLabel htmlFor={id("secret")}>
                  {t(
                    settings.provider === "apple"
                      ? "social.privateKey"
                      : "social.clientSecret"
                  )}
                </FieldLabel>
                {settings.provider === "apple" ? (
                  <Textarea
                    id={id("secret")}
                    value={secret}
                    onChange={(event) => setSecret(event.target.value)}
                    placeholder={t(
                      settings.secret_configured
                        ? "social.secretSaved"
                        : "social.secretEmpty"
                    )}
                    disabled={mutation.isPending}
                    autoComplete="off"
                    spellCheck={false}
                  />
                ) : (
                  <Input
                    id={id("secret")}
                    type="password"
                    autoComplete="new-password"
                    value={secret}
                    onChange={(event) => setSecret(event.target.value)}
                    placeholder={t(
                      settings.secret_configured
                        ? "social.secretSaved"
                        : "social.secretEmpty"
                    )}
                    disabled={mutation.isPending}
                  />
                )}
                <FieldDescription>
                  {t("social.credentialsHelp")}
                </FieldDescription>
              </Field>
              <Field>
                <FieldLabel htmlFor={id("redirect")}>
                  {t("social.redirectUri")}
                </FieldLabel>
                <Input
                  id={id("redirect")}
                  value={settings.redirect_uri}
                  readOnly
                  onFocus={(event) => event.target.select()}
                />
                <FieldDescription>{t("social.redirectHelp")}</FieldDescription>
              </Field>
            </FieldGroup>
            {invalid && (
              <StatusBanner variant="error">
                {t("errors.validation")}
              </StatusBanner>
            )}
            {mutation.error && (
              <StatusBanner variant="error">
                {getErrorMessage(mutation.error, t)}
              </StatusBanner>
            )}
            <div className="flex flex-wrap justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                disabled={mutation.isPending}
                onClick={() => {
                  setOpen(false)
                  setSecret("")
                }}
              >
                {t("common.cancel")}
              </Button>
              <Button type="submit" disabled={mutation.isPending}>
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
