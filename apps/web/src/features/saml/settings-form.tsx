import { useState } from "react"
import { useTranslation } from "react-i18next"
import { updateSamlSettingsSchema, type SamlSettings } from "@linksense/shared"
import { getErrorMessage } from "@/api/error-message"
import { SettingsCard } from "@/components/settings/settings-card"
import { SettingsSectionHeader } from "@/components/settings/settings-section-header"
import { ErrorState, LoadingState } from "@/components/feedback/page-state"
import { StatusBanner } from "@/components/feedback/status-banner"
import {
  FieldShell,
  SettingsFieldGroup,
  SettingsFieldRow,
} from "@/components/forms/form-field"
import { notify } from "@/components/feedback/notification"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Switch } from "@/components/ui/switch"
import { Spinner } from "@/components/ui/spinner"
import { useSamlSettings, useUpdateSamlSettings } from "./api"

export function SamlSettingsForm() {
  const { t } = useTranslation()
  const query = useSamlSettings()
  return (
    <SettingsCard
      aria-labelledby="saml-title"
      header={
        <SettingsSectionHeader
          id="saml-title"
          title={t("saml.title")}
          description={t("saml.description")}
          status={
            query.data && (
              <Badge variant="secondary">
                {t(
                  `admin.authSettings.status.${query.data.status === "not_configured" ? "notConfigured" : query.data.status}`
                )}
              </Badge>
            )
          }
        />
      }
    >
      {query.isPending ? (
        <LoadingState />
      ) : query.isError ? (
        <ErrorState
          message={getErrorMessage(query.error, t)}
          onRetry={() => void query.refetch()}
        />
      ) : (
        <SamlEditor key={query.data.revision} settings={query.data} />
      )}
    </SettingsCard>
  )
}
function SamlEditor({ settings }: { settings: SamlSettings }) {
  const { t } = useTranslation()
  const mutation = useUpdateSamlSettings()
  const [draft, setDraft] = useState(settings)
  const [privateKey, setPrivateKey] = useState("")
  const [invalid, setInvalid] = useState(false)
  const https = new URL(settings.acs_url).protocol === "https:"
  const fields = [
    ["idp_entity_id", "idpEntityId"],
    ["idp_sso_url", "idpSsoUrl"],
    ["idp_certificate", "idpCertificate"],
    ["email_attribute", "emailAttribute"],
    ["name_attribute", "nameAttribute"],
  ] as const
  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault()
        if (mutation.isPending) return
        const parsed = updateSamlSettingsSchema.safeParse({
          expected_revision: settings.revision,
          enabled: draft.enabled,
          idp_entity_id: draft.idp_entity_id,
          idp_sso_url: draft.idp_sso_url,
          idp_certificate: draft.idp_certificate,
          email_attribute: draft.email_attribute,
          name_attribute: draft.name_attribute,
          sign_requests: draft.sign_requests,
          signing_certificate: draft.sign_requests
            ? draft.signing_certificate
            : "",
          ...(privateKey ? { signing_private_key: privateKey } : {}),
        })
        const missingKey =
          draft.sign_requests &&
          (!draft.signing_certificate ||
            (!privateKey && !settings.signing_private_key_configured))
        setInvalid(!parsed.success || missingKey)
        if (parsed.success && !missingKey)
          mutation.mutate(parsed.data, {
            onSuccess: () => {
              setPrivateKey("")
              notify.success(t("admin.authSettings.saved"))
            },
          })
      }}
    >
      {!https && (
        <StatusBanner variant="warning">{t("saml.httpsRequired")}</StatusBanner>
      )}
      {invalid && (
        <StatusBanner variant="error">{t("errors.validation")}</StatusBanner>
      )}
      {mutation.error && (
        <StatusBanner variant="error">
          {getErrorMessage(mutation.error, t)}
        </StatusBanner>
      )}
      <SettingsFieldGroup>
        <SettingsFieldRow
          id="saml-enabled"
          label={t("saml.enabled")}
          controlWidth="compact"
        >
          <Switch
            id="saml-enabled"
            checked={draft.enabled}
            onCheckedChange={(enabled) => setDraft({ ...draft, enabled })}
            disabled={mutation.isPending || (!https && !draft.enabled)}
          />
        </SettingsFieldRow>
        {fields.map(([key, label]) => (
          <FieldShell
            multiline={key === "idp_certificate"}
            key={key}
            id={`saml-${key}`}
            label={t(`saml.${label}`)}
            hint={
              key === "email_attribute" || key === "name_attribute"
                ? t("saml.attributeHelp")
                : undefined
            }
            layout="settings"
            controlWidth={key === "idp_certificate" ? "full" : "wide"}
          >
            {key === "idp_certificate" ? (
              <Textarea
                id={`saml-${key}`}
                value={draft[key]}
                onChange={(event) =>
                  setDraft({ ...draft, [key]: event.target.value })
                }
                maxLength={16384}
                disabled={mutation.isPending}
                aria-invalid={invalid || undefined}
              />
            ) : (
              <Input
                id={`saml-${key}`}
                value={draft[key]}
                onChange={(event) =>
                  setDraft({ ...draft, [key]: event.target.value })
                }
                maxLength={
                  key === "email_attribute" || key === "name_attribute"
                    ? 512
                    : 2048
                }
                disabled={mutation.isPending}
                aria-invalid={invalid || undefined}
              />
            )}
          </FieldShell>
        ))}
        <SettingsFieldRow
          id="saml-sign"
          label={t("saml.signRequests")}
          controlWidth="compact"
        >
          <Switch
            id="saml-sign"
            checked={draft.sign_requests}
            disabled={mutation.isPending}
            onCheckedChange={(sign_requests) => {
              setDraft({ ...draft, sign_requests })
              setPrivateKey("")
            }}
          />
        </SettingsFieldRow>
        {draft.sign_requests && (
          <>
            <FieldShell
              multiline
              id="saml-sign-cert"
              label={t("saml.signingCertificate")}
              layout="settings"
              controlWidth="full"
            >
              <Textarea
                id="saml-sign-cert"
                value={draft.signing_certificate}
                onChange={(event) =>
                  setDraft({
                    ...draft,
                    signing_certificate: event.target.value,
                  })
                }
                maxLength={16384}
                disabled={mutation.isPending}
              />
            </FieldShell>
            <FieldShell
              multiline
              id="saml-private-key"
              label={t("saml.signingKey")}
              hint={t("saml.signingHelp")}
              layout="settings"
              controlWidth="full"
            >
              <Textarea
                id="saml-private-key"
                value={privateKey}
                onChange={(event) => setPrivateKey(event.target.value)}
                placeholder={t(
                  settings.signing_private_key_configured
                    ? "admin.authSettings.secretPreserved"
                    : "admin.authSettings.secretRequired"
                )}
                autoComplete="off"
                maxLength={16384}
                disabled={mutation.isPending}
              />
            </FieldShell>
          </>
        )}
        <FieldShell
          id="saml-sp-id"
          label={t("saml.spEntityId")}
          layout="settings"
          controlWidth="wide"
        >
          <Input id="saml-sp-id" value={settings.sp_entity_id} readOnly />
        </FieldShell>
        <FieldShell
          id="saml-acs"
          label={t("saml.acsUrl")}
          hint={t("saml.metadataHelp")}
          layout="settings"
          controlWidth="wide"
        >
          <Input id="saml-acs" value={settings.acs_url} readOnly />
        </FieldShell>
      </SettingsFieldGroup>
      <div className="flex flex-wrap justify-end gap-2">
        {settings.status === "configured" && (
          <Button
            variant="outline"
            render={<a href={settings.metadata_url} download />}
          >
            {t("saml.metadata")}
          </Button>
        )}
        <Button
          type="submit"
          disabled={mutation.isPending || (!https && draft.enabled)}
        >
          {mutation.isPending && <Spinner data-icon="inline-start" />}
          {t("common.save")}
        </Button>
      </div>
    </form>
  )
}
