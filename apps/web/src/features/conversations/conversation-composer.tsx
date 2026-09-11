import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type ClipboardEvent,
  type DragEvent,
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
} from "react"
import {
  ArrowUpIcon,
  CircleAlertIcon,
  BookOpenIcon,
  FileIcon,
  FolderOpenIcon,
  GoalIcon,
  LightbulbIcon,
  LoaderCircleIcon,
  MicIcon,
  PlusIcon,
  SquareIcon,
  TriangleAlertIcon,
  XIcon,
} from "lucide-react"
import { useTranslation } from "react-i18next"

import type {
  Application,
  CapabilitySummary,
  ConversationFile,
} from "@/api/contracts"
import { useProductName } from "@/app/product-branding"
import type { ModelPreference, ReasoningEffort } from "@linksense/shared"
import { CapabilityIcon } from "@/components/capabilities/capability-icon"
import { FileTypeIcon } from "@/components/media/file-type-icon"
import { Button } from "@/components/ui/button"
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command"
import { Input } from "@/components/ui/input"
import { FieldDescription } from "@/components/ui/field"
import { Spinner } from "@/components/ui/spinner"
import {
  Popover,
  PopoverContent,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from "@/components/ui/popover"
import { Textarea } from "@/components/ui/textarea"
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@/components/ui/hover-card"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { ConversationAttachmentPreviews } from "@/features/conversations/conversation-attachment-previews"
import { ConversationAttachmentUploadPreview } from "@/features/conversations/conversation-attachment-upload-preview"
import { ConversationAttachmentOverflow } from "@/features/conversations/conversation-attachment-overflow"
import { capabilityPresentation } from "@/features/capabilities/built-in-presentation"
import {
  canSelectConversationCapability,
  orderConversationSkills,
} from "@/features/conversations/conversation-capability-selection"
import { ConversationModelSelector } from "@/features/conversations/conversation-model-selector"
import type { ConversationModelContextUsage } from "@/features/conversations/conversation-context-usage"
import {
  ConversationSkillCommandMenu,
  ConversationSlashCommandMenu,
  type ConversationSlashCommandPanel,
} from "@/features/conversations/conversation-slash-command-menu"
import {
  findConversationSkillCommandTrigger,
  findConversationSlashCommandTrigger,
  isConversationContextCompactionCommand,
  removeConversationSkillCommandTrigger,
  removeConversationSlashCommandTrigger,
} from "@/features/conversations/conversation-slash-command"
import { ConversationComposerUrlHighlightLayer } from "@/features/conversations/conversation-composer-url-highlight-layer"
import { getConversationComposerInputSegments } from "@/features/conversations/conversation-composer-url-highlighting"
import {
  isPreviewableConversationImage,
  isPreviewableImageMimeType,
} from "@/features/conversations/conversation-attachment-preview-utils"
import type {
  KnowledgeBase,
  KnowledgeSearchCapability,
} from "@/features/knowledge-bases/knowledge-base-contracts"
import { isKnowledgeBaseAvailableForTurn } from "@/features/knowledge-bases/knowledge-base-utils"
import { getKnowledgeSearchUnavailableDescriptionKey } from "@/features/knowledge-bases/knowledge-search-status"
import {
  createPastedTextAttachment,
  shouldConvertPastedTextToAttachment,
} from "@/features/conversations/pasted-text-file"
import {
  useVoiceTranscription,
  type VoiceInputFailure,
  type VoiceTranscriptionRequester,
} from "@/features/conversations/use-voice-transcription"
import type { VoiceTranscriptionAvailabilityState } from "@/features/conversations/use-voice-transcription-availability"
import {
  appendVoiceTranscript,
  getVoiceInputFailureMessage,
} from "@/features/conversations/voice-input-utils"
import type { VoiceWaveformHistorySample } from "@/features/conversations/voice-waveform"
import { normalizeLanguage } from "@/i18n"
import { formatFileSize } from "@/i18n/date"
import { cn } from "@/lib/utils"
import { shouldAutoFocusOnDesktop } from "@/lib/responsive"

const voiceWaveHeightClasses = [
  "h-1",
  "h-1.5",
  "h-2",
  "h-2.5",
  "h-3",
  "h-4",
  "h-5",
  "h-6",
] as const

function formatVoiceDuration(seconds: number) {
  const safeSeconds = Math.max(0, Math.floor(seconds))
  const minutes = Math.floor(safeSeconds / 60)
  return `${minutes}:${String(safeSeconds % 60).padStart(2, "0")}`
}

function waveformHeightClass(level: number) {
  const normalizedLevel = Math.min(1, Math.max(0, level))
  const heightIndex = Math.min(
    voiceWaveHeightClasses.length - 1,
    Math.max(0, Math.round(normalizedLevel * 7))
  )
  return voiceWaveHeightClasses[heightIndex]
}

function getTransferredFiles(dataTransfer: DataTransfer): File[] {
  const itemFiles = Array.from(dataTransfer.items)
    .filter((item) => item.kind === "file")
    .map((item) => item.getAsFile())
    .filter((file): file is File => file !== null)
  const transferFiles = Array.from(dataTransfer.files)

  return transferFiles.length >= itemFiles.length ? transferFiles : itemFiles
}

function hasTransferredFiles(dataTransfer: DataTransfer): boolean {
  return Array.from(dataTransfer.types).includes("Files")
}

function isCapabilityMenuShortcutInsertion(
  previousValue: string,
  nextValue: string,
  selectionStart: number | null
): boolean {
  if (selectionStart === null || nextValue.length !== previousValue.length + 1)
    return false

  const insertionIndex = selectionStart - 1
  if (
    insertionIndex < 0 ||
    nextValue[insertionIndex] !== "@" ||
    `${nextValue.slice(0, insertionIndex)}${nextValue.slice(insertionIndex + 1)}` !==
      previousValue
  ) {
    return false
  }

  return (
    insertionIndex === 0 || /\s/u.test(previousValue[insertionIndex - 1] ?? "")
  )
}

type PendingPastedTextAttachment = Readonly<{
  name: string
  characterCount: number
  size: number
  content: string
}>

export type PendingAttachmentUpload = Readonly<{
  id: string
  name: string
  size: number
  mimeType?: string
  previewFile?: File
}>

type ComposerAttachmentDisplayItem =
  | Readonly<{
      key: string
      status: "uploaded"
      name: string
      size?: number
      mimeType?: string | null
      file: ConversationFile
    }>
  | Readonly<{
      key: string
      status: "uploading"
      name: string
      size: number
      mimeType?: string | null
      pastedText?: PendingPastedTextAttachment
      previewFile?: File
    }>

const maxVisibleComposerAttachments = 2

function PastedTextAttachmentHover({
  name,
  mimeType,
  content,
  ariaLabel,
  meta,
  trailing,
}: Readonly<{
  name: string
  mimeType?: string | null
  content: string
  ariaLabel: string
  meta?: ReactNode
  trailing?: ReactNode
}>) {
  return (
    <span className="composer-context-chip attachment-chip pasted-text-attachment-chip">
      <HoverCard>
        <HoverCardTrigger
          type="button"
          className="pasted-text-attachment-trigger"
          aria-label={ariaLabel}
        >
          <FileTypeIcon filename={name} mimeType={mimeType ?? "text/plain"} />
          <span className="composer-chip-label min-w-0 truncate">{name}</span>
          {meta}
        </HoverCardTrigger>
        <HoverCardContent
          side="top"
          align="start"
          sideOffset={10}
          aria-label={ariaLabel}
          className="pasted-text-attachment-hover-content"
        >
          <div className="pasted-text-attachment-hover-header">
            <FileTypeIcon filename={name} mimeType={mimeType ?? "text/plain"} />
            <span className="pasted-text-attachment-hover-title">{name}</span>
          </div>
          <pre className="pasted-text-attachment-hover-body">{content}</pre>
        </HoverCardContent>
      </HoverCard>
      {trailing}
    </span>
  )
}

function restorePastedTextAtSelection(
  value: string,
  pastedText: string,
  selectionStart: number,
  selectionEnd: number
): string {
  const start = Math.min(Math.max(selectionStart, 0), value.length)
  const end = Math.min(Math.max(selectionEnd, start), value.length)
  return `${value.slice(0, start)}${pastedText}${value.slice(end)}`
}

function VoiceRecordingControls({
  elapsedSeconds,
  waveform,
  isProcessing,
  onWaveformTrackResize,
  onStop,
}: {
  elapsedSeconds: number
  waveform: readonly VoiceWaveformHistorySample[]
  isProcessing: boolean
  onWaveformTrackResize: (trackWidth: number) => void
  onStop: () => void
}) {
  const { t } = useTranslation()
  const waveformTrackRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const track = waveformTrackRef.current
    if (!track) return

    const updateWaveformCapacity = () =>
      onWaveformTrackResize(track.clientWidth)

    updateWaveformCapacity()
    const resizeObserver =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(updateWaveformCapacity)
    resizeObserver?.observe(track)
    window.addEventListener("resize", updateWaveformCapacity)
    return () => {
      resizeObserver?.disconnect()
      window.removeEventListener("resize", updateWaveformCapacity)
    }
  }, [onWaveformTrackResize])

  return (
    <div
      className="flex min-w-0 flex-1 items-center gap-2"
      role="status"
      aria-live="polite"
      aria-label={
        isProcessing ? t("conversation.voiceTranscribing") : undefined
      }
      data-testid="voice-recording-panel"
    >
      {!isProcessing && (
        <span className="sr-only">{t("conversation.voiceRecording")}</span>
      )}
      <div
        ref={waveformTrackRef}
        className="relative flex h-8 min-w-12 flex-1 items-center overflow-hidden"
        aria-hidden="true"
        data-testid="voice-waveform"
      >
        <span className="absolute inset-x-0 top-1/2 border-t border-dashed border-[var(--app-border)]" />
        <span className="relative ml-auto flex h-full max-w-full min-w-[min(20rem,100%)] items-center justify-end gap-[3px]">
          {waveform.map((sample) => (
            <span
              key={sample.id}
              data-waveform-sample={sample.id}
              data-waveform-level={sample.level}
              className={cn(
                "w-0.5 shrink-0 rounded-full bg-[var(--app-text)] opacity-80 transition-[height,opacity] duration-75 motion-reduce:transition-none",
                waveformHeightClass(sample.level),
                sample.level < 0.05 && "opacity-30"
              )}
            />
          ))}
        </span>
      </div>
      <span
        className="min-w-9 text-right text-sm font-semibold text-[var(--app-muted)] tabular-nums"
        aria-label={t("conversation.voiceDuration")}
      >
        {formatVoiceDuration(elapsedSeconds)}
      </span>
      <Button
        type="button"
        variant="secondary"
        size="icon"
        className="size-8 shrink-0 rounded-full disabled:opacity-100"
        aria-label={t(
          isProcessing
            ? "conversation.voiceTranscribing"
            : "conversation.voiceStop"
        )}
        aria-busy={isProcessing || undefined}
        disabled={isProcessing}
        onClick={onStop}
      >
        {isProcessing ? (
          <Spinner data-testid="voice-transcription-spinner" />
        ) : (
          <SquareIcon className="size-3 fill-current" aria-hidden="true" />
        )}
      </Button>
    </div>
  )
}

export type ConversationComposerHandle = Readonly<{
  focus: () => void
}>

export type KnowledgeBaseSelectionStatus =
  "available" | "loading" | "unavailable" | "verification_failed"

type ConversationComposerProps = Readonly<{
  value: string
  onValueChange: (value: string) => void
  capabilities: CapabilitySummary[]
  capabilitiesLoading?: boolean
  capabilitiesError?: boolean
  onRetryCapabilities?: () => void
  selectedIds: string[]
  onSelectedIdsChange: (ids: string[]) => void
  knowledgeBases?: KnowledgeBase[]
  knowledgeBasesLoading?: boolean
  knowledgeBasesError?: boolean
  knowledgeSearchCapability?: KnowledgeSearchCapability
  onRetryKnowledgeBases?: () => void
  selectedKnowledgeBaseIds?: string[]
  knowledgeBaseSelectionStatusById?: Readonly<
    Record<string, KnowledgeBaseSelectionStatus>
  >
  onSelectedKnowledgeBaseIdsChange?: (ids: string[]) => void
  hasMoreKnowledgeBases?: boolean
  loadingMoreKnowledgeBases?: boolean
  onLoadMoreKnowledgeBases?: () => void
  attachments: ConversationFile[]
  pendingAttachmentUploads?: readonly PendingAttachmentUpload[]
  attachmentPreviewEnabled?: boolean
  isRunning: boolean
  interrupting: boolean
  submitting: boolean
  uploading: boolean
  attachmentOperationPending?: boolean
  goalMode?: boolean
  planMode?: boolean
  planModeAvailable?: boolean
  planModeDisabled?: boolean
  unavailableMessage?: string
  interactionBlocked?: boolean
  modelPreference?: ModelPreference
  modelPreferencePending?: boolean
  modelContextUsage?: ConversationModelContextUsage | null
  managedApplicationName?: string
  allowManagedApplicationModelSelection?: boolean
  onModelPreferenceChange?: (
    model: string,
    reasoningEffort: ReasoningEffort
  ) => void
  onSubmit: (value: string) => void
  onCompact?: () => void
  compactAvailable?: boolean
  compacting?: boolean
  taskStartDisabled?: boolean
  onGoalModeChange?: (enabled: boolean) => void
  onPlanModeChange?: (enabled: boolean) => void
  onStartNewTask: () => void
  onStartApplication: (application: Application) => void
  startingApplicationId?: string
  onInterrupt: () => void
  onAttach: (files: File[]) => Promise<unknown> | boolean | void
  loadAttachmentPreview: (
    file: ConversationFile,
    signal: AbortSignal
  ) => Promise<Blob>
  onRemoveAttachment: (file: ConversationFile) => void
  onClearAttachments: (
    files: readonly ConversationFile[]
  ) => Promise<unknown> | void
  onError: (message: string | null) => void
  requestVoiceTranscription?: VoiceTranscriptionRequester
  voiceTranscriptionAvailability?: VoiceTranscriptionAvailabilityState
}>

export const ConversationComposer = forwardRef<
  ConversationComposerHandle,
  ConversationComposerProps
>(function ConversationComposer(
  {
    value,
    onValueChange,
    capabilities,
    capabilitiesLoading,
    capabilitiesError,
    onRetryCapabilities,
    selectedIds,
    onSelectedIdsChange,
    knowledgeBases = [],
    knowledgeBasesLoading,
    knowledgeBasesError,
    knowledgeSearchCapability,
    onRetryKnowledgeBases,
    selectedKnowledgeBaseIds = [],
    knowledgeBaseSelectionStatusById,
    onSelectedKnowledgeBaseIdsChange,
    hasMoreKnowledgeBases,
    loadingMoreKnowledgeBases,
    onLoadMoreKnowledgeBases,
    attachments,
    pendingAttachmentUploads = [],
    attachmentPreviewEnabled = true,
    isRunning,
    interrupting,
    submitting,
    uploading,
    attachmentOperationPending = false,
    goalMode = false,
    planMode = false,
    planModeAvailable = true,
    planModeDisabled = false,
    interactionBlocked = false,
    unavailableMessage,
    modelPreference,
    modelPreferencePending = false,
    modelContextUsage,
    managedApplicationName,
    allowManagedApplicationModelSelection = false,
    onModelPreferenceChange,
    onSubmit,
    onCompact = () => undefined,
    compactAvailable = false,
    compacting = false,
    taskStartDisabled = false,
    onGoalModeChange,
    onPlanModeChange,
    onStartNewTask,
    onStartApplication,
    startingApplicationId,
    onInterrupt,
    onAttach,
    loadAttachmentPreview,
    onRemoveAttachment,
    onClearAttachments,
    onError,
    requestVoiceTranscription,
    voiceTranscriptionAvailability = "available",
  }: ConversationComposerProps,
  ref
) {
  const { t, i18n } = useTranslation()
  const productName = useProductName()
  const language = normalizeLanguage(i18n.resolvedLanguage) ?? "zh-CN"
  const [menuOpen, setMenuOpen] = useState(false)
  const [knowledgeMenuOpen, setKnowledgeMenuOpen] = useState(false)
  const [slashPanel, setSlashPanel] =
    useState<ConversationSlashCommandPanel | null>(null)
  const [dismissedSlashValue, setDismissedSlashValue] = useState<string | null>(
    null
  )
  const [dismissedSkillValue, setDismissedSkillValue] = useState<string | null>(
    null
  )
  const [pendingPastedTextAttachment, setPendingPastedTextAttachment] =
    useState<PendingPastedTextAttachment | null>(null)
  const [isDraggingFiles, setIsDraggingFiles] = useState(false)
  const [pastedTextAttachmentNames, setPastedTextAttachmentNames] = useState<
    string[]
  >([])
  const [pastedTextAttachmentContents, setPastedTextAttachmentContents] =
    useState<Record<string, string>>({})
  const latestValueRef = useRef(value)
  const voiceBaseValueRef = useRef(value)
  const voiceLastAppliedValueRef = useRef(value)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const directoryInputRef = useRef<HTMLInputElement | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)
  const composerInputHighlightRef = useRef<HTMLDivElement | null>(null)
  const composerShellRef = useRef<HTMLFormElement | null>(null)
  const commandMenuRef = useRef<HTMLDivElement | null>(null)

  useImperativeHandle(
    ref,
    () => ({
      focus: () => textareaRef.current?.focus({ preventScroll: true }),
    }),
    []
  )

  useEffect(() => {
    latestValueRef.current = value
  }, [value])

  const composerInputSegments = useMemo(
    () => getConversationComposerInputSegments(value),
    [value]
  )
  const hasComposerInputUrl = composerInputSegments.some(
    (segment) => segment.kind === "url"
  )
  const hasLeadingComposerInputUrl = composerInputSegments[0]?.kind === "url"

  useEffect(() => {
    const highlight = composerInputHighlightRef.current
    const textarea = textareaRef.current
    if (highlight && textarea) highlight.scrollTop = textarea.scrollTop
  }, [value])

  useEffect(() => {
    directoryInputRef.current?.setAttribute("webkitdirectory", "")
  }, [])

  const slashTrigger = useMemo(
    () => findConversationSlashCommandTrigger(value),
    [value]
  )
  const slashRootOpen =
    slashPanel === null &&
    slashTrigger !== null &&
    dismissedSlashValue !== value
  const slashMenuOpen = slashPanel !== null || slashRootOpen
  const skillTrigger = useMemo(
    () => findConversationSkillCommandTrigger(value),
    [value]
  )
  const skillMenuOpen =
    !managedApplicationName &&
    slashPanel === null &&
    skillTrigger !== null &&
    dismissedSkillValue !== value
  const commandMenuOpen = slashMenuOpen || skillMenuOpen

  const dismissSlashMenu = useCallback(() => {
    setSlashPanel(null)
    const currentValue = latestValueRef.current
    setDismissedSlashValue(
      findConversationSlashCommandTrigger(currentValue) ? currentValue : null
    )
  }, [setDismissedSlashValue, setSlashPanel])

  const dismissCommandMenu = useCallback(() => {
    dismissSlashMenu()
    const currentValue = latestValueRef.current
    setDismissedSkillValue(
      findConversationSkillCommandTrigger(currentValue) ? currentValue : null
    )
  }, [dismissSlashMenu])

  useEffect(() => {
    if (!interactionBlocked) return
    const timer = window.setTimeout(() => {
      setMenuOpen(false)
      setKnowledgeMenuOpen(false)
      dismissCommandMenu()
    }, 0)
    return () => window.clearTimeout(timer)
  }, [dismissCommandMenu, interactionBlocked])

  useEffect(() => {
    if (!commandMenuOpen) return
    const handleOutsidePointerDown = (event: PointerEvent) => {
      const target = event.target
      if (
        target instanceof Node &&
        !composerShellRef.current?.contains(target)
      ) {
        dismissCommandMenu()
      }
    }
    document.addEventListener("pointerdown", handleOutsidePointerDown)
    return () =>
      document.removeEventListener("pointerdown", handleOutsidePointerDown)
  }, [commandMenuOpen, dismissCommandMenu])

  const applyTranscript = useCallback(
    (transcript: string) => {
      if (latestValueRef.current !== voiceLastAppliedValueRef.current) return
      const nextValue = appendVoiceTranscript(
        voiceBaseValueRef.current,
        transcript
      )
      latestValueRef.current = nextValue
      voiceLastAppliedValueRef.current = nextValue
      onValueChange(nextValue)
    },
    [onValueChange]
  )

  const reportVoiceFailure = useCallback(
    (failure: VoiceInputFailure) =>
      onError(getVoiceInputFailureMessage(failure, t)),
    [onError, t]
  )

  const voice = useVoiceTranscription({
    language,
    onTranscriptPreview: applyTranscript,
    onTranscript: applyTranscript,
    onError: reportVoiceFailure,
    request: requestVoiceTranscription,
  })
  const voiceBusy = voice.phase !== "idle"
  const voiceAvailable = voiceTranscriptionAvailability === "available"
  const voiceTooltipKey =
    voiceTranscriptionAvailability === "not_configured"
      ? "conversation.voiceNotConfigured"
      : voiceTranscriptionAvailability === "checking"
        ? "conversation.voiceChecking"
        : voiceTranscriptionAvailability === "unavailable"
          ? "conversation.voiceServiceUnavailable"
          : "conversation.voice"
  const selected = useMemo(
    () =>
      capabilities.filter((capability) => selectedIds.includes(capability.id)),
    [capabilities, selectedIds]
  )
  const capabilityGroups = useMemo(
    () =>
      (["plugin", "skill"] as const)
        .map((type) => {
          const items = capabilities.filter(
            (capability) =>
              capability.type === type &&
              capability.status === "active" &&
              !capability.personally_disabled
          )
          return {
            type,
            items: type === "skill" ? orderConversationSkills(items) : items,
          }
        })
        .filter((group) => group.items.length > 0),
    [capabilities]
  )
  const knowledgeBasesById = useMemo(
    () =>
      new Map(
        knowledgeBases.map((knowledgeBase) => [knowledgeBase.id, knowledgeBase])
      ),
    [knowledgeBases]
  )
  const selectedKnowledgeBases = selectedKnowledgeBaseIds.map((id) => ({
    id,
    knowledgeBase: knowledgeBasesById.get(id),
  }))
  const fileAttachments = attachmentPreviewEnabled
    ? attachments.filter((file) => !isPreviewableConversationImage(file))
    : attachments
  const visiblePendingPastedTextAttachment =
    pendingPastedTextAttachment &&
    !fileAttachments.some(
      (file) => file.name === pendingPastedTextAttachment.name
    )
      ? pendingPastedTextAttachment
      : null
  const visiblePendingAttachmentUploads = pendingAttachmentUploads.filter(
    (upload) =>
      !pastedTextAttachmentNames.includes(upload.name) &&
      !attachments.some(
        (attachment) =>
          attachment.name === upload.name && attachment.size === upload.size
      )
  )
  const hasNonImageAttachments =
    fileAttachments.length > 0 ||
    visiblePendingAttachmentUploads.some(
      (upload) =>
        !attachmentPreviewEnabled ||
        !isPreviewableImageMimeType(upload.mimeType)
    ) ||
    visiblePendingPastedTextAttachment !== null
  const isPastedTextAttachmentPending = pendingPastedTextAttachment !== null
  const composerAttachmentItems: ComposerAttachmentDisplayItem[] = [
    ...attachments.map((file) => ({
      key: `uploaded-${file.id}`,
      status: "uploaded" as const,
      name: file.name,
      size: file.size,
      mimeType: file.mime_type,
      file,
    })),
    ...visiblePendingAttachmentUploads.map((file) => ({
      key: `uploading-${file.id}`,
      status: "uploading" as const,
      name: file.name,
      size: file.size,
      mimeType: file.mimeType,
      previewFile: file.previewFile,
    })),
    ...(visiblePendingPastedTextAttachment
      ? [
          {
            key: `uploading-pasted-${visiblePendingPastedTextAttachment.name}`,
            status: "uploading" as const,
            name: visiblePendingPastedTextAttachment.name,
            size: visiblePendingPastedTextAttachment.size,
            mimeType: "text/plain",
            pastedText: visiblePendingPastedTextAttachment,
          },
        ]
      : []),
  ]
  const visibleComposerAttachmentItems =
    composerAttachmentItems.length > maxVisibleComposerAttachments
      ? composerAttachmentItems.slice(0, maxVisibleComposerAttachments)
      : composerAttachmentItems
  const hiddenComposerAttachmentCount =
    composerAttachmentItems.length - visibleComposerAttachmentItems.length
  const visibleComposerImageAttachments = visibleComposerAttachmentItems
    .filter(
      (
        item
      ): item is Extract<
        ComposerAttachmentDisplayItem,
        { status: "uploaded" }
      > =>
        item.status === "uploaded" &&
        attachmentPreviewEnabled &&
        isPreviewableConversationImage(item.file)
    )
    .map((item) => item.file)
  const firstVisibleComposerImageIndex =
    visibleComposerAttachmentItems.findIndex(
      (item) =>
        item.status === "uploaded" &&
        attachmentPreviewEnabled &&
        isPreviewableConversationImage(item.file)
    )
  const hasAttachmentUploadsPending =
    uploading ||
    visiblePendingAttachmentUploads.length > 0 ||
    isPastedTextAttachmentPending
  const hasPastedTextAttachment =
    isPastedTextAttachmentPending ||
    fileAttachments.some((file) =>
      pastedTextAttachmentNames.includes(file.name)
    )
  const hasDraftContentForValue = (nextValue: string) =>
    Boolean(
      nextValue.trim() ||
      attachments.length ||
      visiblePendingAttachmentUploads.length ||
      isPastedTextAttachmentPending ||
      selectedIds.length ||
      selectedKnowledgeBaseIds.length
    )
  const hasTextContent = Boolean(value.trim())
  const canSubmitValue = (nextValue: string) =>
    goalMode ? Boolean(nextValue.trim()) : hasDraftContentForValue(nextValue)
  const modelReady =
    !modelPreferencePending &&
    (modelPreference === undefined ||
      (modelPreference !== undefined &&
        modelPreference.configured &&
        modelPreference.selected_model !== null &&
        modelPreference.selected_reasoning_effort !== null))
  const knowledgeBaseSelectionPending =
    selectedKnowledgeBaseIds.length > 0 &&
    (Boolean(knowledgeBasesLoading) ||
      selectedKnowledgeBaseIds.some((id) => {
        const status = knowledgeBaseSelectionStatusById?.[id]
        return status === "loading" || status === "verification_failed"
      }))
  const canSendValue = (nextValue: string) =>
    (isConversationContextCompactionCommand(nextValue)
      ? compactAvailable
      : canSubmitValue(nextValue)) &&
    !voiceBusy &&
    !submitting &&
    !attachmentOperationPending &&
    !compacting &&
    !hasAttachmentUploadsPending &&
    !interactionBlocked &&
    !taskStartDisabled &&
    modelReady &&
    !knowledgeBaseSelectionPending
  const canSend = canSendValue(value)
  const showSendButton = hasTextContent || !isRunning
  const sendButtonDisabled =
    voiceBusy ||
    submitting ||
    attachmentOperationPending ||
    hasAttachmentUploadsPending ||
    interactionBlocked ||
    taskStartDisabled ||
    !modelReady ||
    knowledgeBaseSelectionPending
  const attachmentActionDisabled =
    submitting ||
    uploading ||
    attachmentOperationPending ||
    modelPreferencePending ||
    interactionBlocked ||
    isPastedTextAttachmentPending

  const removeComposerAttachment = (file: ConversationFile) => {
    setPastedTextAttachmentNames((current) =>
      current.filter((name) => name !== file.name)
    )
    setPastedTextAttachmentContents((current) => {
      if (!(file.name in current)) return current
      const next = { ...current }
      delete next[file.name]
      return next
    })
    onRemoveAttachment(file)
  }

  const clearComposerAttachments = (files: readonly ConversationFile[]) => {
    const removedNames = new Set(files.map((file) => file.name))
    setPastedTextAttachmentNames((current) =>
      current.filter((name) => !removedNames.has(name))
    )
    setPastedTextAttachmentContents((current) =>
      Object.fromEntries(
        Object.entries(current).filter(([name]) => !removedNames.has(name))
      )
    )
    return onClearAttachments(files)
  }

  const toggleCapability = (id: string) => {
    onSelectedIdsChange(
      selectedIds.includes(id)
        ? selectedIds.filter((value) => value !== id)
        : [...selectedIds, id]
    )
  }

  const handleCapabilitySelect = (id: string) => {
    toggleCapability(id)
    setMenuOpen(false)
  }

  const toggleKnowledgeBase = (id: string) => {
    onSelectedKnowledgeBaseIdsChange?.(
      selectedKnowledgeBaseIds.includes(id)
        ? selectedKnowledgeBaseIds.filter((value) => value !== id)
        : [...selectedKnowledgeBaseIds, id]
    )
  }

  const consumeSlashTrigger = () => {
    const currentValue = latestValueRef.current
    const trigger = findConversationSlashCommandTrigger(currentValue)
    if (!trigger) return
    const nextValue = removeConversationSlashCommandTrigger(
      currentValue,
      trigger
    )
    latestValueRef.current = nextValue
    onValueChange(nextValue)
  }

  const consumeSkillTrigger = () => {
    const currentValue = latestValueRef.current
    const trigger = findConversationSkillCommandTrigger(currentValue)
    if (!trigger) return
    const nextValue = removeConversationSkillCommandTrigger(
      currentValue,
      trigger
    )
    latestValueRef.current = nextValue
    onValueChange(nextValue)
  }

  const openSlashPanel = (panel: ConversationSlashCommandPanel) => {
    const expanding = slashPanel !== panel
    setDismissedSlashValue(null)
    setSlashPanel(expanding ? panel : null)
    if (expanding && (panel === "plugins" || panel === "skills")) {
      onRetryCapabilities?.()
    }
    if (expanding && panel === "knowledge-bases") onRetryKnowledgeBases?.()
    window.setTimeout(
      () => textareaRef.current?.focus({ preventScroll: true }),
      0
    )
  }

  const selectSlashCapability = (id: string) => {
    consumeSlashTrigger()
    toggleCapability(id)
    dismissSlashMenu()
    window.setTimeout(
      () => textareaRef.current?.focus({ preventScroll: true }),
      0
    )
  }

  const selectSkillCapability = (id: string) => {
    consumeSkillTrigger()
    toggleCapability(id)
    dismissCommandMenu()
    window.setTimeout(
      () => textareaRef.current?.focus({ preventScroll: true }),
      0
    )
  }

  const selectSlashKnowledgeBase = (id: string) => {
    consumeSlashTrigger()
    toggleKnowledgeBase(id)
    dismissSlashMenu()
    window.setTimeout(
      () => textareaRef.current?.focus({ preventScroll: true }),
      0
    )
  }

  const startNewTaskFromSlash = () => {
    if (taskStartDisabled || attachmentActionDisabled) return
    consumeSlashTrigger()
    dismissSlashMenu()
    onStartNewTask()
  }

  const compactFromSlash = () => {
    if (!compactAvailable || compacting || modelPreferencePending) return
    dismissSlashMenu()
    onCompact()
  }

  const startApplicationFromSlash = (application: Application) => {
    if (taskStartDisabled || attachmentActionDisabled) return
    consumeSlashTrigger()
    dismissSlashMenu()
    onStartApplication(application)
  }

  const submit = (event: FormEvent) => {
    event.preventDefault()
    const nextValue = latestValueRef.current
    if (!canSendValue(nextValue)) return
    if (isConversationContextCompactionCommand(nextValue)) {
      onCompact()
      return
    }
    onSubmit(nextValue)
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (commandMenuOpen && !event.nativeEvent.isComposing) {
      if (event.key === "Escape") {
        event.preventDefault()
        dismissCommandMenu()
        return
      }
      if (
        event.key === "ArrowDown" ||
        event.key === "ArrowUp" ||
        event.key === "Home" ||
        event.key === "End" ||
        (event.key === "Enter" && !event.shiftKey)
      ) {
        event.preventDefault()
        const command = commandMenuRef.current?.querySelector<HTMLElement>(
          '[data-slot="command"]'
        )
        command?.dispatchEvent(
          new window.KeyboardEvent("keydown", {
            key: event.key,
            code: event.code,
            bubbles: true,
            cancelable: true,
          })
        )
        return
      }
    }
    if (
      event.key === "Enter" &&
      !event.shiftKey &&
      !event.nativeEvent.isComposing
    ) {
      event.preventDefault()
      const nextValue = latestValueRef.current
      if (!canSendValue(nextValue)) return
      if (isConversationContextCompactionCommand(nextValue)) {
        onCompact()
        return
      }
      onSubmit(nextValue)
    }
  }

  const queueAttachmentUpload = useCallback(
    (files: File[]) => {
      try {
        const operation = onAttach(files)
        if (operation === false) return false
        void Promise.resolve(operation).catch(() => undefined)
        return true
      } catch {
        // Parent mutations publish their own user-visible upload errors.
        return false
      }
    },
    [onAttach]
  )

  const handleAttachmentInputChange = (
    event: ChangeEvent<HTMLInputElement>
  ) => {
    const files = Array.from(event.target.files ?? [])
    if (files.length) queueAttachmentUpload(files)
    event.target.value = ""
  }

  const handleDragEnter = (event: DragEvent<HTMLFormElement>) => {
    if (!hasTransferredFiles(event.dataTransfer)) return
    event.preventDefault()
    event.stopPropagation()
    if (!attachmentActionDisabled) setIsDraggingFiles(true)
  }

  const handleDragOver = (event: DragEvent<HTMLFormElement>) => {
    if (!hasTransferredFiles(event.dataTransfer)) return
    event.preventDefault()
    event.stopPropagation()
    event.dataTransfer.dropEffect = attachmentActionDisabled ? "none" : "copy"
    if (!attachmentActionDisabled) setIsDraggingFiles(true)
  }

  const handleDragLeave = (event: DragEvent<HTMLFormElement>) => {
    if (!hasTransferredFiles(event.dataTransfer)) return
    const nextTarget = event.relatedTarget
    if (
      nextTarget instanceof Node &&
      event.currentTarget.contains(nextTarget)
    ) {
      return
    }
    setIsDraggingFiles(false)
  }

  const handleDrop = (event: DragEvent<HTMLFormElement>) => {
    if (!hasTransferredFiles(event.dataTransfer)) return
    event.preventDefault()
    event.stopPropagation()
    setIsDraggingFiles(false)

    if (attachmentActionDisabled) return
    const files = getTransferredFiles(event.dataTransfer)
    if (files.length) queueAttachmentUpload(files)
  }

  const attachPastedText = useCallback(
    async (
      pastedText: string,
      valueAtPaste: string,
      selectionStart: number,
      selectionEnd: number
    ) => {
      const attachment = createPastedTextAttachment(pastedText, {
        filenamePrefix: t("conversation.pastedTextFilePrefix"),
      })
      const pendingAttachment = {
        name: attachment.file.name,
        characterCount: attachment.characterCount,
        size: attachment.file.size,
        content: pastedText,
      }
      setPendingPastedTextAttachment(pendingAttachment)
      setPastedTextAttachmentNames((current) =>
        current.includes(attachment.file.name)
          ? current
          : [...current, attachment.file.name]
      )
      setPastedTextAttachmentContents((current) => ({
        ...current,
        [attachment.file.name]: pastedText,
      }))

      try {
        const accepted = await onAttach([attachment.file])
        if (accepted === false) throw new Error("attachment operation busy")
      } catch {
        setPastedTextAttachmentNames((current) =>
          current.filter((name) => name !== attachment.file.name)
        )
        setPastedTextAttachmentContents((current) => {
          if (!(attachment.file.name in current)) return current
          const next = { ...current }
          delete next[attachment.file.name]
          return next
        })
        const restoredValue = restorePastedTextAtSelection(
          valueAtPaste,
          pastedText,
          selectionStart,
          selectionEnd
        )
        latestValueRef.current = restoredValue
        onValueChange(restoredValue)
      } finally {
        setPendingPastedTextAttachment((current) =>
          current?.name === pendingAttachment.name ? null : current
        )
      }
    },
    [onAttach, onValueChange, t]
  )

  const handlePaste = (event: ClipboardEvent<HTMLTextAreaElement>) => {
    if (attachmentActionDisabled) return
    const files = getTransferredFiles(event.clipboardData)
    if (files.length > 0) {
      const hasPlainText =
        (event.clipboardData.getData?.("text/plain") ?? "").length > 0
      const accepted = queueAttachmentUpload(files)
      if (!hasPlainText && accepted) event.preventDefault()
      return
    }

    const pastedText = event.clipboardData.getData("text/plain")
    if (!shouldConvertPastedTextToAttachment(pastedText)) return

    event.preventDefault()
    const valueAtPaste = latestValueRef.current
    const selectionStart =
      event.currentTarget.selectionStart ?? valueAtPaste.length
    const selectionEnd = event.currentTarget.selectionEnd ?? selectionStart
    void attachPastedText(
      pastedText,
      valueAtPaste,
      selectionStart,
      selectionEnd
    )
  }

  const handleCapabilityMenuOpenChange = (open: boolean) => {
    setMenuOpen(open)
    if (open && !managedApplicationName) {
      onRetryCapabilities?.()
    }
  }

  const openAttachmentFilePicker = () => {
    setMenuOpen(false)
    fileInputRef.current?.click()
  }

  const openAttachmentFolderPicker = () => {
    setMenuOpen(false)
    directoryInputRef.current?.click()
  }

  const enableGoalMode = () => {
    if (attachmentActionDisabled) return
    onGoalModeChange?.(true)
    setMenuOpen(false)
    window.setTimeout(
      () =>
        textareaRef.current?.focus({
          preventScroll: true,
        }),
      0
    )
  }

  const disableGoalMode = () => {
    if (attachmentActionDisabled) return
    onGoalModeChange?.(false)
    window.setTimeout(
      () =>
        textareaRef.current?.focus({
          preventScroll: true,
        }),
      0
    )
  }

  const togglePlanMode = () => {
    if (planModeDisabled || attachmentActionDisabled) return
    onPlanModeChange?.(!planMode)
    setMenuOpen(false)
    window.setTimeout(
      () =>
        textareaRef.current?.focus({
          preventScroll: true,
        }),
      0
    )
  }

  const knowledgeSearchUnavailable =
    knowledgeSearchCapability?.status === "unavailable"

  return (
    <form
      ref={composerShellRef}
      className="composer-shell"
      aria-label={t("conversation.messageInput")}
      data-slash-menu-open={commandMenuOpen || undefined}
      data-drag-active={isDraggingFiles || undefined}
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      onSubmit={submit}
    >
      {isDraggingFiles && (
        <div
          className="composer-drop-target"
          role="status"
          aria-live="polite"
          data-testid="composer-drop-target"
        >
          <FileIcon aria-hidden="true" />
          <span>{t("conversation.dropFilesToAttach")}</span>
        </div>
      )}
      {skillMenuOpen && (
        <ConversationSkillCommandMenu
          ref={commandMenuRef}
          query={skillTrigger?.query ?? ""}
          capabilities={capabilities}
          capabilitiesLoading={capabilitiesLoading}
          capabilitiesError={capabilitiesError}
          selectedCapabilityIds={selectedIds}
          onRetryCapabilities={onRetryCapabilities}
          onSelectCapability={selectSkillCapability}
        />
      )}
      {slashMenuOpen && !skillMenuOpen && (
        <ConversationSlashCommandMenu
          ref={commandMenuRef}
          panel={slashPanel ?? "root"}
          query={slashPanel === null ? (slashTrigger?.query ?? "") : ""}
          capabilities={capabilities}
          capabilitiesLoading={capabilitiesLoading}
          capabilitiesError={capabilitiesError}
          selectedCapabilityIds={selectedIds}
          onRetryCapabilities={onRetryCapabilities}
          onSelectCapability={selectSlashCapability}
          knowledgeBases={knowledgeBases}
          knowledgeBasesLoading={knowledgeBasesLoading}
          knowledgeBasesError={knowledgeBasesError}
          knowledgeSearchCapability={knowledgeSearchCapability}
          selectedKnowledgeBaseIds={selectedKnowledgeBaseIds}
          hasMoreKnowledgeBases={hasMoreKnowledgeBases}
          loadingMoreKnowledgeBases={loadingMoreKnowledgeBases}
          onRetryKnowledgeBases={onRetryKnowledgeBases}
          onLoadMoreKnowledgeBases={onLoadMoreKnowledgeBases}
          onSelectKnowledgeBase={selectSlashKnowledgeBase}
          managedApplicationName={managedApplicationName}
          startingApplicationId={startingApplicationId}
          onStartApplication={startApplicationFromSlash}
          onSelectPanel={openSlashPanel}
          onStartNewTask={startNewTaskFromSlash}
          onCompact={compactFromSlash}
          compactAvailable={
            compactAvailable &&
            slashTrigger !== null &&
            value.slice(0, slashTrigger.start).trim().length === 0
          }
          compacting={compacting}
          taskStartDisabled={taskStartDisabled}
        />
      )}
      {(selected.length > 0 ||
        selectedKnowledgeBaseIds.length > 0 ||
        attachments.length > 0 ||
        visiblePendingAttachmentUploads.length > 0 ||
        pendingPastedTextAttachment) && (
        <div
          className={cn(
            "composer-context-row",
            hasNonImageAttachments && "composer-context-row-with-files"
          )}
        >
          {selected.map((capability) => (
            <span
              key={capability.id}
              className="composer-context-chip capability-chip"
            >
              <CapabilityIcon
                type={capability.type}
                logoUrl={capability.logo_url}
                className="capability-chip-icon"
              />
              <span className="composer-chip-label min-w-0 truncate">
                {capabilityPresentation(capability, t, productName).name}
              </span>
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                className="chip-remove"
                aria-label={t("conversation.removeCapability", {
                  name: capabilityPresentation(capability, t, productName).name,
                })}
                disabled={submitting}
                onClick={() => toggleCapability(capability.id)}
              >
                <XIcon aria-hidden="true" />
              </Button>
            </span>
          ))}
          {selectedKnowledgeBases.map(({ id, knowledgeBase }) => {
            const selectionStatus = knowledgeBaseSelectionStatusById?.[id]
            const loading =
              selectionStatus === "loading" ||
              (selectionStatus === undefined &&
                !knowledgeBase &&
                Boolean(knowledgeBasesLoading))
            const verificationFailed = selectionStatus === "verification_failed"
            const unavailable =
              selectionStatus === "unavailable" ||
              (selectionStatus === undefined &&
                (knowledgeBase
                  ? !isKnowledgeBaseAvailableForTurn(knowledgeBase)
                  : !loading))
            const name =
              knowledgeBase?.name ??
              (loading
                ? t("common.loading")
                : verificationFailed
                  ? t("conversation.knowledgeBaseVerificationUnavailable")
                  : t("conversation.knowledgeBaseUnavailable"))
            return (
              <span
                key={id}
                className="composer-context-chip capability-chip knowledge-base-chip"
                data-unavailable={unavailable || undefined}
              >
                <BookOpenIcon
                  className="capability-chip-icon knowledge-base-chip-icon"
                  aria-hidden="true"
                />
                <span className="composer-chip-label min-w-0 truncate">
                  {name}
                  {knowledgeBase && unavailable && (
                    <span className="text-destructive">
                      {` · ${t("conversation.knowledgeBaseUnavailable")}`}
                    </span>
                  )}
                  {knowledgeBase && verificationFailed && (
                    <span className="text-muted-foreground">
                      {` · ${t("conversation.knowledgeBaseVerificationUnavailable")}`}
                    </span>
                  )}
                </span>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  className="chip-remove"
                  aria-label={t("conversation.removeKnowledgeBase", { name })}
                  disabled={submitting}
                  onClick={() => toggleKnowledgeBase(id)}
                >
                  <XIcon aria-hidden="true" />
                </Button>
              </span>
            )
          })}
          {visibleComposerAttachmentItems.map((item, index) => {
            if (
              item.status === "uploading" &&
              attachmentPreviewEnabled &&
              isPreviewableImageMimeType(item.mimeType)
            ) {
              return (
                <ConversationAttachmentUploadPreview
                  key={item.key}
                  name={item.name}
                  file={item.previewFile}
                />
              )
            }
            if (
              item.status === "uploaded" &&
              attachmentPreviewEnabled &&
              isPreviewableConversationImage(item.file)
            ) {
              if (index !== firstVisibleComposerImageIndex) return null
              return (
                <ConversationAttachmentPreviews
                  key="visible-composer-image-attachments"
                  files={visibleComposerImageAttachments}
                  loadPreview={loadAttachmentPreview}
                  onRemove={removeComposerAttachment}
                  disabled={attachmentActionDisabled}
                />
              )
            }

            if (item.status === "uploaded") {
              const pastedTextContent =
                pastedTextAttachmentContents[item.file.name]
              const removeButton = (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  className="chip-remove"
                  aria-label={t("conversation.removeAttachment", {
                    name: item.file.name,
                  })}
                  disabled={attachmentActionDisabled}
                  onClick={() => removeComposerAttachment(item.file)}
                >
                  <XIcon aria-hidden="true" />
                </Button>
              )

              return pastedTextContent ? (
                <PastedTextAttachmentHover
                  key={item.key}
                  name={item.file.name}
                  mimeType={item.file.mime_type}
                  content={pastedTextContent}
                  ariaLabel={t("conversation.pastedTextAttachmentPreview", {
                    name: item.file.name,
                  })}
                  trailing={removeButton}
                />
              ) : (
                <span
                  key={item.key}
                  className="composer-context-chip attachment-chip"
                >
                  <FileTypeIcon
                    filename={item.file.name}
                    mimeType={item.file.mime_type}
                  />
                  <span className="composer-chip-label min-w-0 truncate">
                    {item.file.name}
                  </span>
                  {removeButton}
                </span>
              )
            }

            if (item.pastedText) {
              return (
                <span
                  key={item.key}
                  role="status"
                  data-testid="pasted-text-attachment-pending"
                >
                  <PastedTextAttachmentHover
                    name={item.name}
                    mimeType="text/plain"
                    content={item.pastedText.content}
                    ariaLabel={t("conversation.pastedTextAttachmentPreview", {
                      name: item.name,
                    })}
                    meta={
                      <span className="shrink-0 text-[var(--app-muted)]">
                        {t("conversation.pastedTextAttachmentMeta", {
                          characters: new Intl.NumberFormat(language).format(
                            item.pastedText.characterCount
                          ),
                          size: formatFileSize(item.pastedText.size, language),
                        })}
                      </span>
                    }
                    trailing={
                      <LoaderCircleIcon
                        className="size-3 animate-spin"
                        aria-hidden="true"
                      />
                    }
                  />
                  <span className="sr-only">
                    {t("conversation.pastedTextAttachmentUploading")}
                  </span>
                </span>
              )
            }

            return (
              <span
                key={item.key}
                className="composer-context-chip attachment-chip attachment-chip-pending"
                role="status"
                aria-label={t("conversation.attachmentUploadingName", {
                  name: item.name,
                })}
              >
                <FileTypeIcon filename={item.name} mimeType={item.mimeType} />
                <span className="composer-chip-label min-w-0 truncate">
                  {item.name}
                </span>
                <LoaderCircleIcon
                  className="attachment-chip-spinner animate-spin"
                  aria-hidden="true"
                />
              </span>
            )
          })}
          <ConversationAttachmentOverflow
            items={composerAttachmentItems}
            hiddenCount={hiddenComposerAttachmentCount}
            triggerClassName="composer-context-chip composer-attachment-overflow-trigger"
            disabled={attachmentActionDisabled || hasAttachmentUploadsPending}
            onRemove={removeComposerAttachment}
            onClearAll={clearComposerAttachments}
          />
        </div>
      )}

      {unavailableMessage && (
        <FieldDescription role="status" className="flex items-start gap-2">
          <CircleAlertIcon
            aria-hidden="true"
            className="mt-0.5 size-4 shrink-0 text-destructive"
          />
          {unavailableMessage}
        </FieldDescription>
      )}
      <div className="composer-input-layer">
        {hasComposerInputUrl && (
          <ConversationComposerUrlHighlightLayer
            ref={composerInputHighlightRef}
            segments={composerInputSegments}
          />
        )}
        <Textarea
          ref={textareaRef}
          value={value}
          onChange={(event) => {
            const nextValue = event.target.value
            setSlashPanel(null)
            setDismissedSlashValue(null)
            setDismissedSkillValue(null)
            if (
              !attachmentActionDisabled &&
              isCapabilityMenuShortcutInsertion(
                latestValueRef.current,
                nextValue,
                event.target.selectionStart
              )
            ) {
              setKnowledgeMenuOpen(false)
              handleCapabilityMenuOpenChange(true)
              return
            }
            latestValueRef.current = nextValue
            onValueChange(nextValue)
          }}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
          onScroll={(event) => {
            const highlight = composerInputHighlightRef.current
            if (highlight) highlight.scrollTop = event.currentTarget.scrollTop
          }}
          aria-label={t("conversation.messageInput")}
          aria-controls={
            skillMenuOpen
              ? "conversation-skill-command-menu"
              : slashMenuOpen
                ? "conversation-slash-command-menu"
                : undefined
          }
          placeholder={
            unavailableMessage ??
            t(
              !value.trim() && hasPastedTextAttachment
                ? "conversation.pastedTextAttachmentPlaceholder"
                : goalMode
                  ? "conversation.goal.placeholder"
                  : planMode
                    ? "conversation.plan.placeholder"
                    : isRunning
                      ? "conversation.followUpPlaceholder"
                      : "conversation.placeholder",
              { productName }
            )
          }
          disabled={submitting || interactionBlocked}
          className={cn(
            "composer-input composer-input-textarea min-h-14 border-0 bg-transparent px-1 py-2 text-sm leading-6 shadow-none focus-visible:bg-transparent focus-visible:ring-0",
            hasComposerInputUrl && "composer-input-has-url",
            hasLeadingComposerInputUrl && "composer-input-has-leading-url"
          )}
        />
      </div>

      <div className="mt-1 flex min-w-0 items-center gap-3">
        <div className="flex shrink-0 items-center gap-1">
          <Popover
            open={menuOpen}
            onOpenChange={handleCapabilityMenuOpenChange}
          >
            <PopoverTrigger
              render={
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  className="composer-control"
                  aria-label={t("conversation.addMenu")}
                  disabled={attachmentActionDisabled}
                />
              }
            >
              <PlusIcon
                className="size-[18px] text-[var(--app-text)]"
                aria-hidden="true"
              />
            </PopoverTrigger>
            <PopoverContent
              side="top"
              align="start"
              sideOffset={10}
              className="capability-popover capability-picker-popover gap-2"
            >
              <PopoverHeader className="sr-only">
                <PopoverTitle>{t("conversation.addMenuTitle")}</PopoverTitle>
              </PopoverHeader>
              <Command className="bg-transparent">
                {!managedApplicationName && (
                  <CommandInput
                    placeholder={t("conversation.capabilitySearch")}
                    autoFocus={shouldAutoFocusOnDesktop()}
                  />
                )}
                <CommandList className="[&_[data-slot=command-item]]:rounded-md">
                  <CommandGroup heading={t("conversation.addGroup")}>
                    <CommandItem
                      value={t("conversation.attachFileMenuSearchValue")}
                      disabled={attachmentActionDisabled}
                      onSelect={openAttachmentFilePicker}
                    >
                      <span className="capability-menu-icon capability-menu-action-icon">
                        <FileIcon aria-hidden="true" />
                      </span>
                      <span className="min-w-0 flex-1 truncate text-xs font-medium">
                        {t("conversation.attachFileMenuLabel")}
                      </span>
                    </CommandItem>
                    <CommandItem
                      value={t("conversation.attachFolderMenuSearchValue")}
                      disabled={attachmentActionDisabled}
                      onSelect={openAttachmentFolderPicker}
                    >
                      <span className="capability-menu-icon capability-menu-action-icon">
                        <FolderOpenIcon aria-hidden="true" />
                      </span>
                      <span className="min-w-0 flex-1 truncate text-xs font-medium">
                        {t("conversation.attachFolderMenuLabel")}
                      </span>
                    </CommandItem>
                    {!managedApplicationName && (
                      <CommandItem
                        value={t("conversation.goal.menuSearchValue")}
                        disabled={attachmentActionDisabled}
                        onSelect={enableGoalMode}
                      >
                        <span className="capability-menu-icon capability-menu-action-icon">
                          <GoalIcon aria-hidden="true" />
                        </span>
                        <span
                          className="flex min-w-0 flex-1 items-center gap-2"
                          data-goal-labels=""
                        >
                          <span className="max-w-[48%] shrink-0 truncate text-xs font-medium">
                            {t("conversation.goal.menuLabel")}
                          </span>
                          <span className="min-w-0 flex-1 truncate text-[length:var(--app-font-12)] font-normal text-[var(--app-muted)]">
                            {t("conversation.goal.menuDescription")}
                          </span>
                        </span>
                      </CommandItem>
                    )}
                    {planModeAvailable && (
                      <CommandItem
                        value={t("conversation.plan.menuSearchValue")}
                        data-checked={planMode || undefined}
                        disabled={attachmentActionDisabled || planModeDisabled}
                        onSelect={togglePlanMode}
                      >
                        <span className="capability-menu-icon capability-menu-action-icon">
                          <LightbulbIcon aria-hidden="true" />
                        </span>
                        <span className="flex min-w-0 flex-1 items-center gap-2">
                          <span className="max-w-[48%] shrink-0 truncate text-xs font-medium">
                            {t("conversation.plan.menuLabel")}
                          </span>
                          <span className="min-w-0 flex-1 truncate text-[length:var(--app-font-12)] font-normal text-[var(--app-muted)]">
                            {t("conversation.plan.menuDescription")}
                          </span>
                        </span>
                      </CommandItem>
                    )}
                  </CommandGroup>
                  {!managedApplicationName && (
                    <>
                      {capabilitiesLoading && (
                        <div className="page-state" role="status">
                          <LoaderCircleIcon
                            className="size-3.5 animate-spin"
                            aria-hidden="true"
                          />
                          {t("common.loading")}
                        </div>
                      )}
                      {capabilitiesError && (
                        <div className="search-error" role="alert">
                          <p>{t("conversation.capabilityUnavailable")}</p>
                          {onRetryCapabilities && (
                            <Button
                              type="button"
                              size="sm"
                              variant="secondary"
                              className="mt-2"
                              onClick={onRetryCapabilities}
                            >
                              {t("common.retry")}
                            </Button>
                          )}
                        </div>
                      )}
                      {!capabilitiesLoading &&
                        !capabilitiesError &&
                        capabilityGroups.length > 0 && (
                          <CommandEmpty>
                            {t("conversation.noCapabilities")}
                          </CommandEmpty>
                        )}
                      {!capabilitiesLoading &&
                        !capabilitiesError &&
                        capabilityGroups.length === 0 && (
                          <div
                            data-slot="command-empty"
                            className="py-6 text-center text-sm font-medium"
                          >
                            {t("conversation.noCapabilities")}
                          </div>
                        )}
                      {!capabilitiesLoading &&
                        !capabilitiesError &&
                        capabilityGroups.map(({ type, items }) => (
                          <CommandGroup
                            key={type}
                            heading={t(
                              type === "plugin"
                                ? "conversation.pluginGroup"
                                : "conversation.skillGroup"
                            )}
                          >
                            {items.map((capability) => {
                              const selectable =
                                canSelectConversationCapability(capability)
                              const presentation = capabilityPresentation(
                                capability,
                                t,
                                productName
                              )
                              return (
                                <CommandItem
                                  key={capability.id}
                                  value={`${capability.name} ${presentation.name} ${presentation.description ?? ""}`}
                                  data-checked={
                                    selectedIds.includes(capability.id) ||
                                    undefined
                                  }
                                  disabled={submitting || !selectable}
                                  onSelect={() => {
                                    if (selectable) {
                                      handleCapabilitySelect(capability.id)
                                    }
                                  }}
                                >
                                  <span className="capability-menu-icon">
                                    <CapabilityIcon
                                      type={capability.type}
                                      logoUrl={capability.logo_url}
                                    />
                                  </span>
                                  <span
                                    className="flex min-w-0 flex-1 items-center gap-2"
                                    data-capability-labels=""
                                  >
                                    <span
                                      className="max-w-[48%] shrink-0 truncate text-xs font-medium"
                                      data-capability-name=""
                                    >
                                      {presentation.name}
                                    </span>
                                    {presentation.description && (
                                      <span
                                        className="min-w-0 flex-1 truncate text-[length:var(--app-font-12)] font-normal text-[var(--app-muted)]"
                                        data-capability-description=""
                                      >
                                        {presentation.description}
                                      </span>
                                    )}
                                  </span>
                                  {capability.is_builtin && (
                                    <span className="shrink-0 text-[length:var(--app-font-10)] text-[var(--app-muted)]">
                                      {t("capability.builtIn")}
                                    </span>
                                  )}
                                </CommandItem>
                              )
                            })}
                          </CommandGroup>
                        ))}
                    </>
                  )}
                </CommandList>
              </Command>
            </PopoverContent>
          </Popover>

          {!managedApplicationName && (
            <>
              {knowledgeSearchUnavailable ? (
                <HoverCard>
                  <HoverCardTrigger
                    render={
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        className="composer-control cursor-not-allowed opacity-50"
                        aria-label={t("conversation.addKnowledgeBase")}
                        aria-disabled="true"
                      />
                    }
                  >
                    <BookOpenIcon
                      className="size-[18px] text-[var(--app-text)]"
                      aria-hidden="true"
                    />
                  </HoverCardTrigger>
                  <HoverCardContent
                    side="top"
                    align="start"
                    sideOffset={10}
                    aria-label={t(
                      "knowledge.searchCapability.unavailableTitle"
                    )}
                    className="w-[min(360px,calc(100vw-2rem))]"
                  >
                    <div className="flex items-start gap-2.5">
                      <TriangleAlertIcon
                        className="mt-0.5 size-4 shrink-0 text-destructive"
                        aria-hidden="true"
                      />
                      <div className="min-w-0">
                        <p className="font-medium">
                          {t("knowledge.searchCapability.unavailableTitle")}
                        </p>
                        <p className="mt-1 text-xs leading-5 text-[var(--app-muted)]">
                          {t(
                            getKnowledgeSearchUnavailableDescriptionKey(
                              knowledgeSearchCapability
                            )
                          )}
                        </p>
                      </div>
                    </div>
                  </HoverCardContent>
                </HoverCard>
              ) : (
                <Popover
                  open={knowledgeMenuOpen}
                  onOpenChange={(open) => {
                    setKnowledgeMenuOpen(open)
                    if (open) onRetryKnowledgeBases?.()
                  }}
                >
                  <PopoverTrigger
                    render={
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        className="composer-control"
                        aria-label={t("conversation.addKnowledgeBase")}
                        disabled={attachmentActionDisabled}
                      />
                    }
                  >
                    <BookOpenIcon
                      className="size-[18px] text-[var(--app-text)]"
                      aria-hidden="true"
                    />
                  </PopoverTrigger>
                  <PopoverContent
                    side="top"
                    align="start"
                    sideOffset={10}
                    className="capability-popover gap-2"
                  >
                    <PopoverHeader className="px-2 pt-1">
                      <PopoverTitle className="text-sm">
                        {t("conversation.knowledgeBaseTitle")}
                      </PopoverTitle>
                    </PopoverHeader>
                    <Command className="bg-transparent">
                      <CommandInput
                        placeholder={t("conversation.knowledgeBaseSearch")}
                        autoFocus={shouldAutoFocusOnDesktop()}
                      />
                      <CommandList>
                        {knowledgeBasesLoading && (
                          <div className="page-state" role="status">
                            <LoaderCircleIcon
                              className="size-3.5 animate-spin"
                              aria-hidden="true"
                            />
                            {t("common.loading")}
                          </div>
                        )}
                        {knowledgeBasesError && (
                          <div className="search-error" role="alert">
                            <p>{t("conversation.knowledgeBasesUnavailable")}</p>
                            {onRetryKnowledgeBases && (
                              <Button
                                type="button"
                                size="sm"
                                variant="secondary"
                                className="mt-2"
                                onClick={onRetryKnowledgeBases}
                              >
                                {t("common.retry")}
                              </Button>
                            )}
                          </div>
                        )}
                        {!knowledgeBasesLoading && !knowledgeBasesError && (
                          <CommandEmpty>
                            {t("conversation.noKnowledgeBases")}
                          </CommandEmpty>
                        )}
                        {!knowledgeBasesLoading && !knowledgeBasesError && (
                          <CommandGroup>
                            {knowledgeBases
                              .filter(
                                (knowledgeBase) =>
                                  knowledgeBase.lifecycle_status === "active" &&
                                  knowledgeBase.availability_status ===
                                    "enabled"
                              )
                              .map((knowledgeBase) => {
                                const checked =
                                  selectedKnowledgeBaseIds.includes(
                                    knowledgeBase.id
                                  )
                                return (
                                  <CommandItem
                                    key={knowledgeBase.id}
                                    value={`${knowledgeBase.name} ${knowledgeBase.description ?? ""}`}
                                    data-checked={checked || undefined}
                                    disabled={submitting}
                                    onSelect={() =>
                                      toggleKnowledgeBase(knowledgeBase.id)
                                    }
                                  >
                                    <span className="capability-menu-icon">
                                      <BookOpenIcon aria-hidden="true" />
                                    </span>
                                    <span
                                      className="flex min-w-0 flex-1 items-center gap-2"
                                      data-knowledge-base-labels=""
                                    >
                                      <span
                                        className="max-w-[48%] shrink-0 truncate text-xs font-medium"
                                        data-knowledge-base-name=""
                                      >
                                        {knowledgeBase.name}
                                      </span>
                                      <span
                                        className="min-w-0 flex-1 truncate text-[length:var(--app-font-12)] font-normal text-[var(--app-muted)]"
                                        data-knowledge-base-description=""
                                      >
                                        {knowledgeBase.description ||
                                          t("knowledge.noDescription")}
                                      </span>
                                    </span>
                                  </CommandItem>
                                )
                              })}
                            {hasMoreKnowledgeBases &&
                              onLoadMoreKnowledgeBases && (
                                <div className="p-1">
                                  <Button
                                    type="button"
                                    variant="ghost"
                                    size="sm"
                                    className="w-full"
                                    disabled={loadingMoreKnowledgeBases}
                                    onClick={onLoadMoreKnowledgeBases}
                                  >
                                    {loadingMoreKnowledgeBases && (
                                      <LoaderCircleIcon
                                        className="animate-spin"
                                        aria-hidden="true"
                                      />
                                    )}
                                    {t("knowledge.loadMore")}
                                  </Button>
                                </div>
                              )}
                          </CommandGroup>
                        )}
                      </CommandList>
                    </Command>
                  </PopoverContent>
                </Popover>
              )}

              {goalMode && (
                <>
                  <span
                    className="composer-goal-separator"
                    aria-hidden="true"
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="composer-goal-mode"
                    aria-label={t("conversation.goal.disableMode")}
                    disabled={attachmentActionDisabled}
                    onClick={disableGoalMode}
                  >
                    <span
                      className="composer-goal-mode-target"
                      aria-hidden="true"
                    >
                      <GoalIcon aria-hidden="true" />
                    </span>
                    <span
                      className="composer-goal-mode-dismiss"
                      aria-hidden="true"
                    >
                      <XIcon aria-hidden="true" />
                    </span>
                    <span>{t("conversation.goal.modeLabel")}</span>
                  </Button>
                </>
              )}
            </>
          )}

          {planMode && (
            <>
              <span className="composer-goal-separator" aria-hidden="true" />
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="composer-goal-mode"
                aria-label={t("conversation.plan.disableMode")}
                disabled={attachmentActionDisabled || planModeDisabled}
                onClick={togglePlanMode}
              >
                <span className="composer-goal-mode-target" aria-hidden="true">
                  <LightbulbIcon aria-hidden="true" />
                </span>
                <span className="composer-goal-mode-dismiss" aria-hidden="true">
                  <XIcon aria-hidden="true" />
                </span>
                <span>{t("conversation.plan.modeLabel")}</span>
              </Button>
            </>
          )}

          <Input
            ref={fileInputRef}
            type="file"
            multiple
            aria-label={t("conversation.attach")}
            className="sr-only"
            disabled={attachmentActionDisabled}
            onChange={handleAttachmentInputChange}
          />
          <Input
            ref={directoryInputRef}
            type="file"
            multiple
            aria-label={t("conversation.attachFolder")}
            className="sr-only"
            disabled={attachmentActionDisabled}
            onChange={handleAttachmentInputChange}
          />
        </div>

        <div
          className="ml-auto flex min-w-0 flex-1 items-center justify-end gap-1.5"
          data-testid="composer-primary-actions"
        >
          {(voice.phase === "recording" ||
            voice.phase === "stopping" ||
            voice.phase === "transcribing") && (
            <VoiceRecordingControls
              elapsedSeconds={voice.elapsedSeconds}
              waveform={voice.waveform}
              isProcessing={voice.phase !== "recording"}
              onWaveformTrackResize={voice.setWaveformTrackWidth}
              onStop={voice.stopRecording}
            />
          )}

          {voice.phase === "idle" &&
            (!managedApplicationName ||
              allowManagedApplicationModelSelection) &&
            modelPreference &&
            onModelPreferenceChange && (
              <ConversationModelSelector
                preference={modelPreference}
                pending={modelPreferencePending}
                contextUsage={modelContextUsage}
                onChange={onModelPreferenceChange}
              />
            )}

          {voice.phase === "idle" && (
            <Tooltip>
              <TooltipTrigger
                render={
                  <span
                    className="inline-flex"
                    role="group"
                    tabIndex={voiceAvailable ? undefined : 0}
                    aria-label={voiceAvailable ? undefined : t(voiceTooltipKey)}
                  />
                }
              >
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  className={cn(
                    "composer-control",
                    !voiceAvailable && "text-muted-foreground opacity-50"
                  )}
                  aria-label={t("conversation.voice")}
                  disabled={
                    !voiceAvailable ||
                    taskStartDisabled ||
                    attachmentActionDisabled
                  }
                  onClick={() => {
                    onError(null)
                    voiceBaseValueRef.current = latestValueRef.current
                    voiceLastAppliedValueRef.current = latestValueRef.current
                    void voice.startRecording()
                  }}
                >
                  <MicIcon aria-hidden="true" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>{t(voiceTooltipKey)}</TooltipContent>
            </Tooltip>
          )}

          {isRunning && !showSendButton && (
            <Button
              type="button"
              size="icon"
              className="send-button rounded-full"
              aria-label={t(
                interrupting ? "conversation.interrupting" : "conversation.stop"
              )}
              disabled={interrupting}
              onClick={onInterrupt}
            >
              {interrupting ? (
                <LoaderCircleIcon
                  className="size-3 animate-spin"
                  aria-hidden="true"
                />
              ) : (
                <SquareIcon
                  className="size-3 fill-current"
                  aria-hidden="true"
                />
              )}
            </Button>
          )}
          {showSendButton && (
            <Button
              type="submit"
              size="icon"
              className="send-button rounded-full aria-disabled:opacity-50"
              aria-label={t("conversation.send")}
              aria-disabled={!canSend}
              disabled={sendButtonDisabled}
              aria-busy={submitting || undefined}
            >
              {submitting ? (
                <LoaderCircleIcon className="animate-spin" aria-hidden="true" />
              ) : (
                <ArrowUpIcon aria-hidden="true" />
              )}
            </Button>
          )}
        </div>
      </div>
    </form>
  )
})
