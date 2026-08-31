import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { MessageCircleIcon, PanelRightCloseIcon } from "lucide-react"
import { useTranslation } from "react-i18next"
import { Navigate, useParams } from "react-router-dom"
import { z } from "zod"
import { interactiveApplicationRuntimeTokenResultSchema } from "@linksense/shared"

import {
  applicationSchema,
  capabilitySummarySchema,
  conversationDetailSchema,
  mcpServerSchema,
  paginatedSchema,
  turnStartReceiptSchema,
} from "@/api/contracts"
import { apiRequest } from "@/api/client"
import { useAuth } from "@/app/auth-state"
import { interactiveCustomEvent } from "@/features/applications/interactive-application-event"
import { InteractiveApplicationSplitLayout } from "@/features/applications/interactive-application-split-layout"
import { conversationPath } from "@/features/conversations/conversation-navigation"
import { useConversationEvents } from "@/features/conversations/use-conversation-events"
import { listKnowledgeBases } from "@/features/knowledge-bases/knowledge-base-api"
import { Button } from "@/components/ui/button"
import { StatusBanner } from "@/components/feedback/status-banner"
import { ConversationPage } from "@/pages/conversation-pages"

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
    "tasks.interrupt",
    "chat.show",
    "chat.hide",
    "chat.toggle",
  ]),
  params: z.record(z.string(), z.unknown()),
})

export function InteractiveApplicationPage() {
  const { applicationId = "", conversationId = "" } = useParams()
  return (
    <InteractiveApplicationRuntime
      key={`${applicationId}:${conversationId}`}
      applicationId={applicationId}
      conversationId={conversationId}
    />
  )
}

function InteractiveApplicationRuntime({
  applicationId,
  conversationId,
}: {
  applicationId: string
  conversationId: string
}) {
  const { t } = useTranslation()
  const { user } = useAuth()
  const queryClient = useQueryClient()
  const frameRef = useRef<HTMLIFrameElement | null>(null)
  const pendingCustomEventsRef = useRef<Array<Record<string, unknown>>>([])
  const seenCustomEventIdsRef = useRef(new Set<string>())
  const [instanceId] = useState(() => crypto.randomUUID())
  const [chatOpen, setChatOpen] = useState(
    () => !window.matchMedia("(max-width: 767px)").matches
  )
  const [frameReady, setFrameReady] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const application = useQuery({
    queryKey: ["applications", "detail", user?.id, applicationId],
    queryFn: ({ signal }) =>
      apiRequest(`/applications/${applicationId}`, {
        schema: applicationSchema,
        signal,
      }),
    enabled: Boolean(user?.id && applicationId),
  })

  const conversation = useQuery({
    queryKey: ["conversation", conversationId],
    queryFn: ({ signal }) =>
      apiRequest(`/conversations/${conversationId}`, {
        schema: conversationDetailSchema,
        signal,
      }),
    enabled: Boolean(conversationId),
  })
  const conversationApplication = conversation.data?.application
  const runtimePackageId =
    conversationApplication?.kind === "interactive"
      ? conversationApplication.package_id
      : null
  const runtimeToken = useQuery({
    queryKey: [
      "applications",
      "interactive-runtime-token",
      applicationId,
      runtimePackageId,
    ],
    queryFn: () =>
      apiRequest(`/applications/${applicationId}/interactive-runtime-token`, {
        method: "POST",
        body: { package_id: runtimePackageId },
        schema: interactiveApplicationRuntimeTokenResultSchema,
      }),
    enabled: Boolean(
      runtimePackageId && conversationApplication?.id === applicationId
    ),
    staleTime: 8 * 60 * 1_000,
  })
  const permissions = useMemo(
    () => new Set(runtimeToken.data?.manifest.permissions ?? []),
    [runtimeToken.data?.manifest.permissions]
  )
  const frameSource = runtimeToken.data?.runtime_url

  const postToFrame = useCallback(
    (message: Record<string, unknown>) => {
      frameRef.current?.contentWindow?.postMessage(
        { protocol, instanceId, ...message },
        "*"
      )
    },
    [instanceId]
  )

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (event.source !== frameRef.current?.contentWindow) return
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
      if (!request.success) return
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
              nextError instanceof Error
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
        case "tasks.run": {
          requirePermission("tasks:write")
          const input = z
            .strictObject({
              prompt: z.string().trim().min(1).max(200_000),
              capability_ids: z.array(z.string()).max(50).default([]),
              knowledge_base_ids: z
                .array(z.string().uuid())
                .max(20)
                .default([]),
              idempotency_key: z.string().min(1).max(120).optional(),
            })
            .parse(request.params)
          const receipt = await apiRequest(
            `/conversations/${conversationId}/turns`,
            {
              method: "POST",
              body: {
                input_text: input.prompt,
                priority_capability_ids: input.capability_ids,
                knowledge_base_ids: input.knowledge_base_ids,
                idempotency_key:
                  input.idempotency_key ?? `interactive:${crypto.randomUUID()}`,
                collaboration_mode: "default",
                draft_policy: "preserve",
              },
              schema: turnStartReceiptSchema,
            }
          )
          await queryClient.invalidateQueries({
            queryKey: ["conversation", conversationId],
          })
          setChatOpen(true)
          return receipt
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
    ) => {
      if (!permissions.has(permission)) {
        throw new Error("LINKSENSE_SDK_PERMISSION_DENIED")
      }
    }

    window.addEventListener("message", handleMessage)
    return () => window.removeEventListener("message", handleMessage)
  }, [
    chatOpen,
    conversationId,
    instanceId,
    permissions,
    postToFrame,
    queryClient,
    user,
  ])

  useConversationEvents(
    conversationId || undefined,
    (event) => {
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
    ""
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

  if (
    application.isError ||
    conversation.isError ||
    runtimeToken.isError ||
    application.data?.kind === "standard" ||
    (conversation.isSuccess && !runtimePackageId)
  ) {
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
          {frameSource ? (
            <iframe
              ref={frameRef}
              src={frameSource}
              title={application.data?.name ?? t("applications.interactiveApp")}
              sandbox="allow-scripts allow-forms allow-downloads"
              className="absolute inset-0 size-full border-0 bg-background"
              onLoad={() => setError(null)}
            />
          ) : (
            <div className="flex size-full items-center justify-center text-sm text-muted-foreground">
              {t("common.loading")}
            </div>
          )}

          {!chatOpen && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="absolute right-4 bottom-4 z-30 rounded-full border-[color:var(--app-border)] bg-[var(--app-canvas)] text-foreground shadow-[var(--app-shadow)] hover:bg-[var(--app-hover)]"
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
