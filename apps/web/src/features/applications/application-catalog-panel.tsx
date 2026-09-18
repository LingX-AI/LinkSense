import { DEFAULT_APPLICATION_ICON_PRESET } from "@linksense/shared"
import {
  applicationIconInputFor,
  type ApplicationIconFormState,
} from "./application-icon-form"
import { ApplicationIconField } from "./application-icon-field"
import { ApplicationVersionNumberInput } from "./application-version-number-input"
import { ApplicationMetadataPublishDialog } from "./application-metadata-dialog"
import { dialogBodyStyles } from "@/components/ui/dialog-layout"
import { ApplicationUsageGuideDialog } from "./application-usage-guide-dialog"
import { ApplicationDevelopmentCreateDialog } from "./application-development-create-dialog"
import {
  ApplicationCreateDialog,
  type ApplicationCreationMethod,
} from "./application-create-dialog"
import {
  useOpenApplicationDevelopment,
  useDeleteApplicationDevelopment,
} from "./application-development-api"
import { ApplicationDevelopmentCard } from "./application-development-card"
import { useApplicationCatalog } from "./application-catalog-queries"
import {
  ApplicationDetailsDialog,
  type ApplicationDetailsTarget,
} from "./application-details-dialog"
import { InteractiveDependencyFields } from "./interactive-dependency-fields"
import { InteractiveDeclarationDialog } from "./interactive-declaration-dialog"
import { ApplicationDistributionDialog } from "./application-distribution-dialog"
import {
  useApplicationDistributionSummaries,
  useApplicationDistributionSettings,
} from "./application-distribution-queries"
import { ApplicationDevelopmentPublishDialog } from "./application-development-publish-dialog"
import {
  applicationPublicationSchema,
  applicationVersionInputSchema,
  applicationReleaseVersionSchema,
  applicationVersionStatus,
  editAndPublishApplicationInputSchema,
  nextApplicationVersion,
  type ApplicationVersionInput,
} from "@linksense/shared"
import {
  ApplicationInstallationDialog,
  ApplicationInstallationUpdateDialog,
  type ApplicationInstallTarget,
} from "./application-installation-dialog"
import {
  useDeferredValue,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  ArrowRightIcon,
  ArrowUpRightIcon,
  ChartNoAxesCombinedIcon,
  CodeXmlIcon,
  ExternalLinkIcon,
  FileArchiveIcon,
  MoreHorizontalIcon,
  PencilIcon,
  PlusIcon,
  PowerIcon,
  Share2Icon,
  Trash2Icon,
  UploadIcon,
  UsersIcon,
} from "lucide-react"
import { useTranslation } from "react-i18next"
import { Link, useNavigate } from "react-router-dom"
import {
  INTERACTIVE_APPLICATION_ARCHIVE_MAX_BYTES,
  interactiveApplicationImportPreviewSchema,
  interactiveDependencyDeclarations,
  interactiveDependencySelectionSchema,
  type InteractiveDependencyBinding,
  type ReasoningEffort,
  type ApplicationCatalogFilter,
  type ApplicationDevelopmentSummary,
} from "@linksense/shared"
import { z } from "zod"

import { apiRequest } from "@/api/client"
import {
  applicationConversationSchema,
  applicationSchema,
  capabilitySummarySchema,
  mcpServerSchema,
  modelPreferenceSchema,
  paginatedSchema,
  type Application,
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
import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import { ResourceMultiSelect } from "./application-resource-multi-select"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
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
  FieldError,
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
import { Textarea } from "@/components/ui/textarea"
import { useKnowledgeBaseList } from "@/features/knowledge-bases/knowledge-base-hooks"
import {
  ApplicationCard,
  ApplicationCardResources,
  ApplicationCardModel,
} from "./application-card"

const mcpServerListSchema = z.strictObject({ items: z.array(mcpServerSchema) })
const emptyResponseSchema = z.unknown()
const USER_SELECTED_MODEL_VALUE = "__application_user_selected_model__"
const APPLICATION_SHARE_TARGET_PREVIEW_LIMIT = 2

export function InteractiveApplicationImportDialog({
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
  const queryClient = useQueryClient()
  const [error, setError] = useState<string | null>(null)
  const [bindings, setBindings] = useState<InteractiveDependencyBinding[]>([])
  const [declarationOpen, setDeclarationOpen] = useState(false)
  const [importedApplicationId, setImportedApplicationId] = useState<
    string | null
  >(null)
  const inputRef = useRef<HTMLInputElement | null>(null)
  const settings = useApplicationDistributionSettings(
    application?.id ?? "",
    open
  )
  const preview = useMutation({
    mutationFn: async () => {
      if (!file) throw new Error("APPLICATION_PACKAGE_REQUIRED")
      const body = new FormData()
      body.append("file", file)
      return apiRequest("/applications/interactive-import/preview", {
        method: "POST",
        body,
        query: { application_id: application?.id },
        schema: interactiveApplicationImportPreviewSchema,
      })
    },
    onError: (nextError) => setError(getErrorMessage(nextError, t)),
  })
  const packageVersion =
    preview.data?.application.version.replace(/^v/u, "") ?? ""
  const packageVersionStatus = applicationVersionStatus(
    packageVersion,
    settings.data?.highest_version_number ?? null
  )
  const packageVersionInvalid =
    preview.isSuccess &&
    (!applicationReleaseVersionSchema.safeParse(packageVersion).success ||
      (packageVersionStatus !== "new" &&
        !(application && packageVersionStatus === "same")))
  const mutation = useMutation({
    mutationFn: async () => {
      if (!file || !preview.data)
        throw new Error("APPLICATION_PACKAGE_REQUIRED")
      const release = applicationVersionInputSchema.parse({
        version_number: packageVersion,
        usage_instructions: application
          ? settings.data?.usage_instructions
          : "",
      })
      if (importedApplicationId) {
        await apiRequest(
          `/applications/${importedApplicationId}/interactive-dependencies`,
          {
            method: "PATCH",
            body: interactiveDependencySelectionSchema.parse({ bindings }),
            schema: applicationSchema,
          }
        )
        return apiRequest(`/applications/${importedApplicationId}/publish`, {
          method: "POST",
          body: release,
          schema: applicationPublicationSchema,
        })
      }
      const body = new FormData()
      body.append(
        "dependencies",
        JSON.stringify(interactiveDependencySelectionSchema.parse({ bindings }))
      )
      body.append("file", file)
      if (application) body.append("release", JSON.stringify(release))
      const imported = await apiRequest(
        application
          ? `/applications/${application.id}/interactive-package`
          : "/applications/interactive-import",
        {
          method: "POST",
          body,
          schema: applicationSchema,
        }
      )
      if (!application) {
        setImportedApplicationId(imported.id)
        await apiRequest(`/applications/${imported.id}/publish`, {
          method: "POST",
          body: release,
          schema: applicationPublicationSchema,
        })
      }
      return imported
    },
    onSuccess: () => onCompleted(),
    onError: async (nextError) => {
      setError(getErrorMessage(nextError, t))
      await queryClient.invalidateQueries({ queryKey: ["applications"] })
    },
  })

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (mutation.isPending || preview.isPending) return
        if (!nextOpen) {
          setFile(null)
          setError(null)
          setBindings([])
          setDeclarationOpen(false)
          setImportedApplicationId(null)
          preview.reset()
        }
        onOpenChange(nextOpen)
      }}
    >
      <DialogContent
        className="flex max-h-[calc(100dvh-2rem)] flex-col sm:max-w-xl"
        closeLabel={t("common.close")}
      >
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
        <FieldGroup className={dialogBodyStyles()}>
          <Field data-invalid={Boolean(error) || undefined}>
            <FieldLabel htmlFor="interactive-application-package">
              {t("applications.applicationPackage")}
            </FieldLabel>
            <Input
              ref={inputRef}
              id="interactive-application-package"
              type="file"
              accept=".zip,application/zip"
              disabled={
                mutation.isPending ||
                preview.isPending ||
                Boolean(importedApplicationId)
              }
              onChange={(event) => {
                const next = event.target.files?.[0] ?? null
                setError(null)
                setBindings([])
                preview.reset()
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
            <Button
              type="button"
              variant="link"
              size="xs"
              className="self-start"
              disabled={mutation.isPending || preview.isPending}
              onClick={() => setDeclarationOpen(true)}
            >
              {t("applications.declaration.title")}
              <ArrowRightIcon data-icon="inline-end" aria-hidden="true" />
            </Button>
          </Field>
          {preview.data && (
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="interactive-import-name">
                  {t("common.name")}
                </FieldLabel>
                <Input
                  id="interactive-import-name"
                  readOnly
                  value={preview.data.application.name}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="interactive-import-description">
                  {t("common.description")}
                </FieldLabel>
                <Textarea
                  id="interactive-import-description"
                  readOnly
                  value={preview.data.application.description ?? ""}
                  placeholder={t("applications.noDescription")}
                />
              </Field>
              <Field data-invalid={packageVersionInvalid}>
                <FieldLabel htmlFor="interactive-import-version">
                  {t("applications.distribution.versionNumber")}
                </FieldLabel>
                <ApplicationVersionNumberInput
                  id="interactive-import-version"
                  readOnly
                  value={packageVersion}
                  aria-invalid={packageVersionInvalid}
                />
                {packageVersionInvalid && (
                  <FieldError>
                    {t(
                      packageVersionStatus === "lower" ||
                        packageVersionStatus === "same"
                        ? "applications.distribution.editVersionLower"
                        : "applications.interactivePackageVersionInvalid",
                      { version: settings.data?.highest_version_number }
                    )}
                  </FieldError>
                )}
              </Field>
            </FieldGroup>
          )}
          {preview.data && (
            <InteractiveDependencyFields
              state={preview.data}
              disabled={mutation.isPending}
              onChange={(binding) =>
                setBindings((current) => [
                  ...current.filter(
                    (item) =>
                      item.type !== binding.type || item.id !== binding.id
                  ),
                  binding,
                ])
              }
            />
          )}
          {application && settings.error && (
            <ErrorState
              message={getErrorMessage(settings.error, t)}
              onRetry={() => void settings.refetch()}
            />
          )}
          {error && <StatusBanner variant="error">{error}</StatusBanner>}
          {error && importedApplicationId && (
            <StatusBanner>
              {t("applications.importPublicationRetry")}
            </StatusBanner>
          )}
        </FieldGroup>
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            disabled={mutation.isPending || preview.isPending}
            onClick={() => onOpenChange(false)}
          >
            {t("common.cancel")}
          </Button>
          <Button
            type="button"
            disabled={
              !file ||
              mutation.isPending ||
              preview.isPending ||
              (Boolean(application) && !settings.isSuccess) ||
              packageVersionInvalid
            }
            onClick={() => {
              setError(null)
              if (preview.data) mutation.mutate()
              else preview.mutate()
            }}
          >
            {mutation.isPending || preview.isPending ? (
              <Spinner data-icon="inline-start" />
            ) : (
              <UploadIcon data-icon="inline-start" aria-hidden="true" />
            )}
            {t(
              !preview.data
                ? "applications.dependencies.preview"
                : application
                  ? "applications.updatePackageAndPublish"
                  : "applications.importPackageAction"
            )}
          </Button>
        </DialogFooter>
        {declarationOpen && (
          <InteractiveDeclarationDialog
            onClose={() => setDeclarationOpen(false)}
          />
        )}
      </DialogContent>
    </Dialog>
  )
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
  icon: { mode: "preset", preset: DEFAULT_APPLICATION_ICON_PRESET },
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
  scope,
  search,
  state = "all",
  onInstalled,
  organizationSharingEnabled = true,
}: {
  onFeedback: (message: string, isError?: boolean) => void
  scope: "owned" | "shared"
  search: string
  state?: ApplicationCatalogFilter
  onInstalled?: () => void
  organizationSharingEnabled?: boolean
}) {
  const { t, i18n } = useTranslation()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const deferredSearch = useDeferredValue(search.trim())
  const development = useOpenApplicationDevelopment()
  const deleteDraft = useDeleteApplicationDevelopment()
  const [deleteDraftTarget, setDeleteDraftTarget] =
    useState<ApplicationDevelopmentSummary | null>(null)
  const [editor, setEditor] = useState<{
    open: boolean
    application: Application | null
  }>({ open: false, application: null })
  const [distributionTarget, setDistributionTarget] = useState<{
    application: Application
    mode: "direct" | "center"
  } | null>(null)
  const [publicationTarget, setPublicationTarget] =
    useState<Application | null>(null)
  const [releaseTarget, setReleaseTarget] = useState<Application | null>(null)
  const release = useMutation({
    mutationFn: (input: ApplicationVersionInput) =>
      apiRequest(`/applications/${releaseTarget?.id}/publish`, {
        method: "POST",
        schema: applicationPublicationSchema,
        body: input,
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["applications"] })
      setReleaseTarget(null)
    },
  })
  const [detailsTarget, setDetailsTarget] =
    useState<ApplicationDetailsTarget | null>(null)
  const [installTarget, setInstallTarget] =
    useState<ApplicationInstallTarget | null>(null)
  const [updateTarget, setUpdateTarget] = useState<Application | null>(null)
  const distribution = useApplicationDistributionSummaries()
  const [deleteTarget, setDeleteTarget] = useState<Application | null>(null)
  const [interactiveImportTarget, setInteractiveImportTarget] = useState<
    Application | undefined
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
  const applications = useApplicationCatalog(scope, deferredSearch, state)
  const catalogItems =
    applications.data?.pages.flatMap((page) => page.items) ?? []

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
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["applications"] }),
        queryClient.invalidateQueries({ queryKey: ["conversations"] }),
        queryClient.invalidateQueries({
          queryKey: ["application-development"],
        }),
      ])
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
      {applications.isLoading && <LoadingState />}
      {distribution.error && (
        <ErrorState
          message={getErrorMessage(distribution.error, t)}
          onRetry={() => void distribution.refetch()}
        />
      )}
      {applications.isError && (
        <ErrorState
          message={getErrorMessage(applications.error, t)}
          onRetry={() => void applications.refetch()}
        />
      )}
      {applications.data && catalogItems.length === 0 && (
        <EmptyState
          title={t(
            scope === "owned" && (state !== "all" || deferredSearch.length > 0)
              ? "applicationDevelopment.catalog.empty"
              : "applications.emptyTitle"
          )}
        />
      )}
      {catalogItems.length > 0 && (
        <div className="grid gap-4 md:grid-cols-2">
          {catalogItems.map((entry) => {
            if (entry.type === "development") {
              return (
                <ApplicationDevelopmentCard
                  key={`development:${entry.development.id}`}
                  development={entry.development}
                />
              )
            }
            const { application, development: draft } = entry
            const starting =
              startConversation.isPending &&
              startConversation.variables?.id === application.id
            const unavailable = !application.dependencies_available
            const hasDeclaredResources = application.interactive_package
              ? interactiveDependencyDeclarations(
                  application.interactive_package.manifest.dependencies
                ).length > 0
              : false
            const sharing = distribution.data?.items.find(
              (item) => item.application_id === application.id
            )
            const shareTargetSummary = formatApplicationShareTargets(
              application.share_targets,
              shareTargetListFormatter
            )
            const showShareTargets =
              organizationSharingEnabled && Boolean(shareTargetSummary)
            return (
              <ApplicationCard
                key={application.id}
                id={application.id}
                name={application.name}
                kind={application.kind}
                status={application.status}
                icon={application.icon}
                version={
                  application.kind === "interactive"
                    ? application.interactive_package?.version
                    : (sharing?.service_installation
                        ?.installed_version_number ??
                      sharing?.installation?.installed_version_number ??
                      sharing?.published_version_number)
                }
                description={application.description}
                onOpenDetails={setDetailsTarget}
                headerActions={
                  application.is_owner && (
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
                          {
                            <DropdownMenuItem
                              className="whitespace-nowrap"
                              onClick={() =>
                                setEditor({ open: true, application })
                              }
                            >
                              <PencilIcon aria-hidden="true" />
                              {t("common.edit")}
                            </DropdownMenuItem>
                          }
                          {application.kind === "interactive" && (
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
                          {application.kind === "interactive" && (
                            <DropdownMenuItem
                              disabled={development.isPending}
                              onClick={() =>
                                development.mutate(
                                  draft
                                    ? { developmentId: draft.id }
                                    : { applicationId: application.id },
                                  {
                                    onError: (error) =>
                                      onFeedback(
                                        getErrorMessage(error, t),
                                        true
                                      ),
                                  }
                                )
                              }
                            >
                              <CodeXmlIcon aria-hidden="true" />
                              {t(
                                draft
                                  ? "applicationDevelopment.catalog.continueDevelopment"
                                  : "applicationDevelopment.catalog.developNewVersion"
                              )}
                            </DropdownMenuItem>
                          )}
                          {sharing?.installation && (
                            <DropdownMenuItem
                              onClick={() => setUpdateTarget(application)}
                            >
                              {t("applications.distribution.checkUpdate")}
                            </DropdownMenuItem>
                          )}
                          {application.kind === "interactive" &&
                            !hasDeclaredResources &&
                            sharing?.installation && (
                              <DropdownMenuItem
                                onClick={() =>
                                  setEditor({ open: true, application })
                                }
                              >
                                {t("applications.distribution.configure")}
                              </DropdownMenuItem>
                            )}
                        </DropdownMenuGroup>
                        <DropdownMenuSeparator />
                        <DropdownMenuGroup>
                          <DropdownMenuItem
                            onClick={() => setReleaseTarget(application)}
                          >
                            <UploadIcon aria-hidden="true" />
                            {t("applicationDevelopment.publish.confirm")}
                          </DropdownMenuItem>
                          {organizationSharingEnabled && (
                            <>
                              <DropdownMenuItem
                                onClick={() =>
                                  setDistributionTarget({
                                    application,
                                    mode: "direct",
                                  })
                                }
                              >
                                <Share2Icon aria-hidden="true" />
                                {t("applications.distribution.direct")}
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                onClick={() =>
                                  setDistributionTarget({
                                    application,
                                    mode: "center",
                                  })
                                }
                              >
                                <UploadIcon aria-hidden="true" />
                                {t("applications.distribution.applyListing")}
                              </DropdownMenuItem>
                            </>
                          )}
                        </DropdownMenuGroup>
                        <DropdownMenuSeparator />
                        <DropdownMenuGroup>
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
                        </DropdownMenuGroup>
                        <DropdownMenuSeparator />
                        <DropdownMenuGroup>
                          {draft && (
                            <DropdownMenuItem
                              onClick={() => setDeleteDraftTarget(draft)}
                            >
                              <Trash2Icon aria-hidden="true" />
                              {t("applicationDevelopment.catalog.deleteDraft")}
                            </DropdownMenuItem>
                          )}
                          <DropdownMenuItem
                            className="whitespace-nowrap"
                            variant="destructive"
                            onClick={() => setDeleteTarget(application)}
                          >
                            <Trash2Icon aria-hidden="true" />
                            {t("applications.deleteAction")}
                          </DropdownMenuItem>
                        </DropdownMenuGroup>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  )
                }
                footer={
                  <div className="flex min-w-0 flex-col gap-1">
                    {(!showShareTargets ||
                      !application.is_owner ||
                      sharing?.installation) && (
                      <span className="min-w-0 truncate">
                        {application.is_owner
                          ? sharing?.installation
                            ? t("applications.distribution.installedVersion", {
                                version:
                                  sharing.installation.installed_version_number,
                              })
                            : t("applications.createdByMe")
                          : t("applications.createdBy", {
                              name: application.owner.name,
                            })}
                      </span>
                    )}
                    {showShareTargets && (
                      <span className="application-share-target-summary inline-flex max-w-full min-w-0 items-center gap-1.5">
                        <UsersIcon
                          className="size-3.5 shrink-0"
                          aria-hidden="true"
                        />
                        <span className="min-w-0 truncate">
                          {t("applications.shareTargets", {
                            targets: shareTargetSummary,
                          })}
                        </span>
                      </span>
                    )}
                  </div>
                }
                actions={
                  <>
                    {sharing?.installation?.update_available && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setUpdateTarget(application)}
                      >
                        {t("applications.distribution.updateAvailable")}
                      </Button>
                    )}
                    {!application.is_owner &&
                      sharing?.usage_modes.includes("service") &&
                      sharing.published_version_id &&
                      (!sharing.service_installation?.installed_version_id ||
                        sharing.service_installation.update_available) && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            if (sharing.published_version_id)
                              setInstallTarget({
                                id: application.id,
                                name: application.name,
                                versionId: sharing.published_version_id,
                                channel: "direct",
                                mode: "service",
                                versionNumber: sharing.published_version_number,
                                installedVersionNumber:
                                  sharing.service_installation
                                    ?.installed_version_number,
                              })
                          }}
                        >
                          {t(
                            sharing.service_installation?.update_available
                              ? "applications.distribution.updateAvailable"
                              : "applications.distribution.install"
                          )}
                        </Button>
                      )}
                    {!application.is_owner && (
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => setPublicationTarget(application)}
                      >
                        {t("applications.distribution.guide")}
                      </Button>
                    )}
                    {!application.is_owner &&
                      sharing?.usage_modes.includes("install") &&
                      sharing.published_version_id && (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={
                            Boolean(sharing.installed_application_id) &&
                            !sharing.copy_installation?.update_available
                          }
                          onClick={() => {
                            if (sharing.published_version_id)
                              setInstallTarget({
                                id: application.id,
                                name: application.name,
                                versionId: sharing.published_version_id,
                                versionNumber: sharing.published_version_number,
                                installedVersionNumber:
                                  sharing.copy_installation
                                    ?.installed_version_number,
                                channel: "direct",
                              })
                          }}
                        >
                          {t(
                            sharing.copy_installation?.update_available
                              ? "applications.distribution.updateAvailable"
                              : sharing.installed_application_id
                                ? "applications.distribution.installedLabel"
                                : "applications.distribution.install"
                          )}
                        </Button>
                      )}
                    {sharing?.installation?.setup_required ? (
                      <Button
                        size="sm"
                        onClick={() => setEditor({ open: true, application })}
                      >
                        {t("applications.distribution.completeSetup")}
                      </Button>
                    ) : (
                      (application.is_owner ||
                        sharing?.usage_modes.includes("service")) &&
                      sharing?.service_installation?.installed_version_id && (
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          aria-busy={starting || undefined}
                          disabled={
                            application.status !== "active" ||
                            unavailable ||
                            startConversation.isPending
                          }
                          onClick={() => startConversation.mutate(application)}
                        >
                          {starting && <Spinner data-icon="inline-start" />}
                          {t("applications.distribution.useService")}
                          {!starting && (
                            <ArrowUpRightIcon
                              data-icon="inline-end"
                              aria-hidden="true"
                            />
                          )}
                        </Button>
                      )
                    )}
                  </>
                }
              >
                <ApplicationCardResources
                  capability_count={application.capability_count}
                  knowledge_base_count={application.knowledge_base_count}
                  mcp_server_count={application.mcp_server_count}
                  hasNewDevelopment={draft?.has_changes ?? false}
                />
                <ApplicationCardModel model={application.model} />
                {unavailable &&
                  (application.is_owner ||
                    sharing?.usage_modes.includes("service")) && (
                    <StatusBanner variant="warning">
                      {t("applications.dependencyUnavailable")}
                    </StatusBanner>
                  )}
              </ApplicationCard>
            )
          })}
        </div>
      )}
      {applications.hasNextPage && (
        <Button
          className="self-center"
          variant="outline"
          disabled={applications.isFetchingNextPage}
          onClick={() => void applications.fetchNextPage()}
        >
          {applications.isFetchingNextPage && (
            <Spinner data-icon="inline-start" />
          )}
          {t("applicationDevelopment.catalog.loadMore")}
        </Button>
      )}

      {detailsTarget && (
        <ApplicationDetailsDialog
          target={detailsTarget}
          development={
            catalogItems.find(
              (entry) =>
                entry.type === "application" &&
                entry.application.id === detailsTarget.id
            )?.development
          }
          onClose={() => setDetailsTarget(null)}
        />
      )}
      <ConfirmDialog
        open={deleteDraftTarget !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteDraftTarget(null)
        }}
        title={t("applicationDevelopment.catalog.deleteDraft")}
        description={t("applicationDevelopment.catalog.deleteDraftDescription")}
        confirmLabel={t("common.delete")}
        destructive
        pending={deleteDraft.isPending}
        onConfirm={() => {
          if (deleteDraftTarget)
            deleteDraft.mutate(deleteDraftTarget.id, {
              onSuccess: () => setDeleteDraftTarget(null),
              onError: (error) => {
                setDeleteDraftTarget(null)
                onFeedback(getErrorMessage(error, t), true)
              },
            })
        }}
      />
      {distributionTarget && (
        <ApplicationDistributionDialog
          key={distributionTarget.application.id + distributionTarget.mode}
          application={distributionTarget.application}
          mode={distributionTarget.mode}
          onClose={() => setDistributionTarget(null)}
        />
      )}
      {publicationTarget && (
        <ApplicationUsageGuideDialog
          application={publicationTarget}
          onClose={() => setPublicationTarget(null)}
        />
      )}
      {releaseTarget && (
        <ApplicationDevelopmentPublishDialog
          applicationId={releaseTarget.id}
          name={releaseTarget.name}
          updating={Boolean(
            distribution.data?.items.find(
              (item) => item.application_id === releaseTarget.id
            )?.service_installation?.installed_version_id
          )}
          pending={release.isPending}
          changed={false}
          error={release.error}
          onClose={() => setReleaseTarget(null)}
          onConfirm={(input) => release.mutate(input)}
        />
      )}
      {installTarget && (
        <ApplicationInstallationDialog
          target={installTarget}
          onClose={() => setInstallTarget(null)}
          onInstalled={(application) => {
            setInstallTarget(null)
            if (onInstalled) onInstalled()
            else if (installTarget.mode !== "service")
              setEditor({ open: true, application })
            notify.success(t("applications.distribution.installed"))
          }}
        />
      )}
      {updateTarget && (
        <ApplicationInstallationUpdateDialog
          applicationId={updateTarget.id}
          onClose={() => setUpdateTarget(null)}
          onUpdated={() => {
            setUpdateTarget(null)
            notify.success(t("applications.distribution.updated"))
          }}
        />
      )}
      {editor.open && editor.application?.kind === "interactive" ? (
        <ApplicationMetadataPublishDialog
          key={editor.application.id}
          application={editor.application}
          onClose={() => setEditor({ open: false, application: null })}
          onSave={async (input, release) => {
            await apiRequest(
              `/applications/${editor.application!.id}/edit-and-publish`,
              {
                method: "POST",
                body: editAndPublishApplicationInputSchema.parse({
                  changes: input,
                  release,
                }),
                schema: applicationSchema,
              }
            )
            onFeedback(t("applications.editedAndPublished"))
            await queryClient.invalidateQueries({ queryKey: ["applications"] })
          }}
        />
      ) : (
        <ApplicationEditorDialog
          key={`${editor.open}:${editor.application?.id ?? "new"}:${editor.application?.updated_at ?? ""}`}
          open={editor.open}
          application={editor.application}
          onOpenChange={(open) =>
            setEditor((current) => ({ ...current, open }))
          }
          onCompleted={async (message) => {
            setEditor({ open: false, application: null })
            onFeedback(message)
            await queryClient.invalidateQueries({ queryKey: ["applications"] })
          }}
        />
      )}
      <InteractiveApplicationImportDialog
        key={`${interactiveImportTarget?.id ?? "new"}:${interactiveImportTarget !== undefined}`}
        application={interactiveImportTarget ?? null}
        open={interactiveImportTarget !== undefined}
        onOpenChange={(open) => {
          if (!open) setInteractiveImportTarget(undefined)
        }}
        onCompleted={async () => {
          setInteractiveImportTarget(undefined)
          onFeedback(t("applications.interactivePackageUpdated"))
          await queryClient.invalidateQueries({ queryKey: ["applications"] })
        }}
      />
      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null)
        }}
        title={t("applications.deleteTitle")}
        description={t(
          catalogItems.some(
            (item) =>
              item.type === "application" &&
              item.application.id === deleteTarget?.id &&
              item.development
          )
            ? "applicationDevelopment.deleteDescription"
            : "applications.deleteDescription"
        )}
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

export function ApplicationCreateButton({
  onFeedback,
}: {
  onFeedback: (message: string, isError?: boolean) => void
}) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [step, setStep] = useState<"choose" | ApplicationCreationMethod | null>(
    null
  )
  const complete = async (message: string) => {
    setStep(null)
    onFeedback(message)
    await queryClient.invalidateQueries({ queryKey: ["applications"] })
  }
  return (
    <>
      <Button type="button" onClick={() => setStep("choose")}>
        <PlusIcon data-icon="inline-start" />
        {t("applications.create")}
      </Button>
      <ApplicationCreateDialog
        open={step === "choose"}
        onOpenChange={(open) => setStep(open ? "choose" : null)}
        onChoose={setStep}
      />
      {step === "development" && (
        <ApplicationDevelopmentCreateDialog onClose={() => setStep(null)} />
      )}
      {step === "standard" && (
        <ApplicationEditorDialog
          open
          application={null}
          onOpenChange={(open) => {
            if (!open) setStep(null)
          }}
          onCompleted={complete}
        />
      )}
      {step === "interactive" && (
        <InteractiveApplicationImportDialog
          open
          application={null}
          onOpenChange={(open) => {
            if (!open) setStep(null)
          }}
          onCompleted={() => complete(t("applications.interactiveAppImported"))}
        />
      )}
    </>
  )
}

export function ApplicationEditorDialog({
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
  const queryClient = useQueryClient()
  const publishesStandard = !application || application.kind === "standard"
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
  const [iconReading, setIconReading] = useState(false)
  const settings = useApplicationDistributionSettings(
    application?.id ?? "",
    open && publishesStandard
  )
  const [editedVersion, setVersion] = useState<string | null>(null)
  const version =
    editedVersion ??
    (application
      ? (settings.data?.highest_version_number ??
        settings.data?.version_number ??
        "")
      : nextApplicationVersion(null))
  const [createdApplicationId, setCreatedApplicationId] = useState<
    string | null
  >(null)
  const versionStatus = applicationVersionStatus(
    version,
    settings.data?.highest_version_number ?? null
  )
  const versionInvalid =
    !applicationReleaseVersionSchema.safeParse(version).success ||
    (versionStatus !== "new" && !(application && versionStatus === "same"))

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
  const save = useMutation({
    mutationFn: async () => {
      const icon = applicationIconInputFor(form.icon)
      const savedId = application?.id ?? createdApplicationId
      const changes = {
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
      }
      if (application?.kind === "interactive") {
        return apiRequest(`/applications/${application.id}`, {
          method: "PATCH",
          body: changes,
          schema: applicationSchema,
        })
      }
      const release = applicationVersionInputSchema.parse({
        version_number: version,
        usage_instructions: settings.data?.usage_instructions ?? "",
      })
      if (application) {
        return apiRequest(`/applications/${application.id}/edit-and-publish`, {
          method: "POST",
          body: editAndPublishApplicationInputSchema.parse({
            changes,
            release,
          }),
          schema: applicationSchema,
        })
      }
      const saved = await apiRequest(
        savedId ? `/applications/${savedId}` : "/applications",
        {
          method: savedId ? "PATCH" : "POST",
          body: changes,
          schema: applicationSchema,
        }
      )
      setCreatedApplicationId(saved.id)
      await apiRequest(`/applications/${saved.id}/publish`, {
        method: "POST",
        body: release,
        schema: applicationPublicationSchema,
      })
      return saved
    },
    onSuccess: () =>
      onCompleted(
        t(
          application
            ? publishesStandard
              ? "applications.editedAndPublished"
              : "applications.updated"
            : "applications.created"
        )
      ),
    onError: async (nextError) => {
      setError(getErrorMessage(nextError, t))
      await queryClient.invalidateQueries({ queryKey: ["applications"] })
    },
  })

  const valid =
    form.name.trim().length > 0 &&
    form.instructions.trim().length > 0 &&
    (form.model.length === 0 || form.reasoningEffort.length > 0) &&
    (!publishesStandard ||
      (!versionInvalid && (!application || settings.isSuccess))) &&
    !iconReading

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!save.isPending) onOpenChange(nextOpen)
      }}
    >
      <DialogContent
        showCloseButton={!save.isPending}
        className="flex max-h-[calc(100dvh-2rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-5xl"
      >
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
                <ApplicationIconField
                  value={form.icon}
                  onChange={(icon) =>
                    setForm((current) => ({ ...current, icon }))
                  }
                  onReadingChange={setIconReading}
                  disabled={save.isPending}
                />
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
                {publishesStandard && (
                  <Field
                    data-invalid={
                      versionInvalid && (!application || settings.isSuccess)
                    }
                  >
                    <RequiredFieldLabel htmlFor="application-version">
                      {t("applications.distribution.versionNumber")}
                    </RequiredFieldLabel>
                    <ApplicationVersionNumberInput
                      id="application-version"
                      value={version}
                      onValueChange={setVersion}
                      required
                      disabled={
                        save.isPending ||
                        (Boolean(application) && !settings.isSuccess)
                      }
                      aria-invalid={
                        versionInvalid && (!application || settings.isSuccess)
                      }
                      aria-describedby="application-version-hint"
                    />
                    {application && settings.error ? (
                      <ErrorState
                        message={getErrorMessage(settings.error, t)}
                        onRetry={() => void settings.refetch()}
                      />
                    ) : application && settings.isPending ? (
                      <LoadingState />
                    ) : versionInvalid ? (
                      <FieldError id="application-version-hint">
                        {t(
                          versionStatus === "lower" || versionStatus === "same"
                            ? "applications.distribution.editVersionLower"
                            : "applications.distribution.versionInvalid",
                          { version: settings.data?.highest_version_number }
                        )}
                      </FieldError>
                    ) : (
                      <FieldDescription id="application-version-hint">
                        {t(
                          application
                            ? "applications.distribution.editVersionHint"
                            : "applications.distribution.versionHint"
                        )}
                      </FieldDescription>
                    )}
                  </Field>
                )}
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
              {createdApplicationId && (
                <StatusBanner>
                  {t("applications.createPublicationRetry")}
                </StatusBanner>
              )}
            </div>
          )}
        </div>
        <DialogFooter className="shrink-0 border-t border-divider px-6 py-4">
          <Button
            type="button"
            variant="outline"
            disabled={save.isPending}
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
            aria-busy={save.isPending || undefined}
            onClick={() => {
              setError(null)
              save.mutate()
            }}
          >
            {save.isPending && <Spinner data-icon="inline-start" />}
            {t(
              application
                ? publishesStandard
                  ? "applications.editAndPublish"
                  : "common.save"
                : "applications.createAndPublish"
            )}
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
