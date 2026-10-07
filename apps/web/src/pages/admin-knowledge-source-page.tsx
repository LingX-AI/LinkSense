import { useState } from "react"
import type { ReactNode } from "react"
import type { SharePointConnectionSettings } from "@linksense/shared"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { KeyRoundIcon, LoaderCircleIcon } from "lucide-react"
import { useTranslation } from "react-i18next"

import { getErrorMessage } from "@/api/error-message"
import { LoadingState, ErrorState } from "@/components/feedback/page-state"
import { NotificationToast } from "@/components/feedback/notification-toast"
import { StatusBanner } from "@/components/feedback/status-banner"
import {
  FieldShell,
  SettingsFieldGroup,
  SettingsFieldRow,
} from "@/components/forms/form-field"
import { PasswordInput } from "@/components/forms/password-input"
import { PageLayout } from "@/components/shell/page-layout"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { SettingsCard } from "@/components/settings/settings-card"
import { SettingsSectionHeader } from "@/components/settings/settings-section-header"
import { FieldGroup } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import {
  getSharePointSettings,
  knowledgeSourceQueryKeys,
  updateSharePointSettings,
} from "@/features/admin/knowledge-source-api"
import { AdminKnowledgeTabs } from "@/features/admin/admin-knowledge-tabs"

export function AdminKnowledgeSourcePage() {
  const { t } = useTranslation()
  const query = useQuery({
    queryKey: knowledgeSourceQueryKeys.sharePointSettings,
    queryFn: ({ signal }) => getSharePointSettings(signal),
  })

  if (query.isLoading) {
    return (
      <AdminKnowledgeSourceLayout>
        <LoadingState />
      </AdminKnowledgeSourceLayout>
    )
  }
  if (query.isError || !query.data) {
    return (
      <AdminKnowledgeSourceLayout>
        <ErrorState
          message={getErrorMessage(query.error, t)}
          onRetry={() => void query.refetch()}
        />
      </AdminKnowledgeSourceLayout>
    )
  }

  return (
    <AdminKnowledgeSourceLayout>
      <SharePointSettingsForm settings={query.data} />
    </AdminKnowledgeSourceLayout>
  )
}

function AdminKnowledgeSourceLayout({ children }: { children: ReactNode }) {
  const { t } = useTranslation()
  return (
    <PageLayout
      title={t("adminKnowledge.title")}
      description={t("adminKnowledge.description")}
    >
      <AdminKnowledgeTabs value="sources">{children}</AdminKnowledgeTabs>
    </PageLayout>
  )
}

function SharePointSettingsForm({
  settings,
}: {
  settings: SharePointConnectionSettings
}) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [revision, setRevision] = useState(settings.revision)
  const [secretConfigured, setSecretConfigured] = useState(
    settings.client_secret_configured
  )
  const [enabled, setEnabled] = useState(settings.enabled)
  const [tenantId, setTenantId] = useState(settings.tenant_id ?? "")
  const [clientId, setClientId] = useState(settings.client_id ?? "")
  const [tenantDomain, setTenantDomain] = useState(settings.tenant_domain ?? "")
  const [clientSecret, setClientSecret] = useState("")
  const [message, setMessage] = useState<string>()
  const [error, setError] = useState<string>()
  const normalizedClientSecret = clientSecret.trim()
  const identityChanged =
    (tenantId.trim() || null) !== settings.tenant_id ||
    (clientId.trim() || null) !== settings.client_id
  const secretRequired = enabled && (!secretConfigured || identityChanged)
  const mutation = useMutation({
    mutationFn: () =>
      updateSharePointSettings({
        expected_revision: revision,
        enabled,
        tenant_id: tenantId.trim() || null,
        client_id: clientId.trim() || null,
        tenant_domain: tenantDomain.trim().toLocaleLowerCase() || null,
        ...(normalizedClientSecret
          ? { client_secret: normalizedClientSecret }
          : {}),
      }),
    onMutate: () => {
      setMessage(undefined)
      setError(undefined)
    },
    onSuccess: (result) => {
      setRevision(result.settings.revision)
      setSecretConfigured(result.settings.client_secret_configured)
      setClientSecret("")
      setMessage(t("knowledgeSources.saved"))
      queryClient.setQueryData(
        knowledgeSourceQueryKeys.sharePointSettings,
        result.settings
      )
    },
    onError: (value) => setError(getErrorMessage(value, t)),
  })
  const canSave =
    !enabled ||
    (tenantId.trim() &&
      clientId.trim() &&
      tenantDomain.trim() &&
      (normalizedClientSecret || secretConfigured))

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <NotificationToast id="sharepoint-settings-saved" message={message} />
      {error && <StatusBanner variant="error">{error}</StatusBanner>}
      <SettingsCard
        header={
          <SettingsSectionHeader
            id="sharepoint-settings-title"
            title={t("knowledgeSources.sharepoint.title")}
            description={t("knowledgeSources.sharepoint.description")}
            status={
              <Badge variant={enabled ? "default" : "secondary"}>
                {t(enabled ? "common.enabled" : "common.disabled")}
              </Badge>
            }
          />
        }
      >
        <SettingsFieldGroup>
          <SettingsFieldRow
            id="sharepoint-source-enabled"
            label={t("knowledgeSources.sharepoint.enable")}
            hint={t("knowledgeSources.sharepoint.enableDescription")}
            controlWidth="compact"
          >
            <Switch
              id="sharepoint-source-enabled"
              checked={enabled}
              onCheckedChange={setEnabled}
            />
          </SettingsFieldRow>
          <FieldShell
            id="sharepoint-tenant-id"
            label={t("knowledgeSources.sharepoint.tenantId")}
            required={enabled}
            layout="settings"
            controlWidth="medium"
          >
            <Input
              id="sharepoint-tenant-id"
              aria-required={enabled || undefined}
              value={tenantId}
              disabled={!enabled}
              onChange={(event) => setTenantId(event.currentTarget.value)}
            />
          </FieldShell>
          <FieldShell
            id="sharepoint-client-id"
            label={t("knowledgeSources.sharepoint.clientId")}
            required={enabled}
            layout="settings"
            controlWidth="medium"
          >
            <Input
              id="sharepoint-client-id"
              aria-required={enabled || undefined}
              value={clientId}
              disabled={!enabled}
              onChange={(event) => setClientId(event.currentTarget.value)}
            />
          </FieldShell>
          <FieldShell
            id="sharepoint-tenant-domain"
            label={t("knowledgeSources.sharepoint.tenantDomain")}
            required={enabled}
            hint={t("knowledgeSources.sharepoint.tenantDomainDescription")}
            layout="settings"
            controlWidth="wide"
          >
            <Input
              id="sharepoint-tenant-domain"
              aria-required={enabled || undefined}
              value={tenantDomain}
              disabled={!enabled}
              placeholder="contoso.sharepoint.com"
              onChange={(event) => setTenantDomain(event.currentTarget.value)}
            />
          </FieldShell>
          <FieldShell
            id="sharepoint-client-secret"
            label={t("knowledgeSources.sharepoint.clientSecret")}
            required={secretRequired}
            hint={t("knowledgeSources.sharepoint.secretDescription")}
            layout="settings"
            controlWidth="wide"
          >
            <PasswordInput
              id="sharepoint-client-secret"
              aria-required={secretRequired || undefined}
              fieldLabel={t("knowledgeSources.sharepoint.clientSecret")}
              value={clientSecret}
              disabled={!enabled}
              autoComplete="new-password"
              placeholder={
                secretConfigured
                  ? t("knowledgeSources.secretConfigured")
                  : undefined
              }
              onChange={(event) => setClientSecret(event.currentTarget.value)}
            />
          </FieldShell>
        </SettingsFieldGroup>
        <FieldGroup>
          <StatusBanner
            variant="info"
            title={t("knowledgeSources.sharepoint.permissionTitle")}
          >
            {t("knowledgeSources.sharepoint.permissionDescription")}
          </StatusBanner>
        </FieldGroup>
        <div className="flex justify-end">
          <Button
            type="button"
            disabled={!canSave || mutation.isPending}
            onClick={() => mutation.mutate()}
          >
            {mutation.isPending ? (
              <LoaderCircleIcon data-icon="inline-start" aria-hidden="true" />
            ) : (
              <KeyRoundIcon data-icon="inline-start" aria-hidden="true" />
            )}
            {t("common.save")}
          </Button>
        </div>
      </SettingsCard>
    </div>
  )
}
