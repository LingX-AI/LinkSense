import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type RefObject,
} from "react"
import {
  ListPlusIcon,
  LoaderCircleIcon,
  MicIcon,
  SquareIcon,
} from "lucide-react"
import { useTranslation } from "react-i18next"

import type {
  OfficeSelectionAction,
  OfficeSelectionAnchor,
} from "@/components/media/office-preview/office-preview.types"
import { useOfficePreviewFullscreen } from "@/components/media/office-preview/office-preview-fullscreen-context"
import { Button } from "@/components/ui/button"
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupTextarea,
} from "@/components/ui/input-group"
import {
  Popover,
  PopoverContent,
  PopoverTitle,
  PopoverTrigger,
} from "@/components/ui/popover"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import {
  useVoiceTranscriptionAvailability,
  type VoiceTranscriptionAvailabilityState,
} from "@/features/conversations/use-voice-transcription-availability"
import {
  useVoiceTranscription,
  type VoiceInputFailure,
} from "@/features/conversations/use-voice-transcription"
import {
  appendVoiceTranscript,
  getVoiceInputFailureMessage,
} from "@/features/conversations/voice-input-utils"
import { normalizeLanguage } from "@/i18n"
import { shouldAutoFocusOnDesktop } from "@/lib/responsive"
import { cn } from "@/lib/utils"

const selectionActionEdgeInset = 8

export function OfficeSelectionPrompt<TSelection>({
  scopeRef,
  selection,
  anchor,
  action,
  voiceTranscriptionAvailability: voiceTranscriptionAvailabilityOverride,
}: Readonly<{
  scopeRef: RefObject<HTMLElement | null>
  selection: TSelection
  anchor?: OfficeSelectionAnchor | null
  action: OfficeSelectionAction<TSelection>
  voiceTranscriptionAvailability?: VoiceTranscriptionAvailabilityState
}>) {
  const { t, i18n } = useTranslation()
  const [open, setOpen] = useState(false)
  const [value, setValue] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const disabledReasonId = useId()
  const errorMessageId = useId()
  const fullScreen = useOfficePreviewFullscreen()
  const latestValueRef = useRef("")
  const voiceBaseValueRef = useRef("")
  const voiceLastAppliedValueRef = useRef("")
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const [isMultiline, setIsMultiline] = useState(false)

  const applyTranscript = useCallback((transcript: string) => {
    if (latestValueRef.current !== voiceLastAppliedValueRef.current) return

    const nextValue = appendVoiceTranscript(
      voiceBaseValueRef.current,
      transcript
    )
    latestValueRef.current = nextValue
    voiceLastAppliedValueRef.current = nextValue
    setValue(nextValue)
  }, [])

  const reportVoiceFailure = useCallback(
    (failure: VoiceInputFailure) => {
      setErrorMessage(getVoiceInputFailureMessage(failure, t))
    },
    [t]
  )

  const voice = useVoiceTranscription({
    language: normalizeLanguage(i18n.resolvedLanguage) ?? "zh-CN",
    onTranscriptPreview: applyTranscript,
    onTranscript: applyTranscript,
    onError: reportVoiceFailure,
  })
  const checkedVoiceTranscriptionAvailability =
    useVoiceTranscriptionAvailability({
      enabled: voiceTranscriptionAvailabilityOverride === undefined,
    })
  const voiceTranscriptionAvailability =
    voiceTranscriptionAvailabilityOverride ??
    checkedVoiceTranscriptionAvailability
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

  const updateMultilineState = useCallback(() => {
    const textarea = textareaRef.current
    if (!textarea) return

    const styles = window.getComputedStyle(textarea)
    const lineHeight = Number.parseFloat(styles.lineHeight) || 24
    const verticalPadding =
      (Number.parseFloat(styles.paddingTop) || 0) +
      (Number.parseFloat(styles.paddingBottom) || 0)
    const oneLineHeight = Math.max(
      Number.parseFloat(styles.minHeight) || 0,
      lineHeight + verticalPadding
    )
    const nextIsMultiline = textarea.scrollHeight > oneLineHeight + 1
    setIsMultiline((current) =>
      current === nextIsMultiline ? current : nextIsMultiline
    )
  }, [])

  useLayoutEffect(() => {
    const textarea = textareaRef.current
    if (!open || !textarea) {
      setIsMultiline(false)
      return
    }

    updateMultilineState()
    const resizeObserver =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(updateMultilineState)
    resizeObserver?.observe(textarea)
    window.addEventListener("resize", updateMultilineState)
    return () => {
      resizeObserver?.disconnect()
      window.removeEventListener("resize", updateMultilineState)
    }
  }, [open, updateMultilineState, value])

  useEffect(() => {
    const handleShortcut = (event: KeyboardEvent) => {
      const target = event.target
      const editableTarget =
        target instanceof HTMLElement &&
        (target.matches("input, textarea, [contenteditable='true']") ||
          target.isContentEditable)
      if (
        action.disabled ||
        event.repeat ||
        editableTarget ||
        !scopeRef.current?.contains(globalThis.document.activeElement) ||
        event.key.toLowerCase() !== "i" ||
        (!event.metaKey && !event.ctrlKey) ||
        event.altKey
      ) {
        return
      }
      event.preventDefault()
      setOpen(true)
    }
    window.addEventListener("keydown", handleShortcut)
    return () => window.removeEventListener("keydown", handleShortcut)
  }, [action.disabled, scopeRef])

  const actionStyle: CSSProperties | undefined = anchor
    ? {
        left: `${anchor.left}px`,
        top: `${anchor.top}px`,
        // Preserve the usual left placement while keeping the trigger inside
        // the preview when its anchor is close to the pane's left edge.
        transform: `translate(max(-100%, ${selectionActionEdgeInset - anchor.left}px), ${selectionActionEdgeInset}px)`,
      }
    : undefined

  const resetPrompt = () => {
    setValue("")
    latestValueRef.current = ""
    voiceBaseValueRef.current = ""
    voiceLastAppliedValueRef.current = ""
    setErrorMessage(null)
    setIsMultiline(false)
  }

  const handleOpenChange = (nextOpen: boolean) => {
    if ((submitting || voiceBusy) && !nextOpen) return
    setOpen(nextOpen)
    if (!nextOpen) {
      resetPrompt()
    }
  }

  const handleValueChange = (nextValue: string) => {
    setValue(nextValue)
    latestValueRef.current = nextValue
    setErrorMessage(null)
  }

  const startVoiceRecognition = () => {
    setErrorMessage(null)
    voiceBaseValueRef.current = latestValueRef.current
    voiceLastAppliedValueRef.current = latestValueRef.current
    void voice.startRecording()
  }

  const submit = async () => {
    const description = value.trim()
    if (!description || submitting || action.disabled || voiceBusy) return

    setSubmitting(true)
    setErrorMessage(null)
    // Treat the click as an accepted local submission immediately. The API
    // admission and conversation refresh continue in the background, while a
    // failure restores the exact request so the user can retry safely.
    setOpen(false)
    resetPrompt()
    try {
      await action.onSubmit(selection, description)
    } catch {
      setValue(description)
      latestValueRef.current = description
      voiceBaseValueRef.current = description
      voiceLastAppliedValueRef.current = description
      setErrorMessage(action.errorMessage)
      setSubmitting(false)
      setOpen(true)
      return
    }
    setSubmitting(false)
  }

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger
        render={
          <Button
            type="button"
            variant="outline"
            size="sm"
            className={cn(
              "office-selection-action",
              !anchor && "office-selection-action-docked"
            )}
            disabled={action.disabled}
            aria-describedby={
              action.disabled && action.disabledReason
                ? disabledReasonId
                : undefined
            }
            title={action.disabled ? action.disabledReason : undefined}
            style={actionStyle}
          />
        }
      >
        <span>{action.label}</span>
        {action.shortcutLabel && <kbd>{action.shortcutLabel}</kbd>}
      </PopoverTrigger>
      {action.disabled && action.disabledReason && (
        <span id={disabledReasonId} className="sr-only">
          {action.disabledReason}
        </span>
      )}
      <PopoverContent
        portalContainer={fullScreen ? scopeRef : undefined}
        positionerClassName="office-selection-prompt-positioner"
        side="right"
        sideOffset={10}
        align="center"
        className={cn(
          "w-[min(26rem,calc(100vw-2rem))] gap-1.5 p-1.5",
          errorMessage || isMultiline ? "rounded-2xl" : "rounded-full"
        )}
      >
        <PopoverTitle className="sr-only">{action.promptLabel}</PopoverTitle>
        <form
          onSubmit={(event) => {
            event.preventDefault()
            void submit()
          }}
        >
          <InputGroup
            className={cn(
              "min-h-11 border-0 bg-transparent has-[[data-slot=input-group-control]:focus-visible]:bg-transparent",
              isMultiline ? "rounded-2xl" : "rounded-full"
            )}
            aria-busy={submitting || voiceBusy}
          >
            <InputGroupTextarea
              ref={textareaRef}
              autoFocus={shouldAutoFocusOnDesktop()}
              rows={1}
              value={value}
              aria-label={action.promptLabel}
              aria-describedby={errorMessage ? errorMessageId : undefined}
              aria-invalid={Boolean(errorMessage)}
              placeholder={action.placeholder}
              disabled={submitting}
              className={cn(
                "max-h-[7.5rem] min-h-11 w-full overflow-y-auto px-3 pr-[5.75rem] text-sm leading-6 font-medium",
                isMultiline ? "pt-2 pb-10" : "py-2"
              )}
              onKeyDown={(event) => {
                if (
                  event.key !== "Enter" ||
                  event.shiftKey ||
                  event.nativeEvent.isComposing
                ) {
                  return
                }
                event.preventDefault()
                void submit()
              }}
              onChange={(event) => {
                handleValueChange(event.currentTarget.value)
              }}
            />
            <InputGroupAddon
              align="inline-end"
              className={cn(
                "absolute right-1 z-10 h-8 cursor-default gap-1.5 p-0",
                isMultiline ? "top-auto bottom-1" : "top-1/2 -translate-y-1/2"
              )}
              data-testid="office-selection-prompt-actions"
            >
              {voice.phase === "idle" && (
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <span
                        className="inline-flex"
                        role="group"
                        tabIndex={voiceAvailable ? undefined : 0}
                        aria-label={
                          voiceAvailable ? undefined : t(voiceTooltipKey)
                        }
                      />
                    }
                  >
                    <InputGroupButton
                      type="button"
                      size="icon-sm"
                      aria-label={t("conversation.voice")}
                      disabled={
                        !voiceAvailable || submitting || action.disabled
                      }
                      className={cn(
                        "rounded-full text-muted-foreground",
                        !voiceAvailable && "opacity-50"
                      )}
                      data-testid="office-selection-voice-button"
                      onClick={startVoiceRecognition}
                    >
                      <MicIcon className="size-4" aria-hidden="true" />
                    </InputGroupButton>
                  </TooltipTrigger>
                  <TooltipContent>{t(voiceTooltipKey)}</TooltipContent>
                </Tooltip>
              )}
              {voice.phase === "recording" && (
                <InputGroupButton
                  type="button"
                  variant="secondary"
                  size="icon-sm"
                  aria-label={t("conversation.voiceStop")}
                  disabled={submitting}
                  className="rounded-full"
                  data-testid="office-selection-voice-button"
                  onClick={voice.stopRecording}
                >
                  <SquareIcon
                    className="size-3.5 fill-current"
                    aria-hidden="true"
                  />
                </InputGroupButton>
              )}
              {voice.phase !== "idle" && voice.phase !== "recording" && (
                <InputGroupButton
                  type="button"
                  size="icon-sm"
                  aria-label={t(
                    voice.phase === "transcribing"
                      ? "conversation.voiceTranscribing"
                      : "conversation.voiceRecording"
                  )}
                  disabled
                  className="rounded-full text-muted-foreground"
                  data-testid="office-selection-voice-button"
                >
                  <LoaderCircleIcon
                    className="size-3.5 animate-spin"
                    aria-hidden="true"
                  />
                </InputGroupButton>
              )}
              <InputGroupButton
                type="submit"
                size="icon-sm"
                aria-label={action.submitLabel}
                disabled={!value.trim() || submitting || voiceBusy}
                className="send-button rounded-full"
              >
                {submitting ? (
                  <LoaderCircleIcon
                    className="size-3.5 animate-spin"
                    aria-hidden="true"
                  />
                ) : (
                  <ListPlusIcon className="size-3.5" aria-hidden="true" />
                )}
              </InputGroupButton>
            </InputGroupAddon>
          </InputGroup>
        </form>
        {errorMessage && (
          <p
            id={errorMessageId}
            role="alert"
            className="px-3 pb-1 text-xs text-destructive"
          >
            {errorMessage}
          </p>
        )}
      </PopoverContent>
    </Popover>
  )
}
