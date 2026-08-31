import { useState } from "react"
import type { ReactNode } from "react"
import type { SharePointConnectionSettings } from "@linksense/shared"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { CloudCogIcon, KeyRoundIcon, LoaderCircleIcon } from "lucide-react"
import { useTranslation } from "react-i18next"

import { getErrorMessage } from "@/api/error-message"
import { LoadingState, ErrorState } from "@/components/feedback/page-state"
import { NotificationToast } from "@/components/feedback/notification-toast"
import { StatusBanner } from "@/components/feedback/status-banner"
import { PasswordInput } from "@/components/forms/password-input"
import { PageLayout } from "@/components/shell/page-layout"
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
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field"
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
    <div className="flex max-w-4xl flex-col gap-4">
      <NotificationToast id="sharepoint-settings-saved" message={message} />
      {error && <StatusBanner variant="error">{error}</StatusBanner>}
      <Card>
        <CardHeader className="border-b">
          <CardTitle className="flex items-center gap-2">
            <CloudCogIcon aria-hidden="true" />
            {t("knowledgeSources.sharepoint.title")}
          </CardTitle>
          <CardDescription>
            {t("knowledgeSources.sharepoint.description")}
          </CardDescription>
          <CardAction>
            <Badge variant={enabled ? "default" : "secondary"}>
              {t(enabled ? "common.enabled" : "common.disabled")}
            </Badge>
          </CardAction>
        </CardHeader>
        <CardContent>
          <FieldGroup>
            <Field orientation="horizontal">
              <div className="flex-1">
                <FieldLabel htmlFor="sharepoint-source-enabled">
                  {t("knowledgeSources.sharepoint.enable")}
                </FieldLabel>
                <FieldDescription>
                  {t("knowledgeSources.sharepoint.enableDescription")}
                </FieldDescription>
              </div>
              <Switch
                id="sharepoint-source-enabled"
                checked={enabled}
                onCheckedChange={setEnabled}
              />
            </Field>
            <div className="grid gap-5 md:grid-cols-2">
              <Field>
                <FieldLabel htmlFor="sharepoint-tenant-id">
                  {t("knowledgeSources.sharepoint.tenantId")}
                </FieldLabel>
                <Input
                  id="sharepoint-tenant-id"
                  value={tenantId}
                  disabled={!enabled}
                  onChange={(event) => setTenantId(event.currentTarget.value)}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="sharepoint-client-id">
                  {t("knowledgeSources.sharepoint.clientId")}
                </FieldLabel>
                <Input
                  id="sharepoint-client-id"
                  value={clientId}
                  disabled={!enabled}
                  onChange={(event) => setClientId(event.currentTarget.value)}
                />
              </Field>
            </div>
            <Field>
              <FieldLabel htmlFor="sharepoint-tenant-domain">
                {t("knowledgeSources.sharepoint.tenantDomain")}
              </FieldLabel>
              <Input
                id="sharepoint-tenant-domain"
                value={tenantDomain}
                disabled={!enabled}
                placeholder="contoso.sharepoint.com"
                onChange={(event) => setTenantDomain(event.currentTarget.value)}
              />
              <FieldDescription>
                {t("knowledgeSources.sharepoint.tenantDomainDescription")}
              </FieldDescription>
            </Field>
            <Field>
              <FieldLabel htmlFor="sharepoint-client-secret">
                {t("knowledgeSources.sharepoint.clientSecret")}
              </FieldLabel>
              <PasswordInput
                id="sharepoint-client-secret"
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
              <FieldDescription>
                {t("knowledgeSources.sharepoint.secretDescription")}
              </FieldDescription>
            </Field>
            <StatusBanner
              variant="info"
              title={t("knowledgeSources.sharepoint.permissionTitle")}
            >
              {t("knowledgeSources.sharepoint.permissionDescription")}
            </StatusBanner>
          </FieldGroup>
        </CardContent>
        <CardFooter className="justify-end border-t">
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
        </CardFooter>
      </Card>
    </div>
  )
}
