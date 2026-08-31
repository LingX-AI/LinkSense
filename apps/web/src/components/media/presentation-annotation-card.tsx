import { AnnotationHoverCard } from "@/components/media/annotation-hover-card"

const presentationMimeType =
  "application/vnd.openxmlformats-officedocument.presentationml.presentation"

export function PresentationAnnotationCard({
  ariaLabel,
  fileName,
  annotations,
  annotationLabel,
  openLabel,
  onOpen,
}: {
  ariaLabel: string
  fileName: string
  annotations: ReadonlyArray<
    Readonly<{ request: string; locationLabel?: string }>
  >
  annotationLabel: string
  openLabel?: string
  onOpen?: () => void
}) {
  return (
    <AnnotationHoverCard
      ariaLabel={ariaLabel}
      fileName={fileName}
      mimeType={presentationMimeType}
      annotations={annotations}
      annotationLabel={annotationLabel}
      openLabel={openLabel}
      onOpen={onOpen}
    />
  )
}
