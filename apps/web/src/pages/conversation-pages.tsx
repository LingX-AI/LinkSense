import { createRandomUuid } from "@/lib/random-uuid"
import type { ApplicationAnnotationSubmit } from "@/features/applications/application-annotation-submission"
import { SiteShareButton } from "@/features/web-sites/site-share-button"
import { FirstUseGuide } from "@/features/onboarding/first-use-guide"

import { responseLatency } from "@/features/conversations/response-latency"
import {
  Fragment,
  useCallback,
  useDeferredValue,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react"
import {
  useMutation,
  useQueries,
  useQuery,
  useQueryClient,
  type InfiniteData,
} from "@tanstack/react-query"
import {
  ArchiveIcon,
  ArchiveRestoreIcon,
  ArrowDownWideNarrowIcon,
  CircleAlertIcon,
  EllipsisIcon,
  FolderIcon,
  InfoIcon,
  PencilIcon,
  SearchIcon,
  UploadIcon,
  Trash2Icon,
  XIcon,
} from "lucide-react"
import { TbPin, TbPinFilled } from "react-icons/tb"
import { useTranslation } from "react-i18next"
import {
  Navigate,
  useLocation,
  useNavigate,
  useParams,
  useSearchParams,
} from "react-router-dom"
import {
  buildOfficeAnnotationDisplay,
  isMeaninglessTemporaryUploadPath,
  officeAnnotationRequestText,
  APPLICATION_BUILDER_SKILL_NAME,
  builtInCapabilityId,
  type ConversationCollaborationMode,
  type ConversationUserInputResponse,
} from "@linksense/shared"
import { z } from "zod"

import { ApiError, apiRequest, downloadApiFile } from "@/api/client"
import { PoweredByLinkSense } from "@/components/brand/powered-by-linksense"
import { requestTurnStart } from "@/features/conversations/turn-start-request"
import {
  conversationInterruptPollIntervalMs,
  conversationInterruptTimeoutMs,
  interruptConversationTurn,
  type ConversationInterruptTarget,
} from "@/features/conversations/conversation-interrupt"
import { useConversationPrewarm } from "@/features/conversations/use-conversation-prewarm"
import { withRequiredConversationCapabilities } from "@/features/conversations/conversation-capability-selection"
import { useConversationArchiveNotification } from "@/features/conversations/use-conversation-archive-notification"
import {
  archivedConversationClearResultSchema,
  applicationConversationSchema,
  applicationSchema,
  capabilitySummarySchema,
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
  type ConversationFile,
  type ConversationMessage,
  type ConversationTurn,
  type ConversationUserInputRequest,
  type NativeMessagePhase,
  type NativeMessageOutputKind,
  type Paginated,
  type ConversationEvent,
  type PendingRequest,
  type Application,
  type ThreadGoal,
  type User,
} from "@/api/contracts"
import { getErrorMessage } from "@/api/error-message"
import { useAuth } from "@/app/auth-state"
import { useProductName } from "@/app/product-branding"
import { useVoiceTranscriptionAvailability } from "@/features/conversations/use-voice-transcription-availability"
import { ConfirmDialog } from "@/components/feedback/confirm-dialog"
import {
  EmptyState,
  ErrorState,
  LoadingState,
} from "@/components/feedback/page-state"
import { notify } from "@/components/feedback/notification"
import { NotificationToast } from "@/components/feedback/notification-toast"
import type { ImagePreviewItem } from "@/components/media/image-preview"
import { StatusBanner } from "@/components/feedback/status-banner"
import { PageLayout } from "@/components/shell/page-layout"
import { Button } from "@/components/ui/button"
import { InputGroup, InputGroupAddon } from "@/components/ui/input-group"
import { SearchInput } from "@/components/ui/search-input"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Alert, AlertDescription } from "@/components/ui/alert"
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
import { useProjects } from "@/features/projects/project-api"
import { ApplicationIconDisplay } from "@/features/applications/application-icon"
import { defaultApplicationIcon } from "@/features/applications/application-icon-default"
import { ConversationDevelopmentIcon } from "@/components/shell/conversation-development-icon"
import {
  type ConversationComposerHandle,
  type KnowledgeBaseSelectionStatus,
  type PendingAttachmentUpload,
} from "@/features/conversations/conversation-composer"
import { ConversationDraftComposer } from "@/features/conversations/conversation-draft-composer"
import { createConversationComposerValue } from "@/features/conversations/conversation-composer-value"
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
  applyConversationExecutionTransition,
  getConversationExecutionTransition,
  isTerminalConversationExecutionStatus,
} from "@/features/conversations/conversation-execution-lifecycle"
import { matchingConversationStartFailure } from "@/features/conversations/conversation-start-failure"
import {
  bindPendingConversationTurn,
  clearPendingConversationExecution,
  getPendingConversationExecution,
  markConversationExecutionPending,
  movePendingConversationExecution,
  usePendingConversationExecution,
} from "@/features/conversations/conversation-pending-execution"
import {
  clearPendingConversationTurnSubmission,
  getPendingConversationTurnSubmission,
  movePendingConversationTurnSubmission,
  setPendingConversationTurnSubmission,
  updatePendingConversationTurnSubmission,
  usePendingConversationTurnSubmission,
  type PendingConversationTurnSubmission,
} from "@/features/conversations/conversation-pending-turn-submission"
import {
  clearLocalConversationDraft,
  readLocalConversationDraft,
  writeLocalConversationDraft,
} from "@/features/conversations/conversation-local-draft"
import { ConversationLineSidebar } from "@/features/conversations/conversation-line-sidebar"
import { buildOfficeAnnotationInput } from "@/features/conversations/conversation-office-annotation"
import { ConversationOfficeLayout } from "@/features/conversations/conversation-presentation-layout"
import { DEFAULT_SUBAGENT_DETAIL_VIEWPORT_RATIO } from "@/features/conversations/conversation-presentation-width"
import {
  readUrlEnum,
  updateUrlSearchParams,
  type SearchParamUpdate,
} from "@/lib/url-search-params"
import {
  ConversationHtmlCodePreview,
  ConversationImagePreview,
  ConversationOfficePreview,
  type ConversationOfficeAnnotationRequest,
} from "@/features/conversations/conversation-office-preview"
import {
  findFirstCompletedTurnPreviewFile,
  findUpdatedOfficePreviewFile,
  getConversationFiles,
} from "@/features/conversations/conversation-office-preview-update"
import { buildConversationLineSidebarItems } from "@/features/conversations/conversation-line-sidebar-items"
import { getConversationMessageAnchorId } from "@/features/conversations/conversation-message-anchor"
import type { ConversationThreadNavigation } from "@/features/conversations/conversation-message-list"
import { useConversationHistory } from "@/features/conversations/use-conversation-history"
import {
  patchConversationTitle,
  patchSidebarConversationExecutionStatus,
  patchSidebarConversationTitle,
  removeSidebarConversation,
  replaceSidebarConversation,
  upsertSidebarConversation,
} from "@/features/conversations/conversation-order"
import { ProjectComposerPicker } from "@/features/projects/project-composer-picker"
import { useNewProject } from "@/features/projects/use-new-project"
import { newProjectNavigationState } from "@/features/projects/new-project-preference"
import { ConversationRenameDialog } from "@/features/conversations/conversation-rename-dialog"
import { ConversationTaskOverviewPanel } from "@/features/conversations/conversation-task-overview-panel"
import {
  conversationSourcesQueryKey,
  conversationSourcesQueryOptions,
} from "@/features/conversations/conversation-sources-query"
import { ConversationShareDialog } from "@/features/conversations/conversation-share"
import { buildConversationTaskOverview } from "@/features/conversations/conversation-task-overview"
import { readTaskOverviewOpenPreference } from "@/features/conversations/conversation-task-overview-preference"
import {
  ConversationSubAgentDetail,
  type ConversationSubAgentSelection,
} from "@/features/conversations/conversation-subagent-detail"
import { ConversationThread } from "@/features/conversations/conversation-thread"
import type { NativeSubAgentViewModel } from "@/features/conversations/native-subagent-activity"
import { useSubAgentSummaries } from "@/features/conversations/use-subagent-summaries"
import {
  createConversationAttachmentPreviewSource,
  isPreviewableImageMimeType,
} from "@/features/conversations/conversation-attachment-preview-utils"
import {
  releaseConversationAttachmentPreviewResource,
  retainConversationAttachmentPreviewResource,
  type ConversationAttachmentPreviewResource,
} from "@/features/conversations/conversation-attachment-preview-cache"
import {
  referenceConversationFile,
  type ReferenceableFile,
} from "@/features/conversations/reference-file-api"
import { ConversationPlanCard } from "@/features/conversations/conversation-plan-card"
import {
  ConversationPlanDecisionCard,
  type ConversationPlanDecisionBusyAction,
} from "@/features/conversations/conversation-plan-decision-card"
import { ConversationGoalBar } from "@/features/conversations/conversation-goal-bar"
import { selectActiveUserInputRequest } from "@/features/conversations/conversation-user-input-request-status"
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
  retireOperationId,
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
} from "@/features/conversations/streaming-messages"
import {
  appendStreamingReasoningSummaryDelta,
  removeStreamingReasoningSummariesForTurn,
  removeStreamingReasoningSummaryItem,
} from "@/features/conversations/streaming-reasoning-summaries"
import { useConversationScroll } from "@/features/conversations/use-conversation-scroll"
import { useConversationBottomStackHeight } from "@/features/conversations/use-conversation-bottom-stack-height"
import { useConversationEvents } from "@/features/conversations/use-conversation-events"
import { useConversationLiveState } from "@/features/conversations/use-conversation-live-state"
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
const conversationForkNotificationId = "conversation-fork-loading"
const goalClearResultSchema = z.strictObject({ cleared: z.boolean() })
const emptyPersistedMessageRenderKeys: ReadonlyMap<string, string> = new Map()
const nativeMessageDeltaPhaseFallbackDelayMs = 120

type OfficePreviewUpdate = Readonly<{
  sourceFile: ConversationFile
  knownFileIds: readonly string[]
}>

type PendingTurnSubmission = PendingConversationTurnSubmission

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
    previewFile: isPreviewableImageMimeType(file.type) ? file : undefined,
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

type OptimisticSidebarExecutionStatus =
  | Readonly<{
      kind: "patched"
      conversationId: string
      previousExecutionStatus: Conversation["execution_status"]
    }>
  | Readonly<{
      kind: "inserted"
      conversationId: string
    }>

type OptimisticTurnStart = Readonly<{
  attachmentConsumption: OptimisticAttachmentConsumption | undefined
  sidebarExecutionStatus: OptimisticSidebarExecutionStatus | undefined
  pendingExecutionConversationId: string | undefined
}>

type UserCreditQuotaUsage = NonNullable<
  NonNullable<User["credit_quota"]>["weekly"]
>

function isCreditQuotaPeriodExhausted(
  period: UserCreditQuotaUsage | null | undefined
) {
  if (!period) return false
  return /^0(?:\.0+)?$/u.test(period.remaining_credits.trim())
}

function getExhaustedCreditQuotaKey(creditQuota: User["credit_quota"]) {
  if (!creditQuota) return null
  const exhaustedPeriods = [["weekly", creditQuota.weekly] as const].filter(
    ([, period]) => isCreditQuotaPeriodExhausted(period)
  )
  if (exhaustedPeriods.length === 0) return null
  return exhaustedPeriods
    .map(
      ([periodName, period]) =>
        `${periodName}:${period?.remaining_credits ?? ""}`
    )
    .join("|")
}

function CreditQuotaBlockedCard({
  onDismiss,
}: Readonly<{
  onDismiss: () => void
}>) {
  const { t } = useTranslation()
  return (
    <div className="conversation-credit-quota-card-dock">
      <Card
        size="sm"
        className="conversation-credit-quota-card"
        role="status"
        aria-live="polite"
      >
        <CardHeader className="conversation-credit-quota-card-header">
          <span
            className="conversation-credit-quota-card-icon"
            aria-hidden="true"
          >
            <CircleAlertIcon aria-hidden="true" />
          </span>
          <div className="conversation-credit-quota-card-copy">
            <CardTitle className="conversation-credit-quota-card-title">
              {t("conversation.creditQuotaBlocked.title")}
            </CardTitle>
            <CardDescription className="conversation-credit-quota-card-description">
              {t("conversation.creditQuotaBlocked.description")}
            </CardDescription>
          </div>
          <CardAction className="conversation-credit-quota-card-action">
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className="conversation-credit-quota-card-dismiss"
              aria-label={t("conversation.creditQuotaBlocked.dismiss")}
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
  showConversationActions = true,
  showComposer = true,
  conversationId: embeddedConversationId,
  embedded = false,
  surfaceActive = true,
  development = false,
  readOnly = false,
  unavailableMessage,
  annotationSubmitRef,
  onApplicationEvent,
}: Readonly<{
  headerActions?: ReactNode
  showConversationActions?: boolean
  showComposer?: boolean
  conversationId?: string
  embedded?: boolean
  surfaceActive?: boolean
  development?: boolean
  annotationSubmitRef?: RefObject<ApplicationAnnotationSubmit | null>
  readOnly?: boolean
  unavailableMessage?: string
  onApplicationEvent?: (event: ConversationEvent) => void
}> = {}) {
  const { conversationId: routeConversationId } = useParams()
  const conversationId = embeddedConversationId ?? routeConversationId
  const isNew = !conversationId || conversationId === "new"
  const { t } = useTranslation()
  const productName = useProductName()
  const { user, refreshUser } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const queryClient = useQueryClient()
  const [composerValue] = useState(createConversationComposerValue)
  const { setValue } = composerValue
  const {
    projectId: newProjectId,
    isResolving: newProjectResolving,
    chooseProject: chooseNewProject,
    resetProject: resetNewProject,
  } = useNewProject({ userId: user?.id, isNew })
  const [taskOverviewOpen, setTaskOverviewOpen] = useState(() =>
    embedded ? false : readTaskOverviewOpenPreference()
  )
  const [
    pendingFirstMessageConversationId,
    setPendingFirstMessageConversationId,
  ] = useState<string | null>(null)
  const [
    taskOverviewSuppressedConversationId,
    setTaskOverviewSuppressedConversationId,
  ] = useState<string | null>(null)
  const [newTaskPromotionConversationId, setNewTaskPromotionConversationId] =
    useState<string | null>(null)
  const [optionalCapabilityIds, setSelectedCapabilityIds] = useState<string[]>(
    []
  )
  const requiredCapabilityIds = useMemo(
    () =>
      development ? [builtInCapabilityId(APPLICATION_BUILDER_SKILL_NAME)] : [],
    [development]
  )
  const selectedCapabilityIds = useMemo(
    () =>
      withRequiredConversationCapabilities(
        optionalCapabilityIds,
        requiredCapabilityIds
      ),
    [optionalCapabilityIds, requiredCapabilityIds]
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
  const dismissError = useCallback((message: string) => {
    setError((current) => (current === message ? null : current))
  }, [])
  const [creditQuotaNotice, setCreditQuotaNotice] = useState<string | null>(
    null
  )
  const [dismissedCreditQuotaBlockKey, setDismissedCreditQuotaBlockKey] =
    useState<string | null>(null)
  const setTurnAdmissionError = useCallback(
    (nextError: unknown) => {
      const message = getErrorMessage(nextError, t)
      if (
        nextError instanceof ApiError &&
        nextError.errorCode === "CREDIT_LIMIT_EXCEEDED"
      ) {
        setError(null)
        setCreditQuotaNotice(message)
        void refreshUser().catch(() => undefined)
        return
      }
      setCreditQuotaNotice(null)
      setError(message)
    },
    [refreshUser, t]
  )
  const [interruptTarget, setInterruptTarget] =
    useState<ConversationInterruptTarget | null>(null)
  const interruptingConversationId = interruptTarget?.conversationId
  const [terminalDetailReconciliations, setTerminalDetailReconciliations] =
    useState<
      Record<
        string,
        {
          turnId: string
          status: "completed" | "failed" | "interrupted"
          detailUpdateCount: number
        }
      >
    >({})
  const terminalDetailReconciliation = conversationId
    ? terminalDetailReconciliations[conversationId]
    : undefined
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
  const [shareOpen, setShareOpen] = useState(false)
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
  const {
    conversationId: liveConversationId,
    conversationIdRef: liveConversationIdRef,
    streamedMessages,
    setStreamedMessages,
    reasoningSummaries: liveReasoningSummaries,
    setReasoningSummaries: setLiveReasoningSummaries,
    activities: liveActivities,
    setActivities: setLiveActivities,
    events: liveEvents,
    setEvents: setLiveEvents,
    switchConversation: switchLiveConversation,
    promoteConversation: promoteLiveConversation,
    hasConversationLiveState,
    clearConversationLiveState,
  } = useConversationLiveState(conversationId ?? newConversationPlaceholderId)
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
  const autoPreviewedCompletedTurnIdsRef = useRef(new Set<string>())
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
  const hydratedDraftScopeRef = useRef<string | null>(null)
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
  const dispatchedInterruptTurnIdsRef = useRef(new Set<string>())

  useLayoutEffect(() => {
    const previousRouteConversationId = routeConversationIdRef.current
    if (previousRouteConversationId !== currentRouteConversationId) {
      setError(null)
      setCreditQuotaNotice(null)
    }
    if (
      previousRouteConversationId !== currentRouteConversationId &&
      currentRouteConversationId === null
    ) {
      setNewTaskResetVersion((current) => current + 1)
    }
    routeEpochRef.current += 1
    routeConversationIdRef.current = currentRouteConversationId
  }, [currentRouteConversationId, location.key, newTaskResetVersion])

  const regenerateOperationRef =
    useRef<Parameters<typeof stableOperationId>[0]["current"]>(null)
  const forkOperationRef = useRef<string | null>(null)
  const invalidateTimerRef = useRef<number | null>(null)
  const pendingDetailRefreshRef = useRef(false)
  const pendingListRefreshRef = useRef(false)
  const seenEventIdsRef = useRef(new Set<string>())
  const autoInterruptedTurnIdRef = useRef<string | null>(null)
  const observedNewTaskPromotionIdRef = useRef<string | null>(null)
  const isNewTaskPromotion =
    newTaskPromotionConversationId !== null &&
    newTaskPromotionConversationId === conversationId
  const interrupting =
    interruptingConversationId ===
      (isNew ? newConversationPlaceholderId : conversationId) ||
    (isNewTaskPromotion &&
      interruptingConversationId === newConversationPlaceholderId)
  const clearInterruptingConversation = useCallback(
    (
      targetConversationId: string | null | undefined,
      turnId?: string | null
    ) => {
      if (!targetConversationId) return
      setInterruptTarget((current) =>
        current?.conversationId === targetConversationId &&
        (!turnId || !current.turnId || current.turnId === turnId)
          ? null
          : current
      )
    },
    []
  )
  useLayoutEffect(() => {
    const promotedConversationId = newTaskPromotionConversationId
    if (!promotedConversationId) {
      observedNewTaskPromotionIdRef.current = null
      return
    }
    if (conversationId === promotedConversationId) {
      observedNewTaskPromotionIdRef.current = promotedConversationId
      return
    }
    if (observedNewTaskPromotionIdRef.current === promotedConversationId) {
      observedNewTaskPromotionIdRef.current = null
      setNewTaskPromotionConversationId((current) =>
        current === promotedConversationId ? null : current
      )
    }
  }, [conversationId, newTaskPromotionConversationId])
  const threadNavigationRef = useRef<ConversationThreadNavigation>(null)
  const [visibleMessageIds, setVisibleMessageIds] = useState<string[]>([])
  const handleVisibleMessageChange = useCallback((ids: string[]) => {
    setVisibleMessageIds((previous) =>
      previous.length === ids.length &&
      previous.every((id, index) => id === ids[index])
        ? previous
        : ids
    )
  }, [])
  const {
    scrollContainerRef,
    contentRef,
    showScrollToBottom,
    scrollToBottom,
    scrollToElement,
    pauseAutoFollow,
    preserveScrollPositionForInteraction,
  } = useConversationScroll(conversationId ?? newConversationPlaceholderId, {
    preservePositionOnConversationChange: isNewTaskPromotion,
    navigationRef: threadNavigationRef,
  })
  const bottomStackRef = useConversationBottomStackHeight()

  const handleScrollToBottom = useCallback(() => {
    const prefersReducedMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)"
    ).matches
    scrollToBottom(prefersReducedMotion ? "auto" : "smooth")
  }, [scrollToBottom])

  const handleStarterQuestionSelect = useCallback(
    (prompt: string) => {
      setError(null)
      setCreditQuotaNotice(null)
      setValue(prompt)
      window.setTimeout(() => composerRef.current?.focus(), 0)
    },
    [setValue]
  )

  const conversationQuery = useQuery({
    ...conversationDetailQueryOptions(conversationId),
    enabled: !isNew,
  })
  const voiceTranscriptionAvailability = useVoiceTranscriptionAvailability()
  const isApplicationConversation = Boolean(conversationQuery.data?.application)
  const isManagedApplicationConversation =
    conversationQuery.data?.application?.kind === "standard"
  const applicationId = conversationQuery.data?.application?.id ?? ""
  const applicationDeleted =
    conversationQuery.data?.application?.unavailable_reason ===
    "APPLICATION_DELETED"
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
    enabled:
      applicationDetailActorId.length > 0 &&
      applicationId.length > 0 &&
      !applicationDeleted,
  })
  const applicationUnavailableMessage =
    unavailableMessage ??
    (applicationDeleted
      ? t("errors.application.deleted")
      : applicationDetailQuery.isError
        ? getErrorMessage(applicationDetailQuery.error, t)
        : applicationDetailQuery.data?.status === "disabled"
          ? t("errors.application.disabled")
          : applicationDetailQuery.data?.dependencies_available === false
            ? t("errors.application.dependencyUnavailable")
            : undefined)
  const applicationInteractionBlocked =
    isApplicationConversation &&
    (!applicationDetailQuery.data || Boolean(applicationUnavailableMessage))
  const executionBlocked = readOnly || applicationInteractionBlocked
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
    gcTime: 0,
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
    placeholderData: isNewTaskPromotion
      ? (previousData) => previousData
      : undefined,
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
  const { mutate: updateModelPreference } = modelPreferenceMutation
  const handleModelPreferenceChange = useCallback(
    (model: string, reasoningEffort: string) => {
      if (
        composerAttachmentOperationInFlightRef.current ||
        composerSubmissionInFlightRef.current ||
        composerModelPreferenceOperationInFlightRef.current
      )
        return
      composerModelPreferenceOperationInFlightRef.current = true
      updateModelPreference({
        model,
        reasoningEffort,
        targetConversationId: isNew ? null : (conversationId ?? null),
      })
    },
    [conversationId, isNew, updateModelPreference]
  )

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
  const sourcesQuery = useQuery({
    ...conversationSourcesQueryOptions(
      conversationId,
      conversation?.history?.scope_id,
      conversation?.last_event_id ?? conversation?.updated_at
    ),
    enabled:
      !isNew &&
      Boolean(conversation) &&
      taskOverviewOpen &&
      taskOverviewSuppressedConversationId !== conversationId,
  })
  const conversationHistory = useConversationHistory(conversation)
  const pendingConversationExecution = usePendingConversationExecution(
    conversationId ?? newConversationPlaceholderId
  )
  const cachedPendingTurnSubmission = usePendingConversationTurnSubmission(
    conversationId ?? newConversationPlaceholderId
  )
  const pendingSubmissionBelongsToConversation = Boolean(
    pendingTurnSubmission &&
    (pendingTurnSubmission.conversationId === conversationId ||
      (isNew &&
        (pendingTurnSubmission.conversationId ===
          newConversationPlaceholderId ||
          newTaskPromotionConversationId ===
            pendingTurnSubmission.conversationId)) ||
      (isNewTaskPromotion &&
        pendingTurnSubmission.conversationId === newConversationPlaceholderId))
  )
  const currentPendingTurnSubmission = pendingSubmissionBelongsToConversation
    ? pendingTurnSubmission
    : cachedPendingTurnSubmission
  const applicationSubmissionScrollId =
    currentPendingTurnSubmission?.message.display?.kind ===
    "interactive_application"
      ? currentPendingTurnSubmission.optimisticId
      : undefined
  useLayoutEffect(() => {
    if (applicationSubmissionScrollId) scrollToBottom("auto")
  }, [applicationSubmissionScrollId, scrollToBottom])
  const reconciledPendingUserMessage = currentPendingTurnSubmission
    ? conversation?.messages?.find(
        (message) =>
          message.role === "user" &&
          (currentPendingTurnSubmission.turnId
            ? message.turn_id === currentPendingTurnSubmission.turnId
            : isNewTaskPromotion &&
              pendingFirstMessageConversationId === conversationId &&
              message.content === currentPendingTurnSubmission.message.content)
      )
    : undefined
  const reconciledPendingUserMessageId = reconciledPendingUserMessage?.id
  const reconciledPendingUserMessageRenderKey =
    reconciledPendingUserMessageId && currentPendingTurnSubmission
      ? (currentPendingTurnSubmission.message.client_render_key ??
        `message-${currentPendingTurnSubmission.message.id}`)
      : undefined

  useLayoutEffect(() => {
    if (
      !conversationId ||
      !reconciledPendingUserMessageId ||
      !reconciledPendingUserMessageRenderKey
    ) {
      return
    }
    const timer = window.setTimeout(() => {
      setPersistedMessageRenderKeyState((current) => {
        const currentKeys =
          current.conversationId === conversationId
            ? current.keys
            : emptyPersistedMessageRenderKeys
        if (
          currentKeys.get(reconciledPendingUserMessageId) ===
          reconciledPendingUserMessageRenderKey
        ) {
          return current
        }
        return {
          conversationId,
          keys: new Map(currentKeys).set(
            reconciledPendingUserMessageId,
            reconciledPendingUserMessageRenderKey
          ),
        }
      })
    }, 0)
    return () => window.clearTimeout(timer)
  }, [
    conversationId,
    reconciledPendingUserMessageId,
    reconciledPendingUserMessageRenderKey,
  ])
  const persistedGoalRevision = threadGoalRevision(conversation?.goal)
  const refetchConversation = conversationQuery.refetch
  const hasConversation = Boolean(conversation)
  const suppressEmptyState =
    pendingFirstMessageConversationId !== null &&
    (isNew || pendingFirstMessageConversationId === conversationId) &&
    !conversation?.messages?.length
  const exhaustedCreditQuotaKey = getExhaustedCreditQuotaKey(
    user?.credit_quota ?? null
  )
  const taskStartDisabledByCreditQuota = exhaustedCreditQuotaKey !== null
  const showCreditQuotaBlockedCard =
    exhaustedCreditQuotaKey !== null &&
    dismissedCreditQuotaBlockKey !== exhaustedCreditQuotaKey
  const emptyCreditQuotaNotice = taskStartDisabledByCreditQuota
    ? null
    : creditQuotaNotice
  const optimisticallyConsumedAttachmentIds =
    optimisticAttachmentConsumption &&
    optimisticAttachmentConsumption.conversationId === conversation?.id
      ? new Set(optimisticAttachmentConsumption.submittedAttachmentIds)
      : null
  const attachments = (conversation?.attachments ?? []).filter(
    (attachment) => !optimisticallyConsumedAttachmentIds?.has(attachment.id)
  )
  const running = conversation?.running_turn?.status === "running"
  const pendingTurnExecutionActive = Boolean(currentPendingTurnSubmission)
  const applicationSubmissionSending =
    currentPendingTurnSubmission?.message.delivery_status === "sending"
  const acceptedTurnAwaitingProjection = Boolean(
    pendingTurnExecutionActive &&
    currentPendingTurnSubmission?.status !== undefined &&
    !conversation?.turns?.some(
      (turn) => turn.id === currentPendingTurnSubmission.turnId
    )
  )
  const acceptedCompactionAwaitingProjection = Boolean(
    pendingCompaction &&
    pendingCompaction.conversationId === conversationId &&
    !conversation?.turns?.some((turn) => turn.id === pendingCompaction.turnId)
  )
  const turnExecutionActive =
    running ||
    applicationSubmissionSending ||
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
    (running || pendingTurnExecutionActive || pendingConversationExecution) &&
    !reconnectExhausted
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

  const { claim: claimPrewarm, reset: resetPrewarm } = useConversationPrewarm({
    ownerId: user?.id,
    conversationId: isNew ? undefined : conversationId,
    scopeKey: isNew ? location.key : (conversationId ?? ""),
    collaborationMode,
    projectId: isNew ? newProjectId : undefined,
    configurationKey: modelPreferenceQuery.data?.selected_model ?? undefined,
    enabled:
      !readOnly &&
      !turnExecutionActive &&
      !modelPreferenceMutation.isPending &&
      !modelPreferenceQuery.isPending,
  })

  const startNewTaskFromComposer = useCallback(() => {
    if (
      composerSubmissionInFlightRef.current ||
      composerAttachmentOperationInFlightRef.current ||
      composerModelPreferenceOperationInFlightRef.current
    )
      return
    setError(null)
    if (!isNew) {
      navigate("/conversations/new", {
        state: newProjectNavigationState(user?.id, conversationId),
      })
      return
    }
    setPendingFirstMessageConversationId(null)
    resetPrewarm()
    setTaskOverviewSuppressedConversationId(null)
    setNewTaskPromotionConversationId(null)
    if (user) clearLocalConversationDraft(window.localStorage, user.id, "new")
    hydratedDraftScopeRef.current = null
    setValue("")
    resetNewProject()
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
  }, [
    isNew,
    navigate,
    resetPrewarm,
    resetNewProject,
    setGoalMode,
    user,
    conversationId,
    setValue,
  ])

  useEffect(() => {
    legacyStreamItemIdByTurnRef.current.clear()
  }, [conversationId])

  const applyOfficePreviewUpdate = useCallback(() => {
    if (!previewUpdateCandidate || !officePreviewUpdate) return
    setOfficePreview((current) =>
      current && current.file.id === officePreviewUpdate.sourceFile.id
        ? { ...current, file: previewUpdateCandidate }
        : current
    )
    setOfficePreviewUpdate(null)
  }, [officePreviewUpdate, previewUpdateCandidate])

  const localDraftScope = isNew ? "new" : (conversationId ?? "new")

  useLayoutEffect(() => {
    if (!user) return
    if (hydratedDraftScopeRef.current === localDraftScope) return
    const draft = readLocalConversationDraft(
      window.localStorage,
      user.id,
      localDraftScope
    )
    hydratedDraftScopeRef.current = localDraftScope
    setValue(draft.input)
    setSelectedCapabilityIds([...draft.capabilityIds])
    setSelectedKnowledgeBaseIds([...draft.knowledgeBaseIds])
  }, [localDraftScope, newTaskResetVersion, user, setValue])

  useEffect(() => {
    if (!user) return
    const persistDraft = () => {
      if (hydratedDraftScopeRef.current !== localDraftScope) return
      if (composerSubmissionInFlightRef.current) return
      writeLocalConversationDraft(
        window.localStorage,
        user.id,
        localDraftScope,
        {
          input: composerValue.getSnapshot(),
          capabilityIds: selectedCapabilityIds,
          knowledgeBaseIds: selectedKnowledgeBaseIds,
        }
      )
    }
    persistDraft()
    return composerValue.subscribe(persistDraft)
  }, [
    localDraftScope,
    selectedCapabilityIds,
    selectedKnowledgeBaseIds,
    user,
    composerValue,
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

  const pendingSubmittedTurnNotProjected = Boolean(
    currentPendingTurnSubmission &&
    currentPendingTurnSubmission.conversationId === conversationId &&
    (!currentPendingTurnSubmission.turnId ||
      !conversation?.turns?.some(
        (turn) => turn.id === currentPendingTurnSubmission.turnId
      ) ||
      !conversation.messages?.some(
        (message) => message.turn_id === currentPendingTurnSubmission.turnId
      ))
  )

  useEffect(() => {
    const executionStatus = conversation?.execution_status
    const updatedAt = conversation?.updated_at
    const lastRunAt = conversation?.last_run_at
    if (
      isNew ||
      !conversationId ||
      !conversationQuery.isSuccess ||
      (!conversationQuery.isFetchedAfterMount && !isNewTaskPromotion) ||
      terminalDetailReconciliation !== undefined ||
      pendingSubmittedTurnNotProjected ||
      (executionStatus !== "completed" &&
        executionStatus !== "failed" &&
        executionStatus !== "interrupted")
    ) {
      return
    }
    const pendingExecution = getPendingConversationExecution(
      queryClient,
      conversationId
    )
    if (pendingExecution) {
      const pendingTurn = pendingExecution.turnId
        ? conversation?.turns?.find(
            (turn) => turn.id === pendingExecution.turnId
          )
        : undefined
      const pendingTurnCompleted = Boolean(
        pendingTurn && pendingTurn.status !== "running"
      )
      // The first detail response after a submission may still describe the
      // preceding turn. Keep the optimistic running state until this exact
      // submitted turn reaches a terminal state.
      if (!pendingTurnCompleted) return
      clearPendingConversationExecution(queryClient, conversationId)
    }
    queryClient.setQueryData<
      InfiniteData<Paginated<Conversation>, string | undefined>
    >(["conversations", "sidebar"], (current) =>
      patchSidebarConversationExecutionStatus(
        current,
        conversationId,
        executionStatus,
        {
          updatedAt,
          lastRunAt,
        }
      )
    )
  }, [
    conversation?.execution_status,
    conversation?.turns,
    conversation?.updated_at,
    conversation?.last_run_at,
    conversationId,
    conversationQuery.isFetchedAfterMount,
    conversationQuery.isSuccess,
    isNewTaskPromotion,
    isNew,
    pendingConversationExecution?.turnId,
    pendingSubmittedTurnNotProjected,
    queryClient,
    terminalDetailReconciliation,
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

  const synchronizeLiveConversationScope = useCallback(
    (nextConversationId: string | undefined) => {
      if (liveConversationIdRef.current === nextConversationId) return
      switchLiveConversation(nextConversationId)
      seenEventIdsRef.current.clear()
      legacyStreamItemIdByTurnRef.current.clear()
      nativeMessagePhaseByItemIdRef.current.clear()
      stopHookSupersededItemIdsByTurnRef.current.clear()
      planOutputMissingMessagesByTurnRef.current.clear()
      clearPendingNativeMessageDeltas()
      setPersistedMessageRenderKeyState({
        conversationId: nextConversationId,
        keys: emptyPersistedMessageRenderKeys,
      })
    },
    [
      clearPendingNativeMessageDeltas,
      liveConversationIdRef,
      switchLiveConversation,
    ]
  )

  useLayoutEffect(() => {
    const nextConversationId = conversationId ?? newConversationPlaceholderId
    if (
      isNewTaskPromotion &&
      liveConversationIdRef.current === newConversationPlaceholderId &&
      conversationId
    ) {
      promoteLiveConversation(newConversationPlaceholderId, conversationId)
      return
    }
    synchronizeLiveConversationScope(nextConversationId)
  }, [
    conversationId,
    isNewTaskPromotion,
    location.key,
    liveConversationIdRef,
    promoteLiveConversation,
    synchronizeLiveConversationScope,
  ])

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
    [setStreamedMessages]
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
    [setStreamedMessages]
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
      hasReusableReplayBoundary:
        isNewTaskPromotion || hasConversationLiveState(conversationId),
    })

  const settleFailedStart = useCallback(
    (event: ConversationEvent) => {
      if (!conversationId) return
      const pending =
        (pendingTurnSubmission?.conversationId === conversationId
          ? pendingTurnSubmission
          : null) ??
        getPendingConversationTurnSubmission(queryClient, conversationId)
      const failure = matchingConversationStartFailure(event, pending)
      if (!failure) return
      if (pending?.replacesTurnId) {
        retireOperationId(regenerateOperationRef, pending.idempotencyKey)
      }
      clearPendingConversationTurnSubmission(queryClient, conversationId)
      clearPendingConversationExecution(queryClient, conversationId)
      setPendingTurnSubmission((current) =>
        current?.conversationId === conversationId &&
        matchingConversationStartFailure(event, current)
          ? null
          : current
      )
      clearInterruptingConversation(
        conversationId,
        failure.start_failure.turn_id
      )
      clearNativeReconnect()
      setPendingFirstMessageConversationId(null)
      setError(t(failure.message_key))
      scheduleConversationRefresh("detail-and-list")
    },
    [
      conversationId,
      queryClient,
      pendingTurnSubmission,
      clearInterruptingConversation,
      clearNativeReconnect,
      t,
      scheduleConversationRefresh,
    ]
  )

  useEffect(() => {
    if (!currentPendingTurnSubmission || !conversation?.events?.length) return
    const failedStart = conversation.events.find((event) =>
      matchingConversationStartFailure(event, currentPendingTurnSubmission)
    )
    if (!failedStart) return
    const timer = window.setTimeout(() => settleFailedStart(failedStart), 0)
    return () => window.clearTimeout(timer)
  }, [conversation?.events, currentPendingTurnSubmission, settleFailedStart])

  const { connectionState, reconnectingWarningVisible } = useConversationEvents(
    eventSubscriptionConversationId,
    useCallback(
      (event) => {
        const preservesPromotedNewTaskState =
          isNewTaskPromotion &&
          liveConversationIdRef.current === newConversationPlaceholderId
        if (
          liveConversationIdRef.current !== conversationId &&
          !preservesPromotedNewTaskState
        ) {
          synchronizeLiveConversationScope(conversationId)
        }
        if (event.id && seenEventIdsRef.current.has(event.id)) return
        if (event.id) seenEventIdsRef.current.add(event.id)

        const executionTransition = getConversationExecutionTransition(event)
        if (executionTransition && conversationId) {
          const terminal = isTerminalConversationExecutionStatus(
            executionTransition.status
          )
          if (
            executionTransition.status === "running" &&
            executionTransition.turnId &&
            getPendingConversationExecution(queryClient, conversationId)
          ) {
            bindPendingConversationTurn(
              queryClient,
              conversationId,
              executionTransition.turnId
            )
          }
          const pendingExecution = getPendingConversationExecution(
            queryClient,
            conversationId
          )
          const pendingSubmission = getPendingConversationTurnSubmission(
            queryClient,
            conversationId
          )
          const pendingTurnId =
            pendingSubmission?.turnId ?? pendingExecution?.turnId
          if (
            terminal &&
            (pendingExecution || pendingSubmission) &&
            !pendingTurnId
          ) {
            void queryClient.invalidateQueries({
              queryKey: ["conversation", conversationId],
              exact: true,
            })
            void queryClient.invalidateQueries(
              { queryKey: conversationSourcesQueryKey(conversationId) },
              { cancelRefetch: false }
            )
          }
          const matchesPendingExecution =
            !terminal ||
            (!pendingExecution && !pendingSubmission) ||
            pendingTurnId === executionTransition.turnId
          const currentConversation = queryClient.getQueryData<Conversation>([
            "conversation",
            conversationId,
          ])
          const transitionedConversation = currentConversation
            ? applyConversationExecutionTransition(
                currentConversation,
                executionTransition
              )
            : undefined
          const matchesCurrentTurn =
            matchesPendingExecution &&
            (!terminal ||
              transitionedConversation !== currentConversation ||
              pendingTurnId === executionTransition.turnId)
          if (matchesCurrentTurn) {
            if (transitionedConversation) {
              queryClient.setQueryData<Conversation>(
                ["conversation", conversationId],
                transitionedConversation
              )
            }
            // The matched lifecycle event already confirms execution status.
            // Output reconciliation must not keep the sidebar spinning.
            if (terminal) {
              // A list refresh started by the interrupt receipt can still
              // contain the pre-interruption status. Cancel it before patching.
              void queryClient.cancelQueries({
                queryKey: ["conversations", "sidebar"],
                exact: true,
              })
            }
            queryClient.setQueryData<
              InfiniteData<Paginated<Conversation>, string | undefined>
            >(["conversations", "sidebar"], (current) =>
              patchSidebarConversationExecutionStatus(
                current,
                conversationId,
                executionTransition.status
              )
            )
          }
          if (terminal && matchesCurrentTurn) {
            const terminalTurnId = executionTransition.turnId
            const terminalStatus = executionTransition.status
            if (
              terminalTurnId &&
              isTerminalConversationExecutionStatus(terminalStatus)
            ) {
              const projectedDetailUpdateCount =
                queryClient.getQueryState<Conversation>([
                  "conversation",
                  conversationId,
                ])?.dataUpdateCount ?? 0
              setTerminalDetailReconciliations((current) => ({
                ...current,
                [conversationId]: {
                  turnId: terminalTurnId,
                  status: terminalStatus,
                  detailUpdateCount: projectedDetailUpdateCount,
                },
              }))
            }
            void queryClient.invalidateQueries({
              queryKey: ["conversation", conversationId],
              exact: true,
            })
            clearPendingConversationExecution(queryClient, conversationId)
            void queryClient.invalidateQueries(
              { queryKey: conversationSourcesQueryKey(conversationId) },
              { cancelRefetch: false }
            )
            clearPendingConversationTurnSubmission(queryClient, conversationId)
            setPendingTurnSubmission((current) =>
              current?.conversationId === conversationId &&
              (!event.turn_id ||
                !current.turnId ||
                current.turnId === event.turn_id)
                ? null
                : current
            )
            setPendingCompaction((current) =>
              current?.conversationId === conversationId &&
              (!event.turn_id || current.turnId === event.turn_id)
                ? null
                : current
            )
          }
        }

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
          if (
            native.method === "turn/started" &&
            event.turn_id &&
            pendingTurnSubmission &&
            pendingSubmissionBelongsToConversation &&
            !pendingTurnSubmission.turnId
          ) {
            setPendingTurnSubmission((current) =>
              current === pendingTurnSubmission && !current.turnId
                ? {
                    ...current,
                    turnId: event.turn_id ?? undefined,
                    status: "starting",
                    message: { ...current.message, turn_id: event.turn_id },
                  }
                : current
            )
          }
          const projectedTurnId =
            event.turn_id !== null &&
            (conversation?.running_turn?.id === event.turn_id ||
              conversation?.turns?.some((turn) => turn.id === event.turn_id))
              ? event.turn_id
              : null
          const refreshScope = getConversationEventQueryRefreshScope(event, {
            projectedTurnId,
          })
          const reconciliationScope =
            executionTransition && refreshScope === "detail-and-list"
              ? "detail"
              : refreshScope
          if (
            native.method === "thread/name/updated" ||
            (native.method === "turn/started" && reconciliationScope === "none")
          ) {
            return
          }
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
              if (native.method === "item/completed") {
                void queryClient.invalidateQueries(
                  { queryKey: conversationSourcesQueryKey(conversationId) },
                  { cancelRefetch: false }
                )
              }
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
            clearInterruptingConversation(conversationId, event.turn_id)
            setLiveReasoningSummaries((current) =>
              removeStreamingReasoningSummariesForTurn(current, event.turn_id)
            )
          }
          if (
            !executionTransition ||
            !isTerminalConversationExecutionStatus(executionTransition.status)
          ) {
            scheduleConversationRefresh(reconciliationScope)
          }
          return
        }

        const payload = event.payload as Record<string, unknown>
        if (event.type === "conversation.title.updated") {
          const title = typeof payload.title === "string" ? payload.title : null
          if (
            title &&
            conversationId &&
            conversation?.title_source !== "manual"
          ) {
            queryClient.setQueryData<Conversation>(
              ["conversation", conversationId],
              (current) =>
                current ? patchConversationTitle(current, title) : current
            )
            queryClient.setQueryData(
              ["conversations", "sidebar"],
              (
                current: { pages: Array<{ items: Conversation[] }> } | undefined
              ) => patchSidebarConversationTitle(current, conversationId, title)
            )
            void Promise.all([
              queryClient.invalidateQueries({
                queryKey: ["conversation", conversationId],
                exact: true,
              }),
              queryClient.invalidateQueries({
                queryKey: ["conversations", "sidebar"],
                exact: true,
              }),
            ])
          }
          return
        }
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
          void queryClient.invalidateQueries(
            { queryKey: conversationSourcesQueryKey(conversationId) },
            { cancelRefetch: false }
          )
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
          settleFailedStart(event)
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
          if (
            executionTransition &&
            isTerminalConversationExecutionStatus(executionTransition.status)
          ) {
            clearInterruptingConversation(conversationId, event.turn_id)
          }
          setLiveReasoningSummaries((current) =>
            removeStreamingReasoningSummariesForTurn(current, event.turn_id)
          )
          if (event.type !== "conversation.status.changed")
            setLiveActivities([])
        }
        if (
          !executionTransition ||
          !isTerminalConversationExecutionStatus(executionTransition.status)
        ) {
          const refreshScope = getConversationQueryRefreshScope(event.type)
          scheduleConversationRefresh(
            executionTransition && refreshScope === "detail-and-list"
              ? "detail"
              : refreshScope
          )
        }
      },
      [
        clearInterruptingConversation,
        clearNativeReconnect,
        conversation?.title_source,
        conversation?.running_turn?.id,
        conversation?.turns,
        conversationId,
        enqueueNativeMessageDelta,
        flushPendingNativeMessageDeltas,
        isNewTaskPromotion,
        liveConversationIdRef,
        pendingTurnSubmission,
        pendingSubmissionBelongsToConversation,
        queryClient,
        scheduleConversationRefresh,
        settleFailedStart,
        setLiveActivities,
        setLiveEvents,
        setLiveReasoningSummaries,
        setStreamedMessages,
        startNativeReconnect,
        synchronizeLiveConversationScope,
        t,
      ]
    ),
    conversation?.last_event_id,
    onApplicationEvent
  )

  useEffect(() => {
    const reconciliation = terminalDetailReconciliation
    if (!reconciliation) return
    const detailUpdateCount = conversationId
      ? (queryClient.getQueryState<Conversation>([
          "conversation",
          conversationId,
        ])?.dataUpdateCount ?? 0)
      : 0
    if (
      conversationQuery.isFetching ||
      detailUpdateCount <= reconciliation.detailUpdateCount
    ) {
      return
    }
    const previewFile =
      reconciliation.status === "completed" && conversationQuery.data
        ? findFirstCompletedTurnPreviewFile(
            conversationQuery.data,
            reconciliation.turnId
          )
        : null
    const timer = window.setTimeout(() => {
      if (previewFile && conversationId) {
        const completedTurnKey = `${conversationId}:${reconciliation.turnId}`
        if (!autoPreviewedCompletedTurnIdsRef.current.has(completedTurnKey)) {
          autoPreviewedCompletedTurnIdsRef.current.add(completedTurnKey)
          handlePreviewOfficeDocument(previewFile)
        }
      }
      setTerminalDetailReconciliations((current) => {
        if (!conversationId || current[conversationId] !== reconciliation) {
          return current
        }
        const next = { ...current }
        delete next[conversationId]
        return next
      })
    }, 0)
    return () => window.clearTimeout(timer)
  }, [
    conversationId,
    conversationQuery.data,
    conversationQuery.isFetching,
    handlePreviewOfficeDocument,
    queryClient,
    terminalDetailReconciliation,
  ])

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
      clearInterruptingConversation(conversationId)
      clearNativeReconnect()
      clearConversationLiveState(conversationId)
    }, 2_000)
    return () => window.clearTimeout(timer)
  }, [
    clearConversationLiveState,
    clearInterruptingConversation,
    clearNativeReconnect,
    conversationId,
    hasConversation,
    turnExecutionActive,
  ])

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
  }, [conversation?.messages, setStreamedMessages])

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
    const pending = currentPendingTurnSubmission
    const projectedTurn = conversation?.turns?.find(
      (turn) => turn.id === pending?.turnId
    )
    const pendingTurnLifecycleProjected = Boolean(
      pending?.turnId &&
      (conversation?.running_turn?.id === pending.turnId ||
        (projectedTurn && projectedTurn.status !== "running"))
    )
    if (
      !pending?.turnId ||
      pending.conversationId !== conversation?.id ||
      !pendingTurnLifecycleProjected ||
      !conversation.messages?.some(
        (message) =>
          message.role === "user" && message.turn_id === pending.turnId
      )
    ) {
      return
    }
    const timer = window.setTimeout(() => {
      clearPendingConversationTurnSubmission(
        queryClient,
        pending.conversationId
      )
      setPendingTurnSubmission((current) =>
        current?.conversationId === pending.conversationId &&
        current.turnId === pending.turnId
          ? null
          : current
      )
    }, 0)
    return () => window.clearTimeout(timer)
  }, [
    conversation?.id,
    conversation?.messages,
    conversation?.running_turn?.id,
    conversation?.turns,
    currentPendingTurnSubmission,
    queryClient,
  ])

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
      const prewarmedConversationId = claimPrewarm()
      const createdConversation = await apiRequest("/conversations", {
        method: "POST",
        body: {
          collaboration_mode: initialCollaborationMode,
          project_id: newProjectId,
          ...(prewarmedConversationId
            ? {
                prewarmed_conversation_id: prewarmedConversationId,
              }
            : {}),
        },
        schema: conversationSchema,
      })
      if (user) {
        writeLocalConversationDraft(
          window.localStorage,
          user.id,
          createdConversation.id,
          {
            input: initialInput,
            capabilityIds: initialCapabilityIds,
            knowledgeBaseIds: initialKnowledgeBaseIds,
          }
        )
        clearLocalConversationDraft(window.localStorage, user.id, "new")
      }
      queryClient.setQueryData(
        ["conversation", createdConversation.id],
        createdConversation
      )
      responseLatency.move(newConversationPlaceholderId, createdConversation.id)
      if (suppressEmptyStateUntilFirstMessage) {
        const runningConversation: Conversation = {
          ...createdConversation,
          execution_status: "running",
        }
        movePendingConversationExecution(
          queryClient,
          newConversationPlaceholderId,
          createdConversation.id
        )
        movePendingConversationTurnSubmission(
          queryClient,
          newConversationPlaceholderId,
          createdConversation.id
        )
        queryClient.setQueryData<
          InfiniteData<Paginated<Conversation>, string | undefined>
        >(["conversations", "sidebar"], (cached) =>
          replaceSidebarConversation(
            cached,
            newConversationPlaceholderId,
            runningConversation
          )
        )
      }
      if (
        routeEpochRef.current === routeEpoch &&
        routeConversationIdRef.current === null
      ) {
        setNewTaskPromotionConversationId(createdConversation.id)
        setTaskOverviewSuppressedConversationId(createdConversation.id)
        hydratedDraftScopeRef.current = createdConversation.id
        routeConversationIdRef.current = createdConversation.id
        if (suppressEmptyStateUntilFirstMessage) {
          setPendingFirstMessageConversationId(createdConversation.id)
        }
        navigate(`/conversations/${createdConversation.id}`, { replace: true })
      }
      return createdConversation.id
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
    const queryKey = ["conversation", id] as const
    await queryClient.cancelQueries({ queryKey, exact: true }, { silent: true })
    const detail = await queryClient.fetchQuery({
      ...conversationDetailQueryOptions(id),
      staleTime: 0,
    })
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

  const optimisticallyMarkSidebarConversationRunning = useCallback(() => {
    const queryKey = ["conversations", "sidebar"] as const
    const current =
      queryClient.getQueryData<
        InfiniteData<Paginated<Conversation>, string | undefined>
      >(queryKey)
    if (!current) return undefined
    if (isNew) {
      const optimisticConversation = conversationSchema.parse({
        id: newConversationPlaceholderId,
        title: t("conversation.untitled"),
        archived: false,
        pinned_at: null,
        project_id: newProjectId,
        sort_order: null,
        updated_at: new Date().toISOString(),
        execution_status: "running",
        has_unread_completion: false,
        has_automation: false,
        collaboration_mode: collaborationMode,
      })
      queryClient.setQueryData<
        InfiniteData<Paginated<Conversation>, string | undefined>
      >(queryKey, (cached) =>
        upsertSidebarConversation(cached, optimisticConversation)
      )
      return {
        kind: "inserted",
        conversationId: newConversationPlaceholderId,
      } satisfies OptimisticSidebarExecutionStatus
    }
    if (!conversationId) return undefined
    const sidebarConversation = current?.pages
      .flatMap((page) => page.items)
      .find((item) => item.id === conversationId)
    if (
      !sidebarConversation ||
      sidebarConversation.execution_status === "running"
    ) {
      return undefined
    }
    const optimisticStatus = {
      kind: "patched",
      conversationId,
      previousExecutionStatus: sidebarConversation.execution_status,
    } satisfies OptimisticSidebarExecutionStatus
    queryClient.setQueryData<
      InfiniteData<Paginated<Conversation>, string | undefined>
    >(queryKey, (cached) =>
      patchSidebarConversationExecutionStatus(cached, conversationId, "running")
    )
    return optimisticStatus
  }, [collaborationMode, conversationId, isNew, newProjectId, queryClient, t])

  const restoreOptimisticSidebarExecutionStatus = useCallback(
    (
      optimisticStatus: OptimisticSidebarExecutionStatus | undefined,
      persistedConversationId?: string | null
    ) => {
      if (!optimisticStatus) return
      queryClient.setQueryData<
        InfiniteData<Paginated<Conversation>, string | undefined>
      >(["conversations", "sidebar"], (cached) => {
        if (optimisticStatus.kind === "inserted") {
          const withoutPlaceholder = removeSidebarConversation(
            cached,
            optimisticStatus.conversationId
          )
          return persistedConversationId
            ? patchSidebarConversationExecutionStatus(
                withoutPlaceholder,
                persistedConversationId,
                undefined
              )
            : withoutPlaceholder
        }
        return patchSidebarConversationExecutionStatus(
          cached,
          optimisticStatus.conversationId,
          optimisticStatus.previousExecutionStatus
        )
      })
    },
    [queryClient]
  )

  const sendMutation = useMutation({
    onMutate: async (submission): Promise<OptimisticTurnStart> => {
      responseLatency.begin(
        isNew
          ? newConversationPlaceholderId
          : (conversationId ?? newConversationPlaceholderId),
        isNew ? "new_task" : "follow_up"
      )
      // A sidebar refetch may have started before this submission. Cancel it
      // before applying the optimistic status so its older snapshot cannot
      // replace this task -- or the other running task rows -- when it settles.
      const sidebarCancellation = queryClient.cancelQueries(
        { queryKey: ["conversations", "sidebar"], exact: true },
        { silent: true, revert: false }
      )
      const sidebarExecutionStatus =
        optimisticallyMarkSidebarConversationRunning()
      const pendingExecutionConversationId =
        sidebarExecutionStatus?.conversationId ??
        (isNew ? newConversationPlaceholderId : conversationId)
      if (pendingExecutionConversationId) {
        markConversationExecutionPending(
          queryClient,
          pendingExecutionConversationId
        )
      }
      await sidebarCancellation
      try {
        const attachmentConsumption =
          await optimisticallyConsumeSubmissionAttachments(submission)
        return {
          attachmentConsumption,
          sidebarExecutionStatus,
          pendingExecutionConversationId,
        }
      } catch (error) {
        if (pendingExecutionConversationId) {
          clearPendingConversationExecution(
            queryClient,
            pendingExecutionConversationId
          )
          clearPendingConversationTurnSubmission(
            queryClient,
            pendingExecutionConversationId
          )
        }
        restoreOptimisticSidebarExecutionStatus(sidebarExecutionStatus)
        throw error
      }
    },
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
      const idempotencyKey = await stableOperationId(turnSubmitOperationRef, {
        operation: "turn_start",
        conversation_id: id,
        preceding_turn_id:
          conversation?.running_turn?.id ??
          conversation?.turns?.at(-1)?.id ??
          null,
        input_text: requestedInput,
        priority_capability_ids: requestedCapabilityIds,
        knowledge_base_ids: requestedKnowledgeBaseIds,
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
            content: requestedInput,
            turn_id: null,
            created_at:
              optimisticSubmission?.message.created_at ??
              new Date().toISOString(),
            attachments: nextAttachments,
            selected_capabilities: requestedCapabilityIds.flatMap(
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
            selected_knowledge_base_ids: requestedKnowledgeBaseIds,
          },
        }
      })
      updatePendingConversationTurnSubmission(queryClient, id, (current) => ({
        ...current,
        conversationId: id,
        optimisticId: submission.optimisticId,
        idempotencyKey,
      }))
      const receipt = await requestTurnStart(
        turnSubmitOperationRef,
        `/conversations/${id}/turns`,
        {
          input_text: requestedInput,
          priority_capability_ids: requestedCapabilityIds,
          knowledge_base_ids: requestedKnowledgeBaseIds,
          idempotency_key: idempotencyKey,
          collaboration_mode: submission.collaborationMode,
        }
      )
      responseLatency.bind(id, receipt.turn_id)
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
      updatePendingConversationTurnSubmission(queryClient, id, (current) => ({
        ...current,
        turnId: receipt.turn_id,
        status: receipt.status,
        message: { ...current.message, turn_id: receipt.turn_id },
      }))
      bindPendingConversationTurn(queryClient, id, receipt.turn_id)
      return { id, idempotencyKey }
    },
    onSuccess: (result, _submission, optimisticTurnStart) => {
      const attachmentConsumption = optimisticTurnStart?.attachmentConsumption
      composerSubmissionInFlightRef.current = false
      setPendingFirstMessageConversationId(null)
      if (routeConversationIdRef.current !== result.id) {
        commitOptimisticallyConsumedAttachments(attachmentConsumption)
        setPendingTurnSubmission((current) =>
          current?.conversationId === result.id ? null : current
        )
        if (turnSubmitOperationRef.current?.id === result.idempotencyKey) {
          turnSubmitOperationRef.current = null
        }
        sendSubmissionConversationIdRef.current = null
        if (user)
          clearLocalConversationDraft(window.localStorage, user.id, result.id)
        return
      }
      turnSubmitOperationRef.current = null
      sendSubmissionConversationIdRef.current = null
      if (user)
        clearLocalConversationDraft(window.localStorage, user.id, result.id)
      // Keep the optimistic running state until the submitted turn is
      // projected. An immediate list refresh can still return the preceding
      // terminal state and make the sidebar indicator flicker.
      // Keep submitted attachments filtered until the admission refresh has
      // settled too. That refresh can briefly return pre-consumption staged
      // attachments and must not put them back into the composer.
      void refreshSubmittedConversation(result.id)
        .catch(() =>
          queryClient.invalidateQueries({
            queryKey: ["conversation", result.id],
          })
        )
        .finally(() => {
          commitOptimisticallyConsumedAttachments(attachmentConsumption)
        })
    },
    onError: (nextError, submission, optimisticTurnStart) => {
      const targetConversationId = sendSubmissionConversationIdRef.current
      composerSubmissionInFlightRef.current = false
      clearInterruptingConversation(targetConversationId)
      restoreOptimisticallyConsumedAttachments(
        optimisticTurnStart?.attachmentConsumption
      )
      restoreOptimisticSidebarExecutionStatus(
        optimisticTurnStart?.sidebarExecutionStatus,
        targetConversationId
      )
      if (targetConversationId) {
        clearPendingConversationExecution(queryClient, targetConversationId)
        clearPendingConversationTurnSubmission(
          queryClient,
          targetConversationId
        )
      }
      if (
        optimisticTurnStart?.pendingExecutionConversationId &&
        optimisticTurnStart.pendingExecutionConversationId !==
          targetConversationId
      ) {
        clearPendingConversationExecution(
          queryClient,
          optimisticTurnStart.pendingExecutionConversationId
        )
        clearPendingConversationTurnSubmission(
          queryClient,
          optimisticTurnStart.pendingExecutionConversationId
        )
      }
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
      setSelectedKnowledgeBaseIds((current) =>
        current.length > 0 ? current : [...submission.knowledgeBaseIds]
      )
      setTurnAdmissionError(nextError)
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
      const receipt = await requestTurnStart(
        contextCompactionOperationRef,
        `/conversations/${targetConversationId}/compact`,
        { idempotency_key: idempotencyKey }
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
      if (user) {
        clearLocalConversationDraft(
          window.localStorage,
          user.id,
          result.conversationId
        )
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
    onMutate: async (submission: ComposerSubmission) => {
      responseLatency.begin(
        isNew
          ? newConversationPlaceholderId
          : (conversationId ?? newConversationPlaceholderId),
        isNew ? "new_task" : "follow_up"
      )
      return optimisticallyConsumeSubmissionAttachments(submission)
    },
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
      const objective = requestedObjective
      const capabilityIds = requestedCapabilityIds
      const knowledgeBaseIds = requestedKnowledgeBaseIds
      const idempotencyKey = await stableOperationId(goalStartOperationRef, {
        operation: "goal_start",
        conversation_id: id,
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
      const receipt = await requestTurnStart(
        goalStartOperationRef,
        `/conversations/${id}/goal`,
        {
          objective,
          priority_capability_ids: capabilityIds,
          knowledge_base_ids: knowledgeBaseIds,
          idempotency_key: idempotencyKey,
        }
      )
      responseLatency.bind(id, receipt.turn_id)
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
      let refreshedConversation: Conversation | null = null
      try {
        refreshedConversation = await refreshSubmittedConversation(id)
      } catch {
        void queryClient.invalidateQueries({
          queryKey: ["conversation", id],
        })
      }
      return { id, idempotencyKey, refreshedConversation }
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
        goalStartSubmissionConversationIdRef.current = null
        if (user)
          clearLocalConversationDraft(window.localStorage, user.id, result.id)
        void refreshConversationList()
        return
      }
      setGoalMode(false)
      goalStartOperationRef.current = null
      if (user)
        clearLocalConversationDraft(window.localStorage, user.id, result.id)
      goalStartSubmissionConversationIdRef.current = null
      void refreshConversationList()
    },
    onError: (nextError, submission, optimisticAttachmentConsumption) => {
      const targetConversationId = goalStartSubmissionConversationIdRef.current
      composerSubmissionInFlightRef.current = false
      restoreOptimisticallyConsumedAttachments(optimisticAttachmentConsumption)
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
      setSelectedKnowledgeBaseIds((current) =>
        current.length > 0 ? current : [...submission.knowledgeBaseIds]
      )
      setOptimisticGoal((current) =>
        current?.goal.objective === submission.input.trim() ? null : current
      )
      setGoalMode(true)
      setTurnAdmissionError(nextError)
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
    mutationFn: async (
      input:
        | {
            file: ConversationFile
            requests: readonly ConversationOfficeAnnotationRequest[]
          }
        | Parameters<ApplicationAnnotationSubmit>[0]
    ) => {
      const id = await ensureConversation({
        initialKnowledgeBaseIds: validSelectedKnowledgeBaseIds,
        initialCollaborationMode: collaborationMode,
      })
      const messageDisplay =
        "annotation" in input
          ? input.annotation
          : buildOfficeAnnotationInput(input.file, input.requests)
      const requestCapabilityIds =
        "annotation" in input ? [...selectedCapabilityIds] : []
      const requestText = officeAnnotationRequestText(messageDisplay)
      const optimisticDisplay = buildOfficeAnnotationDisplay(
        messageDisplay,
        "annotation" in input ? input.name : input.file.name
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
          message_display: messageDisplay,
          priority_capability_ids: requestCapabilityIds,
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
          priority_capability_ids: requestCapabilityIds,
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
              priority_capability_ids: requestCapabilityIds,
              knowledge_base_ids: validSelectedKnowledgeBaseIds,
              collaboration_mode: collaborationMode,
              idempotency_key: idempotencyKey,
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
      const receipt = await requestTurnStart(
        officeTurnSubmitOperationRef,
        `/conversations/${id}/turns`,
        {
          priority_capability_ids: requestCapabilityIds,
          knowledge_base_ids: validSelectedKnowledgeBaseIds,
          collaboration_mode: collaborationMode,
          idempotency_key: idempotencyKey,
          message_display: messageDisplay,
        }
      )
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

  useEffect(() => {
    if (
      !annotationSubmitRef ||
      !development ||
      readOnly ||
      !conversationId ||
      isNew
    )
      return
    const submit: ApplicationAnnotationSubmit = async (input) => {
      if (officeQuestionPending || knowledgeBaseSelectionPending)
        throw new Error("annotation_submission_busy")
      await submitOfficeQuestion(input)
    }
    annotationSubmitRef.current = submit
    return () => {
      if (annotationSubmitRef.current === submit)
        annotationSubmitRef.current = null
    }
  }, [
    annotationSubmitRef,
    development,
    readOnly,
    conversationId,
    isNew,
    officeQuestionPending,
    knowledgeBaseSelectionPending,
    submitOfficeQuestion,
  ])

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
        afterEventSequence: conversation?.events?.at(-1)?.sequence_no ?? 0,
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
      const receipt = await requestTurnStart(
        regenerateOperationRef,
        `/conversations/${conversationId}/messages/${sourceMessage.id}/regenerate`,
        {
          input_text: content,
          idempotency_key: idempotencyKey,
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
      clearConversationLiveState(id)
      if (liveConversationIdRef.current === id) clearNativeReconnect()
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
    onMutate: () => {
      notify.loading(t("conversation.forkingMessage"), {
        id: conversationForkNotificationId,
      })
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
    onError: (nextError) => {
      setError(getErrorMessage(nextError, t))
    },
    onSettled: () => {
      notify.dismiss(conversationForkNotificationId)
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
      const previewResources: ConversationAttachmentPreviewResource[] = []
      try {
        for (const file of uploadableFiles) {
          const formData = new FormData()
          formData.append("file", file)
          const attachment = await apiRequest(
            `/conversations/${id}/attachments`,
            {
              method: "POST",
              body: formData,
              schema: conversationFileSchema,
            }
          )
          if (
            isPreviewableImageMimeType(attachment.mime_type) &&
            isPreviewableImageMimeType(file.type)
          ) {
            previewResources.push(
              retainConversationAttachmentPreviewResource(
                attachment,
                async () => file
              )
            )
          }
        }
      } catch (nextError) {
        await refreshAfterMutation(id).catch(() => undefined)
        previewResources.forEach(releaseConversationAttachmentPreviewResource)
        throw nextError
      }
      return { id, previewResources }
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
    onSuccess: async ({ id, previewResources }) => {
      try {
        await refreshAfterMutation(id)
      } finally {
        previewResources.forEach(releaseConversationAttachmentPreviewResource)
      }
    },
    onSettled: (_data, _error, _files, context) => {
      const pendingUploadIds = context?.pendingUploadIds
      if (!pendingUploadIds || pendingUploadIds.length === 0) return
      const pendingUploadIdSet = new Set(pendingUploadIds)
      setPendingAttachmentUploads((current) =>
        current.filter((file) => !pendingUploadIdSet.has(file.id))
      )
    },
  })

  const referenceFileMutation = useMutation({
    mutationFn: async (file: ReferenceableFile) => {
      const id = await ensureConversation()
      attachmentMutationTargetConversationIdRef.current = id
      await referenceConversationFile(id, file.id)
      return id
    },
    onSuccess: (id) => refreshAfterMutation(id),
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
    referenceFileMutation.isPending ||
    removeAttachmentMutation.isPending ||
    clearAttachmentsMutation.isPending

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
    return attachMutation
      .mutateAsync(files)
      .then(async ({ id }) => {
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
      .finally(() => {
        targetConversationId ??=
          attachmentMutationTargetConversationIdRef.current
        attachmentMutationTargetConversationIdRef.current = null
        composerAttachmentOperationInFlightRef.current = false
        setComposerAttachmentOperationPending(false)
      })
  }

  const referenceComposerFile = async (
    file: ReferenceableFile
  ): Promise<boolean> => {
    if (
      composerSubmissionInFlightRef.current ||
      composerAttachmentOperationInFlightRef.current ||
      composerModelPreferenceOperationInFlightRef.current
    ) {
      return false
    }
    composerAttachmentOperationInFlightRef.current = true
    setComposerAttachmentOperationPending(true)
    attachmentMutationTargetConversationIdRef.current = null
    try {
      await referenceFileMutation.mutateAsync(file)
      return true
    } catch (error) {
      const targetId = attachmentMutationTargetConversationIdRef.current
      if (targetId) await refreshAfterMutation(targetId).catch(() => undefined)
      throw error
    } finally {
      attachmentMutationTargetConversationIdRef.current = null
      composerAttachmentOperationInFlightRef.current = false
      setComposerAttachmentOperationPending(false)
    }
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
    }) => interruptConversationTurn(targetConversationId, turnId),
    onMutate: ({ targetConversationId, turnId }) => {
      setInterruptTarget({ conversationId: targetConversationId, turnId })
      if (routeConversationIdRef.current === targetConversationId)
        setError(null)
    },
    onSuccess: (_result, { targetConversationId, turnId }) => {
      dispatchedInterruptTurnIdsRef.current.delete(turnId)
      clearPendingConversationExecution(queryClient, targetConversationId)
      const pending = getPendingConversationTurnSubmission(
        queryClient,
        targetConversationId
      )
      if (pending?.turnId === turnId && pending.interruptRequested) {
        clearPendingConversationTurnSubmission(
          queryClient,
          targetConversationId
        )
      }
      setPendingTurnSubmission((current) =>
        current?.turnId === turnId && current.interruptRequested
          ? null
          : current
      )
      // Receipt handling must not be held open by a slow detail/list refresh.
      void refreshAfterMutation(targetConversationId).catch(() => undefined)
    },
    onError: (nextError, { targetConversationId, turnId }) => {
      dispatchedInterruptTurnIdsRef.current.delete(turnId)
      clearPendingConversationExecution(queryClient, targetConversationId)
      clearInterruptingConversation(targetConversationId, turnId)
      updatePendingConversationTurnSubmission(
        queryClient,
        targetConversationId,
        (current) =>
          current.turnId === turnId
            ? { ...current, interruptRequested: false }
            : current
      )
      setPendingTurnSubmission((current) =>
        current?.turnId === turnId
          ? { ...current, interruptRequested: false }
          : current
      )
      if (routeConversationIdRef.current === targetConversationId) {
        setError(getErrorMessage(nextError, t))
      }
    },
  })
  const requestTurnInterrupt = interruptMutation.mutate

  useEffect(() => {
    if (!interruptTarget) return
    const { conversationId: targetConversationId, turnId } = interruptTarget
    const poll =
      turnId && targetConversationId !== newConversationPlaceholderId
        ? window.setInterval(() => {
            void queryClient
              .invalidateQueries(
                {
                  queryKey: ["conversation", targetConversationId],
                  exact: true,
                },
                { cancelRefetch: false }
              )
              .catch(() => undefined)
          }, conversationInterruptPollIntervalMs)
        : undefined
    const timeout = window.setTimeout(() => {
      clearInterruptingConversation(targetConversationId, turnId)
      if (
        (routeConversationIdRef.current ?? newConversationPlaceholderId) ===
        targetConversationId
      ) {
        setError(t("errors.interruptFailed"))
      }
    }, conversationInterruptTimeoutMs)
    return () => {
      window.clearInterval(poll)
      window.clearTimeout(timeout)
    }
  }, [interruptTarget, clearInterruptingConversation, queryClient, t])

  useEffect(() => {
    const pending = currentPendingTurnSubmission
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
  }, [currentPendingTurnSubmission, requestTurnInterrupt])

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
      const idempotencyKey = await stableOperationId(steerOperationRef, {
        operation: "turn_steer",
        conversation_id: targetConversationId,
        turn_id: conversation?.running_turn?.id,
      })
      await apiRequest(
        `/conversations/${targetConversationId}/turns/${conversation?.running_turn?.id}/steer`,
        {
          method: "POST",
          body: {
            text: submission.input,
            idempotency_key: idempotencyKey,
          },
          schema: emptyResponseSchema,
        }
      )
      await refreshSubmittedConversation(targetConversationId)
      return { id: targetConversationId }
    },
    onSuccess: async (result) => {
      composerSubmissionInFlightRef.current = false
      if (user)
        clearLocalConversationDraft(window.localStorage, user.id, result.id)
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
      setSelectedCapabilityIds((current) =>
        current.length > 0 ? current : [...submission.capabilityIds]
      )
      setSelectedKnowledgeBaseIds((current) =>
        current.length > 0 ? current : [...submission.knowledgeBaseIds]
      )
      setError(getErrorMessage(nextError, t))
      steerSubmissionConversationIdRef.current = null
    },
  })

  const pendingMutation = useMutation({
    onMutate: optimisticallyConsumeSubmissionAttachments,
    mutationFn: async (submission: ComposerSubmission) => {
      if (!conversationId) throw new Error("conversation id is required")
      pendingSubmissionConversationIdRef.current = conversationId
      const targetConversationId = conversationId
      const idempotencyKey = await stableOperationId(pendingOperationRef, {
        operation: "pending_create",
        conversation_id: targetConversationId,
        collaboration_mode: submission.collaborationMode,
      })
      await apiRequest(
        `/conversations/${targetConversationId}/pending-requests`,
        {
          method: "POST",
          body: {
            input_text: submission.input,
            priority_capability_ids: submission.capabilityIds,
            knowledge_base_ids: submission.knowledgeBaseIds,
            collaboration_mode: submission.collaborationMode,
            idempotency_key: idempotencyKey,
          },
          schema: emptyResponseSchema,
        }
      )
      await refreshSubmittedConversation(targetConversationId)
      return { id: targetConversationId }
    },
    onSuccess: async (result, _submission, optimisticAttachmentConsumption) => {
      commitOptimisticallyConsumedAttachments(optimisticAttachmentConsumption)
      composerSubmissionInFlightRef.current = false
      if (user)
        clearLocalConversationDraft(window.localStorage, user.id, result.id)
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
      setSelectedKnowledgeBaseIds((current) =>
        current.length > 0 ? current : [...submission.knowledgeBaseIds]
      )
      setError(getErrorMessage(nextError, t))
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
      const restored = await apiRequest(
        `/conversations/${conversationId}/pending-requests/${request.id}/restore-input`,
        {
          method: "POST",
          schema: pendingRequestRestoreResultSchema,
        }
      )
      await refreshSubmittedConversation(conversationId)
      return restored
    },
    onSettled: () => setPendingActionId(undefined),
    onSuccess: async (restored) => {
      setValue(restored.input_text)
      setSelectedCapabilityIds(restored.priority_capability_ids)
      setSelectedKnowledgeBaseIds(restored.knowledge_base_ids)
      await refreshConversationList()
      window.setTimeout(() => composerRef.current?.focus(), 0)
    },
    onError: (nextError) => setError(getErrorMessage(nextError, t)),
  })

  const showArchiveNotification = useConversationArchiveNotification()
  const patchConversationMutation = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      apiRequest(`/conversations/${conversationId}`, {
        method: "PATCH",
        body,
        schema: conversationSchema,
      }),
    onMutate: () => ({
      previousConversation: queryClient.getQueryData<Conversation>([
        "conversation",
        conversationId,
      ]),
    }),
    onSuccess: async (nextConversation, variables, context) => {
      if (typeof variables.title === "string") {
        await Promise.all([
          queryClient.cancelQueries({
            queryKey: ["conversations", "sidebar"],
            exact: true,
          }),
          queryClient.cancelQueries({
            queryKey: ["conversation", nextConversation.id],
            exact: true,
          }),
        ])
        queryClient.setQueryData(
          ["conversations", "sidebar"],
          (current: { pages: Array<{ items: Conversation[] }> } | undefined) =>
            patchSidebarConversationTitle(
              current,
              nextConversation.id,
              nextConversation.title,
              "manual"
            )
        )
      }
      queryClient.setQueryData<Conversation>(
        ["conversation", nextConversation.id],
        (currentConversation) =>
          currentConversation
            ? { ...currentConversation, ...nextConversation }
            : undefined
      )
      setRenameOpen(false)
      if (variables.archive_status === "archived") {
        showArchiveNotification({
          id: nextConversation.id,
          pinned_at: context.previousConversation?.pinned_at,
        })
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
    onError: async (nextError, { request }) => {
      setError(getErrorMessage(nextError, t))
      if (request.kind === "async_questions" && conversationId) {
        await refreshAfterMutation(conversationId)
      }
    },
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
    setCreditQuotaNotice(null)
    scrollToBottom("auto")
    composerSubmissionInFlightRef.current = true
    contextCompactionMutation.mutate({
      commandValue: composerValue.getSnapshot(),
      targetConversationId,
      routeEpoch: routeEpochRef.current,
      precedingTurnId: conversation?.turns?.at(-1)?.id ?? null,
    })
  }

  const submitComposer = (input: string) => {
    if (applicationSubmissionSending || applicationInteractionBlocked) return
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
    setCreditQuotaNotice(null)
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
      const optimisticId = createRandomUuid()
      const optimisticConversationId =
        conversationId ?? newConversationPlaceholderId
      const selectedCapabilities = new Map(
        (
          capabilityQuery.data?.items ??
          conversation?.available_capabilities ??
          []
        ).map((capability) => [capability.id, capability])
      )
      const optimisticSubmission: PendingTurnSubmission = {
        conversationId: optimisticConversationId,
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
      }
      setPendingTurnSubmission(optimisticSubmission)
      setPendingConversationTurnSubmission(
        queryClient,
        optimisticConversationId,
        optimisticSubmission
      )
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

  const reportFileDownloadError = useCallback(
    (nextError: unknown) => {
      notify.error(getErrorMessage(nextError, t), {
        id: "conversation-file-download-error",
      })
    },
    [t]
  )

  const downloadArtifact = useCallback(
    async (file: ConversationFile) => {
      if (downloadInFlightRef.current || !conversationId || isNew) return
      downloadInFlightRef.current = true
      setDownloadingFileId(file.id)
      try {
        const blob = await downloadApiFile(
          `/conversations/${conversationId}/files/${file.id}/download`
        )
        downloadBlob(blob, file.name)
      } catch (nextError) {
        reportFileDownloadError(nextError)
      } finally {
        downloadInFlightRef.current = false
        setDownloadingFileId(undefined)
      }
    },
    [conversationId, isNew, reportFileDownloadError]
  )

  const downloadOfficePreview = (
    file: ConversationFile,
    content: Uint8Array
  ) => {
    if (downloadInFlightRef.current) return
    downloadInFlightRef.current = true
    setDownloadingFileId(file.id)
    try {
      downloadBlob(
        new Blob([new Uint8Array(content)], {
          type: file.mime_type ?? "application/octet-stream",
        }),
        file.name
      )
    } catch (nextError) {
      reportFileDownloadError(nextError)
    } finally {
      downloadInFlightRef.current = false
      setDownloadingFileId(undefined)
    }
  }

  const downloadSourcePreview = useCallback(
    async (file: ConversationFile) => {
      if (downloadInFlightRef.current || !conversationId || isNew) return
      downloadInFlightRef.current = true
      setDownloadingFileId(file.id)
      try {
        const fileRoute = isAttachmentConversationFile(file)
          ? `attachments/${file.id}/content`
          : `files/${file.id}/download`
        const blob = await downloadApiFile(
          `/conversations/${conversationId}/${fileRoute}`
        )
        downloadBlob(blob, file.name)
      } catch (nextError) {
        reportFileDownloadError(nextError)
      } finally {
        downloadInFlightRef.current = false
        setDownloadingFileId(undefined)
      }
    },
    [conversationId, isNew, reportFileDownloadError]
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
    pendingSubmissionBelongsToConversation ? pendingTurnSubmission : null
  const subAgentProjectionReplacedTurnId =
    subAgentProjectionPendingSubmission?.replacesTurnId
  const liveStateBelongsToConversation =
    liveConversationId === conversationId ||
    (isNewTaskPromotion && liveConversationId === newConversationPlaceholderId)
  const subAgentProjectionEvents = [
    ...(conversation?.events ?? []),
    ...(liveStateBelongsToConversation ? liveEvents : []),
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
    project_id: newProjectId,
    updated_at: new Date(0).toISOString(),
    has_unread_completion: false,
    has_automation: false,
    collaboration_mode: newTaskCollaborationMode,
    messages: [],
    attachments: [],
    pending_requests: [],
    user_input_requests: [],
  }
  const currentOptimisticGoal =
    optimisticGoal?.conversationId === displayConversation.id
      ? optimisticGoal
      : null
  const developmentRole = development
    ? "development"
    : displayConversation.application_development_role
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
    setRenameValue(displayConversation.title || t("conversation.untitled"))
    setRenameOpen(true)
  }
  const activePendingTurnSubmission = currentPendingTurnSubmission
  const hasCurrentLiveState = liveStateBelongsToConversation
  const optimisticallyReplacedTurnId =
    activePendingTurnSubmission?.replacesTurnId
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
    activePendingTurnSubmission &&
    !reconciledPendingUserMessageId &&
    !projectedMessages.some(
      (message) =>
        activePendingTurnSubmission.turnId &&
        message.role === "user" &&
        message.turn_id === activePendingTurnSubmission.turnId
    )
      ? activePendingTurnSubmission.message
      : null
  const visiblePersistedMessageRenderKeys =
    reconciledPendingUserMessageId &&
    reconciledPendingUserMessageRenderKey &&
    persistedMessageRenderKeys.get(reconciledPendingUserMessageId) !==
      reconciledPendingUserMessageRenderKey
      ? new Map(persistedMessageRenderKeys).set(
          reconciledPendingUserMessageId,
          reconciledPendingUserMessageRenderKey
        )
      : persistedMessageRenderKeys
  const visibleMessages = projectVisibleConversationMessages(
    persistedMessages,
    hasCurrentLiveState ? visibleStreamedMessages : [],
    optimisticMessage,
    visiblePersistedMessageRenderKeys
  )
  const visibleActivities = [
    ...(displayConversation.activities ?? []),
    ...(hasCurrentLiveState ? liveActivities : []),
  ].filter((activity) => activity.turn_id !== optimisticallyReplacedTurnId)
  const overviewFiles = getConversationFiles({
    ...displayConversation,
    messages: visibleMessages,
  })
  const hiddenImplementationTurnIds = new Set(
    (displayConversation.plan_reviews ?? []).flatMap((review) =>
      review.status === "resolved" &&
      review.decision === "implement" &&
      review.follow_up_turn_id
        ? [review.follow_up_turn_id]
        : []
    )
  )
  const lineSidebarItems = buildConversationLineSidebarItems(
    visibleMessages.filter(
      (message) =>
        message.role !== "user" ||
        !message.turn_id ||
        !hiddenImplementationTurnIds.has(message.turn_id)
    ),
    t("conversation.awaitingAssistant"),
    displayConversation.history
      ? {
          index: displayConversation.history.index,
          unloadedLabel: (ordinal) =>
            t("conversation.historyExchange", { count: ordinal }),
          unloadedPreview: t("conversation.historyViewExchange"),
        }
      : undefined
  )
  const showConnectionWarning = visuallyRunning && reconnectingWarningVisible
  const reconciledPendingTurnId = activePendingTurnSubmission
    ? (activePendingTurnSubmission.turnId ??
      reconciledPendingUserMessage?.turn_id ??
      undefined)
    : undefined
  const pendingTurnProjected = Boolean(
    reconciledPendingTurnId &&
    displayConversation.turns?.some(
      (turn) => turn.id === reconciledPendingTurnId
    )
  )
  const pendingCompactionProjected = Boolean(
    pendingCompaction?.turnId &&
    displayConversation.turns?.some(
      (turn) => turn.id === pendingCompaction.turnId
    )
  )
  const optimisticPendingTurn: ConversationTurn | null =
    activePendingTurnSubmission && !pendingTurnProjected
      ? {
          id:
            reconciledPendingTurnId ??
            `pending-${activePendingTurnSubmission.idempotencyKey}`,
          status: "running",
          collaboration_mode: collaborationMode,
          started_at: activePendingTurnSubmission.message.created_at,
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
  const activePlanReview = executionBlocked
    ? undefined
    : [...(displayConversation.plan_reviews ?? [])]
        .filter((review) => review.status === "pending")
        .sort((left, right) =>
          right.created_at.localeCompare(left.created_at)
        )[0]
  const activeUserInputRequest = executionBlocked
    ? null
    : selectActiveUserInputRequest(
        displayConversation.user_input_requests,
        visibleRunningTurn?.id,
        Boolean(activePlanReview)
      )
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
  const blockingPanelActive =
    Boolean(activePlanReview) ||
    Boolean(
      activeUserInputRequest &&
      activeUserInputRequest.kind !== "async_questions"
    )
  const showApplicationUnavailableNotice =
    !readOnly && Boolean(applicationUnavailableMessage) && !blockingPanelActive
  const showConversationComposer =
    showComposer &&
    !readOnly &&
    !applicationDeleted &&
    !applicationUnavailableMessage &&
    !blockingPanelActive
  const taskOverviewSuppressed =
    taskOverviewSuppressedConversationId === conversationId
  const composerInstanceId = isNewTaskPromotion
    ? newConversationPlaceholderId
    : displayConversation.id
  const handleInterrupt = () => {
    const pending = activePendingTurnSubmission
    if (pending) {
      setInterruptTarget({
        conversationId: pending.conversationId,
        turnId: pending.turnId,
      })
      updatePendingConversationTurnSubmission(
        queryClient,
        pending.conversationId,
        (current) =>
          current.idempotencyKey === pending.idempotencyKey
            ? { ...current, interruptRequested: true }
            : current
      )
      setPendingTurnSubmission((current) =>
        current === pending ? { ...current, interruptRequested: true } : current
      )
      return
    }
    const turnId = conversation?.running_turn?.id
    if (conversationId && turnId) {
      if (dispatchedInterruptTurnIdsRef.current.has(turnId)) return
      dispatchedInterruptTurnIdsRef.current.add(turnId)
      interruptMutation.mutate({
        targetConversationId: conversationId,
        turnId,
      })
    }
  }

  return (
    <ConversationOfficeLayout
      taskOverviewOpen={
        surfaceActive && !isNew && !taskOverviewSuppressed && taskOverviewOpen
      }
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
            toolbarActions={
              <SiteShareButton
                file={officeFile}
                conversationId={displayConversation.id}
              />
            }
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
            onDownloadSource={downloadSourcePreview}
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
          <ConversationDevelopmentIcon role={developmentRole} />
          {displayConversation.application && !developmentRole && (
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
          {!isNew && showConversationActions && (
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
                  <DropdownMenuItem onClick={openRenameDialog}>
                    <PencilIcon
                      className="size-3.5 text-[var(--app-muted)] opacity-70"
                      aria-hidden="true"
                    />{" "}
                    {t("conversation.rename")}
                  </DropdownMenuItem>
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
          {!isNew && showConversationActions && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="conversation-share-trigger"
              onClick={() => setShareOpen(true)}
            >
              <UploadIcon aria-hidden="true" />
              {t("conversation.share.action")}
            </Button>
          )}
          {!isNew && surfaceActive && (
            <ConversationTaskOverviewPanel
              key={conversationId}
              events={visibleEvents}
              files={overviewFiles}
              sourcesState={{
                sources: sourcesQuery.data?.items ?? [],
                loading: sourcesQuery.isLoading,
                failed: sourcesQuery.isError,
                onRetry: () => {
                  void sourcesQuery.refetch()
                },
              }}
              defaultOpen={!taskOverviewSuppressed && taskOverviewOpen}
              subAgentSummariesByTurnId={subAgentSummariesByTurnId}
              downloadingFileId={downloadingFileId}
              onDownload={handleDownloadArtifact}
              onOpenChange={(open) => {
                setTaskOverviewSuppressedConversationId(null)
                setTaskOverviewOpen(open)
              }}
            />
          )}
          {headerActions}
          {!showComposer && !executionBlocked && visuallyRunning && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={interrupting}
              onClick={handleInterrupt}
            >
              {t(
                interrupting ? "conversation.interrupting" : "conversation.stop"
              )}
            </Button>
          )}
        </div>
      </header>

      {!isNew && showConversationActions && (
        <ConversationShareDialog
          conversation={displayConversation}
          open={shareOpen}
          onOpenChange={setShareOpen}
        />
      )}

      <NotificationToast
        message={error}
        variant="error"
        onDismiss={dismissError}
      />
      {showConnectionWarning && (
        <div className="conversation-top-overlay-stack">
          <div className="conversation-banner-stack">
            <StatusBanner variant="warning">
              {t("conversation.reconnecting")}
            </StatusBanner>
          </div>
        </div>
      )}

      {!isNew && lineSidebarItems.length > 0 && (
        <ConversationLineSidebar
          ariaLabel={t("conversation.messageNavigation")}
          items={lineSidebarItems}
          activeItemIds={visibleMessageIds}
          className="conversation-message-line-sidebar hidden md:block"
          onItemSelect={(item) => {
            pauseAutoFollow()
            if (threadNavigationRef.current?.scrollToMessage(item.id)) return
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
        navigationRef={threadNavigationRef}
        onVisibleMessageChange={handleVisibleMessageChange}
        history={conversation?.history ? conversationHistory : undefined}
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
        reconcilingCompletedTurnId={
          terminalDetailReconciliation?.status === "completed"
            ? terminalDetailReconciliation.turnId
            : undefined
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
          executionBlocked ||
          regenerateMutation.isPending ||
          Boolean(turnExecutionActive) ||
          Boolean(activeUserInputRequest) ||
          Boolean(activePlanReview) ||
          visiblePendingRequests.length > 0
        }
        showNewTaskWelcome={isNew}
        newTaskGuide={
          isNew &&
          !embedded &&
          !development &&
          !readOnly &&
          user?.role === "admin" &&
          user.status === "active" ? (
            <FirstUseGuide
              key={user.id}
              userId={user.id}
              isAdmin={user.role === "admin" && user.status === "active"}
              preference={modelPreferenceQuery.data}
              loading={modelPreferenceQuery.isPending}
              failed={modelPreferenceQuery.isError}
              force={new URLSearchParams(location.search).get("setup") === "1"}
              onRetry={() => void modelPreferenceQuery.refetch()}
              onDismiss={() => {
                const params = new URLSearchParams(location.search)
                if (params.get("setup") !== "1") return
                params.delete("setup")
                navigate(
                  { pathname: location.pathname, search: params.toString() },
                  { replace: true }
                )
              }}
            />
          ) : undefined
        }
        onStarterQuestionSelect={handleStarterQuestionSelect}
        suppressEmptyState={suppressEmptyState}
        emptyNotice={emptyCreditQuotaNotice}
        blockingPanel={blockingPanel}
        blockingPanelKey={blockingPanelKey}
        blockingPanelBlocksInput={blockingPanelActive}
        onBlockingPanelReveal={handleScrollToBottom}
        scrollContainerRef={scrollContainerRef}
        contentRef={contentRef}
        onRegenerateMessage={handleRegenerateMessage}
        onForkMessage={
          developmentRole === "preview" || executionBlocked
            ? undefined
            : handleForkMessage
        }
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
        {!executionBlocked && !blockingPanelActive && (
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
            taskStartDisabled={taskStartDisabledByCreditQuota}
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
        {!executionBlocked && !blockingPanelActive && displayGoal && (
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
          showCreditQuotaBlockedCard &&
          exhaustedCreditQuotaKey && (
            <CreditQuotaBlockedCard
              onDismiss={() =>
                setDismissedCreditQuotaBlockKey(exhaustedCreditQuotaKey)
              }
            />
          )}
        {showComposer &&
          !readOnly &&
          !blockingPanelActive &&
          !taskStartDisabledByCreditQuota &&
          !development &&
          (isNew || !isApplicationConversation) &&
          visibleMessages.length === 0 && (
            <ProjectComposerPicker
              value={isNew ? newProjectId : displayConversation.project_id}
              onChange={(projectId) => {
                chooseNewProject(projectId)
                if (!isNew)
                  patchConversationMutation.mutate({ project_id: projectId })
              }}
              disabled={
                sendMutation.isPending ||
                goalStartMutation.isPending ||
                attachmentOperationPending ||
                patchConversationMutation.isPending
              }
            />
          )}
        {showApplicationUnavailableNotice && applicationUnavailableMessage && (
          <Alert
            role="status"
            aria-label={applicationUnavailableMessage}
            className="mx-auto w-full max-w-[var(--app-composer-width)] rounded-[18px] border-[color:var(--app-border)] bg-[var(--app-composer)] shadow-[var(--app-shadow)]"
          >
            <CircleAlertIcon aria-hidden="true" />
            <AlertDescription>{applicationUnavailableMessage}</AlertDescription>
          </Alert>
        )}
        {showConversationComposer && (
          <ConversationDraftComposer
            ref={composerRef}
            voiceTranscriptionAvailability={voiceTranscriptionAvailability}
            key={`${composerInstanceId}:${newTaskResetVersion}`}
            draft={composerValue}
            interactionBlocked={applicationInteractionBlocked}
            unavailableMessage={applicationUnavailableMessage}
            capabilities={availableCapabilities}
            capabilitiesLoading={capabilityQuery.isLoading}
            capabilitiesError={capabilityQuery.isError}
            onRetryCapabilities={() => void capabilityQuery.refetch()}
            selectedIds={selectedCapabilityIds}
            requiredIds={requiredCapabilityIds}
            onSelectedIdsChange={setSelectedCapabilityIds}
            showKnowledgeBaseButton={developmentRole !== "development"}
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
              applicationSubmissionSending ||
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
              (isNew &&
                !isApplicationConversation &&
                modelPreferenceQuery.isError) ||
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
                ? handleModelPreferenceChange
                : undefined
            }
            onSubmit={submitComposer}
            onCompact={startContextCompaction}
            compactAvailable={compactionAvailable}
            compacting={contextCompactionMutation.isPending}
            taskStartDisabled={
              taskStartDisabledByCreditQuota || newProjectResolving
            }
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
            onInterrupt={handleInterrupt}
            onAttach={attachComposerFiles}
            currentConversationId={conversationId ?? undefined}
            onReferenceFile={referenceComposerFile}
            loadAttachmentPreview={loadAttachmentPreview}
            onRemoveAttachment={(file) => void removeComposerAttachment(file)}
            onClearAttachments={clearComposerAttachments}
            onError={setError}
          />
        )}
        {!embedded && !developmentRole && !isApplicationConversation && (
          // 76rem leaves room for the mark beside the centered composer.
          <PoweredByLinkSense className="mr-1 mb-1 hidden justify-self-end md:inline-flex @min-[76rem]/conversation-workspace:absolute @min-[76rem]/conversation-workspace:right-1 @min-[76rem]/conversation-workspace:bottom-1 @min-[76rem]/conversation-workspace:m-0" />
        )}
      </div>

      <ConversationRenameDialog
        open={renameOpen}
        onOpenChange={setRenameOpen}
        value={renameValue}
        onValueChange={setRenameValue}
        pending={patchConversationMutation.isPending}
        onSubmit={(title) => patchConversationMutation.mutate({ title })}
      />

      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title={t("conversation.deleteTitle")}
        description={t(
          developmentRole === "development"
            ? "applicationDevelopment.tests.deleteDevelopmentHint"
            : "conversation.deleteDescription"
        )}
        confirmLabel={t("common.delete")}
        destructive
        pending={deleteMutation.isPending}
        onConfirm={() => deleteMutation.mutate()}
      />
    </ConversationOfficeLayout>
  )
}

const archivedConversationSorts = ["updated_desc", "updated_asc"] as const

export function ArchivedConversationListPage() {
  const { t, i18n } = useTranslation()
  const language = normalizeLanguage(i18n.resolvedLanguage) ?? "zh-CN"
  const queryClient = useQueryClient()
  const projectsQuery = useProjects()
  const [searchParams, setSearchParams] = useSearchParams()
  const search = searchParams.get("search") ?? ""
  const deferredSearch = useDeferredValue(search.trim())
  const sort = readUrlEnum(
    searchParams,
    "sort",
    archivedConversationSorts,
    "updated_desc"
  )
  const parsedProjectId = z
    .string()
    .uuid()
    .safeParse(searchParams.get("project_id"))
  const projectId = parsedProjectId.success ? parsedProjectId.data : null
  const [deleteTarget, setDeleteTarget] = useState<{
    id: string
    title: string
    development: boolean
  } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const dismissError = useCallback((message: string) => {
    setError((current) => (current === message ? null : current))
  }, [])
  const [clearAllOpen, setClearAllOpen] = useState(false)
  const [clearFailures, setClearFailures] = useState<
    z.infer<typeof archivedConversationClearResultSchema>["failed_tasks"]
  >([])
  const [cursor, setCursor] = useState<string | undefined>()
  const [cursorStack, setCursorStack] = useState<(string | undefined)[]>([])
  const updateFilters = (
    updates: Readonly<Record<string, SearchParamUpdate>>
  ) => {
    setCursor(undefined)
    setCursorStack([])
    setSearchParams((current) => updateUrlSearchParams(current, updates), {
      replace: true,
    })
  }
  const query = useQuery({
    queryKey: ["conversations", true, deferredSearch, projectId, sort, cursor],
    queryFn: ({ signal }) =>
      apiRequest("/conversations", {
        schema: paginatedSchema(conversationSchema),
        query: {
          archived: true,
          search: deferredSearch || undefined,
          project_id: projectId ?? undefined,
          sort: sort === "updated_desc" ? undefined : sort,
          cursor,
          limit: 50,
        },
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
    onMutate: () => {
      setClearFailures([])
      return { toastId: notify.loading(t("conversation.clearingArchived")) }
    },
    onSuccess: async (result, _variables, context) => {
      setClearFailures(result.failed_tasks)
      setCursor(undefined)
      setCursorStack([])
      await queryClient.invalidateQueries({ queryKey: ["conversations"] })
      if (result.failed_tasks.length) {
        notify.info(
          t("conversation.clearArchivedPartial", {
            deleted: result.deleted_count,
            remaining: result.failed_tasks.length,
          }),
          { id: context.toastId }
        )
        return
      }
      notify.success(
        t("conversation.clearArchivedSuccess", {
          count: result.deleted_count,
        }),
        { id: context.toastId }
      )
    },
    onError: async (nextError, _variables, context) => {
      await queryClient.invalidateQueries({ queryKey: ["conversations"] })
      notify.error(getErrorMessage(nextError, t), { id: context?.toastId })
    },
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
  const hasFilters = Boolean(deferredSearch) || projectId !== null
  const hasArchivedTasks = archivedCount > 0 || hasFilters
  const sortItems = archivedConversationSorts.map((value) => ({
    value,
    label: t(
      value === "updated_desc"
        ? "conversation.archivedSortNewest"
        : "conversation.archivedSortOldest"
    ),
  }))
  const projectItems = [
    { value: "all", label: t("conversation.archivedAllProjects") },
    ...(projectsQuery.data ?? []).map((project) => ({
      value: project.id,
      label: project.name,
    })),
  ]

  return (
    <PageLayout
      title={t("nav.archived")}
      description={t("settings.archivedDescription")}
      actions={
        hasArchivedTasks ? (
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
        ) : undefined
      }
    >
      <NotificationToast
        message={error}
        variant="error"
        onDismiss={dismissError}
      />
      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center">
        <InputGroup className="w-full sm:min-w-0 sm:flex-1">
          <InputGroupAddon>
            <SearchIcon aria-hidden="true" />
          </InputGroupAddon>
          <SearchInput
            value={search}
            onValueChange={(value) => updateFilters({ search: value })}
            placeholder={t("conversation.archivedSearchPlaceholder")}
            aria-label={t("conversation.archivedSearchPlaceholder")}
          />
        </InputGroup>
        <Select
          items={sortItems}
          value={sort}
          onValueChange={(value) => {
            if (value === null) return
            updateFilters({
              sort: value === "updated_desc" ? null : value,
            })
          }}
        >
          <SelectTrigger
            className="w-full sm:w-40"
            aria-label={t("conversation.archivedSortLabel")}
          >
            <ArrowDownWideNarrowIcon aria-hidden="true" />
            <SelectValue />
          </SelectTrigger>
          <SelectContent align="start">
            <SelectGroup>
              {sortItems.map((item) => (
                <SelectItem key={item.value} value={item.value}>
                  {item.label}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
        <Select
          items={projectItems}
          value={projectId ?? "all"}
          onValueChange={(value) => {
            if (value === null) return
            updateFilters({ project_id: value === "all" ? null : value })
          }}
        >
          <SelectTrigger
            className="w-full sm:w-48"
            aria-label={t("conversation.archivedProjectLabel")}
          >
            <FolderIcon aria-hidden="true" />
            <SelectValue />
          </SelectTrigger>
          <SelectContent align="start">
            <SelectGroup>
              {projectItems.map((item) => (
                <SelectItem key={item.value} value={item.value}>
                  {item.label}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
      </div>
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
        <EmptyState
          title={t(
            hasFilters
              ? "conversation.archivedSearchEmpty"
              : "conversation.archivedEmpty"
          )}
        />
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
              const clearFailure = clearFailures.find(
                (failure) => failure.conversation_id === conversation.id
              )
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
                      <div className="flex min-w-0 items-center gap-2">
                        <ConversationDevelopmentIcon
                          role={conversation.application_development_role}
                        />
                        <span className="archived-conversation-title">
                          {displayTitle}
                        </span>
                      </div>
                      {clearFailure && (
                        <p className="text-sm text-destructive" role="status">
                          {clearFailure.error_code === "CONFLICT"
                            ? t("conversation.clearArchivedBusy")
                            : getErrorMessage(
                                new ApiError({
                                  status: 409,
                                  errorCode: clearFailure.error_code,
                                }),
                                t
                              )}
                        </p>
                      )}
                      <time dateTime={conversation.updated_at}>
                        {formatLongDateTime(conversation.updated_at, language)}
                      </time>
                    </div>
                    <div className="archived-conversation-actions">
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        aria-label={deleteLabel}
                        title={deleteLabel}
                        disabled={deleteMutation.isPending}
                        onClick={() =>
                          setDeleteTarget({
                            id: conversation.id,
                            title: displayTitle,
                            development:
                              conversation.application_development_role ===
                              "development",
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
                        size="default"
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
        description={t(
          deleteTarget?.development
            ? "applicationDevelopment.tests.deleteDevelopmentHint"
            : "conversation.deleteDescription"
        )}
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
        onConfirm={() => {
          setClearAllOpen(false)
          clearArchivedMutation.mutate()
        }}
      />
    </PageLayout>
  )
}
