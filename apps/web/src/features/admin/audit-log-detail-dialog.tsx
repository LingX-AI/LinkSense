import { Badge } from "@/components/ui/badge"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Separator } from "@/components/ui/separator"
import type {
  AuditConversationMetadata,
  AuditRecord,
  RetainedArtifactSummary,
  SupportedLanguage,
} from "@/api/contracts"
import { formatDateTime, formatFileSize } from "@/i18n/date"
import { formatPublicTechnicalIdentifier } from "@/lib/public-copy"
import { translateAuditValue } from "@/features/admin/audit-i18n"
import type { ReactNode } from "react"
import { useTranslation } from "react-i18next"

type AuditLogDetailDialogProps = {
  language: SupportedLanguage
  onOpenChange: (open: boolean) => void
  record: AuditRecord | null
}

type DetailItem = {
  label: string
  value: string
  technical?: boolean
}

export function AuditLogDetailDialog({
  language,
  onOpenChange,
  record,
}: AuditLogDetailDialogProps) {
  const { t } = useTranslation()
  if (!record) return null

  const emptyValue = t("common.notAvailable")
  const metadata = Object.entries(record.metadata ?? {}).sort(
    ([left], [right]) => left.localeCompare(right)
  )
  const eventItems: DetailItem[] = [
    { label: t("admin.auditId"), value: record.id, technical: true },
    {
      label: t("admin.action"),
      value: translateAuditValue(t, "actions", record.action),
    },
    {
      label: t("admin.actionCode"),
      value: formatPublicTechnicalIdentifier(record.action),
      technical: true,
    },
    ...(record.result
      ? [
          {
            label: t("admin.resultCode"),
            value: record.result,
            technical: true,
          },
        ]
      : []),
    {
      label: t("admin.errorCode"),
      value: record.error_code
        ? formatPublicTechnicalIdentifier(record.error_code)
        : emptyValue,
      technical: Boolean(record.error_code),
    },
    {
      label: t("common.createdAt"),
      value: formatDateTime(record.created_at, language),
    },
  ]
  const subjectItems: DetailItem[] = [
    {
      label: t("admin.actor"),
      value: record.actor_name ?? t("common.system"),
    },
    {
      label: t("admin.exportActorId"),
      value: record.actor_id ?? emptyValue,
      technical: Boolean(record.actor_id),
    },
    {
      label: t("admin.exportTargetType"),
      value: record.target_type
        ? translateAuditValue(t, "targetTypes", record.target_type)
        : emptyValue,
    },
    {
      label: t("admin.targetTypeCode"),
      value: record.target_type
        ? formatPublicTechnicalIdentifier(record.target_type)
        : emptyValue,
      technical: Boolean(record.target_type),
    },
    {
      label: t("admin.exportTargetId"),
      value: record.target_id ?? emptyValue,
      technical: Boolean(record.target_id),
    },
  ]
  const requestItems: DetailItem[] = [
    {
      label: t("admin.sourceIp"),
      value: record.source_ip ?? t("common.system"),
      technical: Boolean(record.source_ip),
    },
    {
      label: t("admin.userAgent"),
      value: record.user_agent ?? emptyValue,
      technical: Boolean(record.user_agent),
    },
  ]

  return (
    <DetailDialogShell
      description={t("admin.auditDetailsDescription")}
      onOpenChange={onOpenChange}
      status={
        record.result
          ? translateAuditValue(t, "results", record.result)
          : emptyValue
      }
      title={t("admin.auditDetailsTitle")}
    >
      <AuditDetailSection
        title={t("admin.auditEventInformation")}
        items={eventItems}
      />
      <Separator />
      <AuditDetailSection
        title={t("admin.auditSubjectInformation")}
        items={subjectItems}
      />
      <Separator />
      <AuditDetailSection
        title={t("admin.auditRequestInformation")}
        items={requestItems}
      />
      <Separator />

      <section className="flex flex-col gap-3">
        <h3 className="text-sm font-medium">{t("admin.auditMetadataTitle")}</h3>
        {metadata.length > 0 ? (
          <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
            {metadata.map(([key, value]) => (
              <div key={key} className="min-w-0">
                <dt className="text-xs break-all text-muted-foreground">
                  {formatPublicTechnicalIdentifier(key)}
                </dt>
                <dd className="mt-1 font-mono text-xs break-all whitespace-pre-wrap">
                  {formatMetadataValue(value, emptyValue)}
                </dd>
              </div>
            ))}
          </dl>
        ) : (
          <p className="text-sm text-muted-foreground">
            {t("admin.auditMetadataEmpty")}
          </p>
        )}
      </section>
    </DetailDialogShell>
  )
}

export function AuditConversationDetailDialog({
  language,
  onOpenChange,
  record,
}: {
  language: SupportedLanguage
  onOpenChange: (open: boolean) => void
  record: AuditConversationMetadata | null
}) {
  const { t } = useTranslation()
  if (!record) return null

  const emptyValue = t("common.notAvailable")
  const identityItems: DetailItem[] = [
    {
      label: t("admin.conversation"),
      value: record.conversation_id,
      technical: true,
    },
    { label: t("admin.ownerName"), value: record.owner_name ?? emptyValue },
    {
      label: t("admin.ownerId"),
      value: record.owner_id,
      technical: true,
    },
    { label: t("admin.ownerEmail"), value: record.owner_email ?? emptyValue },
    {
      label: t("admin.archiveStatus"),
      value: t(
        record.archive_status === "archived"
          ? "admin.archivedConversation"
          : "admin.activeConversation"
      ),
    },
  ]
  const executionItems: DetailItem[] = [
    {
      label: t("common.status"),
      value: t(`statuses.${record.execution_status}`),
    },
    {
      label: t("admin.executionDuration"),
      value: formatDuration(record.execution_duration_ms, language),
    },
    {
      label: t("admin.runnerStatus"),
      value: t(`admin.runnerStatuses.${record.runner_status}`, {
        defaultValue: record.runner_status,
      }),
    },
    {
      label: t("admin.executionErrorType"),
      value: record.error_type
        ? t(`admin.errorTypes.${record.error_type}`, {
            defaultValue: formatPublicTechnicalIdentifier(record.error_type),
          })
        : emptyValue,
      technical: Boolean(record.error_type),
    },
    {
      label: t("admin.errorCode"),
      value: record.error_code
        ? formatPublicTechnicalIdentifier(record.error_code)
        : emptyValue,
      technical: Boolean(record.error_code),
    },
    {
      label: t("common.createdAt"),
      value: formatDateTime(record.created_at, language),
    },
    {
      label: t("common.updatedAt"),
      value: formatDateTime(record.updated_at, language),
    },
    {
      label: t("admin.lastRun"),
      value: formatDateTime(record.last_run_at, language),
    },
  ]
  const capabilityItems: DetailItem[] = [
    {
      label: t("capability.plugin"),
      value: record.plugin_names.join(", ") || emptyValue,
    },
    {
      label: t("capability.skill"),
      value: record.skill_names.join(", ") || emptyValue,
    },
  ]
  const fileItems: DetailItem[] = [
    {
      label: t("admin.attachmentCount"),
      value: String(record.attachment_count),
    },
    {
      label: t("admin.attachmentSize"),
      value: formatFileSize(record.attachment_size_bytes, language),
    },
    {
      label: t("admin.artifactCount"),
      value: String(record.artifact_count),
    },
    {
      label: t("admin.artifactSize"),
      value: formatFileSize(record.artifact_size_bytes, language),
    },
  ]

  return (
    <DetailDialogShell
      description={t("admin.auditConversationDetailsDescription")}
      onOpenChange={onOpenChange}
      status={t(`statuses.${record.execution_status}`)}
      title={t("admin.auditConversationDetailsTitle")}
    >
      <AuditDetailSection
        title={t("admin.auditSubjectInformation")}
        items={identityItems}
      />
      <Separator />
      <AuditDetailSection
        title={t("admin.auditExecutionInformation")}
        items={executionItems}
      />
      <Separator />
      <AuditDetailSection
        title={t("admin.capabilitiesUsed")}
        items={capabilityItems}
      />
      <Separator />
      <AuditDetailSection title={t("admin.files")} items={fileItems} />
    </DetailDialogShell>
  )
}

export function RetainedArtifactDetailDialog({
  language,
  onOpenChange,
  record,
}: {
  language: SupportedLanguage
  onOpenChange: (open: boolean) => void
  record: RetainedArtifactSummary | null
}) {
  const { t } = useTranslation()
  if (!record) return null

  const emptyValue = t("common.notAvailable")
  const identityItems: DetailItem[] = [
    {
      label: t("admin.conversation"),
      value: record.conversation_id,
      technical: true,
    },
    { label: t("admin.ownerName"), value: record.owner_name ?? emptyValue },
    {
      label: t("admin.ownerId"),
      value: record.owner_id,
      technical: true,
    },
    { label: t("admin.ownerEmail"), value: record.owner_email ?? emptyValue },
  ]
  const artifactItems: DetailItem[] = [
    {
      label: t("admin.retainedArtifactCount"),
      value: String(record.artifact_count),
    },
    {
      label: t("admin.totalSize"),
      value: formatFileSize(record.total_size_bytes, language),
    },
    {
      label: t("admin.checksum"),
      value: t(record.checksum_present ? "common.yes" : "common.no"),
    },
    {
      label: t("admin.firstArtifactCreatedAt"),
      value: record.first_artifact_created_at
        ? formatDateTime(record.first_artifact_created_at, language)
        : emptyValue,
    },
    {
      label: t("admin.lastArtifactCreatedAt"),
      value: record.last_artifact_created_at
        ? formatDateTime(record.last_artifact_created_at, language)
        : emptyValue,
    },
    {
      label: t("admin.deletedAt"),
      value: formatDateTime(record.conversation_deleted_at, language),
    },
  ]

  return (
    <DetailDialogShell
      description={t("admin.retainedArtifactDetailsDescription")}
      onOpenChange={onOpenChange}
      title={t("admin.retainedArtifactDetailsTitle")}
    >
      <AuditDetailSection
        title={t("admin.auditSubjectInformation")}
        items={identityItems}
      />
      <Separator />
      <AuditDetailSection
        title={t("admin.auditArtifactInformation")}
        items={artifactItems}
      />
    </DetailDialogShell>
  )
}

function DetailDialogShell({
  children,
  description,
  onOpenChange,
  status,
  title,
}: {
  children: ReactNode
  description: string
  onOpenChange: (open: boolean) => void
  status?: string
  title: string
}) {
  const { t } = useTranslation()
  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent
        closeLabel={t("common.close")}
        className="max-h-[min(90vh,760px)] grid-rows-[auto_minmax(0,1fr)] gap-0 overflow-hidden p-0 sm:max-w-2xl"
      >
        <DialogHeader
          data-slot="audit-detail-dialog-header"
          className="shrink-0 px-6 pt-6 pr-14 pb-5"
        >
          <div className="flex flex-wrap items-center gap-2">
            <DialogTitle>{title}</DialogTitle>
            {status && <Badge variant="secondary">{status}</Badge>}
          </div>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <div
          data-slot="audit-detail-dialog-body"
          className="flex min-h-0 flex-col gap-6 overflow-y-auto px-6 pb-6"
        >
          {children}
        </div>
      </DialogContent>
    </Dialog>
  )
}

function AuditDetailSection({
  items,
  title,
}: {
  items: DetailItem[]
  title: string
}) {
  return (
    <section className="flex flex-col gap-3">
      <h3 className="text-sm font-medium">{title}</h3>
      <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
        {items.map((item) => (
          <div key={item.label} className="min-w-0">
            <dt className="text-xs text-muted-foreground">{item.label}</dt>
            <dd
              className={
                item.technical
                  ? "mt-1 font-mono text-xs break-all whitespace-pre-wrap"
                  : "mt-1 text-sm break-words whitespace-pre-wrap"
              }
            >
              {item.value}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  )
}

function formatMetadataValue(value: unknown, emptyValue: string): string {
  if (value === null || value === undefined || value === "") return emptyValue
  if (typeof value === "string") {
    return formatPublicTechnicalIdentifier(value)
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value)
  }
  return emptyValue
}

function formatDuration(value: number, language: SupportedLanguage): string {
  return new Intl.NumberFormat(language, {
    style: "unit",
    unit: "second",
    unitDisplay: "short",
    maximumFractionDigits: 1,
  }).format(value / 1_000)
}
