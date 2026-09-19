import { LoadingState } from "@/components/feedback/page-state"
import {
  useInteractiveTaskState,
  refreshesInteractiveTaskState,
} from "./use-interactive-task-state"
import {
  ApplicationAnnotationPreview,
  type ApplicationAnnotationOptions,
} from "./application-annotation-preview"
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { MessageCircleIcon, PanelRightCloseIcon } from "lucide-react"
import { useTranslation } from "react-i18next"
import { Navigate, useParams } from "react-router-dom"
import { z } from "zod"
import {
  applicationDevelopmentDiagnosticSchema,
  interactiveApplicationRuntimeTokenResultSchema,
  interactiveApplicationTaskInputSchema,
} from "@linksense/shared"

import {
  applicationSchema,
  capabilitySummarySchema,
  mcpServerSchema,
  paginatedSchema,
  type ConversationEvent,
} from "@/api/contracts"
import { ApiError, apiRequest } from "@/api/client"
import { createInteractiveApplicationFiles } from "./interactive-application-files"
import { getErrorMessage } from "@/api/error-message"
import { useAuth } from "@/app/auth-state"
import { interactiveCustomEvent } from "@/features/applications/interactive-application-event"
import { createInteractiveApplicationSubmitter } from "@/features/applications/interactive-application-submission"
import { InteractiveApplicationSplitLayout } from "@/features/applications/interactive-application-split-layout"
import { conversationPath } from "@/features/conversations/conversation-navigation"
import { listKnowledgeBases } from "@/features/knowledge-bases/knowledge-base-api"
import { Button } from "@/components/ui/button"
import { Empty, EmptyHeader, EmptyTitle } from "@/components/ui/empty"
import { StatusBanner } from "@/components/feedback/status-banner"
import { ConversationPage } from "@/pages/conversation-pages"
import { conversationDetailQueryOptions } from "@/features/conversations/conversation-detail-query"

const protocol = "linksense.interactive.v1"
const mcpListSchema = z.strictObject({ items: z.array(mcpServerSchema) })
const sdkRequestSchema = z.strictObject({
  protocol: z.literal(protocol),
  instanceId: z.string().uuid(),
  type: z.literal("request"),
  requestId: z.string().min(1).max(120),
  method: z.enum([
    "context.getCurrentUser",
    "resources.listCapabilities",
    "resources.listKnowledgeBases",
    "resources.listMcpServers",
    "tasks.run",
    "tasks.getState",
    "tasks.interrupt",
    "files.upload",
    "files.list",
    "files.remove",
    "chat.show",
    "chat.hide",
    "chat.toggle",
  ]),
  params: z.record(z.string(), z.unknown()),
})

export function InteractiveApplicationPage(
  props: {
    applicationId?: string
    conversationId?: string
    annotation?: ApplicationAnnotationOptions
    onDiagnostic?: (
      diagnostic: import("@linksense/shared").ApplicationDevelopmentDiagnostic
    ) => void
  } = {}
) {
  const params = useParams()
  const applicationId = props.applicationId ?? params.applicationId ?? ""
  const conversationId = props.conversationId ?? params.conversationId ?? ""
  const { user } = useAuth()
  return (
    <InteractiveApplicationRuntime
      key={`${user?.id}:${applicationId}:${conversationId}`}
      applicationId={applicationId}
      conversationId={conversationId}
      onDiagnostic={props.onDiagnostic}
      annotation={props.annotation}
    />
  )
}

function InteractiveApplicationRuntime({
  applicationId,
  conversationId,
  onDiagnostic,
  annotation,
}: {
  applicationId: string
  conversationId: string
  annotation?: ApplicationAnnotationOptions
  onDiagnostic?: (
    diagnostic: import("@linksense/shared").ApplicationDevelopmentDiagnostic
  ) => void
}) {
  const { t } = useTranslation()
  const { user } = useAuth()
  const queryClient = useQueryClient()
  const frameRef = useRef<HTMLIFrameElement | null>(null)
  const pendingCustomEventsRef = useRef<Array<Record<string, unknown>>>([])
  const seenCustomEventIdsRef = useRef(new Set<string>())
  const [instanceId] = useState(() => crypto.randomUUID())
  const [chatOpen, setChatOpen] = useState(
    () => !onDiagnostic && !window.matchMedia("(max-width: 767px)").matches
  )
  const [frameReady, setFrameReady] = useState(false)
  const [loadedFrameSource, setLoadedFrameSource] = useState<string | null>(
    null
  )
  const [error, setError] = useState<string | null>(null)
  const applicationFiles = useMemo(
    () => createInteractiveApplicationFiles({ queryClient, conversationId }),
    [queryClient, conversationId]
  )
  const submitApplicationTurn = useMemo(
    () =>
      createInteractiveApplicationSubmitter({
        queryClient,
        applicationId,
        conversationId,
      }),
    [queryClient, applicationId, conversationId]
  )

  const conversation = useQuery({
    ...conversationDetailQueryOptions(conversationId),
    enabled: Boolean(conversationId),
  })
  const conversationApplication = conversation.data?.application
  const applicationDeleted =
    conversationApplication?.unavailable_reason === "APPLICATION_DELETED"
  const application = useQuery({
    queryKey: ["applications", "detail", user?.id, applicationId],
    queryFn: ({ signal }) =>
      apiRequest(`/applications/${applicationId}`, {
        schema: applicationSchema,
        signal,
      }),
    enabled: Boolean(user?.id && applicationId && !applicationDeleted),
  })
  const runtimePackageId =
    conversationApplication?.kind === "interactive"
      ? conversationApplication.package_id
      : null
  const runtimeToken = useQuery({
    queryKey: [
      "applications",
      "interactive-runtime-token",
      user?.id,
      applicationId,
      runtimePackageId,
      conversationId,
    ],
    queryFn: ({ signal }) =>
      apiRequest(`/applications/${applicationId}/interactive-runtime-token`, {
        method: "POST",
        body: { package_id: runtimePackageId, conversation_id: conversationId },
        schema: interactiveApplicationRuntimeTokenResultSchema,
        signal,
      }),
    enabled: Boolean(
      user?.id &&
      runtimePackageId &&
      conversationApplication?.id === applicationId &&
      !applicationDeleted &&
      application.isSuccess &&
      application.data.status === "active" &&
      application.data.dependencies_available
    ),
    staleTime: 8 * 60 * 1_000,
  })
  const runtimeUnavailableMessage = applicationDeleted
    ? t("errors.application.deleted")
    : conversationApplication?.unavailable_reason ===
          "APPLICATION_CENTER_UNAVAILABLE" ||
        [application.error, runtimeToken.error].some(
          (error) =>
            error instanceof ApiError &&
            error.errorCode === "APPLICATION_CENTER_UNAVAILABLE"
        )
      ? t("errors.application.centerUnavailable")
      : application.isError ||
          runtimeToken.isError ||
          application.data?.kind === "standard" ||
          application.data?.status === "disabled" ||
          application.data?.dependencies_available === false ||
          (conversation.isSuccess && !runtimePackageId)
        ? t("applications.interactiveRuntimeUnavailable")
        : undefined
  const permissions = useMemo(
    () => new Set(runtimeToken.data?.manifest.permissions ?? []),
    [runtimeToken.data?.manifest.permissions]
  )
  const [annotationSession, setAnnotationSession] = useState<{
    source: string
    packageId: string
  } | null>(null)
  const frameSource =
    annotationSession?.source ?? runtimeToken.data?.runtime_url
  const onAnnotationActiveChange = annotation?.onActiveChange
  const annotationRuntime = useRef({
    source: runtimeToken.data?.runtime_url,
    packageId: runtimePackageId,
    onActiveChange: onAnnotationActiveChange,
  })
  useLayoutEffect(() => {
    annotationRuntime.current = {
      source: runtimeToken.data?.runtime_url,
      packageId: runtimePackageId,
      onActiveChange: onAnnotationActiveChange,
    }
  }, [
    runtimeToken.data?.runtime_url,
    runtimePackageId,
    onAnnotationActiveChange,
  ])
  const handleAnnotationActiveChange = useCallback((active: boolean) => {
    const { source, packageId, onActiveChange } = annotationRuntime.current
    setAnnotationSession((current) =>
      active
        ? (current ?? (source && packageId ? { source, packageId } : null))
        : null
    )
    onActiveChange?.(active)
  }, [])

  const postToFrame = useCallback(
    (message: Record<string, unknown>) => {
      frameRef.current?.contentWindow?.postMessage(
        { protocol, instanceId, ...message },
        "*"
      )
    },
    [instanceId]
  )

  const taskState = useInteractiveTaskState({
    conversationId,
    enabled: frameReady && permissions.has("tasks:write"),
    post: postToFrame,
  })

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (event.source !== frameRef.current?.contentWindow) return
      if (
        onDiagnostic &&
        event.data?.protocol === "linksense:development" &&
        event.data.type === "diagnostic"
      ) {
        const parsed = applicationDevelopmentDiagnosticSchema.safeParse(
          event.data.diagnostic
        )
        if (parsed.success) onDiagnostic(parsed.data)
        return
      }
      if (event.data?.protocol !== protocol) return
      if (event.data.type === "ready") {
        postToFrame({ type: "initialize" })
        return
      }
      if (
        event.data.type === "initialized" &&
        event.data.instanceId === instanceId
      ) {
        setFrameReady(true)
        for (const pendingEvent of pendingCustomEventsRef.current.splice(0)) {
          postToFrame(pendingEvent)
        }
        return
      }
      const request = sdkRequestSchema.safeParse(event.data)
      if (!request.success || request.data.instanceId !== instanceId) return
      void handleSdkRequest(request.data)
        .then((result) =>
          postToFrame({
            type: "response",
            requestId: request.data.requestId,
            ok: true,
            result,
          })
        )
        .catch((nextError: unknown) =>
          postToFrame({
            type: "response",
            requestId: request.data.requestId,
            ok: false,
            error:
              nextError instanceof ApiError
                ? nextError.errorCode
                : nextError instanceof Error
                  ? nextError.message
                  : "LINKSENSE_SDK_REQUEST_FAILED",
          })
        )
    }

    const handleSdkRequest = async (
      request: z.infer<typeof sdkRequestSchema>
    ): Promise<unknown> => {
      switch (request.method) {
        case "context.getCurrentUser":
          requirePermission("user.profile:read")
          return {
            id: user?.id,
            name: user?.name,
            avatar_url: user?.avatar_url ?? null,
            language: user?.language ?? "zh-CN",
          }
        case "resources.listCapabilities":
          requirePermission("capabilities:read")
          return apiRequest("/capabilities", {
            query: { view: "available", limit: 500 },
            schema: paginatedSchema(capabilitySummarySchema),
          }).then((page) => ({
            items: page.items.map((item) => ({
              id: item.id,
              name: item.name,
              type: item.type,
              description: item.description,
              status: item.status,
              can_select: item.can_select ?? true,
              logo_url: item.logo_url,
            })),
          }))
        case "resources.listKnowledgeBases":
          requirePermission("knowledge_bases:read")
          return listKnowledgeBases({
            lifecycle: "active",
            scope: "all",
            limit: 100,
          }).then((page) => ({
            items: page.items.map((item) => ({
              id: item.id,
              name: item.name,
              description: item.description,
              lifecycle_status: item.lifecycle_status,
              availability_status: item.availability_status,
            })),
          }))
        case "resources.listMcpServers":
          requirePermission("mcp_servers:read")
          return apiRequest("/mcp-servers", { schema: mcpListSchema }).then(
            (page) => ({
              items: page.items.map((item) => ({
                id: item.id,
                name: item.name,
                status: item.status,
                transport: item.transport,
              })),
            })
          )
        case "files.upload":
          requirePermission("files:write")
          return applicationFiles.upload(request.params)
        case "files.list":
          requirePermission("files:write")
          return applicationFiles.list()
        case "files.remove":
          requirePermission("files:write")
          return applicationFiles.remove(request.params)
        case "tasks.getState":
          requirePermission("tasks:write")
          return taskState.getState()
        case "tasks.run": {
          requirePermission("tasks:write")
          const input = interactiveApplicationTaskInputSchema.parse(
            request.params
          )
          if (input.file_ids.length > 0) requirePermission("files:write")
          if (applicationFiles.busy)
            throw new ApiError({ status: 409, errorCode: "CONFLICT" })
          setError(null)
          setChatOpen(true)
          try {
            return await submitApplicationTurn(input)
          } catch (nextError) {
            setError(getErrorMessage(nextError, t))
            throw nextError
          } finally {
            void taskState.refresh()
          }
        }
        case "tasks.interrupt": {
          requirePermission("tasks:write")
          const { turnId } = z
            .strictObject({ turnId: z.string().uuid() })
            .parse(request.params)
          return apiRequest(
            `/conversations/${conversationId}/turns/${turnId}/interrupt`,
            { method: "POST", schema: z.unknown() }
          )
        }
        case "chat.show":
          setChatOpen(true)
          return { open: true }
        case "chat.hide":
          setChatOpen(false)
          return { open: false }
        case "chat.toggle":
          setChatOpen((current) => !current)
          return { open: !chatOpen }
      }
    }

    const requirePermission = (
      permission:
        | "user.profile:read"
        | "capabilities:read"
        | "knowledge_bases:read"
        | "mcp_servers:read"
        | "tasks:write"
        | "files:write"
    ) => {
      if (!permissions.has(permission)) {
        throw new Error("LINKSENSE_SDK_PERMISSION_DENIED")
      }
    }

    window.addEventListener("message", handleMessage)
    return () => window.removeEventListener("message", handleMessage)
  }, [
    taskState,
    onDiagnostic,
    chatOpen,
    applicationFiles,
    conversationId,
    instanceId,
    permissions,
    postToFrame,
    queryClient,
    submitApplicationTurn,
    t,
    user,
  ])

  const handleApplicationEvent = useCallback(
    (event: ConversationEvent) => {
      if (frameReady && refreshesInteractiveTaskState(event))
        void taskState.refresh()
      const custom = interactiveCustomEvent(event)
      if (!custom || seenCustomEventIdsRef.current.has(custom.id)) return
      seenCustomEventIdsRef.current.add(custom.id)
      const message = {
        type: "custom-event",
        name: custom.name,
        event: custom,
      }
      if (!frameReady) {
        pendingCustomEventsRef.current.push(message)
        return
      }
      postToFrame(message)
    },
    [frameReady, postToFrame, taskState]
  )

  if (conversation.data?.application?.kind !== undefined) {
    if (conversation.data.application?.kind !== "interactive") {
      return <Navigate to={`/conversations/${conversationId}`} replace />
    }
    const canonicalPath = conversationPath(conversation.data)
    if (conversation.data.application.id !== applicationId) {
      return <Navigate to={canonicalPath} replace />
    }
  }

  if (conversation.isError) {
    return (
      <div className="p-6">
        <StatusBanner variant="error">
          {t("applications.interactiveRuntimeUnavailable")}
        </StatusBanner>
      </div>
    )
  }

  return (
    <InteractiveApplicationSplitLayout
      chatOpen={chatOpen}
      resizeLabel={t("applications.resizeNativeChat")}
      application={
        <>
          {runtimeUnavailableMessage ? (
            <Empty className="h-full" role="status">
              <EmptyHeader>
                <EmptyTitle>{runtimeUnavailableMessage}</EmptyTitle>
              </EmptyHeader>
            </Empty>
          ) : frameSource ? (
            annotation && runtimePackageId ? (
              <ApplicationAnnotationPreview
                key={frameSource}
                source={frameSource}
                packageId={annotationSession?.packageId ?? runtimePackageId}
                title={
                  application.data?.name ?? t("applications.interactiveApp")
                }
                frameRef={frameRef}
                options={{
                  ...annotation,
                  onActiveChange: handleAnnotationActiveChange,
                }}
                onLoad={() => {
                  setLoadedFrameSource(frameSource)
                  setError(null)
                }}
              />
            ) : (
              <iframe
                ref={frameRef}
                src={frameSource}
                title={
                  application.data?.name ?? t("applications.interactiveApp")
                }
                className="absolute inset-0 size-full border-0 bg-background"
                onLoad={() => {
                  setLoadedFrameSource(frameSource)
                  setError(null)
                }}
              />
            )
          ) : null}

          {!runtimeUnavailableMessage &&
            (!frameSource || loadedFrameSource !== frameSource) && (
              <div className="absolute inset-0 z-20 flex items-center justify-center bg-background">
                <LoadingState />
              </div>
            )}

          {!chatOpen && (
            <Button
              type="button"
              variant="floating"
              size="sm"
              className="absolute right-4 bottom-4 z-30 rounded-full"
              aria-label={t("applications.showNativeChat")}
              onClick={() => setChatOpen(true)}
            >
              <MessageCircleIcon
                data-icon="inline-start"
                className="size-3.5 text-foreground/70"
                aria-hidden="true"
              />
              {t("applications.showNativeChat")}
            </Button>
          )}

          {error && (
            <div className="absolute bottom-4 left-4 z-30 max-w-md">
              <StatusBanner variant="error">{error}</StatusBanner>
            </div>
          )}
        </>
      }
      chat={
        <aside
          aria-label={t("applications.nativeChatPanel")}
          className="flex size-full min-h-0 flex-col overflow-hidden bg-background"
        >
          <div className="min-h-0 flex-1 [&_.conversation-office-layout]:h-full">
            <ConversationPage
              conversationId={conversationId}
              embedded={Boolean(onDiagnostic)}
              surfaceActive={chatOpen}
              unavailableMessage={runtimeUnavailableMessage}
              onApplicationEvent={handleApplicationEvent}
              headerActions={
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label={t("applications.hideNativeChat")}
                  onClick={() => setChatOpen(false)}
                >
                  <PanelRightCloseIcon
                    className="text-foreground/55"
                    aria-hidden="true"
                  />
                </Button>
              }
            />
          </div>
        </aside>
      }
    />
  )
}
