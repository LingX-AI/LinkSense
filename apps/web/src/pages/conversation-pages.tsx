import {
  Fragment,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react"
import {
  useMutation,
  useQueries,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query"
import {
  ArchiveIcon,
  ArchiveRestoreIcon,
  CircleAlertIcon,
  EllipsisIcon,
  InfoIcon,
  PencilIcon,
  SearchIcon,
  Trash2Icon,
  XIcon,
} from "lucide-react"
import { TbPin, TbPinFilled } from "react-icons/tb"
import { useTranslation } from "react-i18next"
import { Navigate, useLocation, useNavigate, useParams } from "react-router-dom"
import {
  buildOfficeAnnotationDisplay,
  isMeaninglessTemporaryUploadPath,
  officeAnnotationRequestText,
  type ConversationCollaborationMode,
  type ConversationUserInputResponse,
} from "@linksense/shared"
import { z } from "zod"

import { ApiError, apiRequest, downloadApiFile } from "@/api/client"
import {
  archivedConversationClearResultSchema,
  applicationConversationSchema,
  applicationSchema,
  capabilitySummarySchema,
  conversationDetailSchema,
  conversationDraftSchema,
  conversationDraftResultSchema,
  conversationFileSchema,
  conversationPlanReviewActionResultSchema,
  conversationSchema,
  getNativeCodexPayload,
  modelPreferenceSchema,
  paginatedSchema,
  pendingRequestSchema,
  pendingRequestRestoreResultSchema,
  threadGoalSchema,
  turnStartReceiptSchema,
  type Conversation,
  type ConversationActivity,
  type ConversationDraft,
  type ConversationEvent,
  type ConversationFile,
  type ConversationMessage,
  type ConversationTurn,
  type ConversationUserInputRequest,
  type NativeMessagePhase,
  type NativeMessageOutputKind,
  type PendingRequest,
  type Application,
  type ThreadGoal,
  type TurnStartReceipt,
  type User,
} from "@/api/contracts"
import { getErrorMessage } from "@/api/error-message"
import { useAuth } from "@/app/auth-state"
import { useProductName } from "@/app/product-branding"
import { ConfirmDialog } from "@/components/feedback/confirm-dialog"
import {
  EmptyState,
  ErrorState,
  LoadingState,
} from "@/components/feedback/page-state"
import { notify } from "@/components/feedback/notification"
import type { ImagePreviewItem } from "@/components/media/image-preview"
import { StatusBanner } from "@/components/feedback/status-banner"
import { ConversationSearchDialog } from "@/components/shell/conversation-search-dialog"
import { PageLayout } from "@/components/shell/page-layout"
import { Button } from "@/components/ui/button"
import { ConversationScrollToBottomIndicator } from "@/features/conversations/conversation-scroll-to-bottom-indicator"
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@/components/ui/hover-card"
import { Separator } from "@/components/ui/separator"
import { ApplicationIconDisplay } from "@/features/applications/application-icon"
import { defaultApplicationIcon } from "@/features/applications/application-icon-default"
import {
  ConversationComposer,
  type ConversationComposerHandle,
  type KnowledgeBaseSelectionStatus,
  type PendingAttachmentUpload,
} from "@/features/conversations/conversation-composer"
import { isConversationContextCompactionAvailable } from "@/features/conversations/conversation-context-compaction"
import { conversationPath } from "@/features/conversations/conversation-navigation"
import { isConversationContextCompactionCommand } from "@/features/conversations/conversation-slash-command"
import { shouldDisplayConversationActivity } from "@/features/conversations/activity-visibility"
import {
  conversationDetailQueryOptions,
  isDefinitiveConversationUnavailableError,
  selectFreshConversationEventSubscriptionId,
} from "@/features/conversations/conversation-detail-query"
import {
  conversationDraftSnapshotFromConversation,
  conversationDraftSnapshotKey,
  conversationDraftSnapshotsEqual,
  createConversationDraftSnapshot,
  effectiveDraftCapabilityIds,
  effectiveDraftKnowledgeBaseIds,
  mergeConversationDraftSnapshots,
  type ConversationDraftField,
  type ConversationDraftSnapshot,
} from "@/features/conversations/conversation-draft-sync"
import { ConversationLineSidebar } from "@/features/conversations/conversation-line-sidebar"
import { buildOfficeAnnotationInput } from "@/features/conversations/conversation-office-annotation"
import { ConversationOfficeLayout } from "@/features/conversations/conversation-presentation-layout"
import { DEFAULT_SUBAGENT_DETAIL_VIEWPORT_RATIO } from "@/features/conversations/conversation-presentation-width"
import {
  ConversationHtmlCodePreview,
  ConversationImagePreview,
  ConversationOfficePreview,
  type ConversationOfficeAnnotationRequest,
} from "@/features/conversations/conversation-office-preview"
import {
  findUpdatedOfficePreviewFile,
  getConversationFiles,
} from "@/features/conversations/conversation-office-preview-update"
import { buildConversationLineSidebarItems } from "@/features/conversations/conversation-line-sidebar-items"
import { getConversationMessageAnchorId } from "@/features/conversations/conversation-message-anchor"
import { upsertSidebarConversation } from "@/features/conversations/conversation-order"
import { ConversationRenameDialog } from "@/features/conversations/conversation-rename-dialog"
import { ConversationTaskOverviewPanel } from "@/features/conversations/conversation-task-overview-panel"
import { buildConversationTaskOverview } from "@/features/conversations/conversation-task-overview"
import { readTaskOverviewOpenPreference } from "@/features/conversations/conversation-task-overview-preference"
import {
  ConversationSubAgentDetail,
  type ConversationSubAgentSelection,
} from "@/features/conversations/conversation-subagent-detail"
import { ConversationThread } from "@/features/conversations/conversation-thread"
import type { NativeSubAgentViewModel } from "@/features/conversations/native-subagent-activity"
import { useSubAgentSummaries } from "@/features/conversations/use-subagent-summaries"
import { createConversationAttachmentPreviewSource } from "@/features/conversations/conversation-attachment-preview-utils"
import { ConversationPlanCard } from "@/features/conversations/conversation-plan-card"
import {
  ConversationPlanDecisionCard,
  type ConversationPlanDecisionBusyAction,
} from "@/features/conversations/conversation-plan-decision-card"
import { ConversationGoalBar } from "@/features/conversations/conversation-goal-bar"
import { ConversationUserInputRequestCard } from "@/features/conversations/conversation-user-input-request-card"
import {
  useKnowledgeBaseList,
  useKnowledgeSearchCapability,
} from "@/features/knowledge-bases/knowledge-base-hooks"
import {
  getKnowledgeBase,
  knowledgeBaseQueryKeys,
} from "@/features/knowledge-bases/knowledge-base-api"
import { isKnowledgeBaseAvailableForTurn } from "@/features/knowledge-bases/knowledge-base-utils"
import { selectConversationTurnPlan } from "@/features/conversations/conversation-plan-selector"
import {
  getConversationEventQueryRefreshScope,
  getConversationQueryRefreshScope,
  type ConversationQueryRefreshScope,
} from "@/features/conversations/conversation-refresh-policy"
import {
  operationAttemptId,
  stableOperationId,
} from "@/features/conversations/operation-id"
import { PendingRequests } from "@/features/conversations/pending-requests"
import {
  appendStreamingMessageDelta,
  applyStreamingMessageLifecycle,
  completeLegacyStreamingMessage,
  projectVisibleConversationMessages,
  removeStreamingMessageItems,
  removePersistedStreamingMessages,
  type StreamingAssistantMessages,
} from "@/features/conversations/streaming-messages"
import {
  appendStreamingReasoningSummaryDelta,
  removeStreamingReasoningSummariesForTurn,
  removeStreamingReasoningSummaryItem,
  type StreamingReasoningSummaries,
} from "@/features/conversations/streaming-reasoning-summaries"
import { useConversationScroll } from "@/features/conversations/use-conversation-scroll"
import { useConversationBottomStackHeight } from "@/features/conversations/use-conversation-bottom-stack-height"
import { useConversationEvents } from "@/features/conversations/use-conversation-events"
import {
  appendConversationLiveEvent,
  isStreamOnlyNativeEvent,
} from "@/features/conversations/conversation-live-events"
import { selectConversationModelContextUsage } from "@/features/conversations/conversation-context-usage"
import { mapLegacyConversationActivity } from "@/features/conversations/legacy-conversation-activity"
import {
  isNativeStreamDisconnectRetry,
  useNativeReconnectSimulation,
} from "@/features/conversations/native-reconnect-simulation"
import { normalizeLanguage } from "@/i18n"
import { formatLongDateTime } from "@/i18n/date"
import { downloadBlob } from "@/lib/download-blob"

const emptyResponseSchema = z.unknown()
const artifactPreviewLinkSchema = z.object({
  url: z.url(),
  expires_at: z.string().datetime({ offset: true }),
})
const reconnectingConversationRefetchIntervalMs = 1_500
const newConversationPlaceholderId = "new"
const goalClearResultSchema = z.strictObject({ cleared: z.boolean() })
const emptyPersistedMessageRenderKeys: ReadonlyMap<string, string> = new Map()
const nativeMessageDeltaPhaseFallbackDelayMs = 120

type OfficePreviewUpdate = Readonly<{
  sourceFile: ConversationFile
  knownFileIds: readonly string[]
}>

type PendingTurnSubmission = Readonly<{
  conversationId: string
  idempotencyKey: string
  message: ConversationMessage
  optimisticId?: string
  turnId?: string
  status?: TurnStartReceipt["status"]
  replacesTurnId?: string
  interruptRequested?: boolean
}>

type PendingOfficeQuestion = Readonly<{
  conversationId: string
  idempotencyKey: string
  request: PendingRequest
}>

type PendingNativeMessageDelta = Readonly<{
  itemId: string
  turnId?: string | null
  outputKind: NativeMessageOutputKind
  delta: string
  createdAt: string
  sequence: number
}>

let pendingAttachmentUploadSequence = 0

function createPendingAttachmentUpload(
  file: File,
  index: number
): PendingAttachmentUpload {
  pendingAttachmentUploadSequence += 1
  return {
    id: `pending-attachment-${Date.now()}-${pendingAttachmentUploadSequence}-${index}`,
    name: file.name,
    size: file.size,
    mimeType: file.type || undefined,
  }
}

type ComposerSubmission = Readonly<{
  input: string
  capabilityIds: string[]
  knowledgeBaseIds: string[]
  attachments: ConversationFile[]
  collaborationMode: ConversationCollaborationMode
  optimisticId?: string
}>

type DraftSaveOptions = Readonly<{
  useLatestComposerSnapshot?: boolean
}>

type PlanReviewActionSubmission =
  | Readonly<{ reviewId: string; action: "implement" }>
  | Readonly<{ reviewId: string; action: "revise"; feedback: string }>
  | Readonly<{ reviewId: string; action: "skip" | "exit" }>

type OptimisticGoal = Readonly<{
  conversationId: string
  goal: ThreadGoal
  previousGoalRevision: string | null
}>

type OptimisticAttachmentConsumption = Readonly<{
  conversationId: string
  previousAttachments: ConversationFile[]
  submittedAttachmentIds: string[]
}>

type UserTokenQuotaUsage = NonNullable<
  NonNullable<User["token_quota"]>["total"]
>

function isTokenQuotaPeriodExhausted(
  period: UserTokenQuotaUsage | null | undefined
) {
  if (!period) return false
  const remainingTokens = period.remaining_tokens.trim()
  if (/^-/u.test(remainingTokens)) return true
  if (/^\+?\d+$/u.test(remainingTokens)) {
    return remainingTokens.replace(/^\+?0*/u, "") === ""
  }
  return period.remaining_percentage <= 0
}

function getExhaustedTokenQuotaKey(tokenQuota: User["token_quota"]) {
  if (!tokenQuota) return null
  const exhaustedPeriods = [
    ["total", tokenQuota.total] as const,
    ["weekly", tokenQuota.weekly] as const,
    ["monthly", tokenQuota.monthly] as const,
  ].filter(([, period]) => isTokenQuotaPeriodExhausted(period))
  if (exhaustedPeriods.length === 0) return null
  return exhaustedPeriods
    .map(
      ([periodName, period]) =>
        `${periodName}:${period?.remaining_tokens ?? ""}`
    )
    .join("|")
}

function TokenQuotaBlockedCard({
  onDismiss,
}: Readonly<{
  onDismiss: () => void
}>) {
  const { t } = useTranslation()
  return (
    <div className="conversation-token-quota-card-dock">
      <Card
        size="sm"
        className="conversation-token-quota-card"
        role="status"
        aria-live="polite"
      >
        <CardHeader className="conversation-token-quota-card-header">
          <span
            className="conversation-token-quota-card-icon"
            aria-hidden="true"
          >
            <CircleAlertIcon aria-hidden="true" />
          </span>
          <div className="conversation-token-quota-card-copy">
            <CardTitle className="conversation-token-quota-card-title">
              {t("conversation.tokenQuotaBlocked.title")}
            </CardTitle>
            <CardDescription className="conversation-token-quota-card-description">
              {t("conversation.tokenQuotaBlocked.description")}
            </CardDescription>
          </div>
          <CardAction className="conversation-token-quota-card-action">
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className="conversation-token-quota-card-dismiss"
              aria-label={t("conversation.tokenQuotaBlocked.dismiss")}
              onClick={onDismiss}
            >
              <XIcon aria-hidden="true" />
            </Button>
          </CardAction>
        </CardHeader>
      </Card>
    </div>
  )
}

function createOptimisticGoal(objective: string): ThreadGoal {
  const now = new Date().toISOString()
  return {
    thread_id: `optimistic-goal-${Date.now()}`,
    objective,
    status: "active",
    token_budget: null,
    tokens_used: 0,
    time_used_seconds: 0,
    created_at: now,
    updated_at: now,
  }
}

function threadGoalRevision(
  goal: ThreadGoal | null | undefined
): string | null {
  if (!goal) return null
  return JSON.stringify({
    threadId: goal.thread_id,
    objective: goal.objective,
    status: goal.status,
    tokenBudget: goal.token_budget,
    tokensUsed: goal.tokens_used,
    timeUsedSeconds: goal.time_used_seconds,
    createdAt: goal.created_at,
    updatedAt: goal.updated_at,
  })
}

type DraftConflictState = Readonly<{
  conversationId: string
  local: ConversationDraftSnapshot
  remote: ConversationDraftSnapshot
  remoteUpdatedAt: string | null
  conflictingFields: readonly ConversationDraftField[]
}>

class DraftConflictPendingError extends Error {
  constructor() {
    super("Draft conflict requires a user decision")
    this.name = "DraftConflictPendingError"
  }
}

function isDraftConflictPendingError(error: unknown) {
  return error instanceof DraftConflictPendingError
}

function isNewerDraftVersion(
  candidate: string | null,
  current: string | null
): boolean {
  if (!candidate || candidate === current) return false
  if (!current) return true
  const candidateTime = Date.parse(candidate)
  const currentTime = Date.parse(current)
  if (Number.isNaN(candidateTime) || Number.isNaN(currentTime)) return true
  return candidateTime > currentTime
}

function isAttachmentConversationFile(file: ConversationFile) {
  return (
    file.kind === "attachment" ||
    (file.kind === undefined && !file.download_available)
  )
}

function isMeaningfulComposerUploadFile(file: File) {
  const webkitRelativePath = (file as File & { webkitRelativePath?: string })
    .webkitRelativePath
  return !isMeaninglessTemporaryUploadPath(webkitRelativePath || file.name)
}

function isDefinitiveKnowledgeBaseSelectionError(error: unknown) {
  return (
    error instanceof ApiError &&
    (error.status === 403 || error.status === 404 || error.status === 410)
  )
}

export function ConversationPage({
  headerActions,
}: Readonly<{
  headerActions?: ReactNode
}> = {}) {
  const { conversationId } = useParams()
  const isNew = !conversationId || conversationId === "new"
  const { t } = useTranslation()
  const productName = useProductName()
  const { user, refreshUser } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const queryClient = useQueryClient()
  const [value, setValue] = useState("")
  const [taskOverviewOpen, setTaskOverviewOpen] = useState(
    readTaskOverviewOpenPreference
  )
  const [
    pendingFirstMessageConversationId,
    setPendingFirstMessageConversationId,
  ] = useState<string | null>(null)
  const [selectedCapabilityIds, setSelectedCapabilityIds] = useState<string[]>(
    []
  )
  const [selectedKnowledgeBaseIds, setSelectedKnowledgeBaseIds] = useState<
    string[]
  >([])
  const [newTaskResetVersion, setNewTaskResetVersion] = useState(0)
  const [
    composerAttachmentOperationPending,
    setComposerAttachmentOperationPending,
  ] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [tokenQuotaNotice, setTokenQuotaNotice] = useState<string | null>(null)
  const [dismissedTokenQuotaBlockKey, setDismissedTokenQuotaBlockKey] =
    useState<string | null>(null)
  const setTurnAdmissionError = useCallback(
    (nextError: unknown) => {
      const message = getErrorMessage(nextError, t)
      if (
        nextError instanceof ApiError &&
        nextError.errorCode === "TOKEN_LIMIT_EXCEEDED"
      ) {
        setError(null)
        setTokenQuotaNotice(message)
        void refreshUser().catch(() => undefined)
        return
      }
      setTokenQuotaNotice(null)
      setError(message)
    },
    [refreshUser, t]
  )
  const [draftConflict, setDraftConflict] = useState<DraftConflictState | null>(
    null
  )
  const [resolvingDraftConflict, setResolvingDraftConflict] = useState(false)
  const [interrupting, setInterrupting] = useState(false)
  const [goalModeState, setGoalModeState] = useState<{
    conversationId: string | undefined
    enabled: boolean
  }>({ conversationId, enabled: false })
  const setGoalMode = useCallback(
    (enabled: boolean) => setGoalModeState({ conversationId, enabled }),
    [conversationId]
  )
  const [newTaskCollaborationMode, setNewTaskCollaborationMode] =
    useState<ConversationCollaborationMode>("default")
  const [goalPendingAction, setGoalPendingAction] = useState<
    "edit" | "pause" | "resume" | "clear" | null
  >(null)
  const [renameOpen, setRenameOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [renameValue, setRenameValue] = useState("")
  const [pendingActionId, setPendingActionId] = useState<string>()
  const [pendingTurnSubmission, setPendingTurnSubmission] =
    useState<PendingTurnSubmission | null>(null)
  const [pendingCompaction, setPendingCompaction] = useState<{
    conversationId: string
    turnId: string
    startedAt: string
  } | null>(null)
  const [pendingOfficeQuestion, setPendingOfficeQuestion] =
    useState<PendingOfficeQuestion | null>(null)
  const [optimisticGoal, setOptimisticGoal] = useState<OptimisticGoal | null>(
    null
  )
  const [optimisticAttachmentConsumption, setOptimisticAttachmentConsumption] =
    useState<Readonly<{
      conversationId: string
      submittedAttachmentIds: string[]
    }> | null>(null)
  const [pendingAttachmentUploads, setPendingAttachmentUploads] = useState<
    PendingAttachmentUpload[]
  >([])
  const [streamedMessages, setStreamedMessages] =
    useState<StreamingAssistantMessages>({})
  const legacyStreamItemIdByTurnRef = useRef(new Map<string, string>())
  const nativeMessagePhaseByItemIdRef = useRef(
    new Map<string, NativeMessagePhase | null>()
  )
  const stopHookSupersededItemIdsByTurnRef = useRef(
    new Map<string, Set<string>>()
  )
  const planOutputMissingMessagesByTurnRef = useRef(new Map<string, string>())
  const pendingNativeMessageDeltasByItemIdRef = useRef(
    new Map<string, PendingNativeMessageDelta[]>()
  )
  const pendingNativeMessageDeltaTimersRef = useRef(new Map<string, number>())
  const [persistedMessageRenderKeyState, setPersistedMessageRenderKeyState] =
    useState<{
      conversationId: string | undefined
      keys: ReadonlyMap<string, string>
    }>({ conversationId, keys: emptyPersistedMessageRenderKeys })
  const persistedMessageRenderKeys =
    persistedMessageRenderKeyState.conversationId === conversationId
      ? persistedMessageRenderKeyState.keys
      : emptyPersistedMessageRenderKeys
  const [liveReasoningSummaries, setLiveReasoningSummaries] =
    useState<StreamingReasoningSummaries>({})
  const [liveActivities, setLiveActivities] = useState<ConversationActivity[]>(
    []
  )
  const [liveEvents, setLiveEvents] = useState<ConversationEvent[]>([])
  const [liveConversationId, setLiveConversationId] = useState(conversationId)
  const [downloadingFileId, setDownloadingFileId] = useState<string>()
  const [officePreview, setOfficePreview] = useState<{
    conversationId: string | undefined
    file: ConversationFile
    animateEntrance: boolean
  } | null>(null)
  const [htmlCodePreview, setHtmlCodePreview] = useState<{
    conversationId: string | undefined
    html: string
    fileName: string
    animateEntrance: boolean
  } | null>(null)
  const [imagePreview, setImagePreview] = useState<{
    conversationId: string | undefined
    item: ImagePreviewItem
    animateEntrance: boolean
  } | null>(null)
  const [officePreviewUpdate, setOfficePreviewUpdate] =
    useState<OfficePreviewUpdate | null>(null)
  const [filePreviewClosing, setFilePreviewClosing] = useState(false)
  const [selectedSubAgent, setSelectedSubAgent] =
    useState<ConversationSubAgentSelection | null>(null)
  const officeFile =
    officePreview?.conversationId === conversationId
      ? (officePreview?.file ?? null)
      : null
  const activeHtmlCodePreview =
    htmlCodePreview?.conversationId === conversationId ? htmlCodePreview : null
  const activeImagePreview =
    imagePreview?.conversationId === conversationId ? imagePreview : null
  const activeSubAgent =
    selectedSubAgent?.conversationId === conversationId
      ? selectedSubAgent
      : null
  const downloadInFlightRef = useRef(false)
  const composerRef = useRef<ConversationComposerHandle>(null)
  const hydratedIdRef = useRef<string | null>(null)
  const lastDraftRef = useRef("")
  const lastDraftSnapshotRef = useRef<ConversationDraftSnapshot>(
    createConversationDraftSnapshot("", [], [])
  )
  const lastQueuedDraftRef = useRef("")
  const composerDraftSnapshotRef = useRef<ConversationDraftSnapshot>(
    createConversationDraftSnapshot("", [], [])
  )
  const draftConflictRef = useRef<DraftConflictState | null>(null)
  const turnSubmitOperationRef =
    useRef<Parameters<typeof stableOperationId>[0]["current"]>(null)
  const goalStartOperationRef =
    useRef<Parameters<typeof stableOperationId>[0]["current"]>(null)
  const contextCompactionOperationRef =
    useRef<Parameters<typeof stableOperationId>[0]["current"]>(null)
  const officeTurnSubmitOperationRef =
    useRef<Parameters<typeof stableOperationId>[0]["current"]>(null)
  const officeTurnSubmitAttemptRef = useRef<string | null>(null)
  const steerOperationRef =
    useRef<Parameters<typeof stableOperationId>[0]["current"]>(null)
  const pendingOperationRef =
    useRef<Parameters<typeof stableOperationId>[0]["current"]>(null)
  const planReviewOperationRef =
    useRef<Parameters<typeof stableOperationId>[0]["current"]>(null)
  const submittedDraftSnapshotRef = useRef<string | null>(null)
  const composerSubmissionInFlightRef = useRef(false)
  const composerAttachmentOperationInFlightRef = useRef(false)
  const composerModelPreferenceOperationInFlightRef = useRef(false)
  const attachmentMutationTargetConversationIdRef = useRef<string | null>(null)
  const currentRouteConversationId = isNew ? null : (conversationId ?? null)
  const routeConversationIdRef = useRef<string | null>(
    currentRouteConversationId
  )
  const routeEpochRef = useRef(0)
  const ensureConversationPromiseRef = useRef<{
    epoch: number
    promise: Promise<string>
  } | null>(null)
  const sendSubmissionConversationIdRef = useRef<string | null>(null)
  const goalStartSubmissionConversationIdRef = useRef<string | null>(null)
  const steerSubmissionConversationIdRef = useRef<string | null>(null)
  const pendingSubmissionConversationIdRef = useRef<string | null>(null)
  const runnerPrewarmAtRef = useRef(0)
  const dispatchedInterruptTurnIdsRef = useRef(new Set<string>())

  useLayoutEffect(() => {
    routeEpochRef.current += 1
    routeConversationIdRef.current = currentRouteConversationId
  }, [currentRouteConversationId, location.key, newTaskResetVersion])

  const regenerateOperationRef =
    useRef<Parameters<typeof stableOperationId>[0]["current"]>(null)
  const forkOperationRef = useRef<string | null>(null)
  const draftUpdatedAtRef = useRef<string | null>(null)
  const draftQueueRef = useRef<Promise<void>>(Promise.resolve())
  const queuedDraftSaveRef = useRef<{
    snapshot: string
    promise: Promise<ConversationDraftSnapshot>
  } | null>(null)
  const invalidateTimerRef = useRef<number | null>(null)
  const pendingDetailRefreshRef = useRef(false)
  const pendingListRefreshRef = useRef(false)
  const terminalSidebarSyncRef = useRef<string | null>(null)
  const seenEventIdsRef = useRef(new Set<string>())
  const liveConversationIdRef = useRef(conversationId)
  const autoInterruptedTurnIdRef = useRef<string | null>(null)
  const {
    scrollContainerRef,
    contentRef,
    showScrollToBottom,
    scrollToBottom,
    scrollToElement,
    pauseAutoFollow,
    preserveScrollPositionForInteraction,
  } = useConversationScroll(conversationId ?? "new")
  const bottomStackRef = useConversationBottomStackHeight()

  const handleScrollToBottom = useCallback(() => {
    const prefersReducedMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)"
    ).matches
    scrollToBottom(prefersReducedMotion ? "auto" : "smooth")
  }, [scrollToBottom])

  const handleStarterQuestionSelect = useCallback((prompt: string) => {
    setError(null)
    setTokenQuotaNotice(null)
    setValue(prompt)
    window.setTimeout(() => composerRef.current?.focus(), 0)
  }, [])

  const conversationQuery = useQuery({
    ...conversationDetailQueryOptions(conversationId),
    enabled: !isNew,
  })
  const isApplicationConversation = Boolean(conversationQuery.data?.application)
  const isManagedApplicationConversation =
    conversationQuery.data?.application?.kind === "standard"
  const applicationId = conversationQuery.data?.application?.id ?? ""
  const applicationDetailActorId = user?.id ?? ""
  const applicationDetailQuery = useQuery({
    queryKey: [
      "applications",
      "detail",
      applicationDetailActorId,
      applicationId,
    ],
    queryFn: ({ signal }) =>
      apiRequest(`/applications/${applicationId}`, {
        schema: applicationSchema,
        signal,
      }),
    enabled: applicationDetailActorId.length > 0 && applicationId.length > 0,
  })
  const startApplicationFromComposerMutation = useMutation({
    mutationFn: (application: Application) =>
      apiRequest(`/applications/${application.id}/conversations`, {
        method: "POST",
        schema: applicationConversationSchema,
      }),
    onSuccess: ({ conversation_id }) => {
      setError(null)
      void queryClient.invalidateQueries({ queryKey: ["conversations"] })
      navigate(`/conversations/${conversation_id}`)
    },
    onError: (nextError) => setError(getErrorMessage(nextError, t)),
  })
  const applicationAllowsUserModelSelection =
    isApplicationConversation && applicationDetailQuery.data?.model === null
  const canSelectConversationModel =
    !isApplicationConversation || applicationAllowsUserModelSelection

  const capabilityQuery = useQuery({
    queryKey: ["capabilities", "available"],
    queryFn: ({ signal }) =>
      apiRequest("/capabilities", {
        schema: paginatedSchema(capabilitySummarySchema),
        query: { view: "available" },
        signal,
      }),
    enabled:
      isNew ||
      (conversationQuery.isSuccess && !isManagedApplicationConversation),
  })

  const modelPreferenceScope = isNew ? "new" : conversationId
  const modelPreferenceQueryKey = [
    "me",
    "model-preference",
    modelPreferenceScope,
  ] as const
  const modelPreferenceQuery = useQuery({
    queryKey: modelPreferenceQueryKey,
    queryFn: ({ signal }) =>
      apiRequest(
        isNew
          ? "/me/model-preference"
          : `/conversations/${conversationId}/model-preference`,
        {
          schema: modelPreferenceSchema,
          signal,
        }
      ),
    enabled:
      isNew || (conversationQuery.isSuccess && canSelectConversationModel),
  })
  const modelPreferenceMutation = useMutation({
    mutationFn: async ({
      model,
      reasoningEffort,
      targetConversationId,
    }: {
      model: string
      reasoningEffort: string
      targetConversationId: string | null
    }) => {
      await draftQueueRef.current
      return apiRequest(
        targetConversationId
          ? `/conversations/${targetConversationId}/model-preference`
          : "/me/model-preference",
        {
          method: "PUT",
          body: {
            selected_model: model,
            selected_reasoning_effort: reasoningEffort,
          },
          schema: modelPreferenceSchema,
        }
      )
    },
    onSuccess: (preference, variables) => {
      queryClient.setQueryData(
        ["me", "model-preference", variables.targetConversationId ?? "new"],
        preference
      )
      queryClient.setQueryData(["me", "model-preference", "new"], preference)
      setError(null)
    },
    onError: (nextError, variables) => {
      if (routeConversationIdRef.current === variables.targetConversationId) {
        setError(getErrorMessage(nextError, t))
      }
    },
    onSettled: () => {
      composerModelPreferenceOperationInFlightRef.current = false
    },
  })

  const knowledgeBaseQuery = useKnowledgeBaseList(
    {
      lifecycle: "active",
      scope: "all",
      search: "",
    },
    {
      enabled:
        isNew ||
        (conversationQuery.isSuccess && !isManagedApplicationConversation),
    }
  )
  const knowledgeSearchCapability = useKnowledgeSearchCapability(
    isNew || (conversationQuery.isSuccess && !isManagedApplicationConversation)
  )
  const pagedKnowledgeBases = useMemo(
    () => knowledgeBaseQuery.data?.pages.flatMap((page) => page.items) ?? [],
    [knowledgeBaseQuery.data]
  )
  const pagedKnowledgeBaseIds = useMemo(
    () => new Set(pagedKnowledgeBases.map((knowledgeBase) => knowledgeBase.id)),
    [pagedKnowledgeBases]
  )
  const missingSelectedKnowledgeBaseIds = useMemo(
    () =>
      [...new Set(selectedKnowledgeBaseIds)].filter(
        (knowledgeBaseId) => !pagedKnowledgeBaseIds.has(knowledgeBaseId)
      ),
    [pagedKnowledgeBaseIds, selectedKnowledgeBaseIds]
  )
  const selectedKnowledgeBaseQueries = useQueries({
    queries: missingSelectedKnowledgeBaseIds.map((knowledgeBaseId) => ({
      queryKey: knowledgeBaseQueryKeys.detail(knowledgeBaseId),
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        getKnowledgeBase(knowledgeBaseId, signal),
    })),
  })
  const availableKnowledgeBases = useMemo(() => {
    const byId = new Map(
      pagedKnowledgeBases.map((knowledgeBase) => [
        knowledgeBase.id,
        knowledgeBase,
      ])
    )
    for (const query of selectedKnowledgeBaseQueries) {
      if (query.data) byId.set(query.data.id, query.data)
    }
    return [...byId.values()]
  }, [pagedKnowledgeBases, selectedKnowledgeBaseQueries])
  const knowledgeBaseSelectionStatusById = useMemo(() => {
    const knowledgeBasesById = new Map(
      availableKnowledgeBases.map((knowledgeBase) => [
        knowledgeBase.id,
        knowledgeBase,
      ])
    )
    const detailQueriesById = new Map(
      missingSelectedKnowledgeBaseIds.map((knowledgeBaseId, index) => [
        knowledgeBaseId,
        selectedKnowledgeBaseQueries[index],
      ])
    )
    const statuses: Record<string, KnowledgeBaseSelectionStatus> = {}
    for (const knowledgeBaseId of new Set(selectedKnowledgeBaseIds)) {
      const detailQuery = detailQueriesById.get(knowledgeBaseId)
      if (
        detailQuery?.isError &&
        isDefinitiveKnowledgeBaseSelectionError(detailQuery.error)
      ) {
        statuses[knowledgeBaseId] = "unavailable"
        continue
      }
      const knowledgeBase = knowledgeBasesById.get(knowledgeBaseId)
      if (knowledgeBase) {
        statuses[knowledgeBaseId] = isKnowledgeBaseAvailableForTurn(
          knowledgeBase
        )
          ? "available"
          : "unavailable"
        continue
      }
      if (
        detailQuery?.isPending ||
        (detailQuery?.isFetching && !detailQuery.data)
      ) {
        statuses[knowledgeBaseId] = "loading"
        continue
      }
      statuses[knowledgeBaseId] = detailQuery?.isError
        ? "verification_failed"
        : "loading"
    }
    return statuses
  }, [
    availableKnowledgeBases,
    missingSelectedKnowledgeBaseIds,
    selectedKnowledgeBaseIds,
    selectedKnowledgeBaseQueries,
  ])
  const validSelectedKnowledgeBaseIds = useMemo(() => {
    return [...new Set(selectedKnowledgeBaseIds)].filter(
      (knowledgeBaseId) =>
        knowledgeBaseSelectionStatusById[knowledgeBaseId] === "available"
    )
  }, [knowledgeBaseSelectionStatusById, selectedKnowledgeBaseIds])
  const knowledgeBaseSelectionVerificationFailed = Object.values(
    knowledgeBaseSelectionStatusById
  ).some((status) => status === "verification_failed")
  const knowledgeBaseSelectionLoading = Object.values(
    knowledgeBaseSelectionStatusById
  ).some((status) => status === "loading")
  const knowledgeBasesLoading =
    knowledgeBaseQuery.isLoading ||
    (knowledgeBaseQuery.isFetching &&
      !knowledgeBaseQuery.isFetchedAfterMount) ||
    knowledgeBaseSelectionLoading
  const knowledgeBasesError =
    knowledgeBaseQuery.isError || knowledgeBaseSelectionVerificationFailed
  const knowledgeBaseSelectionPending =
    selectedKnowledgeBaseIds.length > 0 &&
    (knowledgeBasesLoading || knowledgeBaseSelectionVerificationFailed)

  const conversation = conversationQuery.data
  const persistedGoalRevision = threadGoalRevision(conversation?.goal)
  const refetchConversation = conversationQuery.refetch
  const hasConversation = Boolean(conversation)
  const suppressEmptyState =
    pendingFirstMessageConversationId !== null &&
    (isNew || pendingFirstMessageConversationId === conversationId) &&
    !conversation?.messages?.length
  const exhaustedTokenQuotaKey = getExhaustedTokenQuotaKey(
    user?.token_quota ?? null
  )
  const taskStartDisabledByTokenQuota = exhaustedTokenQuotaKey !== null
  const showTokenQuotaBlockedCard =
    exhaustedTokenQuotaKey !== null &&
    dismissedTokenQuotaBlockKey !== exhaustedTokenQuotaKey
  const emptyTokenQuotaNotice = taskStartDisabledByTokenQuota
    ? null
    : tokenQuotaNotice
  const optimisticallyConsumedAttachmentIds =
    optimisticAttachmentConsumption &&
    optimisticAttachmentConsumption.conversationId === conversation?.id
      ? new Set(optimisticAttachmentConsumption.submittedAttachmentIds)
      : null
  const attachments = (conversation?.attachments ?? []).filter(
    (attachment) => !optimisticallyConsumedAttachmentIds?.has(attachment.id)
  )
  const running = conversation?.running_turn?.status === "running"
  const currentConversationViewId =
    conversationId ?? newConversationPlaceholderId
  const pendingTurnExecutionActive = Boolean(
    pendingTurnSubmission?.conversationId === currentConversationViewId
  )
  const acceptedTurnAwaitingProjection = Boolean(
    pendingTurnExecutionActive &&
    pendingTurnSubmission?.status !== undefined &&
    !conversation?.turns?.some(
      (turn) => turn.id === pendingTurnSubmission.turnId
    )
  )
  const acceptedCompactionAwaitingProjection = Boolean(
    pendingCompaction &&
    pendingCompaction.conversationId === conversationId &&
    !conversation?.turns?.some((turn) => turn.id === pendingCompaction.turnId)
  )
  const turnExecutionActive =
    running ||
    acceptedTurnAwaitingProjection ||
    acceptedCompactionAwaitingProjection
  const latestConversationTurn = conversation?.turns?.at(-1)
  const compactionAvailable = isConversationContextCompactionAvailable({
    isNew,
    archived: Boolean(conversation?.archived),
    latestTurnStatus: latestConversationTurn?.status,
    turnExecutionActive,
  })
  const collaborationMode = isNew
    ? newTaskCollaborationMode
    : (conversation?.collaboration_mode ?? "default")
  const planMode = collaborationMode === "plan"
  const goalMode =
    goalModeState.conversationId === conversationId && goalModeState.enabled
  const {
    state: nativeReconnectState,
    start: startNativeReconnect,
    clear: clearNativeReconnect,
  } = useNativeReconnectSimulation({
    conversationId: isNew ? undefined : conversationId,
    turnId: conversation?.running_turn?.id,
  })
  const reconnectExhausted = nativeReconnectState?.phase === "failed"
  const visuallyRunning = Boolean(
    (running || pendingTurnExecutionActive) && !reconnectExhausted
  )
  const runningMessageAction = user?.running_message_action ?? "queue"
  const previewUpdateCandidate =
    conversation &&
    officePreviewUpdate &&
    officeFile?.id === officePreviewUpdate.sourceFile.id
      ? findUpdatedOfficePreviewFile({
          sourceFile: officePreviewUpdate.sourceFile,
          knownFileIds: officePreviewUpdate.knownFileIds,
          files: getConversationFiles(conversation),
        })
      : null

  const prewarmRunner = useCallback(() => {
    const now = Date.now()
    if (now - runnerPrewarmAtRef.current < 60_000) return
    runnerPrewarmAtRef.current = now
    void apiRequest("/conversations/prewarm", {
      method: "POST",
      body: {},
      schema: emptyResponseSchema,
    }).catch(() => {
      runnerPrewarmAtRef.current = 0
    })
  }, [])

  const startNewTaskFromComposer = useCallback(() => {
    if (
      composerSubmissionInFlightRef.current ||
      composerAttachmentOperationInFlightRef.current ||
      composerModelPreferenceOperationInFlightRef.current
    )
      return
    setError(null)
    if (!isNew) {
      navigate("/conversations/new")
      return
    }
    setPendingFirstMessageConversationId(null)
    setValue("")
    setGoalMode(false)
    setNewTaskCollaborationMode("default")
    setSelectedCapabilityIds([])
    setSelectedKnowledgeBaseIds([])
    setOfficePreview(null)
    setOfficePreviewUpdate(null)
    setImagePreview(null)
    setSelectedSubAgent(null)
    setOptimisticGoal(null)
    setNewTaskResetVersion((current) => current + 1)
    window.setTimeout(() => composerRef.current?.focus(), 0)
  }, [isNew, navigate, setGoalMode])

  useEffect(() => {
    legacyStreamItemIdByTurnRef.current.clear()
  }, [conversationId])

  useEffect(() => {
    prewarmRunner()
    const handleFocus = () => prewarmRunner()
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") prewarmRunner()
    }
    window.addEventListener("focus", handleFocus)
    document.addEventListener("visibilitychange", handleVisibilityChange)
    return () => {
      window.removeEventListener("focus", handleFocus)
      document.removeEventListener("visibilitychange", handleVisibilityChange)
    }
  }, [prewarmRunner])

  const applyOfficePreviewUpdate = useCallback(() => {
    if (!previewUpdateCandidate || !officePreviewUpdate) return
    setOfficePreview((current) =>
      current && current.file.id === officePreviewUpdate.sourceFile.id
        ? { ...current, file: previewUpdateCandidate }
        : current
    )
    setOfficePreviewUpdate(null)
  }, [officePreviewUpdate, previewUpdateCandidate])

  useEffect(() => {
    composerDraftSnapshotRef.current = createConversationDraftSnapshot(
      value,
      selectedCapabilityIds,
      selectedKnowledgeBaseIds
    )
  }, [selectedCapabilityIds, selectedKnowledgeBaseIds, value])

  const applyComposerDraftSnapshot = useCallback(
    (snapshot: ConversationDraftSnapshot) => {
      setValue(snapshot.input)
      setSelectedCapabilityIds([...snapshot.capabilityIds])
      setSelectedKnowledgeBaseIds([...snapshot.knowledgeBaseIds])
    },
    []
  )

  const recordAcknowledgedDraft = useCallback(
    (
      id: string,
      snapshot: ConversationDraftSnapshot,
      updatedAt: string | null
    ) => {
      if (hydratedIdRef.current !== id && routeConversationIdRef.current !== id)
        return
      hydratedIdRef.current = id
      lastDraftSnapshotRef.current = snapshot
      lastDraftRef.current = conversationDraftSnapshotKey(snapshot)
      draftUpdatedAtRef.current = updatedAt
    },
    []
  )

  const updateConversationDraftCache = useCallback(
    (
      id: string,
      snapshot: ConversationDraftSnapshot,
      draft: ConversationDraft
    ) => {
      queryClient.setQueryData<Conversation>(
        ["conversation", id],
        (currentConversation) =>
          currentConversation
            ? {
                ...currentConversation,
                draft: {
                  ...(currentConversation.draft ?? {}),
                  ...draft,
                  input_text: snapshot.input,
                  priority_capability_ids: [...snapshot.capabilityIds],
                  knowledge_base_ids: [...snapshot.knowledgeBaseIds],
                },
                draft_input: snapshot.input,
                draft_capability_ids: [...snapshot.capabilityIds],
                draft_knowledge_base_ids: [...snapshot.knowledgeBaseIds],
                selected_knowledge_base_ids: [...snapshot.knowledgeBaseIds],
              }
            : currentConversation
      )
    },
    [queryClient]
  )

  const publishDraftConflict = useCallback(
    (nextConflict: DraftConflictState) => {
      draftConflictRef.current = nextConflict
      setDraftConflict(nextConflict)
      setError(null)
    },
    []
  )

  const clearDraftConflict = useCallback(() => {
    draftConflictRef.current = null
    setDraftConflict(null)
  }, [])

  useEffect(() => {
    if (
      !isNew &&
      conversation &&
      hydratedIdRef.current !== conversation.id &&
      conversationQuery.isFetching &&
      !conversationQuery.isFetchedAfterMount
    ) {
      return
    }
    const timer = window.setTimeout(() => {
      if (isNew) {
        hydratedIdRef.current = null
        lastDraftRef.current = ""
        lastDraftSnapshotRef.current = createConversationDraftSnapshot(
          "",
          [],
          []
        )
        lastQueuedDraftRef.current = ""
        draftUpdatedAtRef.current = null
        draftQueueRef.current = Promise.resolve()
        queuedDraftSaveRef.current = null
        draftConflictRef.current = null
        setDraftConflict(null)
        setValue("")
        setSelectedCapabilityIds([])
        setSelectedKnowledgeBaseIds([])
        return
      }
      if (!conversation) return
      const serverSnapshot =
        conversationDraftSnapshotFromConversation(conversation)
      const serverSnapshotKey = conversationDraftSnapshotKey(serverSnapshot)
      const serverUpdatedAt = conversation.draft?.updated_at ?? null
      if (hydratedIdRef.current !== conversation.id) {
        hydratedIdRef.current = conversation.id
        applyComposerDraftSnapshot(serverSnapshot)
        setRenameValue(conversation.title)
        lastDraftSnapshotRef.current = serverSnapshot
        lastDraftRef.current = serverSnapshotKey
        lastQueuedDraftRef.current = serverSnapshotKey
        draftUpdatedAtRef.current = serverUpdatedAt
        draftQueueRef.current = Promise.resolve()
        queuedDraftSaveRef.current = null
        draftConflictRef.current = null
        setDraftConflict(null)
        return
      }

      if (!isNewerDraftVersion(serverUpdatedAt, draftUpdatedAtRef.current)) {
        return
      }
      const baseSnapshot = lastDraftSnapshotRef.current
      const localSnapshot = composerDraftSnapshotRef.current
      if (conversationDraftSnapshotsEqual(serverSnapshot, baseSnapshot)) {
        draftUpdatedAtRef.current = serverUpdatedAt
        return
      }
      if (conversationDraftSnapshotsEqual(localSnapshot, baseSnapshot)) {
        applyComposerDraftSnapshot(serverSnapshot)
        lastDraftSnapshotRef.current = serverSnapshot
        lastDraftRef.current = serverSnapshotKey
        lastQueuedDraftRef.current = serverSnapshotKey
        draftUpdatedAtRef.current = serverUpdatedAt
        queuedDraftSaveRef.current = null
        draftConflictRef.current = null
        setDraftConflict(null)
        return
      }

      const merged = mergeConversationDraftSnapshots(
        baseSnapshot,
        localSnapshot,
        serverSnapshot
      )
      lastDraftSnapshotRef.current = serverSnapshot
      lastDraftRef.current = serverSnapshotKey
      lastQueuedDraftRef.current = serverSnapshotKey
      draftUpdatedAtRef.current = serverUpdatedAt
      queuedDraftSaveRef.current = null
      if (merged.conflictingFields.length > 0) {
        const nextConflict = {
          conversationId: conversation.id,
          local: localSnapshot,
          remote: serverSnapshot,
          remoteUpdatedAt: serverUpdatedAt,
          conflictingFields: merged.conflictingFields,
        } satisfies DraftConflictState
        draftConflictRef.current = nextConflict
        setDraftConflict(nextConflict)
        setError(null)
        return
      }
      applyComposerDraftSnapshot(merged.snapshot)
    }, 0)
    return () => window.clearTimeout(timer)
  }, [
    applyComposerDraftSnapshot,
    conversation,
    conversationQuery.isFetchedAfterMount,
    conversationQuery.isFetching,
    isNew,
  ])

  const enqueueDraftOperation = useCallback(
    <T,>(operation: () => Promise<T>): Promise<T> => {
      const result = draftQueueRef.current.then(operation)
      draftQueueRef.current = result.then(
        () => undefined,
        () => undefined
      )
      return result
    },
    []
  )

  const queueDraftSave = useCallback(
    (
      id: string,
      nextInput: string,
      nextCapabilityIds: string[],
      nextKnowledgeBaseIds: string[],
      options: DraftSaveOptions = {}
    ): Promise<ConversationDraftSnapshot> => {
      const requestedSnapshot = createConversationDraftSnapshot(
        nextInput,
        nextCapabilityIds,
        nextKnowledgeBaseIds
      )
      const snapshot = conversationDraftSnapshotKey(requestedSnapshot)
      const activeConflict = draftConflictRef.current
      if (activeConflict?.conversationId === id) {
        publishDraftConflict({
          ...activeConflict,
          local: requestedSnapshot,
        })
        return Promise.reject(new DraftConflictPendingError())
      }
      if (
        snapshot === lastDraftRef.current &&
        snapshot === lastQueuedDraftRef.current
      ) {
        return draftQueueRef.current.then(() => requestedSnapshot)
      }
      if (
        snapshot === lastQueuedDraftRef.current &&
        queuedDraftSaveRef.current?.snapshot === snapshot
      ) {
        return queuedDraftSaveRef.current.promise
      }
      lastQueuedDraftRef.current = snapshot
      const operationSnapshots = new Set([snapshot])
      const save = enqueueDraftOperation(async () => {
        let localSnapshot = requestedSnapshot
        for (let attempt = 0; attempt < 3; attempt += 1) {
          if (draftConflictRef.current?.conversationId === id) {
            throw new DraftConflictPendingError()
          }
          await queryClient.cancelQueries(
            { queryKey: ["conversation", id], exact: true },
            { silent: true }
          )
          try {
            const draft = await apiRequest(`/conversations/${id}/draft`, {
              method: "PUT",
              body: {
                input_text: localSnapshot.input,
                priority_capability_ids: localSnapshot.capabilityIds,
                knowledge_base_ids: localSnapshot.knowledgeBaseIds,
                expected_updated_at: draftUpdatedAtRef.current,
              },
              schema: conversationDraftSchema,
            })
            const savedSnapshot = createConversationDraftSnapshot(
              draft.input_text ?? localSnapshot.input,
              draft.priority_capability_ids ?? localSnapshot.capabilityIds,
              draft.knowledge_base_ids ?? localSnapshot.knowledgeBaseIds
            )
            recordAcknowledgedDraft(id, savedSnapshot, draft.updated_at ?? null)
            if (options.useLatestComposerSnapshot !== false) {
              updateConversationDraftCache(id, savedSnapshot, draft)
            }
            return savedSnapshot
          } catch (nextError) {
            if (
              !(nextError instanceof ApiError) ||
              nextError.errorCode !== "DRAFT_VERSION_CONFLICT" ||
              hydratedIdRef.current !== id ||
              routeConversationIdRef.current !== id
            ) {
              throw nextError
            }
          }

          const detail = await apiRequest(`/conversations/${id}`, {
            schema: conversationDetailSchema,
          })
          if (options.useLatestComposerSnapshot !== false) {
            queryClient.setQueryData(["conversation", id], detail)
          }
          if (routeConversationIdRef.current !== id) {
            throw new DraftConflictPendingError()
          }
          const remoteSnapshot =
            conversationDraftSnapshotFromConversation(detail)
          const remoteUpdatedAt = detail.draft?.updated_at ?? null
          const baseSnapshot = lastDraftSnapshotRef.current
          if (conversationDraftSnapshotsEqual(remoteSnapshot, localSnapshot)) {
            recordAcknowledgedDraft(id, remoteSnapshot, remoteUpdatedAt)
            return remoteSnapshot
          }

          const latestLocalSnapshot =
            options.useLatestComposerSnapshot !== false &&
            hydratedIdRef.current === id
              ? composerDraftSnapshotRef.current
              : localSnapshot
          const merged = mergeConversationDraftSnapshots(
            baseSnapshot,
            latestLocalSnapshot,
            remoteSnapshot
          )
          recordAcknowledgedDraft(id, remoteSnapshot, remoteUpdatedAt)
          if (merged.conflictingFields.length > 0 || attempt === 2) {
            lastQueuedDraftRef.current =
              conversationDraftSnapshotKey(remoteSnapshot)
            publishDraftConflict({
              conversationId: id,
              local: latestLocalSnapshot,
              remote: remoteSnapshot,
              remoteUpdatedAt,
              conflictingFields: merged.conflictingFields,
            })
            throw new DraftConflictPendingError()
          }

          if (
            options.useLatestComposerSnapshot !== false &&
            !conversationDraftSnapshotsEqual(
              composerDraftSnapshotRef.current,
              merged.snapshot
            )
          ) {
            applyComposerDraftSnapshot(merged.snapshot)
          }
          if (
            conversationDraftSnapshotsEqual(merged.snapshot, remoteSnapshot)
          ) {
            return remoteSnapshot
          }
          const previousSnapshotKey =
            conversationDraftSnapshotKey(localSnapshot)
          localSnapshot = merged.snapshot
          const mergedSnapshotKey = conversationDraftSnapshotKey(localSnapshot)
          operationSnapshots.add(mergedSnapshotKey)
          if (lastQueuedDraftRef.current === previousSnapshotKey) {
            lastQueuedDraftRef.current = mergedSnapshotKey
          }
        }
        throw new DraftConflictPendingError()
      })
      const tracked: Promise<ConversationDraftSnapshot> = save.then(
        (savedSnapshot) => {
          if (queuedDraftSaveRef.current?.promise === tracked) {
            queuedDraftSaveRef.current = null
          }
          if (operationSnapshots.has(lastQueuedDraftRef.current)) {
            lastQueuedDraftRef.current =
              conversationDraftSnapshotKey(savedSnapshot)
          }
          return savedSnapshot
        },
        (nextError: unknown) => {
          if (queuedDraftSaveRef.current?.promise === tracked) {
            queuedDraftSaveRef.current = null
          }
          if (
            !isDraftConflictPendingError(nextError) &&
            hydratedIdRef.current === id &&
            operationSnapshots.has(lastQueuedDraftRef.current)
          ) {
            lastQueuedDraftRef.current = lastDraftRef.current
          }
          throw nextError
        }
      )
      queuedDraftSaveRef.current = { snapshot, promise: tracked }
      return tracked
    },
    [
      applyComposerDraftSnapshot,
      enqueueDraftOperation,
      publishDraftConflict,
      queryClient,
      recordAcknowledgedDraft,
      updateConversationDraftCache,
    ]
  )

  useEffect(() => {
    if (!conversationId || isNew || hydratedIdRef.current !== conversationId)
      return
    const snapshot = conversationDraftSnapshotKey(
      createConversationDraftSnapshot(
        value,
        selectedCapabilityIds,
        selectedKnowledgeBaseIds
      )
    )
    if (snapshot === lastDraftRef.current) return
    const timer = window.setTimeout(() => {
      if (
        composerSubmissionInFlightRef.current ||
        composerAttachmentOperationInFlightRef.current ||
        composerModelPreferenceOperationInFlightRef.current
      )
        return
      if (submittedDraftSnapshotRef.current === snapshot) return
      void queueDraftSave(
        conversationId,
        value,
        selectedCapabilityIds,
        selectedKnowledgeBaseIds
      ).catch((nextError: unknown) => {
        if (
          routeConversationIdRef.current === conversationId &&
          !isDraftConflictPendingError(nextError)
        ) {
          setError(getErrorMessage(nextError, t))
        }
      })
    }, 600)
    return () => window.clearTimeout(timer)
  }, [
    composerAttachmentOperationPending,
    modelPreferenceMutation.isPending,
    conversationId,
    isNew,
    queueDraftSave,
    selectedCapabilityIds,
    selectedKnowledgeBaseIds,
    t,
    value,
  ])

  const keepCurrentDraft = useCallback(async () => {
    const activeConflict = draftConflictRef.current
    if (!activeConflict || resolvingDraftConflict) return
    const localSnapshot = composerDraftSnapshotRef.current
    setResolvingDraftConflict(true)
    setError(null)
    clearDraftConflict()
    recordAcknowledgedDraft(
      activeConflict.conversationId,
      activeConflict.remote,
      activeConflict.remoteUpdatedAt
    )
    lastQueuedDraftRef.current = conversationDraftSnapshotKey(
      activeConflict.remote
    )
    queuedDraftSaveRef.current = null
    try {
      await queueDraftSave(
        activeConflict.conversationId,
        localSnapshot.input,
        [...localSnapshot.capabilityIds],
        [...localSnapshot.knowledgeBaseIds]
      )
    } catch (nextError) {
      if (!isDraftConflictPendingError(nextError)) {
        setError(getErrorMessage(nextError, t))
      }
    } finally {
      setResolvingDraftConflict(false)
    }
  }, [
    clearDraftConflict,
    queueDraftSave,
    recordAcknowledgedDraft,
    resolvingDraftConflict,
    t,
  ])

  const useLatestDraft = useCallback(() => {
    const activeConflict = draftConflictRef.current
    if (!activeConflict || resolvingDraftConflict) return
    applyComposerDraftSnapshot(activeConflict.remote)
    recordAcknowledgedDraft(
      activeConflict.conversationId,
      activeConflict.remote,
      activeConflict.remoteUpdatedAt
    )
    lastQueuedDraftRef.current = conversationDraftSnapshotKey(
      activeConflict.remote
    )
    queuedDraftSaveRef.current = null
    clearDraftConflict()
    setError(null)
  }, [
    applyComposerDraftSnapshot,
    clearDraftConflict,
    recordAcknowledgedDraft,
    resolvingDraftConflict,
  ])

  const scheduleConversationRefresh = useCallback(
    (scope: ConversationQueryRefreshScope) => {
      if (!conversationId || isNew || scope === "none") return
      pendingDetailRefreshRef.current = true
      if (scope === "detail-and-list") {
        pendingListRefreshRef.current = true
      }
      if (invalidateTimerRef.current) return
      invalidateTimerRef.current = window.setTimeout(() => {
        invalidateTimerRef.current = null
        const refreshDetail = pendingDetailRefreshRef.current
        const refreshList = pendingListRefreshRef.current
        pendingDetailRefreshRef.current = false
        pendingListRefreshRef.current = false
        if (refreshDetail) {
          void queryClient.invalidateQueries({
            queryKey: ["conversation", conversationId],
          })
        }
        if (refreshList) {
          void queryClient.invalidateQueries({ queryKey: ["conversations"] })
        }
      }, 180)
    },
    [conversationId, isNew, queryClient]
  )

  useEffect(() => {
    const executionStatus = conversation?.execution_status
    if (
      isNew ||
      !conversationId ||
      !conversationQuery.isSuccess ||
      (executionStatus !== "completed" &&
        executionStatus !== "failed" &&
        executionStatus !== "interrupted")
    ) {
      return
    }
    const revision = [
      conversationId,
      executionStatus,
      conversation?.last_event_id ?? "",
    ].join(":")
    if (terminalSidebarSyncRef.current === revision) return
    terminalSidebarSyncRef.current = revision
    void queryClient.invalidateQueries({ queryKey: ["conversations"] })
  }, [
    conversation?.execution_status,
    conversation?.last_event_id,
    conversationId,
    conversationQuery.isSuccess,
    isNew,
    queryClient,
  ])

  useEffect(() => {
    return () => {
      if (invalidateTimerRef.current) {
        window.clearTimeout(invalidateTimerRef.current)
        invalidateTimerRef.current = null
      }
      pendingDetailRefreshRef.current = false
      pendingListRefreshRef.current = false
    }
  }, [conversationId])

  const clearPendingNativeMessageDeltas = useCallback(() => {
    for (const timer of pendingNativeMessageDeltaTimersRef.current.values()) {
      window.clearTimeout(timer)
    }
    pendingNativeMessageDeltaTimersRef.current.clear()
    pendingNativeMessageDeltasByItemIdRef.current.clear()
  }, [])

  const appendNativeMessageDelta = useCallback(
    (
      update: PendingNativeMessageDelta & {
        phase?: NativeMessagePhase | null
      }
    ) => {
      setStreamedMessages((current) =>
        appendStreamingMessageDelta(current, {
          itemId: update.itemId,
          turnId: update.turnId,
          phase: update.phase,
          outputKind: update.outputKind,
          delta: update.delta,
          createdAt: update.createdAt,
          sequence: update.sequence,
        })
      )
    },
    []
  )

  const flushPendingNativeMessageDeltas = useCallback(
    (itemId: string, phase?: NativeMessagePhase | null) => {
      const pending = pendingNativeMessageDeltasByItemIdRef.current.get(itemId)
      if (!pending?.length) return
      pendingNativeMessageDeltasByItemIdRef.current.delete(itemId)

      const timer = pendingNativeMessageDeltaTimersRef.current.get(itemId)
      if (timer !== undefined) {
        window.clearTimeout(timer)
        pendingNativeMessageDeltaTimersRef.current.delete(itemId)
      }

      setStreamedMessages((current) =>
        pending.reduce(
          (next, update) =>
            appendStreamingMessageDelta(next, {
              itemId: update.itemId,
              turnId: update.turnId,
              phase,
              outputKind: update.outputKind,
              delta: update.delta,
              createdAt: update.createdAt,
              sequence: update.sequence,
            }),
          current
        )
      )
    },
    []
  )

  const enqueueNativeMessageDelta = useCallback(
    (update: PendingNativeMessageDelta) => {
      if (nativeMessagePhaseByItemIdRef.current.has(update.itemId)) {
        appendNativeMessageDelta({
          ...update,
          phase: nativeMessagePhaseByItemIdRef.current.get(update.itemId),
        })
        return
      }

      const pending =
        pendingNativeMessageDeltasByItemIdRef.current.get(update.itemId) ?? []
      pending.push(update)
      pendingNativeMessageDeltasByItemIdRef.current.set(update.itemId, pending)

      if (pendingNativeMessageDeltaTimersRef.current.has(update.itemId)) return
      const timer = window.setTimeout(() => {
        pendingNativeMessageDeltaTimersRef.current.delete(update.itemId)
        flushPendingNativeMessageDeltas(update.itemId)
      }, nativeMessageDeltaPhaseFallbackDelayMs)
      pendingNativeMessageDeltaTimersRef.current.set(update.itemId, timer)
    },
    [appendNativeMessageDelta, flushPendingNativeMessageDeltas]
  )

  useEffect(
    () => clearPendingNativeMessageDeltas,
    [clearPendingNativeMessageDeltas]
  )

  const eventSubscriptionConversationId =
    selectFreshConversationEventSubscriptionId({
      conversationId,
      isNew,
      isSuccess: conversationQuery.isSuccess,
      isFetchedAfterMount: conversationQuery.isFetchedAfterMount,
    })
  const { connectionState, reconnectingWarningVisible } = useConversationEvents(
    eventSubscriptionConversationId,
    useCallback(
      (event) => {
        if (liveConversationIdRef.current !== conversationId) {
          liveConversationIdRef.current = conversationId
          setLiveConversationId(conversationId)
          seenEventIdsRef.current.clear()
          setStreamedMessages({})
          legacyStreamItemIdByTurnRef.current.clear()
          nativeMessagePhaseByItemIdRef.current.clear()
          stopHookSupersededItemIdsByTurnRef.current.clear()
          planOutputMissingMessagesByTurnRef.current.clear()
          clearPendingNativeMessageDeltas()
          setPersistedMessageRenderKeyState({
            conversationId,
            keys: emptyPersistedMessageRenderKeys,
          })
          setLiveReasoningSummaries({})
          setLiveActivities([])
          setLiveEvents([])
        }
        if (event.id && seenEventIdsRef.current.has(event.id)) return
        if (event.id) seenEventIdsRef.current.add(event.id)

        const native = getNativeCodexPayload(event)
        if (native) {
          if (isNativeStreamDisconnectRetry(event)) {
            startNativeReconnect()
          } else {
            clearNativeReconnect()
          }
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
            if (!itemId) return
            enqueueNativeMessageDelta({
              itemId,
              turnId: event.turn_id,
              outputKind:
                native.method === "item/plan/delta" ? "plan" : "agent_message",
              delta: native.params.delta,
              createdAt: event.created_at,
              sequence: event.sequence_no,
            })
            return
          }
          if (isStreamOnlyNativeEvent(event)) return
          setLiveEvents((current) =>
            appendConversationLiveEvent(current, event)
          )
          if (
            native.method === "hook/completed" &&
            native.params.run.eventName === "stop" &&
            native.params.run.status === "blocked" &&
            native.params.supersededItemId &&
            native.local?.superseded_item_id ===
              native.params.supersededItemId &&
            native.local.superseded_message_id &&
            event.turn_id
          ) {
            const supersededItemIds =
              stopHookSupersededItemIdsByTurnRef.current.get(event.turn_id) ??
              new Set<string>()
            supersededItemIds.add(native.params.supersededItemId)
            stopHookSupersededItemIdsByTurnRef.current.set(
              event.turn_id,
              supersededItemIds
            )
          }
          if (
            native.method === "item/started" ||
            native.method === "item/completed"
          ) {
            const item = native.params.item
            if (
              native.method === "item/completed" &&
              item.type === "reasoning"
            ) {
              setLiveReasoningSummaries((current) =>
                removeStreamingReasoningSummaryItem(current, {
                  itemId: item.id,
                  turnId: event.turn_id,
                })
              )
            }
            if (item.type === "agentMessage" || item.type === "plan") {
              if (
                native.method === "item/completed" &&
                item.type === "plan" &&
                native.local?.plan_review_id &&
                event.turn_id
              ) {
                const stalePlanError =
                  planOutputMissingMessagesByTurnRef.current.get(event.turn_id)
                if (stalePlanError !== undefined) {
                  planOutputMissingMessagesByTurnRef.current.delete(
                    event.turn_id
                  )
                  setError((current) =>
                    current === stalePlanError ? null : current
                  )
                }
                const supersededItemIds =
                  stopHookSupersededItemIdsByTurnRef.current.get(event.turn_id)
                if (supersededItemIds?.size) {
                  for (const supersededItemId of supersededItemIds) {
                    const timer =
                      pendingNativeMessageDeltaTimersRef.current.get(
                        supersededItemId
                      )
                    if (timer !== undefined) window.clearTimeout(timer)
                    pendingNativeMessageDeltaTimersRef.current.delete(
                      supersededItemId
                    )
                    pendingNativeMessageDeltasByItemIdRef.current.delete(
                      supersededItemId
                    )
                    nativeMessagePhaseByItemIdRef.current.delete(
                      supersededItemId
                    )
                  }
                  setStreamedMessages((current) =>
                    removeStreamingMessageItems(current, supersededItemIds)
                  )
                  stopHookSupersededItemIdsByTurnRef.current.delete(
                    event.turn_id
                  )
                }
              }
              const messageId = native.local?.message_id
              const phase =
                item.type === "plan" ? "final_answer" : (item.phase ?? null)
              nativeMessagePhaseByItemIdRef.current.set(item.id, phase)
              flushPendingNativeMessageDeltas(item.id, phase)
              setStreamedMessages((current) =>
                applyStreamingMessageLifecycle(current, {
                  itemId: item.id,
                  messageId,
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
                  removeStreamingReasoningSummariesForTurn(
                    current,
                    event.turn_id
                  )
                )
              }
            }
          }
          if (native.method === "error" && native.params.willRetry) {
            return
          }
          if (native.method === "turn/completed") {
            if (event.turn_id) {
              stopHookSupersededItemIdsByTurnRef.current.delete(event.turn_id)
            }
            setInterrupting(false)
            setLiveReasoningSummaries((current) =>
              removeStreamingReasoningSummariesForTurn(current, event.turn_id)
            )
          }
          scheduleConversationRefresh(
            getConversationEventQueryRefreshScope(event)
          )
          return
        }

        const payload = event.payload as Record<string, unknown>
        if (event.type === "conversation.message.delta") {
          clearNativeReconnect()
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
          clearNativeReconnect()
          if (payload.role === "assistant") {
            const messageId =
              typeof payload.message_id === "string"
                ? payload.message_id
                : undefined
            const legacyStreamItemId = event.turn_id
              ? legacyStreamItemIdByTurnRef.current.get(event.turn_id)
              : undefined
            if (messageId && legacyStreamItemId) {
              const renderKey = `assistant-item-${legacyStreamItemId}`
              setPersistedMessageRenderKeyState((current) => {
                const currentKeys =
                  current.conversationId === conversationId
                    ? current.keys
                    : emptyPersistedMessageRenderKeys
                if (currentKeys.get(messageId) === renderKey) return current
                return {
                  conversationId,
                  keys: new Map(currentKeys).set(messageId, renderKey),
                }
              })
            }
            setStreamedMessages((current) =>
              completeLegacyStreamingMessage(current, {
                itemId:
                  typeof payload.item_id === "string"
                    ? payload.item_id
                    : undefined,
                messageId,
                turnId: event.turn_id,
                createdAt: event.created_at,
                sequence: event.sequence_no,
              })
            )
          }
        }
        if (event.type === "conversation.reconnect") {
          startNativeReconnect()
          return
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
          const errorCode =
            typeof payload.error_code === "string"
              ? payload.error_code
              : undefined
          const messageKey =
            typeof payload.message_key === "string"
              ? payload.message_key
              : "errors.codexTurnFailed"
          const translated = t(messageKey)
          const displayError =
            translated === messageKey ? t("errors.codexTurnFailed") : translated
          if (errorCode === "PLAN_OUTPUT_MISSING" && event.turn_id) {
            planOutputMissingMessagesByTurnRef.current.set(
              event.turn_id,
              displayError
            )
          }
          setError(displayError)
        }
        if (
          event.type === "conversation.interrupted" ||
          event.type === "conversation.completed" ||
          event.type === "conversation.status.changed"
        ) {
          clearNativeReconnect()
          setInterrupting(false)
          setLiveReasoningSummaries((current) =>
            removeStreamingReasoningSummariesForTurn(current, event.turn_id)
          )
          if (event.type !== "conversation.status.changed")
            setLiveActivities([])
        }
        scheduleConversationRefresh(
          getConversationQueryRefreshScope(event.type)
        )
      },
      [
        clearNativeReconnect,
        clearPendingNativeMessageDeltas,
        conversationId,
        enqueueNativeMessageDelta,
        flushPendingNativeMessageDeltas,
        scheduleConversationRefresh,
        startNativeReconnect,
        t,
      ]
    ),
    conversation?.last_event_id
  )

  useEffect(() => {
    if (
      isNew ||
      !conversationId ||
      connectionState !== "reconnecting" ||
      !turnExecutionActive
    ) {
      return
    }
    const reconcile = () => {
      void refetchConversation()
    }
    reconcile()
    const timer = window.setInterval(
      reconcile,
      reconnectingConversationRefetchIntervalMs
    )
    return () => window.clearInterval(timer)
  }, [
    connectionState,
    conversationId,
    isNew,
    refetchConversation,
    turnExecutionActive,
  ])

  useEffect(() => {
    if (!hasConversation || turnExecutionActive) return
    const timer = window.setTimeout(() => {
      setInterrupting(false)
      clearNativeReconnect()
      setStreamedMessages({})
      setLiveReasoningSummaries({})
      setLiveActivities([])
      setLiveEvents([])
    }, 2_000)
    return () => window.clearTimeout(timer)
  }, [clearNativeReconnect, hasConversation, turnExecutionActive])

  useEffect(() => {
    const persistedMessageIds = new Set(
      conversation?.messages?.map((message) => message.id) ?? []
    )
    const persistedItemIds = new Set(
      conversation?.messages?.flatMap((message) =>
        message.item_id ? [message.item_id] : []
      ) ?? []
    )
    const timer = window.setTimeout(() => {
      setStreamedMessages((current) =>
        removePersistedStreamingMessages(
          current,
          persistedMessageIds,
          persistedItemIds
        )
      )
    }, 0)
    return () => window.clearTimeout(timer)
  }, [conversation?.messages])

  useEffect(() => {
    if (!conversation?.id) return
    const timer = window.setTimeout(() => {
      setOptimisticGoal((current) => {
        if (!current || current.conversationId !== conversation.id)
          return current
        return persistedGoalRevision === current.previousGoalRevision
          ? current
          : null
      })
    }, 0)
    return () => window.clearTimeout(timer)
  }, [conversation?.id, persistedGoalRevision])

  useEffect(() => {
    const pending = pendingTurnSubmission
    if (
      !pending?.turnId ||
      pending.conversationId !== conversation?.id ||
      !conversation.messages?.some(
        (message) =>
          message.role === "user" && message.turn_id === pending.turnId
      )
    ) {
      return
    }
    const timer = window.setTimeout(() => {
      setPendingTurnSubmission((current) =>
        current?.conversationId === pending.conversationId &&
        current.turnId === pending.turnId
          ? null
          : current
      )
    }, 0)
    return () => window.clearTimeout(timer)
  }, [conversation?.id, conversation?.messages, pendingTurnSubmission])

  useEffect(() => {
    const pending = pendingCompaction
    if (
      !pending ||
      pending.conversationId !== conversation?.id ||
      !conversation.turns?.some((turn) => turn.id === pending.turnId)
    ) {
      return
    }
    const timer = window.setTimeout(() => {
      setPendingCompaction((current) =>
        current?.conversationId === pending.conversationId &&
        current.turnId === pending.turnId
          ? null
          : current
      )
    }, 0)
    return () => window.clearTimeout(timer)
  }, [conversation?.id, conversation?.turns, pendingCompaction])

  useEffect(() => {
    const pending = pendingOfficeQuestion
    if (
      !pending ||
      pending.conversationId !== conversation?.id ||
      !conversation?.pending_requests?.some(
        (request) => request.id === pending.request.id
      )
    ) {
      return
    }
    const timer = window.setTimeout(() => {
      setPendingOfficeQuestion((current) =>
        current?.conversationId === pending.conversationId &&
        current.idempotencyKey === pending.idempotencyKey
          ? null
          : current
      )
    }, 0)
    return () => window.clearTimeout(timer)
  }, [conversation?.id, conversation?.pending_requests, pendingOfficeQuestion])

  const synchronizeDraftMetadata = useCallback(
    (nextConversation: Conversation) => {
      hydratedIdRef.current = nextConversation.id
      draftUpdatedAtRef.current = nextConversation.draft?.updated_at ?? null
      const snapshot =
        conversationDraftSnapshotFromConversation(nextConversation)
      const snapshotKey = conversationDraftSnapshotKey(snapshot)
      lastDraftSnapshotRef.current = snapshot
      lastDraftRef.current = snapshotKey
      lastQueuedDraftRef.current = snapshotKey
      queuedDraftSaveRef.current = null
      clearDraftConflict()
    },
    [clearDraftConflict]
  )

  const ensureConversation = async ({
    suppressEmptyStateUntilFirstMessage = false,
    initialInput = "",
    initialCapabilityIds = [],
    initialKnowledgeBaseIds = selectedKnowledgeBaseIds,
    initialCollaborationMode = collaborationMode,
  }: {
    suppressEmptyStateUntilFirstMessage?: boolean
    initialInput?: string
    initialCapabilityIds?: string[]
    initialKnowledgeBaseIds?: string[]
    initialCollaborationMode?: ConversationCollaborationMode
  } = {}) => {
    if (routeConversationIdRef.current) return routeConversationIdRef.current
    const routeEpoch = routeEpochRef.current
    if (ensureConversationPromiseRef.current?.epoch === routeEpoch) {
      return ensureConversationPromiseRef.current.promise
    }
    const creation = (async () => {
      if (suppressEmptyStateUntilFirstMessage) {
        setPendingFirstMessageConversationId(newConversationPlaceholderId)
      }
      const draft = await apiRequest("/conversations/drafts", {
        method: "POST",
        body: {
          input_text: initialInput,
          priority_capability_ids: initialCapabilityIds,
          knowledge_base_ids: initialKnowledgeBaseIds,
          collaboration_mode: initialCollaborationMode,
        },
        schema: conversationDraftResultSchema,
      })
      queryClient.setQueryData(["conversation", draft.id], draft)
      if (
        routeEpochRef.current === routeEpoch &&
        routeConversationIdRef.current === null
      ) {
        synchronizeDraftMetadata(draft)
        routeConversationIdRef.current = draft.id
        if (suppressEmptyStateUntilFirstMessage) {
          setPendingFirstMessageConversationId(draft.id)
        }
        navigate(`/conversations/${draft.id}`, { replace: true })
      }
      return draft.id
    })()
    const pendingCreation = { epoch: routeEpoch, promise: creation }
    ensureConversationPromiseRef.current = pendingCreation
    try {
      return await creation
    } finally {
      if (ensureConversationPromiseRef.current === pendingCreation) {
        ensureConversationPromiseRef.current = null
      }
    }
  }

  const refreshSubmittedConversation = async (id: string) => {
    const detail = await apiRequest(`/conversations/${id}`, {
      schema: conversationDetailSchema,
    })
    if (routeConversationIdRef.current === id) {
      synchronizeDraftMetadata(detail)
    }
    queryClient.setQueryData(["conversation", id], detail)
    return detail
  }

  const refreshAfterMutation = async (id: string) => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["conversation", id] }),
      queryClient.invalidateQueries({ queryKey: ["conversations"] }),
    ])
  }

  const refreshConversationList = () =>
    queryClient.invalidateQueries({ queryKey: ["conversations"] })

  const leaveCurrentConversation = useCallback(() => {
    navigate("/conversations/new", { replace: true })
    if (conversationId) {
      queryClient.removeQueries({
        queryKey: ["conversation", conversationId],
        exact: true,
      })
    }
    void queryClient.invalidateQueries({ queryKey: ["conversations"] })
  }, [conversationId, navigate, queryClient])

  const optimisticallyConsumeSubmissionAttachments = useCallback(
    async (
      submission: ComposerSubmission
    ): Promise<OptimisticAttachmentConsumption | undefined> => {
      if (!conversationId || submission.attachments.length === 0)
        return undefined
      const queryKey = ["conversation", conversationId] as const
      const currentConversation =
        queryClient.getQueryData<Conversation>(queryKey)
      if (!currentConversation) return undefined

      const previousAttachments = [...(currentConversation.attachments ?? [])]
      const submittedAttachmentIds = new Set(
        submission.attachments.map((attachment) => attachment.id)
      )
      const consumption = {
        conversationId,
        previousAttachments,
        submittedAttachmentIds: [...submittedAttachmentIds],
      } satisfies OptimisticAttachmentConsumption
      setOptimisticAttachmentConsumption({
        conversationId,
        submittedAttachmentIds: consumption.submittedAttachmentIds,
      })
      await queryClient.cancelQueries(
        { queryKey, exact: true },
        { silent: true }
      )
      queryClient.setQueryData<Conversation>(queryKey, (current) =>
        current
          ? {
              ...current,
              attachments: (current.attachments ?? []).filter(
                (attachment) => !submittedAttachmentIds.has(attachment.id)
              ),
            }
          : current
      )
      return consumption
    },
    [conversationId, queryClient]
  )

  const clearOptimisticAttachmentConsumption = useCallback(
    (consumption: OptimisticAttachmentConsumption | undefined) => {
      if (!consumption) return
      setOptimisticAttachmentConsumption((current) =>
        current?.conversationId === consumption.conversationId ? null : current
      )
    },
    []
  )

  const commitOptimisticallyConsumedAttachments = useCallback(
    (consumption: OptimisticAttachmentConsumption | undefined) => {
      if (!consumption) return
      const submittedAttachmentIds = new Set(consumption.submittedAttachmentIds)
      queryClient.setQueryData<Conversation>(
        ["conversation", consumption.conversationId],
        (current) =>
          current
            ? {
                ...current,
                attachments: (current.attachments ?? []).filter(
                  (attachment) => !submittedAttachmentIds.has(attachment.id)
                ),
              }
            : current
      )
      clearOptimisticAttachmentConsumption(consumption)
    },
    [clearOptimisticAttachmentConsumption, queryClient]
  )

  const restoreOptimisticallyConsumedAttachments = useCallback(
    (consumption: OptimisticAttachmentConsumption | undefined) => {
      if (!consumption) return
      const queryKey = ["conversation", consumption.conversationId] as const
      queryClient.setQueryData<Conversation>(queryKey, (current) => {
        if (!current) return current
        const previousAttachmentIds = new Set(
          consumption.previousAttachments.map((attachment) => attachment.id)
        )
        return {
          ...current,
          attachments: [
            ...consumption.previousAttachments,
            ...(current.attachments ?? []).filter(
              (attachment) => !previousAttachmentIds.has(attachment.id)
            ),
          ],
        }
      })
      clearOptimisticAttachmentConsumption(consumption)
    },
    [clearOptimisticAttachmentConsumption, queryClient]
  )

  const sendMutation = useMutation({
    onMutate: optimisticallyConsumeSubmissionAttachments,
    mutationFn: async (submission: ComposerSubmission) => {
      sendSubmissionConversationIdRef.current = isNew
        ? null
        : (conversationId ?? null)
      const requestedInput = submission.input
      const requestedCapabilityIds = [...submission.capabilityIds]
      const requestedKnowledgeBaseIds = [...submission.knowledgeBaseIds]
      const nextAttachments = [...submission.attachments]
      const id = await ensureConversation({
        suppressEmptyStateUntilFirstMessage: true,
        initialInput: requestedInput,
        initialCapabilityIds: requestedCapabilityIds,
        initialKnowledgeBaseIds: requestedKnowledgeBaseIds,
        initialCollaborationMode: submission.collaborationMode,
      })
      sendSubmissionConversationIdRef.current = id
      if (submission.optimisticId) {
        setPendingTurnSubmission((current) => {
          if (!current || current.optimisticId !== submission.optimisticId) {
            return current
          }
          return { ...current, conversationId: id }
        })
      }
      const requestedSnapshot = createConversationDraftSnapshot(
        requestedInput,
        requestedCapabilityIds,
        requestedKnowledgeBaseIds
      )
      submittedDraftSnapshotRef.current =
        conversationDraftSnapshotKey(requestedSnapshot)
      // Turn admission consumes the exact persisted draft. Persist first so a
      // stale version can converge before creating an optimistic turn.
      const persistedSnapshot = await queueDraftSave(
        id,
        requestedInput,
        requestedCapabilityIds,
        requestedKnowledgeBaseIds,
        { useLatestComposerSnapshot: false }
      )
      const nextInput = persistedSnapshot.input
      const nextCapabilityIds = [...persistedSnapshot.capabilityIds]
      const nextKnowledgeBaseIds = [...persistedSnapshot.knowledgeBaseIds]
      const idempotencyKey = await stableOperationId(turnSubmitOperationRef, {
        operation: "turn_start",
        conversation_id: id,
        draft_updated_at: draftUpdatedAtRef.current,
        preceding_turn_id:
          conversation?.running_turn?.id ??
          conversation?.turns?.at(-1)?.id ??
          null,
        input_text: nextInput,
        priority_capability_ids: nextCapabilityIds,
        knowledge_base_ids: nextKnowledgeBaseIds,
        attachment_ids: nextAttachments.map((attachment) => attachment.id),
        collaboration_mode: submission.collaborationMode,
      })
      const selectedCapabilities = new Map(
        (
          capabilityQuery.data?.items ??
          conversation?.available_capabilities ??
          []
        ).map((capability) => [capability.id, capability])
      )
      submittedDraftSnapshotRef.current =
        conversationDraftSnapshotKey(persistedSnapshot)
      setPendingTurnSubmission((current) => {
        const optimisticSubmission =
          submission.optimisticId &&
          current?.optimisticId === submission.optimisticId
            ? current
            : null
        return {
          ...optimisticSubmission,
          conversationId: id,
          optimisticId: submission.optimisticId,
          idempotencyKey,
          message: {
            id:
              optimisticSubmission?.message.id ??
              `optimistic-${idempotencyKey}`,
            role: "user",
            content: nextInput,
            turn_id: null,
            created_at:
              optimisticSubmission?.message.created_at ??
              new Date().toISOString(),
            attachments: nextAttachments,
            selected_capabilities: nextCapabilityIds.flatMap((capabilityId) => {
              const capability = selectedCapabilities.get(capabilityId)
              return capability
                ? [
                    {
                      id: capability.id,
                      name: capability.name,
                      type: capability.type,
                    },
                  ]
                : []
            }),
            selected_knowledge_base_ids: nextKnowledgeBaseIds,
          },
        }
      })
      await enqueueDraftOperation(async () => {
        const receipt = await apiRequest(`/conversations/${id}/turns`, {
          method: "POST",
          body: {
            input_text: nextInput,
            priority_capability_ids: nextCapabilityIds,
            knowledge_base_ids: nextKnowledgeBaseIds,
            idempotency_key: idempotencyKey,
            collaboration_mode: submission.collaborationMode,
          },
          schema: turnStartReceiptSchema,
        })
        setPendingTurnSubmission((current) =>
          current?.conversationId === id &&
          (current.idempotencyKey === idempotencyKey ||
            current.optimisticId === submission.optimisticId)
            ? {
                ...current,
                turnId: receipt.turn_id,
                status: receipt.status,
                message: { ...current.message, turn_id: receipt.turn_id },
              }
            : current
        )
      })
      return { id, idempotencyKey, persistedSnapshot }
    },
    onSuccess: (result, _submission, optimisticAttachmentConsumption) => {
      commitOptimisticallyConsumedAttachments(optimisticAttachmentConsumption)
      composerSubmissionInFlightRef.current = false
      setPendingFirstMessageConversationId(null)
      if (routeConversationIdRef.current !== result.id) {
        setPendingTurnSubmission((current) =>
          current?.conversationId === result.id ? null : current
        )
        if (turnSubmitOperationRef.current?.id === result.idempotencyKey) {
          turnSubmitOperationRef.current = null
        }
        submittedDraftSnapshotRef.current = null
        sendSubmissionConversationIdRef.current = null
        void refreshConversationList()
        return
      }
      turnSubmitOperationRef.current = null
      const consumedSnapshot = createConversationDraftSnapshot(
        "",
        [],
        result.persistedSnapshot.knowledgeBaseIds
      )
      lastDraftSnapshotRef.current = consumedSnapshot
      lastDraftRef.current = conversationDraftSnapshotKey(consumedSnapshot)
      lastQueuedDraftRef.current = lastDraftRef.current
      queuedDraftSaveRef.current = null
      submittedDraftSnapshotRef.current = null
      sendSubmissionConversationIdRef.current = null
      void refreshSubmittedConversation(result.id).catch(() => {
        void queryClient.invalidateQueries({
          queryKey: ["conversation", result.id],
        })
      })
      void refreshConversationList()
    },
    onError: (nextError, submission, optimisticAttachmentConsumption) => {
      const targetConversationId = sendSubmissionConversationIdRef.current
      composerSubmissionInFlightRef.current = false
      setInterrupting(false)
      restoreOptimisticallyConsumedAttachments(optimisticAttachmentConsumption)
      const failedSnapshot = submittedDraftSnapshotRef.current
      submittedDraftSnapshotRef.current = null
      if (routeConversationIdRef.current !== targetConversationId) {
        setPendingFirstMessageConversationId((current) =>
          current === targetConversationId ? null : current
        )
        setPendingTurnSubmission((current) =>
          targetConversationId &&
          current?.conversationId === targetConversationId
            ? null
            : current
        )
        sendSubmissionConversationIdRef.current = null
        return
      }
      setPendingFirstMessageConversationId(null)
      setPendingTurnSubmission(null)
      setValue((current) => current || submission.input)
      setSelectedCapabilityIds((current) =>
        current.length > 0 ? current : [...submission.capabilityIds]
      )
      if (
        conversationId &&
        !isNew &&
        failedSnapshot &&
        failedSnapshot !== lastDraftRef.current
      ) {
        void queueDraftSave(
          conversationId,
          submission.input,
          submission.capabilityIds,
          submission.knowledgeBaseIds
        ).catch(() => undefined)
      }
      if (!isDraftConflictPendingError(nextError)) {
        setTurnAdmissionError(nextError)
      }
      sendSubmissionConversationIdRef.current = null
    },
  })

  const contextCompactionMutation = useMutation({
    mutationFn: async ({
      commandValue,
      targetConversationId,
      routeEpoch,
      precedingTurnId,
    }: {
      commandValue: string
      targetConversationId: string
      routeEpoch: number
      precedingTurnId: string | null
    }) => {
      await draftQueueRef.current
      if (
        routeEpochRef.current !== routeEpoch ||
        routeConversationIdRef.current !== targetConversationId
      ) {
        return {
          cancelled: true as const,
          commandValue,
          conversationId: targetConversationId,
          idempotencyKey: null,
          refreshedConversation: null,
        }
      }
      const idempotencyKey = await stableOperationId(
        contextCompactionOperationRef,
        {
          operation: "context_compaction",
          conversation_id: targetConversationId,
          preceding_turn_id: precedingTurnId,
        }
      )
      if (
        routeEpochRef.current !== routeEpoch ||
        routeConversationIdRef.current !== targetConversationId
      ) {
        if (contextCompactionOperationRef.current?.id === idempotencyKey) {
          contextCompactionOperationRef.current = null
        }
        return {
          cancelled: true as const,
          commandValue,
          conversationId: targetConversationId,
          idempotencyKey: null,
          refreshedConversation: null,
        }
      }
      const receipt = await apiRequest(
        `/conversations/${targetConversationId}/compact`,
        {
          method: "POST",
          body: { idempotency_key: idempotencyKey },
          schema: turnStartReceiptSchema,
        }
      )
      setPendingCompaction({
        conversationId: targetConversationId,
        turnId: receipt.turn_id,
        startedAt: new Date().toISOString(),
      })
      let refreshedConversation: Conversation | null = null
      try {
        refreshedConversation =
          await refreshSubmittedConversation(targetConversationId)
      } catch {
        void queryClient.invalidateQueries({
          queryKey: ["conversation", targetConversationId],
        })
      }
      return {
        cancelled: false as const,
        commandValue,
        conversationId: targetConversationId,
        idempotencyKey,
        refreshedConversation,
      }
    },
    onSuccess: (result) => {
      if (result.cancelled) return
      if (contextCompactionOperationRef.current?.id === result.idempotencyKey) {
        contextCompactionOperationRef.current = null
      }
      if (routeConversationIdRef.current === result.conversationId) {
        setValue((current) => (current === result.commandValue ? "" : current))
      }
      void refreshConversationList()
    },
    onError: (nextError, variables) => {
      setPendingCompaction(null)
      if (
        routeEpochRef.current === variables.routeEpoch &&
        routeConversationIdRef.current === variables.targetConversationId
      ) {
        setTurnAdmissionError(nextError)
      }
    },
    onSettled: () => {
      composerSubmissionInFlightRef.current = false
    },
  })

  const goalStartMutation = useMutation({
    onMutate: optimisticallyConsumeSubmissionAttachments,
    mutationFn: async (submission: ComposerSubmission) => {
      goalStartSubmissionConversationIdRef.current = isNew
        ? null
        : (conversationId ?? null)
      const requestedObjective = submission.input.trim()
      const requestedCapabilityIds = [...submission.capabilityIds]
      const requestedKnowledgeBaseIds = [...submission.knowledgeBaseIds]
      const nextAttachments = [...submission.attachments]
      const id = await ensureConversation({
        suppressEmptyStateUntilFirstMessage: true,
        initialInput: requestedObjective,
        initialCapabilityIds: requestedCapabilityIds,
        initialKnowledgeBaseIds: requestedKnowledgeBaseIds,
        initialCollaborationMode: "default",
      })
      goalStartSubmissionConversationIdRef.current = id
      setOptimisticGoal((current) => {
        if (
          current?.goal.objective === requestedObjective &&
          (current.conversationId === id ||
            current.conversationId === newConversationPlaceholderId)
        ) {
          return current.conversationId === id
            ? current
            : { ...current, conversationId: id }
        }
        return {
          conversationId: id,
          goal: createOptimisticGoal(requestedObjective),
          previousGoalRevision: threadGoalRevision(conversation?.goal),
        }
      })
      const requestedSnapshot = createConversationDraftSnapshot(
        requestedObjective,
        requestedCapabilityIds,
        requestedKnowledgeBaseIds
      )
      submittedDraftSnapshotRef.current =
        conversationDraftSnapshotKey(requestedSnapshot)
      const persistedSnapshot = await queueDraftSave(
        id,
        requestedObjective,
        requestedCapabilityIds,
        requestedKnowledgeBaseIds,
        { useLatestComposerSnapshot: false }
      )
      const objective = persistedSnapshot.input.trim()
      const capabilityIds = [...persistedSnapshot.capabilityIds]
      const knowledgeBaseIds = [...persistedSnapshot.knowledgeBaseIds]
      const idempotencyKey = await stableOperationId(goalStartOperationRef, {
        operation: "goal_start",
        conversation_id: id,
        draft_updated_at: draftUpdatedAtRef.current,
        preceding_turn_id:
          conversation?.running_turn?.id ??
          conversation?.turns?.at(-1)?.id ??
          null,
        objective,
        priority_capability_ids: capabilityIds,
        knowledge_base_ids: knowledgeBaseIds,
        attachment_ids: nextAttachments.map((attachment) => attachment.id),
      })
      const selectedCapabilities = new Map(
        (
          capabilityQuery.data?.items ??
          conversation?.available_capabilities ??
          []
        ).map((capability) => [capability.id, capability])
      )
      setPendingTurnSubmission({
        conversationId: id,
        idempotencyKey,
        message: {
          id: `optimistic-${idempotencyKey}`,
          role: "user",
          content: objective,
          turn_id: null,
          created_at: new Date().toISOString(),
          attachments: nextAttachments,
          selected_capabilities: capabilityIds.flatMap((capabilityId) => {
            const capability = selectedCapabilities.get(capabilityId)
            return capability
              ? [
                  {
                    id: capability.id,
                    name: capability.name,
                    type: capability.type,
                  },
                ]
              : []
          }),
          selected_knowledge_base_ids: knowledgeBaseIds,
        },
      })
      await enqueueDraftOperation(async () => {
        const receipt = await apiRequest(`/conversations/${id}/goal`, {
          method: "POST",
          body: {
            objective,
            priority_capability_ids: capabilityIds,
            knowledge_base_ids: knowledgeBaseIds,
            idempotency_key: idempotencyKey,
          },
          schema: turnStartReceiptSchema,
        })
        setPendingTurnSubmission((current) =>
          current?.conversationId === id &&
          current.idempotencyKey === idempotencyKey
            ? {
                ...current,
                turnId: receipt.turn_id,
                status: receipt.status,
                message: { ...current.message, turn_id: receipt.turn_id },
              }
            : current
        )
      })
      let refreshedConversation: Conversation | null = null
      try {
        refreshedConversation = await refreshSubmittedConversation(id)
      } catch {
        void queryClient.invalidateQueries({
          queryKey: ["conversation", id],
        })
      }
      return { id, idempotencyKey, persistedSnapshot, refreshedConversation }
    },
    onSuccess: (result, _submission, optimisticAttachmentConsumption) => {
      commitOptimisticallyConsumedAttachments(optimisticAttachmentConsumption)
      if (result.refreshedConversation?.goal) {
        setOptimisticGoal((current) =>
          current?.conversationId === result.id ? null : current
        )
      }
      composerSubmissionInFlightRef.current = false
      setPendingFirstMessageConversationId(null)
      if (routeConversationIdRef.current !== result.id) {
        setPendingTurnSubmission((current) =>
          current?.conversationId === result.id ? null : current
        )
        setOptimisticGoal((current) =>
          current?.conversationId === result.id ? null : current
        )
        if (goalStartOperationRef.current?.id === result.idempotencyKey) {
          goalStartOperationRef.current = null
        }
        submittedDraftSnapshotRef.current = null
        goalStartSubmissionConversationIdRef.current = null
        void refreshConversationList()
        return
      }
      setGoalMode(false)
      goalStartOperationRef.current = null
      if (!result.refreshedConversation) {
        const consumedSnapshot = createConversationDraftSnapshot(
          "",
          [],
          result.persistedSnapshot.knowledgeBaseIds
        )
        lastDraftSnapshotRef.current = consumedSnapshot
        lastDraftRef.current = conversationDraftSnapshotKey(consumedSnapshot)
        lastQueuedDraftRef.current = lastDraftRef.current
        queuedDraftSaveRef.current = null
      }
      submittedDraftSnapshotRef.current = null
      goalStartSubmissionConversationIdRef.current = null
      void refreshConversationList()
    },
    onError: (nextError, submission, optimisticAttachmentConsumption) => {
      const targetConversationId = goalStartSubmissionConversationIdRef.current
      composerSubmissionInFlightRef.current = false
      restoreOptimisticallyConsumedAttachments(optimisticAttachmentConsumption)
      submittedDraftSnapshotRef.current = null
      if (routeConversationIdRef.current !== targetConversationId) {
        setPendingFirstMessageConversationId((current) =>
          current === targetConversationId ? null : current
        )
        setPendingTurnSubmission((current) =>
          targetConversationId &&
          current?.conversationId === targetConversationId
            ? null
            : current
        )
        setOptimisticGoal((current) =>
          targetConversationId &&
          current?.conversationId === targetConversationId
            ? null
            : current
        )
        goalStartSubmissionConversationIdRef.current = null
        return
      }
      setPendingFirstMessageConversationId(null)
      setPendingTurnSubmission(null)
      setValue((current) => current || submission.input)
      setSelectedCapabilityIds((current) =>
        current.length > 0 ? current : [...submission.capabilityIds]
      )
      setOptimisticGoal((current) =>
        current?.goal.objective === submission.input.trim() ? null : current
      )
      setGoalMode(true)
      if (conversationId && !isNew) {
        void queueDraftSave(
          conversationId,
          submission.input,
          submission.capabilityIds,
          submission.knowledgeBaseIds
        ).catch(() => undefined)
      }
      if (!isDraftConflictPendingError(nextError)) {
        setTurnAdmissionError(nextError)
      }
      goalStartSubmissionConversationIdRef.current = null
    },
  })

  const updateGoalMutation = useMutation({
    onMutate: async () => {
      if (!conversationId) return
      await queryClient.cancelQueries({
        queryKey: ["conversation", conversationId],
        exact: true,
      })
    },
    mutationFn: (input: {
      action: "edit" | "pause"
      body: Record<string, unknown>
    }) => {
      if (!conversationId) throw new Error("conversation id is required")
      setGoalPendingAction(input.action)
      return apiRequest(`/conversations/${conversationId}/goal`, {
        method: "PATCH",
        body: input.body,
        schema: threadGoalSchema,
      })
    },
    onSuccess: async (goal: ThreadGoal) => {
      if (conversationId) {
        await queryClient.cancelQueries({
          queryKey: ["conversation", conversationId],
          exact: true,
        })
      }
      queryClient.setQueryData<Conversation>(
        ["conversation", conversationId],
        (current) => (current ? { ...current, goal } : current)
      )
    },
    onError: (nextError) => setError(getErrorMessage(nextError, t)),
    onSettled: () => setGoalPendingAction(null),
  })

  const resumeGoalMutation = useMutation({
    mutationFn: () => {
      if (!conversationId) throw new Error("conversation id is required")
      setGoalPendingAction("resume")
      return apiRequest(`/conversations/${conversationId}/goal/resume`, {
        method: "POST",
        body: {},
        schema: turnStartReceiptSchema,
      })
    },
    onSuccess: () => {
      if (conversationId) void refreshAfterMutation(conversationId)
    },
    onError: (nextError) => setError(getErrorMessage(nextError, t)),
    onSettled: () => setGoalPendingAction(null),
  })

  const clearGoalMutation = useMutation({
    mutationFn: () => {
      if (!conversationId) throw new Error("conversation id is required")
      setGoalPendingAction("clear")
      return apiRequest(`/conversations/${conversationId}/goal`, {
        method: "DELETE",
        schema: goalClearResultSchema,
      })
    },
    onSuccess: () => {
      queryClient.setQueryData<Conversation>(
        ["conversation", conversationId],
        (current) => (current ? { ...current, goal: null } : current)
      )
      setOptimisticGoal((current) =>
        current?.conversationId === conversationId ? null : current
      )
      if (conversationId) void refreshAfterMutation(conversationId)
    },
    onError: (nextError) => setError(getErrorMessage(nextError, t)),
    onSettled: () => setGoalPendingAction(null),
  })

  const {
    mutateAsync: submitOfficeQuestion,
    isPending: officeQuestionPending,
  } = useMutation({
    mutationFn: async ({
      file,
      requests,
    }: {
      file: ConversationFile
      requests: readonly ConversationOfficeAnnotationRequest[]
    }) => {
      const id = await ensureConversation({
        initialKnowledgeBaseIds: validSelectedKnowledgeBaseIds,
        initialCollaborationMode: collaborationMode,
      })
      const messageDisplay = buildOfficeAnnotationInput(file, requests)
      const requestText = officeAnnotationRequestText(messageDisplay)
      const optimisticDisplay = buildOfficeAnnotationDisplay(
        messageDisplay,
        file.name
      )
      const shouldQueueSelection = Boolean(turnExecutionActive)
      const idempotencyKey = await stableOperationId(
        officeTurnSubmitOperationRef,
        {
          operation: shouldQueueSelection
            ? "office_selection_pending_create"
            : "office_selection_turn_start",
          submission_attempt_id: operationAttemptId(officeTurnSubmitAttemptRef),
          conversation_id: id,
          file_id: file.id,
          message_display: messageDisplay,
          knowledge_base_ids: validSelectedKnowledgeBaseIds,
        }
      )
      const createdAt = new Date().toISOString()
      if (shouldQueueSelection) {
        const optimisticRequest: PendingRequest = {
          id: `optimistic-${idempotencyKey}`,
          sequence_no: (conversation?.pending_requests?.length ?? 0) + 1,
          status: "waiting_previous_turn",
          input_text: requestText,
          display: optimisticDisplay,
          priority_capability_ids: [],
          knowledge_base_ids: validSelectedKnowledgeBaseIds,
          attachments: [],
          collaboration_mode: collaborationMode,
          created_at: createdAt,
        }
        setPendingOfficeQuestion({
          conversationId: id,
          idempotencyKey,
          request: optimisticRequest,
        })
        const persistedRequest = await apiRequest(
          `/conversations/${id}/pending-requests`,
          {
            method: "POST",
            body: {
              priority_capability_ids: [],
              knowledge_base_ids: validSelectedKnowledgeBaseIds,
              collaboration_mode: collaborationMode,
              idempotency_key: idempotencyKey,
              draft_policy: "preserve",
              message_display: messageDisplay,
            },
            schema: pendingRequestSchema,
          }
        )
        setPendingOfficeQuestion((current) =>
          current?.conversationId === id &&
          current.idempotencyKey === idempotencyKey
            ? {
                ...current,
                request: {
                  ...persistedRequest,
                  display: persistedRequest.display ?? current.request.display,
                },
              }
            : current
        )
        return { id, idempotencyKey, mode: "queued" as const }
      }

      setPendingTurnSubmission({
        conversationId: id,
        idempotencyKey,
        message: {
          id: `optimistic-${idempotencyKey}`,
          role: "user",
          content: requestText,
          display: optimisticDisplay,
          turn_id: null,
          created_at: createdAt,
          selected_capabilities: [],
          selected_knowledge_base_ids: validSelectedKnowledgeBaseIds,
        },
      })
      const receipt = await apiRequest(`/conversations/${id}/turns`, {
        method: "POST",
        body: {
          priority_capability_ids: [],
          knowledge_base_ids: validSelectedKnowledgeBaseIds,
          collaboration_mode: collaborationMode,
          idempotency_key: idempotencyKey,
          draft_policy: "preserve",
          message_display: messageDisplay,
        },
        schema: turnStartReceiptSchema,
      })
      setPendingTurnSubmission((current) =>
        current?.conversationId === id &&
        current.idempotencyKey === idempotencyKey
          ? {
              ...current,
              turnId: receipt.turn_id,
              status: receipt.status,
              message: { ...current.message, turn_id: receipt.turn_id },
            }
          : current
      )
      return { id, idempotencyKey, mode: "turn" as const }
    },
    onSuccess: ({ id }) => {
      officeTurnSubmitOperationRef.current = null
      officeTurnSubmitAttemptRef.current = null
      void refreshAfterMutation(id).catch(() => undefined)
    },
    onError: (nextError) => {
      const idempotencyKey = officeTurnSubmitOperationRef.current?.id
      setPendingTurnSubmission((current) =>
        idempotencyKey && current?.idempotencyKey === idempotencyKey
          ? null
          : current
      )
      setPendingOfficeQuestion((current) =>
        idempotencyKey && current?.idempotencyKey === idempotencyKey
          ? null
          : current
      )
      setError(getErrorMessage(nextError, t))
    },
  })

  const regenerateMutation = useMutation({
    mutationFn: async ({
      message: sourceMessage,
      content,
    }: {
      message: ConversationMessage
      content: string
    }) => {
      if (!conversationId || isNew) {
        throw new Error("conversation id is required")
      }
      const idempotencyKey = await stableOperationId(regenerateOperationRef, {
        operation: "message_regenerate",
        conversation_id: conversationId,
        message_id: sourceMessage.id,
        source_created_at: sourceMessage.created_at ?? null,
        input_text: content,
      })
      setPendingTurnSubmission({
        conversationId,
        idempotencyKey,
        message: {
          ...sourceMessage,
          content,
          turn_id: null,
          created_at: new Date().toISOString(),
        },
        ...(sourceMessage.turn_id
          ? { replacesTurnId: sourceMessage.turn_id }
          : {}),
      })
      const receipt = await apiRequest(
        `/conversations/${conversationId}/messages/${sourceMessage.id}/regenerate`,
        {
          method: "POST",
          body: {
            input_text: content,
            idempotency_key: idempotencyKey,
          },
          schema: turnStartReceiptSchema,
        }
      )
      setPendingTurnSubmission((current) =>
        current?.conversationId === conversationId &&
        current.idempotencyKey === idempotencyKey
          ? {
              ...current,
              turnId: receipt.turn_id,
              status: receipt.status,
              message: { ...current.message, turn_id: receipt.turn_id },
            }
          : current
      )
      return { id: conversationId }
    },
    onSuccess: ({ id }) => {
      regenerateOperationRef.current = null
      setStreamedMessages({})
      setLiveReasoningSummaries({})
      setLiveActivities([])
      setLiveEvents([])
      clearNativeReconnect()
      void refreshSubmittedConversation(id).catch(() =>
        queryClient
          .invalidateQueries({ queryKey: ["conversation", id] })
          .catch(() => undefined)
      )
      void refreshConversationList().catch(() => undefined)
    },
    onError: (nextError, { message: sourceMessage }) => {
      setPendingTurnSubmission((current) => {
        if (!current) return current
        return current.conversationId === conversationId &&
          current.message.id === sourceMessage.id &&
          current.replacesTurnId === sourceMessage.turn_id
          ? null
          : current
      })
      setError(getErrorMessage(nextError, t))
    },
  })

  const forkMutation = useMutation({
    mutationFn: async (sourceMessage: ConversationMessage) => {
      if (!conversationId || isNew) {
        throw new Error("conversation id is required")
      }
      const idempotencyKey = operationAttemptId(forkOperationRef)
      return apiRequest(
        `/conversations/${conversationId}/messages/${sourceMessage.id}/fork`,
        {
          method: "POST",
          body: { idempotency_key: idempotencyKey },
          schema: conversationSchema,
        }
      )
    },
    onSuccess: (forkedConversation) => {
      forkOperationRef.current = null
      queryClient.setQueryData(
        ["conversations", "sidebar"],
        (current: { pages: { items: Conversation[] }[] } | undefined) =>
          upsertSidebarConversation(current, forkedConversation)
      )
      navigate(`/conversations/${forkedConversation.id}`)
      void refreshConversationList().catch(() => undefined)
    },
    onError: () => {
      setError(t("conversation.forkMessageFailed"))
    },
  })

  const attachMutation = useMutation({
    mutationFn: async (files: File[]) => {
      const uploadableFiles = files.filter(isMeaningfulComposerUploadFile)
      if (uploadableFiles.length === 0) {
        throw new ApiError({
          status: 400,
          errorCode: "ATTACHMENT_TEMPORARY_FILE_SKIPPED",
        })
      }
      const id = await ensureConversation()
      attachmentMutationTargetConversationIdRef.current = id
      try {
        for (const file of uploadableFiles) {
          const formData = new FormData()
          formData.append("file", file)
          await apiRequest(`/conversations/${id}/attachments`, {
            method: "POST",
            body: formData,
            schema: conversationFileSchema,
          })
        }
      } catch (nextError) {
        await refreshAfterMutation(id).catch(() => undefined)
        throw nextError
      }
      return id
    },
    onMutate: (files) => {
      const pendingUploads = files
        .filter(isMeaningfulComposerUploadFile)
        .map(createPendingAttachmentUpload)
      if (pendingUploads.length > 0) {
        setPendingAttachmentUploads((current) => [
          ...current,
          ...pendingUploads,
        ])
      }
      return { pendingUploadIds: pendingUploads.map((file) => file.id) }
    },
    onSuccess: refreshAfterMutation,
    onSettled: (_data, _error, _files, context) => {
      const pendingUploadIds = context?.pendingUploadIds
      if (!pendingUploadIds || pendingUploadIds.length === 0) return
      const pendingUploadIdSet = new Set(pendingUploadIds)
      setPendingAttachmentUploads((current) =>
        current.filter((file) => !pendingUploadIdSet.has(file.id))
      )
    },
  })

  const removeAttachmentMutation = useMutation({
    mutationFn: ({
      targetConversationId,
      file,
    }: {
      targetConversationId: string
      file: ConversationFile
    }) =>
      apiRequest(
        `/conversations/${targetConversationId}/attachments/${file.id}`,
        {
          method: "DELETE",
          schema: emptyResponseSchema,
        }
      ),
    onSettled: (_result, _error, { targetConversationId }) =>
      refreshAfterMutation(targetConversationId),
  })

  const clearAttachmentsMutation = useMutation({
    mutationFn: ({
      targetConversationId,
      files,
    }: {
      targetConversationId: string
      files: readonly ConversationFile[]
    }) =>
      apiRequest(`/conversations/${targetConversationId}/attachments`, {
        method: "DELETE",
        body: { file_ids: files.map((file) => file.id) },
        schema: emptyResponseSchema,
      }),
    onSettled: (_result, _error, { targetConversationId }) =>
      refreshAfterMutation(targetConversationId),
  })

  const attachmentOperationPending =
    composerAttachmentOperationPending ||
    attachMutation.isPending ||
    removeAttachmentMutation.isPending ||
    clearAttachmentsMutation.isPending

  const flushDraftAfterAttachmentOperation = async (
    targetConversationId: string
  ) => {
    if (
      routeConversationIdRef.current !== targetConversationId ||
      hydratedIdRef.current !== targetConversationId
    )
      return
    const snapshot = composerDraftSnapshotRef.current
    try {
      await queueDraftSave(
        targetConversationId,
        snapshot.input,
        [...snapshot.capabilityIds],
        [...snapshot.knowledgeBaseIds]
      )
    } catch (nextError: unknown) {
      if (
        routeConversationIdRef.current === targetConversationId &&
        !isDraftConflictPendingError(nextError)
      ) {
        setError(getErrorMessage(nextError, t))
      }
    }
  }

  const attachComposerFiles = (files: File[]) => {
    if (
      composerSubmissionInFlightRef.current ||
      composerAttachmentOperationInFlightRef.current ||
      composerModelPreferenceOperationInFlightRef.current
    ) {
      return false
    }
    const operationEpoch = routeEpochRef.current
    composerAttachmentOperationInFlightRef.current = true
    setComposerAttachmentOperationPending(true)
    attachmentMutationTargetConversationIdRef.current = null
    let targetConversationId: string | null = null
    return draftQueueRef.current
      .then(() => attachMutation.mutateAsync(files))
      .then(async (id) => {
        targetConversationId = id
        return true
      })
      .catch((nextError: unknown) => {
        targetConversationId ??=
          attachmentMutationTargetConversationIdRef.current
        if (
          routeEpochRef.current === operationEpoch ||
          (targetConversationId !== null &&
            routeConversationIdRef.current === targetConversationId)
        ) {
          setError(getErrorMessage(nextError, t))
        }
        throw nextError
      })
      .finally(async () => {
        targetConversationId ??=
          attachmentMutationTargetConversationIdRef.current
        if (targetConversationId) {
          await flushDraftAfterAttachmentOperation(targetConversationId)
        }
        attachmentMutationTargetConversationIdRef.current = null
        composerAttachmentOperationInFlightRef.current = false
        setComposerAttachmentOperationPending(false)
      })
  }

  const removeComposerAttachment = async (file: ConversationFile) => {
    const targetConversationId = routeConversationIdRef.current
    if (
      !targetConversationId ||
      composerSubmissionInFlightRef.current ||
      composerAttachmentOperationInFlightRef.current ||
      composerModelPreferenceOperationInFlightRef.current
    ) {
      return
    }
    const operationEpoch = routeEpochRef.current
    composerAttachmentOperationInFlightRef.current = true
    setComposerAttachmentOperationPending(true)
    try {
      await draftQueueRef.current
      await removeAttachmentMutation.mutateAsync({
        targetConversationId,
        file,
      })
    } catch (nextError) {
      if (
        routeEpochRef.current === operationEpoch &&
        routeConversationIdRef.current === targetConversationId
      ) {
        setError(getErrorMessage(nextError, t))
      }
    } finally {
      await flushDraftAfterAttachmentOperation(targetConversationId)
      composerAttachmentOperationInFlightRef.current = false
      setComposerAttachmentOperationPending(false)
    }
  }

  const clearComposerAttachments = async (
    files: readonly ConversationFile[]
  ) => {
    const targetConversationId = routeConversationIdRef.current
    if (
      !targetConversationId ||
      files.length === 0 ||
      composerSubmissionInFlightRef.current ||
      composerAttachmentOperationInFlightRef.current ||
      composerModelPreferenceOperationInFlightRef.current
    ) {
      return
    }
    const operationEpoch = routeEpochRef.current
    composerAttachmentOperationInFlightRef.current = true
    setComposerAttachmentOperationPending(true)
    try {
      await draftQueueRef.current
      await clearAttachmentsMutation.mutateAsync({
        targetConversationId,
        files,
      })
    } catch (nextError) {
      if (
        routeEpochRef.current === operationEpoch &&
        routeConversationIdRef.current === targetConversationId
      ) {
        setError(getErrorMessage(nextError, t))
      }
    } finally {
      await flushDraftAfterAttachmentOperation(targetConversationId)
      composerAttachmentOperationInFlightRef.current = false
      setComposerAttachmentOperationPending(false)
    }
  }

  const interruptMutation = useMutation({
    mutationFn: ({
      targetConversationId,
      turnId,
    }: {
      targetConversationId: string
      turnId: string
    }) =>
      apiRequest(
        `/conversations/${targetConversationId}/turns/${turnId}/interrupt`,
        {
          method: "POST",
          schema: emptyResponseSchema,
        }
      ),
    onMutate: () => setInterrupting(true),
    onSuccess: async (_result, { targetConversationId, turnId }) => {
      try {
        await refreshAfterMutation(targetConversationId)
      } finally {
        dispatchedInterruptTurnIdsRef.current.delete(turnId)
        setPendingTurnSubmission((current) =>
          current?.turnId === turnId && current.interruptRequested
            ? null
            : current
        )
      }
    },
    onError: (nextError, { turnId }) => {
      dispatchedInterruptTurnIdsRef.current.delete(turnId)
      setInterrupting(false)
      setError(getErrorMessage(nextError, t))
    },
  })
  const requestTurnInterrupt = interruptMutation.mutate

  useEffect(() => {
    const pending = pendingTurnSubmission
    if (
      !pending?.interruptRequested ||
      !pending.turnId ||
      pending.conversationId === newConversationPlaceholderId ||
      dispatchedInterruptTurnIdsRef.current.has(pending.turnId)
    ) {
      return
    }
    dispatchedInterruptTurnIdsRef.current.add(pending.turnId)
    requestTurnInterrupt({
      targetConversationId: pending.conversationId,
      turnId: pending.turnId,
    })
  }, [pendingTurnSubmission, requestTurnInterrupt])

  useEffect(() => {
    const turnId = conversation?.running_turn?.id
    if (
      !reconnectExhausted ||
      !running ||
      !conversationId ||
      !turnId ||
      autoInterruptedTurnIdRef.current === turnId
    ) {
      return
    }
    autoInterruptedTurnIdRef.current = turnId
    requestTurnInterrupt({ targetConversationId: conversationId, turnId })
  }, [
    conversation?.running_turn?.id,
    conversationId,
    requestTurnInterrupt,
    reconnectExhausted,
    running,
  ])

  const steerMutation = useMutation({
    mutationFn: async (submission: ComposerSubmission) => {
      if (!conversationId) throw new Error("conversation id is required")
      steerSubmissionConversationIdRef.current = conversationId
      const targetConversationId = conversationId
      const nextInput = submission.input
      const nextCapabilityIds = [...submission.capabilityIds]
      const nextKnowledgeBaseIds = [...submission.knowledgeBaseIds]
      const persistedSnapshot = await queueDraftSave(
        targetConversationId,
        nextInput,
        nextCapabilityIds,
        nextKnowledgeBaseIds,
        { useLatestComposerSnapshot: false }
      )
      const idempotencyKey = await stableOperationId(steerOperationRef, {
        operation: "turn_steer",
        conversation_id: targetConversationId,
        turn_id: conversation?.running_turn?.id,
        draft_updated_at: draftUpdatedAtRef.current,
      })
      await enqueueDraftOperation(async () => {
        await apiRequest(
          `/conversations/${targetConversationId}/turns/${conversation?.running_turn?.id}/steer`,
          {
            method: "POST",
            body: {
              text: persistedSnapshot.input,
              idempotency_key: idempotencyKey,
            },
            schema: emptyResponseSchema,
          }
        )
        await refreshSubmittedConversation(targetConversationId)
      })
      return { id: targetConversationId }
    },
    onSuccess: async (result) => {
      composerSubmissionInFlightRef.current = false
      if (routeConversationIdRef.current !== result.id) {
        steerOperationRef.current = null
        steerSubmissionConversationIdRef.current = null
        await refreshConversationList()
        return
      }
      steerOperationRef.current = null
      steerSubmissionConversationIdRef.current = null
      await refreshConversationList()
    },
    onError: (nextError, submission) => {
      const targetConversationId = steerSubmissionConversationIdRef.current
      composerSubmissionInFlightRef.current = false
      if (routeConversationIdRef.current !== targetConversationId) {
        steerSubmissionConversationIdRef.current = null
        return
      }
      setValue((current) => current || submission.input)
      if (!isDraftConflictPendingError(nextError)) {
        setError(getErrorMessage(nextError, t))
      }
      steerSubmissionConversationIdRef.current = null
    },
  })

  const pendingMutation = useMutation({
    onMutate: optimisticallyConsumeSubmissionAttachments,
    mutationFn: async (submission: ComposerSubmission) => {
      if (!conversationId) throw new Error("conversation id is required")
      pendingSubmissionConversationIdRef.current = conversationId
      const targetConversationId = conversationId
      const nextInput = submission.input
      const nextCapabilityIds = [...submission.capabilityIds]
      const nextKnowledgeBaseIds = [...submission.knowledgeBaseIds]
      const persistedSnapshot = await queueDraftSave(
        targetConversationId,
        nextInput,
        nextCapabilityIds,
        nextKnowledgeBaseIds,
        { useLatestComposerSnapshot: false }
      )
      const idempotencyKey = await stableOperationId(pendingOperationRef, {
        operation: "pending_create",
        conversation_id: targetConversationId,
        draft_updated_at: draftUpdatedAtRef.current,
        collaboration_mode: submission.collaborationMode,
      })
      await enqueueDraftOperation(async () => {
        await apiRequest(
          `/conversations/${targetConversationId}/pending-requests`,
          {
            method: "POST",
            body: {
              input_text: persistedSnapshot.input,
              priority_capability_ids: persistedSnapshot.capabilityIds,
              knowledge_base_ids: persistedSnapshot.knowledgeBaseIds,
              collaboration_mode: submission.collaborationMode,
              idempotency_key: idempotencyKey,
            },
            schema: emptyResponseSchema,
          }
        )
        await refreshSubmittedConversation(targetConversationId)
      })
      return { id: targetConversationId }
    },
    onSuccess: async (result, _submission, optimisticAttachmentConsumption) => {
      commitOptimisticallyConsumedAttachments(optimisticAttachmentConsumption)
      composerSubmissionInFlightRef.current = false
      if (routeConversationIdRef.current !== result.id) {
        pendingOperationRef.current = null
        pendingSubmissionConversationIdRef.current = null
        await refreshConversationList()
        return
      }
      pendingOperationRef.current = null
      pendingSubmissionConversationIdRef.current = null
      await refreshConversationList()
    },
    onError: (nextError, submission, optimisticAttachmentConsumption) => {
      const targetConversationId = pendingSubmissionConversationIdRef.current
      composerSubmissionInFlightRef.current = false
      restoreOptimisticallyConsumedAttachments(optimisticAttachmentConsumption)
      if (routeConversationIdRef.current !== targetConversationId) {
        pendingSubmissionConversationIdRef.current = null
        return
      }
      setValue((current) => current || submission.input)
      setSelectedCapabilityIds((current) =>
        current.length > 0 ? current : [...submission.capabilityIds]
      )
      if (!isDraftConflictPendingError(nextError)) {
        setError(getErrorMessage(nextError, t))
      }
      pendingSubmissionConversationIdRef.current = null
    },
  })

  const pendingActionMutation = useMutation({
    mutationFn: ({
      request,
      action,
    }: {
      request: PendingRequest
      action: "start" | "cancel" | "guide"
    }) => {
      setError(null)
      setPendingActionId(request.id)
      return apiRequest(
        `/conversations/${conversationId}/pending-requests/${request.id}${action === "start" ? "/start" : action === "guide" ? "/steer" : ""}`,
        {
          method: action === "cancel" ? "DELETE" : "POST",
          schema: emptyResponseSchema,
        }
      )
    },
    onSettled: () => setPendingActionId(undefined),
    onSuccess: async (_result, variables) => {
      if (variables.action === "start") {
        notify.success(t("conversation.pendingContinued", { productName }), {
          id: "conversation-pending-action-success",
        })
      }
      if (conversationId) await refreshAfterMutation(conversationId)
    },
    onError: (nextError) => setError(getErrorMessage(nextError, t)),
  })

  const reorderPendingMutation = useMutation({
    mutationFn: async (requestIds: string[]) => {
      if (!conversationId) throw new Error("conversation id is required")
      setError(null)
      await apiRequest(
        `/conversations/${conversationId}/pending-requests/order`,
        {
          method: "PUT",
          body: { request_ids: requestIds },
          schema: emptyResponseSchema,
        }
      )
    },
    onMutate: async (requestIds) => {
      if (!conversationId) return undefined
      const queryKey = ["conversation", conversationId] as const
      await queryClient.cancelQueries({ queryKey })
      const previous = queryClient.getQueryData<Conversation>(queryKey)
      const positionById = new Map(
        requestIds.map((requestId, index) => [requestId, index + 1])
      )
      queryClient.setQueryData<Conversation>(queryKey, (current) => {
        if (!current?.pending_requests) return current
        const pendingRequests = current.pending_requests
          .map((request) => {
            const position = positionById.get(request.id)
            return position
              ? {
                  ...request,
                  sequence_no: position,
                  queue_no: position,
                }
              : request
          })
          .sort((left, right) => left.sequence_no - right.sequence_no)
        return { ...current, pending_requests: pendingRequests }
      })
      return { previous, queryKey }
    },
    onError: (nextError, _requestIds, context) => {
      if (context?.previous) {
        queryClient.setQueryData(context.queryKey, context.previous)
      }
      setError(getErrorMessage(nextError, t))
    },
    onSettled: () =>
      conversationId
        ? queryClient.invalidateQueries({
            queryKey: ["conversation", conversationId],
          })
        : undefined,
  })

  const restorePendingMutation = useMutation({
    mutationFn: async (request: PendingRequest) => {
      if (!conversationId) throw new Error("conversation id is required")
      setError(null)
      setPendingActionId(request.id)
      await queueDraftSave(
        conversationId,
        value,
        [...selectedCapabilityIds],
        [...selectedKnowledgeBaseIds]
      )
      await apiRequest(
        `/conversations/${conversationId}/pending-requests/${request.id}/restore-draft`,
        {
          method: "POST",
          schema: pendingRequestRestoreResultSchema,
        }
      )
      return refreshSubmittedConversation(conversationId)
    },
    onSettled: () => setPendingActionId(undefined),
    onSuccess: async (detail) => {
      setValue(detail.draft_input ?? "")
      setSelectedCapabilityIds(effectiveDraftCapabilityIds(detail))
      setSelectedKnowledgeBaseIds(effectiveDraftKnowledgeBaseIds(detail))
      await refreshConversationList()
      window.setTimeout(() => composerRef.current?.focus(), 0)
    },
    onError: (nextError) => {
      if (!isDraftConflictPendingError(nextError)) {
        setError(getErrorMessage(nextError, t))
      }
    },
  })

  const patchConversationMutation = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      apiRequest(`/conversations/${conversationId}`, {
        method: "PATCH",
        body,
        schema: conversationSchema,
      }),
    onSuccess: async (nextConversation, variables) => {
      queryClient.setQueryData<Conversation>(
        ["conversation", conversationId],
        (currentConversation) =>
          currentConversation
            ? { ...currentConversation, ...nextConversation }
            : nextConversation
      )
      setRenameOpen(false)
      if (variables.archive_status === "archived") {
        leaveCurrentConversation()
        return
      }
      await queryClient.invalidateQueries({ queryKey: ["conversations"] })
    },
    onError: (nextError) => setError(getErrorMessage(nextError, t)),
  })
  const collaborationModeMutationPending = Boolean(
    patchConversationMutation.isPending &&
    patchConversationMutation.variables &&
    "collaboration_mode" in patchConversationMutation.variables
  )

  const respondUserInputMutation = useMutation({
    mutationFn: ({
      request,
      response,
    }: {
      request: ConversationUserInputRequest
      response: ConversationUserInputResponse
    }) => {
      if (!conversationId) throw new Error("conversation id is required")
      return apiRequest(
        `/conversations/${conversationId}/user-input-requests/${request.id}/respond`,
        {
          method: "POST",
          body: response,
          schema: emptyResponseSchema,
        }
      )
    },
    onSuccess: async () => {
      if (conversationId) await refreshAfterMutation(conversationId)
    },
    onError: (nextError) => setError(getErrorMessage(nextError, t)),
  })

  const planReviewActionMutation = useMutation({
    mutationFn: async (submission: PlanReviewActionSubmission) => {
      if (!conversationId) throw new Error("conversation id is required")
      const body =
        submission.action === "implement" || submission.action === "revise"
          ? {
              action: submission.action,
              ...(submission.action === "revise"
                ? { feedback: submission.feedback }
                : {}),
              idempotency_key: await stableOperationId(planReviewOperationRef, {
                operation: "plan_review_action",
                conversation_id: conversationId,
                review_id: submission.reviewId,
                action: submission.action,
                ...(submission.action === "revise"
                  ? { feedback: submission.feedback }
                  : {}),
              }),
            }
          : { action: submission.action }
      return apiRequest(
        `/conversations/${conversationId}/plan-reviews/${submission.reviewId}/actions`,
        {
          method: "POST",
          body,
          schema: conversationPlanReviewActionResultSchema,
        }
      )
    },
    onSuccess: async (result) => {
      if (!conversationId) return
      planReviewOperationRef.current = null
      queryClient.setQueryData<Conversation>(
        ["conversation", conversationId],
        (current) => {
          if (!current) return current
          const planReviews = current.plan_reviews ?? []
          const reviewExists = planReviews.some(
            (review) => review.id === result.review.id
          )
          const nextCollaborationMode =
            result.turn?.collaboration_mode ??
            (result.review.decision === "exit"
              ? "default"
              : current.collaboration_mode)
          return {
            ...current,
            collaboration_mode: nextCollaborationMode,
            plan_reviews: reviewExists
              ? planReviews.map((review) =>
                  review.id === result.review.id ? result.review : review
                )
              : [...planReviews, result.review],
          }
        }
      )
      scrollToBottom("auto")
      await Promise.all([
        refreshSubmittedConversation(conversationId),
        refreshConversationList(),
      ])
    },
    onError: (nextError) => setError(getErrorMessage(nextError, t)),
  })

  const handlePlanModeChange = (enabled: boolean) => {
    if (
      composerSubmissionInFlightRef.current ||
      composerAttachmentOperationInFlightRef.current ||
      composerModelPreferenceOperationInFlightRef.current ||
      turnExecutionActive ||
      (conversation?.pending_requests?.length ?? 0) > 0 ||
      (conversation?.goal && conversation.goal.status !== "complete")
    ) {
      return
    }
    setError(null)
    if (enabled) setGoalMode(false)
    const nextMode: ConversationCollaborationMode = enabled ? "plan" : "default"
    if (isNew) {
      setNewTaskCollaborationMode(nextMode)
      return
    }
    patchConversationMutation.mutate({ collaboration_mode: nextMode })
  }

  const handleGoalModeChange = (enabled: boolean) => {
    if (
      composerSubmissionInFlightRef.current ||
      composerAttachmentOperationInFlightRef.current ||
      composerModelPreferenceOperationInFlightRef.current
    )
      return
    setError(null)
    if (!enabled || collaborationMode === "default") {
      setGoalMode(enabled)
      return
    }
    if (isNew) {
      setNewTaskCollaborationMode("default")
      setGoalMode(true)
      return
    }
    patchConversationMutation.mutate(
      { collaboration_mode: "default" },
      { onSuccess: () => setGoalMode(true) }
    )
  }

  const deleteMutation = useMutation({
    mutationFn: () =>
      apiRequest(`/conversations/${conversationId}`, {
        method: "DELETE",
        schema: emptyResponseSchema,
      }),
    onSuccess: () => {
      setDeleteOpen(false)
      leaveCurrentConversation()
    },
    onError: (nextError) => setError(getErrorMessage(nextError, t)),
  })

  const startContextCompaction = () => {
    if (
      contextCompactionMutation.isPending ||
      composerSubmissionInFlightRef.current ||
      composerAttachmentOperationInFlightRef.current ||
      composerModelPreferenceOperationInFlightRef.current ||
      attachmentOperationPending
    )
      return
    if (!compactionAvailable) {
      setError(t("errors.conversation.compactionUnavailable"))
      return
    }
    const targetConversationId = routeConversationIdRef.current
    if (!targetConversationId) return
    setError(null)
    setTokenQuotaNotice(null)
    scrollToBottom("auto")
    composerSubmissionInFlightRef.current = true
    contextCompactionMutation.mutate({
      commandValue: value,
      targetConversationId,
      routeEpoch: routeEpochRef.current,
      precedingTurnId: conversation?.turns?.at(-1)?.id ?? null,
    })
  }

  const submitComposer = (input: string) => {
    if (isConversationContextCompactionCommand(input)) {
      startContextCompaction()
      return
    }
    if (
      collaborationModeMutationPending ||
      composerSubmissionInFlightRef.current ||
      composerAttachmentOperationInFlightRef.current ||
      composerModelPreferenceOperationInFlightRef.current ||
      attachmentOperationPending
    )
      return
    const submission: ComposerSubmission = {
      input,
      capabilityIds: [...selectedCapabilityIds],
      knowledgeBaseIds: [...validSelectedKnowledgeBaseIds],
      attachments: [...attachments],
      collaborationMode,
    }
    setError(null)
    setTokenQuotaNotice(null)
    setValue(input)
    if (goalMode) {
      const existingGoalBlocksStart =
        conversation?.goal && conversation.goal.status !== "complete"
      if (turnExecutionActive || existingGoalBlocksStart) {
        setError(t("conversation.goal.startUnavailable"))
        return
      }
      setOptimisticGoal({
        conversationId: conversationId ?? newConversationPlaceholderId,
        goal: createOptimisticGoal(input.trim()),
        previousGoalRevision: threadGoalRevision(conversation?.goal),
      })
      scrollToBottom("auto")
      composerSubmissionInFlightRef.current = true
      setValue("")
      setSelectedCapabilityIds([])
      goalStartMutation.mutate(submission)
      return
    }
    if (!turnExecutionActive) {
      const optimisticId = crypto.randomUUID()
      const selectedCapabilities = new Map(
        (
          capabilityQuery.data?.items ??
          conversation?.available_capabilities ??
          []
        ).map((capability) => [capability.id, capability])
      )
      setPendingTurnSubmission({
        conversationId: conversationId ?? newConversationPlaceholderId,
        optimisticId,
        idempotencyKey: optimisticId,
        message: {
          id: `optimistic-${optimisticId}`,
          role: "user",
          content: submission.input,
          turn_id: null,
          created_at: new Date().toISOString(),
          attachments: submission.attachments,
          selected_capabilities: submission.capabilityIds.flatMap(
            (capabilityId) => {
              const capability = selectedCapabilities.get(capabilityId)
              return capability
                ? [
                    {
                      id: capability.id,
                      name: capability.name,
                      type: capability.type,
                    },
                  ]
                : []
            }
          ),
          selected_knowledge_base_ids: submission.knowledgeBaseIds,
        },
      })
      scrollToBottom("auto")
      composerSubmissionInFlightRef.current = true
      setValue("")
      setSelectedCapabilityIds([])
      sendMutation.mutate({ ...submission, optimisticId })
      return
    }

    const canSteer =
      running &&
      attachments.length === 0 &&
      submission.capabilityIds.length === 0
    if (runningMessageAction === "steer" && canSteer) {
      scrollToBottom("auto")
      composerSubmissionInFlightRef.current = true
      setValue("")
      steerMutation.mutate(submission)
      return
    }

    if ((conversation?.pending_requests?.length ?? 0) >= 5) {
      setError(t("conversation.maxPending"))
      return
    }

    if (runningMessageAction === "steer") {
      notify.info(t("conversation.steerFallbackQueued"), {
        id: "conversation-steer-fallback-queued",
      })
    }
    scrollToBottom("auto")
    composerSubmissionInFlightRef.current = true
    setValue("")
    setSelectedCapabilityIds([])
    pendingMutation.mutate(submission)
  }

  const askOfficeSelection = useCallback(
    async (
      file: ConversationFile,
      requests: readonly ConversationOfficeAnnotationRequest[]
    ) => {
      setError(null)
      scrollToBottom("auto")
      const knownFileIds = [
        ...new Set([
          ...(conversation ? getConversationFiles(conversation) : []).map(
            (item) => item.id
          ),
          file.id,
        ]),
      ]
      setOfficePreviewUpdate({ sourceFile: file, knownFileIds })
      try {
        await submitOfficeQuestion({
          file,
          requests,
        })
      } catch (nextError) {
        setOfficePreviewUpdate(null)
        throw nextError
      }
    },
    [conversation, scrollToBottom, submitOfficeQuestion]
  )

  const loadAttachmentPreview = useCallback(
    (file: ConversationFile, signal: AbortSignal) => {
      if (!conversationId || isNew) {
        return Promise.reject(new Error("conversation_id_required"))
      }
      return downloadApiFile(
        `/conversations/${conversationId}/attachments/${file.id}/content`,
        undefined,
        signal
      )
    },
    [conversationId, isNew]
  )

  const loadArtifactPreview = useCallback(
    async (file: ConversationFile, signal: AbortSignal) => {
      if (!conversationId || isNew) {
        throw new Error("conversation_id_required")
      }
      const preview = await apiRequest(
        `/conversations/${conversationId}/files/${file.id}/preview`,
        {
          method: "POST",
          schema: artifactPreviewLinkSchema,
          signal,
        }
      )
      return {
        url: preview.url,
        expiresAt: preview.expires_at,
      }
    },
    [conversationId, isNew]
  )

  const loadFilePreviewSource = useCallback(
    async (file: ConversationFile, signal: AbortSignal) => {
      if (!isAttachmentConversationFile(file)) {
        return loadArtifactPreview(file, signal)
      }

      const blob = await loadAttachmentPreview(file, signal)
      if (signal.aborted) throw new Error("attachment_preview_aborted")
      return createConversationAttachmentPreviewSource(blob)
    },
    [loadArtifactPreview, loadAttachmentPreview]
  )

  const loadOfficeContent = useCallback(
    async (file: ConversationFile, signal: AbortSignal) => {
      if (!conversationId || isNew) {
        throw new Error("conversation_id_required")
      }
      const fileRoute = isAttachmentConversationFile(file)
        ? `attachments/${file.id}`
        : `files/${file.id}`
      const blob = await downloadApiFile(
        `/conversations/${conversationId}/${fileRoute}/content`,
        undefined,
        signal
      )
      return new Uint8Array(await blob.arrayBuffer())
    },
    [conversationId, isNew]
  )

  const downloadArtifact = useCallback(
    async (file: ConversationFile) => {
      if (downloadInFlightRef.current || !conversationId || isNew) return
      downloadInFlightRef.current = true
      setError(null)
      setDownloadingFileId(file.id)
      try {
        const blob = await downloadApiFile(
          `/conversations/${conversationId}/files/${file.id}/download`
        )
        downloadBlob(blob, file.name)
      } catch (nextError) {
        setError(getErrorMessage(nextError, t))
      } finally {
        downloadInFlightRef.current = false
        setDownloadingFileId(undefined)
      }
    },
    [conversationId, isNew, t]
  )

  const downloadOfficePreview = (
    file: ConversationFile,
    content: Uint8Array
  ) => {
    if (downloadInFlightRef.current) return
    downloadInFlightRef.current = true
    setError(null)
    setDownloadingFileId(file.id)
    try {
      downloadBlob(
        new Blob([new Uint8Array(content)], {
          type: file.mime_type ?? "application/octet-stream",
        }),
        file.name
      )
    } catch (nextError) {
      setError(getErrorMessage(nextError, t))
    } finally {
      downloadInFlightRef.current = false
      setDownloadingFileId(undefined)
    }
  }

  const downloadMediaPreview = useCallback(
    async (file: ConversationFile) => {
      if (downloadInFlightRef.current || !conversationId || isNew) return
      downloadInFlightRef.current = true
      setError(null)
      setDownloadingFileId(file.id)
      try {
        const fileRoute = isAttachmentConversationFile(file)
          ? `attachments/${file.id}/content`
          : `files/${file.id}/media`
        const blob = await downloadApiFile(
          `/conversations/${conversationId}/${fileRoute}`
        )
        downloadBlob(blob, file.name)
      } catch (nextError) {
        setError(getErrorMessage(nextError, t))
      } finally {
        downloadInFlightRef.current = false
        setDownloadingFileId(undefined)
      }
    },
    [conversationId, isNew, t]
  )

  const handleSubAgentSelect = useCallback(
    ({ turnId, agent }: { turnId: string; agent: NativeSubAgentViewModel }) => {
      if (!conversationId || conversationId === "new") return
      setSelectedSubAgent({ conversationId, turnId, agentId: agent.id })
      setHtmlCodePreview(null)
      setOfficePreview(null)
      setOfficePreviewUpdate(null)
      setImagePreview(null)
      setFilePreviewClosing(false)
    },
    [conversationId]
  )

  const handlePreviewOfficeDocument = useCallback(
    (file: ConversationFile) => {
      setSelectedSubAgent(null)
      setHtmlCodePreview(null)
      setImagePreview(null)
      setFilePreviewClosing(false)
      setOfficePreview((current) => ({
        conversationId,
        file,
        animateEntrance: current?.conversationId !== conversationId,
      }))
      setOfficePreviewUpdate(null)
    },
    [conversationId]
  )

  const handlePreviewHtmlCode = useCallback(
    (html: string) => {
      setSelectedSubAgent(null)
      setOfficePreview(null)
      setOfficePreviewUpdate(null)
      setImagePreview(null)
      setFilePreviewClosing(false)
      setHtmlCodePreview((current) => ({
        conversationId,
        html,
        fileName: t("conversation.htmlCodePreviewFileName"),
        animateEntrance: current?.conversationId !== conversationId,
      }))
    },
    [conversationId, t]
  )

  const handlePreviewImage = useCallback(
    (item: ImagePreviewItem) => {
      setSelectedSubAgent(null)
      setOfficePreview(null)
      setOfficePreviewUpdate(null)
      setHtmlCodePreview(null)
      setFilePreviewClosing(false)
      setImagePreview((current) => ({
        conversationId,
        item,
        animateEntrance: current?.conversationId !== conversationId,
      }))
    },
    [conversationId]
  )

  const handleDownloadArtifact = useCallback(
    (file: ConversationFile) => {
      void downloadArtifact(file)
    },
    [downloadArtifact]
  )

  const finishFilePreviewExit = useCallback(() => {
    setFilePreviewClosing(false)
    setHtmlCodePreview(null)
    setImagePreview(null)
    setOfficePreview(null)
    setOfficePreviewUpdate(null)
  }, [])

  const regenerateMessage = regenerateMutation.mutateAsync
  const handleRegenerateMessage = useCallback(
    (sourceMessage: ConversationMessage, content: string) => {
      setError(null)
      scrollToBottom("auto")
      return regenerateMessage({
        message: sourceMessage,
        content,
      }).then(() => undefined)
    },
    [regenerateMessage, scrollToBottom]
  )

  const forkMessage = forkMutation.mutateAsync
  const handleForkMessage = useCallback(
    (sourceMessage: ConversationMessage) => {
      setError(null)
      return forkMessage(sourceMessage).then(() => undefined)
    },
    [forkMessage]
  )

  const subAgentProjectionPendingSubmission =
    pendingTurnSubmission?.conversationId === conversation?.id
      ? pendingTurnSubmission
      : null
  const subAgentProjectionReplacedTurnId =
    subAgentProjectionPendingSubmission?.replacesTurnId
  const subAgentProjectionHasLiveState = liveConversationId === conversationId
  const subAgentProjectionEvents = [
    ...(conversation?.events ?? []),
    ...(subAgentProjectionHasLiveState ? liveEvents : []),
  ].filter((event) => event.turn_id !== subAgentProjectionReplacedTurnId)
  const subAgentSummariesByTurnId = useSubAgentSummaries({
    conversationId: isNew ? undefined : conversation?.id,
    events: subAgentProjectionEvents,
  })

  const shouldRecoverUnavailableConversation =
    !isNew &&
    conversationQuery.isError &&
    isDefinitiveConversationUnavailableError(conversationQuery.error)

  if (
    !isNew &&
    (conversationQuery.isLoading ||
      (shouldRecoverUnavailableConversation && conversationQuery.isFetching))
  ) {
    return (
      <div className="conversation-workspace conversation-workspace-loading">
        <LoadingState />
      </div>
    )
  }
  if (shouldRecoverUnavailableConversation) {
    return <Navigate to="/conversations/new" replace />
  }
  if (!isNew && conversationQuery.isError) {
    return (
      <div className="conversation-workspace">
        <ErrorState
          message={getErrorMessage(conversationQuery.error, t)}
          onRetry={() => void conversationQuery.refetch()}
        />
      </div>
    )
  }
  if (
    !isNew &&
    conversation &&
    location.pathname === `/conversations/${conversation.id}` &&
    conversationPath(conversation) !== location.pathname
  ) {
    return <Navigate to={conversationPath(conversation)} replace />
  }

  const displayConversation: Conversation = conversation ?? {
    id: newConversationPlaceholderId,
    title: t("conversation.untitled"),
    archived: false,
    updated_at: new Date(0).toISOString(),
    has_unread_completion: false,
    has_automation: false,
    collaboration_mode: newTaskCollaborationMode,
    messages: [],
    attachments: [],
    pending_requests: [],
    user_input_requests: [],
    draft_input: "",
    draft_capability_ids: [],
  }
  const currentOptimisticGoal =
    optimisticGoal?.conversationId === displayConversation.id
      ? optimisticGoal
      : null
  const persistedGoalHasReconciled = Boolean(
    currentOptimisticGoal &&
    threadGoalRevision(displayConversation.goal) !==
      currentOptimisticGoal.previousGoalRevision
  )
  const resolvedGoal =
    currentOptimisticGoal && !persistedGoalHasReconciled
      ? currentOptimisticGoal.goal
      : (displayConversation.goal ?? null)
  const displayGoal = resolvedGoal?.status === "complete" ? null : resolvedGoal
  const displayGoalSynchronizing = Boolean(
    currentOptimisticGoal && !persistedGoalHasReconciled
  )
  const persistedPendingRequests = displayConversation.pending_requests ?? []
  const pendingOfficeQuestionProjected = Boolean(
    pendingOfficeQuestion?.conversationId === displayConversation.id &&
    persistedPendingRequests.some(
      (request) => request.id === pendingOfficeQuestion.request.id
    )
  )
  const visiblePendingRequests =
    pendingOfficeQuestion?.conversationId === displayConversation.id &&
    !pendingOfficeQuestionProjected
      ? [...persistedPendingRequests, pendingOfficeQuestion.request]
      : persistedPendingRequests
  const availableCapabilities =
    capabilityQuery.data?.items ??
    displayConversation.available_capabilities ??
    []
  const openRenameDialog = () => {
    if (isApplicationConversation) return
    setRenameValue(displayConversation.title || t("conversation.untitled"))
    setRenameOpen(true)
  }
  const hasCurrentLiveState = liveConversationId === conversationId
  const optimisticallyReplacedTurnId =
    pendingTurnSubmission?.conversationId === displayConversation.id
      ? pendingTurnSubmission.replacesTurnId
      : undefined
  const visibleEvents = [
    ...(displayConversation.events ?? []),
    ...(hasCurrentLiveState ? liveEvents : []),
  ].filter((event) => event.turn_id !== optimisticallyReplacedTurnId)
  const modelContextUsage = selectConversationModelContextUsage(
    visibleEvents,
    displayConversation.model_context_usage
  )
  const runningPlan =
    displayConversation.running_turn && !reconnectExhausted
      ? selectConversationTurnPlan(
          visibleEvents,
          displayConversation.running_turn.id
        )
      : null
  const persistedMessageIds = new Set(
    displayConversation.messages?.map((message) => message.id) ?? []
  )
  const persistedItemIds = new Set(
    displayConversation.messages?.flatMap((message) =>
      message.item_id ? [message.item_id] : []
    ) ?? []
  )
  const visibleStreamedMessages = Object.values(streamedMessages)
    .filter(
      (message) =>
        message.content &&
        message.turn_id !== optimisticallyReplacedTurnId &&
        !persistedMessageIds.has(message.id) &&
        !persistedItemIds.has(message.item_id)
    )
    .sort(
      (left, right) =>
        (left.event_sequence_no ?? Number.MAX_SAFE_INTEGER) -
        (right.event_sequence_no ?? Number.MAX_SAFE_INTEGER)
    )
  const persistedMessages = optimisticallyReplacedTurnId
    ? (displayConversation.messages ?? []).filter(
        (message) => message.turn_id !== optimisticallyReplacedTurnId
      )
    : (displayConversation.messages ?? [])
  const projectedMessages =
    hasCurrentLiveState && visibleStreamedMessages.length
      ? [...persistedMessages, ...visibleStreamedMessages]
      : persistedMessages
  const optimisticMessage =
    pendingTurnSubmission?.conversationId === displayConversation.id &&
    !projectedMessages.some(
      (message) =>
        pendingTurnSubmission.turnId &&
        message.role === "user" &&
        message.turn_id === pendingTurnSubmission.turnId
    )
      ? pendingTurnSubmission.message
      : null
  const visibleMessages = projectVisibleConversationMessages(
    persistedMessages,
    hasCurrentLiveState ? visibleStreamedMessages : [],
    optimisticMessage,
    persistedMessageRenderKeys
  )
  const visibleActivities = [
    ...(displayConversation.activities ?? []),
    ...(hasCurrentLiveState ? liveActivities : []),
  ].filter((activity) => activity.turn_id !== optimisticallyReplacedTurnId)
  const overviewFiles = getConversationFiles({
    ...displayConversation,
    messages: visibleMessages,
  })
  const lineSidebarItems = buildConversationLineSidebarItems(
    visibleMessages,
    t("conversation.awaitingAssistant")
  )
  const showConnectionWarning = visuallyRunning && reconnectingWarningVisible
  const pendingTurnProjected = Boolean(
    pendingTurnSubmission?.turnId &&
    displayConversation.turns?.some(
      (turn) => turn.id === pendingTurnSubmission.turnId
    )
  )
  const pendingCompactionProjected = Boolean(
    pendingCompaction?.turnId &&
    displayConversation.turns?.some(
      (turn) => turn.id === pendingCompaction.turnId
    )
  )
  const optimisticPendingTurn: ConversationTurn | null =
    pendingTurnSubmission?.conversationId === displayConversation.id &&
    !pendingTurnProjected
      ? {
          id:
            pendingTurnSubmission.turnId ??
            `pending-${pendingTurnSubmission.idempotencyKey}`,
          status: "running",
          collaboration_mode: collaborationMode,
          started_at: pendingTurnSubmission.message.created_at,
        }
      : null
  const persistedVisibleTurns = (displayConversation.turns ?? []).filter(
    (turn) => turn.id !== optimisticallyReplacedTurnId
  )
  const optimisticCompactionTurn: ConversationTurn | null =
    pendingCompaction?.conversationId === displayConversation.id &&
    !pendingCompactionProjected
      ? {
          id: pendingCompaction.turnId,
          status: "running",
          task_kind: "compact",
          collaboration_mode: collaborationMode,
          started_at: pendingCompaction.startedAt,
        }
      : null
  const visibleTurns = [
    ...persistedVisibleTurns,
    ...(optimisticPendingTurn ? [optimisticPendingTurn] : []),
    ...(optimisticCompactionTurn ? [optimisticCompactionTurn] : []),
  ]
  const projectedSubAgents = buildConversationTaskOverview({
    events: visibleEvents,
    files: [],
    summaries: [...subAgentSummariesByTurnId.values()].flat(),
  }).subAgents
  const activeSubAgentProjection = activeSubAgent
    ? projectedSubAgents.find((agent) => agent.id === activeSubAgent.agentId)
    : undefined
  const activeSubAgentRuntimeStatus = activeSubAgent
    ? subAgentSummariesByTurnId
        .get(activeSubAgent.turnId)
        ?.find((agent) => agent.agentKey === activeSubAgent.agentId)?.status
    : undefined
  const visibleRunningTurn =
    optimisticPendingTurn ??
    optimisticCompactionTurn ??
    displayConversation.running_turn
  const unresolvedUserInputRequests = [
    ...displayConversation.user_input_requests,
  ]
    .filter(
      (request) =>
        request.status === "pending" || request.status === "answering"
    )
    .sort((left, right) => left.created_at.localeCompare(right.created_at))
  const activeUserInputRequest =
    unresolvedUserInputRequests.find(
      (request) => request.turn_id === visibleRunningTurn?.id
    ) ?? unresolvedUserInputRequests[0]
  const activePlanReview = [...(displayConversation.plan_reviews ?? [])]
    .filter((review) => review.status === "pending")
    .sort((left, right) => right.created_at.localeCompare(left.created_at))[0]
  const blockingPanelKey = activeUserInputRequest
    ? `user-input:${activeUserInputRequest.id}`
    : activePlanReview
      ? `plan-review:${activePlanReview.id}`
      : null

  const planReviewBusyAction: ConversationPlanDecisionBusyAction | null =
    planReviewActionMutation.isPending
      ? planReviewActionMutation.variables?.action === "skip"
        ? "dismiss"
        : (planReviewActionMutation.variables?.action ?? null)
      : null
  const blockingPanel = activeUserInputRequest ? (
    <ConversationUserInputRequestCard
      key={activeUserInputRequest.id}
      request={activeUserInputRequest}
      submitting={respondUserInputMutation.isPending}
      onInteractionStart={preserveScrollPositionForInteraction}
      onSubmit={(response) => {
        setError(null)
        respondUserInputMutation.mutate({
          request: activeUserInputRequest,
          response,
        })
      }}
    />
  ) : activePlanReview ? (
    <ConversationPlanDecisionCard
      key={activePlanReview.id}
      reviewId={activePlanReview.id}
      busyAction={planReviewBusyAction}
      onImplement={(reviewId) => {
        setError(null)
        planReviewActionMutation.mutate({
          reviewId,
          action: "implement",
        })
      }}
      onRevisionSubmit={(reviewId, feedback) => {
        setError(null)
        planReviewActionMutation.mutate({
          reviewId,
          action: "revise",
          feedback,
        })
      }}
      onDismiss={(reviewId) => {
        setError(null)
        planReviewActionMutation.mutate({
          reviewId,
          action: "skip",
        })
      }}
      onExit={(reviewId) => {
        setError(null)
        planReviewActionMutation.mutate({
          reviewId,
          action: "exit",
        })
      }}
    />
  ) : null
  const blockingPanelActive = blockingPanel !== null

  return (
    <ConversationOfficeLayout
      taskOverviewOpen={!isNew && taskOverviewOpen}
      defaultPreviewViewportRatio={
        activeSubAgent ? DEFAULT_SUBAGENT_DETAIL_VIEWPORT_RATIO : undefined
      }
      resizeLabel={t(
        activeSubAgent
          ? "conversation.subAgentActivities.resizeDetails"
          : "officePreview.resizePreview"
      )}
      previewClosing={
        filePreviewClosing &&
        Boolean(activeHtmlCodePreview || activeImagePreview || officeFile)
      }
      onPreviewExitComplete={finishFilePreviewExit}
      preview={
        activeSubAgent ? (
          <ConversationSubAgentDetail
            selection={activeSubAgent}
            agent={activeSubAgentProjection}
            runtimeStatus={activeSubAgentRuntimeStatus}
            onClose={() => setSelectedSubAgent(null)}
          />
        ) : activeHtmlCodePreview ? (
          <ConversationHtmlCodePreview
            html={activeHtmlCodePreview.html}
            fileName={activeHtmlCodePreview.fileName}
            animateEntrance={activeHtmlCodePreview.animateEntrance}
            onClose={() => setFilePreviewClosing(true)}
          />
        ) : activeImagePreview ? (
          <ConversationImagePreview
            item={activeImagePreview.item}
            animateEntrance={activeImagePreview.animateEntrance}
            onClose={() => setFilePreviewClosing(true)}
          />
        ) : officeFile ? (
          <ConversationOfficePreview
            file={officeFile}
            animateEntrance={officePreview?.animateEntrance}
            loadContent={loadOfficeContent}
            loadPreviewSource={loadFilePreviewSource}
            onAskSelection={askOfficeSelection}
            selectionDisabled={
              officeQuestionPending ||
              regenerateMutation.isPending ||
              knowledgeBaseSelectionPending
            }
            onDownload={downloadOfficePreview}
            onDownloadSource={downloadMediaPreview}
            updateAction={
              previewUpdateCandidate
                ? {
                    statusLabel: t("officePreview.updateAvailable"),
                    actionLabel: t("officePreview.update"),
                    onUpdate: applyOfficePreviewUpdate,
                    dismissLabel: t("officePreview.dismissUpdate"),
                    onDismiss: () => setOfficePreviewUpdate(null),
                  }
                : undefined
            }
            onClose={() => setFilePreviewClosing(true)}
          />
        ) : undefined
      }
    >
      <header className="conversation-top-bar" role="banner">
        <div className="conversation-title-actions flex min-w-0 items-center gap-1">
          {displayConversation.application && (
            <ApplicationIconDisplay
              icon={
                applicationDetailQuery.data?.icon ??
                displayConversation.application.icon ??
                defaultApplicationIcon
              }
              compact
              className="conversation-title-application-icon size-5 shrink-0"
            />
          )}
          <h1>{displayConversation.title || t("conversation.untitled")}</h1>
          {displayConversation.application && (
            <HoverCard>
              <HoverCardTrigger
                delay={120}
                closeDelay={100}
                render={
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-xs"
                    className="conversation-application-info-trigger"
                    aria-label={t("applications.conversationManaged", {
                      name: displayConversation.application.name,
                    })}
                  />
                }
              >
                <InfoIcon strokeWidth={1.8} aria-hidden="true" />
              </HoverCardTrigger>
              <HoverCardContent
                side="bottom"
                align="start"
                sideOffset={8}
                className="conversation-application-info-card"
              >
                <p className="conversation-application-info-title">
                  {t("applications.conversationManaged", {
                    name: displayConversation.application.name,
                  })}
                </p>
                <p className="conversation-application-info-description">
                  {t(
                    applicationAllowsUserModelSelection
                      ? "applications.conversationManagedUserModelDescription"
                      : "applications.conversationManagedDescription"
                  )}
                </p>
              </HoverCardContent>
            </HoverCard>
          )}
          {!isNew && (
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
                <EllipsisIcon
                  className="text-[var(--app-muted)] opacity-70"
                  aria-hidden="true"
                />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="min-w-40">
                <DropdownMenuGroup>
                  {!isApplicationConversation && (
                    <DropdownMenuItem onClick={openRenameDialog}>
                      <PencilIcon
                        className="size-3.5 text-[var(--app-muted)] opacity-70"
                        aria-hidden="true"
                      />{" "}
                      {t("conversation.rename")}
                    </DropdownMenuItem>
                  )}
                  <DropdownMenuItem
                    disabled={patchConversationMutation.isPending}
                    onClick={() =>
                      patchConversationMutation.mutate({
                        pinned: !displayConversation.pinned_at,
                      })
                    }
                  >
                    {displayConversation.pinned_at ? (
                      <TbPinFilled
                        className="size-3.5 text-[var(--app-muted)] opacity-70"
                        data-icon="conversation-pin-filled"
                        aria-hidden="true"
                      />
                    ) : (
                      <TbPin
                        className="size-3.5 text-[var(--app-muted)] opacity-70"
                        data-icon="conversation-pin"
                        strokeWidth={2}
                        aria-hidden="true"
                      />
                    )}{" "}
                    {t(
                      displayConversation.pinned_at
                        ? "conversation.unpin"
                        : "conversation.pin"
                    )}
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    disabled={patchConversationMutation.isPending}
                    onClick={() =>
                      patchConversationMutation.mutate({
                        archive_status: displayConversation.archived
                          ? "active"
                          : "archived",
                      })
                    }
                  >
                    {displayConversation.archived ? (
                      <ArchiveRestoreIcon
                        className="size-4 text-[var(--app-muted)] opacity-70"
                        data-icon="conversation-unarchive"
                        aria-hidden="true"
                      />
                    ) : (
                      <ArchiveIcon
                        className="size-3.5 text-[var(--app-muted)] opacity-70"
                        aria-hidden="true"
                      />
                    )}{" "}
                    {t(
                      displayConversation.archived
                        ? "conversation.unarchive"
                        : "conversation.archive"
                    )}
                  </DropdownMenuItem>
                </DropdownMenuGroup>
                <DropdownMenuSeparator />
                <DropdownMenuGroup>
                  <DropdownMenuItem
                    variant="destructive"
                    onClick={() => setDeleteOpen(true)}
                  >
                    <Trash2Icon
                      className="size-3.5 opacity-70"
                      aria-hidden="true"
                    />{" "}
                    {t("conversation.delete")}
                  </DropdownMenuItem>
                </DropdownMenuGroup>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {!isNew && (
            <ConversationTaskOverviewPanel
              key={conversationId}
              events={visibleEvents}
              files={overviewFiles}
              subAgentSummariesByTurnId={subAgentSummariesByTurnId}
              downloadingFileId={downloadingFileId}
              onDownload={handleDownloadArtifact}
              onOpenChange={setTaskOverviewOpen}
            />
          )}
          {headerActions}
        </div>
      </header>

      {(error || draftConflict || showConnectionWarning) && (
        <div className="conversation-top-overlay-stack">
          <div className="conversation-banner-stack">
            {draftConflict && (
              <StatusBanner
                variant="warning"
                title={t("conversation.draftConflict.title")}
                actions={
                  <div className="flex flex-wrap items-center justify-end gap-2">
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={resolvingDraftConflict}
                      onClick={useLatestDraft}
                    >
                      {t("conversation.draftConflict.useLatest")}
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      disabled={resolvingDraftConflict}
                      onClick={() => void keepCurrentDraft()}
                    >
                      {t("conversation.draftConflict.keepCurrent")}
                    </Button>
                  </div>
                }
              >
                {t("conversation.draftConflict.description")}
              </StatusBanner>
            )}
            {error && <StatusBanner variant="error">{error}</StatusBanner>}
            {showConnectionWarning && (
              <StatusBanner variant="warning">
                {t("conversation.reconnecting")}
              </StatusBanner>
            )}
          </div>
        </div>
      )}

      {!isNew && lineSidebarItems.length > 0 && (
        <ConversationLineSidebar
          ariaLabel={t("conversation.messageNavigation")}
          items={lineSidebarItems}
          activeItemId={lineSidebarItems.at(-1)?.id}
          className="conversation-message-line-sidebar hidden md:block"
          onItemSelect={(item) => {
            pauseAutoFollow()
            const prefersReducedMotion = window.matchMedia(
              "(prefers-reduced-motion: reduce)"
            ).matches
            const target = document.getElementById(
              getConversationMessageAnchorId(item.id)
            )
            if (target) {
              scrollToElement(target, prefersReducedMotion ? "auto" : "smooth")
            }
          }}
        />
      )}

      <ConversationThread
        conversation={{
          ...displayConversation,
          available_capabilities: availableCapabilities,
          messages: visibleMessages,
          activities: visibleActivities,
          events: visibleEvents,
          turns: visibleTurns,
          running_turn: visibleRunningTurn,
        }}
        knowledgeBases={availableKnowledgeBases}
        applicationKnowledgeBases={applicationDetailQuery.data?.knowledge_bases}
        modelCatalog={modelPreferenceQuery.data?.models}
        liveReasoningSummaries={
          hasCurrentLiveState ? liveReasoningSummaries : {}
        }
        nativeReconnectState={
          hasCurrentLiveState ? nativeReconnectState : undefined
        }
        loadAttachmentPreview={loadAttachmentPreview}
        loadArtifactPreview={loadArtifactPreview}
        selectedSubAgent={
          activeSubAgent
            ? {
                turnId: activeSubAgent.turnId,
                agentId: activeSubAgent.agentId,
              }
            : undefined
        }
        subAgentSummariesByTurnId={subAgentSummariesByTurnId}
        onSubAgentSelect={handleSubAgentSelect}
        onActivityDisclosureToggle={pauseAutoFollow}
        onPreviewOfficeDocument={handlePreviewOfficeDocument}
        onPreviewHtmlCode={handlePreviewHtmlCode}
        onPreviewImage={handlePreviewImage}
        onDownload={handleDownloadArtifact}
        downloadingFileId={downloadingFileId}
        editingDisabled={
          regenerateMutation.isPending ||
          Boolean(turnExecutionActive) ||
          Boolean(activeUserInputRequest) ||
          Boolean(activePlanReview) ||
          visiblePendingRequests.length > 0
        }
        showNewTaskWelcome={isNew}
        onStarterQuestionSelect={handleStarterQuestionSelect}
        suppressEmptyState={suppressEmptyState}
        emptyNotice={emptyTokenQuotaNotice}
        blockingPanel={blockingPanel}
        blockingPanelKey={blockingPanelKey}
        onBlockingPanelReveal={handleScrollToBottom}
        scrollContainerRef={scrollContainerRef}
        contentRef={contentRef}
        onRegenerateMessage={handleRegenerateMessage}
        onForkMessage={handleForkMessage}
        forkingDisabled={
          forkMutation.isPending ||
          Boolean(turnExecutionActive) ||
          Boolean(activeUserInputRequest) ||
          Boolean(activePlanReview) ||
          visiblePendingRequests.length > 0
        }
      />

      <div ref={bottomStackRef} className="conversation-bottom-stack">
        {showScrollToBottom && (
          <div className="conversation-scroll-to-bottom-row">
            <Button
              type="button"
              variant="secondary"
              size="icon-lg"
              className="conversation-scroll-to-bottom-button"
              aria-label={t("conversation.scrollToBottom")}
              title={t("conversation.scrollToBottom")}
              onClick={handleScrollToBottom}
            >
              <ConversationScrollToBottomIndicator running={visuallyRunning} />
            </Button>
          </div>
        )}
        {!blockingPanelActive && runningPlan && runningPlan.total > 0 && (
          <div className="conversation-plan-dock">
            <ConversationPlanCard
              key={runningPlan.turnId}
              steps={runningPlan.steps}
              currentStepIndex={runningPlan.currentStepIndex}
              running
              placement="composer"
            />
          </div>
        )}
        {!blockingPanelActive && (
          <PendingRequests
            requests={visiblePendingRequests}
            capabilities={availableCapabilities}
            knowledgeBases={availableKnowledgeBases}
            canGuideCurrentTurn={running}
            pendingActionId={
              pendingActionId ??
              (pendingOfficeQuestion?.request.id.startsWith("optimistic-")
                ? pendingOfficeQuestion.request.id
                : undefined)
            }
            taskStartDisabled={taskStartDisabledByTokenQuota}
            reorderDisabled={
              reorderPendingMutation.isPending ||
              Boolean(
                pendingOfficeQuestion?.request.id.startsWith("optimistic-")
              )
            }
            onGuide={(request) => {
              scrollToBottom("auto")
              pendingActionMutation.mutate({ request, action: "guide" })
            }}
            onStart={(request) => {
              scrollToBottom("auto")
              pendingActionMutation.mutate({ request, action: "start" })
            }}
            onEdit={(request) => restorePendingMutation.mutate(request)}
            onCancel={(request) =>
              pendingActionMutation.mutate({ request, action: "cancel" })
            }
            onReorder={(requestIds) =>
              reorderPendingMutation
                .mutateAsync(requestIds)
                .then(() => undefined)
            }
          />
        )}
        {!blockingPanelActive && displayGoal && (
          <ConversationGoalBar
            goal={displayGoal}
            synchronizing={displayGoalSynchronizing}
            pendingAction={goalPendingAction}
            onEdit={({ objective }) =>
              updateGoalMutation.mutate({
                action: "edit",
                body: { objective },
              })
            }
            onPause={() =>
              updateGoalMutation.mutate({
                action: "pause",
                body: { status: "paused" },
              })
            }
            onResume={() => resumeGoalMutation.mutate()}
            onClear={() => clearGoalMutation.mutate()}
          />
        )}
        {!blockingPanelActive &&
          showTokenQuotaBlockedCard &&
          exhaustedTokenQuotaKey && (
            <TokenQuotaBlockedCard
              onDismiss={() =>
                setDismissedTokenQuotaBlockKey(exhaustedTokenQuotaKey)
              }
            />
          )}
        {!blockingPanelActive && (
          <ConversationComposer
            ref={composerRef}
            key={`${displayConversation.id}:${newTaskResetVersion}`}
            value={value}
            onValueChange={setValue}
            capabilities={availableCapabilities}
            capabilitiesLoading={capabilityQuery.isLoading}
            capabilitiesError={capabilityQuery.isError}
            onRetryCapabilities={() => void capabilityQuery.refetch()}
            selectedIds={selectedCapabilityIds}
            onSelectedIdsChange={setSelectedCapabilityIds}
            knowledgeBases={availableKnowledgeBases}
            knowledgeBasesLoading={knowledgeBasesLoading}
            knowledgeBasesError={knowledgeBasesError}
            knowledgeSearchCapability={knowledgeSearchCapability.capability}
            onRetryKnowledgeBases={() => {
              void knowledgeBaseQuery.refetch()
              selectedKnowledgeBaseQueries.forEach((query, index) => {
                const knowledgeBaseId = missingSelectedKnowledgeBaseIds[index]
                if (
                  knowledgeBaseId &&
                  knowledgeBaseSelectionStatusById[knowledgeBaseId] ===
                    "verification_failed"
                ) {
                  void query.refetch()
                }
              })
            }}
            selectedKnowledgeBaseIds={selectedKnowledgeBaseIds}
            knowledgeBaseSelectionStatusById={knowledgeBaseSelectionStatusById}
            onSelectedKnowledgeBaseIdsChange={setSelectedKnowledgeBaseIds}
            hasMoreKnowledgeBases={knowledgeBaseQuery.hasNextPage}
            loadingMoreKnowledgeBases={knowledgeBaseQuery.isFetchingNextPage}
            onLoadMoreKnowledgeBases={() =>
              void knowledgeBaseQuery.fetchNextPage()
            }
            attachments={attachments}
            pendingAttachmentUploads={pendingAttachmentUploads}
            isRunning={visuallyRunning}
            interrupting={interrupting}
            goalMode={goalMode}
            onGoalModeChange={handleGoalModeChange}
            planMode={planMode}
            planModeDisabled={
              patchConversationMutation.isPending ||
              Boolean(turnExecutionActive) ||
              visiblePendingRequests.length > 0 ||
              Boolean(displayGoal && displayGoal.status !== "complete")
            }
            onPlanModeChange={handlePlanModeChange}
            submitting={
              sendMutation.isPending ||
              goalStartMutation.isPending ||
              contextCompactionMutation.isPending ||
              officeQuestionPending ||
              steerMutation.isPending ||
              pendingMutation.isPending ||
              pendingActionMutation.isPending ||
              collaborationModeMutationPending
            }
            uploading={attachMutation.isPending}
            attachmentOperationPending={attachmentOperationPending}
            modelPreference={modelPreferenceQuery.data}
            modelPreferencePending={
              attachmentOperationPending ||
              (isApplicationConversation && applicationDetailQuery.isLoading) ||
              modelPreferenceQuery.isLoading ||
              modelPreferenceMutation.isPending
            }
            modelContextUsage={modelContextUsage}
            managedApplicationName={
              isManagedApplicationConversation
                ? displayConversation.application?.name
                : undefined
            }
            allowManagedApplicationModelSelection={
              applicationAllowsUserModelSelection
            }
            onModelPreferenceChange={
              canSelectConversationModel
                ? (model, reasoningEffort) => {
                    if (
                      composerAttachmentOperationInFlightRef.current ||
                      composerSubmissionInFlightRef.current ||
                      composerModelPreferenceOperationInFlightRef.current
                    )
                      return
                    composerModelPreferenceOperationInFlightRef.current = true
                    modelPreferenceMutation.mutate({
                      model,
                      reasoningEffort,
                      targetConversationId: isNew
                        ? null
                        : (conversationId ?? null),
                    })
                  }
                : undefined
            }
            onSubmit={submitComposer}
            onCompact={startContextCompaction}
            compactAvailable={compactionAvailable}
            compacting={contextCompactionMutation.isPending}
            taskStartDisabled={taskStartDisabledByTokenQuota}
            onStartNewTask={startNewTaskFromComposer}
            onStartApplication={(application) => {
              if (
                composerAttachmentOperationInFlightRef.current ||
                composerSubmissionInFlightRef.current ||
                composerModelPreferenceOperationInFlightRef.current
              )
                return
              startApplicationFromComposerMutation.mutate(application)
            }}
            startingApplicationId={
              startApplicationFromComposerMutation.isPending
                ? startApplicationFromComposerMutation.variables?.id
                : undefined
            }
            onInterrupt={() => {
              const pending =
                pendingTurnSubmission?.conversationId === displayConversation.id
                  ? pendingTurnSubmission
                  : null
              if (pending) {
                setInterrupting(true)
                setPendingTurnSubmission((current) =>
                  current === pending
                    ? { ...current, interruptRequested: true }
                    : current
                )
                return
              }
              const turnId = conversation?.running_turn?.id
              if (conversationId && turnId) {
                interruptMutation.mutate({
                  targetConversationId: conversationId,
                  turnId,
                })
              }
            }}
            onAttach={attachComposerFiles}
            loadAttachmentPreview={loadAttachmentPreview}
            onRemoveAttachment={(file) => void removeComposerAttachment(file)}
            onClearAttachments={clearComposerAttachments}
            onError={setError}
          />
        )}
      </div>

      {!isApplicationConversation && (
        <ConversationRenameDialog
          open={renameOpen}
          onOpenChange={setRenameOpen}
          value={renameValue}
          onValueChange={setRenameValue}
          pending={patchConversationMutation.isPending}
          onSubmit={(title) => patchConversationMutation.mutate({ title })}
        />
      )}

      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title={t("conversation.deleteTitle")}
        description={t("conversation.deleteDescription")}
        confirmLabel={t("common.delete")}
        destructive
        pending={deleteMutation.isPending}
        onConfirm={() => deleteMutation.mutate()}
      />
    </ConversationOfficeLayout>
  )
}

export function ArchivedConversationListPage() {
  const { t, i18n } = useTranslation()
  const language = normalizeLanguage(i18n.resolvedLanguage) ?? "zh-CN"
  const queryClient = useQueryClient()
  const [deleteTarget, setDeleteTarget] = useState<{
    id: string
    title: string
  } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [searchOpen, setSearchOpen] = useState(false)
  const [clearAllOpen, setClearAllOpen] = useState(false)
  const [cursor, setCursor] = useState<string | undefined>()
  const [cursorStack, setCursorStack] = useState<(string | undefined)[]>([])
  const query = useQuery({
    queryKey: ["conversations", true, cursor],
    queryFn: ({ signal }) =>
      apiRequest("/conversations", {
        schema: paginatedSchema(conversationSchema),
        query: { archived: true, cursor, limit: 50 },
        signal,
      }),
  })

  const patchMutation = useMutation({
    mutationFn: (id: string) =>
      apiRequest(`/conversations/${id}`, {
        method: "PATCH",
        body: { archive_status: "active" },
        schema: conversationSchema,
      }),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ["conversations"] }),
    onError: (nextError) => setError(getErrorMessage(nextError, t)),
  })

  const deleteMutation = useMutation({
    mutationFn: () =>
      apiRequest(`/conversations/${deleteTarget?.id}`, {
        method: "DELETE",
        schema: emptyResponseSchema,
      }),
    onSuccess: async () => {
      setDeleteTarget(null)
      await queryClient.invalidateQueries({ queryKey: ["conversations"] })
    },
    onError: (nextError) => setError(getErrorMessage(nextError, t)),
  })

  const clearArchivedMutation = useMutation({
    mutationFn: () =>
      apiRequest("/conversations/archived", {
        method: "DELETE",
        schema: archivedConversationClearResultSchema,
      }),
    onSuccess: async (result) => {
      setClearAllOpen(false)
      setCursor(undefined)
      setCursorStack([])
      await queryClient.invalidateQueries({ queryKey: ["conversations"] })
      notify.success(
        t("conversation.clearArchivedSuccess", {
          count: result.deleted_count,
        }),
        { id: "conversation-clear-archived-success" }
      )
    },
    onError: (nextError) => setError(getErrorMessage(nextError, t)),
  })

  const goNext = () => {
    if (!query.data?.next_cursor) return
    setCursorStack((values) => [...values, cursor])
    setCursor(query.data.next_cursor ?? undefined)
  }

  const goPrevious = () => {
    setCursor(cursorStack.at(-1))
    setCursorStack((values) => values.slice(0, -1))
  }

  const shouldShowPagination =
    cursorStack.length > 0 || Boolean(query.data?.next_cursor)
  const archivedCount = query.data?.total_count ?? query.data?.items.length ?? 0
  const hasArchivedTasks = archivedCount > 0

  return (
    <PageLayout
      title={t("nav.archived")}
      description={t("settings.archivedDescription")}
      actions={
        hasArchivedTasks ? (
          <>
            <Button
              type="button"
              variant="ghost"
              onClick={() => setSearchOpen(true)}
            >
              <SearchIcon data-icon="inline-start" aria-hidden="true" />
              {t("common.search")}
            </Button>
            <Button
              type="button"
              variant="destructive-ghost"
              disabled={clearArchivedMutation.isPending || query.isLoading}
              onClick={() => {
                setError(null)
                setClearAllOpen(true)
              }}
            >
              <Trash2Icon data-icon="inline-start" aria-hidden="true" />
              {t("conversation.clearArchived")}
            </Button>
          </>
        ) : undefined
      }
    >
      {error && <StatusBanner variant="error">{error}</StatusBanner>}
      {query.isLoading && <LoadingState />}
      {query.isError && (
        <ErrorState
          message={getErrorMessage(query.error, t)}
          onRetry={() => void query.refetch()}
        />
      )}
      {query.data && (
        <div className="archived-conversation-summary" aria-live="polite">
          {t("conversation.archivedTaskCount", { count: archivedCount })}
        </div>
      )}
      {query.data?.items.length === 0 && (
        <EmptyState title={t("conversation.archivedEmpty")} />
      )}
      {query.data?.items.length ? (
        <Card
          className="archived-conversation-list"
          role="list"
          aria-label={t("nav.archived")}
        >
          <CardContent className="archived-conversation-list-content">
            {query.data.items.map((conversation, index) => {
              const displayTitle =
                conversation.title || t("conversation.untitled")
              const deleteLabel = t("conversation.deleteNamed", {
                title: displayTitle,
              })
              const unarchiveLabel = t("conversation.unarchiveNamed", {
                title: displayTitle,
              })

              return (
                <Fragment key={conversation.id}>
                  {index > 0 && (
                    <Separator className="archived-conversation-separator" />
                  )}
                  <article
                    role="listitem"
                    className="simple-list-row archived-conversation-row"
                  >
                    <div className="archived-conversation-copy">
                      <span className="archived-conversation-title">
                        {displayTitle}
                      </span>
                      <time dateTime={conversation.updated_at}>
                        {formatLongDateTime(conversation.updated_at, language)}
                      </time>
                    </div>
                    <div className="archived-conversation-actions">
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        aria-label={deleteLabel}
                        title={deleteLabel}
                        disabled={deleteMutation.isPending}
                        onClick={() =>
                          setDeleteTarget({
                            id: conversation.id,
                            title: displayTitle,
                          })
                        }
                      >
                        <Trash2Icon
                          data-icon="inline-start"
                          className="text-muted-foreground"
                          aria-hidden="true"
                        />
                      </Button>
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        aria-label={unarchiveLabel}
                        title={unarchiveLabel}
                        disabled={patchMutation.isPending}
                        onClick={() => patchMutation.mutate(conversation.id)}
                      >
                        {t("conversation.unarchive")}
                      </Button>
                    </div>
                  </article>
                </Fragment>
              )
            })}
          </CardContent>
        </Card>
      ) : null}
      {shouldShowPagination && (
        <div className="pagination-row">
          <Button
            variant="ghost"
            disabled={!cursorStack.length}
            onClick={goPrevious}
          >
            {t("common.previous")}
          </Button>
          <Button
            variant="ghost"
            disabled={!query.data?.next_cursor}
            onClick={goNext}
          >
            {t("common.next")}
          </Button>
        </div>
      )}
      <ConfirmDialog
        open={Boolean(deleteTarget)}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title={t("conversation.deleteTitle")}
        description={t("conversation.deleteDescription")}
        confirmLabel={t("common.delete")}
        destructive
        pending={deleteMutation.isPending}
        onConfirm={() => deleteMutation.mutate()}
      />
      <ConfirmDialog
        open={clearAllOpen}
        onOpenChange={setClearAllOpen}
        title={t("conversation.clearArchivedTitle")}
        description={t("conversation.clearArchivedDescription")}
        confirmLabel={t("conversation.clearArchived")}
        destructive
        pending={clearArchivedMutation.isPending}
        onConfirm={() => clearArchivedMutation.mutate()}
      />
      <ConversationSearchDialog
        open={searchOpen}
        onOpenChange={setSearchOpen}
      />
    </PageLayout>
  )
}
