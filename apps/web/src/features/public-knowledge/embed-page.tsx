import { useState } from "react"
import { publicKnowledgeFrameSandbox } from "@linksense/shared"
import { useQuery } from "@tanstack/react-query"
import { useTranslation } from "react-i18next"
import { Link, useParams } from "react-router-dom"
import { ArrowLeftIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import {
  Field,
  FieldGroup,
  FieldLabel,
  FieldDescription,
} from "@/components/ui/field"
import {
  Select,
  SelectTrigger,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectValue,
} from "@/components/ui/select"
import { LoadingState, ErrorState } from "@/components/feedback/page-state"
import { PageLayout } from "@/components/shell/page-layout"
import { buildApiUrl } from "@/api/client"
import { getErrorMessage } from "@/api/error-message"
import { normalizeLanguage } from "@/i18n"
import { getPublicKnowledgeManagement, publicKnowledgeKeys } from "./api"

export function PublicKnowledgeEmbedPage() {
  const { applicationId = "" } = useParams(),
    { t, i18n } = useTranslation()
  const [copied, setCopied] = useState(false),
    [selectedOrigin, setSelectedOrigin] = useState<string | null>(null)
  const management = useQuery({
    queryKey: publicKnowledgeKeys.management(applicationId),
    queryFn: ({ signal }) =>
      getPublicKnowledgeManagement(applicationId, signal),
    enabled: Boolean(applicationId),
  })
  if (management.isPending) return <LoadingState />
  if (management.error || !management.data)
    return (
      <ErrorState
        message={getErrorMessage(management.error, t)}
        onRetry={() => void management.refetch()}
      />
    )
  const data = management.data
  const embedOrigin =
    selectedOrigin && data.settings.allowed_origins.includes(selectedOrigin)
      ? selectedOrigin
      : (data.settings.allowed_origins[0] ?? "")
  const originItems = data.settings.allowed_origins.map((origin) => ({
    value: origin,
    label: origin,
  }))
  const url = new URL(
    buildApiUrl(`/public-knowledge/frame/${data.public_id}`),
    window.location.origin
  )
  url.searchParams.set("parent_origin", embedOrigin)
  url.searchParams.set(
    "locale",
    normalizeLanguage(i18n.resolvedLanguage) ?? "zh-CN"
  )
  const embed = `<iframe src="${url.toString().replaceAll("&", "&amp;")}" title="${data.settings.name.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;")}" width="100%" height="640" sandbox="${publicKnowledgeFrameSandbox}" referrerpolicy="no-referrer"></iframe>`
  return (
    <PageLayout
      title={data.settings.name}
      description={t("publicKnowledge.embedAction")}
      actions={
        <Button
          variant="ghost"
          size="sm"
          render={
            <Link to="/capabilities?section=application&scope=personal" />
          }
        >
          <ArrowLeftIcon data-icon="inline-start" />
          {t("applications.usage.backToApplications")}
        </Button>
      }
    >
      <FieldGroup className="max-w-4xl">
        <Field>
          <FieldLabel htmlFor="public-knowledge-embed-origin">
            {t("publicKnowledge.embedWebsite")}
          </FieldLabel>
          <Select
            items={originItems}
            value={embedOrigin}
            onValueChange={(value) => {
              setSelectedOrigin(value)
              setCopied(false)
            }}
          >
            <SelectTrigger
              id="public-knowledge-embed-origin"
              aria-label={t("publicKnowledge.embedWebsite")}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                {originItems.map((item) => (
                  <SelectItem key={item.value} value={item.value}>
                    {item.label}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        </Field>
        <Field>
          <FieldLabel htmlFor="public-knowledge-embed">
            {t("publicKnowledge.embed")}
          </FieldLabel>
          <FieldDescription>{t("publicKnowledge.embedHelp")}</FieldDescription>
          <Textarea
            id="public-knowledge-embed"
            readOnly
            value={embed}
            className="min-h-28"
          />
          <Button
            variant="outline"
            onClick={() => {
              void navigator.clipboard
                .writeText(embed)
                .then(() => setCopied(true))
                .catch(() => setCopied(false))
            }}
          >
            {t(copied ? "publicKnowledge.copied" : "publicKnowledge.copy")}
          </Button>
        </Field>
      </FieldGroup>
    </PageLayout>
  )
}
