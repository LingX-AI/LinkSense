import type { ApplicationAnnotationSubmit } from "./application-annotation-submission"
import { ApplicationIconDisplay } from "./application-icon"
import { ApplicationMetadataDialog } from "./application-metadata-dialog"
import { apiRequest } from "@/api/client"
import { ApplicationTestHistory } from "./application-test-history"
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useTranslation } from "react-i18next"
import { XIcon } from "lucide-react"
import {
  APPLICATION_DEVELOPMENT_POLL_MS,
  applicationDevelopmentSchema,
  type ApplicationDevelopment,
} from "@linksense/shared"
import { useAuth } from "@/app/auth-state"
import { getErrorMessage } from "@/api/error-message"
import { Button } from "@/components/ui/button"
import { ApplicationDevelopmentMetadata } from "./application-development-metadata"
import {
  ApplicationDevelopmentPublishDialog,
  ApplicationDevelopmentPublishSuccessDialog,
} from "./application-development-publish-dialog"
import {
  ApplicationDevelopmentToolbar,
  type ApplicationDevelopmentView,
} from "./application-development-toolbar"
import {
  Empty,
  EmptyHeader,
  EmptyTitle,
  EmptyDescription,
} from "@/components/ui/empty"
import { StatusBanner } from "@/components/feedback/status-banner"
import { InteractiveApplicationPage } from "./interactive-application-page"
import { ApplicationDevelopmentCapabilitiesDialog } from "./application-development-capabilities-dialog"
import {
  applicationDevelopmentKeys,
  syncApplicationDevelopment,
  updateApplicationDevelopmentMetadata,
  installApplicationDevelopment,
} from "./application-development-api"
import { useApplicationDiagnostics } from "./use-application-diagnostics"
import { ApplicationDevelopmentGlow } from "./application-development-glow"

// Polling toolbar status must not rerender the iframe host and its task history.
const DevelopmentPreview = memo(InteractiveApplicationPage)

export function ApplicationDevelopmentPanel({
  initial,
  onSubmitAnnotations,
}: {
  initial: ApplicationDevelopment
  onSubmitAnnotations?: ApplicationAnnotationSubmit
}) {
  const { t } = useTranslation()
  const { user } = useAuth()
  const client = useQueryClient()
  const [annotationProject, setAnnotationProject] =
    useState<ApplicationDevelopment | null>(null)
  const [annotationControls, setAnnotationControls] =
    useState<HTMLDivElement | null>(null)
  const [capabilitiesOpen, setCapabilitiesOpen] = useState(false)
  const [tab, setTab] = useState<ApplicationDevelopmentView>("preview")
  const [metadataDialog, setMetadataDialog] =
    useState<ApplicationDevelopment | null>(null)
  const [metadataEditing, setMetadataEditing] = useState(false)
  const [publishSnapshot, setPublishSnapshot] = useState<{
    name: string
    sourceHash: string
    updating: boolean
  } | null>(null)
  const [published, setPublished] = useState<{
    name: string
    version: string
  } | null>(null)
  const [previewReset, setPreviewReset] = useState(0)
  const synchronizedPreview = useRef<{
    conversationId: string
    revision: number
  } | null>(
    initial.preview_current && initial.preview_conversation_id
      ? {
          conversationId: initial.preview_conversation_id,
          revision: initial.revision,
        }
      : null
  )
  const synchronizedTitle = useRef<Pick<
    ApplicationDevelopment,
    "conversation_id" | "name"
  > | null>({ conversation_id: initial.conversation_id, name: initial.name })
  const key = applicationDevelopmentKeys.preview(user?.id, initial.id)
  const preview = useQuery({
    queryKey: key,
    queryFn: ({ signal }) => syncApplicationDevelopment(initial.id, signal),
    initialData: initial,
    enabled: annotationProject === null,
    refetchInterval:
      annotationProject !== null ||
      capabilitiesOpen ||
      metadataEditing ||
      metadataDialog !== null
        ? false
        : APPLICATION_DEVELOPMENT_POLL_MS,
    refetchIntervalInBackground: false,
    retry: false,
  })
  const project = annotationProject ?? preview.data
  const onAnnotationActiveChange = useCallback(
    (active: boolean) => {
      if (active) {
        void client.cancelQueries({
          queryKey: applicationDevelopmentKeys.preview(user?.id, initial.id),
        })
        setAnnotationProject(
          (current) =>
            current ??
            client.getQueryData<ApplicationDevelopment>(
              applicationDevelopmentKeys.preview(user?.id, initial.id)
            ) ??
            initial
        )
      } else setAnnotationProject(null)
    },
    [client, user?.id, initial]
  )
  const annotation = useMemo(
    () =>
      onSubmitAnnotations
        ? {
            project,
            controlsContainer: annotationControls,
            onSubmit: onSubmitAnnotations,
            onActiveChange: onAnnotationActiveChange,
          }
        : undefined,
    [project, annotationControls, onSubmitAnnotations, onAnnotationActiveChange]
  )
  useEffect(() => {
    if (
      !preview.isFetchedAfterMount ||
      !preview.isSuccess ||
      !project.preview_current ||
      !project.preview_conversation_id
    )
      return
    const previous = synchronizedPreview.current
    if (
      previous?.conversationId === project.preview_conversation_id &&
      previous.revision === project.revision
    )
      return
    synchronizedPreview.current = {
      conversationId: project.preview_conversation_id,
      revision: project.revision,
    }
    // An unused test retains its conversation ID when its preview package changes.
    void client.invalidateQueries({
      queryKey: ["conversation", project.preview_conversation_id],
    })
    void client.invalidateQueries({
      queryKey: [
        "applications",
        "detail",
        user?.id,
        project.preview_application_id,
      ],
    })
  }, [
    client,
    user?.id,
    preview.isFetchedAfterMount,
    preview.isSuccess,
    project.preview_current,
    project.preview_conversation_id,
    project.preview_application_id,
    project.revision,
  ])
  useEffect(() => {
    if (
      !preview.isFetchedAfterMount ||
      !preview.isSuccess ||
      (synchronizedTitle.current?.conversation_id === project.conversation_id &&
        synchronizedTitle.current.name === project.name)
    )
      return
    synchronizedTitle.current = {
      conversation_id: project.conversation_id,
      name: project.name,
    }
    void client.invalidateQueries({
      queryKey: ["conversation", project.conversation_id],
    })
    void client.invalidateQueries({ queryKey: ["conversations"] })
  }, [
    client,
    preview.isFetchedAfterMount,
    preview.isSuccess,
    project.conversation_id,
    project.name,
  ])
  const reporting = useApplicationDiagnostics(
    project.id,
    project.revision,
    project.preview_current
  )
  const install = useMutation({
    mutationFn: (input: {
      sourceHash: string
      release: import("@linksense/shared").ApplicationVersionInput
    }) =>
      installApplicationDevelopment(
        project.id,
        input.sourceHash,
        input.release
      ),
    onMutate: () => client.cancelQueries({ queryKey: key }),
    onSuccess: async (next, input) => {
      client.setQueryData(key, next)
      setPublishSnapshot(null)
      setPublished({ name: next.name, version: input.release.version_number })
      await client.invalidateQueries({ queryKey: ["applications"] })
    },
  })
  const restart = useMutation({
    mutationFn: () =>
      apiRequest(
        `/application-developments/${project.id}/test-sessions/restart`,
        {
          method: "POST",
          body: {
            preview_conversation_id: project.preview_conversation_id,
            revision: project.revision,
          },
          schema: applicationDevelopmentSchema,
        }
      ),
    onMutate: () => client.cancelQueries({ queryKey: key }),
    onSuccess: async (next) => {
      client.setQueryData(key, next)
      setPreviewReset((value) => value + 1)
      setTab("preview")
      await client.invalidateQueries({
        queryKey: applicationDevelopmentKeys.tests(user?.id, project.id),
      })
    },
  })
  const installed = Boolean(
    project.application_id &&
    project.source_hash &&
    !project.source_error &&
    project.source_hash === project.installed_source_hash
  )
  const diagnostics = reporting.diagnostics ?? project.diagnostics
  const error = restart.error ?? preview.error ?? reporting.error
  return (
    <section
      className="flex h-full min-h-0 min-w-0 flex-col bg-background"
      aria-label={t("applicationDevelopment.workspace")}
    >
      <header className="flex min-w-0 items-center gap-2 border-b border-[color:var(--app-border)] px-3 py-1.5">
        <Button
          variant="ghost"
          size="icon"
          className="size-12 shrink-0"
          aria-label={t("applications.editMetadata")}
          disabled={
            annotationProject !== null ||
            metadataEditing ||
            install.isPending ||
            !project.source_hash ||
            Boolean(project.source_error)
          }
          onClick={() => {
            void client.cancelQueries({ queryKey: key })
            setMetadataDialog(project)
          }}
        >
          <ApplicationIconDisplay icon={project.icon} className="size-12" />
        </Button>
        <div className="min-w-0 flex-1">
          <ApplicationDevelopmentMetadata
            project={project}
            published={installed}
            disabled={
              annotationProject !== null ||
              install.isPending ||
              capabilitiesOpen ||
              Boolean(publishSnapshot) ||
              metadataDialog !== null
            }
            onEditingChange={(editing) => {
              setMetadataEditing(editing)
              if (editing) void client.cancelQueries({ queryKey: key })
            }}
            onUpdated={(next) => {
              client.setQueryData(key, next)
              void client.invalidateQueries({ queryKey: ["applications"] })
            }}
            onReload={() => void preview.refetch()}
          />
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {onSubmitAnnotations && (
            <div
              ref={setAnnotationControls}
              hidden={tab !== "preview"}
              className="[&[hidden]]:hidden"
            />
          )}
          <ApplicationDevelopmentToolbar
            publishDisabled={
              annotationProject !== null ||
              install.isPending ||
              metadataEditing ||
              metadataDialog !== null ||
              capabilitiesOpen ||
              !project.source_hash ||
              Boolean(project.source_error) ||
              installed
            }
            onPublish={() => {
              if (!project.source_hash) return
              install.reset()
              setPublishSnapshot({
                name: project.name,
                sourceHash: project.source_hash,
                updating: Boolean(project.application_id),
              })
            }}
            publishLabel={t(
              install.isPending
                ? "applicationDevelopment.publish.pending"
                : project.application_id
                  ? "applicationDevelopment.publish.update"
                  : "applicationDevelopment.publish.action"
            )}
            view={tab}
            onViewChange={setTab}
            diagnosticCount={diagnostics.length}
            onNewConversation={() => restart.mutate()}
            newConversationDisabled={
              annotationProject !== null ||
              restart.isPending ||
              !project.preview_current ||
              Boolean(project.source_error)
            }
            onConfigure={() => {
              if (!annotationProject) setCapabilitiesOpen(true)
            }}
            configureDisabled={annotationProject !== null}
          />
        </div>
      </header>
      {metadataDialog && (
        <ApplicationMetadataDialog
          draft
          initial={{
            name: metadataDialog.name,
            description: metadataDialog.manifest?.description ?? null,
            icon: metadataDialog.icon,
          }}
          onClose={() => setMetadataDialog(null)}
          onSave={async (input) => {
            const next = await updateApplicationDevelopmentMetadata(
              metadataDialog.id,
              { ...input, source_hash: metadataDialog.source_hash! }
            )
            client.setQueryData(key, next)
            await client.invalidateQueries({ queryKey: ["applications"] })
          }}
        />
      )}
      {error && (
        <div className="px-4 pt-3">
          <StatusBanner variant="error">
            {getErrorMessage(error, t)}
          </StatusBanner>
        </div>
      )}
      {project.source_error && (
        <div className="px-4 pt-3">
          <StatusBanner variant="error">
            {t("applicationDevelopment.sourceError")}
          </StatusBanner>
        </div>
      )}
      {!project.source_error &&
        project.preview_conversation_id &&
        !project.preview_current && (
          <div className="px-4 pt-3">
            <StatusBanner>
              {t("applicationDevelopment.waitingForTest")}
            </StatusBanner>
          </div>
        )}
      <div className="flex min-h-0 flex-1 flex-col">
        <section
          aria-label={t("applicationDevelopment.preview")}
          hidden={tab !== "preview"}
          className="relative isolate min-h-0 flex-1 overflow-hidden [&[hidden]]:hidden"
        >
          {project.preview_application_id && project.preview_conversation_id ? (
            <DevelopmentPreview
              key={previewReset}
              applicationId={project.preview_application_id}
              conversationId={project.preview_conversation_id}
              onDiagnostic={reporting.onDiagnostic}
              annotation={annotation}
            />
          ) : (
            <Empty>
              <EmptyHeader>
                <EmptyTitle>{t("applicationDevelopment.preparing")}</EmptyTitle>
                <EmptyDescription>
                  {t("applicationDevelopment.preparingHint")}
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          )}
          <ApplicationDevelopmentGlow
            conversationId={project.conversation_id}
            visible={tab === "preview"}
          />
        </section>
        {tab !== "preview" && (
          <div className="flex items-center justify-between gap-2 px-4 pt-2">
            <h3 className="min-w-0 truncate text-sm font-medium">
              {tab === "tests"
                ? t("applicationDevelopment.tests.title")
                : t("applicationDevelopment.diagnostics", {
                    count: diagnostics.length,
                  })}
            </h3>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={t("common.close")}
              onClick={() => setTab("preview")}
            >
              <XIcon />
            </Button>
          </div>
        )}
        {tab === "tests" && (
          <section
            aria-label={t("applicationDevelopment.tests.title")}
            className="flex min-h-0 flex-1 flex-col"
          >
            <ApplicationTestHistory project={project} />
          </section>
        )}
        {tab === "diagnostics" && (
          <section
            aria-label={t("applicationDevelopment.diagnostics", {
              count: diagnostics.length,
            })}
            className="flex min-h-0 flex-1 flex-col overflow-y-auto p-4"
          >
            {diagnostics.length ? (
              <ul className="flex flex-col gap-3">
                {diagnostics.map((item) => (
                  <li
                    className="rounded-lg border border-[color:var(--app-border)] p-3"
                    key={`${item.file}:${item.line}:${item.message}`}
                  >
                    <p className="text-sm break-words">{item.message}</p>
                    {item.file && (
                      <p className="mt-2 text-xs break-all text-muted-foreground">
                        {item.file}
                        {item.line > 0 ? `:${item.line}` : ""}
                      </p>
                    )}
                  </li>
                ))}
              </ul>
            ) : (
              <Empty>
                <EmptyHeader>
                  <EmptyTitle>
                    {t("applicationDevelopment.noErrors")}
                  </EmptyTitle>
                  <EmptyDescription>
                    {t("applicationDevelopment.noErrorsHint")}
                  </EmptyDescription>
                </EmptyHeader>
              </Empty>
            )}
          </section>
        )}
      </div>
      {publishSnapshot && (
        <ApplicationDevelopmentPublishDialog
          name={publishSnapshot.name}
          applicationId={
            project.application_id ?? project.preview_application_id ?? ""
          }
          updating={publishSnapshot.updating}
          pending={install.isPending}
          changed={
            publishSnapshot.sourceHash !== project.source_hash ||
            Boolean(project.source_error)
          }
          error={install.error}
          onClose={() => setPublishSnapshot(null)}
          onConfirm={(release) => {
            if (!install.isPending)
              install.mutate({
                sourceHash: publishSnapshot.sourceHash,
                release,
              })
          }}
        />
      )}
      {published && (
        <ApplicationDevelopmentPublishSuccessDialog
          name={published.name}
          version={published.version}
          onClose={() => setPublished(null)}
        />
      )}
      {capabilitiesOpen && (
        <ApplicationDevelopmentCapabilitiesDialog
          developmentId={project.id}
          onClose={() => {
            setCapabilitiesOpen(false)
            void preview.refetch()
          }}
        />
      )}
    </section>
  )
}
