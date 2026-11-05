import { useEffect, useMemo, useRef, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useTranslation } from "react-i18next"
import type { z } from "zod"
import { publicKnowledgeSessionSchema } from "@linksense/shared"
import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { StatusBanner } from "@/components/feedback/status-banner"
import { createRandomUuid } from "@/lib/random-uuid"
import { ApiError } from "@/api/client"
import { PublicKnowledgeClient } from "./api"
import {
  ConversationThread,
  ConversationContentPolicyProvider,
} from "@/features/conversations/conversation-thread"
import { ConversationComposer } from "@/features/conversations/conversation-composer"
import { Badge } from "@/components/ui/badge"
import { SquarePenIcon } from "lucide-react"
import { projectPublicKnowledgeConversation } from "./conversation-view"
import { usePublicKnowledgeEvents } from "./use-public-events"
import { PublicKnowledgeSources } from "./sources"
import { useConversationScroll } from "@/features/conversations/use-conversation-scroll"
import { getKnowledgeSourceAnchorId } from "@/features/conversations/knowledge-citation-markdown"
import type { ConversationThreadNavigation } from "@/features/conversations/conversation-message-list"
import type { PublicKnowledgeFrame } from "./frame-contract"

type Session = z.infer<typeof publicKnowledgeSessionSchema>
export function PublicKnowledgeVisitorApp({
  config,
}: {
  config: PublicKnowledgeFrame
}) {
  const { t } = useTranslation(),
    queryClient = useQueryClient()
  const storageKey = `linksense:public-knowledge:${config.public_id}:${config.parent_origin}`
  const [session, setSession] = useState<Session | null>(() => {
    try {
      const stored = publicKnowledgeSessionSchema.safeParse(
        JSON.parse(window.sessionStorage.getItem(storageKey) ?? "null")
      )
      return stored.success && Date.parse(stored.data.expires_at) > Date.now()
        ? stored.data
        : null
    } catch {
      return null
    }
  })
  const [selectedConversationId, setConversationId] = useState<string | null>(
      null
    ),
    [question, setQuestion] = useState("")
  const [problem, setProblem] = useState<string | null>(null)
  const [posting, setPosting] = useState(false)
  const submittingRef = useRef(false)
  const client = useMemo(
    () => new PublicKnowledgeClient(config.public_id, session?.token),
    [config.public_id, session?.token]
  )
  const prefix = [
    "public-knowledge-visitor",
    config.public_id,
    session?.visitor_id,
  ] as const
  const list = useQuery({
    queryKey: [...prefix, "list"],
    queryFn: () => client.list(),
    enabled: session !== null,
    retry: false,
  })
  const conversationId =
    selectedConversationId ?? list.data?.items[0]?.id ?? null
  const navigationRef = useRef<ConversationThreadNavigation>(null)
  const scroll = useConversationScroll(conversationId ?? "public-welcome", {
    navigationRef,
    followBehavior: "smooth",
  })
  const detail = useQuery({
    queryKey: [...prefix, "detail", conversationId],
    queryFn: () => client.detail(conversationId ?? ""),
    enabled: session !== null && conversationId !== null,
    retry: false,
    refetchInterval: (query) =>
      posting ||
      query.state.data?.turns.some(
        (turn) => turn.status === "running" || turn.status === "queued"
      )
        ? 1500
        : false,
  })
  const resetForError = (error: unknown) => {
    if (error instanceof ApiError && error.status === 401) {
      setSession(null)
      setConversationId(null)
      try {
        window.sessionStorage.removeItem(storageKey)
      } catch {
        /* Storage is optional. */
      }
      setProblem(t("publicKnowledge.sessionExpired"))
    } else setProblem(t("publicKnowledge.unavailable"))
  }
  const start = useMutation({
    mutationFn: () => client.start(config.parent_origin),
    onSuccess: (result) => {
      setSession(result)
      setProblem(null)
      try {
        window.sessionStorage.setItem(storageKey, JSON.stringify(result))
      } catch {
        /* This page can still hold the visitor session in memory. */
      }
    },
    onError: resetForError,
  })
  const create = useMutation({
    mutationFn: () => client.create(),
    onSuccess: async (result) => {
      setConversationId(result.id)
      setProblem(null)
      await queryClient.invalidateQueries({ queryKey: [...prefix, "list"] })
    },
    onError: resetForError,
  })
  const send = useMutation({
    mutationFn: (input: { text: string; requestId: string }) =>
      client.ask(conversationId ?? "", input.text, input.requestId),
    onMutate: () => setPosting(true),
    onSuccess: () => {
      setQuestion("")
      setProblem(null)
    },
    onError: resetForError,
    onSettled: async () => {
      setPosting(false)
      submittingRef.current = false
      await queryClient.invalidateQueries({ queryKey: prefix })
    },
  })
  const stop = useMutation({
    mutationFn: (turnId: string) =>
      client.interrupt(conversationId ?? "", turnId),
    onError: resetForError,
    onSettled: async () => {
      await queryClient.invalidateQueries({ queryKey: prefix })
    },
  })
  const {
    mutate: createConversation,
    isPending: isCreating,
    isError: creationFailed,
  } = create
  useEffect(() => {
    if (conversationId || !list.data || isCreating || creationFailed) return
    createConversation()
  }, [
    list.data,
    conversationId,
    isCreating,
    creationFailed,
    createConversation,
  ])
  const error = list.error ?? detail.error
  const running = detail.data?.turns.find(
    (turn) => turn.status === "running" || turn.status === "queued"
  )
  const busy = send.isPending || Boolean(running)
  const liveEvents = usePublicKnowledgeEvents(client, detail.data, () =>
    resetForError(new ApiError({ status: 401, errorCode: "AUTH_REQUIRED" }))
  )
  const items = (list.data?.items ?? []).map((item) => ({
    value: item.id,
    label: item.title || t("publicKnowledge.newConversation"),
  }))
  const projectedConversation = useMemo(
    () =>
      detail.data
        ? projectPublicKnowledgeConversation(
            detail.data,
            liveEvents.events,
            liveEvents.messages
          )
        : null,
    [detail.data, liveEvents]
  )
  const textCitations = useMemo(
    () => ({
      visible: config.show_references,
      sourcesByTurn: new Map(
        (detail.data?.turns ?? []).map((turn) => [
          turn.id,
          turn.citations.map((source) => ({
            number: source.number,
            title: source.title,
            href: `#${getKnowledgeSourceAnchorId(turn.id, source.number)}`,
          })),
        ])
      ),
    }),
    [config.show_references, detail.data?.turns]
  )
  const feedback = (problem || error) && (
    <StatusBanner variant="error">
      {problem ??
        (error instanceof ApiError && error.status === 401
          ? t("publicKnowledge.sessionExpired")
          : t("publicKnowledge.unavailable"))}
      <Button
        variant="ghost"
        size="sm"
        onClick={() => {
          if (error instanceof ApiError && error.status === 401)
            resetForError(error)
          else {
            setProblem(null)
            void list.refetch()
            if (conversationId) void detail.refetch()
          }
        }}
      >
        {t("publicKnowledge.retry")}
      </Button>
    </StatusBanner>
  )
  return (
    <main className="embed-app">
      <header className="embed-header">
        <div className="embed-header-title">
          <h1 className="truncate text-base font-semibold">{config.name}</h1>
        </div>
        {session !== null && (
          <div className="embed-header-actions">
            <Select
              items={items}
              value={conversationId}
              onValueChange={(value) => {
                setConversationId(value)
                setProblem(null)
              }}
              disabled={busy || create.isPending}
            >
              <SelectTrigger
                className="max-w-44"
                aria-label={t("publicKnowledge.conversations")}
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {items.map((item) => (
                    <SelectItem key={item.value} value={item.value}>
                      {item.label}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label={t("publicKnowledge.newConversation")}
              title={t("publicKnowledge.newConversation")}
              disabled={busy || create.isPending}
              onClick={() => create.mutate()}
            >
              <SquarePenIcon aria-hidden="true" />
            </Button>
          </div>
        )}
      </header>
      {session === null ? (
        <div className="embed-gate">
          <h2 className="text-xl font-semibold">
            {t("publicKnowledge.welcome")}
          </h2>
          {config.description && (
            <p className="max-w-xl px-4 text-center text-sm text-muted-foreground">
              {config.description}
            </p>
          )}
          <p className="max-w-xl px-4 text-center text-xs text-muted-foreground">
            {t("publicKnowledge.privacy", { days: config.retention_days })}
          </p>
          <Button onClick={() => start.mutate()} disabled={start.isPending}>
            {start.isPending && <Spinner data-icon="inline-start" />}
            {t("publicKnowledge.start")}
          </Button>
          {feedback}
        </div>
      ) : (
        <>
          <div className="embed-thread">
            {projectedConversation ? (
              <ConversationContentPolicyProvider
                textOnly
                textCitations={textCitations}
              >
                <ConversationThread
                  conversation={projectedConversation}
                  liveReasoningSummaries={liveEvents.reasoning}
                  navigationRef={navigationRef}
                  scrollContainerRef={scroll.scrollContainerRef}
                  contentRef={scroll.contentRef}
                  editingDisabled
                  forkingDisabled
                  embedded
                  hideMessageActions
                  suppressEmptyState
                  onDownload={() => undefined}
                  emptyStateContent={
                    <div className="embed-welcome">
                      <h2>{t("publicKnowledge.welcome")}</h2>
                      <p>{config.description}</p>
                    </div>
                  }
                  renderMessageFooter={(message) => {
                    const turn = detail.data?.turns.find(
                      (item) => item.id === message.turn_id
                    )
                    if (!turn) return null
                    if (
                      message.role === "assistant" &&
                      message.phase === "commentary"
                    )
                      return null
                    if (turn.status === "queued" && message.role === "user")
                      return (
                        <div
                          role="status"
                          className="my-4 flex items-center gap-2 text-sm text-muted-foreground"
                        >
                          <Spinner />
                          <span>
                            {detail.data?.queue_waiting_visitors
                              ? t("publicKnowledge.queueWaiting", {
                                  count: detail.data.queue_waiting_visitors,
                                })
                              : t("publicKnowledge.queued")}
                          </span>
                        </div>
                      )
                    if (
                      message.role !== "assistant" &&
                      (turn.output_text ||
                        !["failed", "interrupted"].includes(turn.status))
                    )
                      return null
                    const showSources =
                      config.show_references && turn.citations.length > 0
                    if (
                      ["completed", "running"].includes(turn.status) &&
                      !showSources
                    )
                      return null
                    return (
                      <div className="my-4 flex min-w-0 flex-col gap-3">
                        {["failed", "interrupted"].includes(turn.status) && (
                          <Badge variant="secondary" className="self-start">
                            {t(`publicKnowledge.${turn.status}`)}
                          </Badge>
                        )}
                        {turn.status === "failed" && (
                          <p role="alert" className="text-sm text-destructive">
                            {t("publicKnowledge.unavailable")}
                          </p>
                        )}
                        {showSources && (
                          <PublicKnowledgeSources
                            sources={turn.citations}
                            turnId={turn.id}
                          />
                        )}
                      </div>
                    )
                  }}
                />
              </ConversationContentPolicyProvider>
            ) : (
              <p role="status" className="p-6 text-sm text-muted-foreground">
                {t("common.loading")}
              </p>
            )}
          </div>
          <div className="embed-composer-area">
            <div className="embed-error empty:hidden">{feedback}</div>
            <ConversationComposer
              textOnly
              maxLength={4000}
              value={question}
              onValueChange={setQuestion}
              capabilities={[]}
              selectedIds={[]}
              onSelectedIdsChange={() => undefined}
              attachments={[]}
              isRunning={Boolean(running)}
              interrupting={stop.isPending}
              submitting={send.isPending}
              uploading={false}
              planModeAvailable={false}
              showKnowledgeBaseButton={false}
              interactionBlocked={!conversationId || busy}
              managedApplicationName={config.name}
              voiceTranscriptionAvailability="unavailable"
              onSubmit={(value) => {
                const text = value.trim()
                if (
                  !text ||
                  text.length > 4000 ||
                  !conversationId ||
                  busy ||
                  submittingRef.current
                )
                  return
                submittingRef.current = true
                scroll.scrollToBottom()
                send.mutate({ text, requestId: createRandomUuid() })
              }}
              onInterrupt={() => {
                if (running) stop.mutate(running.id)
              }}
              onStartNewTask={() => undefined}
              onStartApplication={() => undefined}
              onAttach={() => false}
              loadAttachmentPreview={() =>
                Promise.reject(
                  new Error("Attachments are unavailable in public Q&A")
                )
              }
              onRemoveAttachment={() => undefined}
              onClearAttachments={() => undefined}
              onError={setProblem}
            />
            <p className="mx-auto w-full max-w-3xl text-center text-xs text-muted-foreground">
              {t("publicKnowledge.privacy", { days: config.retention_days })}
            </p>
          </div>
        </>
      )}
    </main>
  )
}
