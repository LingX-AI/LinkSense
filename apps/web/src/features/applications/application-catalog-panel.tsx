import {
  useDeferredValue,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  DatabaseIcon,
  ChartNoAxesCombinedIcon,
  ExternalLinkIcon,
  FileArchiveIcon,
  MoreHorizontalIcon,
  PencilIcon,
  PlusIcon,
  PowerIcon,
  ServerIcon,
  Share2Icon,
  Trash2Icon,
  UploadIcon,
  UserIcon,
  UserRoundIcon,
  UsersIcon,
  WrenchIcon,
} from "lucide-react"
import { useTranslation } from "react-i18next"
import { Link, useNavigate, useSearchParams } from "react-router-dom"
import {
  APPLICATION_ICON_MAX_BYTES,
  APPLICATION_ICON_MAX_DIMENSION,
  INTERACTIVE_APPLICATION_ARCHIVE_MAX_BYTES,
  applicationIconMimeTypeSchema,
  applicationIconPresetSchema,
  type ApplicationIcon,
  type ApplicationIconInput,
  type ApplicationIconPreset,
  type ReasoningEffort,
} from "@linksense/shared"
import { z } from "zod"

import { apiRequest } from "@/api/client"
import {
  applicationConversationSchema,
  applicationGrantSchema,
  applicationSchema,
  applicationShareTargetSchema,
  capabilitySummarySchema,
  mcpServerSchema,
  modelPreferenceSchema,
  paginatedSchema,
  type Application,
  type ApplicationGrant,
  type ApplicationShareTarget,
  type CapabilitySummary,
} from "@/api/contracts"
import { getErrorMessage } from "@/api/error-message"
import { ConfirmDialog } from "@/components/feedback/confirm-dialog"
import { notify } from "@/components/feedback/notification"
import {
  EmptyState,
  ErrorState,
  LoadingState,
} from "@/components/feedback/page-state"
import { StatusBanner } from "@/components/feedback/status-banner"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardAction,
  CardContent,
  CardFooter,
  CardHeader,
} from "@/components/ui/card"
import {
  Combobox,
  ComboboxChip,
  ComboboxChips,
  ComboboxChipsInput,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
  ComboboxValue,
} from "@/components/ui/combobox"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
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
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Textarea } from "@/components/ui/textarea"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import {
  ApplicationIconDisplay,
  ApplicationPresetIcon,
} from "@/features/applications/application-icon"
import { applicationIconPresetOptions } from "@/features/applications/application-icon-presets"
import { useKnowledgeBaseList } from "@/features/knowledge-bases/knowledge-base-hooks"
import { readUrlEnum, updateUrlSearchParams } from "@/lib/url-search-params"

const applicationPageSchema = paginatedSchema(applicationSchema)
const applicationGrantPageSchema = paginatedSchema(applicationGrantSchema)
const applicationShareTargetPageSchema = paginatedSchema(
  applicationShareTargetSchema
)
const mcpServerListSchema = z.strictObject({ items: z.array(mcpServerSchema) })
const emptyResponseSchema = z.unknown()
const USER_SELECTED_MODEL_VALUE = "__application_user_selected_model__"
const APPLICATION_SHARE_TARGET_PREVIEW_LIMIT = 2

type ApplicationScope = "all" | "owned" | "shared"

type ApplicationShareDisplayItem =
  | { kind: "selected"; target: ApplicationShareTarget }
  | { kind: "grant"; grant: ApplicationGrant }

function InteractiveApplicationImportDialog({
  application,
  open,
  onOpenChange,
  onCompleted,
}: {
  application: Application | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onCompleted: () => Promise<void>
}) {
  const { t } = useTranslation()
  const [file, setFile] = useState<File | null>(null)
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement | null>(null)
  const mutation = useMutation({
    mutationFn: async () => {
      if (!file) throw new Error("APPLICATION_PACKAGE_REQUIRED")
      const body = new FormData()
      body.append("file", file)
      return apiRequest(
        application
          ? `/applications/${application.id}/interactive-package`
          : "/applications/interactive-import",
        {
          method: "POST",
          body,
          schema: applicationSchema,
        }
      )
    },
    onSuccess: () => onCompleted(),
    onError: (nextError) => setError(getErrorMessage(nextError, t)),
  })

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) {
          setFile(null)
          setError(null)
        }
        onOpenChange(nextOpen)
      }}
    >
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {t(
              application
                ? "applications.updateInteractivePackage"
                : "applications.importInteractiveApp"
            )}
          </DialogTitle>
          <DialogDescription>
            {t("applications.interactivePackageRequirements")}
          </DialogDescription>
        </DialogHeader>
        <FieldGroup>
          <Field data-invalid={Boolean(error) || undefined}>
            <FieldLabel htmlFor="interactive-application-package">
              {t("applications.applicationPackage")}
            </FieldLabel>
            <Input
              ref={inputRef}
              id="interactive-application-package"
              type="file"
              accept=".zip,application/zip"
              onChange={(event) => {
                const next = event.target.files?.[0] ?? null
                setError(null)
                if (
                  next &&
                  (next.size === 0 ||
                    next.size > INTERACTIVE_APPLICATION_ARCHIVE_MAX_BYTES)
                ) {
                  setFile(null)
                  setError(t("applications.interactivePackageSizeInvalid"))
                  return
                }
                setFile(next)
              }}
            />
            <FieldDescription>
              {t("applications.interactivePackageHint", { size: "10 MiB" })}
            </FieldDescription>
          </Field>
          {error && <StatusBanner variant="error">{error}</StatusBanner>}
        </FieldGroup>
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
          >
            {t("common.cancel")}
          </Button>
          <Button
            type="button"
            disabled={!file || mutation.isPending}
            onClick={() => mutation.mutate()}
          >
            <UploadIcon data-icon="inline-start" aria-hidden="true" />
            {t(
              application ? "common.update" : "applications.importPackageAction"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

type ApplicationGrantPage = {
  items: ApplicationGrant[]
  next_cursor: string | null
}

function formatApplicationShareTargets(
  targets: Application["share_targets"],
  formatter: Intl.ListFormat
) {
  if (targets.length === 0) return null
  const visibleTargets = targets.slice(
    0,
    APPLICATION_SHARE_TARGET_PREVIEW_LIMIT
  )
  const names = formatter.format(visibleTargets.map((target) => target.name))
  return targets.length > visibleTargets.length ? `${names}…` : names
}

type ApplicationFormState = {
  name: string
  description: string
  instructions: string
  model: string
  reasoningEffort: ReasoningEffort | ""
  pluginIds: string[]
  skillIds: string[]
  knowledgeBaseIds: string[]
  mcpServerIds: string[]
  status: "active" | "disabled"
  icon: ApplicationIconFormState
}

type ApplicationIconFormState =
  | { mode: "preset"; preset: ApplicationIconPreset }
  | {
      mode: "existing-custom"
      icon: Extract<ApplicationIcon, { type: "custom" }>
    }
  | {
      mode: "upload"
      filename: string
      mimeType: "image/png" | "image/jpeg" | "image/webp"
      dataBase64: string
      previewUrl: string
    }

const emptyForm: ApplicationFormState = {
  name: "",
  description: "",
  instructions: "",
  model: "",
  reasoningEffort: "",
  pluginIds: [],
  skillIds: [],
  knowledgeBaseIds: [],
  mcpServerIds: [],
  status: "active",
  icon: { mode: "preset", preset: "bot" },
}

function RequiredFieldLabel({
  children,
  htmlFor,
}: {
  children: ReactNode
  htmlFor: string
}) {
  return (
    <FieldLabel htmlFor={htmlFor} className="gap-1">
      {children}
      <span aria-hidden="true" className="text-destructive">
        *
      </span>
    </FieldLabel>
  )
}

export function ApplicationCatalogPanel({
  onFeedback,
}: {
  onFeedback: (message: string, isError?: boolean) => void
}) {
  const { t, i18n } = useTranslation()
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const queryClient = useQueryClient()
  const scope = readUrlEnum<ApplicationScope>(
    searchParams,
    "app_scope",
    ["all", "owned", "shared"],
    "all"
  )
  const search = searchParams.get("app_search") ?? ""
  const updateCatalogParams = (
    updates: Readonly<Record<string, string | null>>
  ) => {
    setSearchParams((current) => updateUrlSearchParams(current, updates), {
      replace: true,
    })
  }
  const deferredSearch = useDeferredValue(search.trim())
  const [editor, setEditor] = useState<{
    open: boolean
    application: Application | null
  }>({ open: false, application: null })
  const [shareTarget, setShareTarget] = useState<Application | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<Application | null>(null)
  const [createChoiceOpen, setCreateChoiceOpen] = useState(false)
  const [interactiveImportTarget, setInteractiveImportTarget] = useState<
    Application | null | undefined
  >(undefined)
  const shareTargetListFormatter = useMemo(
    () =>
      new Intl.ListFormat(
        i18n.resolvedLanguage === "en-US" ? "en-US" : "zh-CN",
        {
          style: "narrow",
          type: "conjunction",
        }
      ),
    [i18n.resolvedLanguage]
  )
  const scopeItems = [
    { value: "all", label: t("applications.scope.all") },
    { value: "owned", label: t("applications.scope.owned") },
    { value: "shared", label: t("applications.scope.shared") },
  ]

  const applications = useQuery({
    queryKey: ["applications", scope, deferredSearch],
    queryFn: ({ signal }) =>
      apiRequest("/applications", {
        query: {
          scope,
          search: deferredSearch || undefined,
        },
        schema: applicationPageSchema,
        signal,
      }),
  })

  const startConversation = useMutation({
    mutationFn: (application: Application) =>
      apiRequest(`/applications/${application.id}/conversations`, {
        method: "POST",
        schema: applicationConversationSchema,
      }),
    onSuccess: ({ conversation_id }, application) => {
      void queryClient.invalidateQueries({ queryKey: ["conversations"] })
      navigate(
        application.kind === "interactive"
          ? `/applications/${application.id}/run/${conversation_id}`
          : `/conversations/${conversation_id}`
      )
    },
    onError: (error) => onFeedback(getErrorMessage(error, t), true),
  })

  const deleteApplication = useMutation({
    mutationFn: (application: Application) =>
      apiRequest(`/applications/${application.id}`, {
        method: "DELETE",
        schema: emptyResponseSchema,
      }),
    onSuccess: async () => {
      setDeleteTarget(null)
      onFeedback(t("applications.deleted"))
      await queryClient.invalidateQueries({ queryKey: ["applications"] })
    },
    onError: (error) => onFeedback(getErrorMessage(error, t), true),
  })
  const toggleApplicationStatus = useMutation({
    mutationFn: (application: Application) =>
      apiRequest(`/applications/${application.id}`, {
        method: "PATCH",
        body: {
          status: application.status === "active" ? "disabled" : "active",
        },
        schema: applicationSchema,
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["applications"] })
    },
    onError: (error) => onFeedback(getErrorMessage(error, t), true),
  })

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="flex min-w-0 flex-1 flex-col gap-3 sm:flex-row">
          <Select
            items={scopeItems}
            value={scope}
            onValueChange={(value) =>
              updateCatalogParams({
                app_scope: value === "all" ? null : value,
              })
            }
          >
            <SelectTrigger
              className="w-full sm:w-40"
              aria-label={t("applications.scopeLabel")}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                {scopeItems.map((item) => (
                  <SelectItem key={item.value} value={item.value}>
                    {item.label}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
          <Input
            value={search}
            aria-label={t("applications.search")}
            placeholder={t("applications.searchPlaceholder")}
            className="w-full md:max-w-md"
            onChange={(event) =>
              updateCatalogParams({ app_search: event.target.value })
            }
          />
        </div>
        <Button type="button" onClick={() => setCreateChoiceOpen(true)}>
          <PlusIcon data-icon="inline-start" />
          {t("applications.create")}
        </Button>
      </div>

      {applications.isLoading && <LoadingState />}
      {applications.isError && (
        <ErrorState
          message={getErrorMessage(applications.error, t)}
          onRetry={() => void applications.refetch()}
        />
      )}
      {applications.data && applications.data.items.length === 0 && (
        <EmptyState title={t("applications.emptyTitle")} />
      )}
      {applications.data && applications.data.items.length > 0 && (
        <div className="grid gap-4 md:grid-cols-2">
          {applications.data.items.map((application) => {
            const unavailable = !application.dependencies_available
            const shareTargetSummary = formatApplicationShareTargets(
              application.share_targets,
              shareTargetListFormatter
            )
            return (
              <Card key={application.id} className="min-w-0">
                <CardHeader className="gap-4">
                  <div className="flex min-w-0 items-start gap-3">
                    <ApplicationIconDisplay
                      icon={application.icon}
                      className="size-10"
                    />
                    <div className="min-w-0">
                      <h3 className="truncate font-medium">
                        {application.name}
                      </h3>
                      {application.kind === "interactive" && (
                        <p className="mt-1 text-xs text-muted-foreground">
                          {t("applications.interactiveApp")}
                          {application.interactive_package
                            ? ` · v${application.interactive_package.version}`
                            : ""}
                        </p>
                      )}
                      <p className="truncate text-sm text-muted-foreground">
                        {application.is_owner
                          ? t("applications.createdByMe")
                          : t("applications.createdBy", {
                              name: application.owner.name,
                            })}
                      </p>
                    </div>
                  </div>
                  <CardAction className="flex items-center gap-1">
                    <Badge
                      variant={
                        application.status === "active"
                          ? "secondary"
                          : "outline"
                      }
                    >
                      {t(`applications.status.${application.status}`)}
                    </Badge>
                    {application.is_owner && (
                      <DropdownMenu>
                        <DropdownMenuTrigger
                          render={
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon-sm"
                              aria-label={t("common.moreActionsNamed", {
                                name: application.name,
                              })}
                            />
                          }
                        >
                          <MoreHorizontalIcon aria-hidden="true" />
                        </DropdownMenuTrigger>
                        <DropdownMenuContent
                          align="end"
                          className="w-max min-w-32"
                        >
                          <DropdownMenuGroup>
                            {application.kind === "standard" ? (
                              <DropdownMenuItem
                                className="whitespace-nowrap"
                                onClick={() =>
                                  setEditor({ open: true, application })
                                }
                              >
                                <PencilIcon aria-hidden="true" />
                                {t("common.edit")}
                              </DropdownMenuItem>
                            ) : (
                              <DropdownMenuItem
                                className="whitespace-nowrap"
                                onClick={() =>
                                  setInteractiveImportTarget(application)
                                }
                              >
                                <FileArchiveIcon aria-hidden="true" />
                                {t("applications.updateInteractivePackage")}
                              </DropdownMenuItem>
                            )}
                            <DropdownMenuItem
                              className="whitespace-nowrap"
                              onClick={() => setShareTarget(application)}
                            >
                              <Share2Icon aria-hidden="true" />
                              {t("applications.share")}
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              className="whitespace-nowrap"
                              disabled={toggleApplicationStatus.isPending}
                              onClick={() =>
                                toggleApplicationStatus.mutate(application)
                              }
                            >
                              <PowerIcon aria-hidden="true" />
                              {t(
                                application.status === "active"
                                  ? "common.disable"
                                  : "common.enable"
                              )}
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              className="whitespace-nowrap"
                              render={
                                <Link
                                  to={`/capabilities/applications/${application.id}/usage`}
                                />
                              }
                            >
                              <ChartNoAxesCombinedIcon aria-hidden="true" />
                              {t("applications.usage.action")}
                            </DropdownMenuItem>
                            {application.kind === "standard" && (
                              <DropdownMenuItem
                                className="whitespace-nowrap"
                                render={
                                  <Link
                                    to={`/capabilities/applications/${application.id}/external-access`}
                                  />
                                }
                              >
                                <ExternalLinkIcon aria-hidden="true" />
                                {t("applications.externalAccess.action")}
                              </DropdownMenuItem>
                            )}
                            <DropdownMenuItem
                              className="whitespace-nowrap"
                              variant="destructive"
                              onClick={() => setDeleteTarget(application)}
                            >
                              <Trash2Icon aria-hidden="true" />
                              {t("common.delete")}
                            </DropdownMenuItem>
                          </DropdownMenuGroup>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    )}
                  </CardAction>
                </CardHeader>
                <CardContent className="flex flex-1 flex-col gap-4">
                  <p className="min-h-10 text-sm text-muted-foreground">
                    {application.description || t("applications.noDescription")}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {application.model && (
                      <Badge variant="outline">{application.model}</Badge>
                    )}
                    <Badge variant="outline">
                      <WrenchIcon aria-hidden="true" />
                      {t("applications.capabilityCount", {
                        count: application.capability_count,
                      })}
                    </Badge>
                    <Badge variant="outline">
                      <DatabaseIcon aria-hidden="true" />
                      {t("applications.knowledgeBaseCount", {
                        count: application.knowledge_base_count,
                      })}
                    </Badge>
                    <Badge variant="outline">
                      <ServerIcon aria-hidden="true" />
                      {t("applications.mcpServerCount", {
                        count: application.mcp_server_count,
                      })}
                    </Badge>
                    {shareTargetSummary && (
                      <Badge
                        variant="outline"
                        className="application-share-target-summary max-w-full min-w-0"
                      >
                        <UsersIcon aria-hidden="true" />
                        <span className="min-w-0 truncate">
                          {t("applications.shareTargets", {
                            targets: shareTargetSummary,
                          })}
                        </span>
                      </Badge>
                    )}
                  </div>
                  {unavailable && (
                    <StatusBanner variant="warning">
                      {t("applications.dependencyUnavailable")}
                    </StatusBanner>
                  )}
                </CardContent>
                <CardFooter className="flex-nowrap justify-end gap-2">
                  <Button
                    type="button"
                    size="sm"
                    disabled={
                      application.status !== "active" ||
                      unavailable ||
                      startConversation.isPending
                    }
                    onClick={() => startConversation.mutate(application)}
                  >
                    {t("applications.startChat")}
                  </Button>
                </CardFooter>
              </Card>
            )
          })}
        </div>
      )}

      <ApplicationEditorDialog
        key={`${editor.open}:${editor.application?.id ?? "new"}:${editor.application?.updated_at ?? ""}`}
        open={editor.open}
        application={editor.application}
        onOpenChange={(open) => setEditor((current) => ({ ...current, open }))}
        onCompleted={async (message) => {
          setEditor({ open: false, application: null })
          onFeedback(message)
          await queryClient.invalidateQueries({ queryKey: ["applications"] })
        }}
      />
      <Dialog open={createChoiceOpen} onOpenChange={setCreateChoiceOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{t("applications.createTitle")}</DialogTitle>
            <DialogDescription>
              {t("applications.createTypeDescription")}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 py-2 sm:grid-cols-2">
            <Button
              type="button"
              variant="card-outline"
              className="h-auto items-start justify-start gap-3 p-4 text-left whitespace-normal"
              onClick={() => {
                setCreateChoiceOpen(false)
                setEditor({ open: true, application: null })
              }}
            >
              <PlusIcon className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              <span>
                <span className="block font-medium">
                  {t("applications.createStandardApp")}
                </span>
                <span className="mt-1 block text-xs text-muted-foreground">
                  {t("applications.createStandardAppDescription")}
                </span>
              </span>
            </Button>
            <Button
              type="button"
              variant="card-outline"
              className="h-auto items-start justify-start gap-3 p-4 text-left whitespace-normal"
              onClick={() => {
                setCreateChoiceOpen(false)
                setInteractiveImportTarget(null)
              }}
            >
              <FileArchiveIcon
                className="mt-0.5 size-4 shrink-0"
                aria-hidden="true"
              />
              <span>
                <span className="block font-medium">
                  {t("applications.importInteractiveApp")}
                </span>
                <span className="mt-1 block text-xs text-muted-foreground">
                  {t("applications.importInteractiveAppDescription")}
                </span>
              </span>
            </Button>
          </div>
        </DialogContent>
      </Dialog>
      <InteractiveApplicationImportDialog
        application={interactiveImportTarget ?? null}
        open={interactiveImportTarget !== undefined}
        onOpenChange={(open) => {
          if (!open) setInteractiveImportTarget(undefined)
        }}
        onCompleted={async () => {
          setInteractiveImportTarget(undefined)
          onFeedback(
            t(
              interactiveImportTarget
                ? "applications.interactivePackageUpdated"
                : "applications.interactiveAppImported"
            )
          )
          await queryClient.invalidateQueries({ queryKey: ["applications"] })
        }}
      />
      <ApplicationShareDialog
        application={shareTarget}
        onOpenChange={(open) => {
          if (!open) setShareTarget(null)
        }}
      />
      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null)
        }}
        title={t("applications.deleteTitle")}
        description={t("applications.deleteDescription")}
        confirmLabel={t("common.delete")}
        destructive
        pending={deleteApplication.isPending}
        onConfirm={() => {
          if (deleteTarget) deleteApplication.mutate(deleteTarget)
        }}
      />
    </div>
  )
}

function ApplicationEditorDialog({
  open,
  application,
  onOpenChange,
  onCompleted,
}: {
  open: boolean
  application: Application | null
  onOpenChange: (open: boolean) => void
  onCompleted: (message: string) => Promise<void>
}) {
  const { t } = useTranslation()
  const [form, setForm] = useState<ApplicationFormState>(() =>
    application
      ? {
          name: application.name,
          description: application.description ?? "",
          instructions: application.instructions ?? "",
          model: application.model ?? "",
          reasoningEffort: application.reasoning_effort ?? "",
          pluginIds: application.capabilities
            .filter((item) => item.type === "plugin")
            .map((item) => item.id),
          skillIds: application.capabilities
            .filter((item) => item.type === "skill")
            .map((item) => item.id),
          knowledgeBaseIds: application.knowledge_bases.map((item) => item.id),
          mcpServerIds: application.mcp_servers.map((item) => item.id),
          status: application.status,
          icon:
            application.icon.type === "custom"
              ? { mode: "existing-custom", icon: application.icon }
              : { mode: "preset", preset: application.icon.preset },
        }
      : emptyForm
  )
  const [error, setError] = useState<string | null>(null)
  const [iconError, setIconError] = useState<string | null>(null)
  const [iconReading, setIconReading] = useState(false)
  const iconInputRef = useRef<HTMLInputElement | null>(null)

  const capabilities = useQuery({
    queryKey: ["capabilities", "managed", "application-editor"],
    queryFn: ({ signal }) =>
      apiRequest("/capabilities", {
        query: { view: "managed" },
        schema: paginatedSchema(capabilitySummarySchema),
        signal,
      }),
    enabled: open,
  })
  const mcpServers = useQuery({
    queryKey: ["mcp-servers", "application-editor"],
    queryFn: ({ signal }) =>
      apiRequest("/mcp-servers", {
        schema: mcpServerListSchema,
        signal,
      }),
    enabled: open,
  })
  const knowledgeBases = useKnowledgeBaseList(
    {
      lifecycle: "active",
      scope: "owned",
      search: "",
    },
    { enabled: open }
  )
  const models = useQuery({
    queryKey: ["me", "model-preference", "application-editor"],
    queryFn: ({ signal }) =>
      apiRequest("/me/model-preference", {
        schema: modelPreferenceSchema,
        signal,
      }),
    enabled: open,
  })
  const knowledgeBaseItems = useMemo(
    () => knowledgeBases.data?.pages.flatMap((page) => page.items) ?? [],
    [knowledgeBases.data]
  )
  const capabilityOptions = useMemo(() => {
    const managed = (capabilities.data?.items ?? []).filter(
      (item) => !item.is_builtin
    )
    const managedIds = new Set(managed.map((item) => item.id))
    const optionsFor = (type: "plugin" | "skill") => [
      ...managed
        .filter((item) => item.type === type)
        .map((item) => {
          const credentialRequired = requiresCredentials(item)
          return {
            id: item.id,
            label: item.name,
            detail: credentialRequired
              ? t("applications.usesPluginCredentials")
              : (item.description ?? ""),
            detailInline: false,
            disabled: !item.can_select,
          }
        }),
      ...(application?.capabilities ?? [])
        .filter((item) => item.type === type && !managedIds.has(item.id))
        .map((item) => ({
          id: item.id,
          label: item.name,
          detail: t("applications.dependencyUnavailableShort"),
          detailInline: false,
          disabled: true,
        })),
    ]
    return {
      plugins: optionsFor("plugin"),
      skills: optionsFor("skill"),
    }
  }, [application?.capabilities, capabilities.data?.items, t])
  const knowledgeBaseOptions = useMemo(() => {
    const ownedIds = new Set(knowledgeBaseItems.map((item) => item.id))
    return [
      ...knowledgeBaseItems.map((item) => ({
        id: item.id,
        label: item.name,
        detail: item.description ?? "",
        detailInline: false,
        disabled: item.availability_status !== "enabled",
      })),
      ...(application?.knowledge_bases ?? [])
        .filter((item) => !ownedIds.has(item.id))
        .map((item) => ({
          id: item.id,
          label: item.name,
          detail: t("applications.dependencyUnavailableShort"),
          detailInline: false,
          disabled: true,
        })),
    ]
  }, [application?.knowledge_bases, knowledgeBaseItems, t])
  const mcpServerOptions = useMemo(() => {
    const installed = mcpServers.data?.items ?? []
    const installedIds = new Set(installed.map((item) => item.id))
    return [
      ...installed.map((item) => ({
        id: item.id,
        label: item.name,
        detail:
          item.transport === "streamable_http"
            ? item.url
            : [item.command, ...item.args].join(" "),
        detailInline: false,
        disabled: item.status !== "active",
      })),
      ...(application?.mcp_servers ?? [])
        .filter((item) => !installedIds.has(item.id))
        .map((item) => ({
          id: item.id,
          label: item.name,
          detail: t("applications.dependencyUnavailableShort"),
          detailInline: false,
          disabled: true,
        })),
    ]
  }, [application?.mcp_servers, mcpServers.data?.items, t])
  const selectedModel = models.data?.models.find(
    (model) => model.id === form.model
  )
  const modelItems = [
    {
      value: USER_SELECTED_MODEL_VALUE,
      label: t("applications.userSelectedModel"),
    },
    ...(models.data?.models ?? []).map((model) => ({
      value: model.id,
      label: model.display_name,
    })),
  ]
  const reasoningEffortItems = (
    selectedModel?.supported_reasoning_efforts ?? []
  ).map((effort) => ({
    value: effort,
    label: t(`reasoningEffort.${effort}`),
  }))
  const statusItems = [
    { value: "active", label: t("common.enabled") },
    { value: "disabled", label: t("common.disabled") },
  ]
  const displayedIcon: ApplicationIcon =
    form.icon.mode === "preset"
      ? { type: "preset", preset: form.icon.preset }
      : form.icon.mode === "existing-custom"
        ? form.icon.icon
        : {
            type: "custom",
            url: form.icon.previewUrl,
            fallback_preset: "bot",
          }

  const save = useMutation({
    mutationFn: () => {
      const icon = applicationIconInputFor(form.icon)
      return apiRequest(
        application ? `/applications/${application.id}` : "/applications",
        {
          method: application ? "PATCH" : "POST",
          body: {
            name: form.name.trim(),
            description: form.description.trim() || null,
            instructions: form.instructions.trim(),
            model: form.model || null,
            reasoning_effort: form.model ? form.reasoningEffort || null : null,
            capability_ids: [...form.pluginIds, ...form.skillIds],
            knowledge_base_ids: form.knowledgeBaseIds,
            mcp_server_ids: form.mcpServerIds,
            status: form.status,
            ...(icon === undefined ? {} : { icon }),
          },
          schema: applicationSchema,
        }
      )
    },
    onSuccess: () =>
      onCompleted(
        t(application ? "applications.updated" : "applications.created")
      ),
    onError: (nextError) => setError(getErrorMessage(nextError, t)),
  })

  const valid =
    form.name.trim().length > 0 &&
    form.instructions.trim().length > 0 &&
    (form.model.length === 0 || form.reasoningEffort.length > 0) &&
    !iconReading

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[calc(100dvh-2rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-5xl">
        <DialogHeader className="shrink-0 border-b border-divider px-6 py-5 pr-16">
          <DialogTitle>
            {t(
              application
                ? "applications.editTitle"
                : "applications.createTitle"
            )}
          </DialogTitle>
          <DialogDescription>
            {t("applications.editorDescription")}
          </DialogDescription>
        </DialogHeader>
        <div
          data-slot="application-editor-body"
          className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-6 py-5"
        >
          <div
            data-slot="application-editor-columns"
            className="grid gap-8 md:grid-cols-2 md:gap-0"
          >
            <section
              data-slot="application-editor-left"
              aria-labelledby="application-basic-information"
              className="min-w-0 md:pr-6"
            >
              <h3
                id="application-basic-information"
                className="mb-5 text-sm font-medium"
              >
                {t("applications.basicInformation")}
              </h3>
              <FieldGroup>
                <Field data-invalid={Boolean(iconError)}>
                  <FieldLabel>{t("applications.icon")}</FieldLabel>
                  <div className="flex flex-col items-start gap-4 sm:flex-row">
                    <ApplicationIconDisplay
                      icon={displayedIcon}
                      className="size-16 [&_svg]:size-11"
                    />
                    <div className="flex min-w-0 flex-1 flex-col gap-3">
                      <ToggleGroup
                        variant="outline"
                        value={
                          form.icon.mode === "preset" ? [form.icon.preset] : []
                        }
                        onValueChange={(values) => {
                          const preset = applicationIconPresetSchema.safeParse(
                            values[0]
                          )
                          if (!preset.success) return
                          setIconError(null)
                          setForm((current) => ({
                            ...current,
                            icon: { mode: "preset", preset: preset.data },
                          }))
                        }}
                        aria-label={t("applications.iconPresetLabel")}
                        spacing={1}
                        className="grid w-full grid-cols-10"
                      >
                        {applicationIconPresetOptions.map((option) => (
                          <ToggleGroupItem
                            key={option.value}
                            value={option.value}
                            aria-label={t(
                              `applications.iconPresets.${option.value}`
                            )}
                            className="aspect-square h-auto min-h-7 w-full min-w-0 p-0"
                          >
                            <ApplicationPresetIcon preset={option.value} />
                          </ToggleGroupItem>
                        ))}
                      </ToggleGroup>
                      <div>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          disabled={iconReading}
                          onClick={() => iconInputRef.current?.click()}
                        >
                          <UploadIcon data-icon="inline-start" />
                          {t(
                            form.icon.mode === "preset"
                              ? "applications.uploadIcon"
                              : "applications.replaceIcon"
                          )}
                        </Button>
                        <Input
                          ref={iconInputRef}
                          type="file"
                          accept="image/png,image/jpeg,image/webp"
                          className="sr-only"
                          aria-label={t("applications.uploadIcon")}
                          onChange={async (event) => {
                            const file = event.target.files?.[0]
                            event.target.value = ""
                            if (!file) return
                            setIconError(null)
                            const mimeType =
                              applicationIconMimeTypeSchema.safeParse(file.type)
                            if (
                              file.size === 0 ||
                              file.size > APPLICATION_ICON_MAX_BYTES ||
                              !mimeType.success
                            ) {
                              setIconError(t("applications.iconFileInvalid"))
                              return
                            }
                            setIconReading(true)
                            try {
                              const previewUrl = await readFileAsDataUrl(file)
                              const prefix = `data:${mimeType.data};base64,`
                              if (!previewUrl.startsWith(prefix)) {
                                throw new Error(
                                  "Invalid application icon data URL"
                                )
                              }
                              setForm((current) => ({
                                ...current,
                                icon: {
                                  mode: "upload",
                                  filename: file.name,
                                  mimeType: mimeType.data,
                                  dataBase64: previewUrl.slice(prefix.length),
                                  previewUrl,
                                },
                              }))
                            } catch {
                              setIconError(t("applications.iconFileInvalid"))
                            } finally {
                              setIconReading(false)
                            }
                          }}
                        />
                      </div>
                    </div>
                  </div>
                  <FieldDescription className="w-full max-w-none text-xs leading-5 whitespace-normal">
                    {t("applications.iconHint", {
                      size: "512 KiB",
                      dimension: APPLICATION_ICON_MAX_DIMENSION,
                    })}
                  </FieldDescription>
                  {iconError && (
                    <FieldDescription role="alert" className="text-destructive">
                      {iconError}
                    </FieldDescription>
                  )}
                </Field>
                <Field>
                  <RequiredFieldLabel htmlFor="application-name">
                    {t("common.name")}
                  </RequiredFieldLabel>
                  <Input
                    id="application-name"
                    value={form.name}
                    maxLength={160}
                    required
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        name: event.target.value,
                      }))
                    }
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor="application-description">
                    {t("common.description")}
                  </FieldLabel>
                  <Textarea
                    id="application-description"
                    value={form.description}
                    maxLength={4_000}
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        description: event.target.value,
                      }))
                    }
                  />
                </Field>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field>
                    <FieldLabel htmlFor="application-model">
                      {t("applications.model")}
                    </FieldLabel>
                    <Select
                      items={modelItems}
                      value={form.model || USER_SELECTED_MODEL_VALUE}
                      onValueChange={(value) => {
                        if (value === USER_SELECTED_MODEL_VALUE) {
                          setForm((current) => ({
                            ...current,
                            model: "",
                            reasoningEffort: "",
                          }))
                          return
                        }
                        const model = models.data?.models.find(
                          (candidate) => candidate.id === value
                        )
                        setForm((current) => ({
                          ...current,
                          model: value ?? "",
                          reasoningEffort:
                            model?.default_reasoning_effort ?? "medium",
                        }))
                      }}
                    >
                      <SelectTrigger
                        id="application-model"
                        aria-label={t("applications.model")}
                      >
                        <SelectValue placeholder={t("common.select")} />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectGroup>
                          {modelItems.map((item) => (
                            <SelectItem key={item.value} value={item.value}>
                              {item.label}
                            </SelectItem>
                          ))}
                        </SelectGroup>
                      </SelectContent>
                    </Select>
                    <FieldDescription>
                      {t("applications.modelOptionalDescription")}
                    </FieldDescription>
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="application-reasoning-effort">
                      {t("applications.reasoningEffort")}
                    </FieldLabel>
                    <Select
                      items={reasoningEffortItems}
                      value={form.reasoningEffort}
                      disabled={!selectedModel}
                      onValueChange={(value) =>
                        setForm((current) => ({
                          ...current,
                          reasoningEffort: value as ReasoningEffort,
                        }))
                      }
                    >
                      <SelectTrigger
                        id="application-reasoning-effort"
                        aria-label={t("applications.reasoningEffort")}
                      >
                        <SelectValue placeholder={t("common.select")} />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectGroup>
                          {reasoningEffortItems.map((item) => (
                            <SelectItem key={item.value} value={item.value}>
                              {item.label}
                            </SelectItem>
                          ))}
                        </SelectGroup>
                      </SelectContent>
                    </Select>
                  </Field>
                </div>
                <Field>
                  <FieldLabel>{t("common.status")}</FieldLabel>
                  <Select
                    items={statusItems}
                    value={form.status}
                    onValueChange={(value) =>
                      setForm((current) => ({
                        ...current,
                        status: value as "active" | "disabled",
                      }))
                    }
                  >
                    <SelectTrigger aria-label={t("common.status")}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectGroup>
                        {statusItems.map((item) => (
                          <SelectItem key={item.value} value={item.value}>
                            {item.label}
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                </Field>
              </FieldGroup>
            </section>
            <section
              data-slot="application-editor-right"
              aria-labelledby="application-runtime-configuration"
              className="min-w-0 md:border-l md:border-divider md:pl-6"
            >
              <h3
                id="application-runtime-configuration"
                className="mb-5 text-sm font-medium"
              >
                {t("applications.runtimeConfiguration")}
              </h3>
              <FieldGroup>
                <Field>
                  <RequiredFieldLabel htmlFor="application-instructions">
                    {t("applications.instructions")}
                  </RequiredFieldLabel>
                  <Textarea
                    id="application-instructions"
                    value={form.instructions}
                    maxLength={20_000}
                    className="h-48 max-h-48 min-h-48 overflow-y-auto"
                    required
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        instructions: event.target.value,
                      }))
                    }
                  />
                  <FieldDescription>
                    {t("applications.instructionsDescription")}
                  </FieldDescription>
                </Field>
                <ResourceMultiSelect
                  id="application-plugins"
                  title={t("applications.plugins")}
                  description={t("applications.pluginsDescription")}
                  items={capabilityOptions.plugins}
                  selectedIds={form.pluginIds}
                  onChange={(pluginIds) =>
                    setForm((current) => ({ ...current, pluginIds }))
                  }
                  emptyLabel={t("applications.noPlugins")}
                  placeholder={t("applications.pluginSelectPlaceholder")}
                  searchPlaceholder={t("applications.pluginSearchPlaceholder")}
                />
                <ResourceMultiSelect
                  id="application-skills"
                  title={t("applications.skills")}
                  description={t("applications.skillsDescription")}
                  items={capabilityOptions.skills}
                  selectedIds={form.skillIds}
                  onChange={(skillIds) =>
                    setForm((current) => ({ ...current, skillIds }))
                  }
                  emptyLabel={t("applications.noSkills")}
                  placeholder={t("applications.skillSelectPlaceholder")}
                  searchPlaceholder={t("applications.skillSearchPlaceholder")}
                />
                <ResourceMultiSelect
                  id="application-knowledge-bases"
                  title={t("applications.knowledgeBases")}
                  description={t("applications.knowledgeBasesDescription")}
                  items={knowledgeBaseOptions}
                  selectedIds={form.knowledgeBaseIds}
                  onChange={(knowledgeBaseIds) =>
                    setForm((current) => ({ ...current, knowledgeBaseIds }))
                  }
                  emptyLabel={t("applications.noKnowledgeBases")}
                  placeholder={t("applications.knowledgeBaseSelectPlaceholder")}
                  searchPlaceholder={t(
                    "applications.knowledgeBaseSearchPlaceholder"
                  )}
                />
                <ResourceMultiSelect
                  id="application-mcp-servers"
                  title={t("applications.mcpServers")}
                  description={t("applications.mcpServersDescription")}
                  items={mcpServerOptions}
                  selectedIds={form.mcpServerIds}
                  onChange={(mcpServerIds) =>
                    setForm((current) => ({ ...current, mcpServerIds }))
                  }
                  emptyLabel={t("applications.noMcpServers")}
                  placeholder={t("applications.mcpServerSelectPlaceholder")}
                  searchPlaceholder={t(
                    "applications.mcpServerSearchPlaceholder"
                  )}
                />
              </FieldGroup>
            </section>
          </div>
          {error && (
            <div className="mt-5">
              <StatusBanner variant="error">{error}</StatusBanner>
            </div>
          )}
        </div>
        <DialogFooter className="shrink-0 border-t border-divider px-6 py-4">
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
          >
            {t("common.cancel")}
          </Button>
          <Button
            type="button"
            disabled={
              !valid ||
              save.isPending ||
              models.isLoading ||
              mcpServers.isLoading
            }
            onClick={() => save.mutate()}
          >
            {t(application ? "common.save" : "common.create")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function applicationIconInputFor(
  icon: ApplicationIconFormState
): ApplicationIconInput | undefined {
  if (icon.mode === "existing-custom") return undefined
  if (icon.mode === "preset") {
    return { type: "preset", preset: icon.preset }
  }
  return {
    type: "upload",
    filename: icon.filename,
    mime_type: icon.mimeType,
    data_base64: icon.dataBase64,
  }
}

function readFileAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(reader.error)
    reader.onload = () => {
      if (typeof reader.result === "string") {
        resolve(reader.result)
        return
      }
      reject(new Error("Application icon could not be read as a data URL"))
    }
    reader.readAsDataURL(file)
  })
}

type ApplicationResourceOption = {
  id: string
  label: string
  detail: string
  detailInline: boolean
  disabled: boolean
}

const visibleResourceChipLimit = 2

function ResourceMultiSelect({
  id,
  title,
  description,
  items,
  selectedIds,
  onChange,
  emptyLabel,
  placeholder,
  searchPlaceholder,
}: {
  id: string
  title: string
  description: string
  items: ApplicationResourceOption[]
  selectedIds: string[]
  onChange: (ids: string[]) => void
  emptyLabel: string
  placeholder: string
  searchPlaceholder: string
}) {
  const { t } = useTranslation()
  const selected = new Set(selectedIds)
  const selectedItems = items.filter((item) => selected.has(item.id))
  const hiddenSelectedCount = Math.max(
    selectedItems.length - visibleResourceChipLimit,
    0
  )

  return (
    <Field>
      <FieldLabel htmlFor={id}>{title}</FieldLabel>
      <FieldDescription>{description}</FieldDescription>
      <Combobox
        items={items}
        multiple
        value={selectedItems}
        disabled={items.length === 0}
        itemToStringLabel={(item) =>
          [item.label, item.detail].filter(Boolean).join(" ")
        }
        itemToStringValue={(item) => item.id}
        isItemEqualToValue={(item, value) => item.id === value.id}
        onValueChange={(nextItems) =>
          onChange(nextItems.map((item) => item.id))
        }
      >
        <ComboboxChips className="min-h-9 w-full">
          <ComboboxValue>
            {selectedItems.slice(0, visibleResourceChipLimit).map((item) => (
              <ComboboxChip
                key={item.id}
                removeLabel={t("applications.removeResource", {
                  name: item.label,
                })}
              >
                <span className="max-w-40 truncate">{item.label}</span>
              </ComboboxChip>
            ))}
            {hiddenSelectedCount > 0 && (
              <Badge
                variant="secondary"
                aria-label={t("applications.additionalResources", {
                  count: hiddenSelectedCount,
                })}
              >
                +{hiddenSelectedCount}
              </Badge>
            )}
          </ComboboxValue>
          <ComboboxChipsInput
            id={id}
            aria-label={title}
            disabled={items.length === 0}
            placeholder={
              items.length === 0
                ? emptyLabel
                : selectedItems.length === 0
                  ? placeholder
                  : searchPlaceholder
            }
          />
        </ComboboxChips>
        <ComboboxContent>
          <ComboboxEmpty>{t("applications.resourceSearchEmpty")}</ComboboxEmpty>
          <ComboboxList>
            {(item: ApplicationResourceOption) => (
              <ComboboxItem
                key={item.id}
                value={item}
                disabled={item.disabled && !selected.has(item.id)}
              >
                <span className="min-w-0">
                  <span className="flex min-w-0 items-center gap-2">
                    <span className="truncate text-sm font-medium">
                      {item.label}
                    </span>
                    {item.detailInline && item.detail && (
                      <span className="shrink-0 text-xs text-muted-foreground">
                        {item.detail}
                      </span>
                    )}
                  </span>
                  {!item.detailInline && item.detail && (
                    <span className="block truncate text-xs text-muted-foreground">
                      {item.detail}
                    </span>
                  )}
                </span>
              </ComboboxItem>
            )}
          </ComboboxList>
        </ComboboxContent>
      </Combobox>
    </Field>
  )
}

function ApplicationShareDialog({
  application,
  onOpenChange,
}: {
  application: Application | null
  onOpenChange: (open: boolean) => void
}) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [shareTargetType, setShareTargetType] =
    useState<ApplicationShareTarget["type"]>("user")
  const [search, setSearch] = useState("")
  const [selectedTarget, setSelectedTarget] =
    useState<ApplicationShareTarget | null>(null)
  const [error, setError] = useState<string | null>(null)
  const applicationId = application?.id
  const grants = useQuery({
    queryKey: ["applications", applicationId, "grants"],
    queryFn: ({ signal }) =>
      apiRequest(`/applications/${applicationId}/grants`, {
        schema: applicationGrantPageSchema,
        signal,
      }),
    enabled: Boolean(applicationId),
  })
  const targets = useQuery({
    queryKey: ["applications", "share-targets", shareTargetType, search],
    queryFn: ({ signal }) =>
      apiRequest("/applications/share-targets", {
        query: { type: shareTargetType, search: search.trim() || undefined },
        schema: applicationShareTargetPageSchema,
        signal,
      }),
    enabled: Boolean(applicationId),
  })

  const grant = useMutation({
    mutationFn: (target: ApplicationShareTarget) =>
      apiRequest(`/applications/${applicationId}/grants`, {
        method: "POST",
        body:
          target.type === "user"
            ? { grantee_type: "user", user_id: target.id }
            : { grantee_type: "user_group", user_group_id: target.id },
        schema: applicationGrantSchema,
      }),
    onSuccess: async (createdGrant) => {
      queryClient.setQueryData<ApplicationGrantPage>(
        ["applications", applicationId, "grants"],
        (current) => {
          const items = current?.items ?? []
          const filtered = items.filter(
            (item) =>
              item.id !== createdGrant.id &&
              !(
                item.grantee_type === createdGrant.grantee_type &&
                item.target.id === createdGrant.target.id
              )
          )
          return {
            items: [createdGrant, ...filtered],
            next_cursor: current?.next_cursor ?? null,
          }
        }
      )
      setSelectedTarget(null)
      setSearch("")
      setError(null)
      notify.success(t("applications.shareSaved"))
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: ["applications", applicationId, "grants"],
        }),
        queryClient.invalidateQueries({ queryKey: ["applications"] }),
      ])
    },
    onError: (nextError) => setError(getErrorMessage(nextError, t)),
  })
  const revoke = useMutation({
    mutationFn: (item: ApplicationGrant) =>
      apiRequest(`/applications/${applicationId}/grants/${item.id}`, {
        method: "DELETE",
        schema: emptyResponseSchema,
      }),
    onSuccess: async () => {
      setError(null)
      await queryClient.invalidateQueries({
        queryKey: ["applications", applicationId, "grants"],
      })
    },
    onError: (nextError) => setError(getErrorMessage(nextError, t)),
  })
  const availableTargets = (targets.data?.items ?? []).filter(
    (target) =>
      target.type === shareTargetType &&
      !(grants.data?.items ?? []).some(
        (item) =>
          item.grantee_type === target.type && item.target.id === target.id
      )
  )
  const targetInputLabel = (target: ApplicationShareTarget) => target.name
  const selected =
    selectedTarget?.type === shareTargetType && search === selectedTarget.name
      ? selectedTarget
      : null
  const grantItems = grants.data?.items ?? []
  const selectedAlreadyShared =
    selected !== null &&
    grantItems.some(
      (item) =>
        item.grantee_type === selected.type && item.target.id === selected.id
    )
  const displayShareItems: ApplicationShareDisplayItem[] = [
    ...(selected && !selectedAlreadyShared
      ? [{ kind: "selected" as const, target: selected }]
      : []),
    ...grantItems.map((item) => ({ kind: "grant" as const, grant: item })),
  ]
  const shareTargetLabel =
    shareTargetType === "user"
      ? t("applications.shareUserTarget")
      : t("applications.shareGroupTarget")
  const shareSearchPlaceholder =
    shareTargetType === "user"
      ? t("applications.shareUserSearchPlaceholder")
      : t("applications.shareGroupSearchPlaceholder")

  return (
    <Dialog open={application !== null} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{t("applications.shareTitle")}</DialogTitle>
          <DialogDescription>
            {t("applications.shareDescription")}
          </DialogDescription>
        </DialogHeader>
        <FieldGroup>
          <Field>
            <FieldLabel>{t("applications.shareTargetType")}</FieldLabel>
            <Tabs
              value={shareTargetType}
              onValueChange={(value) => {
                if (value !== "user" && value !== "user_group") return
                setShareTargetType(value)
                setSelectedTarget(null)
                setSearch("")
                setError(null)
              }}
            >
              <TabsList
                className="share-target-type-options"
                aria-label={t("applications.shareTargetType")}
              >
                <TabsTrigger value="user">
                  <UserIcon aria-hidden="true" />
                  {t("applications.shareToUsers")}
                </TabsTrigger>
                <TabsTrigger value="user_group">
                  <UsersIcon aria-hidden="true" />
                  {t("applications.shareToGroups")}
                </TabsTrigger>
              </TabsList>
            </Tabs>
          </Field>
          <Field>
            <FieldLabel htmlFor="application-share-search">
              {shareTargetLabel}
            </FieldLabel>
            <Combobox
              items={availableTargets}
              value={selected}
              inputValue={search}
              disabled={grant.isPending}
              itemToStringLabel={targetInputLabel}
              itemToStringValue={(target) => `${target.type}:${target.id}`}
              isItemEqualToValue={(target, value) =>
                target.type === value.type && target.id === value.id
              }
              onInputValueChange={setSearch}
              onValueChange={(target) => {
                const nextTarget = target ?? null
                setSelectedTarget(nextTarget)
                setSearch(nextTarget?.name ?? "")
              }}
            >
              <ComboboxInput
                id="application-share-search"
                aria-label={shareTargetLabel}
                disabled={grant.isPending}
                placeholder={shareSearchPlaceholder}
                showClear={search.length > 0}
              />
              <ComboboxContent>
                <ComboboxEmpty>
                  {targets.isLoading
                    ? t("common.loading")
                    : targets.isError
                      ? getErrorMessage(targets.error, t)
                      : t("applications.resourceSearchEmpty")}
                </ComboboxEmpty>
                <ComboboxList>
                  {(target: ApplicationShareTarget) => (
                    <ComboboxItem
                      key={`${target.type}:${target.id}`}
                      value={target}
                    >
                      <span className="flex min-w-0 flex-1 items-center gap-2 whitespace-nowrap">
                        <span className="min-w-0 truncate font-medium">
                          {target.name}
                        </span>
                        {target.secondary_text && (
                          <span className="shrink-0 text-muted-foreground">
                            {target.secondary_text}
                          </span>
                        )}
                      </span>
                    </ComboboxItem>
                  )}
                </ComboboxList>
              </ComboboxContent>
            </Combobox>
          </Field>
          <Field>
            <FieldLabel>{t("applications.currentShares")}</FieldLabel>
            {grants.isLoading ? (
              <LoadingState />
            ) : displayShareItems.length === 0 ? (
              <p className="application-share-current-empty rounded-xl border p-4 text-sm text-muted-foreground">
                {t("applications.noShares")}
              </p>
            ) : (
              <div className="flex max-h-64 flex-col gap-2 overflow-y-auto">
                {displayShareItems.map((item) => {
                  const type =
                    item.kind === "grant"
                      ? item.grant.grantee_type
                      : item.target.type
                  const name =
                    item.kind === "grant"
                      ? item.grant.target.name
                      : item.target.name
                  return (
                    <div
                      key={
                        item.kind === "grant"
                          ? item.grant.id
                          : `selected:${item.target.type}:${item.target.id}`
                      }
                      className="application-share-current-item flex items-center justify-between gap-3 rounded-xl border p-3"
                    >
                      <div className="flex min-w-0 items-center gap-3">
                        {type === "user" ? (
                          <UserRoundIcon
                            aria-hidden="true"
                            className="size-5 shrink-0"
                          />
                        ) : (
                          <UsersIcon
                            aria-hidden="true"
                            className="size-5 shrink-0"
                          />
                        )}
                        <span className="min-w-0 flex-1 truncate text-sm">
                          {name}
                        </span>
                        <Badge variant="secondary" className="shrink-0">
                          {t(`applications.shareGrantType.${type}`)}
                        </Badge>
                      </div>
                      {item.kind === "grant" && (
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          disabled={revoke.isPending}
                          onClick={() => revoke.mutate(item.grant)}
                        >
                          {t("applications.revoke")}
                        </Button>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </Field>
        </FieldGroup>
        {error && <StatusBanner variant="error">{error}</StatusBanner>}
        <DialogFooter>
          <Button
            type="button"
            disabled={!selected || grant.isPending}
            onClick={() => {
              if (selected) grant.mutate(selected)
            }}
          >
            <Share2Icon data-icon="inline-start" />
            {t("applications.share")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function requiresCredentials(capability: CapabilitySummary): boolean {
  const risk = capability.risk_summary
  return (
    risk?.requires_credentials === true ||
    (Array.isArray(risk?.declared_environment_keys) &&
      risk.declared_environment_keys.length > 0)
  )
}
