import { useRef, useState } from "react"
import {
  LoaderCircleIcon,
  MessageCirclePlusIcon,
  Trash2Icon,
} from "lucide-react"
import { useTranslation } from "react-i18next"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@/components/ui/hover-card"
import type { ConversationOfficeSelection } from "@/features/conversations/conversation-office-preview"

export type OfficeAnnotationDraft = Readonly<{
  id: string
  officeSelection: ConversationOfficeSelection
  request: string
}>

function spreadsheetSelectionLabel(
  selection: Extract<
    ConversationOfficeSelection,
    Readonly<{ kind: "spreadsheet" }>
  >["selection"]
) {
  if (selection.type === "range") return selection.rangeAddress
  if (selection.type === "image") {
    return selection.name?.trim() || selection.objectId
  }
  return selection.title?.trim() || selection.name?.trim() || selection.objectId
}

export function OfficeAnnotationDraftLocation({
  officeSelection,
}: Readonly<{ officeSelection: ConversationOfficeSelection }>) {
  const { t } = useTranslation()

  if (officeSelection.kind === "presentation") {
    return t("officePreview.annotationBatch.presentationLocation", {
      slide: officeSelection.selection.slideNumber,
      count: officeSelection.selection.elements.length,
    })
  }
  if (officeSelection.kind === "word") {
    const selection = officeSelection.selection
    return selection.pageNumber
      ? t("officePreview.annotationBatch.wordPageLocation", {
          page: selection.pageNumber,
        })
      : t("officePreview.annotationBatch.wordParagraphLocation", {
          paragraph: selection.startParagraphIndex + 1,
        })
  }
  if (officeSelection.kind === "spreadsheet") {
    return t("officePreview.annotationBatch.spreadsheetLocation", {
      sheet: officeSelection.selection.sheetName,
      selection: spreadsheetSelectionLabel(officeSelection.selection),
    })
  }
  return t("officePreview.annotationBatch.htmlLocation", {
    count: officeSelection.selection.elements.length,
  })
}

export function OfficeAnnotationBatchTray({
  drafts,
  submitting,
  onRemove,
  onClear,
  onLocate,
  onSend,
}: Readonly<{
  drafts: readonly OfficeAnnotationDraft[]
  submitting: boolean
  onRemove: (id: string) => void
  onClear: () => void
  onLocate: (draft: OfficeAnnotationDraft) => void
  onSend: () => Promise<void>
}>) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [sending, setSending] = useState(false)
  const sendingRef = useRef(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  if (drafts.length === 0) return null

  const submit = async () => {
    if (submitting || sendingRef.current) return
    sendingRef.current = true
    setErrorMessage(null)
    setSending(true)
    try {
      await onSend()
      setOpen(false)
    } catch {
      setErrorMessage(t("officePreview.annotationBatch.sendError"))
      setOpen(true)
    } finally {
      sendingRef.current = false
      setSending(false)
    }
  }
  const busy = submitting || sending

  return (
    <section
      className="office-annotation-batch"
      aria-label={t("officePreview.annotationBatch.regionLabel")}
    >
      <HoverCard open={open} onOpenChange={setOpen}>
        <HoverCardTrigger
          render={
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="office-annotation-batch-trigger rounded-full"
              aria-label={t("officePreview.annotationBatch.triggerLabel", {
                count: drafts.length,
              })}
            />
          }
        >
          <MessageCirclePlusIcon data-icon="inline-start" aria-hidden="true" />
          {t("officePreview.annotationBatch.count", { count: drafts.length })}
        </HoverCardTrigger>
        <HoverCardContent
          side="top"
          align="end"
          sideOffset={10}
          positionerClassName="z-70"
          className="flex w-[min(24rem,calc(100vw-2rem))] flex-col gap-3 p-3"
          aria-label={t("officePreview.annotationBatch.listLabel")}
        >
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-sm font-semibold">
              {t("officePreview.annotationBatch.title")}
            </h2>
            <Badge variant="secondary">
              {t("officePreview.annotationBatch.count", {
                count: drafts.length,
              })}
            </Badge>
          </div>

          <ol className="flex max-h-72 flex-col gap-2 overflow-y-auto overscroll-contain">
            {drafts.map((draft, index) => (
              <li
                key={draft.id}
                className="flex min-w-0 items-start gap-2 rounded-xl bg-muted/60 p-2.5"
              >
                <Button
                  type="button"
                  variant="ghost"
                  className="office-annotation-batch-locate h-auto min-w-0 flex-1 items-start justify-start gap-2 rounded-lg p-0 text-start whitespace-normal hover:bg-transparent"
                  aria-label={t("officePreview.annotationBatch.locate", {
                    index: index + 1,
                  })}
                  onClick={() => {
                    setOpen(false)
                    onLocate(draft)
                  }}
                >
                  <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-background text-xs font-medium text-muted-foreground">
                    {index + 1}
                  </span>
                  <span className="flex min-w-0 flex-1 flex-col gap-1">
                    <span className="truncate text-xs font-medium text-muted-foreground">
                      <OfficeAnnotationDraftLocation
                        officeSelection={draft.officeSelection}
                      />
                    </span>
                    <span className="office-annotation-batch-request line-clamp-3 leading-5 whitespace-pre-wrap">
                      {draft.request}
                    </span>
                  </span>
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  className="text-muted-foreground/60 hover:text-muted-foreground"
                  aria-label={t("officePreview.annotationBatch.remove", {
                    index: index + 1,
                  })}
                  disabled={busy}
                  onClick={() => {
                    if (drafts.length === 1) setOpen(false)
                    onRemove(draft.id)
                  }}
                >
                  <Trash2Icon aria-hidden="true" />
                </Button>
              </li>
            ))}
          </ol>

          {errorMessage && (
            <p role="alert" className="text-xs text-destructive">
              {errorMessage}
            </p>
          )}

          <div className="flex items-center justify-between gap-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={busy}
              onClick={() => {
                setOpen(false)
                onClear()
              }}
            >
              {t("officePreview.annotationBatch.clear")}
            </Button>
            <Button
              type="button"
              size="xs"
              className="office-annotation-batch-send"
              aria-busy={busy}
              disabled={busy}
              onClick={() => void submit()}
            >
              {busy && (
                <LoaderCircleIcon
                  data-icon="inline-start"
                  className="animate-spin"
                  aria-hidden="true"
                />
              )}
              {t("officePreview.annotationBatch.sendAll")}
            </Button>
          </div>
        </HoverCardContent>
      </HoverCard>
    </section>
  )
}
