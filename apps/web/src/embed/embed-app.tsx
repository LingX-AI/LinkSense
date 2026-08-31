import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { z } from "zod"

import {
  conversationFileSchema,
  type ConversationUserInputResponse,
} from "@linksense/shared"

import {
  conversationDetailSchema,
  getNativeCodexPayload,
  modelPreferenceSchema,
  turnStartReceiptSchema,
  type Conversation,
  type ConversationActivity,
  type ConversationEvent,
  type ConversationFile,
  type ModelPreference,
  type NativeMessageOutputKind,
  type NativeMessagePhase,
  type ReasoningEffort,
} from "@/api/contracts"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Spinner } from "@/components/ui/spinner"
import { ApplicationIconDisplay } from "@/features/applications/application-icon"
import { shouldDisplayConversationActivity } from "@/features/conversations/activity-visibility"
import {
  ConversationComposer,
  type ConversationComposerHandle,
  type PendingAttachmentUpload,
} from "@/features/conversations/conversation-composer"
import {
  appendConversationLiveEvent,
  isStreamOnlyNativeEvent,
} from "@/features/conversations/conversation-live-events"
import {
  getConversationEventQueryRefreshScope,
  getConversationQueryRefreshScope,
  type ConversationQueryRefreshScope,
} from "@/features/conversations/conversation-refresh-policy"
import { mapLegacyConversationActivity } from "@/features/conversations/legacy-conversation-activity"
import {
  appendStreamingMessageDelta,
  applyStreamingMessageLifecycle,
  completeLegacyStreamingMessage,
  type StreamingAssistantMessages,
} from "@/features/conversations/streaming-messages"
import {
  appendStreamingReasoningSummaryDelta,
  removeStreamingReasoningSummariesForTurn,
  removeStreamingReasoningSummaryItem,
  type StreamingReasoningSummaries,
} from "@/features/conversations/streaming-reasoning-summaries"
import { ConversationThread } from "@/features/conversations/conversation-thread"
import { ConversationUserInputRequestCard } from "@/features/conversations/conversation-user-input-request-card"
import { cn } from "@/lib/utils"
import { setAppLanguage } from "@/i18n"
import {
  ArrowUpRightIcon,
  CheckIcon,
  ListTodoIcon,
  SquarePenIcon,
  Trash2Icon,
} from "lucide-react"
import type { EmbedFrameConfig } from "./config"
import {
  embedGateMessageKey,
  hostAuthenticationFailureError,
  projectExternalEmbedConversation,
  shouldShowEmbedOptimisticSubmission,
  type EmbedOptimisticSubmission,
  type EmbedStatus,
} from "./embed-conversation-view"
import { EmbedRequestError, EmbedSessionClient } from "./session-client"
import {
  embedLocaleFromMessage,
  embedExternalApplicationSessionFromMessage,
  type ExternalApplicationSessionMessage,
} from "./external-application-session-message"

const sessionSchema = z.strictObject({
  session_id: z.string().uuid(),
  session_expires_at: z.iso.datetime(),
  conversation: conversationDetailSchema,
})

const conversationHistorySchema = z.strictObject({
  items: z.array(
    z.strictObject({
      id: z.string().uuid(),
      title: z.string(),
      updated_at: z.iso.datetime(),
      created_at: z.iso.datetime(),
      execution_status: z.enum([
        "idle",
        "running",
        "pending",
        "completed",
        "failed",
        "interrupted",
      ]),
      current: z.boolean(),
    })
  ),
})

type EmbedTaskListItem = z.infer<
  typeof conversationHistorySchema
>["items"][number]

const attachmentResultSchema = conversationFileSchema.passthrough()
const mutationResultSchema = z.unknown()

export function EmbedApp({ config }: { config: EmbedFrameConfig }) {
  const { t } = useTranslation()
  const translateRef = useRef(t)
  const [status, setStatus] = useState<EmbedStatus>(() =>
    config.auth_mode === "public" ? "authenticating" : "waiting_for_ticket"
  )
  const [conversation, setConversation] = useState<Conversation | null>(null)
  const [conversationHistory, setConversationHistory] = useState<
    EmbedTaskListItem[]
  >([])
  const [optimisticSubmission, setOptimisticSubmission] =
    useState<EmbedOptimisticSubmission | null>(null)
  const [input, setInput] = useState("")
  const [modelPreference, setModelPreference] = useState<
    ModelPreference | undefined
  >(undefined)
  const [modelPreferencePending, setModelPreferencePending] = useState(
    config.application.allows_user_model_selection
  )
  const [submitting, setSubmitting] = useState(false)
  const [switchingConversation, setSwitchingConversation] = useState(false)
  const [taskPendingDeletion, setTaskPendingDeletion] =
    useState<EmbedTaskListItem | null>(null)
  const [deletingTaskId, setDeletingTaskId] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)
  const [attachmentOperationPending, setAttachmentOperationPending] =
    useState(false)
  const [interrupting, setInterrupting] = useState(false)
  const [answering, setAnswering] = useState(false)
  const [connectionState, setConnectionState] = useState<
    "connected" | "retrying"
  >("connected")
  const [pendingAttachmentUploads, setPendingAttachmentUploads] = useState<
    PendingAttachmentUpload[]
  >([])
  const [streamedMessages, setStreamedMessages] =
    useState<StreamingAssistantMessages>({})
  const pendingExternalApplicationSessionRef = useRef<
    ExternalApplicationSessionMessage | undefined
  >(undefined)
  const [liveActivities, setLiveActivities] = useState<ConversationActivity[]>(
    []
  )
  const [liveEvents, setLiveEvents] = useState<ConversationEvent[]>([])
  const [liveReasoningSummaries, setLiveReasoningSummaries] =
    useState<StreamingReasoningSummaries>({})
  const [error, setError] = useState<string | null>(null)
  const clientRef = useRef<EmbedSessionClient | null>(null)
  const composerRef = useRef<ConversationComposerHandle | null>(null)
  const submissionInFlightRef = useRef(false)
  const attachmentOperationInFlightRef = useRef(false)
  const modelPreferenceOperationInFlightRef = useRef(false)
  const conversationChangeInFlightRef = useRef(false)
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const seenEventIdsRef = useRef(new Set<string>())
  const legacyStreamItemIdByTurnRef = useRef(new Map<string, string>())
  const nativeMessagePhaseByItemIdRef = useRef(
    new Map<string, NativeMessagePhase | null>()
  )
  const liveConversationIdRef = useRef<string | null>(null)
  const refreshTimerRef = useRef<number | null>(null)
  const refreshGenerationRef = useRef(0)
  const modelPreferenceRefreshGenerationRef = useRef(0)

  useEffect(() => {
    translateRef.current = t
  }, [t])

  useEffect(() => {
    void setAppLanguage(config.locale, { persist: false })
  }, [config.locale])

  const postToParent = useCallback(
    (message: Record<string, unknown>) => {
      window.parent.postMessage(message, config.parent_origin)
    },
    [config.parent_origin]
  )

  const requestHostTicket = useCallback(() => {
    postToParent({
      type: "linksense:ready",
      appId: config.app_id,
      authMode: config.auth_mode,
    })
  }, [config.app_id, config.auth_mode, postToParent])

  const refresh = useCallback(
    async (options?: { modelPreference?: boolean }) => {
      const client = clientRef.current
      if (!client?.authenticated) return
      const generation = ++refreshGenerationRef.current
      if (
        config.application.allows_user_model_selection &&
        options?.modelPreference === true
      ) {
        const modelPreferenceGeneration =
          ++modelPreferenceRefreshGenerationRef.current
        void client
          .request(
            "/api/v1/embed/session/model-preference",
            modelPreferenceSchema
          )
          .then((nextModelPreference) => {
            if (
              modelPreferenceGeneration ===
              modelPreferenceRefreshGenerationRef.current
            ) {
              setModelPreference(nextModelPreference)
            }
          })
          .catch((nextError: unknown) => {
            if (
              modelPreferenceGeneration ===
              modelPreferenceRefreshGenerationRef.current
            ) {
              setError(
                errorMessage(
                  nextError,
                  translateRef.current("embed.errors.requestFailed")
                )
              )
            }
          })
          .finally(() => {
            if (
              modelPreferenceGeneration ===
              modelPreferenceRefreshGenerationRef.current
            ) {
              setModelPreferencePending(false)
            }
          })
      }
      try {
        const [session, history] = await Promise.all([
          client.request("/api/v1/embed/session", sessionSchema),
          client
            .request(
              "/api/v1/embed/session/conversations",
              conversationHistorySchema
            )
            .catch(() => ({ items: [] })),
        ])
        if (generation !== refreshGenerationRef.current) return
        setConversation(session.conversation)
        setConversationHistory(history.items)
        setStatus("ready")
        setError(null)
      } catch (nextError) {
        if (generation !== refreshGenerationRef.current) return
        if (
          nextError instanceof EmbedRequestError &&
          nextError.status === 401
        ) {
          if (config.auth_mode === "required") {
            setStatus("waiting_for_ticket")
          }
          return
        }
        setError(
          errorMessage(
            nextError,
            translateRef.current("embed.errors.requestFailed")
          )
        )
      }
    },
    [config.application.allows_user_model_selection, config.auth_mode]
  )

  const scheduleRefresh = useCallback(
    (scope: ConversationQueryRefreshScope) => {
      if (scope === "none" || refreshTimerRef.current !== null) return
      refreshTimerRef.current = window.setTimeout(
        () => {
          refreshTimerRef.current = null
          void refresh()
        },
        scope === "detail-and-list" ? 50 : 250
      )
    },
    [refresh]
  )

  useEffect(
    () => () => {
      if (refreshTimerRef.current !== null) {
        window.clearTimeout(refreshTimerRef.current)
        refreshTimerRef.current = null
      }
    },
    []
  )

  const handleLiveEvent = useCallback(
    (event: ConversationEvent) => {
      if (event.id && seenEventIdsRef.current.has(event.id)) return
      if (event.id) seenEventIdsRef.current.add(event.id)

      const native = getNativeCodexPayload(event)
      if (native) {
        if (native.method === "item/reasoning/summaryTextDelta") {
          setLiveReasoningSummaries((current) =>
            appendStreamingReasoningSummaryDelta(current, {
              itemId: native.params.itemId,
              turnId: event.turn_id,
              summaryIndex: native.params.summaryIndex,
              delta: native.params.delta,
              createdAt: event.created_at,
              sequence: event.sequence_no,
            })
          )
          return
        }
        if (
          native.method === "item/agentMessage/delta" ||
          native.method === "item/plan/delta"
        ) {
          const itemId = native.params.itemId
          const outputKind: NativeMessageOutputKind =
            native.method === "item/plan/delta" ? "plan" : "agent_message"
          setStreamedMessages((current) =>
            appendStreamingMessageDelta(current, {
              itemId,
              turnId: event.turn_id,
              phase: nativeMessagePhaseByItemIdRef.current.get(itemId),
              outputKind,
              delta: native.params.delta,
              createdAt: event.created_at,
              sequence: event.sequence_no,
            })
          )
          return
        }
        if (isStreamOnlyNativeEvent(event)) return
        setLiveEvents((current) => appendConversationLiveEvent(current, event))
        if (
          native.method === "item/started" ||
          native.method === "item/completed"
        ) {
          const item = native.params.item
          if (native.method === "item/completed" && item.type === "reasoning") {
            setLiveReasoningSummaries((current) =>
              removeStreamingReasoningSummaryItem(current, {
                itemId: item.id,
                turnId: event.turn_id,
              })
            )
          }
          if (item.type === "agentMessage" || item.type === "plan") {
            const phase: NativeMessagePhase | null =
              item.type === "plan" ? "final_answer" : (item.phase ?? null)
            nativeMessagePhaseByItemIdRef.current.set(item.id, phase)
            setStreamedMessages((current) =>
              applyStreamingMessageLifecycle(current, {
                itemId: item.id,
                messageId: native.local?.message_id,
                turnId: event.turn_id,
                phase,
                outputKind: item.type === "plan" ? "plan" : "agent_message",
                text: item.text,
                createdAt: event.created_at,
                sequence: event.sequence_no,
                completed: native.method === "item/completed",
              })
            )
            if (phase === "final_answer") {
              setLiveReasoningSummaries((current) =>
                removeStreamingReasoningSummariesForTurn(current, event.turn_id)
              )
            }
          }
        }
        if (native.method === "error" && native.params.willRetry) return
        if (native.method === "turn/completed") {
          setInterrupting(false)
          setLiveReasoningSummaries((current) =>
            removeStreamingReasoningSummariesForTurn(current, event.turn_id)
          )
        }
        scheduleRefresh(getConversationEventQueryRefreshScope(event))
        return
      }

      const payload = event.payload as Record<string, unknown>
      if (event.type === "conversation.message.delta") {
        const delta = typeof payload.delta === "string" ? payload.delta : ""
        const itemId =
          typeof payload.item_id === "string"
            ? payload.item_id
            : typeof payload.message_id === "string"
              ? payload.message_id
              : `legacy-${event.turn_id ?? "turn"}`
        if (event.turn_id) {
          legacyStreamItemIdByTurnRef.current.set(event.turn_id, itemId)
        }
        setStreamedMessages((current) =>
          appendStreamingMessageDelta(current, {
            itemId,
            messageId:
              typeof payload.message_id === "string"
                ? payload.message_id
                : undefined,
            turnId: event.turn_id,
            phase: "final_answer",
            delta,
            createdAt: event.created_at,
            sequence: event.sequence_no,
          })
        )
        return
      }
      if (event.type === "conversation.message.completed") {
        if (payload.role === "assistant") {
          setStreamedMessages((current) =>
            completeLegacyStreamingMessage(current, {
              itemId:
                typeof payload.item_id === "string"
                  ? payload.item_id
                  : event.turn_id
                    ? legacyStreamItemIdByTurnRef.current.get(event.turn_id)
                    : undefined,
              messageId:
                typeof payload.message_id === "string"
                  ? payload.message_id
                  : undefined,
              turnId: event.turn_id,
              createdAt: event.created_at,
              sequence: event.sequence_no,
            })
          )
        }
      }
      if (
        shouldDisplayConversationActivity(event.type) &&
        (event.type.startsWith("conversation.step.") ||
          event.type.startsWith("conversation.tool.") ||
          event.type === "conversation.capability.used" ||
          event.type === "conversation.system_capability.used")
      ) {
        setLiveActivities((current) => [
          ...current.slice(-24),
          mapLegacyConversationActivity(
            event,
            `${event.type}-${current.length}`
          ),
        ])
        return
      }
      if (event.type === "conversation.error") {
        const messageKey =
          typeof payload.message_key === "string"
            ? payload.message_key
            : "errors.codexTurnFailed"
        const translated = translateRef.current(messageKey)
        setError(
          translated === messageKey
            ? translateRef.current("errors.codexTurnFailed")
            : translated
        )
      }
      if (
        event.type === "conversation.interrupted" ||
        event.type === "conversation.completed" ||
        event.type === "conversation.status.changed"
      ) {
        setInterrupting(false)
        setLiveReasoningSummaries((current) =>
          removeStreamingReasoningSummariesForTurn(current, event.turn_id)
        )
        if (event.type !== "conversation.status.changed") {
          setLiveActivities([])
        }
      }
      scheduleRefresh(getConversationQueryRefreshScope(event.type))
    },
    [scheduleRefresh]
  )

  const acceptTicket = useCallback(
    async (ticket: string) => {
      const client = clientRef.current
      if (!client) return
      setStatus("authenticating")
      setError(null)
      try {
        await client.acceptTicket(ticket)
        await client.updateExternalApplicationSession(
          pendingExternalApplicationSessionRef.current?.sessionId ?? null
        )
        await refresh({ modelPreference: true })
      } catch (nextError) {
        setStatus("failed")
        setError(
          errorMessage(
            nextError,
            translateRef.current("embed.errors.authenticationFailed")
          )
        )
      }
    },
    [refresh]
  )

  const syncExternalApplicationSession = useCallback(
    async (externalApplicationSession: ExternalApplicationSessionMessage) => {
      const client = clientRef.current
      if (!client?.authenticated) return
      setStatus("authenticating")
      setError(null)
      try {
        await client.updateExternalApplicationSession(
          externalApplicationSession.sessionId
        )
        await refresh({ modelPreference: true })
      } catch (nextError) {
        setStatus("failed")
        setError(
          errorMessage(
            nextError,
            translateRef.current("embed.errors.authenticationFailed")
          )
        )
      }
    },
    [refresh]
  )

  const startPublicSession = useCallback(async () => {
    const client = clientRef.current
    if (!client) return
    setStatus("authenticating")
    setError(null)
    try {
      await client.startPublicSession(config.app_id)
      await refresh({ modelPreference: true })
    } catch (nextError) {
      setStatus("failed")
      setError(
        errorMessage(
          nextError,
          translateRef.current("embed.errors.publicSessionFailed")
        )
      )
    }
  }, [config.app_id, refresh])

  useEffect(() => {
    const client = new EmbedSessionClient(config.parent_origin, {
      onAuthenticationRequired: () => {
        if (config.auth_mode === "public") {
          void startPublicSession()
          return
        }
        pendingExternalApplicationSessionRef.current = undefined
        setStatus("waiting_for_ticket")
        requestHostTicket()
      },
      onConnectionStateChange: setConnectionState,
    })
    clientRef.current = client

    const messageListener = (event: MessageEvent) => {
      if (
        event.origin !== config.parent_origin ||
        event.source !== window.parent ||
        !event.data ||
        typeof event.data !== "object"
      ) {
        return
      }
      const message = event.data as Record<string, unknown>
      const locale = embedLocaleFromMessage(message, config.app_id)
      if (locale !== undefined) {
        void setAppLanguage(locale, { persist: false })
      }
      const externalApplicationSession =
        embedExternalApplicationSessionFromMessage(message, config.app_id)
      if (externalApplicationSession !== undefined) {
        pendingExternalApplicationSessionRef.current =
          externalApplicationSession
        if (message.type === "linksense:session-id" && client.authenticated) {
          void syncExternalApplicationSession(externalApplicationSession)
        }
      }
      const hostFailure = hostAuthenticationFailureError(
        message,
        config.app_id,
        translateRef.current("embed.errors.hostAuthenticationFailed")
      )
      if (hostFailure !== null) {
        setStatus("failed")
        setError(hostFailure)
        return
      }
      if (
        message.type === "linksense:ticket" &&
        message.appId === config.app_id &&
        externalApplicationSession !== undefined &&
        typeof message.ticket === "string"
      ) {
        void acceptTicket(message.ticket)
      }
    }
    window.addEventListener("message", messageListener)

    const initialTicket =
      config.auth_mode === "required" ? readAndClearFragmentTicket() : null
    requestHostTicket()
    const authenticationTimer =
      config.auth_mode === "public"
        ? window.setTimeout(() => void startPublicSession(), 0)
        : initialTicket
          ? window.setTimeout(() => void acceptTicket(initialTicket), 0)
          : null

    return () => {
      if (authenticationTimer !== null) {
        window.clearTimeout(authenticationTimer)
      }
      window.removeEventListener("message", messageListener)
      client.destroy()
      clientRef.current = null
    }
  }, [
    acceptTicket,
    config.auth_mode,
    config.parent_origin,
    config.app_id,
    postToParent,
    refresh,
    requestHostTicket,
    startPublicSession,
    syncExternalApplicationSession,
  ])

  const visibleOptimisticSubmission = shouldShowEmbedOptimisticSubmission(
    conversation,
    optimisticSubmission
  )
    ? optimisticSubmission
    : null
  useEffect(() => {
    const conversationId = conversation?.id ?? null
    if (liveConversationIdRef.current === conversationId) return
    liveConversationIdRef.current = conversationId
    seenEventIdsRef.current.clear()
    legacyStreamItemIdByTurnRef.current.clear()
    nativeMessagePhaseByItemIdRef.current.clear()
    setStreamedMessages({})
    setLiveActivities([])
    setLiveEvents([])
    setLiveReasoningSummaries({})
  }, [conversation?.id])

  const persistedMessageIds = useMemo(
    () => new Set(conversation?.messages?.map((message) => message.id) ?? []),
    [conversation?.messages]
  )
  const persistedItemIds = useMemo(
    () =>
      new Set(
        conversation?.messages?.flatMap((message) =>
          message.item_id ? [message.item_id] : []
        ) ?? []
      ),
    [conversation?.messages]
  )
  const visibleStreamedMessages = useMemo(
    () =>
      Object.values(streamedMessages)
        .filter(
          (message) =>
            message.content &&
            !persistedMessageIds.has(message.id) &&
            !persistedItemIds.has(message.item_id)
        )
        .sort(
          (left, right) =>
            (left.event_sequence_no ?? Number.MAX_SAFE_INTEGER) -
            (right.event_sequence_no ?? Number.MAX_SAFE_INTEGER)
        ),
    [persistedItemIds, persistedMessageIds, streamedMessages]
  )
  const liveConversation = useMemo<Conversation | null>(() => {
    if (!conversation) return null
    return {
      ...conversation,
      messages: [...(conversation.messages ?? []), ...visibleStreamedMessages],
      activities: [...(conversation.activities ?? []), ...liveActivities],
      events: [...(conversation.events ?? []), ...liveEvents],
    }
  }, [conversation, liveActivities, liveEvents, visibleStreamedMessages])
  const projectedConversation = useMemo(
    () =>
      liveConversation
        ? projectExternalEmbedConversation(
            liveConversation,
            visibleOptimisticSubmission
          )
        : null,
    [liveConversation, visibleOptimisticSubmission]
  )

  const serverRunning =
    conversation?.execution_status === "running" ||
    conversation?.execution_status === "pending"
  const running = serverRunning || visibleOptimisticSubmission !== null
  const attachments = conversation?.attachments ?? []

  const changeConversation = useCallback(
    async (conversationId: string | null) => {
      const client = clientRef.current
      if (
        !client ||
        switchingConversation ||
        submitting ||
        submissionInFlightRef.current ||
        uploading ||
        attachmentOperationPending ||
        attachmentOperationInFlightRef.current ||
        modelPreferenceOperationInFlightRef.current ||
        conversationChangeInFlightRef.current ||
        running ||
        (conversationId !== null && conversationId === conversation?.id)
      ) {
        return
      }
      conversationChangeInFlightRef.current = true
      setSwitchingConversation(true)
      setError(null)
      try {
        const path =
          conversationId === null
            ? "/api/v1/embed/session/conversations"
            : `/api/v1/embed/session/conversations/${conversationId}/select`
        await client.changeConversation(path, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: "{}",
        })
        setOptimisticSubmission(null)
        if (config.application.allows_user_model_selection) {
          setModelPreference(undefined)
          setModelPreferencePending(true)
        }
        await refresh({ modelPreference: true })
      } catch (nextError) {
        setError(
          errorMessage(
            nextError,
            conversationId === null
              ? t("embed.errors.createConversationFailed")
              : t("embed.errors.switchConversationFailed")
          )
        )
      } finally {
        conversationChangeInFlightRef.current = false
        setSwitchingConversation(false)
      }
    },
    [
      config.application.allows_user_model_selection,
      conversation?.id,
      refresh,
      running,
      submitting,
      switchingConversation,
      uploading,
      attachmentOperationPending,
      t,
    ]
  )

  const deleteTask = useCallback(
    async (item: EmbedTaskListItem) => {
      const client = clientRef.current
      if (
        !client ||
        switchingConversation ||
        submitting ||
        submissionInFlightRef.current ||
        uploading ||
        attachmentOperationPending ||
        attachmentOperationInFlightRef.current ||
        modelPreferenceOperationInFlightRef.current ||
        conversationChangeInFlightRef.current ||
        running
      )
        return
      conversationChangeInFlightRef.current = true
      setDeletingTaskId(item.id)
      setSwitchingConversation(true)
      setError(null)
      try {
        await client.changeConversation(
          `/api/v1/embed/session/conversations/${item.id}`,
          { method: "DELETE" }
        )
        if (item.current) {
          setOptimisticSubmission(null)
          if (config.application.allows_user_model_selection) {
            setModelPreference(undefined)
            setModelPreferencePending(true)
          }
        }
        await refresh({ modelPreference: item.current })
        setTaskPendingDeletion(null)
      } catch (nextError) {
        setError(errorMessage(nextError, t("embed.errors.deleteTaskFailed")))
      } finally {
        conversationChangeInFlightRef.current = false
        setDeletingTaskId(null)
        setSwitchingConversation(false)
      }
    },
    [
      config.application.allows_user_model_selection,
      refresh,
      running,
      submitting,
      switchingConversation,
      uploading,
      attachmentOperationPending,
      t,
    ]
  )

  useEffect(() => {
    const client = clientRef.current
    if (status !== "ready" || !conversation?.id || !client?.authenticated) {
      return
    }
    return client.connectEvents(
      "/api/v1/embed/session/events",
      {
        onEvent: handleLiveEvent,
        onConnectionChange: setConnectionState,
      },
      { initialEventId: conversation.last_event_id }
    )
  }, [conversation?.id, conversation?.last_event_id, handleLiveEvent, status])

  useEffect(() => {
    if (status !== "ready") return
    const delay = running ? 5_000 : 30_000
    const timer = window.setInterval(() => void refresh(), delay)
    return () => window.clearInterval(timer)
  }, [refresh, running, status])

  useEffect(() => {
    const element = scrollRef.current
    if (!element || status !== "ready") return
    element.scrollTo({ top: element.scrollHeight, behavior: "smooth" })
  }, [
    projectedConversation?.messages?.length,
    conversation?.events?.length,
    status,
  ])

  const submit = async (submittedInput: string) => {
    if (
      !clientRef.current ||
      submitting ||
      submissionInFlightRef.current ||
      uploading ||
      attachmentOperationPending ||
      attachmentOperationInFlightRef.current ||
      modelPreferenceOperationInFlightRef.current ||
      conversationChangeInFlightRef.current ||
      running ||
      (!submittedInput.trim() && attachments.length === 0)
    ) {
      return
    }
    submissionInFlightRef.current = true
    const idempotencyKey = crypto.randomUUID()
    const submittedAttachments = attachments
    const optimistic: EmbedOptimisticSubmission = {
      id: idempotencyKey,
      turnId: null,
      content: submittedInput,
      createdAt: new Date().toISOString(),
      attachments: submittedAttachments,
    }
    setInput("")
    setOptimisticSubmission(optimistic)
    setSubmitting(true)
    setError(null)
    try {
      const receipt = await clientRef.current.request(
        "/api/v1/embed/session/turns",
        turnStartReceiptSchema,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            input_text: submittedInput,
            idempotency_key: idempotencyKey,
          }),
        }
      )
      setOptimisticSubmission((current) =>
        current?.id === idempotencyKey
          ? { ...current, turnId: receipt.turn_id }
          : current
      )
      await refresh()
    } catch (nextError) {
      setOptimisticSubmission((current) =>
        current?.id === idempotencyKey ? null : current
      )
      setInput((current) => (current ? current : submittedInput))
      setError(errorMessage(nextError, t("embed.errors.submitFailed")))
    } finally {
      submissionInFlightRef.current = false
      setSubmitting(false)
    }
  }

  const updateModelPreference = async (
    model: string,
    reasoningEffort: ReasoningEffort
  ) => {
    const client = clientRef.current
    if (
      !client?.authenticated ||
      !config.application.allows_user_model_selection ||
      submissionInFlightRef.current ||
      attachmentOperationInFlightRef.current ||
      conversationChangeInFlightRef.current ||
      modelPreferenceOperationInFlightRef.current ||
      modelPreferencePending
    ) {
      return
    }
    modelPreferenceOperationInFlightRef.current = true
    setModelPreferencePending(true)
    setError(null)
    try {
      setModelPreference(
        await client.request(
          "/api/v1/embed/session/model-preference",
          modelPreferenceSchema,
          {
            method: "PUT",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              selected_model: model,
              selected_reasoning_effort: reasoningEffort,
            }),
          }
        )
      )
    } catch (nextError) {
      setError(errorMessage(nextError, t("embed.errors.requestFailed")))
    } finally {
      modelPreferenceOperationInFlightRef.current = false
      setModelPreferencePending(false)
    }
  }

  const interrupt = async () => {
    const turnId = conversation?.running_turn?.id
    if (!clientRef.current || !turnId || interrupting) return
    setInterrupting(true)
    try {
      await clientRef.current.request(
        `/api/v1/embed/session/turns/${turnId}/interrupt`,
        mutationResultSchema,
        { method: "POST" }
      )
      await refresh()
    } catch (nextError) {
      setError(errorMessage(nextError, t("embed.errors.interruptFailed")))
    } finally {
      setInterrupting(false)
    }
  }

  const attachFiles = (files: File[]) => {
    const client = clientRef.current
    if (
      !client ||
      submitting ||
      submissionInFlightRef.current ||
      uploading ||
      switchingConversation ||
      conversationChangeInFlightRef.current ||
      modelPreferenceOperationInFlightRef.current ||
      running ||
      attachmentOperationInFlightRef.current
    )
      return false
    const batch = files.map((file) => ({
      id: crypto.randomUUID(),
      name: file.name,
      size: file.size,
      mimeType: file.type || undefined,
    }))
    attachmentOperationInFlightRef.current = true
    setAttachmentOperationPending(true)
    setUploading(true)
    setPendingAttachmentUploads((current) => [...current, ...batch])
    setError(null)
    return (async () => {
      try {
        for (const file of files) {
          await client.upload(
            "/api/v1/embed/session/attachments",
            file,
            attachmentResultSchema
          )
        }
        await refresh()
        return true
      } catch (nextError) {
        await refresh().catch(() => undefined)
        setError(errorMessage(nextError, t("embed.errors.uploadFailed")))
        throw nextError
      } finally {
        setUploading(false)
        setAttachmentOperationPending(false)
        attachmentOperationInFlightRef.current = false
        const uploadedIds = new Set<string>(batch.map((file) => file.id))
        setPendingAttachmentUploads((current) =>
          current.filter((file) => !uploadedIds.has(file.id))
        )
      }
    })()
  }

  const removeAttachment = async (file: ConversationFile) => {
    const client = clientRef.current
    if (
      !client ||
      submitting ||
      submissionInFlightRef.current ||
      switchingConversation ||
      conversationChangeInFlightRef.current ||
      modelPreferenceOperationInFlightRef.current ||
      running ||
      attachmentOperationInFlightRef.current
    )
      return
    attachmentOperationInFlightRef.current = true
    setAttachmentOperationPending(true)
    setError(null)
    try {
      await client.request(
        `/api/v1/embed/session/attachments/${file.id}`,
        z.unknown(),
        { method: "DELETE" }
      )
      await refresh()
    } catch (nextError) {
      await refresh().catch(() => undefined)
      setError(
        errorMessage(nextError, t("embed.errors.removeAttachmentFailed"))
      )
    } finally {
      setAttachmentOperationPending(false)
      attachmentOperationInFlightRef.current = false
    }
  }

  const clearAttachments = async (files: readonly ConversationFile[]) => {
    const client = clientRef.current
    if (
      !client ||
      files.length === 0 ||
      submitting ||
      submissionInFlightRef.current ||
      switchingConversation ||
      conversationChangeInFlightRef.current ||
      modelPreferenceOperationInFlightRef.current ||
      running ||
      attachmentOperationInFlightRef.current
    )
      return
    attachmentOperationInFlightRef.current = true
    setAttachmentOperationPending(true)
    setError(null)
    try {
      await client.request("/api/v1/embed/session/attachments", z.unknown(), {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ file_ids: files.map((file) => file.id) }),
      })
      await refresh()
    } catch (nextError) {
      await refresh().catch(() => undefined)
      setError(
        errorMessage(nextError, t("embed.errors.removeAttachmentFailed"))
      )
    } finally {
      setAttachmentOperationPending(false)
      attachmentOperationInFlightRef.current = false
    }
  }

  const loadAttachment = useCallback(
    (file: ConversationFile, signal: AbortSignal) =>
      clientRef.current!.requestBlob(
        `/api/v1/embed/session/attachments/${file.id}/content`,
        { signal }
      ),
    []
  )

  const downloadArtifact = useCallback(
    async (file: ConversationFile) => {
      try {
        const blob = await clientRef.current!.requestBlob(
          `/api/v1/embed/session/files/${file.id}/download`
        )
        const url = URL.createObjectURL(blob)
        const link = document.createElement("a")
        link.href = url
        link.download = file.name
        link.click()
        window.setTimeout(() => URL.revokeObjectURL(url), 30_000)
      } catch (nextError) {
        setError(errorMessage(nextError, t("embed.errors.downloadFailed")))
      }
    },
    [t]
  )

  const activeUserInputRequest = useMemo(
    () =>
      [...(conversation?.user_input_requests ?? [])]
        .filter(
          (request) =>
            request.status === "pending" || request.status === "answering"
        )
        .sort((left, right) =>
          left.created_at.localeCompare(right.created_at)
        )[0],
    [conversation?.user_input_requests]
  )

  const answerPanel = activeUserInputRequest ? (
    <ConversationUserInputRequestCard
      key={activeUserInputRequest.id}
      request={activeUserInputRequest}
      submitting={answering}
      onSubmit={(response: ConversationUserInputResponse) => {
        if (!clientRef.current || answering) return
        setAnswering(true)
        void clientRef.current
          .request(
            `/api/v1/embed/session/user-input-requests/${activeUserInputRequest.id}/respond`,
            mutationResultSchema,
            {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify(response),
            }
          )
          .then(() => refresh())
          .catch((nextError: unknown) => {
            setError(errorMessage(nextError, t("embed.errors.answerFailed")))
          })
          .finally(() => setAnswering(false))
      }}
    />
  ) : null

  return (
    <main className="embed-app">
      <header className="embed-header">
        <ApplicationIconDisplay
          icon={config.application.icon}
          className="size-10 shrink-0"
        />
        <div className="embed-header-title">
          <h1 className="truncate text-sm font-semibold">
            {config.application.name}
          </h1>
          {config.application.description && (
            <p className="truncate text-xs text-[var(--app-muted)]">
              {config.application.description}
            </p>
          )}
        </div>
        <div className="embed-header-actions">
          {status === "ready" && projectedConversation && (
            <EmbedTaskListMenu
              items={conversationHistory}
              disabled={
                running ||
                submitting ||
                uploading ||
                attachmentOperationPending ||
                modelPreferencePending ||
                switchingConversation
              }
              onNewConversation={() => void changeConversation(null)}
              onSelect={(conversationId) =>
                void changeConversation(conversationId)
              }
              onDelete={setTaskPendingDeletion}
            />
          )}
          {connectionState === "retrying" && (
            <span className="text-xs text-[var(--app-muted)]" role="status">
              {t("embed.reconnecting")}
            </span>
          )}
        </div>
      </header>

      {status === "ready" && projectedConversation ? (
        <>
          <div className="embed-thread">
            <ConversationThread
              conversation={projectedConversation}
              liveReasoningSummaries={liveReasoningSummaries}
              onDownload={(file) => void downloadArtifact(file)}
              editingDisabled
              embedded
              defaultActivityOpen
              suppressEmptyState
              emptyStateContent={
                (projectedConversation.messages?.length ?? 0) === 0 ? (
                  <div className="embed-welcome">
                    <ApplicationIconDisplay
                      icon={config.application.icon}
                      className="size-14"
                    />
                    <h2>{config.application.name}</h2>
                    <p>
                      {config.application.description ??
                        t("embed.defaultDescription")}
                    </p>
                    {config.starter_questions.length > 0 && (
                      <EmbedStarterQuestions
                        questions={config.starter_questions}
                        onSelect={(question) => {
                          setInput(question)
                          composerRef.current?.focus()
                        }}
                      />
                    )}
                  </div>
                ) : undefined
              }
              blockingPanel={answerPanel}
              blockingPanelKey={
                activeUserInputRequest
                  ? `user-input:${activeUserInputRequest.id}`
                  : null
              }
              scrollContainerRef={scrollRef}
            />
          </div>
          <div className="embed-composer-area">
            {error && (
              <div className="embed-error" role="alert">
                {error}
              </div>
            )}
            {!answerPanel && (
              <ConversationComposer
                ref={composerRef}
                value={input}
                onValueChange={setInput}
                capabilities={[]}
                selectedIds={[]}
                onSelectedIdsChange={() => undefined}
                attachments={attachments}
                pendingAttachmentUploads={pendingAttachmentUploads}
                attachmentPreviewEnabled={false}
                isRunning={running}
                interrupting={interrupting}
                submitting={submitting}
                uploading={uploading}
                attachmentOperationPending={attachmentOperationPending}
                planModeAvailable={false}
                interactionBlocked={
                  running || switchingConversation || Boolean(answerPanel)
                }
                modelPreference={modelPreference}
                modelPreferencePending={
                  modelPreferencePending || attachmentOperationPending
                }
                managedApplicationName={config.application.name}
                allowManagedApplicationModelSelection={
                  config.application.allows_user_model_selection
                }
                onModelPreferenceChange={
                  config.application.allows_user_model_selection
                    ? (model, reasoningEffort) =>
                        void updateModelPreference(model, reasoningEffort)
                    : undefined
                }
                onSubmit={(value) => void submit(value)}
                onStartNewTask={() => undefined}
                onStartApplication={() => undefined}
                onInterrupt={() => void interrupt()}
                onAttach={attachFiles}
                loadAttachmentPreview={loadAttachment}
                onRemoveAttachment={(file) => void removeAttachment(file)}
                onClearAttachments={clearAttachments}
                onError={setError}
              />
            )}
          </div>
        </>
      ) : (
        <EmbedGate
          status={status}
          authMode={config.auth_mode}
          error={error}
          onRetry={() => {
            setError(null)
            if (config.auth_mode === "public") {
              void startPublicSession()
              return
            }
            setStatus("waiting_for_ticket")
            requestHostTicket()
          }}
        />
      )}
      <AlertDialog
        open={taskPendingDeletion !== null}
        onOpenChange={(open) => {
          if (!open && deletingTaskId === null) setTaskPendingDeletion(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("embed.deleteTaskTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("embed.deleteTaskDescription", {
                name: taskPendingDeletion?.title ?? "",
              })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deletingTaskId !== null}>
              {t("common.cancel")}
            </AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={deletingTaskId !== null || !taskPendingDeletion}
              onClick={() => {
                if (taskPendingDeletion) void deleteTask(taskPendingDeletion)
              }}
            >
              {deletingTaskId ? (
                <Spinner data-icon="inline-start" />
              ) : (
                <Trash2Icon data-icon="inline-start" aria-hidden="true" />
              )}
              {deletingTaskId
                ? t("embed.deletingTask")
                : t("embed.deleteTaskConfirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </main>
  )
}

function EmbedTaskListMenu({
  items,
  disabled,
  onNewConversation,
  onSelect,
  onDelete,
}: {
  items: EmbedTaskListItem[]
  disabled: boolean
  onNewConversation: () => void
  onSelect: (conversationId: string) => void
  onDelete: (item: EmbedTaskListItem) => void
}) {
  const { t, i18n } = useTranslation()
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="embed-task-list-trigger"
            disabled={disabled}
          />
        }
      >
        <ListTodoIcon data-icon="inline-start" aria-hidden="true" />
        {t("embed.history")}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="embed-task-list-menu">
        <DropdownMenuGroup>
          <DropdownMenuItem onClick={onNewConversation} disabled={disabled}>
            <SquarePenIcon aria-hidden="true" />
            {t("embed.newConversation")}
          </DropdownMenuItem>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          {items.length === 0 ? (
            <DropdownMenuLabel>{t("embed.historyEmpty")}</DropdownMenuLabel>
          ) : (
            items.map((item) => (
              <div className="embed-task-list-item" key={item.id}>
                <DropdownMenuItem
                  className="embed-task-list-item-select"
                  onClick={() => onSelect(item.id)}
                  disabled={disabled || item.current}
                >
                  <span className="embed-task-list-item-text">
                    <span className="embed-task-list-item-title">
                      {item.title}
                    </span>
                    <span className="embed-task-list-item-meta">
                      {formatEmbedTaskListTime(
                        item.updated_at,
                        i18n.resolvedLanguage === "en-US" ? "en-US" : "zh-CN"
                      )}
                    </span>
                  </span>
                  {item.current && <CheckIcon className="ml-auto" />}
                </DropdownMenuItem>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  className="embed-task-list-item-delete"
                  aria-label={t("embed.deleteTaskLabel", { name: item.title })}
                  disabled={disabled}
                  onClick={() => onDelete(item)}
                >
                  <Trash2Icon aria-hidden="true" />
                </Button>
              </div>
            ))
          )}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function EmbedStarterQuestions({
  questions,
  onSelect,
}: {
  questions: readonly string[]
  onSelect: (question: string) => void
}) {
  const { t } = useTranslation()
  return (
    <div
      className="embed-starter-questions"
      role="group"
      aria-label={t("embed.starterQuestionsLabel")}
    >
      {questions.map((question) => (
        <Button
          key={question}
          type="button"
          variant="outline"
          className="embed-starter-question"
          onClick={() => onSelect(question)}
        >
          <ArrowUpRightIcon
            className="embed-starter-question-icon"
            data-icon="inline-start"
            strokeWidth={1.5}
            aria-hidden="true"
          />
          <span>{question}</span>
        </Button>
      ))}
    </div>
  )
}

function EmbedGate({
  status,
  authMode,
  error,
  onRetry,
}: {
  status: EmbedStatus
  authMode: EmbedFrameConfig["auth_mode"]
  error: string | null
  onRetry: () => void
}) {
  const { t } = useTranslation()
  const messageKey = embedGateMessageKey(status, authMode)
  return (
    <div className="embed-gate" role="status" aria-live="polite">
      <div
        className={cn("embed-gate-indicator", status === "failed" && "hidden")}
      />
      <p>{status === "failed" && error ? error : t(messageKey)}</p>
      {status === "failed" && (
        <Button type="button" variant="outline" onClick={onRetry}>
          {t("common.retry")}
        </Button>
      )}
    </div>
  )
}

function formatEmbedTaskListTime(value: string, locale: "zh-CN" | "en-US") {
  return new Date(value).toLocaleString(locale, {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  })
}

function readAndClearFragmentTicket(): string | null {
  const parameters = new URLSearchParams(window.location.hash.slice(1))
  const ticket = parameters.get("ticket")
  if (window.location.hash) {
    window.history.replaceState(
      null,
      "",
      `${window.location.pathname}${window.location.search}`
    )
  }
  return ticket
}

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error && error.message.trim()
    ? error.message
    : fallback
}
