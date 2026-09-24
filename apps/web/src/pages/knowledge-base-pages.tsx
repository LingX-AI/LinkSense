import { useDeferredValue, useEffect, useMemo, useState } from "react"
import { dialogBodyStyles } from "@/components/ui/dialog-layout"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  ArchiveIcon,
  ArrowLeftIcon,
  BookOpenIcon,
  CheckIcon,
  ChevronRightIcon,
  CircleAlertIcon,
  CloudCogIcon,
  FileIcon,
  FileCogIcon,
  FolderIcon,
  ListFilterIcon,
  LoaderCircleIcon,
  MoreHorizontalIcon,
  PencilIcon,
  PlusIcon,
  RefreshCcwIcon,
  RotateCcwIcon,
  SearchIcon,
  Share2Icon,
  TagsIcon,
  Trash2Icon,
  UploadIcon,
} from "lucide-react"
import { useTranslation } from "react-i18next"
import { z } from "zod"
import {
  Link,
  NavLink,
  useLocation,
  useNavigate,
  useParams,
  useSearchParams,
} from "react-router-dom"

import { ApiError } from "@/api/client"
import { getErrorMessage } from "@/api/error-message"
import { useAuth } from "@/app/auth-state"
import { ConfirmDialog } from "@/components/feedback/confirm-dialog"
import {
  EmptyState,
  ErrorState,
  LoadingState,
} from "@/components/feedback/page-state"
import { notify } from "@/components/feedback/notification"
import { StatusBanner } from "@/components/feedback/status-banner"
import { FieldShell } from "@/components/forms/form-field"
import { FileTypeIcon } from "@/components/media/file-type-icon"
import { PageLayout } from "@/components/shell/page-layout"
import { ConversationOfficeLayout } from "@/features/conversations/conversation-presentation-layout"
import { Badge } from "@/components/ui/badge"
import { Button, buttonVariants } from "@/components/ui/button"
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbList,
  BreadcrumbPage,
} from "@/components/ui/breadcrumb"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Card,
  CardContent,
  CardDescription,
  CardTitle,
} from "@/components/ui/card"
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
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { FieldGroup } from "@/components/ui/field"
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@/components/ui/input-group"
import {
  Progress,
  ProgressLabel,
  ProgressValue,
} from "@/components/ui/progress"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { Textarea } from "@/components/ui/textarea"
import { Switch } from "@/components/ui/switch"
import { cn } from "@/lib/utils"
import { shouldAutoFocusOnDesktop } from "@/lib/responsive"
import { readUrlEnum, updateUrlSearchParams } from "@/lib/url-search-params"
import { SearchInput } from "@/components/ui/search-input"
import {
  getKnowledgeBaseSource,
  getSharePointSettings,
  knowledgeSourceQueryKeys,
  syncKnowledgeBaseSource,
} from "@/features/admin/knowledge-source-api"
import {
  archiveKnowledgeBase,
  createKnowledgeBase,
  deleteKnowledgeBase,
  deleteKnowledgeDocument,
  getKnowledgeBase,
  knowledgeBaseQueryKeys,
  rebuildKnowledgeDocuments,
  renameKnowledgeDocument,
  revokeKnowledgeGrant,
  restoreKnowledgeBase,
  runKnowledgeDocumentAction,
  updateKnowledgeBase,
  type KnowledgeBaseScope,
} from "@/features/knowledge-bases/knowledge-base-api"
import type {
  KnowledgeBase,
  KnowledgeBaseCreationCapability,
  KnowledgeBaseEntry,
  KnowledgeDocument,
} from "@/features/knowledge-bases/knowledge-base-contracts"
import {
  hasActiveKnowledgeDocumentProcessing,
  useKnowledgeBaseDetail,
  useKnowledgeBaseCreationCapability,
  useKnowledgeBaseEntries,
  useKnowledgeBaseEvents,
  useKnowledgeBaseList,
  useKnowledgeDocument,
  useKnowledgeDocumentContent,
  useKnowledgeDocuments,
  useKnowledgeSearchCapability,
} from "@/features/knowledge-bases/knowledge-base-hooks"
import { KnowledgeMarkdown } from "@/features/knowledge-bases/knowledge-markdown"
import {
  KnowledgeDownloadButton,
  KnowledgeOriginalPreview,
} from "@/features/knowledge-bases/knowledge-original-preview"
import { KnowledgeShareDialog } from "@/features/knowledge-bases/knowledge-share-dialog"
import { KnowledgeSearchStatusBanner } from "@/features/knowledge-bases/knowledge-search-status-banner"
import { KnowledgeCreationReadinessBanner } from "@/features/knowledge-bases/knowledge-creation-readiness-banner"
import { capabilityCenterPath } from "@/features/capabilities/capability-center-navigation"
import { KnowledgeSourceSyncScheduleFields } from "@/features/knowledge-bases/knowledge-source-schedule-fields"
import { KnowledgeSourceSyncStatus } from "@/features/knowledge-bases/knowledge-source-sync-status"
import {
  createDefaultKnowledgeSourceSyncScheduleDraft,
  knowledgeSourceSyncScheduleFromDraft,
} from "@/features/knowledge-bases/knowledge-source-schedule"
import {
  KnowledgeUploadBatchProgress,
  type KnowledgeUploadBatchStatus,
} from "@/features/knowledge-bases/knowledge-upload-batch-progress"
import { KnowledgeUploadDialog } from "@/features/knowledge-bases/knowledge-upload-dialog"
import {
  canCancelKnowledgeDocument,
  formatKnowledgeBytes,
  getKnowledgeBaseAccessLabel,
  getKnowledgeBaseSourceTypeLabel,
  getKnowledgeDocumentStatusLabel,
  getKnowledgeStageLabel,
  getKnowledgeStableErrorLabel,
  isKnowledgeStageIndeterminate,
  isOriginalPreviewUnsupported,
} from "@/features/knowledge-bases/knowledge-base-utils"
import { normalizeLanguage, type SupportedLanguage } from "@/i18n"
import { formatDateTime } from "@/i18n/date"
import { SiteLibrary } from "@/features/web-sites/site-library"
import { TaskArtifactLibrary } from "@/features/task-artifacts/task-artifact-library"
import type { TaskArtifact } from "@/features/task-artifacts/task-artifact-api"
import { TaskArtifactPreview } from "@/features/task-artifacts/task-artifact-preview"

export function KnowledgeBaseListPage() {
  const { t } = useTranslation()
  const [searchParams, setSearchParams] = useSearchParams()
  const [previewFile, setPreviewFile] = useState<TaskArtifact>()
  const requestedTab = searchParams.get("tab")
  const activeTab =
    requestedTab === "artifacts" || requestedTab === "sites"
      ? requestedTab
      : "knowledge"

  return (
    <ConversationOfficeLayout
      resizeLabel={t("library.artifacts.resizePreview")}
      preview={
        activeTab === "artifacts" && previewFile ? (
          <TaskArtifactPreview
            file={previewFile}
            onClose={() => setPreviewFile(undefined)}
          />
        ) : undefined
      }
    >
      <Tabs
        value={activeTab}
        onValueChange={(value) => {
          const next = new URLSearchParams(searchParams)
          if (value === "artifacts" || value === "sites") next.set("tab", value)
          else {
            next.delete("tab")
            setPreviewFile(undefined)
          }
          setSearchParams(next, { replace: true })
        }}
        className="h-full min-h-0 min-w-0 gap-0"
      >
        <div className="shrink-0 pt-4 pr-4 pl-14 sm:pr-6">
          <TabsList aria-label={t("library.tabsLabel")}>
            <TabsTrigger value="knowledge">
              {t("library.tabs.knowledge")}
            </TabsTrigger>
            <TabsTrigger value="artifacts">
              {t("library.tabs.artifacts")}
            </TabsTrigger>
            <TabsTrigger value="sites">{t("webSites.title")}</TabsTrigger>
          </TabsList>
        </div>
        <div className="management-scroll">
          <div className="knowledge-library-page">
            <header className="knowledge-library-header pb-5" role="banner">
              <div>
                <h1>
                  {t(
                    activeTab === "knowledge"
                      ? "knowledge.title"
                      : activeTab === "sites"
                        ? "webSites.title"
                        : "library.artifacts.title"
                  )}
                </h1>
                <p>
                  {t(
                    activeTab === "knowledge"
                      ? "knowledge.description"
                      : activeTab === "sites"
                        ? "webSites.description"
                        : "library.artifacts.description"
                  )}
                </p>
              </div>
            </header>
            <TabsContent value="knowledge">
              {activeTab === "knowledge" ? (
                <KnowledgeBaseLibraryContent />
              ) : null}
            </TabsContent>
            <TabsContent value="sites">
              {activeTab === "sites" ? <SiteLibrary /> : null}
            </TabsContent>
            <TabsContent value="artifacts">
              {activeTab === "artifacts" ? (
                <TaskArtifactLibrary onPreview={setPreviewFile} />
              ) : null}
            </TabsContent>
          </div>
        </div>
      </Tabs>
    </ConversationOfficeLayout>
  )
}

function KnowledgeBaseLibraryContent() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const filter = readUrlEnum<
    "all" | "active" | "archived" | "owned" | "shared"
  >(
    searchParams,
    "kb_filter",
    ["all", "active", "archived", "owned", "shared"],
    "all"
  )
  const lifecycle =
    filter === "active" || filter === "archived" ? filter : "all"
  const scope: KnowledgeBaseScope =
    filter === "owned" || filter === "shared" ? filter : "all"
  const search = searchParams.get("kb_search") ?? ""
  const updateLibraryParams = (
    updates: Readonly<Record<string, string | null>>
  ) => {
    setSearchParams((current) => updateUrlSearchParams(current, updates), {
      replace: true,
    })
  }
  const [createOpen, setCreateOpen] = useState(false)
  const deferredSearch = useDeferredValue(search.trim())
  const query = useKnowledgeBaseList({
    lifecycle,
    scope,
    search: deferredSearch,
  })
  const searchCapability = useKnowledgeSearchCapability()
  const creationCapability = useKnowledgeBaseCreationCapability()
  const creationReady =
    creationCapability.capability?.status === "ready" &&
    !creationCapability.isFetching &&
    !creationCapability.requestFailed
  const items = useMemo(
    () => query.data?.pages.flatMap((page) => page.items) ?? [],
    [query.data]
  )
  const filterItems = [
    { value: "all" as const, label: t("knowledge.filter.all") },
    {
      value: "active" as const,
      label: t("knowledge.lifecycle.current"),
    },
    {
      value: "archived" as const,
      label: t("knowledge.lifecycle.archived"),
    },
    { value: "owned" as const, label: t("knowledge.scope.owned") },
    { value: "shared" as const, label: t("knowledge.scope.shared") },
  ]

  const content = (
    <KnowledgeBaseListContent
      items={items}
      loading={query.isLoading}
      error={query.error}
      hasNextPage={query.hasNextPage}
      fetchingNextPage={query.isFetchingNextPage}
      onRetry={() => void query.refetch()}
      onLoadMore={() => void query.fetchNextPage()}
    />
  )

  return (
    <>
      <section aria-label={t("knowledge.title")}>
        <KnowledgeCreationReadinessBanner
          capability={creationCapability.capability}
          checking={creationCapability.isFetching}
          requestFailed={creationCapability.requestFailed}
          onRetry={() => void creationCapability.retry()}
          className="mb-3"
        />

        <KnowledgeSearchStatusBanner
          capability={searchCapability.capability}
          className="mb-3"
        />

        <div className="knowledge-library-toolbar">
          <InputGroup className="knowledge-library-search">
            <InputGroupAddon>
              <SearchIcon aria-hidden="true" />
            </InputGroupAddon>
            <SearchInput
              value={search}
              onValueChange={(value) =>
                updateLibraryParams({ kb_search: value })
              }
              placeholder={t("knowledge.searchPlaceholder")}
              aria-label={t("knowledge.searchPlaceholder")}
            />
          </InputGroup>
          <div className="knowledge-library-filters">
            <Select
              items={filterItems}
              value={filter}
              onValueChange={(value) => {
                if (
                  value === "all" ||
                  value === "active" ||
                  value === "archived" ||
                  value === "owned" ||
                  value === "shared"
                ) {
                  updateLibraryParams({
                    kb_filter: value === "all" ? null : value,
                  })
                }
              }}
            >
              <SelectTrigger
                className="knowledge-library-filter"
                aria-label={t("knowledge.filter.label")}
              >
                <ListFilterIcon aria-hidden="true" />
                <SelectValue />
              </SelectTrigger>
              <SelectContent align="start" alignItemWithTrigger={false}>
                <SelectGroup>
                  {filterItems.map((item) => (
                    <SelectItem key={item.value} value={item.value}>
                      {item.label}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </div>
          <Button
            type="button"
            disabled={!creationReady}
            onClick={() => setCreateOpen(true)}
          >
            <PlusIcon data-icon="inline-start" aria-hidden="true" />
            {t("knowledge.create.action")}
          </Button>
        </div>

        {content}
      </section>
      <CreateKnowledgeBaseDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        creationCapability={creationCapability.capability}
        creationCapabilityChecking={creationCapability.isFetching}
        creationCapabilityRequestFailed={creationCapability.requestFailed}
        onRetryCreationCapability={() => void creationCapability.retry()}
        onCreated={(knowledgeBase) =>
          navigate(`/knowledge-bases/${knowledgeBase.id}`)
        }
      />
    </>
  )
}

function KnowledgeBaseListContent({
  items,
  loading,
  error,
  hasNextPage,
  fetchingNextPage,
  onRetry,
  onLoadMore,
}: {
  items: KnowledgeBase[]
  loading: boolean
  error: unknown
  hasNextPage: boolean
  fetchingNextPage: boolean
  onRetry: () => void
  onLoadMore: () => void
}) {
  const { t } = useTranslation()
  if (loading) return <LoadingState />
  if (error) {
    return <ErrorState message={getErrorMessage(error, t)} onRetry={onRetry} />
  }
  if (items.length === 0) {
    return <EmptyState title={t("knowledge.empty")} />
  }
  return (
    <section
      className="knowledge-card-list rounded-card"
      aria-label={t("knowledge.title")}
    >
      {items.map((knowledgeBase) => (
        <KnowledgeBaseCard
          key={knowledgeBase.id}
          knowledgeBase={knowledgeBase}
        />
      ))}
      {hasNextPage && (
        <div className="knowledge-load-more">
          <Button
            type="button"
            variant="ghost"
            disabled={fetchingNextPage}
            onClick={onLoadMore}
          >
            {fetchingNextPage && (
              <LoaderCircleIcon data-icon="inline-start" aria-hidden="true" />
            )}
            {t("knowledge.loadMore")}
          </Button>
        </div>
      )}
    </section>
  )
}

function KnowledgeBaseCard({
  knowledgeBase,
}: {
  knowledgeBase: KnowledgeBase
}) {
  const { t, i18n } = useTranslation()
  const locale = normalizeLanguage(i18n.resolvedLanguage) ?? "zh-CN"
  const unavailable = knowledgeBase.availability_status === "disabled"
  const description = knowledgeBase.description || t("knowledge.noDescription")
  const sourceTypeLabel = getKnowledgeBaseSourceTypeLabel(knowledgeBase, t)
  return (
    <NavLink
      to={`/knowledge-bases/${knowledgeBase.id}`}
      className="knowledge-card-link"
      aria-label={knowledgeBase.name}
    >
      <Card size="sm" className="knowledge-card rounded-none border-0">
        <CardContent className="knowledge-card-row">
          <KnowledgeBaseCardIcon />
          <div className="knowledge-card-main">
            <div className="knowledge-card-heading">
              <CardTitle
                className="knowledge-card-title min-w-0"
                title={knowledgeBase.name}
              >
                <span className="truncate">{knowledgeBase.name}</span>
              </CardTitle>
              <div className="knowledge-card-badges">
                {knowledgeBase.lifecycle_status === "archived" && (
                  <Badge variant="outline">
                    {t("knowledge.lifecycle.archived")}
                  </Badge>
                )}
                {unavailable && (
                  <Badge variant="destructive">{t("knowledge.disabled")}</Badge>
                )}
                {!knowledgeBase.is_owner && (
                  <Badge variant="secondary">
                    {getKnowledgeBaseAccessLabel(knowledgeBase, t)}
                  </Badge>
                )}
              </div>
            </div>
            <div className="knowledge-card-metadata">
              <CardDescription
                className="knowledge-card-description truncate"
                title={description}
              >
                {description}
              </CardDescription>
              <span>
                {t("knowledge.documentCount", {
                  count: knowledgeBase.document_count,
                })}
              </span>
              <span>
                {t("knowledge.readyCount", {
                  count: knowledgeBase.ready_document_count,
                })}
              </span>
              <span>
                {formatKnowledgeBytes(knowledgeBase.storage_used_bytes, locale)}{" "}
                /{" "}
                {formatKnowledgeBytes(
                  knowledgeBase.storage_quota_bytes,
                  locale
                )}
              </span>
              <span>
                {t(
                  knowledgeBase.is_owner
                    ? "knowledge.ownerNamedSelf"
                    : "knowledge.ownerNamed",
                  {
                    name: knowledgeBase.owner.name,
                  }
                )}
              </span>
              <span className="knowledge-card-source-text text-muted-foreground">
                {t("knowledge.sourceType.label", { source: sourceTypeLabel })}
              </span>
              <time
                dateTime={knowledgeBase.updated_at}
                className="knowledge-card-updated-at text-muted-foreground"
              >
                {t("knowledge.updated", {
                  date: formatDateTime(knowledgeBase.updated_at, locale),
                })}
              </time>
            </div>
          </div>
          <ChevronRightIcon
            className="knowledge-card-chevron"
            aria-hidden="true"
          />
        </CardContent>
      </Card>
    </NavLink>
  )
}

function KnowledgeBaseCardIcon() {
  return (
    <span
      className="knowledge-card-icon"
      data-slot="knowledge-base-icon"
      aria-hidden="true"
    >
      <BookOpenIcon />
    </span>
  )
}

function CreateKnowledgeBaseDialog({
  open,
  onOpenChange,
  creationCapability,
  creationCapabilityChecking,
  creationCapabilityRequestFailed,
  onRetryCreationCapability,
  onCreated,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  creationCapability: KnowledgeBaseCreationCapability | undefined
  creationCapabilityChecking: boolean
  creationCapabilityRequestFailed: boolean
  onRetryCreationCapability: () => void
  onCreated: (knowledgeBase: KnowledgeBase) => void
}) {
  const { t } = useTranslation()
  const { user } = useAuth()
  const queryClient = useQueryClient()
  const [name, setName] = useState("")
  const [description, setDescription] = useState("")
  const [sourceType, setSourceType] = useState<"local" | "sharepoint">("local")
  const [sharePointUrl, setSharePointUrl] = useState("")
  const [syncSchedule, setSyncSchedule] = useState(
    createDefaultKnowledgeSourceSyncScheduleDraft
  )
  const [error, setError] = useState<string>()
  const isAdmin = user?.role === "admin" && user.status === "active"
  const creationReady =
    creationCapability?.status === "ready" &&
    !creationCapabilityChecking &&
    !creationCapabilityRequestFailed
  const sourceSettings = useQuery({
    queryKey: knowledgeSourceQueryKeys.sharePointSettings,
    queryFn: ({ signal }) => getSharePointSettings(signal),
    enabled: open && isAdmin,
  })
  const mutation = useMutation({
    mutationFn: () =>
      createKnowledgeBase(
        sourceType === "sharepoint"
          ? {
              name: name.trim(),
              description: description.trim() || undefined,
              source_type: "sharepoint",
              sharepoint_folder_url: sharePointUrl.trim(),
              sync_schedule: knowledgeSourceSyncScheduleFromDraft(syncSchedule),
            }
          : {
              name: name.trim(),
              description: description.trim() || undefined,
              source_type: "local",
            }
      ),
    onMutate: () => setError(undefined),
    onSuccess: async (knowledgeBase) => {
      await queryClient.invalidateQueries({
        queryKey: knowledgeBaseQueryKeys.all,
      })
      setName("")
      setDescription("")
      setSourceType("local")
      setSharePointUrl("")
      setSyncSchedule(createDefaultKnowledgeSourceSyncScheduleDraft())
      onOpenChange(false)
      onCreated(knowledgeBase)
    },
    onError: (mutationError) => setError(getErrorMessage(mutationError, t)),
  })
  const nameError =
    open && name.length > 0 && !name.trim()
      ? t("knowledge.create.nameRequired")
      : undefined
  const sourceTypeItems = [
    {
      value: "local" as const,
      label: t("knowledge.create.sourceLocal"),
      description: t("knowledge.create.sourceLocalDescription"),
      icon: UploadIcon,
      disabled: false,
    },
    {
      value: "sharepoint" as const,
      label: t("knowledge.create.sourceSharePoint"),
      description: t("knowledge.create.sourceSharePointDescription"),
      icon: CloudCogIcon,
      disabled: !sourceSettings.data?.enabled,
    },
  ]
  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        onOpenChange(nextOpen)
        if (!nextOpen) setError(undefined)
      }}
    >
      <DialogContent closeLabel={t("common.close")} className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{t("knowledge.create.title")}</DialogTitle>
          <DialogDescription>
            {t("knowledge.create.description")}
          </DialogDescription>
        </DialogHeader>
        {!creationReady && (
          <KnowledgeCreationReadinessBanner
            capability={creationCapability}
            checking={creationCapabilityChecking}
            requestFailed={creationCapabilityRequestFailed}
            onRetry={onRetryCreationCapability}
          />
        )}
        {error && <StatusBanner variant="error">{error}</StatusBanner>}
        <FieldGroup>
          {isAdmin && (
            <FieldShell
              id="knowledge-base-source-type"
              label={t("knowledge.create.sourceType")}
            >
              <ToggleGroup
                id="knowledge-base-source-type"
                value={[sourceType]}
                onValueChange={(values) => {
                  const value = values[0]
                  if (value === "local" || value === "sharepoint") {
                    setSourceType(value)
                  }
                }}
                variant="outline"
                aria-label={t("knowledge.create.sourceType")}
                className="grid w-full grid-cols-1 gap-3 sm:grid-cols-2"
              >
                {sourceTypeItems.map((item) => {
                  const SourceIcon = item.icon
                  return (
                    <ToggleGroupItem
                      key={item.value}
                      value={item.value}
                      disabled={item.disabled}
                      className="group/source relative h-auto min-h-24 w-full items-start justify-start gap-3 rounded-card border-input bg-card p-4 text-left whitespace-normal shadow-none transition-[border-color,background-color] hover:border-foreground/20 hover:bg-hover disabled:bg-muted/20 data-pressed:border-foreground/30 data-pressed:bg-muted/60"
                    >
                      <span className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-xl border border-border bg-muted/50 text-muted-foreground transition-colors group-data-[pressed]/source:border-foreground/15 group-data-[pressed]/source:bg-background group-data-[pressed]/source:text-foreground">
                        <SourceIcon className="size-4" aria-hidden="true" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex flex-wrap items-center gap-2">
                          <span className="text-sm font-medium text-foreground">
                            {item.label}
                          </span>
                          {item.disabled && sourceSettings.data && (
                            <Badge variant="secondary">
                              {t("knowledge.create.sourceUnavailable")}
                            </Badge>
                          )}
                        </span>
                        <span className="mt-1 block text-xs leading-5 font-normal text-muted-foreground">
                          {item.description}
                        </span>
                      </span>
                      <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full border border-border bg-background text-background transition-colors group-data-[pressed]/source:border-foreground group-data-[pressed]/source:bg-foreground">
                        <CheckIcon
                          className="size-3 opacity-0 transition-opacity group-data-[pressed]/source:opacity-100"
                          aria-hidden="true"
                        />
                      </span>
                    </ToggleGroupItem>
                  )
                })}
              </ToggleGroup>
            </FieldShell>
          )}
          <FieldShell
            id="knowledge-base-name"
            label={t("knowledge.create.name")}
            error={nameError}
          >
            <InputGroup>
              <InputGroupInput
                id="knowledge-base-name"
                value={name}
                maxLength={160}
                autoFocus={shouldAutoFocusOnDesktop()}
                aria-invalid={nameError ? true : undefined}
                onChange={(event) => setName(event.currentTarget.value)}
              />
            </InputGroup>
          </FieldShell>
          {sourceType === "sharepoint" && (
            <>
              {!sourceSettings.data?.enabled && (
                <StatusBanner variant="warning">
                  {t("knowledge.create.sharePointNotConfigured")}
                </StatusBanner>
              )}
              <FieldShell
                id="knowledge-base-sharepoint-url"
                label={t("knowledge.create.sharePointUrl")}
                hint={t("knowledge.create.sharePointUrlHint")}
              >
                <InputGroup>
                  <InputGroupInput
                    id="knowledge-base-sharepoint-url"
                    type="url"
                    value={sharePointUrl}
                    placeholder={t("knowledge.create.sharePointUrlPlaceholder")}
                    onChange={(event) =>
                      setSharePointUrl(event.currentTarget.value)
                    }
                  />
                </InputGroup>
              </FieldShell>
              <KnowledgeSourceSyncScheduleFields
                value={syncSchedule}
                onValueChange={setSyncSchedule}
              />
            </>
          )}
          <FieldShell
            id="knowledge-base-description"
            label={t("knowledge.create.optionalDescription")}
          >
            <Textarea
              id="knowledge-base-description"
              value={description}
              maxLength={4000}
              onChange={(event) => setDescription(event.currentTarget.value)}
            />
          </FieldShell>
        </FieldGroup>
        <DialogFooter>
          <DialogClose render={<Button type="button" variant="ghost" />}>
            {t("common.cancel")}
          </DialogClose>
          <Button
            type="button"
            disabled={
              !creationReady ||
              !name.trim() ||
              mutation.isPending ||
              (sourceType === "sharepoint" &&
                (!sharePointUrl.trim() || !sourceSettings.data?.enabled))
            }
            onClick={() => mutation.mutate()}
          >
            {mutation.isPending && (
              <LoaderCircleIcon data-icon="inline-start" aria-hidden="true" />
            )}
            {t("common.create")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function EditKnowledgeBaseDialog({
  open,
  onOpenChange,
  knowledgeBase,
  onUpdated,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  knowledgeBase: KnowledgeBase
  onUpdated: () => void | Promise<void>
}) {
  const { t } = useTranslation()
  const [name, setName] = useState(knowledgeBase.name)
  const [description, setDescription] = useState(
    knowledgeBase.description ?? ""
  )
  const [error, setError] = useState<string>()
  const mutation = useMutation({
    mutationFn: () =>
      updateKnowledgeBase(knowledgeBase.id, {
        name: name.trim(),
        description: description.trim() || null,
      }),
    onMutate: () => setError(undefined),
    onSuccess: async () => {
      await onUpdated()
      onOpenChange(false)
    },
    onError: (mutationError) => setError(getErrorMessage(mutationError, t)),
  })

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        onOpenChange(nextOpen)
        if (nextOpen) {
          setName(knowledgeBase.name)
          setDescription(knowledgeBase.description ?? "")
        } else {
          setError(undefined)
        }
      }}
    >
      <DialogContent closeLabel={t("common.close")}>
        <DialogHeader>
          <DialogTitle>{t("knowledge.edit.title")}</DialogTitle>
          <DialogDescription>
            {t("knowledge.edit.description")}
          </DialogDescription>
        </DialogHeader>
        {error && <StatusBanner variant="error">{error}</StatusBanner>}
        <FieldGroup>
          <FieldShell
            id="knowledge-base-edit-name"
            label={t("knowledge.create.name")}
          >
            <InputGroup>
              <InputGroupInput
                id="knowledge-base-edit-name"
                value={name}
                maxLength={160}
                autoFocus={shouldAutoFocusOnDesktop()}
                onChange={(event) => setName(event.currentTarget.value)}
              />
            </InputGroup>
          </FieldShell>
          <FieldShell
            id="knowledge-base-edit-description"
            label={t("knowledge.create.optionalDescription")}
          >
            <Textarea
              id="knowledge-base-edit-description"
              value={description}
              maxLength={4000}
              onChange={(event) => setDescription(event.currentTarget.value)}
            />
          </FieldShell>
        </FieldGroup>
        <DialogFooter>
          <DialogClose render={<Button type="button" variant="ghost" />}>
            {t("common.cancel")}
          </DialogClose>
          <Button
            type="button"
            disabled={!name.trim() || mutation.isPending}
            onClick={() => mutation.mutate()}
          >
            {mutation.isPending && (
              <LoaderCircleIcon data-icon="inline-start" aria-hidden="true" />
            )}
            {t("common.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

type KnowledgeConfirmAction =
  | { type: "archive" }
  | { type: "restore" }
  | { type: "delete_base" }
  | { type: "delete_document"; document: KnowledgeDocument }
  | { type: "reprocess"; document: KnowledgeDocument }
  | { type: "rebuild"; document: KnowledgeDocument }
  | { type: "rebuild_selected"; documentIds: string[] }
  | { type: "rebuild_all" }
  | {
      type: "remove_direct_share"
      grantId: string
      remainingAccess: boolean
    }

const knowledgeBaseDeletionUsageSchema = z.strictObject({
  type: z.literal("application"),
  resource_id: z.uuid(),
  name: z.string().min(1),
  status: z.enum(["active", "disabled"]),
})

type KnowledgeBaseDeletionUsage = z.infer<
  typeof knowledgeBaseDeletionUsageSchema
>

type KnowledgeBaseDeletionBlock = {
  message: string
  usages: KnowledgeBaseDeletionUsage[]
}

function getKnowledgeBaseDeletionUsages(error: unknown) {
  if (
    !(error instanceof ApiError) ||
    error.errorCode !== "KNOWLEDGE_BASE_IN_USE"
  ) {
    return null
  }
  const parsed = z
    .array(knowledgeBaseDeletionUsageSchema)
    .safeParse(error.params?.usages)
  return parsed.success && parsed.data.length > 0 ? parsed.data : null
}

function sortExpandedKnowledgeEntries(
  entries: KnowledgeBaseEntry[],
  locale: SupportedLanguage
): KnowledgeBaseEntry[] {
  const collator = new Intl.Collator(locale, {
    numeric: true,
    sensitivity: "base",
  })
  const pathFor = (entry: KnowledgeBaseEntry) => entry.path ?? [entry.name]
  return [...entries].sort((left, right) => {
    const leftPath = pathFor(left)
    const rightPath = pathFor(right)
    const sharedLength = Math.min(leftPath.length, rightPath.length)
    for (let index = 0; index < sharedLength; index += 1) {
      const leftSegment = leftPath[index]
      const rightSegment = rightPath[index]
      if (leftSegment === rightSegment) continue
      const leftType =
        index === leftPath.length - 1 ? left.entry_type : "folder"
      const rightType =
        index === rightPath.length - 1 ? right.entry_type : "folder"
      if (leftType !== rightType) return leftType === "folder" ? -1 : 1
      return collator.compare(leftSegment ?? "", rightSegment ?? "")
    }
    if (leftPath.length !== rightPath.length) {
      return leftPath.length - rightPath.length
    }
    if (left.entry_type !== right.entry_type) {
      return left.entry_type === "folder" ? -1 : 1
    }
    return left.id.localeCompare(right.id)
  })
}

function filterCollapsedKnowledgeEntries(
  entries: KnowledgeBaseEntry[],
  collapsedFolderIds: ReadonlySet<string>
): KnowledgeBaseEntry[] {
  if (collapsedFolderIds.size === 0) return entries

  const entriesById = new Map(entries.map((entry) => [entry.id, entry]))
  const collapsedFolderPaths = new Set(
    entries.flatMap((entry) =>
      entry.entry_type === "folder" &&
      collapsedFolderIds.has(entry.id) &&
      entry.path
        ? [JSON.stringify(entry.path)]
        : []
    )
  )

  return entries.filter((entry) => {
    const visitedEntryIds = new Set<string>()
    let parentEntryId = entry.parent_entry_id
    while (parentEntryId !== null && !visitedEntryIds.has(parentEntryId)) {
      if (collapsedFolderIds.has(parentEntryId)) return false
      visitedEntryIds.add(parentEntryId)
      parentEntryId = entriesById.get(parentEntryId)?.parent_entry_id ?? null
    }

    if (!entry.path) return true
    for (let pathLength = 1; pathLength < entry.path.length; pathLength += 1) {
      if (
        collapsedFolderPaths.has(
          JSON.stringify(entry.path.slice(0, pathLength))
        )
      ) {
        return false
      }
    }
    return true
  })
}

export function KnowledgeBaseDetailPage() {
  const { knowledgeBaseId } = useParams<{ knowledgeBaseId: string }>()
  return (
    <KnowledgeBaseDetailContent
      key={knowledgeBaseId}
      knowledgeBaseId={knowledgeBaseId}
    />
  )
}

function KnowledgeBaseDetailContent({
  knowledgeBaseId,
}: {
  knowledgeBaseId: string | undefined
}) {
  const { t, i18n } = useTranslation()
  const locale = normalizeLanguage(i18n.resolvedLanguage) ?? "zh-CN"
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const detail = useKnowledgeBaseDetail(knowledgeBaseId)
  const searchCapability = useKnowledgeSearchCapability()
  const enabledForContent =
    detail.data?.availability_status === "enabled" &&
    detail.data.permissions.view_content
  const enabledForEvents = enabledForContent
  const eventConnection = useKnowledgeBaseEvents(
    knowledgeBaseId,
    Boolean(enabledForEvents)
  )
  const documentsQuery = useKnowledgeDocuments(knowledgeBaseId, {
    polling: eventConnection.connectionState === "reconnecting",
    enabled: Boolean(enabledForContent),
  })
  const documents = useMemo(
    () => documentsQuery.data?.pages.flatMap((page) => page.items) ?? [],
    [documentsQuery.data]
  )
  const hasActiveDocumentProcessing = hasActiveKnowledgeDocumentProcessing(
    documentsQuery.data
  )
  const entriesQuery = useKnowledgeBaseEntries(knowledgeBaseId, undefined, {
    enabled: Boolean(enabledForContent),
    view: "flat",
  })
  const entries = useMemo(
    () => entriesQuery.data?.pages.flatMap((page) => page.items) ?? [],
    [entriesQuery.data]
  )
  const [uploadOpen, setUploadOpen] = useState(false)
  const [uploadBatchStatus, setUploadBatchStatus] =
    useState<KnowledgeUploadBatchStatus | null>(null)
  const [shareOpen, setShareOpen] = useState(false)
  const [editOpen, setEditOpen] = useState(false)
  const [renameDocumentTarget, setRenameDocumentTarget] =
    useState<KnowledgeDocument>()
  const [selectedDocumentKeys, setSelectedDocumentKeys] = useState<string[]>([])
  const [confirmAction, setConfirmAction] = useState<KnowledgeConfirmAction>()
  const [actionError, setActionError] = useState<string>()
  const [deletionBlock, setDeletionBlock] =
    useState<KnowledgeBaseDeletionBlock>()
  const sourceQuery = useQuery({
    queryKey: knowledgeSourceQueryKeys.source(knowledgeBaseId ?? ""),
    queryFn: ({ signal }) =>
      getKnowledgeBaseSource(knowledgeBaseId ?? "", signal),
    enabled:
      Boolean(knowledgeBaseId) &&
      detail.data?.source_type === "sharepoint" &&
      detail.data.is_owner,
    refetchInterval: (query) =>
      query.state.data?.sync_status === "syncing" ||
      query.state.data?.sync_status === "pending"
        ? 2_000
        : false,
  })
  const sourceSyncMutation = useMutation({
    mutationFn: () => syncKnowledgeBaseSource(knowledgeBaseId ?? ""),
    onMutate: () => setActionError(undefined),
    onSuccess: async () => {
      notify.success(t("knowledge.source.syncAccepted"), {
        id: "knowledge-source-sync-accepted",
      })
      await sourceQuery.refetch()
    },
    onError: (value) => setActionError(getErrorMessage(value, t)),
  })

  useEffect(() => {
    if (eventConnection.connectionState === "access_lost") {
      navigate("/knowledge-bases", { replace: true })
    }
  }, [eventConnection.connectionState, navigate])

  const invalidate = async () => {
    if (!knowledgeBaseId) return
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: knowledgeBaseQueryKeys.all }),
      queryClient.invalidateQueries({
        queryKey: knowledgeBaseQueryKeys.detail(knowledgeBaseId),
      }),
      queryClient.invalidateQueries({
        queryKey: knowledgeBaseQueryKeys.documents(knowledgeBaseId),
      }),
      queryClient.invalidateQueries({
        queryKey: knowledgeBaseQueryKeys.entries(knowledgeBaseId),
      }),
    ])
  }

  const actionMutation = useMutation({
    mutationFn: async (action: KnowledgeConfirmAction) => {
      if (!knowledgeBaseId) return
      if (action.type === "archive") {
        await archiveKnowledgeBase(knowledgeBaseId)
      } else if (action.type === "restore") {
        await restoreKnowledgeBase(knowledgeBaseId)
      } else if (action.type === "delete_base") {
        await deleteKnowledgeBase(knowledgeBaseId)
      } else if (action.type === "delete_document") {
        await deleteKnowledgeDocument(knowledgeBaseId, action.document.id)
      } else if (action.type === "rebuild_selected") {
        return rebuildKnowledgeDocuments(knowledgeBaseId, action.documentIds)
      } else if (action.type === "rebuild_all") {
        return rebuildKnowledgeDocuments(knowledgeBaseId)
      } else if (action.type === "remove_direct_share") {
        await revokeKnowledgeGrant(knowledgeBaseId, action.grantId)
      } else {
        await runKnowledgeDocumentAction(
          knowledgeBaseId,
          action.document.id,
          action.type
        )
      }
    },
    onMutate: () => {
      setActionError(undefined)
      setDeletionBlock(undefined)
    },
    onSuccess: async (result, action) => {
      setConfirmAction(undefined)
      if (action.type === "delete_base") {
        navigate("/knowledge-bases", { replace: true })
        return
      }
      if (action.type === "remove_direct_share") {
        const refreshed = await getKnowledgeBase(knowledgeBaseId ?? "").catch(
          () => null
        )
        await queryClient.invalidateQueries({
          queryKey: knowledgeBaseQueryKeys.lists(),
        })
        if (!refreshed) {
          navigate("/knowledge-bases", { replace: true })
          return
        }
        queryClient.setQueryData(
          knowledgeBaseQueryKeys.detail(knowledgeBaseId ?? ""),
          refreshed
        )
        notify.success(t("knowledge.share.removeDirectStillAccessible"), {
          id: "knowledge-direct-share-removed",
        })
        return
      }
      if (
        (action.type === "rebuild_selected" || action.type === "rebuild_all") &&
        result
      ) {
        notify.success(t("knowledge.document.rebuildBatchResult", result), {
          id: "knowledge-document-rebuild-accepted",
        })
        setSelectedDocumentKeys([])
      }
      await invalidate()
    },
    onError: (mutationError, action) => {
      setConfirmAction(undefined)
      const message = getErrorMessage(mutationError, t)
      const usages =
        action.type === "delete_base"
          ? getKnowledgeBaseDeletionUsages(mutationError)
          : null
      if (usages) {
        setDeletionBlock({ message, usages })
        return
      }
      setActionError(message)
    },
  })

  const immediateActionMutation = useMutation({
    mutationFn: ({ document }: { document: KnowledgeDocument }) =>
      runKnowledgeDocumentAction(knowledgeBaseId ?? "", document.id, "cancel"),
    onMutate: () => setActionError(undefined),
    onSuccess: invalidate,
    onError: (mutationError) =>
      setActionError(getErrorMessage(mutationError, t)),
  })

  const renameMutation = useMutation({
    mutationFn: ({
      documentId,
      displayName,
    }: {
      documentId: string
      displayName: string
    }) =>
      renameKnowledgeDocument(knowledgeBaseId ?? "", documentId, displayName),
    onMutate: () => setActionError(undefined),
    onSuccess: async () => {
      setRenameDocumentTarget(undefined)
      await invalidate()
    },
    onError: (mutationError) =>
      setActionError(getErrorMessage(mutationError, t)),
  })

  if (detail.isLoading) return <LoadingState />
  if (detail.isError || !detail.data) {
    return (
      <PageLayout title={t("knowledge.title")}>
        <ErrorState
          message={getErrorMessage(detail.error, t)}
          onRetry={() => void detail.refetch()}
        />
      </PageLayout>
    )
  }

  const knowledgeBase = detail.data
  const archived = knowledgeBase.lifecycle_status === "archived"
  const disabled = knowledgeBase.availability_status === "disabled"
  const directShareSource = knowledgeBase.access_sources.find(
    (source) => source.type === "direct" && source.id
  )
  const directShareGrantId = directShareSource?.id
  const hasAccessAfterDirectShareRemoval = knowledgeBase.access_sources.some(
    (source) => source.type !== "direct"
  )
  const hasSearchCapabilityNotice =
    searchCapability.capability?.status === "unavailable"
  const hasDetailNotice =
    hasSearchCapabilityNotice ||
    archived ||
    disabled ||
    (eventConnection.connectionState === "reconnecting" &&
      hasActiveDocumentProcessing &&
      !disabled) ||
    Boolean(actionError) ||
    Boolean(sourceQuery.data) ||
    Boolean(uploadBatchStatus)

  return (
    <PageLayout
      className="knowledge-detail-page"
      title={knowledgeBase.name}
      description={knowledgeBase.description || t("knowledge.noDescription")}
      descriptionAccessory={
        <KnowledgeBaseHeaderMetadata
          knowledgeBase={knowledgeBase}
          locale={locale}
        />
      }
      beforeHeader={
        <Link
          to="/knowledge-bases"
          className={buttonVariants({ variant: "ghost", size: "sm" })}
        >
          <ArrowLeftIcon data-icon="inline-start" aria-hidden="true" />
          {t("knowledge.backToList")}
        </Link>
      }
      actions={
        <KnowledgeBaseActions
          knowledgeBase={knowledgeBase}
          onUpload={() => setUploadOpen(true)}
          onShare={() => setShareOpen(true)}
          onEdit={() => setEditOpen(true)}
          onArchive={() => setConfirmAction({ type: "archive" })}
          onRestore={() => setConfirmAction({ type: "restore" })}
          onDelete={() => setConfirmAction({ type: "delete_base" })}
          onSyncSource={
            knowledgeBase.source_type === "sharepoint" && knowledgeBase.is_owner
              ? () => sourceSyncMutation.mutate()
              : undefined
          }
          sourceSyncPending={sourceSyncMutation.isPending}
          sourceSyncStatus={sourceQuery.data?.sync_status}
          sourceRetryAvailable={sourceQuery.data?.retry_available}
          sourceLoading={sourceQuery.isLoading}
          onRemoveDirectShare={
            knowledgeBase.permissions.remove_direct_share && directShareGrantId
              ? () =>
                  setConfirmAction({
                    type: "remove_direct_share",
                    grantId: directShareGrantId,
                    remainingAccess: hasAccessAfterDirectShareRemoval,
                  })
              : undefined
          }
        />
      }
      afterHeader={
        hasDetailNotice ? (
          <div className="knowledge-detail-notices">
            {uploadBatchStatus && (
              <KnowledgeUploadBatchProgress
                status={uploadBatchStatus}
                onViewDetails={() => setUploadOpen(true)}
              />
            )}
            {hasSearchCapabilityNotice && (
              <KnowledgeSearchStatusBanner
                capability={searchCapability.capability}
              />
            )}
            {archived && (
              <StatusBanner variant="info">
                {t("knowledge.archivedReadOnly")}
              </StatusBanner>
            )}
            {disabled && (
              <StatusBanner variant="error" title={t("knowledge.disabled")}>
                {knowledgeBase.disabled_reason ||
                  t("knowledge.disabledDescription")}
              </StatusBanner>
            )}
            {eventConnection.connectionState === "reconnecting" &&
              hasActiveDocumentProcessing &&
              !disabled && (
                <StatusBanner variant="warning">
                  {t("knowledge.events.reconnecting")}
                </StatusBanner>
              )}
            {actionError && (
              <StatusBanner variant="error">{actionError}</StatusBanner>
            )}
            {sourceQuery.data && (
              <KnowledgeSourceSyncStatus source={sourceQuery.data} />
            )}
          </div>
        ) : undefined
      }
    >
      {!disabled && knowledgeBase.permissions.view_content && (
        <KnowledgeDocumentSection
          knowledgeBase={knowledgeBase}
          entries={entries}
          query={entriesQuery}
          locale={locale}
          pending={
            actionMutation.isPending ||
            immediateActionMutation.isPending ||
            renameMutation.isPending
          }
          selectedDocumentKeys={selectedDocumentKeys}
          onSelectionChange={setSelectedDocumentKeys}
          onCancel={(document) => immediateActionMutation.mutate({ document })}
          onReprocess={(document) =>
            setConfirmAction({ type: "reprocess", document })
          }
          onRebuild={(document) =>
            setConfirmAction({ type: "rebuild", document })
          }
          onDelete={(document) =>
            setConfirmAction({ type: "delete_document", document })
          }
          onRename={setRenameDocumentTarget}
          onRebuildSelected={(documentIds) =>
            setConfirmAction({ type: "rebuild_selected", documentIds })
          }
          onRebuildAll={() => setConfirmAction({ type: "rebuild_all" })}
        />
      )}
      <KnowledgeUploadDialog
        open={uploadOpen}
        onOpenChange={setUploadOpen}
        knowledgeBaseId={knowledgeBase.id}
        documents={documents}
        onUploaded={invalidate}
        onBatchStatusChange={setUploadBatchStatus}
        onLocateDocument={(documentId) => {
          window.document
            .getElementById(`knowledge-document-${documentId}`)
            ?.scrollIntoView({ block: "center" })
        }}
      />
      <EditKnowledgeBaseDialog
        open={editOpen}
        onOpenChange={setEditOpen}
        knowledgeBase={knowledgeBase}
        onUpdated={invalidate}
      />
      <KnowledgeShareDialog
        open={shareOpen}
        onOpenChange={setShareOpen}
        knowledgeBaseId={knowledgeBase.id}
        canCreateGrant={knowledgeBase.permissions.create_grants}
        canRevokeGrant={knowledgeBase.permissions.revoke_grants}
      />
      {renameDocumentTarget && (
        <RenameKnowledgeDocumentDialog
          document={renameDocumentTarget}
          pending={renameMutation.isPending}
          error={renameMutation.isError ? actionError : undefined}
          onOpenChange={(open) => {
            if (!open) setRenameDocumentTarget(undefined)
          }}
          onRename={(displayName) => {
            renameMutation.mutate({
              documentId: renameDocumentTarget.id,
              displayName,
            })
          }}
        />
      )}
      <ConfirmDialog
        open={Boolean(confirmAction)}
        onOpenChange={(open) => {
          if (!open) setConfirmAction(undefined)
        }}
        title={getConfirmTitle(confirmAction, t)}
        description={getConfirmDescription(confirmAction, t)}
        confirmLabel={getConfirmLabel(confirmAction, t)}
        destructive={
          confirmAction?.type === "archive" ||
          confirmAction?.type === "delete_base" ||
          confirmAction?.type === "delete_document" ||
          confirmAction?.type === "remove_direct_share" ||
          confirmAction?.type === "rebuild_selected" ||
          confirmAction?.type === "rebuild_all"
        }
        pending={actionMutation.isPending}
        onConfirm={() => {
          if (confirmAction) actionMutation.mutate(confirmAction)
        }}
      />
      <Dialog
        open={Boolean(deletionBlock)}
        onOpenChange={(open) => {
          if (!open) setDeletionBlock(undefined)
        }}
      >
        <DialogContent closeLabel={t("common.close")} className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{t("knowledge.deleteBlocked.title")}</DialogTitle>
            <DialogDescription>
              {t("knowledge.deleteBlocked.description")}
            </DialogDescription>
          </DialogHeader>
          {deletionBlock && (
            <>
              <StatusBanner variant="error">
                {deletionBlock.message}
              </StatusBanner>
              <section
                className="flex flex-col gap-2"
                aria-labelledby="knowledge-delete-usage-title"
              >
                <h3
                  id="knowledge-delete-usage-title"
                  className="text-sm font-medium"
                >
                  {t("knowledge.deleteBlocked.usagesTitle", {
                    count: deletionBlock.usages.length,
                  })}
                </h3>
                <ul
                  className={dialogBodyStyles("flex max-h-64 flex-col gap-2")}
                >
                  {deletionBlock.usages.map((usage) => (
                    <li
                      key={`${usage.type}:${usage.resource_id}`}
                      className="flex items-center justify-between gap-3 rounded-lg border border-divider px-3 py-2"
                    >
                      <span className="min-w-0 truncate font-medium">
                        {usage.name}
                      </span>
                      <Badge variant="outline" className="shrink-0">
                        {t(
                          usage.status === "active"
                            ? "common.enabled"
                            : "common.disabled"
                        )}
                      </Badge>
                    </li>
                  ))}
                </ul>
              </section>
            </>
          )}
          <DialogFooter>
            <DialogClose render={<Button type="button" variant="ghost" />}>
              {t("common.close")}
            </DialogClose>
            <Button
              type="button"
              onClick={() => {
                setDeletionBlock(undefined)
                navigate(
                  capabilityCenterPath({
                    section: "application",
                    scope: "personal",
                    search: "",
                  })
                )
              }}
            >
              {t("knowledge.deleteBlocked.openApplications")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageLayout>
  )
}

function KnowledgeBaseActions({
  knowledgeBase,
  onUpload,
  onShare,
  onEdit,
  onArchive,
  onRestore,
  onDelete,
  onSyncSource,
  sourceSyncPending,
  sourceSyncStatus,
  sourceRetryAvailable,
  sourceLoading,
  onRemoveDirectShare,
}: {
  knowledgeBase: KnowledgeBase
  onUpload: () => void
  onShare: () => void
  onEdit: () => void
  onArchive: () => void
  onRestore: () => void
  onDelete: () => void
  onSyncSource?: () => void
  sourceSyncPending?: boolean
  sourceSyncStatus?: "pending" | "syncing" | "ready" | "failed"
  sourceRetryAvailable?: boolean
  sourceLoading?: boolean
  onRemoveDirectShare?: () => void
}) {
  const { t } = useTranslation()
  const active = knowledgeBase.lifecycle_status === "active"
  const enabled = knowledgeBase.availability_status === "enabled"
  return (
    <>
      {active &&
        enabled &&
        knowledgeBase.permissions.manage_documents &&
        knowledgeBase.source_type === "local" && (
          <Button type="button" onClick={onUpload}>
            <UploadIcon data-icon="inline-start" aria-hidden="true" />
            {t("knowledge.upload.action")}
          </Button>
        )}
      {active && enabled && onSyncSource && (
        <Button
          type="button"
          variant="outline"
          disabled={
            sourceSyncPending ||
            sourceLoading ||
            sourceSyncStatus === "pending" ||
            sourceSyncStatus === "syncing"
          }
          onClick={onSyncSource}
        >
          <RefreshCcwIcon data-icon="inline-start" aria-hidden="true" />
          {t(
            sourceRetryAvailable
              ? "knowledge.source.retrySync"
              : "knowledge.source.syncNow"
          )}
        </Button>
      )}
      {active && enabled && knowledgeBase.permissions.update && (
        <Button type="button" variant="outline" onClick={onEdit}>
          <PencilIcon data-icon="inline-start" aria-hidden="true" />
          {t("common.edit")}
        </Button>
      )}
      {enabled &&
        (knowledgeBase.permissions.create_grants ||
          knowledgeBase.permissions.revoke_grants) && (
          <Button type="button" variant="outline" onClick={onShare}>
            <Share2Icon data-icon="inline-start" aria-hidden="true" />
            {t("knowledge.share.action")}
          </Button>
        )}
      {knowledgeBase.permissions.archive && (
        <Button type="button" variant="outline" onClick={onArchive}>
          <ArchiveIcon data-icon="inline-start" aria-hidden="true" />
          {t("knowledge.actions.archive")}
        </Button>
      )}
      {knowledgeBase.permissions.restore && (
        <Button type="button" variant="outline" onClick={onRestore}>
          <RotateCcwIcon data-icon="inline-start" aria-hidden="true" />
          {t("knowledge.actions.restore")}
        </Button>
      )}
      {onRemoveDirectShare && (
        <Button type="button" variant="outline" onClick={onRemoveDirectShare}>
          <Share2Icon data-icon="inline-start" aria-hidden="true" />
          {t("knowledge.actions.removeDirectShare")}
        </Button>
      )}
      {knowledgeBase.lifecycle_status === "archived" &&
        knowledgeBase.permissions.delete && (
          <Button type="button" variant="destructive" onClick={onDelete}>
            <Trash2Icon data-icon="inline-start" aria-hidden="true" />
            {t("common.delete")}
          </Button>
        )}
    </>
  )
}

function KnowledgeBaseHeaderMetadata({
  knowledgeBase,
  locale,
}: {
  knowledgeBase: KnowledgeBase
  locale: SupportedLanguage
}) {
  const { t } = useTranslation()
  const [accessDetailsOpen, setAccessDetailsOpen] = useState(false)
  return (
    <>
      <div
        className="knowledge-detail-overview-metadata"
        data-slot="knowledge-detail-overview-metadata"
      >
        <span>
          {t("knowledge.ownerNamed", { name: knowledgeBase.owner.name })}
        </span>
        <span>
          {t("knowledge.documentCount", {
            count: knowledgeBase.document_count,
          })}
        </span>
        <span>
          {t("knowledge.readyCount", {
            count: knowledgeBase.ready_document_count,
          })}
        </span>
        <span>
          {t("knowledge.storage.reserved", {
            size: formatKnowledgeBytes(
              knowledgeBase.storage_reserved_bytes,
              locale
            ),
          })}
        </span>
        {knowledgeBase.access_sources.length > 1 && (
          <Button
            type="button"
            variant="ghost"
            size="xs"
            onClick={() => setAccessDetailsOpen(true)}
          >
            <TagsIcon data-icon="inline-start" aria-hidden="true" />
            {t("knowledge.access.detailsAction")}
          </Button>
        )}
      </div>
      <Dialog open={accessDetailsOpen} onOpenChange={setAccessDetailsOpen}>
        <DialogContent closeLabel={t("common.close")}>
          <DialogHeader>
            <DialogTitle>{t("knowledge.access.detailsTitle")}</DialogTitle>
            <DialogDescription>
              {t("knowledge.access.detailsDescription")}
            </DialogDescription>
          </DialogHeader>
          <ul className="flex flex-col gap-2">
            {knowledgeBase.access_sources.map((source, index) => (
              <li
                key={`${source.type}-${source.id ?? source.name ?? index}`}
                className="flex items-center gap-2 rounded-lg border p-3"
              >
                <Badge variant="secondary">
                  {source.type === "owner"
                    ? t("knowledge.access.owner")
                    : source.type === "direct"
                      ? t("knowledge.access.direct")
                      : t("knowledge.access.group", {
                          name:
                            source.name ?? t("knowledge.access.unknownGroup"),
                        })}
                </Badge>
                <span className="text-sm text-muted-foreground">
                  {source.type === "owner"
                    ? t("knowledge.ownerNamed", {
                        name: knowledgeBase.owner.name,
                      })
                    : source.type === "direct"
                      ? t("knowledge.access.directSource")
                      : t("knowledge.access.groupSource", {
                          name:
                            source.name ?? t("knowledge.access.unknownGroup"),
                        })}
                </span>
              </li>
            ))}
          </ul>
          <DialogFooter>
            <DialogClose render={<Button type="button" variant="outline" />}>
              {t("common.close")}
            </DialogClose>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

function KnowledgeDocumentSection({
  knowledgeBase,
  entries,
  query,
  locale,
  pending,
  selectedDocumentKeys,
  onSelectionChange,
  onCancel,
  onReprocess,
  onRebuild,
  onDelete,
  onRename,
  onRebuildSelected,
  onRebuildAll,
}: {
  knowledgeBase: KnowledgeBase
  entries: KnowledgeBaseEntry[]
  query: ReturnType<typeof useKnowledgeBaseEntries>
  locale: SupportedLanguage
  pending: boolean
  selectedDocumentKeys: string[]
  onSelectionChange: (documentKeys: string[]) => void
  onCancel: (document: KnowledgeDocument) => void
  onReprocess: (document: KnowledgeDocument) => void
  onRebuild: (document: KnowledgeDocument) => void
  onDelete: (document: KnowledgeDocument) => void
  onRename: (document: KnowledgeDocument) => void
  onRebuildSelected: (documentIds: string[]) => void
  onRebuildAll: () => void
}) {
  const { t } = useTranslation()
  const [collapsedFolderIds, setCollapsedFolderIds] = useState<
    ReadonlySet<string>
  >(() => new Set())
  const [showFolders, setShowFolders] = useState(true)
  const sortedEntries = useMemo(
    () => sortExpandedKnowledgeEntries(entries, locale),
    [entries, locale]
  )
  const expandedTreeEntries = useMemo(
    () => filterCollapsedKnowledgeEntries(sortedEntries, collapsedFolderIds),
    [collapsedFolderIds, sortedEntries]
  )
  const displayEntries = useMemo(
    () =>
      showFolders
        ? expandedTreeEntries
        : sortedEntries.filter((entry) => entry.entry_type === "document"),
    [expandedTreeEntries, showFolders, sortedEntries]
  )
  const toggleFolder = (entryId: string) => {
    setCollapsedFolderIds((current) => {
      const next = new Set(current)
      if (next.has(entryId)) {
        next.delete(entryId)
      } else {
        next.add(entryId)
      }
      return next
    })
  }
  const canManage =
    knowledgeBase.lifecycle_status === "active" &&
    knowledgeBase.availability_status === "enabled" &&
    knowledgeBase.permissions.manage_documents
  const documents = displayEntries.flatMap((entry) =>
    entry.entry_type === "document" && entry.document !== null
      ? [entry.document]
      : []
  )
  const selectableDocuments = documents.filter(isSelectableKnowledgeDocument)
  const selectedDocuments = selectableDocuments.filter((document) =>
    selectedDocumentKeys.includes(getKnowledgeDocumentSelectionKey(document))
  )
  const selectedIds = selectedDocuments.map((document) => document.id)
  const allSelected =
    selectableDocuments.length > 0 &&
    selectedIds.length === selectableDocuments.length
  const selectionIndeterminate = selectedIds.length > 0 && !allSelected
  return (
    <section
      className="knowledge-document-section"
      aria-label={t("knowledge.documents")}
    >
      <div className="mb-4 flex min-w-0 flex-wrap items-center justify-between gap-3">
        <KnowledgeDirectoryBreadcrumbs knowledgeBaseName={knowledgeBase.name} />
        <div className="flex shrink-0 items-center gap-2">
          <Label htmlFor="knowledge-show-folders" className="cursor-pointer">
            {t("knowledge.directory.showFolders")}
          </Label>
          <Switch
            id="knowledge-show-folders"
            checked={showFolders}
            onCheckedChange={setShowFolders}
          />
        </div>
      </div>
      {query.isLoading && <LoadingState />}
      {query.isError && (
        <ErrorState
          message={getErrorMessage(query.error, t)}
          onRetry={() => void query.refetch()}
        />
      )}
      {query.data && !query.isError && displayEntries.length === 0 && (
        <EmptyState title={t("knowledge.directory.flatEmpty")} />
      )}
      {!query.isError && displayEntries.length > 0 && (
        <div className="flex flex-col gap-3">
          <div className="knowledge-document-table">
            <Table>
              <TableHeader>
                <TableRow>
                  {canManage && (
                    <TableHead className="w-10">
                      <Checkbox
                        checked={allSelected}
                        indeterminate={selectionIndeterminate}
                        disabled={pending || selectableDocuments.length === 0}
                        aria-label={t("knowledge.document.selectAll")}
                        onCheckedChange={(checked) =>
                          onSelectionChange(
                            checked
                              ? selectableDocuments.map(
                                  getKnowledgeDocumentSelectionKey
                                )
                              : []
                          )
                        }
                      />
                    </TableHead>
                  )}
                  <TableHead>{t("knowledge.document.name")}</TableHead>
                  <TableHead className="knowledge-document-status-column">
                    {t("common.status")}
                  </TableHead>
                  <TableHead>{t("knowledge.document.size")}</TableHead>
                  <TableHead>{t("common.updatedAt")}</TableHead>
                  <TableHead className="knowledge-document-actions-column text-right">
                    {t("common.actions")}
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {displayEntries.map((entry) => {
                  if (entry.entry_type === "folder") {
                    return (
                      <KnowledgeFolderRow
                        key={entry.id}
                        entry={entry}
                        path={entry.path}
                        expanded={!collapsedFolderIds.has(entry.id)}
                        canManage={canManage}
                        locale={locale}
                        onToggle={() => toggleFolder(entry.id)}
                      />
                    )
                  }
                  const document = entry.document
                  if (document === null) return null
                  return (
                    <KnowledgeDocumentRow
                      key={entry.id}
                      knowledgeBase={knowledgeBase}
                      document={document}
                      path={entry.path}
                      indentByPath={showFolders}
                      locale={locale}
                      pending={pending}
                      selected={selectedDocuments.some(
                        (selectedDocument) =>
                          selectedDocument.id === document.id
                      )}
                      onSelectionChange={(selected) =>
                        onSelectionChange(
                          selected
                            ? [
                                ...selectedDocumentKeys,
                                getKnowledgeDocumentSelectionKey(document),
                              ]
                            : selectedDocumentKeys.filter(
                                (key) =>
                                  key !==
                                  getKnowledgeDocumentSelectionKey(document)
                              )
                        )
                      }
                      onCancel={() => onCancel(document)}
                      onReprocess={() => onReprocess(document)}
                      onRebuild={() => onRebuild(document)}
                      onDelete={() => onDelete(document)}
                      onRename={() => onRename(document)}
                    />
                  )
                })}
              </TableBody>
            </Table>
          </div>
          {canManage && selectedIds.length > 0 && (
            <div
              role="toolbar"
              aria-label={t("knowledge.document.selectedCount", {
                count: selectedIds.length,
              })}
              className="knowledge-selection-toolbar fixed bottom-[max(1.5rem,env(safe-area-inset-bottom))] left-1/2 z-40 flex w-fit max-w-[calc(100vw-2rem)] -translate-x-1/2 animate-in items-center gap-1.5 rounded-[var(--radius-xl)] bg-popover/95 p-2 pl-4 shadow-lg ring-1 ring-foreground/10 backdrop-blur-md duration-200 fade-in-0 slide-in-from-bottom-2 md:left-[calc(var(--app-sidebar-width)+(100vw-var(--app-sidebar-width))/2)]"
            >
              <span className="shrink-0 text-sm font-medium text-foreground">
                {t("knowledge.document.selectedCount", {
                  count: selectedIds.length,
                })}
              </span>
              <span
                className="mx-1 h-5 w-px shrink-0 bg-border"
                aria-hidden="true"
              />
              <Button
                type="button"
                size="sm"
                aria-label={t("knowledge.actions.rebuildSelected")}
                disabled={pending}
                onClick={() => onRebuildSelected(selectedIds)}
              >
                <RefreshCcwIcon data-icon="inline-start" aria-hidden="true" />
                <span className="sm:hidden">
                  {t("knowledge.actions.rebuildSelectedShort")}
                </span>
                <span className="hidden sm:inline">
                  {t("knowledge.actions.rebuildSelected")}
                </span>
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                aria-label={t("knowledge.actions.rebuildAll")}
                disabled={pending || knowledgeBase.document_count === 0}
                onClick={onRebuildAll}
              >
                <RefreshCcwIcon data-icon="inline-start" aria-hidden="true" />
                <span className="sm:hidden">
                  {t("knowledge.actions.rebuildAllShort")}
                </span>
                <span className="hidden sm:inline">
                  {t("knowledge.actions.rebuildAll")}
                </span>
              </Button>
            </div>
          )}
        </div>
      )}
      {query.hasNextPage && (
        <div className="knowledge-load-more">
          <Button
            type="button"
            variant="ghost"
            disabled={query.isFetchingNextPage}
            onClick={() => void query.fetchNextPage()}
          >
            {query.isFetchingNextPage && (
              <LoaderCircleIcon data-icon="inline-start" aria-hidden="true" />
            )}
            {t("knowledge.loadMore")}
          </Button>
        </div>
      )}
    </section>
  )
}

function KnowledgeDirectoryBreadcrumbs({
  knowledgeBaseName,
}: {
  knowledgeBaseName: string
}) {
  const { t } = useTranslation()
  return (
    <Breadcrumb aria-label={t("knowledge.directory.breadcrumb")}>
      <BreadcrumbList>
        <BreadcrumbItem>
          <BreadcrumbPage>{knowledgeBaseName}</BreadcrumbPage>
        </BreadcrumbItem>
      </BreadcrumbList>
    </Breadcrumb>
  )
}

function KnowledgeFolderRow({
  entry,
  path,
  expanded,
  canManage,
  locale,
  onToggle,
}: {
  entry: Extract<KnowledgeBaseEntry, { entry_type: "folder" }>
  path?: string[]
  expanded: boolean
  canManage: boolean
  locale: SupportedLanguage
  onToggle: () => void
}) {
  const { t } = useTranslation()
  const displayPath =
    path === undefined
      ? entry.name
      : [...path.slice(0, -1), entry.name].join(" / ")
  const depth = Math.max(0, (path?.length ?? 1) - 1)
  return (
    <TableRow className="has-aria-expanded:bg-transparent">
      {canManage && <TableCell />}
      <TableCell data-label={t("knowledge.document.name")}>
        <Button
          type="button"
          variant="ghost"
          className="h-auto min-w-0 justify-start gap-2 p-0 text-left font-medium hover:bg-transparent hover:underline aria-expanded:bg-transparent"
          aria-label={t(
            expanded
              ? "knowledge.directory.collapseFolder"
              : "knowledge.directory.expandFolder",
            {
              name: displayPath,
            }
          )}
          aria-expanded={expanded}
          onClick={onToggle}
        >
          <span className="flex shrink-0 items-center gap-1.5">
            <KnowledgePathIndent depth={depth} />
            <ChevronRightIcon
              className={cn(
                "size-3.5 shrink-0 text-muted-foreground transition-transform",
                expanded && "rotate-90"
              )}
              data-slot="knowledge-folder-toggle-icon"
              aria-hidden="true"
            />
            <FolderIcon
              className="size-4 shrink-0 text-amber-500"
              data-slot="knowledge-folder-icon"
              aria-hidden="true"
            />
          </span>
          <span className="truncate" title={displayPath}>
            {entry.name}
          </span>
        </Button>
      </TableCell>
      <TableCell
        className="knowledge-document-status-column"
        data-label={t("common.status")}
      >
        <Badge variant="secondary">{t("knowledge.directory.folder")}</Badge>
      </TableCell>
      <TableCell data-label={t("knowledge.document.size")}>—</TableCell>
      <TableCell data-label={t("common.updatedAt")}>
        {formatDateTime(entry.updated_at, locale)}
      </TableCell>
      <TableCell className="knowledge-document-actions-column" />
    </TableRow>
  )
}

function KnowledgeDocumentRow({
  knowledgeBase,
  document,
  path,
  indentByPath,
  locale,
  pending,
  selected,
  onSelectionChange,
  onCancel,
  onReprocess,
  onRebuild,
  onDelete,
  onRename,
}: {
  knowledgeBase: KnowledgeBase
  document: KnowledgeDocument
  path?: string[]
  indentByPath: boolean
  locale: SupportedLanguage
  pending: boolean
  selected: boolean
  onSelectionChange: (selected: boolean) => void
  onCancel: () => void
  onReprocess: () => void
  onRebuild: () => void
  onDelete: () => void
  onRename: () => void
}) {
  const { t } = useTranslation()
  const canManage =
    knowledgeBase.lifecycle_status === "active" &&
    knowledgeBase.availability_status === "enabled" &&
    knowledgeBase.permissions.manage_documents
  const canPreview =
    document.status === "ready" && Boolean(document.current_version_id)
  const actionDisabled = pending || Boolean(document.processing)
  const rebuildable = isRebuildableKnowledgeDocument(document)
  const selectable = isSelectableKnowledgeDocument(document)
  const candidateFailure = document.candidate_failure
  const stableErrorCode =
    candidateFailure?.stable_error_code ??
    document.processing?.stable_error_code
  const hasTerminalFailure =
    document.status === "failed" || Boolean(candidateFailure)
  const retryAt = document.processing?.retry_at
  const retryAttempt = document.processing?.retry_attempt ?? 0
  const displayPath =
    path === undefined
      ? document.display_name
      : [...path.slice(0, -1), document.display_name].join(" / ")
  const depth = indentByPath ? Math.max(0, (path?.length ?? 1) - 1) : 0
  const progressIndeterminate = document.processing
    ? isKnowledgeStageIndeterminate(document.processing.stage)
    : false
  return (
    <TableRow id={`knowledge-document-${document.id}`}>
      {canManage && (
        <TableCell>
          <Checkbox
            checked={selected}
            disabled={pending || !selectable}
            aria-label={t("knowledge.document.selectNamed", {
              name: document.display_name,
            })}
            onCheckedChange={(checked) => onSelectionChange(Boolean(checked))}
          />
        </TableCell>
      )}
      <TableCell data-label={t("knowledge.document.name")}>
        <div className="knowledge-document-name">
          <span className="flex shrink-0 items-center gap-1.5">
            <KnowledgePathIndent depth={depth} />
            <FileTypeIcon
              className="size-6"
              filename={document.display_name}
              mimeType={document.mime_type}
            />
          </span>
          <span className="min-w-0">
            {canPreview ? (
              <NavLink
                to={`/knowledge-bases/${knowledgeBase.id}/documents/${document.id}/preview`}
                className="knowledge-document-file-name knowledge-document-link"
                aria-label={displayPath}
                title={displayPath}
              >
                {document.display_name}
              </NavLink>
            ) : (
              <span
                className="knowledge-document-file-name"
                title={displayPath}
              >
                {document.display_name}
              </span>
            )}
            <span className="knowledge-document-type">
              {document.canonical_extension.toLocaleUpperCase("en-US")}
            </span>
          </span>
        </div>
      </TableCell>
      <TableCell
        className="knowledge-document-status-column"
        data-label={t("common.status")}
      >
        <div className="knowledge-document-status">
          {hasTerminalFailure ? (
            <Tooltip>
              <TooltipTrigger
                render={
                  <span
                    tabIndex={0}
                    className="inline-flex cursor-help items-center gap-1 text-xs font-medium text-destructive outline-none focus-visible:underline"
                    aria-label={t("knowledge.document.failureDetailsNamed", {
                      name: document.display_name,
                    })}
                    data-slot="knowledge-document-failure-trigger"
                  />
                }
              >
                <span>{t("knowledge.document.status.failed")}</span>
                <CircleAlertIcon
                  className="size-3 shrink-0"
                  data-slot="knowledge-document-failure-icon"
                  aria-hidden="true"
                />
              </TooltipTrigger>
              <TooltipContent className="max-w-sm items-start">
                <span className="flex flex-col gap-1">
                  <span>{t("knowledge.document.status.failed")}</span>
                  {candidateFailure && (
                    <span>{t("knowledge.document.candidateFailure")}</span>
                  )}
                  {stableErrorCode && (
                    <span>
                      {getKnowledgeStableErrorLabel(stableErrorCode, t)}
                    </span>
                  )}
                </span>
              </TooltipContent>
            </Tooltip>
          ) : !document.processing ? (
            <Badge
              variant={
                document.status === "ready" && !document.rebuild_required
                  ? "secondary"
                  : "outline"
              }
            >
              {getKnowledgeDocumentStatusLabel(document, t)}
            </Badge>
          ) : null}
          {document.processing && (
            <Progress
              className="knowledge-document-progress"
              value={
                progressIndeterminate
                  ? null
                  : document.processing.progress_percent
              }
            >
              <ProgressLabel>
                {getKnowledgeStageLabel(document.processing.stage, t)}
              </ProgressLabel>
              {!progressIndeterminate && (
                <ProgressValue>
                  {document.processing.progress_percent}%
                </ProgressValue>
              )}
            </Progress>
          )}
          {!hasTerminalFailure && candidateFailure && (
            <span className="text-sm text-destructive">
              {t("knowledge.document.candidateFailure")}
            </span>
          )}
          {!hasTerminalFailure && stableErrorCode && (
            <span className="text-sm text-destructive">
              {getKnowledgeStableErrorLabel(stableErrorCode, t)}
            </span>
          )}
          {retryAt && (
            <span className="knowledge-document-retry-status text-muted-foreground">
              {t(
                retryAttempt === 1
                  ? "knowledge.document.retryWaitingFirst"
                  : retryAttempt === 2
                    ? "knowledge.document.retryWaitingSecond"
                    : "knowledge.document.retryAt",
                { date: formatDateTime(retryAt, locale) }
              )}
            </span>
          )}
        </div>
      </TableCell>
      <TableCell data-label={t("knowledge.document.size")}>
        {formatKnowledgeBytes(document.size_bytes, locale)}
      </TableCell>
      <TableCell data-label={t("common.updatedAt")}>
        {formatDateTime(document.updated_at, locale)}
      </TableCell>
      <TableCell
        className="knowledge-document-actions-column"
        data-label={t("common.actions")}
      >
        <div className="knowledge-document-actions">
          {canPreview && (
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              nativeButton={false}
              render={
                <NavLink
                  to={`/knowledge-bases/${knowledgeBase.id}/documents/${document.id}/preview`}
                  aria-label={t("knowledge.preview.openNamed", {
                    name: document.display_name,
                  })}
                />
              }
            >
              <BookOpenIcon aria-hidden="true" />
            </Button>
          )}
          {canManage &&
            (document.status === "failed" || candidateFailure?.retryable) && (
              <Tooltip>
                <TooltipTrigger
                  render={
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      aria-label={t("knowledge.actions.reprocessNamed", {
                        name: document.display_name,
                      })}
                      disabled={pending}
                      onClick={onReprocess}
                    />
                  }
                >
                  <FileCogIcon
                    data-slot="knowledge-document-reprocess-icon"
                    aria-hidden="true"
                  />
                </TooltipTrigger>
                <TooltipContent>
                  {t("knowledge.actions.reprocess")}
                </TooltipContent>
              </Tooltip>
            )}
          {canManage && canCancelKnowledgeDocument(document) && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={pending}
              onClick={onCancel}
            >
              {t("knowledge.actions.cancelProcessing")}
            </Button>
          )}
          {canManage && document.rebuild_required && rebuildable && (
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label={t("knowledge.actions.rebuildNamed", {
                      name: document.display_name,
                    })}
                    disabled={pending}
                    onClick={onRebuild}
                  />
                }
              >
                <RefreshCcwIcon aria-hidden="true" />
              </TooltipTrigger>
              <TooltipContent>{t("knowledge.actions.rebuild")}</TooltipContent>
            </Tooltip>
          )}
          {canManage && (
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label={t("knowledge.actions.documentMenu", {
                      name: document.display_name,
                    })}
                  />
                }
              >
                <MoreHorizontalIcon aria-hidden="true" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuGroup>
                  <DropdownMenuItem disabled={pending} onClick={onRename}>
                    <PencilIcon aria-hidden="true" />
                    {t("knowledge.actions.rename")}
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    disabled={
                      actionDisabled ||
                      (document.status !== "ready" &&
                        !candidateFailure?.retryable)
                    }
                    onClick={onReprocess}
                  >
                    <RotateCcwIcon aria-hidden="true" />
                    {t("knowledge.actions.reprocess")}
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    disabled={actionDisabled || !rebuildable}
                    onClick={onRebuild}
                  >
                    <RefreshCcwIcon aria-hidden="true" />
                    {t("knowledge.actions.rebuild")}
                  </DropdownMenuItem>
                </DropdownMenuGroup>
                <DropdownMenuSeparator />
                <DropdownMenuGroup>
                  <DropdownMenuItem
                    variant="destructive"
                    disabled={pending}
                    onClick={onDelete}
                  >
                    <Trash2Icon aria-hidden="true" />
                    {t("common.delete")}
                  </DropdownMenuItem>
                </DropdownMenuGroup>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </TableCell>
    </TableRow>
  )
}

function KnowledgePathIndent({ depth }: { depth: number }) {
  if (depth === 0) return null
  const visibleDepth = Math.min(depth, 64)
  return (
    <span
      className="flex shrink-0"
      data-slot="knowledge-path-indent"
      aria-hidden="true"
    >
      {Array.from({ length: visibleDepth }, (_, level) => (
        <span key={level} className="w-4 shrink-0" />
      ))}
    </span>
  )
}

function isRebuildableKnowledgeDocument(document: KnowledgeDocument) {
  return (
    document.status === "ready" &&
    document.processing === null &&
    document.candidate_failure === null
  )
}

function isSelectableKnowledgeDocument(document: KnowledgeDocument) {
  return (
    document.processing === null &&
    (document.status === "ready" || document.status === "failed")
  )
}

function getKnowledgeDocumentSelectionKey(document: KnowledgeDocument) {
  return `${document.id}:${document.updated_at}`
}

function RenameKnowledgeDocumentDialog({
  document,
  pending,
  error,
  onOpenChange,
  onRename,
}: {
  document: KnowledgeDocument
  pending: boolean
  error?: string
  onOpenChange: (open: boolean) => void
  onRename: (displayName: string) => void
}) {
  const { t } = useTranslation()
  const [displayName, setDisplayName] = useState(document.display_name)

  const normalizedName = displayName.trim()
  const unchanged = normalizedName === document.display_name
  const submit = () => {
    if (normalizedName && !pending && !unchanged) onRename(normalizedName)
  }

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent closeLabel={t("common.close")}>
        <DialogHeader>
          <DialogTitle>{t("knowledge.document.renameTitle")}</DialogTitle>
          <DialogDescription>
            {t("knowledge.document.renameDescription")}
          </DialogDescription>
        </DialogHeader>
        {error && <StatusBanner variant="error">{error}</StatusBanner>}
        <FieldShell
          id="knowledge-document-display-name"
          label={t("knowledge.document.displayName")}
        >
          <InputGroup>
            <InputGroupInput
              id="knowledge-document-display-name"
              value={displayName}
              maxLength={260}
              autoFocus={shouldAutoFocusOnDesktop()}
              onChange={(event) => setDisplayName(event.currentTarget.value)}
              onKeyDown={(event) => {
                if (
                  event.key !== "Enter" ||
                  event.nativeEvent.isComposing ||
                  event.keyCode === 229
                )
                  return
                event.preventDefault()
                submit()
              }}
            />
          </InputGroup>
        </FieldShell>
        <DialogFooter>
          <DialogClose render={<Button type="button" variant="ghost" />}>
            {t("common.cancel")}
          </DialogClose>
          <Button
            type="button"
            disabled={!normalizedName || pending || unchanged}
            onClick={submit}
          >
            {pending && (
              <LoaderCircleIcon data-icon="inline-start" aria-hidden="true" />
            )}
            {t("knowledge.actions.rename")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function KnowledgeDocumentPreviewPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const location = useLocation()
  const { knowledgeBaseId, documentId } = useParams<{
    knowledgeBaseId: string
    documentId: string
  }>()
  const knowledgeBase = useKnowledgeBaseDetail(knowledgeBaseId)
  const searchCapability = useKnowledgeSearchCapability()
  const previewContentEnabled = Boolean(
    knowledgeBase.data?.availability_status === "enabled" &&
    knowledgeBase.data.permissions.view_content
  )
  const previewEventsEnabled = previewContentEnabled
  const eventConnection = useKnowledgeBaseEvents(
    knowledgeBaseId,
    previewEventsEnabled
  )
  const previewQuery = new URLSearchParams(location.search)
  const requestedParsed = previewQuery.get("view") === "parsed"
  const requestedDocumentVersionId =
    previewQuery.get("document_version_id") ?? undefined
  const documentQuery = useKnowledgeDocument(
    knowledgeBaseId,
    documentId,
    requestedDocumentVersionId
  )
  const unsupported = documentQuery.data
    ? isOriginalPreviewUnsupported(documentQuery.data)
    : false
  const [view, setView] = useState<"original" | "parsed">(
    requestedParsed ? "parsed" : "original"
  )
  const downloadContextKey = `${knowledgeBaseId ?? ""}:${documentId ?? ""}:${requestedDocumentVersionId ?? "current"}`
  const [downloadErrorState, setDownloadErrorState] = useState<{
    contextKey: string
    message: string
  } | null>(null)
  const downloadError =
    downloadErrorState?.contextKey === downloadContextKey
      ? downloadErrorState.message
      : null
  const handleDownloadErrorChange = (message: string | null) => {
    setDownloadErrorState(
      message ? { contextKey: downloadContextKey, message } : null
    )
  }
  const activeView = unsupported ? "parsed" : view
  const content = useKnowledgeDocumentContent(
    knowledgeBaseId,
    documentId,
    activeView === "parsed" && previewContentEnabled,
    requestedDocumentVersionId
  )

  useEffect(() => {
    if (eventConnection.connectionState === "access_lost") {
      navigate("/knowledge-bases", { replace: true })
      return
    }
    if (
      eventConnection.connectionState === "stopped" ||
      (knowledgeBase.data && !previewContentEnabled)
    ) {
      navigate(`/knowledge-bases/${knowledgeBaseId ?? ""}`, { replace: true })
    }
  }, [
    eventConnection.connectionState,
    knowledgeBase.data,
    knowledgeBaseId,
    navigate,
    previewContentEnabled,
  ])

  if (
    knowledgeBase.isLoading ||
    documentQuery.isLoading ||
    (knowledgeBase.data && !previewContentEnabled)
  ) {
    return <LoadingState />
  }
  if (
    knowledgeBase.isError ||
    documentQuery.isError ||
    !knowledgeBase.data ||
    !documentQuery.data
  ) {
    return (
      <PageLayout title={t("knowledge.preview.title")}>
        <ErrorState
          message={getErrorMessage(
            knowledgeBase.error ?? documentQuery.error,
            t
          )}
          onRetry={() => {
            void knowledgeBase.refetch()
            void documentQuery.refetch()
          }}
        />
      </PageLayout>
    )
  }

  const document = documentQuery.data
  return (
    <div className="management-scroll">
      <div className="knowledge-preview-page">
        <header className="knowledge-preview-header">
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={t("knowledge.preview.backToKnowledgeBase")}
            onClick={() =>
              navigate(`/knowledge-bases/${knowledgeBase.data.id}`)
            }
          >
            <ArrowLeftIcon aria-hidden="true" />
          </Button>
          <FileTypeIcon
            className="size-6"
            filename={document.display_name}
            mimeType={document.mime_type}
          />
          <div className="min-w-0 flex-1">
            <h1 className="truncate">{document.display_name}</h1>
            <p>
              {t(
                requestedDocumentVersionId
                  ? "knowledge.preview.exactVersionDescription"
                  : "knowledge.preview.sameVersionDescription"
              )}
            </p>
          </div>
          <KnowledgeDownloadButton
            knowledgeBaseId={knowledgeBase.data.id}
            document={document}
            documentVersionId={requestedDocumentVersionId}
            variant="ghost"
            onDownloadErrorChange={handleDownloadErrorChange}
          />
        </header>

        <KnowledgeSearchStatusBanner capability={searchCapability.capability} />

        {downloadError && (
          <StatusBanner variant="error">{downloadError}</StatusBanner>
        )}

        {unsupported && (
          <StatusBanner variant="info">
            {t("knowledge.preview.unsupportedOriginal")}
          </StatusBanner>
        )}

        {unsupported ? (
          <KnowledgeParsedPanel
            knowledgeBaseId={knowledgeBase.data.id}
            document={document}
            content={content}
          />
        ) : (
          <Tabs
            value={activeView}
            onValueChange={(value) => {
              if (value === "original" || value === "parsed") setView(value)
            }}
            className="knowledge-preview-tabs"
          >
            <TabsList aria-label={t("knowledge.preview.views")}>
              <TabsTrigger value="original">
                <FileIcon aria-hidden="true" />
                {t("knowledge.preview.original")}
              </TabsTrigger>
              <TabsTrigger value="parsed">
                <BookOpenIcon aria-hidden="true" />
                {t("knowledge.preview.parsed")}
              </TabsTrigger>
            </TabsList>
            <TabsContent value="original" className="knowledge-preview-panel">
              <KnowledgeOriginalPreview
                knowledgeBaseId={knowledgeBase.data.id}
                document={document}
                documentVersionId={requestedDocumentVersionId}
              />
            </TabsContent>
            <TabsContent value="parsed" className="knowledge-preview-panel">
              <KnowledgeParsedPanel
                knowledgeBaseId={knowledgeBase.data.id}
                document={document}
                content={content}
              />
            </TabsContent>
          </Tabs>
        )}
      </div>
    </div>
  )
}

function KnowledgeParsedPanel({
  knowledgeBaseId,
  document,
  content,
}: {
  knowledgeBaseId: string
  document: KnowledgeDocument
  content: ReturnType<typeof useKnowledgeDocumentContent>
}) {
  const { t } = useTranslation()
  if (content.isLoading) {
    return <LoadingState label={t("knowledge.preview.loadingParsed")} />
  }
  if (content.isError) {
    return (
      <ErrorState
        message={getErrorMessage(content.error, t)}
        onRetry={() => void content.refetch()}
      />
    )
  }
  if (!content.data?.markdown) {
    return <EmptyState title={t("knowledge.preview.parsedEmpty")} />
  }
  return (
    <div className="knowledge-parsed-view">
      <StatusBanner variant="info">
        {t("knowledge.preview.parsedDescription")}
      </StatusBanner>
      <KnowledgeMarkdown
        knowledgeBaseId={knowledgeBaseId}
        documentId={document.id}
        documentVersionId={content.data.document_version_id}
        markdown={content.data.markdown}
      />
    </div>
  )
}

function getConfirmTitle(
  action: KnowledgeConfirmAction | undefined,
  t: ReturnType<typeof useTranslation>["t"]
) {
  return action ? t(`knowledge.confirm.${action.type}.title`) : ""
}

function getConfirmDescription(
  action: KnowledgeConfirmAction | undefined,
  t: ReturnType<typeof useTranslation>["t"]
) {
  if (!action) return ""
  return t(`knowledge.confirm.${action.type}.description`, {
    name: "document" in action ? action.document.display_name : undefined,
    count:
      action.type === "rebuild_selected"
        ? action.documentIds.length
        : undefined,
    remainingAccess:
      action.type === "remove_direct_share"
        ? t(
            action.remainingAccess
              ? "knowledge.share.remainingAccess"
              : "knowledge.share.noRemainingAccess"
          )
        : undefined,
  })
}

function getConfirmLabel(
  action: KnowledgeConfirmAction | undefined,
  t: ReturnType<typeof useTranslation>["t"]
) {
  if (!action) return ""
  if (action.type === "delete_base" || action.type === "delete_document") {
    return t("common.delete")
  }
  if (action.type === "remove_direct_share") {
    return t("knowledge.actions.removeDirectShare")
  }
  if (action.type === "archive") return t("knowledge.actions.archive")
  if (action.type === "restore") return t("knowledge.actions.restore")
  if (action.type === "reprocess") return t("knowledge.actions.reprocess")
  return t("knowledge.actions.rebuild")
}
