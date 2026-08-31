import { MessageSquareIcon } from "lucide-react"
import { useRef, useState, type KeyboardEvent } from "react"

import { FileTypeIcon } from "@/components/media/file-type-icon"
import { badgeVariants } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@/components/ui/hover-card"
import { cn } from "@/lib/utils"

export type AnnotationHoverCardProps = Readonly<{
  ariaLabel: string
  fileName: string
  mimeType?: string | null
  annotations: ReadonlyArray<
    Readonly<{ request: string; locationLabel?: string }>
  >
  annotationLabel: string
  openLabel?: string
  onOpen?: () => void
}>

function keyedAnnotations(
  annotations: AnnotationHoverCardProps["annotations"]
) {
  const occurrences = new Map<string, number>()
  return annotations.map((annotation) => {
    const identity = `${annotation.locationLabel ?? ""}\u0000${annotation.request}`
    const occurrence = (occurrences.get(identity) ?? 0) + 1
    occurrences.set(identity, occurrence)
    return { annotation, key: `${identity}\u0000${occurrence}` }
  })
}

export function AnnotationHoverCard({
  ariaLabel,
  fileName,
  mimeType,
  annotations,
  annotationLabel,
  openLabel,
  onOpen,
}: AnnotationHoverCardProps) {
  const [open, setOpen] = useState(false)
  const focusFileOnOpenRef = useRef(false)

  const handleFileButtonRef = (node: HTMLButtonElement | null) => {
    if (!node || !focusFileOnOpenRef.current) {
      return
    }

    focusFileOnOpenRef.current = false
    node.focus()
  }

  const handleOpenChange = (nextOpen: boolean) => {
    setOpen(nextOpen)

    if (!nextOpen) {
      focusFileOnOpenRef.current = false
    }
  }

  const handleTriggerKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (onOpen && (event.key === "Enter" || event.key === " ")) {
      focusFileOnOpenRef.current = true
    }
  }

  const fileHeader = (
    <>
      <FileTypeIcon
        className="annotation-hover-file-icon"
        filename={fileName}
        mimeType={mimeType}
      />
      <span className="annotation-hover-file-name">{fileName}</span>
    </>
  )

  return (
    <section className="annotation-hover" aria-label={ariaLabel}>
      <HoverCard open={open} onOpenChange={handleOpenChange}>
        <HoverCardTrigger
          type="button"
          onKeyDown={handleTriggerKeyDown}
          className={cn(
            badgeVariants({ variant: "outline" }),
            "annotation-hover-trigger"
          )}
        >
          <MessageSquareIcon aria-hidden="true" />
          <span>{annotationLabel}</span>
        </HoverCardTrigger>
        <HoverCardContent
          side="top"
          align="end"
          aria-label={ariaLabel}
          className="annotation-hover-content"
        >
          {onOpen ? (
            <Button
              type="button"
              variant="ghost"
              className="annotation-hover-file"
              ref={handleFileButtonRef}
              aria-label={openLabel ?? fileName}
              onClick={onOpen}
            >
              {fileHeader}
            </Button>
          ) : (
            <div className="annotation-hover-file annotation-hover-file-static">
              {fileHeader}
            </div>
          )}
          <ol className="annotation-hover-list">
            {keyedAnnotations(annotations).map(({ annotation, key }, index) => (
              <li key={key} className="annotation-hover-item">
                {annotations.length > 1 && (
                  <span className="annotation-hover-index">{index + 1}</span>
                )}
                <div className="annotation-hover-item-content">
                  {annotation.locationLabel && (
                    <span className="annotation-hover-location">
                      {annotation.locationLabel}
                    </span>
                  )}
                  <p className="annotation-hover-request">
                    {annotation.request}
                  </p>
                </div>
              </li>
            ))}
          </ol>
        </HoverCardContent>
      </HoverCard>
    </section>
  )
}
