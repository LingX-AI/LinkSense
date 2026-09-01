import { useDeferredValue, useMemo, useState, type ReactNode } from "react"
import { coreMcpServerKey } from "@linksense/shared"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useLocation, useNavigate } from "react-router-dom"
import {
  BanIcon,
  CheckIcon,
  CheckCircle2Icon,
  ChevronDownIcon,
  Clock3Icon,
  DownloadIcon,
  EyeIcon,
  EyeOffIcon,
  FileTextIcon,
  MoreHorizontalIcon,
  PackagePlusIcon,
  PowerIcon,
  RefreshCwIcon,
  SearchIcon,
  SendIcon,
  ServerCogIcon,
  Settings2Icon,
  ShieldCheckIcon,
  StoreIcon,
  Trash2Icon,
  Undo2Icon,
  UploadIcon,
} from "lucide-react"
import { useTranslation } from "react-i18next"
import { z } from "zod"

import { apiRequest, apiUploadRequest } from "@/api/client"
import {
  capabilityImportPreviewSchema,
  capabilitySummarySchema,
  marketplaceCatalogItemSchema,
  marketplaceListingSchema,
  marketplacePublicationSchema,
  marketplaceReviewDetailSchema,
  marketplaceReleaseSchema,
  mcpServerSchema,
  paginatedSchema,
  type CapabilityImportPreview,
  type CapabilitySummary,
  type MarketplaceCatalogItem,
  type MarketplaceListing,
  type MarketplacePublication,
  type McpServer,
} from "@/api/contracts"
import { getErrorMessage } from "@/api/error-message"
import { useProductName } from "@/app/product-branding"
import {
  CapabilityLibraryItem,
  CapabilityLogo,
  McpLogo,
} from "@/components/capabilities/capability-library-item"
import { CapabilityRiskSummary } from "@/components/capabilities/capability-risk-summary"
import { SkillContentPreview } from "@/components/capabilities/skill-content-preview"
import { ConfirmDialog } from "@/components/feedback/confirm-dialog"
import {
  EmptyState,
  ErrorState,
  LoadingState,
} from "@/components/feedback/page-state"
import { notify } from "@/components/feedback/notification"
import { StatusBanner } from "@/components/feedback/status-banner"
import { FieldShell } from "@/components/forms/form-field"
import { PageLayout } from "@/components/shell/page-layout"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@/components/ui/input-group"
import { Label } from "@/components/ui/label"
import {
  Progress,
  ProgressLabel,
  ProgressValue,
} from "@/components/ui/progress"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Separator } from "@/components/ui/separator"
import { Spinner } from "@/components/ui/spinner"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Textarea } from "@/components/ui/textarea"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { normalizeLanguage } from "@/i18n"
import { formatDateTime } from "@/i18n/date"
import { cn } from "@/lib/utils"
import { ApplicationCatalogPanel } from "@/features/applications/application-catalog-panel"
import {
  capabilityPresentation,
  coreMcpPresentation,
} from "@/features/capabilities/built-in-presentation"
import {
  capabilityCenterLocationFromSearch,
  capabilityCenterPath,
  capabilityCenterSettingsState,
} from "@/features/capabilities/capability-center-navigation"
import { ClawHubSkillRepositoryPanel } from "@/features/capabilities/clawhub-skill-repository-panel"

type CapabilityType = "plugin" | "skill"
type ImportSource = "local" | "manual_skill"
type CapabilityImportProgress =
  { phase: "uploading"; percentage: number } | { phase: "parsing" }
type UserCapabilityView = "store" | "publishing"
type MarketplaceCatalogSection = "plugin" | "skill" | "mcp" | "application"
type MarketplaceCatalogScope = "public" | "personal" | "clawhub"
type AdminMarketplaceTab = "reviews" | "listings"
type CapabilityUninstallTarget = {
  id: string
  name: string
  sourceType: "marketplace" | "clawhub"
  category: Exclude<MarketplaceCatalogSection, "application">
}

const capabilityPageSchema = paginatedSchema(capabilitySummarySchema)
const marketplaceCatalogPageSchema = paginatedSchema(
  marketplaceCatalogItemSchema
)
const marketplacePublicationPageSchema = paginatedSchema(
  marketplacePublicationSchema
)
const mcpServerListSchema = z.strictObject({
  items: z.array(mcpServerSchema),
})

const listingStatusKeys = {
  draft: "marketplace.status.draft",
  published: "marketplace.status.published",
  unlisted: "marketplace.status.unlisted",
  suspended: "marketplace.status.suspended",
} as const

const releaseStatusKeys = {
  pending: "marketplace.status.pending",
  approved: "marketplace.status.approved",
  rejected: "marketplace.status.rejected",
  withdrawn: "marketplace.status.withdrawn",
} as const

const marketplaceStatusIcons = {
  draft: FileTextIcon,
  published: StoreIcon,
  unlisted: EyeOffIcon,
  suspended: BanIcon,
  pending: Clock3Icon,
  approved: CheckCircle2Icon,
  rejected: BanIcon,
  withdrawn: Undo2Icon,
} as const

const marketplaceCatalogSectionKeys = {
  plugin: "marketplace.catalogTabs.plugin",
  skill: "marketplace.catalogTabs.skill",
  mcp: "marketplace.catalogTabs.mcp",
  application: "marketplace.catalogTabs.application",
} as const

function isRepositoryCapability(capability: CapabilitySummary) {
  return (
    capability.source_type === "marketplace" ||
    capability.source_type === "clawhub"
  )
}
const marketplaceCatalogSections = [
  "plugin",
  "skill",
  "mcp",
  "application",
] as const satisfies readonly MarketplaceCatalogSection[]

function matchesMarketplaceCatalogSection(
  item: MarketplaceCatalogItem,
  section: MarketplaceCatalogSection
) {
  if (section === "application") return false
  if (section === "skill") return item.listing.type === "skill"
  if (item.listing.type !== "plugin") return false
  return section === "plugin"
    ? true
    : item.release.risk_summary.contains_mcp_server === true
}

function matchesCapabilityCatalogSection(
  capability: CapabilitySummary,
  section: Exclude<MarketplaceCatalogSection, "application">
) {
  if (section === "skill") return capability.type === "skill"
  if (capability.type !== "plugin") return false
  return section === "plugin"
    ? true
    : capability.risk_summary?.contains_mcp_server === true
}

function capabilityIdentitySection(
  capability: Pick<CapabilitySummary, "type">
): CapabilityType {
  return capability.type
}

function marketplaceItemIdentitySection(
  item: MarketplaceCatalogItem
): CapabilityType {
  return item.listing.type
}

function addCatalogItemKey(
  section: Exclude<MarketplaceCatalogSection, "application" | "mcp">
) {
  return section === "skill" ? "capability.addSkill" : "capability.addPlugin"
}

function updatePersonalItemKey(
  section: Exclude<MarketplaceCatalogSection, "application">
) {
  if (section === "mcp") return "marketplace.updatePersonalMcp"
  return section === "skill"
    ? "marketplace.updatePersonalSkill"
    : "marketplace.updatePersonalPlugin"
}

function marketplaceInstalledKey(
  section: Exclude<MarketplaceCatalogSection, "application">
) {
  if (section === "mcp") return "marketplace.installedMcp"
  return section === "skill"
    ? "marketplace.installedSkill"
    : "marketplace.installedPlugin"
}

function marketplaceInstallationUpdatedKey(
  section: Exclude<MarketplaceCatalogSection, "application">
) {
  if (section === "mcp") return "marketplace.installationUpdatedMcp"
  return section === "skill"
    ? "marketplace.installationUpdatedSkill"
    : "marketplace.installationUpdatedPlugin"
}

function marketplaceUninstallTitleKey(
  section: Exclude<MarketplaceCatalogSection, "application">
) {
  if (section === "mcp") return "marketplace.uninstallMcpTitle"
  return section === "skill"
    ? "marketplace.uninstallSkillTitle"
    : "marketplace.uninstallPluginTitle"
}

function marketplaceUninstalledKey(
  section: Exclude<MarketplaceCatalogSection, "application">
) {
  if (section === "mcp") return "marketplace.uninstalledMcp"
  return section === "skill"
    ? "marketplace.uninstalledSkill"
    : "marketplace.uninstalledPlugin"
}

function personalDeleteTitleKey(
  section: Exclude<MarketplaceCatalogSection, "application">
) {
  if (section === "mcp") return "capability.deleteMcpTitle"
  return section === "skill"
    ? "capability.deleteSkillTitle"
    : "capability.deletePluginTitle"
}

function capabilityActionToastId(action: string, id: string) {
  return `capability-${action}-${id}`
}

function capabilityImportActionToastId(preview: CapabilityImportPreview) {
  return capabilityActionToastId("import", preview.preview_token)
}

function capabilityImportStatusKey(preview: CapabilityImportPreview) {
  if (preview.operation === "update") {
    return preview.type === "skill"
      ? "capability.updatingSkillStatus"
      : "capability.updatingPluginStatus"
  }
  return preview.type === "skill"
    ? "capability.importingSkillStatus"
    : "capability.importingPluginStatus"
}

function capabilityDeleteStatusKey(type: CapabilityType) {
  return type === "skill"
    ? "capability.deletingSkillStatus"
    : "capability.deletingPluginStatus"
}

function marketplaceInstallStatusKey(
  section: Exclude<MarketplaceCatalogSection, "application">
) {
  if (section === "mcp") return "marketplace.installingMcpStatus"
  return section === "skill"
    ? "marketplace.installingSkillStatus"
    : "marketplace.installingPluginStatus"
}

function marketplaceUpdateStatusKey(
  section: Exclude<MarketplaceCatalogSection, "application">
) {
  if (section === "mcp") return "marketplace.updatingMcpStatus"
  return section === "skill"
    ? "marketplace.updatingSkillStatus"
    : "marketplace.updatingPluginStatus"
}

function marketplaceUninstallStatusKey(
  section: Exclude<MarketplaceCatalogSection, "application">
) {
  if (section === "mcp") return "marketplace.uninstallingMcpStatus"
  return section === "skill"
    ? "marketplace.uninstallingSkillStatus"
    : "marketplace.uninstallingPluginStatus"
}

function importDialogDescriptionKey(type: CapabilityType) {
  return type === "skill"
    ? "marketplace.personalSkillImportDescription"
    : "marketplace.personalPluginImportDescription"
}

function zipPackageLabelKey(type: CapabilityType) {
  return type === "skill"
    ? "marketplace.zipSkillPackage"
    : "marketplace.zipPluginPackage"
}

function zipPackageHintKey(type: CapabilityType) {
  return type === "skill"
    ? "marketplace.zipSkillPackageHint"
    : "marketplace.zipPluginPackageHint"
}

function marketplaceCatalogInstallState(
  item: MarketplaceCatalogItem,
  capabilities: CapabilitySummary[]
):
  | { kind: "marketplace"; capabilityId: string }
  | { kind: "owned-source"; capability: CapabilitySummary }
  | { kind: "not-installed" } {
  if (item.installed_capability_id) {
    return {
      kind: "marketplace",
      capabilityId: item.installed_capability_id,
    }
  }
  const sourceCapability = capabilities.find(
    (capability) =>
      capability.id === item.release.source_capability_id &&
      !isRepositoryCapability(capability)
  )
  return sourceCapability
    ? { kind: "owned-source", capability: sourceCapability }
    : { kind: "not-installed" }
}

function MarketplaceStatusBadge({
  status,
}: {
  status:
    | MarketplaceListing["status"]
    | MarketplacePublication["latest_release"]["status"]
}) {
  const { t } = useTranslation()
  const key =
    status in listingStatusKeys
      ? listingStatusKeys[status as keyof typeof listingStatusKeys]
      : releaseStatusKeys[status as keyof typeof releaseStatusKeys]
  const destructive = status === "rejected" || status === "suspended"
  const positive = status === "approved" || status === "published"
  const Icon = marketplaceStatusIcons[status]
  return (
    <Badge
      variant={destructive ? "destructive" : positive ? "secondary" : "outline"}
    >
      <Icon aria-hidden="true" />
      {t(key)}
    </Badge>
  )
}

function CapabilityTypeBadge({
  type,
  compact = false,
}: {
  type: CapabilityType
  compact?: boolean
}) {
  const { t } = useTranslation()
  const label = t(type === "plugin" ? "capability.plugin" : "capability.skill")
  if (compact) {
    return <span className="capability-library-type">{label}</span>
  }
  return <Badge variant="outline">{label}</Badge>
}

function CapabilityStatusBadge({ disabled }: { disabled: boolean }) {
  const { t } = useTranslation()
  const label = t(disabled ? "capability.disable" : "capability.enable")
  return (
    <Badge
      aria-label={label}
      className={cn(
        "capability-status-badge",
        disabled
          ? "capability-status-badge-inactive"
          : "capability-status-badge-active capability-status-badge-icon-only"
      )}
    >
      {disabled ? label : <CheckIcon aria-hidden="true" />}
    </Badge>
  )
}

function ContainsMcpBadge() {
  const { t } = useTranslation()
  return (
    <Badge variant="outline">
      <ServerCogIcon data-icon="inline-start" />
      {t("marketplace.includesMcp")}
    </Badge>
  )
}

function ManifestEvidence({ value }: { value: Record<string, unknown> }) {
  return (
    <pre className="max-h-48 overflow-auto rounded-xl border border-divider bg-muted/30 p-3 font-mono text-xs break-all whitespace-pre-wrap">
      {JSON.stringify(value, null, 2)}
    </pre>
  )
}

function Feedback({ error }: { error: string | null }) {
  if (error) return <StatusBanner variant="error">{error}</StatusBanner>
  return null
}

function PublicationFeedback({ error }: { error: string | null }) {
  const { t } = useTranslation()
  if (error) {
    return (
      <StatusBanner className="min-w-0 flex-1" variant="error">
        {error}
      </StatusBanner>
    )
  }
  return (
    <StatusBanner className="min-w-0 flex-1" variant="info">
      {t("marketplace.reviewPolicyNotice")}
    </StatusBanner>
  )
}

function CapabilityRow({
  capability,
  updateAvailable = false,
  showTypeLabel = true,
  actions,
  onInspect,
}: {
  capability: CapabilitySummary
  updateAvailable?: boolean
  showTypeLabel?: boolean
  actions: ReactNode
  onInspect?: () => void
}) {
  const { t } = useTranslation()
  const productName = useProductName()
  const presentation = capabilityPresentation(capability, t, productName)
  const disabled =
    capability.status !== "active" || capability.personally_disabled === true
  return (
    <CapabilityLibraryItem
      name={presentation.name}
      type={capability.type}
      logoUrl={capability.logo_url}
      showTypeLabel={showTypeLabel}
      description={presentation.description || t("marketplace.noDescription")}
      badges={
        <>
          {capability.is_builtin && (
            <Badge className="capability-built-in-badge" variant="secondary">
              {t("capability.builtIn")}
            </Badge>
          )}
          {capability.source_type === "marketplace" && (
            <Badge variant="secondary">{t("marketplace.storeOrigin")}</Badge>
          )}
          {capability.source_type === "clawhub" && (
            <Badge variant="secondary">{t("clawHub.origin")}</Badge>
          )}
          {capability.risk_summary?.contains_mcp_server === true && (
            <ContainsMcpBadge />
          )}
          {updateAvailable && (
            <Badge variant="outline">
              <RefreshCwIcon data-icon="inline-start" />
              {t("marketplace.updateAvailable")}
            </Badge>
          )}
        </>
      }
      status={<CapabilityStatusBadge disabled={disabled} />}
      notice={
        capability.is_builtin ? t("capability.builtInReadOnly") : undefined
      }
      actions={actions}
      inspectLabel={t("marketplace.viewDetails", {
        name: presentation.name,
      })}
      onInspect={onInspect}
    />
  )
}

function MarketplaceCard({
  item,
  primaryAction,
  showTypeLabel = true,
  useMcpDefaultIcon = false,
  onInspect,
  onInstall,
  onUninstall,
  installPending = false,
  uninstallPending = false,
  actionsDisabled = false,
}: {
  item: MarketplaceCatalogItem
  primaryAction?: ReactNode
  showTypeLabel?: boolean
  useMcpDefaultIcon?: boolean
  onInspect: () => void
  onInstall?: () => void
  onUninstall?: () => void
  installPending?: boolean
  uninstallPending?: boolean
  actionsDisabled?: boolean
}) {
  const { t, i18n } = useTranslation()
  const actionPending = installPending || uninstallPending
  const pendingLabel = installPending
    ? t("marketplace.installing")
    : t("marketplace.uninstalling")
  return (
    <CapabilityLibraryItem
      name={item.release.name}
      type={item.listing.type}
      logoUrl={item.release.logo_url}
      logo={
        useMcpDefaultIcon && !item.release.logo_url?.trim() ? (
          <McpLogo />
        ) : undefined
      }
      showTypeLabel={showTypeLabel}
      description={item.release.description || t("marketplace.noDescription")}
      badges={
        item.release.risk_summary.contains_mcp_server === true ? (
          <ContainsMcpBadge />
        ) : undefined
      }
      metadata={
        <>
          <span>
            {t("marketplace.byPublisher", {
              publisher: item.listing.publisher_name,
            })}
          </span>
          <span aria-hidden="true">·</span>
          <span>
            {t("marketplace.releaseNumber", {
              number: item.release.release_number,
            })}
          </span>
          <span aria-hidden="true">·</span>
          <span>
            {t("marketplace.installCount", { count: item.install_count })}
          </span>
          <span aria-hidden="true">·</span>
          <span>
            {formatDateTime(
              item.release.published_at ?? item.release.updated_at,
              normalizeLanguage(i18n.resolvedLanguage ?? i18n.language) ??
                "zh-CN"
            )}
          </span>
        </>
      }
      status={primaryAction}
      statusPlacement="bottom-right"
      inspectLabel={t("marketplace.viewDetails", { name: item.release.name })}
      onInspect={onInspect}
      actions={
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                className="capability-library-more"
                aria-label={actionPending ? pendingLabel : t("common.actions")}
                aria-busy={actionPending || undefined}
              />
            }
          >
            {actionPending ? (
              <Spinner aria-hidden="true" />
            ) : (
              <MoreHorizontalIcon aria-hidden="true" />
            )}
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-max min-w-32">
            <DropdownMenuGroup>
              <DropdownMenuItem
                className="whitespace-nowrap"
                onClick={onInspect}
              >
                <EyeIcon aria-hidden="true" />
                {t("common.view")}
              </DropdownMenuItem>
              {onInstall && (
                <DropdownMenuItem
                  className="whitespace-nowrap"
                  disabled={actionsDisabled}
                  onClick={onInstall}
                >
                  {installPending ? (
                    <Spinner aria-hidden="true" />
                  ) : (
                    <DownloadIcon aria-hidden="true" />
                  )}
                  {t(
                    installPending
                      ? "marketplace.installing"
                      : "marketplace.install"
                  )}
                </DropdownMenuItem>
              )}
              {onUninstall && (
                <DropdownMenuItem
                  className="whitespace-nowrap"
                  variant="destructive"
                  disabled={actionsDisabled}
                  onClick={onUninstall}
                >
                  {uninstallPending ? (
                    <Spinner aria-hidden="true" />
                  ) : (
                    <Trash2Icon aria-hidden="true" />
                  )}
                  {t(
                    uninstallPending
                      ? "marketplace.uninstalling"
                      : "marketplace.uninstall"
                  )}
                </DropdownMenuItem>
              )}
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      }
    />
  )
}

function MarketplaceDetailDialog({
  item,
  onOpenChange,
}: {
  item: MarketplaceCatalogItem | null
  onOpenChange: (open: boolean) => void
}) {
  const { t } = useTranslation()
  return (
    <Dialog open={item !== null} onOpenChange={onOpenChange}>
      <DialogContent closeLabel={t("common.close")} className="sm:max-w-2xl">
        {item && (
          <>
            <DialogHeader>
              <DialogTitle>{item.release.name}</DialogTitle>
              <DialogDescription>
                {item.release.description || t("marketplace.noDescription")}
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-5">
              <div className="flex flex-wrap gap-2">
                <CapabilityTypeBadge type={item.listing.type} />
                <MarketplaceStatusBadge status={item.listing.status} />
                <Badge variant="outline">
                  {t("marketplace.releaseNumber", {
                    number: item.release.release_number,
                  })}
                </Badge>
              </div>
              <section>
                <h3 className="mb-2 font-medium">
                  {t("marketplace.riskSummary")}
                </h3>
                <CapabilityRiskSummary value={item.release.risk_summary} />
              </section>
              <section>
                <h3 className="mb-2 font-medium">
                  {t("marketplace.releaseNotes")}
                </h3>
                <p className="text-sm whitespace-pre-wrap text-muted-foreground">
                  {item.release.release_notes ||
                    t("marketplace.noReleaseNotes")}
                </p>
              </section>
              <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
                <dt className="text-muted-foreground">
                  {t("marketplace.publisher")}
                </dt>
                <dd>{item.listing.publisher_name}</dd>
                <dt className="text-muted-foreground">
                  {t("marketplace.contentHash")}
                </dt>
                <dd className="font-mono text-xs break-all">
                  {item.release.content_sha256}
                </dd>
              </dl>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}

function CapabilityDetailDialog({
  capability,
  onOpenChange,
}: {
  capability: CapabilitySummary | null
  onOpenChange: (open: boolean) => void
}) {
  const { t } = useTranslation()
  const productName = useProductName()
  if (!capability) {
    return <Dialog open={false} onOpenChange={onOpenChange} />
  }
  const presentation = capabilityPresentation(capability, t, productName)
  const disabled =
    capability.status !== "active" || capability.personally_disabled === true
  const sourceLabel = capability.is_builtin
    ? t("capability.builtIn")
    : capability.source_type === "marketplace"
      ? t("marketplace.storeOrigin")
      : capability.source_type === "clawhub"
        ? t("clawHub.origin")
        : t(`capability.sourceTypes.${capability.source_type}`)

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent closeLabel={t("common.close")} className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{presentation.name}</DialogTitle>
          <DialogDescription>
            {presentation.description || t("marketplace.noDescription")}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-5">
          <div className="flex flex-wrap gap-2">
            <CapabilityTypeBadge type={capability.type} />
            {capability.is_builtin && (
              <Badge className="capability-built-in-badge" variant="secondary">
                {t("capability.builtIn")}
              </Badge>
            )}
            {capability.source_type === "marketplace" && (
              <Badge variant="secondary">{t("marketplace.storeOrigin")}</Badge>
            )}
            {capability.source_type === "clawhub" && (
              <Badge variant="secondary">{t("clawHub.origin")}</Badge>
            )}
            <CapabilityStatusBadge disabled={disabled} />
          </div>
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
            <dt className="text-muted-foreground">{t("capability.source")}</dt>
            <dd>{sourceLabel}</dd>
            <dt className="text-muted-foreground">{t("common.status")}</dt>
            <dd>{t(disabled ? "capability.disable" : "capability.enable")}</dd>
          </dl>
          {capability.is_builtin && (
            <p className="text-sm text-muted-foreground">
              {t("capability.builtInReadOnly")}
            </p>
          )}
          {capability.risk_summary && (
            <section>
              <h3 className="mb-2 font-medium">
                {t("marketplace.riskSummary")}
              </h3>
              <CapabilityRiskSummary value={capability.risk_summary} />
            </section>
          )}
          {capability.manifest && (
            <section>
              <h3 className="mb-2 font-medium">{t("marketplace.manifest")}</h3>
              <ManifestEvidence value={capability.manifest} />
            </section>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}

function CapabilityImportDialog({
  open,
  updateTarget,
  defaultType,
  onOpenChange,
  onCompleted,
}: {
  open: boolean
  updateTarget: CapabilitySummary | null
  defaultType: CapabilityType
  onOpenChange: (open: boolean) => void
  onCompleted: () => Promise<void>
}) {
  const { t } = useTranslation()
  const importType = updateTarget?.type ?? defaultType
  const [source, setSource] = useState<ImportSource>("local")
  const [file, setFile] = useState<File | null>(null)
  const [name, setName] = useState("")
  const [description, setDescription] = useState("")
  const [skillMarkdown, setSkillMarkdown] = useState("")
  const [preview, setPreview] = useState<CapabilityImportPreview | null>(null)
  const [importProgress, setImportProgress] =
    useState<CapabilityImportProgress | null>(null)
  const [riskConfirmed, setRiskConfirmed] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const importSourceItems: Array<{ label: string; value: ImportSource }> = [
    { label: t("marketplace.importSources.local"), value: "local" },
    ...(importType === "skill"
      ? [
          {
            label: t("marketplace.importSources.manualSkill"),
            value: "manual_skill" as const,
          },
        ]
      : []),
  ]

  const reset = () => {
    setSource("local")
    setFile(null)
    setName("")
    setDescription("")
    setSkillMarkdown("")
    setPreview(null)
    setImportProgress(null)
    setRiskConfirmed(false)
    setError(null)
  }

  const previewMutation = useMutation({
    mutationFn: async () => {
      const path = updateTarget
        ? `/capabilities/${updateTarget.id}/import`
        : "/capabilities"
      if (source === "local") {
        const formData = new FormData()
        if (file) formData.append("file", file)
        formData.append("type", importType)
        setImportProgress({ phase: "uploading", percentage: 0 })
        return apiUploadRequest(path, {
          method: "POST",
          body: formData,
          schema: capabilityImportPreviewSchema,
          onUploadProgress: (percentage) => {
            setImportProgress(
              percentage >= 100
                ? { phase: "parsing" }
                : { phase: "uploading", percentage }
            )
          },
        })
      }
      return apiRequest(path, {
        method: "POST",
        body: {
          source_type: "local",
          type: "skill",
          name: name.trim(),
          description: description.trim() || null,
          skill_markdown: skillMarkdown,
        },
        schema: capabilityImportPreviewSchema,
      })
    },
    onSuccess: (value) => {
      setPreview(value)
      setRiskConfirmed(false)
      setError(null)
    },
    onError: (nextError) => setError(getErrorMessage(nextError, t)),
    onSettled: () => setImportProgress(null),
  })

  const confirmMutation = useMutation({
    mutationFn: (nextPreview: CapabilityImportPreview) =>
      apiRequest(`/capabilities/imports/${nextPreview.preview_token}/confirm`, {
        method: "POST",
        schema: capabilitySummarySchema,
      }),
  })

  const sourceValid =
    (source === "local" && file !== null) ||
    (source === "manual_skill" &&
      name.trim().length > 0 &&
      skillMarkdown.trim().length > 0)

  const startConfirmImport = (nextPreview: CapabilityImportPreview) => {
    const toastId = capabilityImportActionToastId(nextPreview)
    notify.loading(t(capabilityImportStatusKey(nextPreview)), { id: toastId })
    reset()
    onOpenChange(false)
    void confirmMutation
      .mutateAsync(nextPreview)
      .then(async (capability) => {
        notify.success(
          t(
            nextPreview.operation === "update"
              ? capability.type === "plugin"
                ? "capability.updatePluginCompleted"
                : "capability.updateSkillCompleted"
              : capability.type === "plugin"
                ? "capability.pluginSavedForNextTurn"
                : "capability.installSkillCompleted"
          ),
          { id: toastId }
        )
        await onCompleted()
      })
      .catch((nextError: unknown) => {
        notify.error(getErrorMessage(nextError, t), { id: toastId })
      })
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) reset()
        onOpenChange(nextOpen)
      }}
    >
      <DialogContent closeLabel={t("common.close")} className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            {t(
              updateTarget
                ? updateTarget.type === "plugin"
                  ? "marketplace.updatePersonalPlugin"
                  : "marketplace.updatePersonalSkill"
                : addCatalogItemKey(importType)
            )}
          </DialogTitle>
          <DialogDescription>
            {t(importDialogDescriptionKey(importType))}
          </DialogDescription>
        </DialogHeader>
        {error && <StatusBanner variant="error">{error}</StatusBanner>}
        {preview ? (
          <div className="space-y-5">
            <div className="rounded-xl border p-4">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="font-medium">{preview.name}</h3>
                <CapabilityTypeBadge type={preview.type} />
              </div>
              <p className="mt-2 text-sm text-muted-foreground">
                {preview.description || t("marketplace.noDescription")}
              </p>
            </div>
            <section>
              <h3 className="font-medium">{t("marketplace.riskSummary")}</h3>
              <CapabilityRiskSummary value={preview.risk_summary} />
            </section>
            {preview.type === "skill" && preview.skill_content_preview && (
              <section>
                <h3 className="mb-2 font-medium">
                  {t("marketplace.skillPreview")}
                </h3>
                <SkillContentPreview
                  type="skill"
                  content={preview.skill_content_preview}
                  truncated={preview.skill_content_truncated}
                />
              </section>
            )}
            <Label className="flex items-start gap-3 text-sm">
              <Checkbox
                checked={riskConfirmed}
                onCheckedChange={(checked) =>
                  setRiskConfirmed(Boolean(checked))
                }
              />
              <span>{t("capability.riskConfirm")}</span>
            </Label>
          </div>
        ) : (
          <form
            className="space-y-4"
            onSubmit={(event) => {
              event.preventDefault()
              previewMutation.mutate()
            }}
          >
            <FieldShell
              id="capability-import-source"
              label={t("capability.source")}
            >
              <Select
                items={importSourceItems}
                value={source}
                onValueChange={(value) => setSource(value as ImportSource)}
              >
                <SelectTrigger id="capability-import-source" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    {importSourceItems.map((item) => (
                      <SelectItem key={item.value} value={item.value}>
                        {item.label}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </FieldShell>
            {source === "local" && (
              <>
                <FieldShell
                  id="capability-package"
                  label={t(zipPackageLabelKey(importType))}
                  hint={t(zipPackageHintKey(importType))}
                >
                  <Input
                    id="capability-package"
                    type="file"
                    accept=".zip,application/zip"
                    disabled={previewMutation.isPending}
                    onChange={(event) =>
                      setFile(event.currentTarget.files?.[0] ?? null)
                    }
                  />
                </FieldShell>
                {previewMutation.isPending && importProgress && (
                  <Progress
                    value={
                      importProgress.phase === "uploading"
                        ? importProgress.percentage
                        : null
                    }
                    aria-label={t(
                      importProgress.phase === "uploading"
                        ? "capability.uploading"
                        : "capability.parsing"
                    )}
                  >
                    <ProgressLabel>
                      {t(
                        importProgress.phase === "uploading"
                          ? "capability.uploading"
                          : "capability.parsing"
                      )}
                    </ProgressLabel>
                    {importProgress.phase === "uploading" && (
                      <ProgressValue>
                        {importProgress.percentage}%
                      </ProgressValue>
                    )}
                  </Progress>
                )}
              </>
            )}
            {source === "manual_skill" && (
              <>
                <FieldShell id="capability-name" label={t("common.name")}>
                  <Input
                    id="capability-name"
                    value={name}
                    maxLength={160}
                    onChange={(event) => setName(event.target.value)}
                  />
                </FieldShell>
                <FieldShell
                  id="capability-description"
                  label={t("common.description")}
                >
                  <Textarea
                    id="capability-description"
                    value={description}
                    maxLength={4_000}
                    onChange={(event) => setDescription(event.target.value)}
                  />
                </FieldShell>
                <FieldShell
                  id="capability-skill-markdown"
                  label={t("marketplace.skillMarkdown")}
                >
                  <Textarea
                    id="capability-skill-markdown"
                    value={skillMarkdown}
                    className="min-h-56 font-mono"
                    onChange={(event) => setSkillMarkdown(event.target.value)}
                  />
                </FieldShell>
              </>
            )}
          </form>
        )}
        <DialogFooter>
          {preview && (
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                setPreview(null)
                setRiskConfirmed(false)
              }}
            >
              {t("common.back")}
            </Button>
          )}
          <DialogClose render={<Button type="button" variant="ghost" />}>
            {t("common.cancel")}
          </DialogClose>
          <Button
            type="button"
            aria-busy={
              previewMutation.isPending ||
              confirmMutation.isPending ||
              undefined
            }
            disabled={
              preview
                ? !riskConfirmed || confirmMutation.isPending
                : !sourceValid || previewMutation.isPending
            }
            onClick={() =>
              preview ? startConfirmImport(preview) : previewMutation.mutate()
            }
          >
            {preview ? (
              <>
                {confirmMutation.isPending ? (
                  <Spinner data-icon="inline-start" />
                ) : (
                  <DownloadIcon data-icon="inline-start" />
                )}
                {t("capability.installSubmit")}
              </>
            ) : (
              <>
                {previewMutation.isPending ? (
                  <Spinner data-icon="inline-start" />
                ) : (
                  <EyeIcon data-icon="inline-start" />
                )}
                {t("capability.previewSubmit")}
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function MyCapabilitiesPanel({
  capabilities,
  category,
  search,
  sectionTitle,
  onFeedback,
  onInspect,
  onUpdate,
}: {
  capabilities: CapabilitySummary[]
  category: Exclude<MarketplaceCatalogSection, "application">
  search: string
  sectionTitle?: string
  onFeedback: (message: string, isError?: boolean) => void
  onInspect: (capability: CapabilitySummary) => void
  onUpdate: (capability: CapabilitySummary) => void
}) {
  const { t } = useTranslation()
  const productName = useProductName()
  const queryClient = useQueryClient()
  const [publishTarget, setPublishTarget] = useState<CapabilitySummary | null>(
    null
  )
  const [deleteTarget, setDeleteTarget] = useState<CapabilitySummary | null>(
    null
  )

  const publications = useQuery({
    queryKey: ["marketplace", "mine"],
    queryFn: () =>
      apiRequest("/marketplace/mine", {
        schema: marketplacePublicationPageSchema,
      }),
  })
  const categoryCapabilities = capabilities.filter(
    (capability) =>
      matchesCapabilityCatalogSection(capability, category) &&
      !capability.is_builtin
  )
  const hasMarketplaceInstallations = categoryCapabilities.some(
    (capability) =>
      capability.source_type === "marketplace" &&
      capability.marketplace_listing_id !== null
  )
  const marketplaceInstallations = useQuery({
    queryKey: ["marketplace", "installations"],
    queryFn: () =>
      apiRequest("/marketplace/installations", {
        schema: marketplaceCatalogPageSchema,
      }),
    enabled: hasMarketplaceInstallations,
  })

  const invalidate = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["capabilities"] }),
      queryClient.invalidateQueries({ queryKey: ["marketplace"] }),
      queryClient.invalidateQueries({ queryKey: ["clawhub"] }),
    ])
  }

  const preferenceMutation = useMutation({
    mutationFn: (capability: CapabilitySummary) =>
      apiRequest(`/capabilities/${capability.id}/preference`, {
        method: "PATCH",
        body: {
          status:
            capability.personally_disabled ||
            capability.preference_status === "disabled"
              ? "enabled"
              : "disabled",
        },
        schema: z.unknown(),
      }),
    onSuccess: async () => {
      onFeedback(t("marketplace.preferenceUpdated"))
      await invalidate()
    },
    onError: (error) => onFeedback(getErrorMessage(error, t), true),
  })

  const deleteMutation = useMutation({
    mutationFn: (capability: CapabilitySummary) =>
      apiRequest(`/capabilities/${capability.id}`, {
        method: "DELETE",
        schema: z.unknown(),
      }),
    onMutate: (capability) => {
      const statusKey =
        capability.source_type === "clawhub"
          ? "clawHub.uninstallingStatus"
          : capability.source_type === "marketplace"
            ? marketplaceUninstallStatusKey(
                capabilityIdentitySection(capability)
              )
            : capabilityDeleteStatusKey(capability.type)
      notify.loading(t(statusKey), {
        id: capabilityActionToastId("delete", capability.id),
      })
    },
    onSuccess: async (_, capability) => {
      notify.success(
        t(
          capability.source_type === "clawhub"
            ? "clawHub.uninstalled"
            : capability.source_type === "marketplace"
              ? marketplaceUninstalledKey(capabilityIdentitySection(capability))
              : capability.type === "skill"
                ? "marketplace.personalSkillDeleted"
                : "marketplace.personalPluginDeleted"
        ),
        { id: capabilityActionToastId("delete", capability.id) }
      )
      await invalidate()
    },
    onError: (error, capability) => {
      notify.error(getErrorMessage(error, t), {
        id: capabilityActionToastId("delete", capability.id),
      })
    },
  })

  const updateMutation = useMutation({
    mutationFn: (installation: MarketplaceCatalogItem) =>
      apiRequest(`/marketplace/${installation.listing.id}/update`, {
        method: "POST",
        schema: capabilitySummarySchema,
      }),
    onMutate: (installation) => {
      notify.loading(t(marketplaceUpdateStatusKey(category)), {
        id: capabilityActionToastId(
          "marketplace-update",
          installation.listing.id
        ),
      })
    },
    onSuccess: async (_, installation) => {
      notify.success(t(marketplaceInstallationUpdatedKey(category)), {
        id: capabilityActionToastId(
          "marketplace-update",
          installation.listing.id
        ),
      })
      await invalidate()
    },
    onError: (error, installation) => {
      notify.error(getErrorMessage(error, t), {
        id: capabilityActionToastId(
          "marketplace-update",
          installation.listing.id
        ),
      })
    },
  })

  if (
    publications.isLoading ||
    (hasMarketplaceInstallations && marketplaceInstallations.isLoading)
  ) {
    return <LoadingState />
  }
  if (publications.isError) {
    return (
      <ErrorState
        message={getErrorMessage(publications.error, t)}
        onRetry={() => void publications.refetch()}
      />
    )
  }
  if (hasMarketplaceInstallations && marketplaceInstallations.isError) {
    return (
      <ErrorState
        message={getErrorMessage(marketplaceInstallations.error, t)}
        onRetry={() => void marketplaceInstallations.refetch()}
      />
    )
  }

  const normalizedSearch = search.trim().toLocaleLowerCase()
  const managedItems = categoryCapabilities.filter((capability) => {
    if (!normalizedSearch) return true
    const presentation = capabilityPresentation(capability, t, productName)
    return [
      presentation.name,
      presentation.description,
      capability.name,
      capability.slug,
    ].some((value) => value?.toLocaleLowerCase().includes(normalizedSearch))
  })
  const publicationItems = publications.data?.items ?? []
  const installationByListingId = new Map(
    (marketplaceInstallations.data?.items ?? []).map((installation) => [
      installation.listing.id,
      installation,
    ])
  )
  const publicationFor = (capability: CapabilitySummary) =>
    publicationItems.find(
      (publication) =>
        publication.listing.type === capability.type &&
        publication.listing.slug === capability.slug
    ) ?? null
  return (
    <div className="capability-center-personal-panel">
      {sectionTitle && (
        <h2 className="capability-center-personal-title">{sectionTitle}</h2>
      )}
      {managedItems.length === 0 ? (
        <EmptyState
          title={t("marketplace.personalCatalogEmpty", {
            category: t(marketplaceCatalogSectionKeys[category]),
          })}
        />
      ) : (
        <div className="capability-library-grid !mt-0">
          {managedItems.map((capability) => {
            const publication = publicationFor(capability)
            const reviewPending =
              publication?.latest_release.status === "pending"
            const marketplaceInstallation =
              capability.marketplace_listing_id === null
                ? null
                : (installationByListingId.get(
                    capability.marketplace_listing_id
                  ) ?? null)
            const updateAvailable =
              marketplaceInstallation?.installed_capability_id ===
                capability.id &&
              marketplaceInstallation.update_available === true
            return (
              <CapabilityRow
                key={capability.id}
                capability={capability}
                updateAvailable={updateAvailable}
                showTypeLabel={category !== "skill" && category !== "mcp"}
                onInspect={() => onInspect(capability)}
                actions={
                  capability.can_manage && capability.can_delete ? (
                    <DropdownMenu>
                      <DropdownMenuTrigger
                        render={
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon-sm"
                            aria-label={t("common.actions")}
                          />
                        }
                      >
                        <MoreHorizontalIcon aria-hidden="true" />
                      </DropdownMenuTrigger>
                      <DropdownMenuContent
                        align="end"
                        className="w-max min-w-40"
                      >
                        <DropdownMenuGroup>
                          <DropdownMenuItem
                            className="whitespace-nowrap"
                            disabled={preferenceMutation.isPending}
                            onClick={() =>
                              preferenceMutation.mutate(capability)
                            }
                          >
                            <PowerIcon aria-hidden="true" />
                            {t(
                              capability.personally_disabled
                                ? "capability.personallyEnable"
                                : "capability.personallyDisable"
                            )}
                          </DropdownMenuItem>
                          {updateAvailable && marketplaceInstallation && (
                            <DropdownMenuItem
                              className="whitespace-nowrap"
                              disabled={updateMutation.isPending}
                              onClick={() =>
                                updateMutation.mutate(marketplaceInstallation)
                              }
                            >
                              <RefreshCwIcon aria-hidden="true" />
                              {t("marketplace.updateInstallation")}
                            </DropdownMenuItem>
                          )}
                          {!isRepositoryCapability(capability) && (
                            <>
                              <DropdownMenuItem
                                className="whitespace-nowrap"
                                onClick={() => onUpdate(capability)}
                              >
                                <UploadIcon aria-hidden="true" />
                                {t(
                                  updatePersonalItemKey(
                                    capabilityIdentitySection(capability)
                                  )
                                )}
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                className="whitespace-nowrap"
                                disabled={reviewPending}
                                onClick={() => setPublishTarget(capability)}
                              >
                                {reviewPending ? (
                                  <Clock3Icon aria-hidden="true" />
                                ) : (
                                  <StoreIcon aria-hidden="true" />
                                )}
                                {t(
                                  reviewPending
                                    ? "marketplace.pendingReviewAction"
                                    : publication
                                      ? "marketplace.submitUpdate"
                                      : "marketplace.applyForListing"
                                )}
                              </DropdownMenuItem>
                            </>
                          )}
                          <DropdownMenuItem
                            className="whitespace-nowrap"
                            variant="destructive"
                            disabled={deleteMutation.isPending}
                            onClick={() => setDeleteTarget(capability)}
                          >
                            <Trash2Icon aria-hidden="true" />
                            {t(
                              capability.source_type === "clawhub"
                                ? "clawHub.uninstall"
                                : capability.source_type === "marketplace"
                                  ? "marketplace.uninstall"
                                  : "common.delete"
                            )}
                          </DropdownMenuItem>
                        </DropdownMenuGroup>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  ) : undefined
                }
              />
            )
          })}
        </div>
      )}
      <PublishDialog
        open={publishTarget !== null}
        publication={
          publishTarget === null ? null : publicationFor(publishTarget)
        }
        sources={publishTarget === null ? [] : [publishTarget]}
        initialCapabilityId={publishTarget?.id}
        onOpenChange={(open) => {
          if (!open) setPublishTarget(null)
        }}
        onCompleted={async (message) => {
          onFeedback(message)
          await invalidate()
        }}
      />
      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null)
        }}
        title={t(
          deleteTarget === null
            ? "capability.deletePluginTitle"
            : deleteTarget.source_type === "clawhub"
              ? "clawHub.uninstallTitle"
              : deleteTarget.source_type === "marketplace"
                ? marketplaceUninstallTitleKey(
                    capabilityIdentitySection(deleteTarget)
                  )
                : personalDeleteTitleKey(
                    capabilityIdentitySection(deleteTarget)
                  )
        )}
        description={t(
          deleteTarget?.source_type === "clawhub"
            ? "clawHub.uninstallDescription"
            : deleteTarget?.source_type === "marketplace"
              ? "marketplace.uninstallDescription"
              : "capability.deleteDescription"
        )}
        confirmLabel={t(
          deleteTarget?.source_type === "clawhub"
            ? "clawHub.uninstall"
            : deleteTarget?.source_type === "marketplace"
              ? "marketplace.uninstall"
              : "common.delete"
        )}
        pendingLabel={
          deleteTarget?.source_type === "clawhub"
            ? t("clawHub.uninstalling")
            : deleteTarget?.source_type === "marketplace"
              ? t("marketplace.uninstalling")
              : undefined
        }
        destructive
        pending={deleteMutation.isPending}
        onConfirm={() => {
          if (!deleteTarget) return
          const nextTarget = deleteTarget
          setDeleteTarget(null)
          deleteMutation.mutate(nextTarget)
        }}
      />
    </div>
  )
}

type InstalledCatalogItem = {
  id: string
  name: string
  type: CapabilityType
  typeLabel?: string
  logoUrl?: string | null
  logo?: ReactNode
  description: string
  disabled: boolean
  builtIn: boolean
  marketplaceOrigin: boolean
  clawHubOrigin: boolean
  capability?: CapabilitySummary
}

function InstalledCatalogSection({
  category,
  items,
  isLoading,
  error,
  onRetry,
  onInspect,
  onUninstall,
  uninstallPendingId,
  uninstallDisabled,
  open,
  onOpenChange,
}: {
  category: MarketplaceCatalogSection
  items: InstalledCatalogItem[]
  isLoading: boolean
  error: unknown | null
  onRetry: () => void
  onInspect: (capability: CapabilitySummary) => void
  onUninstall: (capability: CapabilitySummary) => void
  uninstallPendingId?: string
  uninstallDisabled: boolean
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const { t } = useTranslation()
  const categoryLabel = t(marketplaceCatalogSectionKeys[category])
  const headingId = `capability-installed-${category}`

  return (
    <section
      className="capability-center-installed"
      aria-labelledby={headingId}
    >
      <Collapsible open={open} onOpenChange={onOpenChange}>
        <div className="capability-center-section-header">
          <div className="flex items-center">
            <h2 id={headingId}>{t("marketplace.installedTitle")}</h2>
            <CollapsibleTrigger
              render={
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  className="-ml-1 bg-transparent text-muted-foreground hover:bg-transparent hover:text-foreground aria-expanded:bg-transparent aria-expanded:text-foreground"
                  aria-label={t(
                    open
                      ? "marketplace.collapseInstalled"
                      : "marketplace.expandInstalled",
                    { category: categoryLabel }
                  )}
                />
              }
            >
              <ChevronDownIcon
                aria-hidden="true"
                className={cn(
                  "transition-transform duration-200",
                  !open && "-rotate-90"
                )}
              />
            </CollapsibleTrigger>
          </div>
        </div>
        <CollapsibleContent>
          {isLoading ? (
            <LoadingState label={t("marketplace.loadingInstalled")} />
          ) : error ? (
            <ErrorState message={getErrorMessage(error, t)} onRetry={onRetry} />
          ) : items.length === 0 ? (
            <EmptyState
              title={t("marketplace.installedEmpty", {
                category: categoryLabel,
              })}
            />
          ) : (
            <ul
              className="capability-library-grid capability-center-installed-grid"
              aria-label={t("marketplace.installedListLabel", {
                category: categoryLabel,
              })}
            >
              {items.map((item) => {
                const capability = item.capability
                const uninstallableCapability =
                  capability !== undefined &&
                  isRepositoryCapability(capability) &&
                  capability.can_delete === true
                    ? capability
                    : null
                const uninstallPending =
                  uninstallableCapability?.id === uninstallPendingId
                const uninstallKey =
                  uninstallableCapability?.source_type === "clawhub"
                    ? "clawHub.uninstall"
                    : "marketplace.uninstall"
                const uninstallingKey =
                  uninstallableCapability?.source_type === "clawhub"
                    ? "clawHub.uninstalling"
                    : "marketplace.uninstalling"
                return (
                  <li key={item.id} className="min-w-0">
                    <CapabilityLibraryItem
                      name={item.name}
                      type={item.type}
                      typeLabel={item.typeLabel}
                      showTypeLabel={category !== "skill" && category !== "mcp"}
                      logoUrl={item.logoUrl}
                      logo={item.logo}
                      description={item.description}
                      badges={
                        <>
                          {item.builtIn && (
                            <Badge
                              className="capability-built-in-badge"
                              variant="secondary"
                            >
                              {t("capability.builtIn")}
                            </Badge>
                          )}
                          {item.marketplaceOrigin && (
                            <Badge variant="secondary">
                              {t("marketplace.storeOrigin")}
                            </Badge>
                          )}
                          {item.clawHubOrigin && (
                            <Badge variant="secondary">
                              {t("clawHub.origin")}
                            </Badge>
                          )}
                          {item.capability?.risk_summary
                            ?.contains_mcp_server === true && (
                            <ContainsMcpBadge />
                          )}
                        </>
                      }
                      inspectLabel={
                        capability
                          ? t("marketplace.viewDetails", { name: item.name })
                          : undefined
                      }
                      onInspect={
                        capability ? () => onInspect(capability) : undefined
                      }
                      status={
                        <CapabilityStatusBadge disabled={item.disabled} />
                      }
                      actions={
                        uninstallableCapability ? (
                          <DropdownMenu>
                            <DropdownMenuTrigger
                              render={
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="icon-sm"
                                  aria-label={t(
                                    uninstallPending
                                      ? uninstallingKey
                                      : "common.actions"
                                  )}
                                  aria-busy={uninstallPending || undefined}
                                />
                              }
                            >
                              {uninstallPending ? (
                                <Spinner aria-hidden="true" />
                              ) : (
                                <MoreHorizontalIcon aria-hidden="true" />
                              )}
                            </DropdownMenuTrigger>
                            <DropdownMenuContent
                              align="end"
                              className="w-max min-w-32"
                            >
                              <DropdownMenuGroup>
                                <DropdownMenuItem
                                  className="whitespace-nowrap"
                                  variant="destructive"
                                  disabled={uninstallDisabled}
                                  onClick={() =>
                                    onUninstall(uninstallableCapability)
                                  }
                                >
                                  {uninstallPending ? (
                                    <Spinner aria-hidden="true" />
                                  ) : (
                                    <Trash2Icon aria-hidden="true" />
                                  )}
                                  {t(
                                    uninstallPending
                                      ? uninstallingKey
                                      : uninstallKey
                                  )}
                                </DropdownMenuItem>
                              </DropdownMenuGroup>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        ) : undefined
                      }
                    />
                  </li>
                )
              })}
            </ul>
          )}
        </CollapsibleContent>
      </Collapsible>
    </section>
  )
}

function mcpServerMatchesSearch(
  server: McpServer,
  search: string,
  name: string,
  description: string | null
) {
  const normalizedSearch = search.trim().toLocaleLowerCase()
  if (!normalizedSearch) return true
  const connection =
    server.transport === "stdio"
      ? [server.command, ...server.args].join(" ")
      : server.url
  return [server.name, name, description, connection].some((value) =>
    value?.toLocaleLowerCase().includes(normalizedSearch)
  )
}

function PersonalMcpPanel({
  servers,
  search,
  onManage,
}: {
  servers: McpServer[]
  search: string
  onManage: () => void
}) {
  const { t } = useTranslation()
  const items = servers.filter((server) =>
    mcpServerMatchesSearch(server, search, server.name, null)
  )

  return (
    <div className="capability-center-personal-panel">
      <div className="capability-center-personal-actions">
        <h2>{t("marketplace.personalMcpConnections")}</h2>
        <Button type="button" onClick={onManage}>
          <Settings2Icon data-icon="inline-start" />
          {t("marketplace.manageMcp")}
        </Button>
      </div>
      {items.length === 0 ? (
        <EmptyState
          title={t("marketplace.personalCatalogEmpty", {
            category: t("marketplace.catalogTabs.mcp"),
          })}
        />
      ) : (
        <div className="capability-library-grid !mt-0">
          {items.map((server) => {
            const disabled = server.status !== "active"
            const description =
              server.transport === "stdio"
                ? [server.command, ...server.args].join(" ")
                : server.url
            return (
              <article
                key={server.id}
                className="capability-library-row"
                aria-label={server.name}
              >
                <McpLogo />
                <div className="capability-library-body">
                  <div className="capability-library-title-row">
                    <h3 className="capability-library-name">{server.name}</h3>
                  </div>
                  <p className="capability-library-description">
                    {description || t("marketplace.noDescription")}
                  </p>
                  <div className="capability-library-meta">
                    <span>{t(`mcp.transport.${server.transport}`)}</span>
                    {server.transport === "streamable_http" && (
                      <>
                        <span aria-hidden="true">·</span>
                        <span>{t(`mcp.auth.${server.auth_type}`)}</span>
                      </>
                    )}
                  </div>
                </div>
                <div className="capability-library-tail">
                  <CapabilityStatusBadge disabled={disabled} />
                </div>
              </article>
            )
          })}
        </div>
      )}
    </div>
  )
}

function MarketplaceCatalogPanel({
  onFeedback,
}: {
  onFeedback: (message: string, isError?: boolean) => void
}) {
  const { t } = useTranslation()
  const productName = useProductName()
  const location = useLocation()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const catalogLocation = capabilityCenterLocationFromSearch(location.search)
  const { search, section, scope } = catalogLocation
  const deferredSearch = useDeferredValue(search.trim())
  const updateCatalogLocation = (
    update: Partial<{
      section: MarketplaceCatalogSection
      scope: MarketplaceCatalogScope
      search: string
    }>,
    options: { replace?: boolean } = {}
  ) => {
    const nextPath = capabilityCenterPath({ ...catalogLocation, ...update })
    if (`${location.pathname}${location.search}` === nextPath) return
    navigate(nextPath, { replace: options.replace })
  }
  const [installedSectionOpen, setInstalledSectionOpen] = useState<
    Record<MarketplaceCatalogSection, boolean>
  >({
    plugin: true,
    skill: true,
    mcp: true,
    application: true,
  })
  const [selected, setSelected] = useState<MarketplaceCatalogItem | null>(null)
  const [selectedCapability, setSelectedCapability] =
    useState<CapabilitySummary | null>(null)
  const [uninstallTarget, setUninstallTarget] =
    useState<CapabilityUninstallTarget | null>(null)
  const [importOpen, setImportOpen] = useState(false)
  const [updateTarget, setUpdateTarget] = useState<CapabilitySummary | null>(
    null
  )
  const publicScopeAvailable = section !== "mcp"

  const managed = useQuery({
    queryKey: ["capabilities", "managed"],
    queryFn: ({ signal }) =>
      apiRequest("/capabilities", {
        query: { view: "managed" },
        schema: capabilityPageSchema,
        signal,
      }),
    enabled: section !== "application",
  })
  const mcpServers = useQuery({
    queryKey: ["mcp-servers"],
    queryFn: ({ signal }) =>
      apiRequest("/mcp-servers", {
        schema: mcpServerListSchema,
        signal,
      }),
    enabled: section === "mcp",
  })
  const catalog = useQuery({
    queryKey: ["marketplace", "catalog", section, deferredSearch],
    queryFn: () =>
      apiRequest("/marketplace", {
        query: {
          type: section === "skill" ? "skill" : "plugin",
          search: deferredSearch || undefined,
        },
        schema: marketplaceCatalogPageSchema,
      }),
    enabled:
      section !== "application" && publicScopeAvailable && scope === "public",
  })

  const installMutation = useMutation({
    mutationFn: (item: MarketplaceCatalogItem) =>
      apiRequest(`/marketplace/${item.listing.id}/install`, {
        method: "POST",
        schema: capabilitySummarySchema,
      }),
    onMutate: (item) => {
      const itemSection = marketplaceItemIdentitySection(item)
      notify.loading(t(marketplaceInstallStatusKey(itemSection)), {
        id: capabilityActionToastId("marketplace-install", item.listing.id),
      })
    },
    onSuccess: async (_, item) => {
      notify.success(
        t(marketplaceInstalledKey(marketplaceItemIdentitySection(item))),
        {
          id: capabilityActionToastId("marketplace-install", item.listing.id),
        }
      )
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["marketplace"] }),
        queryClient.invalidateQueries({ queryKey: ["capabilities"] }),
      ])
    },
    onError: (error, item) => {
      notify.error(getErrorMessage(error, t), {
        id: capabilityActionToastId("marketplace-install", item.listing.id),
      })
    },
  })

  const updateMutation = useMutation({
    mutationFn: (item: MarketplaceCatalogItem) =>
      apiRequest(`/marketplace/${item.listing.id}/update`, {
        method: "POST",
        schema: capabilitySummarySchema,
      }),
    onMutate: (item) => {
      const itemSection = marketplaceItemIdentitySection(item)
      notify.loading(t(marketplaceUpdateStatusKey(itemSection)), {
        id: capabilityActionToastId("marketplace-update", item.listing.id),
      })
    },
    onSuccess: async (_, item) => {
      notify.success(
        t(
          marketplaceInstallationUpdatedKey(
            marketplaceItemIdentitySection(item)
          )
        ),
        {
          id: capabilityActionToastId("marketplace-update", item.listing.id),
        }
      )
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["marketplace"] }),
        queryClient.invalidateQueries({ queryKey: ["capabilities"] }),
      ])
    },
    onError: (error, item) => {
      notify.error(getErrorMessage(error, t), {
        id: capabilityActionToastId("marketplace-update", item.listing.id),
      })
    },
  })
  const uninstallMutation = useMutation({
    mutationFn: (target: CapabilityUninstallTarget) =>
      apiRequest(`/capabilities/${target.id}`, {
        method: "DELETE",
        schema: z.unknown(),
      }),
    onMutate: (target) => {
      notify.loading(t(marketplaceUninstallStatusKey(target.category)), {
        id: capabilityActionToastId("marketplace-uninstall", target.id),
      })
    },
    onSuccess: async (_, target) => {
      notify.success(
        t(
          target.sourceType === "clawhub"
            ? "clawHub.uninstalled"
            : marketplaceUninstalledKey(target.category)
        ),
        { id: capabilityActionToastId("marketplace-uninstall", target.id) }
      )
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["marketplace"] }),
        queryClient.invalidateQueries({ queryKey: ["capabilities"] }),
        queryClient.invalidateQueries({ queryKey: ["clawhub"] }),
      ])
    },
    onError: (error, target) => {
      notify.error(getErrorMessage(error, t), {
        id: capabilityActionToastId("marketplace-uninstall", target.id),
      })
    },
  })
  const catalogItems = (catalog.data?.items ?? []).filter((item) =>
    matchesMarketplaceCatalogSection(item, section)
  )
  const normalizedSearch = deferredSearch.toLocaleLowerCase()
  const capabilities = managed.data?.items ?? []
  const servers = mcpServers.data?.items ?? []
  const coreMcp = coreMcpPresentation(t, productName)
  const installedCoreMcpItems: InstalledCatalogItem[] =
    section === "mcp" &&
    (!normalizedSearch ||
      [coreMcp.name, coreMcp.description].some((value) =>
        value.toLocaleLowerCase().includes(normalizedSearch)
      ))
      ? [
          {
            id: `builtin:mcp:${coreMcpServerKey}`,
            name: coreMcp.name,
            type: "plugin",
            typeLabel: "MCP",
            logo: <McpLogo />,
            description: coreMcp.description,
            disabled: false,
            builtIn: true,
            marketplaceOrigin: false,
            clawHubOrigin: false,
          },
        ]
      : []
  const installedCapabilityItems: InstalledCatalogItem[] =
    section === "application"
      ? []
      : capabilities
          .filter((capability) =>
            matchesCapabilityCatalogSection(capability, section)
          )
          .map((capability) => ({
            capability,
            presentation: capabilityPresentation(capability, t, productName),
          }))
          .filter(({ capability, presentation }) =>
            normalizedSearch
              ? [
                  capability.name,
                  capability.slug,
                  presentation.name,
                  presentation.description,
                ].some((value) =>
                  value?.toLocaleLowerCase().includes(normalizedSearch)
                )
              : true
          )
          .map(({ capability, presentation }) => ({
            id: capability.id,
            name: presentation.name,
            type: capability.type,
            typeLabel: section === "mcp" ? "MCP" : undefined,
            logoUrl: capability.logo_url,
            logo:
              section === "mcp" && !capability.logo_url?.trim() ? (
                <McpLogo />
              ) : undefined,
            description:
              presentation.description || t("marketplace.noDescription"),
            disabled:
              capability.status !== "active" ||
              capability.personally_disabled === true,
            builtIn: capability.is_builtin,
            marketplaceOrigin: capability.source_type === "marketplace",
            clawHubOrigin: capability.source_type === "clawhub",
            capability,
          }))
  const installedMcpServerItems: InstalledCatalogItem[] =
    section === "mcp"
      ? servers
          .filter((server) =>
            mcpServerMatchesSearch(server, deferredSearch, server.name, null)
          )
          .map((server) => ({
            id: server.id,
            name: server.name,
            type: "plugin" as const,
            typeLabel: "MCP",
            logo: <McpLogo />,
            description:
              (server.transport === "stdio"
                ? [server.command, ...server.args].join(" ")
                : server.url) || t("marketplace.noDescription"),
            disabled: server.status !== "active",
            builtIn: false,
            marketplaceOrigin: false,
            clawHubOrigin: false,
          }))
      : []
  const installedItems = [
    ...installedCoreMcpItems,
    ...installedCapabilityItems,
    ...installedMcpServerItems,
  ]
  const installedLoading =
    section === "mcp"
      ? managed.isLoading || mcpServers.isLoading
      : managed.isLoading
  const installedError =
    section === "mcp"
      ? managed.isError
        ? managed.error
        : mcpServers.isError
          ? mcpServers.error
          : null
      : managed.isError
        ? managed.error
        : null
  const retryInstalled = () => {
    if (section === "mcp") {
      void managed.refetch()
      void mcpServers.refetch()
      return
    }
    void managed.refetch()
  }
  const openMcpManagement = () => {
    const returnState = capabilityCenterSettingsState({
      section,
      scope,
      search,
    })
    navigate(returnState.settingsReturnTo, { replace: true })
    navigate("/settings/mcp", { state: returnState })
  }
  const openCapabilityImport = (target: CapabilitySummary | null = null) => {
    setUpdateTarget(target)
    setImportOpen(true)
  }

  const publicCatalog = (
    <>
      {(catalog.isLoading || managed.isLoading) && <LoadingState />}
      {(catalog.isError || managed.isError) && (
        <ErrorState
          message={getErrorMessage(catalog.error ?? managed.error, t)}
          onRetry={() => {
            void catalog.refetch()
            void managed.refetch()
          }}
        />
      )}
      {catalog.data &&
        managed.data &&
        (catalogItems.length === 0 ? (
          <EmptyState
            title={t("marketplace.catalogEmpty", {
              category: t(marketplaceCatalogSectionKeys[section]),
            })}
          />
        ) : (
          <div className="capability-library-grid !mt-0">
            {catalogItems.map((item) => {
              const installState = marketplaceCatalogInstallState(
                item,
                capabilities
              )
              const uninstall =
                installState.kind === "marketplace"
                  ? () =>
                      setUninstallTarget({
                        id: installState.capabilityId,
                        name: item.release.name,
                        category: marketplaceItemIdentitySection(item),
                        sourceType: "marketplace",
                      })
                  : undefined
              const installPending =
                installMutation.isPending &&
                installMutation.variables?.listing.id === item.listing.id
              const uninstallPending =
                uninstallMutation.isPending &&
                uninstallMutation.variables?.id ===
                  (installState.kind === "marketplace"
                    ? installState.capabilityId
                    : undefined)
              return (
                <MarketplaceCard
                  key={item.listing.id}
                  item={item}
                  onInspect={() => setSelected(item)}
                  onInstall={
                    installState.kind === "not-installed"
                      ? () => installMutation.mutate(item)
                      : undefined
                  }
                  onUninstall={uninstall}
                  installPending={installPending}
                  uninstallPending={uninstallPending}
                  actionsDisabled={
                    installMutation.isPending || uninstallMutation.isPending
                  }
                  showTypeLabel={section !== "skill" && section !== "mcp"}
                  useMcpDefaultIcon={section === "mcp"}
                  primaryAction={
                    installState.kind === "marketplace" &&
                    item.update_available ? (
                      <Button
                        type="button"
                        size="sm"
                        disabled={updateMutation.isPending}
                        onClick={() => updateMutation.mutate(item)}
                      >
                        <RefreshCwIcon data-icon="inline-start" />
                        {t("marketplace.update")}
                      </Button>
                    ) : installState.kind === "owned-source" ? (
                      <Badge variant="secondary">
                        <CheckCircle2Icon />
                        {t("marketplace.installedState")}
                      </Badge>
                    ) : undefined
                  }
                />
              )
            })}
          </div>
        ))}
    </>
  )

  const personalCatalog =
    section === "plugin" || section === "skill" ? (
      managed.isLoading ? (
        <LoadingState />
      ) : managed.isError ? (
        <ErrorState
          message={getErrorMessage(managed.error, t)}
          onRetry={() => void managed.refetch()}
        />
      ) : (
        <MyCapabilitiesPanel
          key={section}
          capabilities={capabilities}
          category={section}
          search={deferredSearch}
          onFeedback={onFeedback}
          onInspect={setSelectedCapability}
          onUpdate={openCapabilityImport}
        />
      )
    ) : managed.isLoading || mcpServers.isLoading ? (
      <LoadingState />
    ) : managed.isError || mcpServers.isError ? (
      <ErrorState
        message={getErrorMessage(managed.error ?? mcpServers.error, t)}
        onRetry={() => {
          void managed.refetch()
          void mcpServers.refetch()
        }}
      />
    ) : (
      <div className="capability-center-personal-groups">
        <PersonalMcpPanel
          servers={servers}
          search={deferredSearch}
          onManage={openMcpManagement}
        />
        <Separator />
        <MyCapabilitiesPanel
          capabilities={capabilities}
          category="mcp"
          search={deferredSearch}
          sectionTitle={t("marketplace.personalMcpPackages")}
          onFeedback={onFeedback}
          onInspect={setSelectedCapability}
          onUpdate={openCapabilityImport}
        />
      </div>
    )

  return (
    <>
      <Tabs
        value={section}
        onValueChange={(value) => {
          updateCatalogLocation({
            section: value as MarketplaceCatalogSection,
            scope: "personal",
            search: "",
          })
        }}
      >
        <TabsList aria-label={t("marketplace.catalogTabsLabel")}>
          {marketplaceCatalogSections.map((value) => (
            <TabsTrigger key={value} value={value}>
              {t(marketplaceCatalogSectionKeys[value])}
            </TabsTrigger>
          ))}
        </TabsList>
        {marketplaceCatalogSections.map((value) => (
          <TabsContent
            key={value}
            value={value}
            className="capability-center-tab-content"
          >
            {section === value ? (
              value === "application" ? (
                <ApplicationCatalogPanel onFeedback={onFeedback} />
              ) : (
                <div className="capability-center-catalog">
                  <div className="capability-center-search-row">
                    <InputGroup className="flex-1">
                      <InputGroupAddon>
                        <SearchIcon aria-hidden="true" />
                      </InputGroupAddon>
                      <InputGroupInput
                        type="search"
                        value={search}
                        aria-label={
                          scope === "clawhub"
                            ? t("clawHub.search")
                            : t("marketplace.searchCategory", {
                                category: t(
                                  marketplaceCatalogSectionKeys[section]
                                ),
                              })
                        }
                        placeholder={
                          scope === "clawhub"
                            ? t("clawHub.search")
                            : t("marketplace.searchCategory", {
                                category: t(
                                  marketplaceCatalogSectionKeys[section]
                                ),
                              })
                        }
                        onChange={(event) =>
                          updateCatalogLocation(
                            { search: event.target.value },
                            { replace: true }
                          )
                        }
                      />
                    </InputGroup>
                    {section !== "mcp" && section !== "application" && (
                      <Button
                        type="button"
                        onClick={() => openCapabilityImport()}
                      >
                        <PackagePlusIcon data-icon="inline-start" />
                        {t(addCatalogItemKey(section))}
                      </Button>
                    )}
                  </div>
                  <InstalledCatalogSection
                    category={section}
                    items={installedItems}
                    isLoading={installedLoading}
                    error={installedError}
                    onRetry={retryInstalled}
                    onInspect={setSelectedCapability}
                    onUninstall={(capability) =>
                      setUninstallTarget({
                        id: capability.id,
                        name: capabilityPresentation(capability, t, productName)
                          .name,
                        category: capabilityIdentitySection(capability),
                        sourceType:
                          capability.source_type === "clawhub"
                            ? "clawhub"
                            : "marketplace",
                      })
                    }
                    uninstallPendingId={
                      uninstallMutation.isPending
                        ? uninstallMutation.variables?.id
                        : undefined
                    }
                    uninstallDisabled={uninstallMutation.isPending}
                    open={installedSectionOpen[section]}
                    onOpenChange={(open) =>
                      setInstalledSectionOpen((current) => ({
                        ...current,
                        [section]: open,
                      }))
                    }
                  />
                  <Separator />
                  <div className="capability-center-scope-row">
                    <ToggleGroup
                      value={[scope]}
                      variant="default"
                      spacing={2}
                      aria-label={t("marketplace.catalogScopesLabel")}
                      onValueChange={(values) => {
                        const value = values[0]
                        if (
                          (value === "public" && publicScopeAvailable) ||
                          value === "personal" ||
                          (value === "clawhub" && section === "skill")
                        ) {
                          updateCatalogLocation({ scope: value })
                        }
                      }}
                    >
                      <ToggleGroupItem value="personal">
                        {t("marketplace.scopes.personal")}
                      </ToggleGroupItem>
                      {publicScopeAvailable && (
                        <ToggleGroupItem value="public">
                          {t("marketplace.scopes.public")}
                        </ToggleGroupItem>
                      )}
                      {section === "skill" && (
                        <ToggleGroupItem value="clawhub">
                          {t("clawHub.repository")}
                        </ToggleGroupItem>
                      )}
                    </ToggleGroup>
                  </div>
                  <section
                    className="capability-center-directory"
                    aria-label={t(
                      scope === "public" && publicScopeAvailable
                        ? "marketplace.publicCatalogLabel"
                        : scope === "clawhub"
                          ? "clawHub.catalogLabel"
                          : "marketplace.personalCatalogLabel",
                      {
                        category: t(marketplaceCatalogSectionKeys[section]),
                      }
                    )}
                  >
                    {scope === "public" && publicScopeAvailable ? (
                      publicCatalog
                    ) : scope === "clawhub" ? (
                      <ClawHubSkillRepositoryPanel
                        search={deferredSearch}
                        onFeedback={onFeedback}
                      />
                    ) : (
                      personalCatalog
                    )}
                  </section>
                </div>
              )
            ) : null}
          </TabsContent>
        ))}
      </Tabs>
      <CapabilityImportDialog
        key={updateTarget?.id ?? `add-${section}`}
        open={importOpen}
        updateTarget={updateTarget}
        defaultType={section === "skill" ? "skill" : "plugin"}
        onOpenChange={(open) => {
          setImportOpen(open)
          if (!open) setUpdateTarget(null)
        }}
        onCompleted={async () => {
          await Promise.all([
            queryClient.invalidateQueries({ queryKey: ["capabilities"] }),
            queryClient.invalidateQueries({ queryKey: ["marketplace"] }),
          ])
        }}
      />
      <MarketplaceDetailDialog
        item={selected}
        onOpenChange={(open) => {
          if (!open) setSelected(null)
        }}
      />
      <CapabilityDetailDialog
        capability={selectedCapability}
        onOpenChange={(open) => {
          if (!open) setSelectedCapability(null)
        }}
      />
      <ConfirmDialog
        open={uninstallTarget !== null}
        onOpenChange={(open) => {
          if (!open) setUninstallTarget(null)
        }}
        title={t(
          uninstallTarget?.sourceType === "clawhub"
            ? "clawHub.uninstallTitle"
            : marketplaceUninstallTitleKey(
                uninstallTarget?.category ?? "plugin"
              )
        )}
        description={t(
          uninstallTarget?.sourceType === "clawhub"
            ? "clawHub.uninstallDescription"
            : "marketplace.uninstallDescription"
        )}
        confirmLabel={t(
          uninstallTarget?.sourceType === "clawhub"
            ? "clawHub.uninstall"
            : "marketplace.uninstall"
        )}
        pendingLabel={t(
          uninstallTarget?.sourceType === "clawhub"
            ? "clawHub.uninstalling"
            : "marketplace.uninstalling"
        )}
        destructive
        pending={uninstallMutation.isPending}
        onConfirm={() => {
          if (!uninstallTarget) return
          const nextTarget = uninstallTarget
          setUninstallTarget(null)
          uninstallMutation.mutate(nextTarget)
        }}
      />
    </>
  )
}

function PublishDialog({
  open,
  publication,
  sources,
  initialCapabilityId,
  onOpenChange,
  onCompleted,
}: {
  open: boolean
  publication: MarketplacePublication | null
  sources: CapabilitySummary[]
  initialCapabilityId?: string
  onOpenChange: (open: boolean) => void
  onCompleted: (message: string) => Promise<void>
}) {
  const { t } = useTranslation()
  const candidates = useMemo(
    () =>
      publication === null
        ? sources
        : sources.filter(
            (source) =>
              source.type === publication.listing.type &&
              source.slug === publication.listing.slug
          ),
    [publication, sources]
  )
  const [capabilityId, setCapabilityId] = useState("")
  const [releaseNotes, setReleaseNotes] = useState("")
  const [error, setError] = useState<string | null>(null)
  const defaultCapabilityId = useMemo(() => {
    const initialCandidate = candidates.find(
      (candidate) => candidate.id === initialCapabilityId
    )
    return (
      initialCandidate?.id ??
      (candidates.length === 1 ? (candidates[0]?.id ?? "") : "")
    )
  }, [candidates, initialCapabilityId])
  const selectedCapabilityId = capabilityId || defaultCapabilityId
  const candidateItems = useMemo(
    () =>
      candidates.map((source) => ({
        value: source.id,
        label: [
          source.name,
          t(
            source.type === "plugin" ? "capability.plugin" : "capability.skill"
          ),
          t(
            source.source_type === "marketplace"
              ? "marketplace.storeOrigin"
              : source.source_type === "clawhub"
                ? "clawHub.origin"
                : `capability.sourceTypes.${source.source_type}`
          ),
        ].join(" · "),
      })),
    [candidates, t]
  )

  const submitMutation = useMutation({
    mutationFn: () =>
      apiRequest("/marketplace/submissions", {
        method: "POST",
        body: {
          capability_id: selectedCapabilityId,
          ...(publication ? { listing_id: publication.listing.id } : {}),
          release_notes: releaseNotes.trim() || null,
        },
        schema: marketplacePublicationSchema,
      }),
    onSuccess: async () => {
      await onCompleted(t("marketplace.submitted"))
      setCapabilityId("")
      setReleaseNotes("")
      setError(null)
      onOpenChange(false)
    },
    onError: (nextError) => setError(getErrorMessage(nextError, t)),
  })

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) {
          setCapabilityId("")
          setReleaseNotes("")
          setError(null)
        }
        onOpenChange(nextOpen)
      }}
    >
      <DialogContent closeLabel={t("common.close")}>
        <DialogHeader>
          <DialogTitle>
            {t(
              publication
                ? "marketplace.submitUpdate"
                : "marketplace.publishNew"
            )}
          </DialogTitle>
          <DialogDescription>
            {t("marketplace.publishDialogDescription")}
          </DialogDescription>
        </DialogHeader>
        {error && <StatusBanner variant="error">{error}</StatusBanner>}
        <FieldShell
          id="marketplace-publish-source"
          label={t("marketplace.sourceCapability")}
        >
          <Select
            items={candidateItems}
            value={selectedCapabilityId}
            onValueChange={(value) => setCapabilityId(value ?? "")}
          >
            <SelectTrigger id="marketplace-publish-source" className="w-full">
              <SelectValue placeholder={t("common.select")} />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                {candidateItems.map((item) => (
                  <SelectItem key={item.value} value={item.value}>
                    {item.label}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        </FieldShell>
        {candidates.length === 0 && (
          <StatusBanner variant="warning">
            {t("marketplace.noPublishableSource")}
          </StatusBanner>
        )}
        <FieldShell
          id="marketplace-release-notes"
          label={t("marketplace.releaseNotes")}
        >
          <Textarea
            id="marketplace-release-notes"
            value={releaseNotes}
            maxLength={8_000}
            onChange={(event) => setReleaseNotes(event.target.value)}
          />
        </FieldShell>
        <StatusBanner variant="info">
          {t("marketplace.immutableSnapshotNotice")}
        </StatusBanner>
        <DialogFooter>
          <DialogClose render={<Button type="button" variant="ghost" />}>
            {t("common.cancel")}
          </DialogClose>
          <Button
            type="button"
            disabled={!selectedCapabilityId || submitMutation.isPending}
            onClick={() => submitMutation.mutate()}
          >
            <SendIcon data-icon="inline-start" />
            {t("marketplace.submitForReview")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function PublicationCard({
  publication,
  onSubmitUpdate,
  onWithdraw,
  onStatusChange,
  onInspect,
}: {
  publication: MarketplacePublication
  onSubmitUpdate: () => void
  onWithdraw: () => void
  onStatusChange: () => void
  onInspect: () => void
}) {
  const { t, i18n } = useTranslation()
  const pending = publication.latest_release.status === "pending"
  const hasCurrent = publication.current_release !== null
  const displayedStatus =
    publication.listing.status === "suspended" ||
    publication.latest_release.status === "approved"
      ? publication.listing.status
      : publication.latest_release.status
  const notice =
    publication.listing.status === "suspended"
      ? publication.listing.suspension_reason
      : publication.latest_release.review_comment
  const noticeVariant =
    publication.listing.status === "suspended" ||
    publication.latest_release.status === "rejected"
      ? "destructive"
      : "default"

  return (
    <CapabilityLibraryItem
      name={publication.latest_release.name}
      type={publication.listing.type}
      logoUrl={publication.latest_release.logo_url}
      description={
        publication.latest_release.description || t("marketplace.noDescription")
      }
      metadata={
        <>
          <span>
            {t("marketplace.releaseNumber", {
              number: publication.latest_release.release_number,
            })}
          </span>
          <span aria-hidden="true">·</span>
          <span>
            {t("marketplace.installCount", {
              count: publication.install_count,
            })}
          </span>
          <span aria-hidden="true">·</span>
          <span>
            {t("marketplace.submittedAt", {
              date: formatDateTime(
                publication.latest_release.submitted_at,
                normalizeLanguage(i18n.resolvedLanguage ?? i18n.language) ??
                  "zh-CN"
              ),
            })}
          </span>
        </>
      }
      notice={
        notice ? (
          <>
            {noticeVariant === "destructive" ? (
              <BanIcon aria-hidden="true" />
            ) : (
              <FileTextIcon aria-hidden="true" />
            )}
            <span title={notice}>{notice}</span>
          </>
        ) : undefined
      }
      noticeVariant={noticeVariant}
      status={<MarketplaceStatusBadge status={displayedStatus} />}
      statusPlacement="top-right"
      actions={
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                className="capability-library-more"
                aria-label={t("common.actions")}
              />
            }
          >
            <MoreHorizontalIcon aria-hidden="true" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-max min-w-32">
            <DropdownMenuGroup>
              <DropdownMenuItem
                className="whitespace-nowrap"
                onClick={onInspect}
              >
                <EyeIcon aria-hidden="true" />
                {t("common.view")}
              </DropdownMenuItem>
              {pending ? (
                <DropdownMenuItem
                  className="whitespace-nowrap"
                  onClick={onWithdraw}
                >
                  <Undo2Icon aria-hidden="true" />
                  {t("marketplace.withdraw")}
                </DropdownMenuItem>
              ) : (
                publication.listing.status !== "suspended" && (
                  <DropdownMenuItem
                    className="whitespace-nowrap"
                    onClick={onSubmitUpdate}
                  >
                    <UploadIcon aria-hidden="true" />
                    {t("marketplace.submitUpdate")}
                  </DropdownMenuItem>
                )
              )}
              {hasCurrent && publication.listing.status !== "suspended" && (
                <DropdownMenuItem
                  className="whitespace-nowrap"
                  variant={
                    publication.listing.status === "unlisted"
                      ? "default"
                      : "destructive"
                  }
                  onClick={onStatusChange}
                >
                  {publication.listing.status === "unlisted" ? (
                    <StoreIcon aria-hidden="true" />
                  ) : (
                    <EyeOffIcon aria-hidden="true" />
                  )}
                  {t(
                    publication.listing.status === "unlisted"
                      ? "marketplace.relist"
                      : "marketplace.unlist"
                  )}
                </DropdownMenuItem>
              )}
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      }
    />
  )
}

function ReleaseDetailDialog({
  publication,
  admin,
  onOpenChange,
}: {
  publication: MarketplacePublication | null
  admin: boolean
  onOpenChange: (open: boolean) => void
}) {
  const { t } = useTranslation()
  const releaseId = publication?.latest_release.id
  const detail = useQuery({
    queryKey: ["marketplace", "release-detail", admin, releaseId],
    queryFn: () =>
      apiRequest(
        admin
          ? `/admin/marketplace/releases/${releaseId}`
          : `/marketplace/releases/${releaseId}`,
        { schema: marketplaceReviewDetailSchema }
      ),
    enabled: releaseId !== undefined,
  })
  return (
    <Dialog open={publication !== null} onOpenChange={onOpenChange}>
      <DialogContent closeLabel={t("common.close")} className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>
            {publication?.latest_release.name ?? t("marketplace.releaseDetail")}
          </DialogTitle>
          <DialogDescription>
            {t("marketplace.releaseDetailDescription")}
          </DialogDescription>
        </DialogHeader>
        {detail.isLoading && <LoadingState />}
        {detail.isError && (
          <ErrorState
            message={getErrorMessage(detail.error, t)}
            onRetry={() => void detail.refetch()}
          />
        )}
        {detail.data && (
          <div className="max-h-[65vh] space-y-5 overflow-y-auto pr-1">
            <div className="flex flex-wrap gap-2">
              <MarketplaceStatusBadge status={detail.data.release.status} />
              <CapabilityTypeBadge type={detail.data.listing.type} />
              <Badge variant="outline">
                {t("marketplace.releaseNumber", {
                  number: detail.data.release.release_number,
                })}
              </Badge>
            </div>
            <section>
              <h3 className="mb-2 font-medium">
                {t("marketplace.packageFiles")}
              </h3>
              <ul className="rounded-xl border p-3 font-mono text-xs">
                {detail.data.files.map((file) => (
                  <li key={file} className="py-1 break-all">
                    {file}
                  </li>
                ))}
              </ul>
            </section>
            <section>
              <h3 className="mb-2 font-medium">
                {t("marketplace.riskSummary")}
              </h3>
              <CapabilityRiskSummary value={detail.data.release.risk_summary} />
            </section>
            <section>
              <h3 className="mb-2 font-medium">{t("marketplace.manifest")}</h3>
              <ManifestEvidence value={detail.data.release.manifest} />
            </section>
            {detail.data.skill_content !== null && (
              <section>
                <h3 className="mb-2 font-medium">
                  {t("marketplace.skillPreview")}
                </h3>
                <SkillContentPreview
                  type="skill"
                  content={detail.data.skill_content}
                  truncated={false}
                />
              </section>
            )}
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
              <dt className="text-muted-foreground">
                {t("marketplace.contentHash")}
              </dt>
              <dd className="font-mono text-xs break-all">
                {detail.data.release.content_sha256}
              </dd>
              <dt className="text-muted-foreground">
                {t("marketplace.releaseNotes")}
              </dt>
              <dd className="whitespace-pre-wrap">
                {detail.data.release.release_notes ||
                  t("marketplace.noReleaseNotes")}
              </dd>
            </dl>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

function MyPublicationsPanel({
  onFeedback,
  error,
}: {
  onFeedback: (message: string, isError?: boolean) => void
  error: string | null
}) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [publishOpen, setPublishOpen] = useState(false)
  const [publicationTarget, setPublicationTarget] =
    useState<MarketplacePublication | null>(null)
  const [detailTarget, setDetailTarget] =
    useState<MarketplacePublication | null>(null)

  const sources = useQuery({
    queryKey: ["capabilities", "publishable"],
    queryFn: () =>
      apiRequest("/capabilities", {
        query: { view: "managed" },
        schema: capabilityPageSchema,
      }),
  })
  const publications = useQuery({
    queryKey: ["marketplace", "mine"],
    queryFn: () =>
      apiRequest("/marketplace/mine", {
        schema: marketplacePublicationPageSchema,
      }),
  })

  const invalidate = async () => {
    await queryClient.invalidateQueries({ queryKey: ["marketplace"] })
  }

  const withdrawMutation = useMutation({
    mutationFn: (publication: MarketplacePublication) =>
      apiRequest(`/marketplace/releases/${publication.latest_release.id}`, {
        method: "DELETE",
        schema: marketplaceReleaseSchema,
      }),
    onSuccess: async () => {
      onFeedback(t("marketplace.withdrawn"))
      await invalidate()
    },
    onError: (error) => onFeedback(getErrorMessage(error, t), true),
  })

  const statusMutation = useMutation({
    mutationFn: (publication: MarketplacePublication) =>
      apiRequest(`/marketplace/${publication.listing.id}/status`, {
        method: "PATCH",
        body: {
          status:
            publication.listing.status === "unlisted"
              ? "published"
              : "unlisted",
        },
        schema: marketplaceListingSchema,
      }),
    onSuccess: async (_, publication) => {
      onFeedback(
        t(
          publication.listing.status === "unlisted"
            ? "marketplace.relisted"
            : "marketplace.unlisted"
        )
      )
      await invalidate()
    },
    onError: (error) => onFeedback(getErrorMessage(error, t), true),
  })

  if (sources.isLoading || publications.isLoading) return <LoadingState />
  if (sources.isError) {
    return (
      <ErrorState
        message={getErrorMessage(sources.error, t)}
        onRetry={() => void sources.refetch()}
      />
    )
  }
  if (publications.isError) {
    return (
      <ErrorState
        message={getErrorMessage(publications.error, t)}
        onRetry={() => void publications.refetch()}
      />
    )
  }

  const publishableSources = (sources.data?.items ?? []).filter(
    (capability) =>
      capability.is_owner !== false &&
      capability.status === "active" &&
      !isRepositoryCapability(capability)
  )
  const items = publications.data?.items ?? []
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
        <PublicationFeedback error={error} />
        <Button
          type="button"
          className="shrink-0"
          disabled={publishableSources.length === 0}
          onClick={() => {
            setPublicationTarget(null)
            setPublishOpen(true)
          }}
        >
          <UploadIcon data-icon="inline-start" />
          {t("marketplace.publishNew")}
        </Button>
      </div>
      {items.length === 0 ? (
        <EmptyState title={t("marketplace.publicationsEmpty")} />
      ) : (
        <div className="capability-library-grid">
          {items.map((publication) => (
            <PublicationCard
              key={publication.listing.id}
              publication={publication}
              onInspect={() => setDetailTarget(publication)}
              onSubmitUpdate={() => {
                setPublicationTarget(publication)
                setPublishOpen(true)
              }}
              onWithdraw={() => withdrawMutation.mutate(publication)}
              onStatusChange={() => statusMutation.mutate(publication)}
            />
          ))}
        </div>
      )}
      <PublishDialog
        open={publishOpen}
        publication={publicationTarget}
        sources={publishableSources}
        onOpenChange={setPublishOpen}
        onCompleted={async (message) => {
          onFeedback(message)
          await invalidate()
        }}
      />
      <ReleaseDetailDialog
        publication={detailTarget}
        admin={false}
        onOpenChange={(open) => {
          if (!open) setDetailTarget(null)
        }}
      />
    </div>
  )
}

export function CapabilityManagementPage() {
  const { t } = useTranslation()
  const [view, setView] = useState<UserCapabilityView>("store")
  const [error, setError] = useState<string | null>(null)
  const feedback = (message: string, isError = false) => {
    if (isError) {
      setError(message)
      return
    }
    setError(null)
    notify.success(message, { id: "capability-action-success" })
  }

  return (
    <PageLayout
      title={t("marketplace.title")}
      description={t("marketplace.description")}
      actions={
        <>
          {view !== "store" && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setView("store")}
            >
              <StoreIcon data-icon="inline-start" />
              {t("marketplace.tabs.store")}
            </Button>
          )}
          <Button
            type="button"
            variant={view === "publishing" ? "secondary" : "ghost"}
            size="sm"
            aria-pressed={view === "publishing"}
            onClick={() => setView("publishing")}
          >
            <UploadIcon data-icon="inline-start" />
            {t("marketplace.tabs.publishing")}
          </Button>
        </>
      }
      afterHeader={
        view !== "publishing" && error ? <Feedback error={error} /> : null
      }
    >
      {view === "store" && <MarketplaceCatalogPanel onFeedback={feedback} />}
      {view === "publishing" && (
        <MyPublicationsPanel onFeedback={feedback} error={error} />
      )}
    </PageLayout>
  )
}

function ReviewDialog({
  publication,
  onOpenChange,
  onCompleted,
}: {
  publication: MarketplacePublication | null
  onOpenChange: (open: boolean) => void
  onCompleted: (message: string) => Promise<void>
}) {
  const { t } = useTranslation()
  const [decision, setDecision] = useState<"approved" | "rejected">("approved")
  const [comment, setComment] = useState("")
  const [error, setError] = useState<string | null>(null)
  const reviewDecisionItems = [
    { label: t("marketplace.approve"), value: "approved" },
    { label: t("marketplace.reject"), value: "rejected" },
  ]
  const releaseId = publication?.latest_release.id
  const detail = useQuery({
    queryKey: ["admin", "marketplace", "release", releaseId],
    queryFn: () =>
      apiRequest(`/admin/marketplace/releases/${releaseId}`, {
        schema: marketplaceReviewDetailSchema,
      }),
    enabled: releaseId !== undefined,
  })
  const reviewMutation = useMutation({
    mutationFn: () =>
      apiRequest(`/admin/marketplace/releases/${releaseId}/review`, {
        method: "PATCH",
        body: {
          decision,
          review_comment: comment.trim() || null,
        },
        schema: marketplacePublicationSchema,
      }),
    onSuccess: async () => {
      await onCompleted(
        t(
          decision === "approved"
            ? "marketplace.reviewApproved"
            : "marketplace.reviewRejected"
        )
      )
      setDecision("approved")
      setComment("")
      setError(null)
      onOpenChange(false)
    },
    onError: (nextError) => setError(getErrorMessage(nextError, t)),
  })

  return (
    <Dialog
      open={publication !== null}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) {
          setDecision("approved")
          setComment("")
          setError(null)
        }
        onOpenChange(nextOpen)
      }}
    >
      <DialogContent closeLabel={t("common.close")} className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>
            {t("marketplace.reviewRelease", {
              name: publication?.latest_release.name ?? "",
            })}
          </DialogTitle>
          <DialogDescription>
            {t("marketplace.reviewDescription")}
          </DialogDescription>
        </DialogHeader>
        {error && <StatusBanner variant="error">{error}</StatusBanner>}
        {detail.isLoading && <LoadingState />}
        {detail.isError && (
          <ErrorState
            message={getErrorMessage(detail.error, t)}
            onRetry={() => void detail.refetch()}
          />
        )}
        {detail.data && (
          <div className="max-h-[55vh] space-y-5 overflow-y-auto pr-1">
            <div className="flex flex-wrap gap-2">
              <CapabilityTypeBadge type={detail.data.listing.type} />
              <Badge variant="outline">
                {t("marketplace.byPublisher", {
                  publisher: detail.data.listing.publisher_name,
                })}
              </Badge>
              <Badge variant="outline">
                {t("marketplace.releaseNumber", {
                  number: detail.data.release.release_number,
                })}
              </Badge>
            </div>
            <section>
              <h3 className="mb-2 font-medium">
                {t("marketplace.packageFiles")}
              </h3>
              <ul className="rounded-xl border p-3 font-mono text-xs">
                {detail.data.files.map((file) => (
                  <li key={file} className="py-1 break-all">
                    {file}
                  </li>
                ))}
              </ul>
            </section>
            <section>
              <h3 className="mb-2 font-medium">
                {t("marketplace.riskSummary")}
              </h3>
              <CapabilityRiskSummary value={detail.data.release.risk_summary} />
            </section>
            <section>
              <h3 className="mb-2 font-medium">{t("marketplace.manifest")}</h3>
              <ManifestEvidence value={detail.data.release.manifest} />
            </section>
            {detail.data.skill_content !== null && (
              <section>
                <h3 className="mb-2 font-medium">
                  {t("marketplace.skillPreview")}
                </h3>
                <SkillContentPreview
                  type="skill"
                  content={detail.data.skill_content}
                  truncated={false}
                />
              </section>
            )}
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
              <dt className="text-muted-foreground">
                {t("marketplace.contentHash")}
              </dt>
              <dd className="font-mono text-xs break-all">
                {detail.data.release.content_sha256}
              </dd>
              <dt className="text-muted-foreground">
                {t("marketplace.releaseNotes")}
              </dt>
              <dd className="whitespace-pre-wrap">
                {detail.data.release.release_notes ||
                  t("marketplace.noReleaseNotes")}
              </dd>
            </dl>
          </div>
        )}
        <div className="grid items-start gap-4 sm:grid-cols-2">
          <FieldShell
            id="marketplace-review-decision"
            label={t("marketplace.reviewDecision")}
          >
            <Select
              items={reviewDecisionItems}
              value={decision}
              onValueChange={(value) =>
                setDecision(value as "approved" | "rejected")
              }
            >
              <SelectTrigger
                id="marketplace-review-decision"
                className="w-full"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {reviewDecisionItems.map((item) => (
                    <SelectItem key={item.value} value={item.value}>
                      {item.label}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </FieldShell>
          <FieldShell
            id="marketplace-review-comment"
            label={t("marketplace.reviewComment")}
            hint={
              decision === "rejected"
                ? t("marketplace.rejectionCommentRequired")
                : t("marketplace.approvalCommentOptional")
            }
          >
            <Textarea
              id="marketplace-review-comment"
              value={comment}
              maxLength={4_000}
              onChange={(event) => setComment(event.target.value)}
            />
          </FieldShell>
        </div>
        <DialogFooter>
          <DialogClose render={<Button type="button" variant="ghost" />}>
            {t("common.cancel")}
          </DialogClose>
          <Button
            type="button"
            variant={decision === "rejected" ? "destructive" : "default"}
            disabled={
              !detail.data ||
              reviewMutation.isPending ||
              (decision === "rejected" && comment.trim().length === 0)
            }
            onClick={() => reviewMutation.mutate()}
          >
            <ShieldCheckIcon data-icon="inline-start" />
            {t("marketplace.submitReview")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function GovernanceDialog({
  publication,
  onOpenChange,
  onCompleted,
}: {
  publication: MarketplacePublication | null
  onOpenChange: (open: boolean) => void
  onCompleted: (message: string) => Promise<void>
}) {
  const { t } = useTranslation()
  const suspended = publication?.listing.status === "suspended"
  const [reason, setReason] = useState("")
  const [error, setError] = useState<string | null>(null)
  const mutation = useMutation({
    mutationFn: () =>
      apiRequest(`/admin/marketplace/${publication?.listing.id}/status`, {
        method: "PATCH",
        body: suspended
          ? { action: "resume" }
          : { action: "suspend", reason: reason.trim() },
        schema: marketplaceListingSchema,
      }),
    onSuccess: async () => {
      await onCompleted(
        t(
          suspended
            ? "marketplace.listingResumed"
            : "marketplace.listingSuspended"
        )
      )
      setReason("")
      setError(null)
      onOpenChange(false)
    },
    onError: (nextError) => setError(getErrorMessage(nextError, t)),
  })
  return (
    <Dialog
      open={publication !== null}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) {
          setReason("")
          setError(null)
        }
        onOpenChange(nextOpen)
      }}
    >
      <DialogContent closeLabel={t("common.close")}>
        <DialogHeader>
          <DialogTitle>
            {t(
              suspended
                ? "marketplace.resumeListingTitle"
                : "marketplace.suspendListingTitle",
              { name: publication?.latest_release.name ?? "" }
            )}
          </DialogTitle>
          <DialogDescription>
            {t(
              suspended
                ? "marketplace.resumeListingDescription"
                : "marketplace.suspendListingDescription"
            )}
          </DialogDescription>
        </DialogHeader>
        {error && <StatusBanner variant="error">{error}</StatusBanner>}
        {!suspended && (
          <FieldShell
            id="marketplace-suspension-reason"
            label={t("marketplace.suspensionReason")}
          >
            <Textarea
              id="marketplace-suspension-reason"
              value={reason}
              maxLength={4_000}
              onChange={(event) => setReason(event.target.value)}
            />
          </FieldShell>
        )}
        <DialogFooter>
          <DialogClose render={<Button type="button" variant="ghost" />}>
            {t("common.cancel")}
          </DialogClose>
          <Button
            type="button"
            variant={suspended ? "default" : "destructive"}
            disabled={mutation.isPending || (!suspended && !reason.trim())}
            onClick={() => mutation.mutate()}
          >
            {suspended ? (
              <RefreshCwIcon data-icon="inline-start" />
            ) : (
              <BanIcon data-icon="inline-start" />
            )}
            {t(
              suspended
                ? "marketplace.resumeListing"
                : "marketplace.suspendListing"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function MarketplaceGovernanceItem({
  publication,
  status,
  metadata,
  notice,
  actions,
}: {
  publication: MarketplacePublication
  status:
    | MarketplaceListing["status"]
    | MarketplacePublication["latest_release"]["status"]
  metadata?: ReactNode
  notice?: ReactNode
  actions?: ReactNode
}) {
  const { t } = useTranslation()

  return (
    <article
      className="marketplace-governance-item"
      aria-label={publication.latest_release.name}
    >
      <CapabilityLogo
        type={publication.listing.type}
        logoUrl={publication.latest_release.logo_url}
      />
      <div className="marketplace-governance-copy">
        <div className="marketplace-governance-title-row">
          <h3 className="marketplace-governance-name">
            {publication.latest_release.name}
          </h3>
          <MarketplaceStatusBadge status={status} />
        </div>
        <p className="marketplace-governance-description">
          {publication.latest_release.description ||
            t("marketplace.noDescription")}
        </p>
        <div className="marketplace-governance-meta">
          <span>
            {t("marketplace.byPublisher", {
              publisher: publication.listing.publisher_name,
            })}
          </span>
          <span aria-hidden="true">·</span>
          <span>
            {t(
              publication.listing.type === "plugin"
                ? "capability.plugin"
                : "capability.skill"
            )}
          </span>
          {metadata && (
            <>
              <span aria-hidden="true">·</span>
              {metadata}
            </>
          )}
        </div>
        {notice}
      </div>
      {actions && (
        <div className="marketplace-governance-action">{actions}</div>
      )}
    </article>
  )
}

function GovernanceListingItem({
  publication,
  onStatusChange,
}: {
  publication: MarketplacePublication
  onStatusChange: () => void
}) {
  const { t } = useTranslation()
  const suspended = publication.listing.status === "suspended"

  return (
    <MarketplaceGovernanceItem
      publication={publication}
      status={publication.listing.status}
      metadata={
        <span>
          {t("marketplace.installCount", {
            count: publication.install_count,
          })}
        </span>
      }
      notice={
        publication.listing.suspension_reason ? (
          <p
            className="marketplace-governance-reason"
            title={publication.listing.suspension_reason}
          >
            <BanIcon aria-hidden="true" />
            <span>{publication.listing.suspension_reason}</span>
          </p>
        ) : undefined
      }
      actions={
        publication.current_release ? (
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  className="marketplace-governance-actions"
                  aria-label={t("common.actions")}
                />
              }
            >
              <MoreHorizontalIcon aria-hidden="true" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-max min-w-32">
              <DropdownMenuGroup>
                <DropdownMenuItem
                  className="whitespace-nowrap"
                  variant={suspended ? "default" : "destructive"}
                  onClick={onStatusChange}
                >
                  {suspended ? (
                    <RefreshCwIcon aria-hidden="true" />
                  ) : (
                    <BanIcon aria-hidden="true" />
                  )}
                  {t(
                    suspended
                      ? "marketplace.resumeListing"
                      : "marketplace.suspendListing"
                  )}
                </DropdownMenuItem>
              </DropdownMenuGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : undefined
      }
    />
  )
}

export function AdminCapabilityManagementPage() {
  const { t, i18n } = useTranslation()
  const queryClient = useQueryClient()
  const [tab, setTab] = useState<AdminMarketplaceTab>("reviews")
  const [reviewTarget, setReviewTarget] =
    useState<MarketplacePublication | null>(null)
  const [governanceTarget, setGovernanceTarget] =
    useState<MarketplacePublication | null>(null)
  const [error, setError] = useState<string | null>(null)

  const reviews = useQuery({
    queryKey: ["admin", "marketplace", "reviews"],
    queryFn: () =>
      apiRequest("/admin/marketplace/reviews", {
        schema: marketplacePublicationPageSchema,
      }),
  })
  const listings = useQuery({
    queryKey: ["admin", "marketplace", "listings"],
    queryFn: () =>
      apiRequest("/admin/marketplace/listings", {
        schema: marketplacePublicationPageSchema,
      }),
  })

  const completed = async (message: string) => {
    setError(null)
    notify.success(message, { id: "admin-capability-action-success" })
    await queryClient.invalidateQueries({
      queryKey: ["admin", "marketplace"],
    })
  }

  const queryError = reviews.error ?? listings.error
  return (
    <PageLayout
      title={t("marketplace.adminTitle")}
      description={t("marketplace.adminDescription")}
      afterHeader={
        <Feedback
          error={error ?? (queryError ? getErrorMessage(queryError, t) : null)}
        />
      }
    >
      <Tabs
        value={tab}
        onValueChange={(value) => setTab(value as AdminMarketplaceTab)}
        className="space-y-6"
      >
        <TabsList aria-label={t("marketplace.adminTabsLabel")}>
          <TabsTrigger value="reviews">
            <ShieldCheckIcon data-icon="inline-start" />
            {t("marketplace.tabs.reviews")}
          </TabsTrigger>
          <TabsTrigger value="listings">
            <StoreIcon data-icon="inline-start" />
            {t("marketplace.tabs.listings")}
          </TabsTrigger>
        </TabsList>
        <TabsContent value="reviews">
          {reviews.isLoading ? (
            <LoadingState />
          ) : reviews.data?.items.length ? (
            <div className="marketplace-governance-grid">
              {reviews.data.items.map((publication) => (
                <MarketplaceGovernanceItem
                  key={publication.latest_release.id}
                  publication={publication}
                  status={publication.latest_release.status}
                  metadata={
                    <>
                      <span>
                        {t("marketplace.releaseNumber", {
                          number: publication.latest_release.release_number,
                        })}
                      </span>
                      <span aria-hidden="true">·</span>
                      <span>
                        {t("marketplace.submittedAt", {
                          date: formatDateTime(
                            publication.latest_release.submitted_at,
                            normalizeLanguage(
                              i18n.resolvedLanguage ?? i18n.language
                            ) ?? "zh-CN"
                          ),
                        })}
                      </span>
                    </>
                  }
                  actions={
                    <Button
                      type="button"
                      size="sm"
                      onClick={() => setReviewTarget(publication)}
                    >
                      <ShieldCheckIcon data-icon="inline-start" />
                      {t("marketplace.review")}
                    </Button>
                  }
                />
              ))}
            </div>
          ) : (
            <EmptyState title={t("marketplace.reviewsEmpty")} />
          )}
        </TabsContent>
        <TabsContent value="listings">
          {listings.isLoading ? (
            <LoadingState />
          ) : listings.data?.items.length ? (
            <div className="marketplace-governance-grid">
              {listings.data.items.map((publication) => (
                <GovernanceListingItem
                  key={publication.listing.id}
                  publication={publication}
                  onStatusChange={() => setGovernanceTarget(publication)}
                />
              ))}
            </div>
          ) : (
            <EmptyState title={t("marketplace.listingsEmpty")} />
          )}
        </TabsContent>
      </Tabs>
      <ReviewDialog
        publication={reviewTarget}
        onOpenChange={(open) => {
          if (!open) setReviewTarget(null)
        }}
        onCompleted={completed}
      />
      <GovernanceDialog
        publication={governanceTarget}
        onOpenChange={(open) => {
          if (!open) setGovernanceTarget(null)
        }}
        onCompleted={completed}
      />
    </PageLayout>
  )
}
