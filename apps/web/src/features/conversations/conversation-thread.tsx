import {
  Children,
  createContext,
  memo,
  useCallback,
  useEffect,
  useContext,
  useId,
  isValidElement,
  useMemo,
  useRef,
  useState,
  type ComponentPropsWithoutRef,
  type ReactNode,
  type Ref,
} from "react"
import {
  coreMcpServerKey,
  officeAnnotationDisplaySchema,
  type OfficeAnnotationDisplay,
} from "@linksense/shared"
import type { TFunction } from "i18next"
import {
  ArrowRightIcon,
  BoxIcon,
  CheckIcon,
  BookOpenIcon,
  BookOpenTextIcon,
  ChartNoAxesCombinedIcon,
  ChevronRightIcon,
  CircleCheckIcon,
  CircleAlertIcon,
  CodeIcon,
  CopyIcon,
  DownloadIcon,
  EyeIcon,
  FileTextIcon,
  ImageOffIcon,
  LoaderCircleIcon,
  Maximize2Icon,
  PencilIcon,
  PresentationIcon,
  GoalIcon,
  GitForkIcon,
  SparklesIcon,
  WifiIcon,
  WrenchIcon,
} from "lucide-react"
import ReactMarkdown, { type Components } from "react-markdown"
import { useTranslation } from "react-i18next"
import { Link } from "react-router-dom"
import {
  parseMarkdownIntoBlocks,
  Streamdown,
  type BlockProps,
  type StreamdownProps,
} from "streamdown"

import type {
  CapabilitySummary,
  Conversation,
  ConversationActivity,
  ConversationEvent,
  ConversationFile,
  ConversationMessage,
  ConversationTurn,
  ConversationUserInputRequest,
  ModelPreference,
  NativeCodexItem,
  NativeSubAgentSummary,
  ThreadGoal,
} from "@/api/contracts"
import {
  formatFirstPartyCapabilityName,
  useProductName,
} from "@/app/product-branding"
import {
  TurnActivityItem,
  type TurnActivitySource,
} from "@/features/conversations/turn-activity-item"
import { getConversationMessageAnchorId } from "@/features/conversations/conversation-message-anchor"
import {
  ConversationMessageList,
  type ConversationMessageRow,
  type ConversationThreadNavigation,
  type ConversationHistoryControl,
} from "@/features/conversations/conversation-message-list"
import { ConversationForkSourceMarker } from "@/features/conversations/conversation-fork-source-marker"
import { AssistantHtmlPreviewLoading } from "@/features/conversations/assistant-html-preview-loading"
import {
  NativeSubAgentActivityGroup,
  NativeSubAgentActivityItem,
} from "@/features/conversations/native-activity-item"
import {
  buildNativeActivityViewModel,
  isKnowledgeSearchNativeItem,
} from "@/features/conversations/native-activity-view-model"
import {
  buildNativeSubAgentActivityViewModels,
  type NativeSubAgentActivityViewModel,
  type NativeSubAgentViewModel,
} from "@/features/conversations/native-subagent-activity"
import type { NativeReconnectDisplayState } from "@/features/conversations/native-reconnect-simulation"
import { getNativeCodexPayload } from "@/api/contracts"
import { CapabilityIcon } from "@/components/capabilities/capability-icon"
import { capabilityPresentation } from "@/features/capabilities/built-in-presentation"
import { EmptyState } from "@/components/feedback/page-state"
import { FileTypeIcon } from "@/components/media/file-type-icon"
import {
  ImagePreviewDialog,
  type ImagePreviewItem,
} from "@/components/media/image-preview"
import { Badge, badgeVariants } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import { Marker, MarkerContent, MarkerIcon } from "@/components/ui/marker"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@/components/ui/hover-card"
import { Table } from "@/components/ui/table"
import { Textarea } from "@/components/ui/textarea"
import {
  ActionTooltipContent,
  Tooltip,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import {
  ConversationArtifactFiles,
  type ArtifactPreviewSource,
} from "@/features/conversations/conversation-artifact-files"
import { isPreviewableConversationImage } from "@/features/conversations/conversation-attachment-preview-utils"
import { ConversationAttachmentPreviews } from "@/features/conversations/conversation-attachment-previews"
import {
  ConversationAttachmentOverflow,
  type ConversationAttachmentOverflowItem,
} from "@/features/conversations/conversation-attachment-overflow"
import {
  getConversationFilePreviewKind,
  getConversationFilePreviewLabelKey,
} from "@/features/conversations/conversation-file-preview"
import { ConversationTimeSeparator } from "@/features/conversations/conversation-time-separator"
import { shouldShowConversationTimeSeparator } from "@/features/conversations/conversation-time-separator-utils"
import {
  getConversationMessageDisplayText,
  isStructuredUserMessage,
} from "@/features/conversations/conversation-message-display"
import { ConversationUserMessageText } from "@/features/conversations/conversation-user-message-text"
import { ConversationUserInputRequestCard } from "@/features/conversations/conversation-user-input-request-card"
import {
  shouldDisplayConversationActivity,
  shouldDisplayNativeActivity,
} from "@/features/conversations/activity-visibility"
import { AssistantMarkdownImage } from "@/features/conversations/assistant-markdown-image"
import {
  AssistantHtmlPreview,
  AssistantHtmlPreviewPending,
} from "@/features/conversations/assistant-html-preview"
import { AssistantKnowledgeImage } from "@/features/conversations/assistant-knowledge-image"
import { SiteLink } from "@/features/conversations/site-link"
import { getKnowledgeCitationPreview } from "@/features/knowledge-bases/knowledge-base-api"
import { KnowledgeCitationExcerpt } from "@/features/knowledge-bases/knowledge-markdown"
import {
  assistantMarkdownUrlTransform,
  collectInlineArtifactIds,
  getInlineArtifactId,
  getKnowledgeAssetId,
  getSafeAssistantMarkdownLinkUrl,
  isInlineArtifactUrl,
  isKnowledgeAssetUrl,
} from "@/features/conversations/assistant-markdown-image-utils"
import { OfficeAnnotationCard } from "@/features/conversations/office-annotation-card"
import {
  normalizeAssistantMessageContent,
  parseAssistantProposedPlanSourceSegments,
} from "@/features/conversations/assistant-message-content"
import { assistantMarkdownPlugins } from "@/features/conversations/assistant-markdown-plugins"
import { ConversationPlanCard } from "@/features/conversations/conversation-plan-card"
import { ConversationProposedPlanCard } from "@/features/conversations/conversation-proposed-plan-card"
import {
  formatGoalDuration,
  projectGoalElapsedSeconds,
} from "@/features/conversations/conversation-goal-utils"
import { useGoalClockNow } from "@/features/conversations/conversation-goal-clock"
import {
  getKnowledgeCitationNumberFromFragment,
  getKnowledgeCitationPreviewPath,
  remarkKnowledgeCitations,
} from "@/features/conversations/knowledge-citation-markdown"
import { stripKnowledgeSourceMarkers } from "@/features/conversations/knowledge-source-markers"
import {
  selectConversationTurnPlan,
  type ConversationTurnPlan,
} from "@/features/conversations/conversation-plan-selector"
import {
  normalizeAssistantMarkdown,
  prepareStreamingAssistantMarkdown,
} from "@/features/conversations/streaming-markdown"
import type { StreamingReasoningSummaries } from "@/features/conversations/streaming-reasoning-summaries"
import { selectReasoningActivitySummary } from "@/features/conversations/reasoning-activity-summary"
import { normalizeLanguage } from "@/i18n"
import { getPublicRuntimeMessage } from "@/lib/public-copy"
import {
  formatCompactDuration,
  formatDateTime,
  formatFileSize,
  formatMessageTime,
} from "@/i18n/date"
import { cn } from "@/lib/utils"
import { shouldAutoFocusOnDesktop } from "@/lib/responsive"
import type { KnowledgeBase } from "@/features/knowledge-bases/knowledge-base-contracts"

type ApplicationKnowledgeBase = Readonly<{
  id: string
  name: string
}>

const emptyKnowledgeBases: KnowledgeBase[] = []
const emptyApplicationKnowledgeBases: readonly ApplicationKnowledgeBase[] = []
const emptyModelCatalog: ModelPreference["models"] = []
const emptyLiveReasoningSummaries: StreamingReasoningSummaries = {}

const newTaskStarterQuestions = [
  {
    id: "analyzeFile",
    icon: FileTextIcon,
    tone: "file",
    titleKey: "conversation.starterQuestions.analyzeFile.title",
    descriptionKey: "conversation.starterQuestions.analyzeFile.description",
    promptKey: "conversation.starterQuestions.analyzeFile.prompt",
  },
  {
    id: "searchKnowledge",
    icon: BookOpenTextIcon,
    tone: "knowledge",
    titleKey: "conversation.starterQuestions.searchKnowledge.title",
    descriptionKey: "conversation.starterQuestions.searchKnowledge.description",
    promptKey: "conversation.starterQuestions.searchKnowledge.prompt",
  },
  {
    id: "analyzeData",
    icon: ChartNoAxesCombinedIcon,
    tone: "data",
    titleKey: "conversation.starterQuestions.analyzeData.title",
    descriptionKey: "conversation.starterQuestions.analyzeData.description",
    promptKey: "conversation.starterQuestions.analyzeData.prompt",
  },
  {
    id: "createDeliverable",
    icon: PresentationIcon,
    tone: "deliverable",
    titleKey: "conversation.starterQuestions.createDeliverable.title",
    descriptionKey:
      "conversation.starterQuestions.createDeliverable.description",
    promptKey: "conversation.starterQuestions.createDeliverable.prompt",
  },
] as const

function NewTaskStarterQuestions({
  onSelect,
}: Readonly<{
  onSelect: (prompt: string) => void
}>) {
  const { t } = useTranslation()

  return (
    <div
      className="conversation-starter-questions"
      role="group"
      aria-label={t("conversation.starterQuestions.label")}
    >
      {newTaskStarterQuestions.map((question) => {
        const QuestionIcon = question.icon
        return (
          <Button
            key={question.id}
            type="button"
            variant="outline"
            className="conversation-starter-question"
            onClick={() => onSelect(t(question.promptKey))}
          >
            <span
              className="conversation-starter-question-icon"
              data-tone={question.tone}
              aria-hidden="true"
            >
              <QuestionIcon data-icon="inline-start" strokeWidth={1.9} />
            </span>
            <span className="conversation-starter-question-copy">
              <span className="conversation-starter-question-title">
                {t(question.titleKey)}
              </span>
              <span className="conversation-starter-question-description">
                {t(question.descriptionKey)}
              </span>
            </span>
          </Button>
        )
      })}
    </div>
  )
}

function ConversationEmptyNotice({
  children,
}: Readonly<{
  children: ReactNode
}>) {
  return (
    <div className="conversation-empty-notice" role="alert">
      <CircleAlertIcon aria-hidden="true" />
      <span>{children}</span>
    </div>
  )
}

function FileTile({
  file,
  artifact,
  onDownload,
  downloading,
}: {
  file: ConversationFile
  artifact?: boolean
  onDownload?: (file: ConversationFile) => void
  downloading?: boolean
}) {
  const { t, i18n } = useTranslation()
  const language = normalizeLanguage(i18n.resolvedLanguage) ?? "zh-CN"
  const label = artifact
    ? t("conversation.downloadArtifact", { name: file.name })
    : file.name
  return (
    <Button
      type="button"
      variant="ghost"
      className={
        artifact ? "artifact-tile file-tile" : "attachment-tile file-tile"
      }
      aria-label={label}
      aria-busy={downloading || undefined}
      disabled={artifact && (!file.download_available || downloading)}
      onClick={() => artifact && onDownload?.(file)}
    >
      <span className="file-icon">
        <FileTypeIcon filename={file.name} mimeType={file.mime_type} />
      </span>
      <span className="min-w-0 flex-1 text-left">
        <span className="file-tile-name block truncate font-medium">
          {file.name}
        </span>
        <span className="file-tile-meta block pt-0.5 text-[var(--app-muted)]">
          {[
            formatFileSize(file.size, language),
            artifact ? null : formatDateTime(file.created_at, language),
          ]
            .filter((value) => value && value !== "—")
            .join(" · ")}
        </span>
      </span>
      {artifact &&
        (downloading ? (
          <LoaderCircleIcon
            className="size-4 animate-spin text-[var(--app-muted)]"
            aria-hidden="true"
          />
        ) : (
          <DownloadIcon
            className="size-4 text-[var(--app-muted)]"
            aria-hidden="true"
          />
        ))}
    </Button>
  )
}

type LoadArtifactPreview = (
  file: ConversationFile,
  signal: AbortSignal
) => Promise<ArtifactPreviewSource>

type LoadAttachmentPreview = (
  file: ConversationFile,
  signal: AbortSignal
) => Promise<Blob>

function UserMessageAttachments({
  files,
  loadPreview,
  onPreviewImage,
  onPreviewFile,
}: {
  files: readonly ConversationFile[] | undefined
  loadPreview?: LoadAttachmentPreview
  onPreviewImage?: (item: ImagePreviewItem) => void
  onPreviewFile?: (file: ConversationFile) => void
}) {
  const { t } = useTranslation()
  if (!files?.length) return null

  const visibleFiles = files.length > 2 ? files.slice(0, 2) : files
  const hiddenCount = files.length - visibleFiles.length
  const previewImages = loadPreview
    ? visibleFiles.filter(isPreviewableConversationImage)
    : []
  const fileAttachments = visibleFiles.filter(
    (file) => !loadPreview || !isPreviewableConversationImage(file)
  )
  const overflowItems: ConversationAttachmentOverflowItem[] = files.map(
    (file) => ({
      key: `user-message-attachment-${file.id}`,
      status: "uploaded",
      name: file.name,
      size: file.size,
      mimeType: file.mime_type,
      file,
    })
  )

  return (
    <div className="user-message-attachments">
      {previewImages.length > 0 && loadPreview && (
        <div className="user-message-attachment-images">
          <ConversationAttachmentPreviews
            files={previewImages}
            loadPreview={loadPreview}
            onPreviewImage={onPreviewImage}
            onPreviewFile={onPreviewFile}
          />
        </div>
      )}
      {fileAttachments.length > 0 && (
        <div className="user-message-attachment-files">
          {fileAttachments.map((file) => {
            const previewKind = getConversationFilePreviewKind(file)
            const previewable = onPreviewFile && previewKind !== null
            const content = (
              <>
                <span className="user-message-file-attachment-icon">
                  <FileTypeIcon
                    filename={file.name}
                    mimeType={file.mime_type}
                  />
                </span>
                <span className="user-message-file-attachment-name">
                  {file.name}
                </span>
              </>
            )

            return previewable ? (
              <Button
                key={file.id}
                type="button"
                variant="ghost"
                className="user-message-file-attachment user-message-file-attachment-previewable"
                aria-label={t(getConversationFilePreviewLabelKey(file), {
                  name: file.name,
                })}
                onClick={() => onPreviewFile(file)}
              >
                {content}
              </Button>
            ) : (
              <div key={file.id} className="user-message-file-attachment">
                {content}
              </div>
            )
          })}
        </div>
      )}
      <ConversationAttachmentOverflow
        items={overflowItems}
        hiddenCount={hiddenCount}
        triggerClassName="user-message-file-attachment user-message-attachment-overflow-trigger"
        side="bottom"
      />
    </div>
  )
}

type UserMessageSelection =
  | Readonly<{
      key: string
      kind: "capability"
      name: string
      type: "plugin" | "skill"
      logoUrl?: string | null
    }>
  | Readonly<{
      key: string
      kind: "knowledge_base"
      name: string
    }>

function UserMessageSelectionIcon({
  selection,
}: {
  selection: UserMessageSelection
}) {
  return selection.kind === "capability" ? (
    <CapabilityIcon
      type={selection.type}
      logoUrl={selection.logoUrl}
      className="user-message-capability-icon"
    />
  ) : (
    <BookOpenIcon className="user-message-capability-icon" aria-hidden="true" />
  )
}

function UserMessageSelectionBadge({
  selection,
}: {
  selection: UserMessageSelection
}) {
  return (
    <Badge
      variant="outline"
      className="user-message-capability"
      title={selection.name}
    >
      <UserMessageSelectionIcon selection={selection} />
      <span className="user-message-capability-label min-w-0 truncate">
        {selection.name}
      </span>
    </Badge>
  )
}

function UserMessageSelections({
  capabilities,
  capabilitiesById,
  knowledgeBaseIds,
  knowledgeBaseNamesById,
  applicationManagedLabel,
  label,
  overflowLabel,
  overflowListLabel,
  unavailableLabel,
}: {
  capabilities: ConversationMessage["selected_capabilities"]
  capabilitiesById: ReadonlyMap<string, CapabilitySummary>
  knowledgeBaseIds: ConversationMessage["selected_knowledge_base_ids"]
  knowledgeBaseNamesById: ReadonlyMap<string, string>
  applicationManagedLabel?: string
  label: string
  overflowLabel: (count: number) => string
  overflowListLabel: string
  unavailableLabel: string
}) {
  const { t } = useTranslation()
  const productName = useProductName()
  const selections: UserMessageSelection[] = [
    ...(capabilities ?? []).map((capability) => {
      const available = capabilitiesById.get(capability.id)
      return {
        key: `capability-${capability.id}`,
        kind: "capability" as const,
        name: available
          ? capabilityPresentation(available, t, productName).name
          : capability.name,
        type: capability.type,
        logoUrl: available?.logo_url,
      }
    }),
    ...(knowledgeBaseIds ?? []).map((id) => ({
      key: `knowledge-base-${id}`,
      kind: "knowledge_base" as const,
      name:
        knowledgeBaseNamesById.get(id) ??
        applicationManagedLabel ??
        unavailableLabel,
    })),
  ]
  if (selections.length === 0) return null

  const visibleSelections = selections.slice(0, 2)
  const overflowSelections = selections.slice(2)

  return (
    <div className="user-message-capabilities" aria-label={label}>
      {visibleSelections.map((selection) => (
        <UserMessageSelectionBadge key={selection.key} selection={selection} />
      ))}
      {overflowSelections.length > 0 && (
        <HoverCard>
          <HoverCardTrigger
            type="button"
            className={cn(
              badgeVariants({ variant: "outline" }),
              "user-message-capability user-message-capability-overflow"
            )}
            aria-label={overflowLabel(overflowSelections.length)}
          >
            +{overflowSelections.length}
          </HoverCardTrigger>
          <HoverCardContent
            side="bottom"
            align="end"
            aria-label={overflowListLabel}
          >
            <ul
              className="flex list-none flex-col gap-1"
              aria-label={overflowListLabel}
            >
              {overflowSelections.map((selection) => (
                <li
                  key={selection.key}
                  className="flex min-w-0 items-center gap-2 rounded-lg px-2 py-1.5"
                >
                  <UserMessageSelectionIcon selection={selection} />
                  <span className="user-message-capability-label min-w-0 truncate">
                    {selection.name}
                  </span>
                </li>
              ))}
            </ul>
          </HoverCardContent>
        </HoverCard>
      )}
    </div>
  )
}

function ArtifactFiles({
  files,
  loadPreview,
  onPreviewOfficeDocument,
  onDownload,
  downloadingFileId,
}: {
  files: readonly ConversationFile[] | undefined
  loadPreview?: LoadArtifactPreview
  onPreviewOfficeDocument?: (file: ConversationFile) => void
  onDownload: (file: ConversationFile) => void
  downloadingFileId?: string
}) {
  if (!files?.length) return null

  return (
    <ConversationArtifactFiles
      files={files}
      loadPreview={loadPreview}
      onPreviewOfficeDocument={onPreviewOfficeDocument}
      onDownload={onDownload}
      downloadingFileId={downloadingFileId}
      renderFallback={(file) => (
        <FileTile
          file={file}
          artifact
          downloading={downloadingFileId === file.id}
          onDownload={onDownload}
        />
      )}
    />
  )
}

function CapabilityTrace({
  label,
  values,
}: {
  label: string
  values: CapabilitySummary[] | undefined
}) {
  if (!values?.length) return null
  return (
    <Marker className="capability-trace-row conversation-marker">
      <MarkerContent className="capability-trace-content">
        <span>{label}</span>
        <span className="capability-trace-values">
          {values.map((value) => (
            <span key={value.id} className="trace-chip">
              {value.name}
            </span>
          ))}
        </span>
      </MarkerContent>
    </Marker>
  )
}

function collapseActivityLifecycle(activities: ConversationActivity[]) {
  const uniqueActivities = [
    ...new Map(activities.map((activity) => [activity.id, activity])).values(),
  ]
  const latestIndexByItemId = new Map<string, number>()
  uniqueActivities.forEach((activity, index) => {
    if (activity.item_id) latestIndexByItemId.set(activity.item_id, index)
  })
  return uniqueActivities.filter(
    (activity, index) =>
      !activity.item_id || latestIndexByItemId.get(activity.item_id) === index
  )
}

function isRunningConversationActivity(activity: ConversationActivity) {
  return (
    activity.status === "running" ||
    activity.type === "tool_started" ||
    activity.type === "step_started"
  )
}

type MarkdownCopyButtonProps = Readonly<{
  getContent: () => string
  copyLabel: string
  copiedLabel: string
}>

function MarkdownCopyButton({
  getContent,
  copyLabel,
  copiedLabel,
}: MarkdownCopyButtonProps) {
  const { t } = useTranslation()
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">(
    "idle"
  )

  useEffect(() => {
    if (copyState !== "copied") return
    const timer = window.setTimeout(() => setCopyState("idle"), 1_500)
    return () => window.clearTimeout(timer)
  }, [copyState])

  const label =
    copyState === "copied"
      ? copiedLabel
      : copyState === "failed"
        ? t("conversation.copyContentFailed")
        : copyLabel

  const copyContent = async () => {
    const copied = await copyTextToClipboard(getContent())
    setCopyState(copied ? "copied" : "failed")
  }

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-xs"
      className="markdown-copy-button"
      data-copy-state={copyState}
      aria-label={label}
      aria-live="polite"
      title={label}
      onClick={() => void copyContent()}
    >
      {copyState === "copied" ? (
        <CheckIcon strokeWidth={1.7} aria-hidden="true" />
      ) : (
        <CopyIcon strokeWidth={1.7} aria-hidden="true" />
      )}
    </Button>
  )
}

function MarkdownCodeBlock({
  children,
  ...props
}: ComponentPropsWithoutRef<"pre">) {
  const { t } = useTranslation()
  const { streaming } = useContext(AssistantMarkdownAssetContext)
  const preRef = useRef<HTMLPreElement>(null)
  const [htmlCodeView, setHtmlCodeView] = useState<
    Readonly<{ source: string | null; mode: "code" | "preview" }>
  >({ source: null, mode: "code" })
  const htmlPreviewSource = getAssistantHtmlPreviewSource(children)
  const htmlCodeSource = getAssistantHtmlCodeSource(children)
  const canPreviewHtmlCode = !streaming && htmlCodeSource !== null
  const htmlCodeMode =
    htmlCodeView.source === htmlCodeSource ? htmlCodeView.mode : "code"
  const showHtmlCodePreview = canPreviewHtmlCode && htmlCodeMode === "preview"

  const codeBlock = (
    <div
      className={cn(
        "markdown-copy-block markdown-copy-block-code",
        canPreviewHtmlCode && "markdown-copy-block-code-previewable"
      )}
    >
      {canPreviewHtmlCode && (
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          className="markdown-preview-button"
          aria-label={t("conversation.previewHtmlCode")}
          title={t("conversation.previewHtmlCode")}
          onClick={() =>
            setHtmlCodeView({ source: htmlCodeSource, mode: "preview" })
          }
        >
          <EyeIcon strokeWidth={1.7} aria-hidden="true" />
        </Button>
      )}
      <MarkdownCopyButton
        copyLabel={t("conversation.copyCode")}
        copiedLabel={t("conversation.codeCopied")}
        getContent={() =>
          (preRef.current?.textContent ?? "").replace(/\n$/u, "")
        }
      />
      <pre {...props} ref={preRef}>
        {children}
      </pre>
    </div>
  )
  if (htmlPreviewSource !== null) {
    if (streaming) return <AssistantHtmlPreviewPending />
    return <AssistantHtmlPreview html={htmlPreviewSource} />
  }
  if (showHtmlCodePreview && htmlCodeSource !== null) {
    return (
      <div className="markdown-html-code-preview">
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          className="markdown-html-code-toggle-button"
          aria-label={t("conversation.showHtmlCode")}
          title={t("conversation.showHtmlCode")}
          onClick={() =>
            setHtmlCodeView({ source: htmlCodeSource, mode: "code" })
          }
        >
          <CodeIcon strokeWidth={1.7} aria-hidden="true" />
        </Button>
        <AssistantHtmlPreview html={htmlCodeSource} />
      </div>
    )
  }
  return codeBlock
}

function getReactNodeText(node: ReactNode): string {
  return Children.toArray(node)
    .map((child) => {
      if (typeof child === "string" || typeof child === "number") {
        return String(child)
      }
      if (!isValidElement<{ children?: ReactNode }>(child)) return ""
      return getReactNodeText(child.props.children)
    })
    .join("")
}

function getAssistantHtmlPreviewSource(children: ReactNode) {
  return getMarkdownCodeTextForLanguages(children, ["html-preview"])
}

function getAssistantHtmlCodeSource(children: ReactNode) {
  return getMarkdownCodeTextForLanguages(children, ["html", "htm"])
}

function getMarkdownCodeTextForLanguages(
  children: ReactNode,
  languages: readonly string[]
) {
  const codeChildren = Children.toArray(children)
  if (codeChildren.length !== 1) return null
  const code = codeChildren[0]
  if (
    !isValidElement<{
      className?: string
      children?: ReactNode
    }>(code)
  ) {
    return null
  }
  const languageClasses = code.props.className
    ?.split(/\s+/u)
    .map((className) => className.toLowerCase())
  if (
    !languageClasses?.some((className) =>
      languages.some((language) => className === `language-${language}`)
    )
  ) {
    return null
  }
  return getReactNodeText(code.props.children).replace(/\n$/u, "")
}

function hasAssistantHtmlPreviewFence(content: string) {
  return /(?:^|\n)[\t ]{0,3}`{3,}html-preview[\t ]*(?:\r?\n|$)/u.test(content)
}

function hasAssistantHtmlCodePreviewableContent(content: string) {
  return hasAssistantHtmlCodeFence(
    normalizeStandaloneHtmlSourceMarkdown(content)
  )
}

function hasAssistantHtmlCodeFence(content: string) {
  return /(?:^|\n)[\t ]{0,3}`{3,}(?:html|htm)[\t ]*(?:\r?\n|$)/iu.test(content)
}

function getTableClipboardText(table: HTMLTableElement | null) {
  if (!table) return ""
  return Array.from(table.rows)
    .map((row) =>
      Array.from(row.cells)
        .map((cell) => (cell.textContent ?? "").replace(/\s+/gu, " ").trim())
        .join("\t")
    )
    .join("\n")
}

type MarkdownTableScrollState = Readonly<{
  atEnd: boolean
  atStart: boolean
  overflowing: boolean
}>

const initialMarkdownTableScrollState: MarkdownTableScrollState = {
  atEnd: true,
  atStart: true,
  overflowing: false,
}

function MarkdownTable({
  children,
  ...props
}: ComponentPropsWithoutRef<"table">) {
  const { t } = useTranslation()
  const tableRef = useRef<HTMLTableElement>(null)
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const [expanded, setExpanded] = useState(false)
  const [scrollState, setScrollState] = useState<MarkdownTableScrollState>(
    initialMarkdownTableScrollState
  )
  const updateScrollState = useCallback(() => {
    const container = scrollContainerRef.current
    if (!container) return
    const remainingScroll = container.scrollWidth - container.clientWidth
    const nextState: MarkdownTableScrollState = {
      overflowing: remainingScroll > 1,
      atStart: container.scrollLeft <= 1,
      atEnd: container.scrollLeft >= remainingScroll - 1,
    }
    setScrollState((current) =>
      current.overflowing === nextState.overflowing &&
      current.atStart === nextState.atStart &&
      current.atEnd === nextState.atEnd
        ? current
        : nextState
    )
  }, [])

  useEffect(() => {
    updateScrollState()
    const container = scrollContainerRef.current
    const table = tableRef.current
    if (!container || typeof ResizeObserver === "undefined") return
    const resizeObserver = new ResizeObserver(updateScrollState)
    resizeObserver.observe(container)
    if (table) resizeObserver.observe(table)
    return () => resizeObserver.disconnect()
  }, [children, updateScrollState])

  const getClipboardContent = useCallback(
    () => getTableClipboardText(tableRef.current),
    []
  )

  return (
    <>
      <div
        className="markdown-copy-block markdown-copy-block-table"
        data-table-overflow={scrollState.overflowing}
        data-table-scroll-end={scrollState.atEnd}
        data-table-scroll-start={scrollState.atStart}
      >
        <div className="markdown-table-scroll-shell">
          <div
            className="markdown-table-toolbar"
            role="toolbar"
            aria-label={t("conversation.tableActions")}
          >
            <span className="markdown-table-scroll-hint">
              {t("conversation.tableScrollHint")}
            </span>
            <div className="markdown-table-actions">
              <MarkdownCopyButton
                copyLabel={t("conversation.copyTable")}
                copiedLabel={t("conversation.tableCopied")}
                getContent={getClipboardContent}
              />
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                className="markdown-table-expand-button"
                aria-label={t("conversation.expandTable")}
                title={t("conversation.expandTable")}
                onClick={() => setExpanded(true)}
              >
                <Maximize2Icon
                  data-icon="inline-start"
                  strokeWidth={1.7}
                  aria-hidden="true"
                />
              </Button>
            </div>
          </div>
          <Table
            {...props}
            ref={tableRef}
            className="markdown-responsive-table"
            containerClassName="markdown-table-scroll"
            containerRef={scrollContainerRef}
            containerProps={{
              "aria-label": t("conversation.scrollTable"),
              onScroll: updateScrollState,
              tabIndex: scrollState.overflowing ? 0 : undefined,
            }}
          >
            {children}
          </Table>
        </div>
      </div>
      <Dialog open={expanded} onOpenChange={setExpanded}>
        {expanded && (
          <DialogContent
            className="markdown-table-dialog flex h-[min(820px,calc(100dvh-2rem))] max-w-[calc(100vw-2rem)] flex-col gap-4 overflow-hidden sm:max-w-6xl"
            closeLabel={t("common.close")}
          >
            <DialogHeader className="markdown-table-dialog-header min-w-0 pr-10">
              <DialogTitle>{t("conversation.tableDialogTitle")}</DialogTitle>
              <DialogDescription>
                {t("conversation.tableDialogDescription")}
              </DialogDescription>
            </DialogHeader>
            <Table
              {...props}
              className="markdown-responsive-table"
              containerClassName="markdown-table-dialog-scroll min-h-0 flex-1 overscroll-contain"
              containerProps={{
                "aria-label": t("conversation.scrollExpandedTable"),
                tabIndex: 0,
              }}
            >
              {children}
            </Table>
          </DialogContent>
        )}
      </Dialog>
    </>
  )
}

type MarkdownElementNode = Readonly<{
  type: "element"
  tagName: string
  properties?: unknown
}>

type MarkdownTextNode = Readonly<{
  type: "text"
  value?: string
}>

function isMarkdownElementNode(node: unknown): node is MarkdownElementNode {
  if (!node || typeof node !== "object") return false

  const candidate = node as {
    type?: unknown
    tagName?: unknown
  }
  return candidate.type === "element" && typeof candidate.tagName === "string"
}

function isMarkdownTextNode(node: unknown): node is MarkdownTextNode {
  if (!node || typeof node !== "object") return false

  const candidate = node as {
    type?: unknown
    value?: unknown
  }
  return (
    candidate.type === "text" &&
    (candidate.value === undefined || typeof candidate.value === "string")
  )
}

function getMarkdownStringProperty(
  properties: unknown,
  name: string
): string | undefined {
  if (!properties || typeof properties !== "object") return undefined
  const value = (properties as Record<string, unknown>)[name]
  return typeof value === "string" ? value : undefined
}

const standaloneExternalSourceLabelPattern =
  /^(?:官方来源|参考来源|资料来源|信息来源|来源|出处|参考链接|相关链接|sources?|references?|reference links?|related links?)[:：]?$/iu
const proseUrlTerminatorPattern = /[\s，。；：！？、]/u
const urlAlwaysTrimmedTrailingCharacters = new Set([
  ",",
  "，",
  ".",
  "。",
  ";",
  "；",
  ":",
  "：",
  "!",
  "！",
  "?",
  "？",
  "、",
  '"',
  "”",
  "’",
  "'",
  "`",
])

function hasStackedExternalSourceLinks(
  node: Readonly<{ children?: readonly unknown[] }> | undefined
) {
  const children = node?.children ?? []
  let externalLinkCount = 0
  let lineBreakCount = 0
  let textOutsideLinks = ""

  for (const child of children) {
    if (isMarkdownTextNode(child)) {
      textOutsideLinks += child.value ?? ""
      continue
    }

    if (!isMarkdownElementNode(child)) return false

    if (child.tagName === "br") {
      lineBreakCount += 1
      continue
    }

    const href = getMarkdownStringProperty(child.properties, "href")
    if (child.tagName === "a" && href && /^https?:\/\//iu.test(href)) {
      externalLinkCount += 1
    }
  }

  if (externalLinkCount < 2 || lineBreakCount === 0) return false

  const visibleTextOutsideLinks = textOutsideLinks.replace(/\s+/gu, " ").trim()
  return (
    visibleTextOutsideLinks.length === 0 ||
    standaloneExternalSourceLabelPattern.test(visibleTextOutsideLinks)
  )
}

type AssistantMarkdownLinkSplit = Readonly<{
  href: string
  label: string
  trailingText: string
}>

function getSingleTextChild(children: ReactNode): string | null {
  const childItems = Children.toArray(children)
  return childItems.length === 1 && typeof childItems[0] === "string"
    ? childItems[0]
    : null
}

function countCharacter(value: string, character: string): number {
  let count = 0
  for (const item of value) {
    if (item === character) count += 1
  }
  return count
}

function trimUrlTrailingPunctuation(value: string): string {
  let result = value
  while (result) {
    const character = Array.from(result).at(-1)
    if (!character) return result

    if (urlAlwaysTrimmedTrailingCharacters.has(character)) {
      result = result.slice(0, -character.length)
      continue
    }

    if (
      (character === ")" &&
        countCharacter(result, ")") > countCharacter(result, "(")) ||
      (character === "）" &&
        countCharacter(result, "）") > countCharacter(result, "（"))
    ) {
      result = result.slice(0, -character.length)
      continue
    }

    return result
  }
  return result
}

function isUnbalancedClosingUrlCharacter(prefix: string, character: string) {
  if (character === ")") {
    return countCharacter(prefix, ")") >= countCharacter(prefix, "(")
  }
  if (character === "）") {
    return countCharacter(prefix, "）") >= countCharacter(prefix, "（")
  }
  return false
}

function extractLeadingExternalUrlText(value: string) {
  if (!/^https?:\/\//iu.test(value)) return null

  let end = value.length
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index]!
    if (proseUrlTerminatorPattern.test(character)) {
      end = index
      break
    }
    if (
      (character === ")" || character === "）") &&
      isUnbalancedClosingUrlCharacter(value.slice(0, index), character)
    ) {
      end = index
      break
    }
  }

  const label = trimUrlTrailingPunctuation(value.slice(0, end))
  if (!label || label === value) return null

  return {
    label,
    trailingText: value.slice(label.length),
  }
}

function splitAssistantMarkdownLinkText(
  href: string,
  children: ReactNode
): AssistantMarkdownLinkSplit | null {
  const text = getSingleTextChild(children)
  if (!text) return null

  const directTrailingText = text.startsWith(href)
    ? text.slice(href.length)
    : ""
  if (directTrailingText) {
    return {
      href,
      label: href,
      trailingText: directTrailingText,
    }
  }

  const extracted = extractLeadingExternalUrlText(text)
  if (!extracted) return null

  const extractedHref = getSafeAssistantMarkdownLinkUrl(extracted.label)
  if (!extractedHref || !href.startsWith(extractedHref)) return null

  return {
    href: extractedHref,
    label: extracted.label,
    trailingText: extracted.trailingText,
  }
}

type AssistantMarkdownProps = Readonly<{
  content: string
  streaming?: boolean
  citations?: ConversationMessage["knowledge_citations"]
  citationOffsetBaseUtf16?: number
  knowledgeAssetScope?: Readonly<{
    conversationId: string
    turnId: string
  }>
  artifactFilesById?: ReadonlyMap<string, ConversationFile>
  loadArtifactPreview?: LoadArtifactPreview
  onPreviewHtmlCode?: (html: string) => void
  onPreviewImage?: (item: ImagePreviewItem) => void
}>

type AssistantMarkdownBlockContextValue = Readonly<{
  citations: NonNullable<ConversationMessage["knowledge_citations"]>
  components: Components
  sourceContent: string
  blockOffsets: readonly number[]
  citationOffsetBaseUtf16: number
}>

const AssistantMarkdownBlockContext =
  createContext<AssistantMarkdownBlockContextValue | null>(null)
const emptyAssistantMarkdownBlockOffsets: readonly number[] = []
const emptyAssistantMarkdownRehypePlugins: NonNullable<
  BlockProps["rehypePlugins"]
> = []
const assistantMarkdownRemendOptions: NonNullable<StreamdownProps["remend"]> = {
  linkMode: "text-only",
  inlineKatex: false,
}
const htmlSourceBlockTagNames = new Set([
  "html",
  "head",
  "body",
  "main",
  "section",
  "article",
  "header",
  "footer",
  "nav",
  "div",
  "span",
  "p",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "form",
  "label",
  "input",
  "button",
  "select",
  "option",
  "textarea",
  "table",
  "thead",
  "tbody",
  "tfoot",
  "tr",
  "th",
  "td",
  "ul",
  "ol",
  "li",
  "script",
  "style",
  "template",
  "svg",
  "canvas",
  "iframe",
])
const htmlBlockOpeningTagPattern =
  /^ {0,3}<([A-Za-z][A-Za-z0-9:-]*)(?=\s|>|\/>)/u
const htmlBlockDoctypePattern = /^ {0,3}<!doctype\s+html\b/iu
const htmlBlockCommentPattern = /^ {0,3}<!--/u
const markdownFenceLinePattern = /^(?: {0,3})(`{3,}|~{3,})(.*)$/u
const markdownBacktickRunPattern = /`+/gu
type MarkdownFenceState = Readonly<{
  character: "`" | "~"
  length: number
}>
type HtmlBlockStart = Readonly<{
  kind: "doctype" | "comment" | "element"
  tagName?: string
}>

function normalizeStandaloneHtmlSourceMarkdown(content: string) {
  const lines = getSourceLines(content)
  if (lines.length === 0) return content

  let fence: MarkdownFenceState | null = null
  let offset = 0

  for (const line of lines) {
    const lineStartOffset = offset
    offset += line.length
    const lineText = stripSourceLineBreak(line)
    const markdownFence = getMarkdownFence(lineText)
    if (fence) {
      if (markdownFence && closesMarkdownFence(markdownFence, fence)) {
        fence = null
      }
      continue
    }
    if (markdownFence) {
      fence = markdownFence
      continue
    }

    if (getHtmlBlockStart(lineText)) {
      return [
        content.slice(0, lineStartOffset),
        createMarkdownCodeFence("html", content.slice(lineStartOffset)),
      ].join("")
    }
  }

  return content
}

function getSourceLines(content: string) {
  return Array.from(
    content.matchAll(/[^\r\n]*(?:\r\n|\r|\n|$)/gu),
    (match) => match[0]
  ).filter(Boolean)
}

function stripSourceLineBreak(line: string) {
  return line.replace(/\r\n?|\n$/u, "")
}

function getMarkdownFence(line: string): MarkdownFenceState | null {
  const match = markdownFenceLinePattern.exec(line)
  if (!match) return null
  const markerRun = match[1]!
  const character = markerRun[0] as MarkdownFenceState["character"]
  if (character === "`" && match[2]?.includes("`")) return null
  return { character, length: markerRun.length }
}

function closesMarkdownFence(
  candidate: MarkdownFenceState,
  fence: MarkdownFenceState
) {
  return (
    candidate.character === fence.character && candidate.length >= fence.length
  )
}

function getHtmlBlockStart(line: string): HtmlBlockStart | null {
  if (htmlBlockDoctypePattern.test(line)) return { kind: "doctype" }
  if (htmlBlockCommentPattern.test(line)) return { kind: "comment" }
  const tagName = htmlBlockOpeningTagPattern.exec(line)?.[1]?.toLowerCase()
  if (!tagName || !htmlSourceBlockTagNames.has(tagName)) return null
  return { kind: "element", tagName }
}

function createMarkdownCodeFence(language: string, source: string) {
  const longestBacktickRunLength = Array.from(
    source.matchAll(markdownBacktickRunPattern),
    (match) => match[0].length
  ).reduce((longest, length) => Math.max(longest, length), 0)
  const fence = "`".repeat(Math.max(3, longestBacktickRunLength + 1))
  const hasTrailingLineBreak = /(?:\r\n|\r|\n)$/u.test(source)
  return `${fence}${language}\n${hasTrailingLineBreak ? source : `${source}\n`}${fence}${hasTrailingLineBreak ? "\n" : ""}`
}

function getAssistantMarkdownBlockOffsets(content: string) {
  let offset = 0
  return parseMarkdownIntoBlocks(content).map((block) => {
    const blockOffset = offset
    offset += block.length
    return blockOffset
  })
}

const AssistantMarkdownBlock = memo(function AssistantMarkdownBlock({
  content,
  index,
  remarkPlugins,
  rehypePlugins,
}: BlockProps) {
  const blockContext = useContext(AssistantMarkdownBlockContext)
  const blockOffset = blockContext?.blockOffsets[index] ?? 0
  const citationOffsetBaseUtf16 =
    (blockContext?.citationOffsetBaseUtf16 ?? 0) + blockOffset
  const blockRemarkPlugins = useMemo<
    NonNullable<ComponentPropsWithoutRef<typeof ReactMarkdown>["remarkPlugins"]>
  >(
    () => [
      ...(remarkPlugins ?? []),
      [
        remarkKnowledgeCitations,
        {
          citations: blockContext?.citations ?? [],
          sourceContent: blockContext?.sourceContent,
          sourceOffsetBaseUtf16: blockContext?.citationOffsetBaseUtf16 ?? 0,
          offsetBaseUtf16: citationOffsetBaseUtf16,
          blockLengthUtf16: content.length,
          includeBlockStart: index === 0,
        },
      ],
    ],
    [
      blockContext?.citations,
      blockContext?.citationOffsetBaseUtf16,
      blockContext?.sourceContent,
      citationOffsetBaseUtf16,
      content.length,
      index,
      remarkPlugins,
    ]
  )

  return (
    <ReactMarkdown
      remarkPlugins={blockRemarkPlugins}
      rehypePlugins={rehypePlugins}
      components={blockContext?.components}
      skipHtml
      urlTransform={assistantMarkdownUrlTransform}
    >
      {content}
    </ReactMarkdown>
  )
})

function sameKnowledgeAssetScope(
  previous: AssistantMarkdownProps["knowledgeAssetScope"],
  next: AssistantMarkdownProps["knowledgeAssetScope"]
) {
  return (
    previous?.conversationId === next?.conversationId &&
    previous?.turnId === next?.turnId
  )
}

function sameInlineArtifactFiles(
  content: string,
  previous: AssistantMarkdownProps,
  next: AssistantMarkdownProps
) {
  if (previous.loadArtifactPreview !== next.loadArtifactPreview) return false

  return sameReferencedArtifactFiles(
    content,
    previous.artifactFilesById,
    next.artifactFilesById
  )
}

function sameReferencedArtifactFiles(
  content: string,
  previous: ReadonlyMap<string, ConversationFile> | undefined,
  next: ReadonlyMap<string, ConversationFile> | undefined
) {
  const artifactIds = collectInlineArtifactIds(content)
  if (artifactIds.size === 0) return true

  for (const artifactId of artifactIds) {
    if (previous?.get(artifactId) !== next?.get(artifactId)) {
      return false
    }
  }
  return true
}

function areAssistantMarkdownPropsEqual(
  previous: AssistantMarkdownProps,
  next: AssistantMarkdownProps
) {
  return (
    previous.content === next.content &&
    (previous.streaming ?? false) === (next.streaming ?? false) &&
    previous.citations === next.citations &&
    (previous.citationOffsetBaseUtf16 ?? 0) ===
      (next.citationOffsetBaseUtf16 ?? 0) &&
    previous.onPreviewHtmlCode === next.onPreviewHtmlCode &&
    previous.onPreviewImage === next.onPreviewImage &&
    sameKnowledgeAssetScope(
      previous.knowledgeAssetScope,
      next.knowledgeAssetScope
    ) &&
    sameInlineArtifactFiles(previous.content, previous, next)
  )
}

export const AssistantMarkdown = memo(function AssistantMarkdown({
  content,
  streaming = false,
  citations,
  citationOffsetBaseUtf16 = 0,
  knowledgeAssetScope,
  artifactFilesById,
  loadArtifactPreview,
  onPreviewHtmlCode,
  onPreviewImage,
}: AssistantMarkdownProps) {
  const safeContent = useMemo(() => {
    const stripped = stripKnowledgeSourceMarkers(
      normalizeAssistantMessageContent(content)
    )
    const displayable = normalizeStandaloneHtmlSourceMarkdown(stripped)
    const normalized = normalizeAssistantMarkdown(displayable)
    return streaming
      ? prepareStreamingAssistantMarkdown(normalized)
      : normalized
  }, [content, streaming])
  const citationBlockOffsets = useMemo(
    () =>
      citations?.length
        ? getAssistantMarkdownBlockOffsets(safeContent)
        : emptyAssistantMarkdownBlockOffsets,
    [citations?.length, safeContent]
  )
  const [activeImagePreview, setActiveImagePreview] =
    useState<ImagePreviewItem | null>(null)
  const openImagePreview = useCallback(
    (item: ImagePreviewItem) => {
      if (onPreviewImage) {
        onPreviewImage(item)
        return
      }
      setActiveImagePreview(item)
    },
    [onPreviewImage]
  )
  const citationIds = useMemo(
    () => (citations ?? []).map((citation) => citation.citation_id),
    [citations]
  )
  const citationsByNumber = useMemo(
    () =>
      new Map(
        (citations ?? []).map((citation) => [citation.citation_no, citation])
      ),
    [citations]
  )
  const assetContext = useMemo(
    () => ({
      artifactFilesById,
      citationIds,
      citationsByNumber,
      knowledgeAssetScope,
      knowledgeImageAuthorizationPending: streaming,
      loadArtifactPreview,
      onPreviewHtmlCode,
      openImagePreview,
      streaming,
    }),
    [
      artifactFilesById,
      citationIds,
      citationsByNumber,
      knowledgeAssetScope,
      loadArtifactPreview,
      onPreviewHtmlCode,
      openImagePreview,
      streaming,
    ]
  )
  const markdownComponents = useMemo<Components>(
    () => ({
      p: ({ node, className, children, ...props }) => {
        return (
          <p
            {...props}
            className={cn(
              className,
              hasStackedExternalSourceLinks(node) &&
                "assistant-markdown-source-link-stack"
            )}
          >
            {children}
          </p>
        )
      },
      h1: ({ node, className, ...props }) => {
        void node
        return <h1 {...props} className={className} />
      },
      h2: ({ node, className, ...props }) => {
        void node
        return <h2 {...props} className={className} />
      },
      h3: ({ node, className, ...props }) => {
        void node
        return <h3 {...props} className={className} />
      },
      h4: ({ node, className, ...props }) => {
        void node
        return <h4 {...props} className={className} />
      },
      ul: ({ node, className, ...props }) => {
        void node
        return <ul {...props} className={className} />
      },
      ol: ({ node, className, ...props }) => {
        void node
        return <ol {...props} className={className} />
      },
      blockquote: ({ node, className, ...props }) => {
        void node
        return <blockquote {...props} className={className} />
      },
      strong: ({ node, className, ...props }) => {
        void node
        return <strong {...props} className={className} />
      },
      pre: ({ node, ...props }) => {
        void node
        return <MarkdownCodeBlock {...props} />
      },
      table: ({ node, ...props }) => {
        void node
        return <MarkdownTable {...props} />
      },
      a: AssistantMarkdownLinkElement,
      img: AssistantMarkdownImageElement,
    }),
    []
  )
  const markdownBlockContext = useMemo<AssistantMarkdownBlockContextValue>(
    () => ({
      blockOffsets: citationBlockOffsets,
      citations: citations ?? [],
      components: markdownComponents,
      sourceContent: safeContent,
      citationOffsetBaseUtf16,
    }),
    [
      citationBlockOffsets,
      citationOffsetBaseUtf16,
      citations,
      markdownComponents,
      safeContent,
    ]
  )
  return (
    <AssistantMarkdownAssetContext.Provider value={assetContext}>
      <AssistantMarkdownBlockContext.Provider value={markdownBlockContext}>
        <Streamdown
          className="assistant-markdown space-y-0"
          mode="streaming"
          animated={false}
          isAnimating={false}
          BlockComponent={AssistantMarkdownBlock}
          components={markdownComponents}
          plugins={assistantMarkdownPlugins}
          parseIncompleteMarkdown={streaming}
          remend={assistantMarkdownRemendOptions}
          parseMarkdownIntoBlocksFn={parseMarkdownIntoBlocks}
          rehypePlugins={emptyAssistantMarkdownRehypePlugins}
          skipHtml
          urlTransform={assistantMarkdownUrlTransform}
        >
          {safeContent}
        </Streamdown>
      </AssistantMarkdownBlockContext.Provider>
      {!onPreviewImage && (
        <ImagePreviewDialog
          items={activeImagePreview ? [activeImagePreview] : []}
          activeId={activeImagePreview?.id ?? null}
          onActiveIdChange={(id) => {
            if (id === null) setActiveImagePreview(null)
          }}
        />
      )}
    </AssistantMarkdownAssetContext.Provider>
  )
}, areAssistantMarkdownPropsEqual)

const AssistantMarkdownAssetContext = createContext<{
  artifactFilesById?: ReadonlyMap<string, ConversationFile>
  citationIds: readonly string[]
  citationsByNumber?: ReadonlyMap<
    number,
    NonNullable<ConversationMessage["knowledge_citations"]>[number]
  >
  knowledgeAssetScope?: Readonly<{
    conversationId: string
    turnId: string
  }>
  knowledgeImageAuthorizationPending?: boolean
  loadArtifactPreview?: LoadArtifactPreview
  onPreviewHtmlCode?: (html: string) => void
  openImagePreview?: (item: ImagePreviewItem) => void
  streaming?: boolean
}>({ citationIds: [] })

type LoadKnowledgeCitationPreview = typeof getKnowledgeCitationPreview
const KnowledgeCitationPreviewContext =
  createContext<LoadKnowledgeCitationPreview>(getKnowledgeCitationPreview)

export function ConversationKnowledgeCitationProvider({
  load,
  children,
}: {
  load: LoadKnowledgeCitationPreview
  children: ReactNode
}) {
  return (
    <KnowledgeCitationPreviewContext.Provider value={load}>
      {children}
    </KnowledgeCitationPreviewContext.Provider>
  )
}

type AssistantKnowledgeCitation = NonNullable<
  ConversationMessage["knowledge_citations"]
>[number]

type KnowledgeCitationInlinePreviewState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "available"; excerpt: string }
  | { status: "historical_unavailable" }
  | { status: "error" }

function formatInlineKnowledgeCitationLocation(
  summary: AssistantKnowledgeCitation["summary"],
  t: ReturnType<typeof useTranslation>["t"]
): string {
  const parts: string[] = []
  if (summary.title_path.length > 0) {
    parts.push(summary.title_path.join(" / "))
  }
  if (summary.page_numbers.length > 0) {
    parts.push(
      t("knowledge.citation.pages", {
        values: summary.page_numbers.join(", "),
      })
    )
  } else {
    parts.push(t("knowledge.citation.documentLevel"))
  }
  return parts.join(" · ")
}

function KnowledgeCitationInlineLink({
  citation,
  className,
  ...props
}: Omit<ComponentPropsWithoutRef<"a">, "href"> & {
  citation: AssistantKnowledgeCitation
}) {
  const { t } = useTranslation()
  const loadKnowledgeCitationPreview = useContext(
    KnowledgeCitationPreviewContext
  )
  const tooltipId = useId()
  const [open, setOpen] = useState(false)
  const [previewState, setPreviewState] =
    useState<KnowledgeCitationInlinePreviewState>({ status: "idle" })
  const previewControllerRef = useRef<AbortController | null>(null)
  const citationPath = getKnowledgeCitationPreviewPath(citation)
  const location = formatInlineKnowledgeCitationLocation(citation.summary, t)

  const loadPreview = useCallback(() => {
    if (
      previewState.status === "loading" ||
      previewState.status === "available" ||
      previewState.status === "historical_unavailable"
    ) {
      return
    }
    previewControllerRef.current?.abort()
    const controller = new AbortController()
    previewControllerRef.current = controller
    setPreviewState({ status: "loading" })
    void loadKnowledgeCitationPreview(citation.citation_id, controller.signal)
      .then((preview) => {
        if (controller.signal.aborted) return
        if (preview.status === "available") {
          setPreviewState({
            status: "available",
            excerpt: preview.parent_excerpt,
          })
          return
        }
        setPreviewState({ status: "historical_unavailable" })
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setPreviewState({ status: "error" })
        }
      })
      .finally(() => {
        if (previewControllerRef.current === controller) {
          previewControllerRef.current = null
        }
      })
  }, [citation.citation_id, loadKnowledgeCitationPreview, previewState.status])

  const handlePreviewOpenChange = useCallback(
    (nextOpen: boolean) => {
      setOpen(nextOpen)
      if (nextOpen) loadPreview()
    },
    [loadPreview]
  )

  useEffect(
    () => () => {
      previewControllerRef.current?.abort()
    },
    []
  )

  const previewText =
    previewState.status === "available"
      ? previewState.excerpt
      : previewState.status === "historical_unavailable"
        ? t("knowledge.citation.historicalUnavailableDescription")
        : previewState.status === "error"
          ? t("knowledge.citation.inlinePreviewUnavailable")
          : t("knowledge.citation.loading")

  return (
    <HoverCard open={open} onOpenChange={handlePreviewOpenChange}>
      <span className="knowledge-citation-inline">
        <HoverCardTrigger
          delay={0}
          closeDelay={120}
          render={
            <Link
              {...props}
              to={citationPath}
              className={cn(className, "knowledge-citation-link")}
              aria-describedby={open ? tooltipId : undefined}
              aria-label={t("conversation.openKnowledgeCitation", {
                number: citation.citation_no,
              })}
              title={t("knowledge.citation.source", {
                knowledgeBase: citation.summary.knowledge_base_name,
                number: citation.citation_no,
              })}
            />
          }
        >
          {citation.citation_no}
        </HoverCardTrigger>
      </span>
      {open && (
        <HoverCardContent
          id={tooltipId}
          role="tooltip"
          side="top"
          sideOffset={8}
          align="center"
          className="knowledge-citation-hover-card"
        >
          <span className="knowledge-citation-hover-card-header">
            <span className="knowledge-citation-hover-card-kicker">
              {t("knowledge.citation.source", {
                knowledgeBase: citation.summary.knowledge_base_name,
                number: citation.citation_no,
              })}
            </span>
            <Link
              to={citationPath}
              className="knowledge-citation-hover-card-action"
              aria-label={t("conversation.openKnowledgeCitation", {
                number: citation.citation_no,
              })}
            >
              <ArrowRightIcon
                className="knowledge-citation-hover-card-arrow"
                aria-hidden="true"
                focusable="false"
              />
            </Link>
          </span>
          <span
            className="knowledge-citation-hover-card-document"
            title={citation.summary.document_name}
          >
            {citation.summary.document_name}
          </span>
          <span
            className="knowledge-citation-hover-card-location"
            title={location}
          >
            {t("knowledge.citation.location", { location })}
          </span>
          {previewState.status === "available" ? (
            <KnowledgeCitationExcerpt
              excerpt={previewState.excerpt}
              className="knowledge-citation-hover-card-excerpt"
            />
          ) : (
            <span
              className="knowledge-citation-hover-card-excerpt"
              data-status={previewState.status}
            >
              {previewText}
            </span>
          )}
        </HoverCardContent>
      )}
    </HoverCard>
  )
}

function AssistantMarkdownLinkElement({
  node,
  href,
  children,
  ...props
}: ComponentPropsWithoutRef<"a"> & { node?: unknown }) {
  void node
  const { citationsByNumber } = useContext(AssistantMarkdownAssetContext)
  const citationNumber = getKnowledgeCitationNumberFromFragment(href)
  const citation =
    citationNumber === null ? undefined : citationsByNumber?.get(citationNumber)
  if (citation) {
    return <KnowledgeCitationInlineLink {...props} citation={citation} />
  }
  const safeHref = getSafeAssistantMarkdownLinkUrl(href)
  if (!safeHref) {
    return (
      <span className={props.className} title={props.title}>
        {children}
      </span>
    )
  }
  const linkSplit = splitAssistantMarkdownLinkText(safeHref, children)
  const linkHref = linkSplit?.href ?? safeHref
  const external = /^https?:\/\//iu.test(linkHref)
  return (
    <>
      <SiteLink
        {...props}
        href={linkHref}
        {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
      >
        {linkSplit?.label ?? children}
      </SiteLink>
      {linkSplit?.trailingText}
    </>
  )
}

function AssistantExternalMarkdownImage({
  source,
  name,
  alt,
  className,
  onError,
  onPreview,
  ...props
}: Omit<ComponentPropsWithoutRef<"img">, "src"> & {
  source: string
  name: string
  onPreview: () => void
}) {
  const { t } = useTranslation()
  const [failedSource, setFailedSource] = useState<string | null>(null)
  const failed = failedSource === source

  if (failed) {
    const failureLabel = t("conversation.previewLoadFailed", { name })

    return (
      <span
        className="conversation-image-thumbnail-error"
        role="img"
        aria-label={failureLabel}
        title={failureLabel}
      >
        <span
          className="conversation-image-thumbnail-error-icon"
          aria-hidden="true"
        >
          <ImageOffIcon />
        </span>
        <span className="conversation-image-thumbnail-error-label">
          {t("conversation.inlineImageUnavailable")}
        </span>
      </span>
    )
  }

  return (
    <Button
      type="button"
      variant="ghost"
      className="conversation-image-thumbnail-trigger"
      aria-label={t("conversation.previewImage", { name })}
      onClick={onPreview}
    >
      <img
        {...props}
        className={cn("conversation-image-thumbnail-image", className)}
        src={source}
        alt={alt ?? ""}
        width={props.width ?? 320}
        height={props.height ?? 180}
        loading="lazy"
        decoding="async"
        referrerPolicy="no-referrer"
        onError={(event) => {
          onError?.(event)
          setFailedSource(source)
        }}
      />
    </Button>
  )
}

function AssistantMarkdownImageElement({
  node,
  src,
  alt,
  className,
  ...props
}: ComponentPropsWithoutRef<"img"> & { node?: unknown }) {
  void node
  const { t } = useTranslation()
  const {
    artifactFilesById,
    citationIds,
    knowledgeAssetScope,
    knowledgeImageAuthorizationPending,
    loadArtifactPreview,
    openImagePreview,
  } = useContext(AssistantMarkdownAssetContext)
  const artifactId = getInlineArtifactId(src)
  const knowledgeAssetId = getKnowledgeAssetId(src)
  const name = alt?.trim() || t("conversation.inlineImage")
  if (artifactId || isInlineArtifactUrl(src)) {
    return (
      <AssistantMarkdownImage
        {...props}
        source={src}
        alt={alt}
        file={artifactId ? artifactFilesById?.get(artifactId) : undefined}
        loadPreview={loadArtifactPreview}
        className={cn("conversation-image-thumbnail-image", className)}
        previewTriggerClassName="conversation-image-thumbnail-trigger"
        placeholderClassName="assistant-inline-image-thumbnail-placeholder"
        onPreview={(source) =>
          openImagePreview?.({
            id: `assistant-markdown-artifact:${artifactId ?? source.url}`,
            name,
            src: source.url,
            alt: name,
          })
        }
      />
    )
  }
  if (knowledgeAssetId) {
    return (
      <AssistantKnowledgeImage
        {...props}
        assetReferenceId={knowledgeAssetId}
        citationIds={citationIds}
        conversationId={knowledgeAssetScope?.conversationId}
        turnId={knowledgeAssetScope?.turnId}
        authorizationPending={knowledgeImageAuthorizationPending}
        alt={alt}
        className={cn("conversation-image-thumbnail-image", className)}
        previewTriggerClassName="conversation-image-thumbnail-trigger"
        placeholderClassName="assistant-inline-image-thumbnail-placeholder"
        onPreview={(url) =>
          openImagePreview?.({
            id: `assistant-markdown-knowledge:${knowledgeAssetId}`,
            name,
            src: url,
            alt: name,
          })
        }
      />
    )
  }
  if (isKnowledgeAssetUrl(src)) {
    return (
      <AssistantKnowledgeImage
        {...props}
        assetReferenceId=""
        citationIds={[]}
        alt={alt}
        className={cn("conversation-image-thumbnail-image", className)}
        placeholderClassName="assistant-inline-image-thumbnail-placeholder"
      />
    )
  }

  if (!src) return null

  return (
    <AssistantExternalMarkdownImage
      {...props}
      source={src}
      name={name}
      alt={alt}
      className={className}
      onPreview={() =>
        openImagePreview?.({
          id: `assistant-markdown-image:${src}`,
          name,
          src,
          alt: name,
        })
      }
    />
  )
}

function copyTextWithDomFallback(content: string) {
  if (!document.body || typeof document.execCommand !== "function") {
    return false
  }

  const activeElement =
    document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null
  const selection = window.getSelection()
  const selectionRanges = selection
    ? Array.from({ length: selection.rangeCount }, (_, index) =>
        selection.getRangeAt(index).cloneRange()
      )
    : []
  let controlSelection:
    | {
        element: HTMLInputElement | HTMLTextAreaElement
        start: number
        end: number
        direction: "forward" | "backward" | "none"
      }
    | undefined

  if (
    activeElement instanceof HTMLInputElement ||
    activeElement instanceof HTMLTextAreaElement
  ) {
    try {
      if (
        activeElement.selectionStart !== null &&
        activeElement.selectionEnd !== null
      ) {
        controlSelection = {
          element: activeElement,
          start: activeElement.selectionStart,
          end: activeElement.selectionEnd,
          direction: activeElement.selectionDirection ?? "none",
        }
      }
    } catch {
      // Some input types do not expose a selectable text range.
    }
  }

  const textarea = document.createElement("textarea")
  textarea.value = content
  textarea.readOnly = true
  textarea.tabIndex = -1
  textarea.className = "clipboard-copy-fallback"
  textarea.setAttribute("aria-hidden", "true")
  document.body.append(textarea)

  let copied: boolean
  try {
    textarea.focus({ preventScroll: true })
    textarea.select()
    copied = document.execCommand("copy")
  } catch {
    copied = false
  } finally {
    textarea.remove()

    if (activeElement?.isConnected) {
      activeElement.focus({ preventScroll: true })
    }
    if (controlSelection?.element.isConnected) {
      try {
        controlSelection.element.setSelectionRange(
          controlSelection.start,
          controlSelection.end,
          controlSelection.direction
        )
      } catch {
        // The active control may have changed to a non-selectable input type.
      }
    }
    if (selection) {
      selection.removeAllRanges()
      for (const range of selectionRanges) {
        try {
          selection.addRange(range)
        } catch {
          // Ignore ranges whose nodes were removed during the copy operation.
        }
      }
    }
  }

  return copied
}

async function copyTextToClipboard(content: string) {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(content)
      return true
    } catch {
      // The DOM fallback supports browsers and embedded surfaces that reject
      // the async Clipboard API despite a direct user gesture.
    }
  }
  return copyTextWithDomFallback(content)
}

function getOfficeAnnotationDisplay(
  value: unknown
): OfficeAnnotationDisplay | null {
  const parsed = officeAnnotationDisplaySchema.safeParse(value)
  return parsed.success ? parsed.data : null
}

function officeAnnotationCardItems(
  display: OfficeAnnotationDisplay,
  t: TFunction
): ReadonlyArray<Readonly<{ request: string; locationLabel: string }>> {
  if (display.kind === "presentation_annotation") {
    return display.annotations.map((annotation) => ({
      request: annotation.request,
      locationLabel: t("officePreview.annotationBatch.presentationLocation", {
        slide: annotation.slide_number,
        count: annotation.selection_count,
      }),
    }))
  }
  if (display.kind === "word_annotation") {
    return display.annotations.map((annotation) => ({
      request: annotation.request,
      locationLabel: annotation.page_number
        ? t("officePreview.annotationBatch.wordPageLocation", {
            page: annotation.page_number,
          })
        : t("officePreview.annotationBatch.wordParagraphLocation", {
            paragraph: annotation.paragraph_number,
          }),
    }))
  }
  if (display.kind === "spreadsheet_annotation") {
    return display.annotations.map((annotation) => ({
      request: annotation.request,
      locationLabel: t("officePreview.annotationBatch.spreadsheetLocation", {
        sheet: annotation.sheet_name,
        selection: annotation.selection_label,
      }),
    }))
  }
  return display.annotations.map((annotation) => ({
    request: annotation.request,
    locationLabel: t("officePreview.annotationBatch.htmlLocation", {
      count: annotation.selection_count,
    }),
  }))
}

type MessageProps = Readonly<{
  message: ConversationMessage
  conversationId: string
  modelName?: string
  capabilitiesById: ReadonlyMap<string, CapabilitySummary>
  knowledgeBaseNamesById: ReadonlyMap<string, string>
  applicationManagedKnowledgeBaseLabel?: string
  artifactFilesById?: ReadonlyMap<string, ConversationFile>
  loadAttachmentPreview?: LoadAttachmentPreview
  loadArtifactPreview?: LoadArtifactPreview
  onPreviewHtmlCode?: (html: string) => void
  onPreviewImage?: (item: ImagePreviewItem) => void
  onPreviewOfficeDocument?: (file: ConversationFile) => void
  officeFile?: ConversationFile
  onDownload: (file: ConversationFile) => void
  downloadingFileId?: string
  editing: boolean
  editingDisabled: boolean
  onEditStart: () => void
  onEditCancel: () => void
  onRegenerateMessage?: (
    message: ConversationMessage,
    nextContent: string
  ) => Promise<void>
  onForkMessage?: (message: ConversationMessage) => Promise<void>
  forkDisabled?: boolean
  isGoalTask?: boolean
  goalCompletion?: Readonly<{
    durationLabel: string
  }>
  proposedPlan?: boolean
  hideActions?: boolean
}>

const Message = memo(function Message({
  message,
  conversationId,
  modelName,
  capabilitiesById,
  knowledgeBaseNamesById,
  applicationManagedKnowledgeBaseLabel,
  artifactFilesById,
  loadAttachmentPreview,
  loadArtifactPreview,
  onPreviewHtmlCode,
  onPreviewImage,
  onPreviewOfficeDocument,
  officeFile,
  onDownload,
  downloadingFileId,
  editing,
  editingDisabled,
  onEditStart,
  onEditCancel,
  onRegenerateMessage,
  onForkMessage,
  forkDisabled = false,
  isGoalTask,
  goalCompletion,
  proposedPlan = false,
  hideActions = false,
}: MessageProps) {
  const { t, i18n } = useTranslation()
  const user = message.role === "user"
  const officeAnnotation = user
    ? getOfficeAnnotationDisplay(message.display)
    : null
  const language = normalizeLanguage(i18n.resolvedLanguage) ?? "zh-CN"
  const messageTime = formatMessageTime(message.created_at, language)
  const fullMessageTime = formatDateTime(message.created_at, language)
  const normalizedModelName = modelName?.trim() || undefined
  const persistedUserContent = user
    ? getConversationMessageDisplayText(message).trimEnd()
    : message.content
  const safeAssistantContent = user
    ? ""
    : normalizeAssistantMessageContent(
        stripKnowledgeSourceMarkers(message.content)
      )
  const embeddedProposedPlan =
    !user && !proposedPlan
      ? parseAssistantProposedPlanSourceSegments(safeAssistantContent)
      : null
  const assistantCopyContent = embeddedProposedPlan
    ? embeddedProposedPlan.before.content +
      embeddedProposedPlan.plan.content +
      embeddedProposedPlan.after.content
    : safeAssistantContent
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">(
    "idle"
  )
  const [editValue, setEditValue] = useState(message.content)
  const [optimisticContent, setOptimisticContent] = useState<string | null>(
    null
  )
  const [submitting, setSubmitting] = useState(false)
  const [editError, setEditError] = useState<string | null>(null)
  const [forkState, setForkState] = useState<"idle" | "forking" | "failed">(
    "idle"
  )
  const editButtonRef = useRef<HTMLButtonElement>(null)
  const nextContent = editValue.trim()
  const canSubmit = nextContent.length > 0 && !submitting && !editingDisabled
  const displayedUserContent = optimisticContent ?? persistedUserContent
  const hasDisplayedUserContent = displayedUserContent.trim().length > 0
  const showMessageActions = !editing && !hideActions
  const assistantActionsPending = !user && message.streaming === true

  const startEditing = () => {
    setOptimisticContent(null)
    setEditValue(message.content)
    setEditError(null)
    onEditStart()
  }

  const focusEditButton = () => {
    window.setTimeout(
      () => editButtonRef.current?.focus({ preventScroll: true }),
      0
    )
  }

  const finishEditing = () => {
    onEditCancel()
    focusEditButton()
  }

  useEffect(() => {
    if (copyState !== "copied") return
    const timer = window.setTimeout(() => setCopyState("idle"), 1_500)
    return () => window.clearTimeout(timer)
  }, [copyState])

  const copyMessage = async () => {
    const copied = await copyTextToClipboard(
      user ? displayedUserContent : assistantCopyContent
    )
    setCopyState(copied ? "copied" : "failed")
  }

  const submitEdit = async () => {
    if (!canSubmit || !onRegenerateMessage) return
    const submittedContent = nextContent
    setSubmitting(true)
    setEditError(null)
    setOptimisticContent(submittedContent)
    onEditCancel()
    try {
      await onRegenerateMessage(message, submittedContent)
      focusEditButton()
    } catch {
      setOptimisticContent(null)
      setEditValue(submittedContent)
      setEditError(t("conversation.regenerateFailed"))
      onEditStart()
    } finally {
      setSubmitting(false)
    }
  }

  const forkMessage = async () => {
    if (!onForkMessage || forkDisabled || forkState === "forking") return
    setForkState("forking")
    try {
      await onForkMessage(message)
    } catch {
      setForkState("failed")
    }
  }

  const metadataElement = messageTime ? (
    <span className="message-action-metadata">
      <time
        className={cn(
          "message-action-time",
          normalizedModelName && "message-action-time-with-model"
        )}
        dateTime={message.created_at}
        title={fullMessageTime === "—" ? undefined : fullMessageTime}
        aria-label={t("conversation.messageSentAt", {
          time: fullMessageTime,
        })}
      >
        {messageTime}
      </time>
      {normalizedModelName && (
        <span
          className="message-action-model"
          aria-label={t("conversation.messageModel", {
            model: normalizedModelName,
          })}
          title={t("conversation.messageModel", {
            model: normalizedModelName,
          })}
        >
          {normalizedModelName}
        </span>
      )}
    </span>
  ) : null

  const copyActionLabel = t(
    copyState === "copied"
      ? "conversation.messageCopied"
      : "conversation.copyMessage"
  )
  const forkActionLabel = t(
    forkState === "forking"
      ? "conversation.forkingMessage"
      : "conversation.forkMessage"
  )
  const copyButton = (
    <Button
      type="button"
      variant="ghost"
      size="icon-sm"
      className="message-action-button message-copy-button"
      aria-label={copyActionLabel}
      onClick={() => void copyMessage()}
    >
      {copyState === "copied" ? (
        <CheckIcon className="size-3" strokeWidth={1.5} aria-hidden="true" />
      ) : (
        <CopyIcon className="size-3" strokeWidth={1.5} aria-hidden="true" />
      )}
    </Button>
  )
  const forkButton =
    !user && onForkMessage ? (
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        className="message-action-button"
        aria-label={forkActionLabel}
        disabled={forkDisabled || forkState === "forking"}
        onClick={() => void forkMessage()}
      >
        {forkState === "forking" ? (
          <LoaderCircleIcon
            className="size-3 animate-spin"
            strokeWidth={1.5}
            aria-hidden="true"
          />
        ) : (
          <GitForkIcon
            className="size-3"
            strokeWidth={1.5}
            aria-hidden="true"
          />
        )}
      </Button>
    ) : null
  const copyAction = (
    <Tooltip>
      <TooltipTrigger render={copyButton} />
      <ActionTooltipContent side="top">{copyActionLabel}</ActionTooltipContent>
    </Tooltip>
  )
  const forkAction = forkButton ? (
    <Tooltip>
      <TooltipTrigger render={forkButton} />
      <ActionTooltipContent side="top">{forkActionLabel}</ActionTooltipContent>
    </Tooltip>
  ) : null
  const goalCompletionElement =
    !user && goalCompletion ? (
      <span className="message-goal-completion" role="status">
        <CircleCheckIcon
          className="message-goal-completion-icon"
          strokeWidth={1.5}
          aria-hidden="true"
        />
        <span className="message-goal-completion-label">
          {t("conversation.goal.completedInline", {
            duration: goalCompletion.durationLabel,
          })}
        </span>
      </span>
    ) : null

  return (
    <article
      id={getConversationMessageAnchorId(message.id)}
      aria-label={t(
        user ? "conversation.userMessage" : "conversation.assistantMessage"
      )}
      className={cn(
        "message-row",
        user ? "message-row-user" : "message-row-assistant",
        user && editing && "message-row-editing"
      )}
    >
      {user && !editing && (
        <UserMessageSelections
          capabilities={message.selected_capabilities}
          capabilitiesById={capabilitiesById}
          knowledgeBaseIds={message.selected_knowledge_base_ids}
          knowledgeBaseNamesById={knowledgeBaseNamesById}
          applicationManagedLabel={applicationManagedKnowledgeBaseLabel}
          label={t("conversation.selectedResources")}
          overflowLabel={(count) =>
            t("conversation.moreSelectedResources", { count })
          }
          overflowListLabel={t("conversation.additionalSelectedResources")}
          unavailableLabel={t("conversation.knowledgeBaseUnavailable")}
        />
      )}
      {user && (
        <UserMessageAttachments
          files={message.attachments}
          loadPreview={loadAttachmentPreview}
          onPreviewImage={onPreviewImage}
          onPreviewFile={onPreviewOfficeDocument}
        />
      )}
      {officeAnnotation && !editing ? (
        <OfficeAnnotationCard
          ariaLabel={t(
            officeAnnotation.kind === "presentation_annotation"
              ? "conversation.presentationAnnotation"
              : officeAnnotation.kind === "html_annotation"
                ? "conversation.htmlAnnotation"
                : "conversation.officeAnnotation",
            {
              name: officeAnnotation.file_name,
            }
          )}
          fileName={officeAnnotation.file_name}
          mimeType={officeFile?.mime_type}
          annotations={officeAnnotationCardItems(officeAnnotation, t)}
          annotationLabel={t(
            officeAnnotation.kind === "presentation_annotation"
              ? "conversation.presentationAnnotationCount"
              : officeAnnotation.kind === "html_annotation"
                ? "conversation.htmlAnnotationCount"
                : "conversation.officeAnnotationCount",
            {
              count: officeAnnotation.annotation_count,
            }
          )}
          openLabel={t(
            officeAnnotation.kind === "presentation_annotation"
              ? "conversation.previewPresentation"
              : officeAnnotation.kind === "html_annotation"
                ? "conversation.previewHtml"
                : "conversation.previewDocument",
            {
              name: officeAnnotation.file_name,
            }
          )}
          onOpen={
            officeFile && onPreviewOfficeDocument
              ? () => onPreviewOfficeDocument(officeFile)
              : undefined
          }
        />
      ) : (
        (!user || editing || hasDisplayedUserContent) && (
          <div
            className={cn(
              "message-content",
              user && "user-message",
              (proposedPlan || embeddedProposedPlan) && "w-full",
              !user &&
                (hasAssistantHtmlPreviewFence(safeAssistantContent) ||
                  hasAssistantHtmlCodePreviewableContent(
                    safeAssistantContent
                  )) &&
                "w-full"
            )}
          >
            {user && editing ? (
              <form
                className="message-edit-form"
                aria-label={t("conversation.editMessage")}
                aria-busy={submitting || undefined}
                onSubmit={(event) => {
                  event.preventDefault()
                  void submitEdit()
                }}
              >
                <Textarea
                  autoFocus={shouldAutoFocusOnDesktop()}
                  className="message-edit-textarea"
                  aria-label={t("conversation.editMessageInput")}
                  value={editValue}
                  disabled={submitting || editingDisabled}
                  onChange={(event) => setEditValue(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Escape" && !submitting) {
                      event.preventDefault()
                      finishEditing()
                    }
                    if (
                      event.key === "Enter" &&
                      !event.shiftKey &&
                      !event.nativeEvent.isComposing
                    ) {
                      event.preventDefault()
                      event.currentTarget.form?.requestSubmit()
                    }
                  }}
                />
                {editError && (
                  <p className="message-edit-error" role="alert">
                    {editError}
                  </p>
                )}
                <div className="message-edit-actions">
                  <Button
                    type="button"
                    variant="outline"
                    disabled={submitting}
                    onClick={finishEditing}
                  >
                    {t("conversation.cancelEdit")}
                  </Button>
                  <Button
                    type="submit"
                    disabled={!canSubmit}
                    aria-busy={submitting || undefined}
                  >
                    {submitting && (
                      <LoaderCircleIcon
                        data-icon="inline-start"
                        className="animate-spin"
                        aria-hidden="true"
                      />
                    )}
                    {t(
                      submitting
                        ? "conversation.regenerating"
                        : "conversation.send"
                    )}
                  </Button>
                </div>
              </form>
            ) : user ? (
              <>
                <ConversationUserMessageText
                  content={displayedUserContent}
                  collapsible={
                    message.display?.kind === "interactive_application"
                  }
                />
                {message.delivery_status === "sending" && (
                  <span
                    role="status"
                    className="mt-1 flex items-center gap-1 text-xs text-muted-foreground"
                  >
                    <LoaderCircleIcon
                      className="size-3 animate-spin"
                      aria-hidden="true"
                    />
                    {t("conversation.messageSending")}
                  </span>
                )}
              </>
            ) : proposedPlan ? (
              <ConversationProposedPlanCard
                streaming={message.streaming === true}
              >
                <AssistantMarkdown
                  content={safeAssistantContent}
                  streaming={message.streaming === true}
                  citations={message.knowledge_citations}
                  knowledgeAssetScope={
                    message.turn_id
                      ? { conversationId, turnId: message.turn_id }
                      : undefined
                  }
                  artifactFilesById={artifactFilesById}
                  loadArtifactPreview={loadArtifactPreview}
                  onPreviewHtmlCode={onPreviewHtmlCode}
                  onPreviewImage={onPreviewImage}
                />
              </ConversationProposedPlanCard>
            ) : embeddedProposedPlan ? (
              <>
                {embeddedProposedPlan.before.content.trim() && (
                  <AssistantMarkdown
                    content={embeddedProposedPlan.before.content}
                    streaming={message.streaming === true}
                    citations={message.knowledge_citations}
                    citationOffsetBaseUtf16={
                      embeddedProposedPlan.before.offsetUtf16
                    }
                    knowledgeAssetScope={
                      message.turn_id
                        ? { conversationId, turnId: message.turn_id }
                        : undefined
                    }
                    artifactFilesById={artifactFilesById}
                    loadArtifactPreview={loadArtifactPreview}
                    onPreviewHtmlCode={onPreviewHtmlCode}
                    onPreviewImage={onPreviewImage}
                  />
                )}
                <ConversationProposedPlanCard
                  streaming={message.streaming === true}
                >
                  <AssistantMarkdown
                    content={embeddedProposedPlan.plan.content}
                    streaming={message.streaming === true}
                    citations={message.knowledge_citations}
                    citationOffsetBaseUtf16={
                      embeddedProposedPlan.plan.offsetUtf16
                    }
                    knowledgeAssetScope={
                      message.turn_id
                        ? { conversationId, turnId: message.turn_id }
                        : undefined
                    }
                    artifactFilesById={artifactFilesById}
                    loadArtifactPreview={loadArtifactPreview}
                    onPreviewHtmlCode={onPreviewHtmlCode}
                    onPreviewImage={onPreviewImage}
                  />
                </ConversationProposedPlanCard>
                {embeddedProposedPlan.after.content.trim() && (
                  <AssistantMarkdown
                    content={embeddedProposedPlan.after.content}
                    streaming={message.streaming === true}
                    citations={message.knowledge_citations}
                    citationOffsetBaseUtf16={
                      embeddedProposedPlan.after.offsetUtf16
                    }
                    knowledgeAssetScope={
                      message.turn_id
                        ? { conversationId, turnId: message.turn_id }
                        : undefined
                    }
                    artifactFilesById={artifactFilesById}
                    loadArtifactPreview={loadArtifactPreview}
                    onPreviewHtmlCode={onPreviewHtmlCode}
                    onPreviewImage={onPreviewImage}
                  />
                )}
              </>
            ) : (
              <AssistantMarkdown
                content={safeAssistantContent}
                streaming={message.streaming === true}
                citations={message.knowledge_citations}
                knowledgeAssetScope={
                  message.turn_id
                    ? { conversationId, turnId: message.turn_id }
                    : undefined
                }
                artifactFilesById={artifactFilesById}
                loadArtifactPreview={loadArtifactPreview}
                onPreviewHtmlCode={onPreviewHtmlCode}
                onPreviewImage={onPreviewImage}
              />
            )}
            {!user &&
              message.attachments?.map((file) => (
                <FileTile key={file.id} file={file} />
              ))}
            {!user && (
              <ArtifactFiles
                files={message.artifacts}
                loadPreview={loadArtifactPreview}
                onPreviewOfficeDocument={onPreviewOfficeDocument}
                onDownload={onDownload}
                downloadingFileId={downloadingFileId}
              />
            )}
          </div>
        )
      )}
      {showMessageActions && (
        <div
          className={cn(
            "message-actions",
            user && isGoalTask && "message-actions-user-goal"
          )}
          aria-label={
            assistantActionsPending
              ? undefined
              : t("conversation.messageActions")
          }
          aria-hidden={assistantActionsPending || undefined}
          data-placeholder={assistantActionsPending || undefined}
        >
          <TooltipProvider delay={0}>
            {assistantActionsPending ? null : user ? (
              <>
                <span className="message-user-action-controls">
                  {metadataElement}
                  {copyAction}
                  {onRegenerateMessage && !editingDisabled && !submitting && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      className="message-action-button"
                      ref={editButtonRef}
                      aria-label={t("conversation.editMessage")}
                      title={t("conversation.editMessage")}
                      onClick={startEditing}
                    >
                      <PencilIcon
                        className="size-3"
                        strokeWidth={1.5}
                        aria-hidden="true"
                      />
                    </Button>
                  )}
                </span>
                {isGoalTask && (
                  <span className="user-message-goal-indicator">
                    <GoalIcon
                      className="user-message-goal-indicator-icon"
                      strokeWidth={1.5}
                      aria-hidden="true"
                    />
                    <span className="user-message-goal-indicator-label">
                      {t("conversation.goal.modeLabel")}
                    </span>
                  </span>
                )}
              </>
            ) : (
              <>
                {copyAction}
                {forkAction}
                {metadataElement}
                {goalCompletionElement}
              </>
            )}
          </TooltipProvider>
        </div>
      )}
      {copyState === "failed" && (
        <span className="sr-only" role="alert">
          {t("conversation.copyMessageFailed")}
        </span>
      )}
      {forkState === "failed" && (
        <span className="sr-only" role="alert">
          {t("conversation.forkMessageFailed")}
        </span>
      )}
    </article>
  )
}, areMessagePropsEqual)

function areMessagePropsEqual(previous: MessageProps, next: MessageProps) {
  return (
    previous.message === next.message &&
    previous.conversationId === next.conversationId &&
    previous.modelName === next.modelName &&
    previous.capabilitiesById === next.capabilitiesById &&
    previous.knowledgeBaseNamesById === next.knowledgeBaseNamesById &&
    previous.applicationManagedKnowledgeBaseLabel ===
      next.applicationManagedKnowledgeBaseLabel &&
    (previous.message.role === "user" ||
      sameReferencedArtifactFiles(
        previous.message.content,
        previous.artifactFilesById,
        next.artifactFilesById
      )) &&
    previous.loadAttachmentPreview === next.loadAttachmentPreview &&
    previous.loadArtifactPreview === next.loadArtifactPreview &&
    previous.onPreviewHtmlCode === next.onPreviewHtmlCode &&
    previous.onPreviewImage === next.onPreviewImage &&
    previous.onPreviewOfficeDocument === next.onPreviewOfficeDocument &&
    previous.officeFile === next.officeFile &&
    previous.onDownload === next.onDownload &&
    previous.downloadingFileId === next.downloadingFileId &&
    previous.editing === next.editing &&
    previous.editingDisabled === next.editingDisabled &&
    previous.onRegenerateMessage === next.onRegenerateMessage &&
    previous.onForkMessage === next.onForkMessage &&
    previous.forkDisabled === next.forkDisabled &&
    previous.isGoalTask === next.isGoalTask &&
    previous.goalCompletion?.durationLabel ===
      next.goalCompletion?.durationLabel &&
    previous.proposedPlan === next.proposedPlan
  )
}

type NativeLifecycleEntry = {
  event: ConversationEvent
  item: NativeCodexItem
  method: "item/started" | "item/completed"
  sequence: number
  createdAt: string
}

function collapseNativeLifecycle(events: ConversationEvent[]) {
  const uniqueEvents = [
    ...new Map(events.map((event) => [event.id, event])).values(),
  ].sort((left, right) => left.sequence_no - right.sequence_no)
  const latestByItemId = new Map<string, NativeLifecycleEntry>()
  for (const event of uniqueEvents) {
    const native = getNativeCodexPayload(event)
    if (
      !native ||
      (native.method !== "item/started" &&
        native.method !== "item/completed") ||
      !native.params.item ||
      native.params.item.type === "agentMessage" ||
      native.params.item.type === "plan"
    ) {
      continue
    }
    const previous = latestByItemId.get(native.params.item.id)
    latestByItemId.set(native.params.item.id, {
      event,
      item: native.params.item,
      method: native.method,
      sequence: previous?.sequence ?? event.sequence_no,
      createdAt: previous?.createdAt ?? event.created_at,
    })
  }
  return [...latestByItemId.values()]
}

function isVisibleNativeLifecycleEntry(activity: NativeLifecycleEntry) {
  if (!shouldDisplayNativeActivity(activity.item)) return false
  const model = buildNativeActivityViewModel(activity.item, activity.method)
  return Boolean(
    model.summary?.trim() || model.summaryKey || model.summaryParts.length > 0
  )
}

function isRunningImageGenerationActivity(activity: NativeLifecycleEntry) {
  return (
    activity.method === "item/started" &&
    activity.item.type === "mcpToolCall" &&
    activity.item.server === coreMcpServerKey &&
    activity.item.tool === "generate_image" &&
    activity.item.status === "inProgress"
  )
}

function earliestTimestamp(values: Array<string | null | undefined>) {
  let earliest: { value: string; timestamp: number } | undefined
  for (const value of values) {
    if (!value) continue
    const timestamp = Date.parse(value)
    if (!Number.isFinite(timestamp)) continue
    if (!earliest || timestamp < earliest.timestamp) {
      earliest = { value, timestamp }
    }
  }
  return earliest?.value
}

const maxRememberedProcessingStarts = 100
// Live stream items can briefly lack a server timestamp. Keep their observed
// start across task-route unmounts; persisted timestamps still take precedence.
const rememberedProcessingStarts = new Map<string, number>()

function rememberProcessingStart(turnId: string, startedAt: number) {
  rememberedProcessingStarts.delete(turnId)
  rememberedProcessingStarts.set(turnId, startedAt)

  while (rememberedProcessingStarts.size > maxRememberedProcessingStarts) {
    const oldestTurnId = rememberedProcessingStarts.keys().next().value
    if (!oldestTurnId) break
    rememberedProcessingStarts.delete(oldestTurnId)
  }
}

function hasNativeFinalAnswerCompleted(events: ConversationEvent[]) {
  return events.some((event) => {
    const native = getNativeCodexPayload(event)
    return (
      native?.method === "item/completed" &&
      native.params.item?.type === "agentMessage" &&
      native.params.item.phase === "final_answer"
    )
  })
}

function recoverAssistantMessageTurnIds(
  messages: readonly ConversationMessage[],
  events: readonly ConversationEvent[]
): ConversationMessage[] {
  const turnIdByItemId = new Map<string, string>()
  const turnIdByMessageId = new Map<string, string>()

  for (const event of events) {
    if (!event.turn_id) continue
    const native = getNativeCodexPayload(event)
    if (!native) continue

    if (native.local?.message_id) {
      turnIdByMessageId.set(native.local.message_id, event.turn_id)
    }
    if (
      (native.method === "item/started" ||
        native.method === "item/completed") &&
      (native.params.item.type === "agentMessage" ||
        native.params.item.type === "plan")
    ) {
      turnIdByItemId.set(native.params.item.id, event.turn_id)
    } else if (
      native.method === "item/agentMessage/delta" ||
      native.method === "item/plan/delta"
    ) {
      turnIdByItemId.set(native.params.itemId, event.turn_id)
    }
  }

  return messages.map((message) => {
    if (message.role !== "assistant" || message.turn_id) return message
    const turnId =
      (message.item_id ? turnIdByItemId.get(message.item_id) : undefined) ??
      turnIdByMessageId.get(message.id)
    return turnId ? { ...message, turn_id: turnId } : message
  })
}

function getConversationMessageRenderKey(message: ConversationMessage) {
  if (message.client_render_key) return message.client_render_key
  // The database message id replaces the temporary streaming id at completion,
  // while the native Codex item id remains stable for the whole lifecycle.
  if (message.role === "assistant" && message.item_id) {
    return `assistant-item-${message.item_id}`
  }
  return `message-${message.id}`
}

function getConversationActivityRenderKey(activity: ConversationActivity) {
  return activity.item_id
    ? `legacy-item-${activity.item_id}`
    : `legacy-${activity.id}`
}

type TurnTimelineEntry =
  | {
      id: string
      kind: "thinking"
      sequence?: number
      createdAt?: string
      fallbackOrder: number
    }
  | {
      id: string
      kind: "message"
      message: ConversationMessage
      sequence?: number
      createdAt?: string
      fallbackOrder: number
    }
  | {
      id: string
      kind: "guided_message"
      message: ConversationMessage
      sequence?: number
      createdAt?: string
      fallbackOrder: number
    }
  | {
      id: string
      kind: "legacy_activity"
      activity: ConversationActivity
      sequence?: number
      createdAt?: string
      fallbackOrder: number
    }
  | {
      id: string
      kind: "native_activity"
      activity: NativeLifecycleEntry
      sequence: number
      createdAt: string
      fallbackOrder: number
    }
  | {
      id: string
      kind: "native_tool_group"
      activities: NativeLifecycleEntry[]
      sequence: number
      createdAt: string
      fallbackOrder: number
    }
  | {
      id: string
      kind: "native_subagent_activity"
      activity: NativeSubAgentActivityViewModel
      sequence: number
      createdAt: string
      fallbackOrder: number
    }
  | {
      id: string
      kind: "native_subagent_activity_group"
      activities: NativeSubAgentActivityViewModel[]
      sequence: number
      createdAt: string
      fallbackOrder: number
    }
  | {
      id: string
      kind: "user_input_request"
      request: ConversationUserInputRequest
      sequence?: number
      createdAt: string
      fallbackOrder: number
    }

function compareTimelineEntries(
  left: TurnTimelineEntry,
  right: TurnTimelineEntry
) {
  if (left.sequence !== undefined && right.sequence !== undefined) {
    return left.sequence - right.sequence
  }
  const leftTime = left.createdAt ? Date.parse(left.createdAt) : Number.NaN
  const rightTime = right.createdAt ? Date.parse(right.createdAt) : Number.NaN
  if (Number.isFinite(leftTime) && Number.isFinite(rightTime)) {
    return leftTime - rightTime || left.fallbackOrder - right.fallbackOrder
  }
  return left.fallbackOrder - right.fallbackOrder
}

function isCollapsibleNativeToolActivity(
  entry: TurnTimelineEntry
): entry is Extract<TurnTimelineEntry, { kind: "native_activity" }> {
  if (entry.kind !== "native_activity") return false

  if (
    entry.activity.item.type === "fileChange" &&
    (entry.activity.item.changes?.length ?? 0) === 0
  ) {
    // Historical events may not contain a safe file-change preview. Keep
    // their generic activity title instead of swallowing them into an empty
    // semantic tool group.
    return false
  }

  if (isKnowledgeSearchNativeItem(entry.activity.item)) return false

  return (
    entry.activity.item.type === "commandExecution" ||
    entry.activity.item.type === "fileChange" ||
    entry.activity.item.type === "mcpToolCall" ||
    entry.activity.item.type === "webSearch" ||
    entry.activity.item.type === "dynamicToolCall"
  )
}

/**
 * Codex Desktop presents adjacent tool lifecycle items as one semantic
 * activity sentence (for example, "已读取文件 运行了多个命令 已搜索网页").
 * Keep message and reasoning entries as hard boundaries so the summary still
 * describes the exact block of work surrounding the assistant's narration.
 */
function groupAdjacentNativeToolActivities(
  entries: TurnTimelineEntry[]
): TurnTimelineEntry[] {
  const grouped: TurnTimelineEntry[] = []

  for (const entry of entries) {
    if (!isCollapsibleNativeToolActivity(entry)) {
      grouped.push(entry)
      continue
    }

    const previous = grouped.at(-1)
    if (previous?.kind === "native_tool_group") {
      grouped[grouped.length - 1] = {
        ...previous,
        activities: [...previous.activities, entry.activity],
      }
      continue
    }

    grouped.push({
      id: entry.id,
      kind: "native_tool_group",
      activities: [entry.activity],
      sequence: entry.sequence,
      createdAt: entry.createdAt,
      fallbackOrder: entry.fallbackOrder,
    })
  }

  return grouped
}

/**
 * Codex Desktop groups every adjacent subagent activity block, then de-dupes
 * repeated children inside that block by child thread id. A message or another
 * activity type remains a hard boundary between lifecycle groups.
 */
function groupAdjacentNativeSubAgentActivities(
  entries: TurnTimelineEntry[]
): TurnTimelineEntry[] {
  const grouped: TurnTimelineEntry[] = []

  for (const entry of entries) {
    const isVisibleSubAgentTransition =
      entry.kind === "native_subagent_activity" &&
      entry.activity.agents.length > 0
    if (!isVisibleSubAgentTransition) {
      grouped.push(entry)
      continue
    }

    const previous = grouped.at(-1)
    if (previous?.kind === "native_subagent_activity_group") {
      previous.activities.push(entry.activity)
      continue
    }

    grouped.push({
      id: `native-subagent-group-${entry.activity.itemId}`,
      kind: "native_subagent_activity_group",
      activities: [entry.activity],
      sequence: entry.sequence,
      createdAt: entry.createdAt,
      fallbackOrder: entry.fallbackOrder,
    })
  }

  return grouped
}

function isVisibleActiveNativeProcessingActivity(
  activity: NativeLifecycleEntry
) {
  if (activity.method !== "item/started") return false
  if (activity.item.type === "subAgentActivity") return false
  if (
    activity.item.type === "collabAgentToolCall" &&
    (activity.item.agents?.length ?? 0) > 0
  ) {
    return false
  }
  return true
}

function TurnSummary({
  turn,
  conversationId,
  running,
  activityOpen,
  activityCollapseAvailable,
  onActivityOpenChange,
  nativeActivityOpen,
  onNativeActivityOpenChange,
  activities,
  nativeEvents,
  subAgentSummaries,
  intermediateMessages,
  guidedMessages,
  userInputRequests,
  renderGuidedMessage,
  finalAnswerConfirmed,
  finalAnswerVisible,
  artifacts,
  artifactFilesById,
  loadArtifactPreview,
  onPreviewHtmlCode,
  onPreviewImage,
  onPreviewOfficeDocument,
  onDownload,
  downloadingFileId,
  loadedCapabilities,
  priorityCapabilities,
  usedCapabilities,
  plan,
  hasProcessedContent,
  hasActiveProcessing,
  reasoningSummary,
  hasBlockingRequest,
  hasStreamingResponse,
  completedWithoutOutput,
  processedStartedAt,
  conversationGoal,
  nativeReconnectStateOverride,
  selectedSubAgentId,
  onSubAgentSelect,
  onActivityDisclosureToggle,
}: {
  turn: ConversationTurn
  conversationId: string
  running: boolean
  activityOpen: boolean
  activityCollapseAvailable: boolean
  onActivityOpenChange: (open: boolean) => void
  nativeActivityOpen: (itemId: string) => boolean
  onNativeActivityOpenChange: (itemId: string, open: boolean) => void
  activities: ConversationActivity[]
  nativeEvents: ConversationEvent[]
  subAgentSummaries?: readonly NativeSubAgentSummary[]
  intermediateMessages: ConversationMessage[]
  guidedMessages: ConversationMessage[]
  userInputRequests: ConversationUserInputRequest[]
  renderGuidedMessage: (message: ConversationMessage) => ReactNode
  finalAnswerConfirmed: boolean
  finalAnswerVisible: boolean
  artifacts: ConversationFile[]
  artifactFilesById?: ReadonlyMap<string, ConversationFile>
  loadArtifactPreview?: LoadArtifactPreview
  onPreviewHtmlCode?: (html: string) => void
  onPreviewImage?: (item: ImagePreviewItem) => void
  onPreviewOfficeDocument?: (file: ConversationFile) => void
  onDownload: (file: ConversationFile) => void
  downloadingFileId?: string
  loadedCapabilities?: CapabilitySummary[]
  priorityCapabilities?: CapabilitySummary[]
  usedCapabilities?: CapabilitySummary[]
  plan?: ConversationTurnPlan | null
  hasProcessedContent: boolean
  hasActiveProcessing: boolean
  reasoningSummary?: string
  hasBlockingRequest: boolean
  hasStreamingResponse: boolean
  completedWithoutOutput: boolean
  processedStartedAt?: string
  conversationGoal?: ThreadGoal | null
  nativeReconnectStateOverride?: NativeReconnectDisplayState | null | undefined
  selectedSubAgentId?: string
  onSubAgentSelect?: (agent: NativeSubAgentViewModel) => void
  onActivityDisclosureToggle?: () => void
}) {
  const { t } = useTranslation()
  const productName = useProductName()
  const rawRunning = turn.status === "running"
  const interruptRequestedAt = turn.interrupt_requested_at ?? null
  const [nowMs, setNowMs] = useState(() => Date.now())
  const [observedProcessingStart, setObservedProcessingStart] = useState<{
    turnId: string
    startedAt: number
  } | null>(() => {
    const startedAt = rememberedProcessingStarts.get(turn.id)
    return startedAt === undefined ? null : { turnId: turn.id, startedAt }
  })
  const visibleActivities = collapseActivityLifecycle(activities).filter(
    (activity) => shouldDisplayConversationActivity(activity.type)
  )
  const terminalErrorActivity = visibleActivities.find(
    (activity) => activity.type === "error"
  )
  const nativeActivities = collapseNativeLifecycle(nativeEvents).filter(
    isVisibleNativeLifecycleEntry
  )
  const nativeSubAgentActivities = buildNativeSubAgentActivityViewModels(
    nativeActivities,
    {
      summaries: subAgentSummaries,
    }
  )
  const nativeSubAgentActivityByItemId = new Map(
    nativeSubAgentActivities.map((activity) => [activity.itemId, activity])
  )
  const nativeSubAgentProjectionItemIds = new Set(
    nativeActivities.flatMap((activity) => {
      if (activity.item.type === "subAgentActivity") {
        return [activity.item.id]
      }
      if (
        activity.item.type === "collabAgentToolCall" &&
        (activity.item.agents?.length ?? 0) > 0
      ) {
        return [activity.item.id]
      }
      return []
    })
  )
  const nativeSubAgentCoordinationActivities = nativeSubAgentActivities.filter(
    (activity) => activity.source === "collaboration"
  )
  const nativeSubAgentCoordinationSettled =
    nativeSubAgentCoordinationActivities.length > 0 &&
    nativeSubAgentCoordinationActivities.every((activity) => !activity.running)
  const nativeReconnectState =
    nativeReconnectStateOverride?.phase === "failed"
      ? nativeReconnectStateOverride
      : running
        ? (nativeReconnectStateOverride ?? null)
        : null
  const reconnectingState =
    nativeReconnectState?.phase === "reconnecting" ? nativeReconnectState : null
  const nativeReconnectFailed = nativeReconnectState?.phase === "failed"
  const visuallyRunning = running && !nativeReconnectFailed
  const imageGenerationRunning =
    visuallyRunning && nativeActivities.some(isRunningImageGenerationActivity)
  const interruptedForDisplay =
    nativeReconnectFailed ||
    Boolean(interruptRequestedAt) ||
    turn.status === "interrupted"
  const visibleIntermediateMessages = intermediateMessages.filter(
    (message) => message.content.trim().length > 0
  )
  let fallbackOrder = 0
  const timeline = groupAdjacentNativeSubAgentActivities(
    groupAdjacentNativeToolActivities(
      [
        ...visibleIntermediateMessages.map((message): TurnTimelineEntry => ({
          id: getConversationMessageRenderKey(message),
          kind: "message",
          message,
          sequence: message.event_sequence_no,
          createdAt: message.created_at,
          fallbackOrder: fallbackOrder++,
        })),
        ...guidedMessages.map((message): TurnTimelineEntry => ({
          id: getConversationMessageRenderKey(message),
          kind: "guided_message",
          message,
          sequence: message.event_sequence_no,
          createdAt: message.created_at,
          fallbackOrder: fallbackOrder++,
        })),
        ...userInputRequests.map((request): TurnTimelineEntry => ({
          id: `user-input-request-${request.id}`,
          kind: "user_input_request",
          request,
          createdAt: request.created_at,
          fallbackOrder: fallbackOrder++,
        })),
        ...visibleActivities.map((activity): TurnTimelineEntry => ({
          id: getConversationActivityRenderKey(activity),
          kind: "legacy_activity",
          activity,
          sequence: activity.sequence_no,
          createdAt: activity.created_at,
          fallbackOrder: fallbackOrder++,
        })),
        ...nativeActivities
          .filter(
            (activity) => !nativeSubAgentProjectionItemIds.has(activity.item.id)
          )
          .map((activity): TurnTimelineEntry => ({
            id: `native-${turn.id}-${activity.item.id}`,
            kind: "native_activity",
            activity,
            sequence: activity.sequence,
            createdAt: activity.createdAt,
            fallbackOrder: fallbackOrder++,
          })),
        ...nativeActivities.flatMap((nativeActivity): TurnTimelineEntry[] => {
          const activity = nativeSubAgentActivityByItemId.get(
            nativeActivity.item.id
          )
          if (!activity) return []
          return [
            {
              id: `native-subagent-${turn.id}-${activity.itemId}`,
              kind: "native_subagent_activity",
              activity,
              sequence: nativeActivity.sequence,
              createdAt: nativeActivity.createdAt,
              fallbackOrder: fallbackOrder++,
            },
          ]
        }),
      ].sort(compareTimelineEntries)
    )
  )
  const hasActivityDetails =
    turn.status === "failed" ||
    completedWithoutOutput ||
    Boolean(terminalErrorActivity) ||
    Boolean(loadedCapabilities?.length) ||
    Boolean(priorityCapabilities?.length) ||
    Boolean(usedCapabilities?.length) ||
    Boolean(plan?.total) ||
    Boolean(nativeReconnectState) ||
    timeline.length > 0
  const canCollapseActivity =
    hasActivityDetails && activityCollapseAvailable && !nativeReconnectFailed
  const progressAllowed =
    visuallyRunning &&
    hasProcessedContent &&
    !finalAnswerVisible &&
    !nativeReconnectState &&
    !hasBlockingRequest &&
    !hasStreamingResponse &&
    !terminalErrorActivity
  const showThinkingActivity = progressAllowed && !hasActiveProcessing
  const isSummaryEntry = (entry: TurnTimelineEntry | undefined) =>
    entry?.kind === "native_activity" ||
    entry?.kind === "native_tool_group" ||
    (entry?.kind === "legacy_activity" && entry.activity.type !== "error")
  const displayTimeline: TurnTimelineEntry[] =
    showThinkingActivity && !isSummaryEntry(timeline.at(-1))
      ? [
          ...timeline,
          { id: "thinking", kind: "thinking", fallbackOrder: fallbackOrder++ },
        ]
      : timeline
  const showActivityPanel = hasActivityDetails || showThinkingActivity

  const endedAt = nativeReconnectFailed
    ? new Date(nativeReconnectState.stoppedAtMs ?? nowMs).toISOString()
    : running
      ? null
      : interruptedForDisplay
        ? (turn.interrupted_at ?? turn.completed_at ?? interruptRequestedAt)
        : turn.completed_at
  const turnStartedAtMs = turn.started_at
    ? Date.parse(turn.started_at)
    : Number.NaN
  const endedAtMs = endedAt ? Date.parse(endedAt) : nowMs
  const explicitProcessingStartMs = processedStartedAt
    ? Date.parse(processedStartedAt)
    : Number.NaN
  const hasReliableExplicitProcessingStart =
    Number.isFinite(explicitProcessingStartMs) &&
    (!Number.isFinite(turnStartedAtMs) ||
      explicitProcessingStartMs >= turnStartedAtMs) &&
    (visuallyRunning ||
      !Number.isFinite(endedAtMs) ||
      explicitProcessingStartMs <= endedAtMs)
  useEffect(() => {
    if (
      !visuallyRunning ||
      !hasProcessedContent ||
      hasReliableExplicitProcessingStart ||
      observedProcessingStart?.turnId === turn.id
    ) {
      return
    }
    const startedAt = rememberedProcessingStarts.get(turn.id) ?? Date.now()
    rememberProcessingStart(turn.id, startedAt)
    const observationTimer = window.setTimeout(
      () =>
        setObservedProcessingStart({
          turnId: turn.id,
          startedAt,
        }),
      0
    )
    return () => window.clearTimeout(observationTimer)
  }, [
    hasProcessedContent,
    hasReliableExplicitProcessingStart,
    observedProcessingStart?.turnId,
    visuallyRunning,
    turn.id,
  ])

  const processingStartedAtMs = visuallyRunning
    ? hasReliableExplicitProcessingStart
      ? explicitProcessingStartMs
      : hasProcessedContent && observedProcessingStart?.turnId === turn.id
        ? observedProcessingStart.startedAt
        : Number.NaN
    : hasProcessedContent && Number.isFinite(turnStartedAtMs)
      ? turnStartedAtMs
      : hasReliableExplicitProcessingStart
        ? explicitProcessingStartMs
        : Number.NaN

  const goalForDuration =
    rawRunning &&
    turn.task_kind === "goal" &&
    conversationGoal?.status !== "complete"
      ? conversationGoal
      : null
  const goalClockActive = Boolean(
    hasProcessedContent && goalForDuration?.status === "active"
  )
  const goalNowMs = useGoalClockNow(goalClockActive)

  useEffect(() => {
    if (
      !visuallyRunning ||
      goalForDuration ||
      !Number.isFinite(processingStartedAtMs)
    ) {
      return
    }
    const timer = window.setInterval(() => setNowMs(Date.now()), 1_000)
    return () => window.clearInterval(timer)
  }, [goalForDuration, processingStartedAtMs, visuallyRunning])

  const duration =
    goalForDuration && hasProcessedContent
      ? formatGoalDuration(
          projectGoalElapsedSeconds(goalForDuration, goalNowMs)
        )
      : Number.isFinite(processingStartedAtMs)
        ? formatCompactDuration(
            new Date(processingStartedAtMs).toISOString(),
            endedAt,
            nowMs
          )
        : null
  const initialThinking =
    visuallyRunning &&
    !hasProcessedContent &&
    !nativeReconnectState &&
    !hasBlockingRequest
  const completedDurationLabel =
    !rawRunning && turn.status === "completed"
      ? t("conversation.elapsed")
      : null
  const statusLabel = initialThinking
    ? t("conversation.thinking")
    : interruptedForDisplay
      ? t("statuses.interrupted")
      : turn.status === "failed" ||
          completedWithoutOutput ||
          Boolean(terminalErrorActivity)
        ? t("statuses.failed")
        : rawRunning
          ? t("conversation.processing")
          : turn.status === "completed"
            ? completedDurationLabel
            : t(`statuses.${turn.status}`)
  const activityLabel = (activity: ConversationActivity) => {
    const fallbackKey = `conversation.activities.${activity.type}`
    const fallback = t(fallbackKey)
    if (activity.message_key) {
      const translated = t(activity.message_key)
      if (translated !== activity.message_key) return translated
    }
    const providedLabel = activity.label?.trim()
    if (
      providedLabel &&
      providedLabel !== activity.message_key &&
      !providedLabel.startsWith("conversation.activities.")
    ) {
      return providedLabel
    }
    return fallback === fallbackKey
      ? t("conversation.activities.working")
      : fallback
  }
  const summaryHeading = (
    <Marker
      render={<span />}
      variant="border"
      className="turn-summary-heading"
      data-initial-thinking={initialThinking || undefined}
      aria-busy={visuallyRunning || undefined}
      role={visuallyRunning ? "status" : undefined}
    >
      <MarkerContent
        className={cn(
          "turn-summary-marker-content",
          initialThinking && "shimmer"
        )}
      >
        <span className="turn-status">{statusLabel}</span>
        {duration && (
          <span
            className="turn-duration"
            aria-label={
              completedDurationLabel
                ? undefined
                : t("conversation.processingDuration", { duration })
            }
          >
            {duration}
          </span>
        )}
        {hasActivityDetails && canCollapseActivity && (
          <MarkerIcon className="turn-summary-chevron">
            <ChevronRightIcon className="size-3.5 transition-transform group-data-panel-open:rotate-90" />
          </MarkerIcon>
        )}
      </MarkerContent>
    </Marker>
  )
  const handleActivityOpenChange = (open: boolean) => {
    if (open !== activityOpen) onActivityDisclosureToggle?.()
    onActivityOpenChange(open)
  }
  return (
    <section
      className="turn-summary"
      aria-label={t("conversation.activity")}
      data-testid={`turn-summary-${turn.id}`}
    >
      <Collapsible
        open={canCollapseActivity ? activityOpen : true}
        onOpenChange={
          canCollapseActivity ? handleActivityOpenChange : undefined
        }
      >
        <CollapsibleTrigger
          disabled={!canCollapseActivity}
          role={canCollapseActivity ? undefined : "presentation"}
          tabIndex={canCollapseActivity ? undefined : -1}
          className={cn(
            "activity-trigger group font-medium",
            !canCollapseActivity && "activity-trigger-static"
          )}
          aria-label={
            canCollapseActivity
              ? t(
                  activityOpen
                    ? "conversation.collapseActivity"
                    : "conversation.expandActivity"
                )
              : undefined
          }
        >
          {summaryHeading}
        </CollapsibleTrigger>
        {showActivityPanel && (
          <CollapsibleContent className="activity-panel">
            <div className="activity-panel-inner">
              {turn.status === "failed" && (
                <p className="text-[var(--destructive)]">
                  {getPublicRuntimeMessage(
                    turn.error_message,
                    t("errors.codexTurnFailed")
                  )}
                </p>
              )}
              {completedWithoutOutput && !terminalErrorActivity && (
                <p className="text-[var(--destructive)]">
                  {t("errors.turnCompletedWithoutOutput")}
                </p>
              )}
              <CapabilityTrace
                label={t("conversation.loaded")}
                values={loadedCapabilities}
              />
              <CapabilityTrace
                label={t("conversation.priority")}
                values={priorityCapabilities}
              />
              <CapabilityTrace
                label={t("conversation.used")}
                values={usedCapabilities}
              />
              {plan && plan.total > 0 && (
                <ConversationPlanCard
                  steps={plan.steps}
                  currentStepIndex={plan.currentStepIndex}
                  changedFileCount={plan.changedFileCount}
                  running={visuallyRunning}
                  placement="inline"
                />
              )}
              {displayTimeline.map((entry, index) => {
                if (
                  entry.kind === "native_activity" ||
                  entry.kind === "native_tool_group" ||
                  entry.kind === "thinking" ||
                  (entry.kind === "legacy_activity" &&
                    entry.activity.type !== "error")
                ) {
                  const entries =
                    entry.kind === "native_activity"
                      ? [entry.activity]
                      : entry.kind === "native_tool_group"
                        ? entry.activities
                        : []
                  const firstActivity = entries[0]
                  const coordinationSettled =
                    firstActivity?.item.type === "collabAgentToolCall" &&
                    nativeSubAgentCoordinationSettled
                  const activityRunning =
                    entry.kind === "legacy_activity"
                      ? isRunningConversationActivity(entry.activity)
                      : !coordinationSettled &&
                        entries.some(isVisibleActiveNativeProcessingActivity)
                  const source: TurnActivitySource =
                    entry.kind === "thinking"
                      ? { kind: "thinking" }
                      : entry.kind === "legacy_activity"
                        ? {
                            kind: "legacy",
                            id: entry.id,
                            label: activityLabel(entry.activity),
                            running: activityRunning,
                            capabilityName: entry.activity.capability_name
                              ? formatFirstPartyCapabilityName(
                                  entry.activity.capability_name,
                                  productName
                                )
                              : undefined,
                          }
                        : {
                            kind: "native",
                            activities: entries,
                            grouped: entry.kind === "native_tool_group",
                          }
                  const progress =
                    index === displayTimeline.length - 1 && progressAllowed
                      ? showThinkingActivity
                        ? "thinking"
                        : activityRunning
                          ? "active"
                          : undefined
                      : undefined
                  return (
                    <TurnActivityItem
                      key={`activity-after-${displayTimeline[index - 1]?.id ?? turn.id}`}
                      source={source}
                      progress={progress}
                      reasoningSummary={reasoningSummary}
                      stopped={
                        !running || nativeReconnectFailed || coordinationSettled
                      }
                      artifactFilesById={artifactFilesById}
                      loadArtifactPreview={loadArtifactPreview}
                      onPreviewImage={onPreviewImage}
                      open={
                        firstActivity
                          ? nativeActivityOpen(firstActivity.item.id)
                          : false
                      }
                      onOpenChange={
                        firstActivity
                          ? (open) => {
                              onActivityDisclosureToggle?.()
                              onNativeActivityOpenChange(
                                firstActivity.item.id,
                                open
                              )
                            }
                          : undefined
                      }
                    />
                  )
                }
                if (entry.kind === "guided_message") {
                  if (canCollapseActivity && !activityOpen) return null
                  return (
                    <div key={entry.id} className="turn-guidance-message">
                      {renderGuidedMessage(entry.message)}
                    </div>
                  )
                }
                if (entry.kind === "message") {
                  const commentaryRunning =
                    visuallyRunning &&
                    !finalAnswerConfirmed &&
                    entry.message.streaming === true
                  return (
                    <div
                      key={entry.id}
                      className="process-commentary"
                      data-final-answer-visible={finalAnswerVisible}
                      data-running={commentaryRunning || undefined}
                      aria-busy={commentaryRunning || undefined}
                      aria-label={t("conversation.intermediateMessage")}
                    >
                      <AssistantMarkdown
                        content={entry.message.content}
                        streaming={commentaryRunning}
                        knowledgeAssetScope={{
                          conversationId,
                          turnId: turn.id,
                        }}
                        artifactFilesById={artifactFilesById}
                        loadArtifactPreview={loadArtifactPreview}
                        onPreviewHtmlCode={onPreviewHtmlCode}
                        onPreviewImage={onPreviewImage}
                      />
                    </div>
                  )
                }
                if (entry.kind === "native_subagent_activity") {
                  return (
                    <NativeSubAgentActivityItem
                      key={entry.id}
                      activity={entry.activity}
                      stopped={nativeReconnectFailed}
                      selectedAgentId={selectedSubAgentId}
                      onAgentSelect={onSubAgentSelect}
                    />
                  )
                }
                if (entry.kind === "native_subagent_activity_group") {
                  return (
                    <NativeSubAgentActivityGroup
                      key={entry.id}
                      activities={entry.activities}
                      stopped={nativeReconnectFailed}
                      selectedAgentId={selectedSubAgentId}
                      onAgentSelect={onSubAgentSelect}
                    />
                  )
                }
                if (entry.kind === "user_input_request") {
                  return (
                    <div key={entry.id} className="py-1">
                      <ConversationUserInputRequestCard
                        request={entry.request}
                        submitting={false}
                      />
                    </div>
                  )
                }
                const activityRunning =
                  visuallyRunning &&
                  isRunningConversationActivity(entry.activity)
                const activityFailed = entry.activity.type === "error"
                return (
                  <Marker
                    key={entry.id}
                    className={cn(
                      "activity-item legacy-activity-item conversation-marker",
                      activityFailed && "text-destructive"
                    )}
                    data-running={activityRunning || undefined}
                    aria-busy={activityRunning || undefined}
                    role={activityRunning ? "status" : undefined}
                  >
                    <MarkerIcon>
                      {activityFailed ? (
                        <CircleAlertIcon
                          className="size-3.5"
                          aria-hidden="true"
                        />
                      ) : (
                        <WrenchIcon className="size-3.5" aria-hidden="true" />
                      )}
                    </MarkerIcon>
                    <MarkerContent className="conversation-marker-content">
                      <span className={cn(activityRunning && "shimmer")}>
                        {activityLabel(entry.activity)}
                      </span>
                      {entry.activity.capability_name && (
                        <span className="trace-chip">
                          {formatFirstPartyCapabilityName(
                            entry.activity.capability_name,
                            productName
                          )}
                        </span>
                      )}
                    </MarkerContent>
                  </Marker>
                )
              })}
              {reconnectingState && (
                <Marker
                  className="activity-item live-reasoning-summary turn-reconnecting-activity conversation-marker"
                  data-running="true"
                  aria-busy="true"
                  role="status"
                  aria-live="polite"
                  aria-atomic="true"
                >
                  <MarkerIcon className="turn-reconnecting-icon">
                    <WifiIcon className="size-3.5" aria-hidden="true" />
                  </MarkerIcon>
                  <MarkerContent className="turn-reconnecting-label shimmer">
                    {t("conversation.activities.reconnectingAttempt", {
                      attempt: reconnectingState.attempt,
                      total: reconnectingState.attemptsPerRound,
                    })}
                  </MarkerContent>
                </Marker>
              )}
              {nativeReconnectFailed && (
                <div className="turn-reconnect-failure" role="alert">
                  <CircleAlertIcon
                    className="turn-reconnect-failure-icon size-4"
                    aria-hidden="true"
                  />
                  <span>
                    {t("conversation.streamDisconnectedBeforeCompletion")}
                  </span>
                </div>
              )}
            </div>
          </CollapsibleContent>
        )}
      </Collapsible>
      {canCollapseActivity &&
        !activityOpen &&
        guidedMessages.map((message) => (
          <div
            key={getConversationMessageRenderKey(message)}
            className="turn-guidance-message"
          >
            {renderGuidedMessage(message)}
          </div>
        ))}
      {canCollapseActivity &&
        !activityOpen &&
        userInputRequests.map((request) => (
          <div
            key={`collapsed-user-input-request-${request.id}`}
            className="py-1"
          >
            <ConversationUserInputRequestCard
              request={request}
              submitting={false}
            />
          </div>
        ))}
      <ArtifactFiles
        files={artifacts}
        loadPreview={loadArtifactPreview}
        onPreviewOfficeDocument={onPreviewOfficeDocument}
        onDownload={onDownload}
        downloadingFileId={downloadingFileId}
      />
      {imageGenerationRunning && (
        <AssistantHtmlPreviewLoading
          className="turn-image-generation-loading mt-4 aspect-square min-h-0 max-w-[20rem]"
          label={t("conversation.imageGeneration.loading")}
        />
      )}
    </section>
  )
}

export function ConversationThread({
  conversation,
  knowledgeBases = emptyKnowledgeBases,
  applicationKnowledgeBases = emptyApplicationKnowledgeBases,
  modelCatalog = emptyModelCatalog,
  liveReasoningSummaries = emptyLiveReasoningSummaries,
  nativeReconnectState,
  reconcilingCompletedTurnId,
  loadAttachmentPreview,
  loadArtifactPreview,
  onPreviewOfficeDocument,
  onPreviewHtmlCode,
  onPreviewImage,
  onPreviewPresentation,
  onDownload,
  downloadingFileId,
  onRegenerateMessage,
  onForkMessage,
  forkingDisabled = false,
  editingDisabled = false,
  showNewTaskWelcome = false,
  onStarterQuestionSelect,
  suppressEmptyState = false,
  emptyStateContent,
  emptyNotice,
  blockingPanel,
  blockingPanelKey,
  onBlockingPanelReveal,
  scrollContainerRef,
  contentRef,
  selectedSubAgent,
  subAgentSummariesByTurnId,
  onSubAgentSelect,
  onActivityDisclosureToggle,
  embedded = false,
  defaultActivityOpen = false,
  hideMessageActions = false,
  navigationRef,
  onVisibleMessageChange,
  history,
}: {
  conversation: Conversation
  knowledgeBases?: KnowledgeBase[]
  applicationKnowledgeBases?: readonly ApplicationKnowledgeBase[]
  modelCatalog?: ModelPreference["models"]
  liveReasoningSummaries?: StreamingReasoningSummaries
  nativeReconnectState?: NativeReconnectDisplayState | null
  reconcilingCompletedTurnId?: string
  loadAttachmentPreview?: LoadAttachmentPreview
  loadArtifactPreview?: LoadArtifactPreview
  onPreviewOfficeDocument?: (file: ConversationFile) => void
  onPreviewHtmlCode?: (html: string) => void
  onPreviewImage?: (item: ImagePreviewItem) => void
  /** @deprecated Use onPreviewOfficeDocument. */
  onPreviewPresentation?: (file: ConversationFile) => void
  onDownload: (file: ConversationFile) => void
  downloadingFileId?: string
  onRegenerateMessage?: (
    message: ConversationMessage,
    nextContent: string
  ) => Promise<void>
  onForkMessage?: (message: ConversationMessage) => Promise<void>
  forkingDisabled?: boolean
  editingDisabled?: boolean
  showNewTaskWelcome?: boolean
  onStarterQuestionSelect?: (prompt: string) => void
  suppressEmptyState?: boolean
  emptyStateContent?: ReactNode
  emptyNotice?: ReactNode
  blockingPanel?: ReactNode
  blockingPanelKey?: string | null
  onBlockingPanelReveal?: () => void
  scrollContainerRef?: Ref<HTMLDivElement>
  contentRef?: Ref<HTMLDivElement>
  selectedSubAgent?: { turnId: string; agentId: string }
  subAgentSummariesByTurnId?: ReadonlyMap<
    string,
    readonly NativeSubAgentSummary[]
  >
  onSubAgentSelect?: (selection: {
    turnId: string
    agent: NativeSubAgentViewModel
  }) => void
  onActivityDisclosureToggle?: () => void
  embedded?: boolean
  defaultActivityOpen?: boolean
  hideMessageActions?: boolean
  navigationRef?: Ref<ConversationThreadNavigation>
  onVisibleMessageChange?: (ids: string[]) => void
  history?: ConversationHistoryControl
}) {
  const { t } = useTranslation()
  const productName = useProductName()
  const openOfficeDocument = onPreviewOfficeDocument ?? onPreviewPresentation
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null)
  const [turnActivityOpenByKey, setTurnActivityOpenByKey] = useState<
    Record<string, boolean>
  >({})
  const [
    turnActivityOpenedDuringProcessingByKey,
    setTurnActivityOpenedDuringProcessingByKey,
  ] = useState<Record<string, boolean>>({})
  const [nativeActivityOpenByKey, setNativeActivityOpenByKey] = useState<
    Record<string, boolean>
  >({})
  const blockingPanelContainerRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!blockingPanelKey) return
    onBlockingPanelReveal?.()
    blockingPanelContainerRef.current
      ?.querySelector<HTMLElement>('[role="region"]')
      ?.focus({ preventScroll: true })
  }, [blockingPanelKey, onBlockingPanelReveal])

  const messages = recoverAssistantMessageTurnIds(
    conversation.messages ?? [],
    conversation.events ?? []
  )
  const planMessageIds = new Set(
    (conversation.plan_reviews ?? []).map((review) => review.plan_message_id)
  )
  const planImplementationTurnIds = new Set(
    (conversation.plan_reviews ?? []).flatMap((review) =>
      review.status === "resolved" &&
      review.decision === "implement" &&
      review.follow_up_turn_id
        ? [review.follow_up_turn_id]
        : []
    )
  )
  const isProposedPlanMessage = (message: ConversationMessage) =>
    message.role === "assistant" &&
    (message.output_kind === "plan" || planMessageIds.has(message.id))
  const isHiddenPlanImplementationMessage = (message: ConversationMessage) =>
    message.role === "user" &&
    Boolean(message.turn_id && planImplementationTurnIds.has(message.turn_id))
  const showWelcome =
    showNewTaskWelcome && !suppressEmptyState && messages.length === 0
  const turns = [...(conversation.turns ?? [])]
  if (
    conversation.running_turn &&
    !turns.some((turn) => turn.id === conversation.running_turn?.id)
  ) {
    turns.push(conversation.running_turn)
  }
  const latestTurn = turns.at(-1)
  const activeRunningTurn =
    conversation.running_turn?.status === "running" &&
    !conversation.running_turn.interrupt_requested_at
      ? conversation.running_turn
      : [...turns]
          .reverse()
          .find(
            (turn) => turn.status === "running" && !turn.interrupt_requested_at
          )
  const activeRunningTurnId = activeRunningTurn?.id
  const isTurnActiveRunning = (turn: ConversationTurn) =>
    turn.status === "running" && turn.id === activeRunningTurnId
  const recentTurn = activeRunningTurn ?? latestTurn
  const messageEditingDisabled =
    editingDisabled || turns.some(isTurnActiveRunning)
  const capabilitiesById = useMemo(
    () =>
      new Map(
        (conversation.available_capabilities ?? []).map((capability) => [
          capability.id,
          capability,
        ])
      ),
    [conversation.available_capabilities]
  )
  const knowledgeBaseNamesById = useMemo(() => {
    const names = new Map(
      knowledgeBases.map(
        (knowledgeBase) => [knowledgeBase.id, knowledgeBase.name] as const
      )
    )
    for (const knowledgeBase of applicationKnowledgeBases) {
      names.set(knowledgeBase.id, knowledgeBase.name)
    }
    return names
  }, [applicationKnowledgeBases, knowledgeBases])
  const modelNamesById = useMemo(
    () =>
      new Map(
        modelCatalog.map((model) => [model.id, model.display_name] as const)
      ),
    [modelCatalog]
  )
  const turnById = new Map(turns.map((turn) => [turn.id, turn]))
  const modelChangeByTurnId = new Map<
    string,
    { previousModel: string; currentModel: string }
  >()
  for (let index = 1; index < turns.length; index += 1) {
    const previousTurn = turns[index - 1]
    const currentTurn = turns[index]
    if (
      previousTurn?.model &&
      currentTurn?.model &&
      previousTurn.model !== currentTurn.model
    ) {
      modelChangeByTurnId.set(currentTurn.id, {
        previousModel:
          modelNamesById.get(previousTurn.model) ?? previousTurn.model,
        currentModel:
          modelNamesById.get(currentTurn.model) ?? currentTurn.model,
      })
    }
  }
  const conversationFilesById = new Map<string, ConversationFile>()
  const indexConversationFile = (file: ConversationFile) =>
    conversationFilesById.set(file.id.toLowerCase(), file)
  conversation.attachments?.forEach(indexConversationFile)
  conversation.artifacts?.forEach(indexConversationFile)
  conversation.pending_requests?.forEach((request) =>
    request.attachments?.forEach(indexConversationFile)
  )
  messages.forEach((message) => {
    message.attachments?.forEach(indexConversationFile)
    message.artifacts?.forEach(indexConversationFile)
  })
  const inlineArtifactIds = new Set<string>()
  for (const message of messages) {
    if (message.role !== "assistant") continue
    for (const id of collectInlineArtifactIds(message.content)) {
      inlineArtifactIds.add(id)
    }
  }
  for (const event of conversation.events ?? []) {
    const native = getNativeCodexPayload(event)
    if (
      (native?.method === "item/started" ||
        native?.method === "item/completed") &&
      native.params.item.type === "imageView" &&
      native.params.item.fileId
    ) {
      inlineArtifactIds.add(native.params.item.fileId.toLowerCase())
    }
  }
  const visibleArtifacts = (files: ConversationFile[] | undefined) => {
    if (!files?.some((file) => inlineArtifactIds.has(file.id.toLowerCase()))) {
      return files
    }
    return files.filter((file) => !inlineArtifactIds.has(file.id.toLowerCase()))
  }
  const editableMessageId =
    !messageEditingDisabled && latestTurn && !isTurnActiveRunning(latestTurn)
      ? messages.find(
          (message) =>
            message.role === "user" &&
            !isHiddenPlanImplementationMessage(message) &&
            message.turn_id === latestTurn.id &&
            message.usage_type !== "steer_current_turn" &&
            !isStructuredUserMessage(message)
        )?.id
      : undefined
  const assistantMessagesByTurn = new Map<string, ConversationMessage[]>()
  const firstAssistantMessageByTurn = new Map<string, string>()
  const firstUserMessageByTurn = new Map<string, string>()
  for (const message of messages) {
    if (
      message.role === "user" &&
      !isHiddenPlanImplementationMessage(message) &&
      message.turn_id &&
      message.usage_type !== "steer_current_turn" &&
      !firstUserMessageByTurn.has(message.turn_id)
    ) {
      firstUserMessageByTurn.set(message.turn_id, message.id)
    }
    if (message.role !== "assistant" || !message.turn_id) continue
    const messages = assistantMessagesByTurn.get(message.turn_id) ?? []
    messages.push(message)
    assistantMessagesByTurn.set(message.turn_id, messages)
    if (!firstAssistantMessageByTurn.has(message.turn_id)) {
      firstAssistantMessageByTurn.set(message.turn_id, message.id)
    }
  }
  const messagesById = new Map(messages.map((message) => [message.id, message]))
  const latestUnassignedUserMessage = [...messages]
    .reverse()
    .find(
      (message) =>
        message.role === "user" &&
        !message.turn_id &&
        message.usage_type !== "steer_current_turn"
    )
  const getTurnRenderKey = (turn: ConversationTurn) => {
    const firstUserMessageId = firstUserMessageByTurn.get(turn.id)
    const anchorMessage = firstUserMessageId
      ? messagesById.get(firstUserMessageId)
      : turn.id === recentTurn?.id
        ? latestUnassignedUserMessage
        : undefined
    return anchorMessage
      ? getConversationMessageRenderKey(anchorMessage)
      : `turn-${turn.id}`
  }
  const finalMessageByTurn = new Map<string, ConversationMessage>()
  for (const [turnId, messages] of assistantMessagesByTurn) {
    const agentMessages = messages.filter(
      (message) => !isProposedPlanMessage(message)
    )
    const explicitFinal = [...agentMessages]
      .reverse()
      .find((message) => message.phase === "final_answer")
    const fallbackFinal =
      !explicitFinal && turnById.get(turnId)?.status !== "running"
        ? [...agentMessages].reverse().find((message) => !message.phase)
        : undefined
    const finalMessage = explicitFinal ?? fallbackFinal
    if (finalMessage) finalMessageByTurn.set(turnId, finalMessage)
  }
  const lastMessageIdByTurn = new Map<string, string>()
  for (const message of messages) {
    if (message.turn_id) lastMessageIdByTurn.set(message.turn_id, message.id)
  }
  const completedGoal =
    conversation.goal?.status === "complete" ? conversation.goal : null
  const completedGoalDurationLabel = completedGoal
    ? formatGoalDuration(completedGoal.time_used_seconds)
    : null
  const completedGoalMessage =
    completedGoal && completedGoalDurationLabel
      ? ([...turns]
          .reverse()
          .map((turn) => finalMessageByTurn.get(turn.id))
          .find(
            (message) =>
              message &&
              (message.content.trim().length > 0 ||
                Boolean(message.attachments?.length) ||
                Boolean(message.artifacts?.length))
          ) ??
        [...messages]
          .reverse()
          .find(
            (message) =>
              message.role === "assistant" &&
              (message.content.trim().length > 0 ||
                Boolean(message.attachments?.length) ||
                Boolean(message.artifacts?.length))
          ))
      : undefined
  const activitiesByTurn = new Map<string, ConversationActivity[]>()
  for (const activity of conversation.activities ?? []) {
    const turnId = activity.turn_id ?? recentTurn?.id
    if (!turnId) continue
    const values = activitiesByTurn.get(turnId) ?? []
    values.push(activity)
    activitiesByTurn.set(turnId, values)
  }
  const nativeEventsByTurn = new Map<string, ConversationEvent[]>()
  for (const event of conversation.events ?? []) {
    if (!getNativeCodexPayload(event)) continue
    const turnId = event.turn_id ?? recentTurn?.id
    if (!turnId) continue
    const values = nativeEventsByTurn.get(turnId) ?? []
    values.push(event)
    nativeEventsByTurn.set(turnId, values)
  }
  const artifactsByTurn = new Map<string, Map<string, ConversationFile>>()
  const addTurnArtifact = (file: ConversationFile) => {
    if (inlineArtifactIds.has(file.id.toLowerCase())) return
    if (!file.turn_id) return
    const files = artifactsByTurn.get(file.turn_id) ?? new Map()
    files.set(file.id, file)
    artifactsByTurn.set(file.turn_id, files)
  }
  for (const message of messages) {
    message.artifacts?.forEach(addTurnArtifact)
  }
  conversation.artifacts?.forEach(addTurnArtifact)
  const guidedMessagesByTurn = new Map<string, ConversationMessage[]>()
  for (const message of messages) {
    if (
      message.role !== "user" ||
      message.usage_type !== "steer_current_turn" ||
      !message.turn_id
    ) {
      continue
    }
    const guidedMessages = guidedMessagesByTurn.get(message.turn_id) ?? []
    guidedMessages.push(message)
    guidedMessagesByTurn.set(message.turn_id, guidedMessages)
  }
  const renderConversationMessage = (
    message: ConversationMessage,
    isFinal = false
  ) => {
    const turn = message.turn_id ? turnById.get(message.turn_id) : undefined
    const displayMessage =
      message.usage_type === "steer_current_turn"
        ? {
            ...message,
            attachments: [],
            selected_capabilities: [],
            selected_knowledge_base_ids: [],
          }
        : message
    const resolvedArtifacts =
      isFinal && turn
        ? [...(artifactsByTurn.get(turn.id)?.values() ?? [])]
        : visibleArtifacts(displayMessage.artifacts)
    const currentArtifacts = displayMessage.artifacts
    const artifactsUnchanged =
      (currentArtifacts?.length ?? 0) === (resolvedArtifacts?.length ?? 0) &&
      (resolvedArtifacts?.every(
        (file, index) => currentArtifacts?.[index] === file
      ) ??
        true)
    const messageForRender = artifactsUnchanged
      ? displayMessage
      : { ...displayMessage, artifacts: resolvedArtifacts }
    const officeAnnotation = getOfficeAnnotationDisplay(message.display)
    return (
      <Message
        key={getConversationMessageRenderKey(message)}
        message={messageForRender}
        conversationId={conversation.id}
        modelName={
          turn?.model
            ? (modelNamesById.get(turn.model) ?? turn.model)
            : undefined
        }
        capabilitiesById={capabilitiesById}
        knowledgeBaseNamesById={knowledgeBaseNamesById}
        applicationManagedKnowledgeBaseLabel={
          message.application || conversation.application
            ? t("conversation.applicationManagedKnowledgeBase")
            : undefined
        }
        artifactFilesById={conversationFilesById}
        loadAttachmentPreview={loadAttachmentPreview}
        loadArtifactPreview={loadArtifactPreview}
        onPreviewHtmlCode={onPreviewHtmlCode}
        onPreviewImage={onPreviewImage}
        onPreviewOfficeDocument={openOfficeDocument}
        officeFile={
          officeAnnotation
            ? conversationFilesById.get(officeAnnotation.file_id)
            : undefined
        }
        downloadingFileId={downloadingFileId}
        onDownload={onDownload}
        editing={editingMessageId === message.id}
        editingDisabled={messageEditingDisabled}
        onEditStart={() => setEditingMessageId(message.id)}
        onEditCancel={() => setEditingMessageId(null)}
        onRegenerateMessage={
          message.id === editableMessageId ? onRegenerateMessage : undefined
        }
        onForkMessage={
          message.role === "assistant" &&
          message.turn_id &&
          lastMessageIdByTurn.get(message.turn_id) === message.id &&
          turn &&
          ["completed", "failed", "interrupted"].includes(turn.status)
            ? onForkMessage
            : undefined
        }
        forkDisabled={forkingDisabled}
        isGoalTask={Boolean(
          message.role === "user" &&
          turn?.task_kind === "goal" &&
          firstUserMessageByTurn.get(turn.id) === message.id
        )}
        goalCompletion={
          message.id === completedGoalMessage?.id && completedGoalDurationLabel
            ? { durationLabel: completedGoalDurationLabel }
            : undefined
        }
        proposedPlan={isProposedPlanMessage(message)}
        hideActions={hideMessageActions}
      />
    )
  }
  const summaryFor = (turn: ConversationTurn) => {
    const turnRunning = isTurnActiveRunning(turn)
    const turnRenderKey = getTurnRenderKey(turn)
    const turnActivityKey = `${conversation.id}:${turnRenderKey}`
    const turnNativeEvents = nativeEventsByTurn.get(turn.id) ?? []
    const turnAssistantMessages = assistantMessagesByTurn.get(turn.id) ?? []
    const turnGuidedMessages = guidedMessagesByTurn.get(turn.id) ?? []
    const turnActivities = activitiesByTurn.get(turn.id) ?? []
    const turnArtifacts = [...(artifactsByTurn.get(turn.id)?.values() ?? [])]
    const turnTerminalFormRequests = conversation.user_input_requests.filter(
      (request) =>
        request.turn_id === turn.id &&
        request.kind === "form" &&
        request.status !== "pending" &&
        request.status !== "answering"
    )
    const selectedTurnPlan = selectConversationTurnPlan(
      turnNativeEvents,
      turn.id
    )
    const turnPlan = selectedTurnPlan
      ? {
          ...selectedTurnPlan,
          changedFileCount: Math.max(
            selectedTurnPlan.changedFileCount,
            conversation.turn_file_change_counts?.[turn.id] ?? 0
          ),
        }
      : null
    const turnLiveReasoningSummaries = Object.values(
      liveReasoningSummaries
    ).filter(
      (summary) => summary.turnId === turn.id && summary.text.trim().length > 0
    )
    const reasoningSummary = selectReasoningActivitySummary(
      turn.id,
      liveReasoningSummaries,
      turnNativeEvents
    )
    const processedAssistantMessages = turnAssistantMessages.filter(
      (message) =>
        message.content.trim().length > 0 ||
        Boolean(message.attachments?.length) ||
        Boolean(message.artifacts?.length)
    )
    const visibleTurnActivities = turnActivities.filter((activity) =>
      shouldDisplayConversationActivity(activity.type)
    )
    const visibleNativeActivities = collapseNativeLifecycle(
      turnNativeEvents
    ).filter(isVisibleNativeLifecycleEntry)
    const visiblePlanEvents = turnNativeEvents.filter((event) => {
      const native = getNativeCodexPayload(event)
      return (
        native?.method === "turn/plan/updated" && native.params.plan.length > 0
      )
    })
    const finalMessage = finalMessageByTurn.get(turn.id)
    // app-server providers can revise agentMessage.phase at item/completed.
    // Keep prior activity expanded while a started item is still streaming,
    // even when its provisional phase says final_answer.
    const turnFinalAnswerConfirmed =
      (finalMessage?.phase === "final_answer" &&
        finalMessage.streaming !== true) ||
      (turn.status === "completed" && finalMessageByTurn.has(turn.id)) ||
      hasNativeFinalAnswerCompleted(turnNativeEvents)
    const finalContentAvailable = Boolean(
      finalMessage &&
      (finalMessage.content.trim().length > 0 ||
        finalMessage.attachments?.length ||
        finalMessage.artifacts?.length)
    )
    const finalAnswerVisible = turnFinalAnswerConfirmed && finalContentAvailable
    const hasTurnArtifactOutput =
      turnArtifacts.length > 0 ||
      Boolean(
        conversation.artifacts?.some((artifact) => artifact.turn_id === turn.id)
      ) ||
      turnAssistantMessages.some((message) =>
        Boolean(message.artifacts?.length)
      )
    const completedWithoutOutput =
      turn.status === "completed" &&
      turn.id !== reconcilingCompletedTurnId &&
      turn.task_kind !== "compact" &&
      processedAssistantMessages.length === 0 &&
      !hasTurnArtifactOutput
    const hasProcessedContent =
      processedAssistantMessages.length > 0 ||
      turnGuidedMessages.length > 0 ||
      visibleTurnActivities.length > 0 ||
      visibleNativeActivities.length > 0 ||
      visiblePlanEvents.length > 0 ||
      turnLiveReasoningSummaries.length > 0 ||
      Boolean(reasoningSummary) ||
      turnTerminalFormRequests.length > 0 ||
      turnArtifacts.length > 0
    // Reasoning labels the fallback; it must not count as a separate active
    // tool and suppress the status row between tool calls.
    const hasActiveProcessing =
      processedAssistantMessages.some(
        (message) =>
          message.streaming === true &&
          (message.phase === "final_answer" || !turnFinalAnswerConfirmed)
      ) ||
      collapseActivityLifecycle(visibleTurnActivities).some(
        isRunningConversationActivity
      ) ||
      visibleNativeActivities.some(isVisibleActiveNativeProcessingActivity)
    const processedStartedAt = earliestTimestamp([
      ...processedAssistantMessages.map((message) => message.created_at),
      ...visibleTurnActivities.map((activity) => activity.created_at),
      ...visibleNativeActivities.map((activity) => activity.createdAt),
      ...visiblePlanEvents.map((event) => event.created_at),
      ...turnLiveReasoningSummaries.map((summary) => summary.createdAt),
      reasoningSummary?.createdAt,
      ...turnTerminalFormRequests.map((request) => request.created_at),
      ...turnArtifacts.map((artifact) => artifact.created_at),
    ])
    const activityCollapseAvailable =
      !turnRunning || (turnFinalAnswerConfirmed && finalContentAvailable)
    const activityOpenedDuringProcessing =
      turnActivityOpenedDuringProcessingByKey[turnActivityKey] ?? false
    const defaultTurnActivityOpen =
      turnRunning || defaultActivityOpen || !activityCollapseAvailable
    const activityOpen =
      !turnRunning && finalContentAvailable && activityOpenedDuringProcessing
        ? false
        : (turnActivityOpenByKey[turnActivityKey] ?? defaultTurnActivityOpen)
    const nativeActivityKey = (itemId: string) =>
      `${conversation.id}:${turnRenderKey}:${itemId}`

    return (
      <TurnSummary
        key={`turn-summary-${turnRenderKey}`}
        turn={turn}
        conversationId={conversation.id}
        running={turnRunning}
        activityOpen={activityOpen}
        activityCollapseAvailable={activityCollapseAvailable}
        onActivityOpenChange={(open) => {
          setTurnActivityOpenByKey((current) => ({
            ...current,
            [turnActivityKey]: open,
          }))
          setTurnActivityOpenedDuringProcessingByKey((current) => {
            if (!(turnActivityKey in current)) return current
            const next = { ...current }
            delete next[turnActivityKey]
            return next
          })
        }}
        nativeActivityOpen={(itemId) =>
          nativeActivityOpenByKey[nativeActivityKey(itemId)] ?? false
        }
        onNativeActivityOpenChange={(itemId, open) => {
          setTurnActivityOpenByKey((current) =>
            turnActivityKey in current
              ? current
              : { ...current, [turnActivityKey]: activityOpen }
          )
          if (!activityCollapseAvailable) {
            setTurnActivityOpenedDuringProcessingByKey((current) =>
              turnActivityKey in current
                ? current
                : { ...current, [turnActivityKey]: true }
            )
          }
          setNativeActivityOpenByKey((current) => ({
            ...current,
            [nativeActivityKey(itemId)]: open,
          }))
        }}
        activities={turnActivities}
        nativeEvents={turnNativeEvents}
        subAgentSummaries={subAgentSummariesByTurnId?.get(turn.id)}
        nativeReconnectStateOverride={
          turnRunning ||
          (nativeReconnectState?.phase === "failed" &&
            nativeReconnectState.turnId === turn.id)
            ? nativeReconnectState
            : undefined
        }
        hasProcessedContent={hasProcessedContent}
        hasActiveProcessing={hasActiveProcessing}
        reasoningSummary={reasoningSummary?.text}
        hasBlockingRequest={conversation.user_input_requests.some(
          (request) =>
            request.turn_id === turn.id &&
            (request.status === "pending" || request.status === "answering")
        )}
        hasStreamingResponse={processedAssistantMessages.some(
          (message) => message.streaming === true
        )}
        completedWithoutOutput={completedWithoutOutput}
        processedStartedAt={processedStartedAt}
        conversationGoal={conversation.goal}
        plan={turnRunning ? null : turnPlan}
        intermediateMessages={turnAssistantMessages.filter(
          (message) =>
            finalMessageByTurn.get(turn.id)?.id !== message.id &&
            !isProposedPlanMessage(message)
        )}
        guidedMessages={turnGuidedMessages}
        userInputRequests={turnTerminalFormRequests}
        renderGuidedMessage={(message) => renderConversationMessage(message)}
        finalAnswerConfirmed={turnFinalAnswerConfirmed}
        finalAnswerVisible={finalAnswerVisible}
        artifacts={finalMessageByTurn.has(turn.id) ? [] : turnArtifacts}
        artifactFilesById={conversationFilesById}
        loadArtifactPreview={loadArtifactPreview}
        onPreviewHtmlCode={onPreviewHtmlCode}
        onPreviewImage={onPreviewImage}
        onPreviewOfficeDocument={openOfficeDocument}
        onDownload={onDownload}
        downloadingFileId={downloadingFileId}
        loadedCapabilities={
          turn.id === recentTurn?.id
            ? conversation.loaded_capabilities
            : undefined
        }
        priorityCapabilities={
          turn.id === recentTurn?.id
            ? conversation.priority_capabilities
            : undefined
        }
        usedCapabilities={
          turn.id === recentTurn?.id
            ? conversation.used_capabilities
            : undefined
        }
        selectedSubAgentId={
          selectedSubAgent?.turnId === turn.id
            ? selectedSubAgent.agentId
            : undefined
        }
        onSubAgentSelect={(agent) =>
          onSubAgentSelect?.({ turnId: turn.id, agent })
        }
        onActivityDisclosureToggle={onActivityDisclosureToggle}
      />
    )
  }

  const renderedConversationMessages = messages.filter((message) => {
    if (
      message.usage_type === "steer_current_turn" ||
      isHiddenPlanImplementationMessage(message)
    ) {
      return false
    }
    const turn = message.turn_id ? turnById.get(message.turn_id) : undefined
    if (message.role !== "assistant" || !turn) return true
    return (
      finalMessageByTurn.get(turn.id)?.id === message.id ||
      isProposedPlanMessage(message)
    )
  })
  const renderedConversationMessageIds = new Set(
    renderedConversationMessages.map((message) => message.id)
  )
  const forkSource = conversation.fork_source
  const forkBoundaryMessageId = forkSource
    ? [...renderedConversationMessages]
        .reverse()
        .find(
          (message) =>
            message.sequence_no !== undefined &&
            message.sequence_no <= forkSource.boundary_sequence_no
        )?.id
    : undefined
  const previousRenderedMessageById = new Map(
    renderedConversationMessages
      .slice(1)
      .map((message, index) => [
        message.id,
        renderedConversationMessages[index],
      ])
  )
  const renderMessageNodes = (message: ConversationMessage) => {
    const nodes: ReactNode[] = []
    if (
      message.usage_type === "steer_current_turn" ||
      isHiddenPlanImplementationMessage(message)
    ) {
      return nodes
    }
    const turn = message.turn_id ? turnById.get(message.turn_id) : undefined
    const modelChange =
      turn && firstUserMessageByTurn.get(turn.id) === message.id
        ? modelChangeByTurnId.get(turn.id)
        : undefined
    const showSummary =
      message.role === "assistant" &&
      turn &&
      firstAssistantMessageByTurn.get(turn.id) === message.id
    const isFinal =
      message.role === "assistant" &&
      turn &&
      finalMessageByTurn.get(turn.id)?.id === message.id
    const isProposedPlan = isProposedPlanMessage(message)
    const rendersMessage = renderedConversationMessageIds.has(message.id)
    const previousRenderedMessage = previousRenderedMessageById.get(message.id)

    if (
      rendersMessage &&
      message.role === "user" &&
      previousRenderedMessage &&
      shouldShowConversationTimeSeparator(
        previousRenderedMessage.created_at,
        message.created_at
      )
    ) {
      nodes.push(
        <ConversationTimeSeparator
          key={`time-separator-${getConversationMessageRenderKey(message)}`}
          timestamp={message.created_at}
        />
      )
    }

    if (modelChange) {
      const label = t("conversation.modelChanged", modelChange)
      nodes.push(
        <Marker
          key={`model-change-${message.turn_id}`}
          variant="separator"
          className="mt-8 py-2"
          role="note"
          aria-label={label}
        >
          <MarkerIcon>
            <BoxIcon className="size-[15px]" aria-hidden="true" />
          </MarkerIcon>
          <MarkerContent className="flex min-h-4 items-center text-[length:var(--app-font-13)] leading-none font-medium text-muted-foreground/70">
            {label}
          </MarkerContent>
        </Marker>
      )
    }
    if (showSummary) nodes.push(summaryFor(turn))
    if (
      message.role === "assistant" &&
      turn &&
      !showSummary &&
      !isFinal &&
      !isProposedPlan
    ) {
      return nodes
    }

    if (rendersMessage) {
      nodes.push(renderConversationMessage(message, isFinal))
    }
    if (forkSource && message.id === forkBoundaryMessageId) {
      nodes.push(
        <ConversationForkSourceMarker
          key={`fork-source-${conversation.id}`}
          source={forkSource}
        />
      )
    }

    return nodes
  }

  const rowGroups = new Map<
    string,
    {
      key: string
      turnId?: string
      messageIds: string[]
      renderers: (() => ReactNode)[]
    }
  >()
  const addRow = (
    key: string,
    render: () => ReactNode,
    messageId?: string,
    turnId?: string
  ) => {
    let row = rowGroups.get(key)
    if (!row) {
      row = { key, turnId, messageIds: [], renderers: [] }
      rowGroups.set(key, row)
    }
    row.renderers.push(render)
    if (messageId) row.messageIds.push(messageId)
  }
  for (const message of messages) {
    if (
      message.usage_type === "steer_current_turn" ||
      isHiddenPlanImplementationMessage(message)
    )
      continue
    const turn = message.turn_id ? turnById.get(message.turn_id) : undefined
    if (
      message.role === "assistant" &&
      turn &&
      firstAssistantMessageByTurn.get(turn.id) !== message.id &&
      !renderedConversationMessageIds.has(message.id)
    )
      continue
    addRow(
      turn ? getTurnRenderKey(turn) : getConversationMessageRenderKey(message),
      () => renderMessageNodes(message),
      message.role === "user" ? message.id : undefined,
      turn?.id
    )
  }
  if (recentTurn && !firstAssistantMessageByTurn.has(recentTurn.id)) {
    addRow(
      getTurnRenderKey(recentTurn),
      () => summaryFor(recentTurn),
      undefined,
      recentTurn.id
    )
  }
  const loadedRows: ConversationMessageRow[] = [...rowGroups.values()].map(
    (row) => ({
      key: row.key,
      turnId: row.turnId,
      messageIds: row.messageIds,
      render: () => row.renderers.flatMap((render) => render()),
    })
  )
  const rowsByTurn = new Map(
    loadedRows.filter((row) => row.turnId).map((row) => [row.turnId, row])
  )
  const indexedTurns = new Set(
    conversation.history?.index.map((item) => item.turn_id)
  )
  const loadedTurns = new Set(conversation.history?.turn_ids)
  const messageRows: ConversationMessageRow[] = conversation.history
    ? [
        ...conversation.history.index.flatMap(
          (item): ConversationMessageRow[] => {
            const loaded = rowsByTurn.get(item.turn_id)
            if (loaded) return [loaded]
            if (!item.has_content || loadedTurns.has(item.turn_id)) return []
            return [
              {
                key: item.message_id
                  ? `message-${item.message_id}`
                  : `turn-${item.turn_id}`,
                turnId: item.turn_id,
                messageIds: item.message_id ? [item.message_id] : [],
                loaded: false,
                render: () => null,
              },
            ]
          }
        ),
        ...loadedRows.filter(
          (row) => !row.turnId || !indexedTurns.has(row.turnId)
        ),
      ]
    : loadedRows

  return (
    <div
      ref={scrollContainerRef}
      className={cn(
        "conversation-scroll",
        embedded && "conversation-scroll-embedded"
      )}
      role="log"
      aria-live="polite"
      aria-relevant="additions text"
    >
      <div
        ref={contentRef}
        className={cn(
          "conversation-column",
          embedded && "conversation-column-embedded",
          showWelcome && "conversation-column-welcome",
          blockingPanel && "conversation-column-blocked"
        )}
      >
        {messages.length === 0 &&
          (emptyStateContent ? (
            <div className="conversation-empty-stack">
              {emptyStateContent}
              {emptyNotice && (
                <ConversationEmptyNotice>{emptyNotice}</ConversationEmptyNotice>
              )}
            </div>
          ) : showWelcome ? (
            <section
              className="conversation-welcome"
              aria-labelledby="new-task-welcome-title"
            >
              <SparklesIcon
                className="conversation-welcome-icon"
                aria-hidden="true"
              />
              <h2 id="new-task-welcome-title">
                {t("conversation.newTaskWelcome", { productName })}
              </h2>
              {emptyNotice && (
                <ConversationEmptyNotice>{emptyNotice}</ConversationEmptyNotice>
              )}
              {onStarterQuestionSelect && (
                <NewTaskStarterQuestions onSelect={onStarterQuestionSelect} />
              )}
            </section>
          ) : (
            (!suppressEmptyState || emptyNotice) && (
              <div className="conversation-empty-stack">
                {!suppressEmptyState && (
                  <EmptyState title={t("conversation.listEmpty")} />
                )}
                {emptyNotice && (
                  <ConversationEmptyNotice>
                    {emptyNotice}
                  </ConversationEmptyNotice>
                )}
              </div>
            )
          ))}
        <ConversationMessageList
          pinnedMessageId={editingMessageId}
          rows={messageRows}
          navigationRef={navigationRef}
          onVisibleMessageChange={onVisibleMessageChange}
          history={history}
        />
        {messages.length > 0 && emptyNotice && (
          <div className="conversation-inline-notice-row">
            <ConversationEmptyNotice>{emptyNotice}</ConversationEmptyNotice>
          </div>
        )}

        <ArtifactFiles
          files={visibleArtifacts(conversation.artifacts)?.filter(
            (file) => !file.turn_id || !turnById.has(file.turn_id)
          )}
          loadPreview={loadArtifactPreview}
          onPreviewOfficeDocument={openOfficeDocument}
          onDownload={onDownload}
          downloadingFileId={downloadingFileId}
        />
        {blockingPanel && (
          <div
            ref={blockingPanelContainerRef}
            className="conversation-blocking-panel"
            data-testid="conversation-blocking-panel"
          >
            {blockingPanel}
          </div>
        )}
      </div>
    </div>
  )
}
