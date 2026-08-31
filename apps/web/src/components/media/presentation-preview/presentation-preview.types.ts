import type {
  OfficeAnnotationMarker,
  OfficeDocumentState,
  OfficeSelectionAction,
} from "@/components/media/office-preview/office-preview.types"

export const PPTX_MIME_TYPE =
  "application/vnd.openxmlformats-officedocument.presentationml.presentation"

export type PresentationElementBounds = Readonly<{
  x: number
  y: number
  width: number
  height: number
  rotation?: number
}>

export type PresentationElementSelection = Readonly<{
  elementId: string
  shapeId?: string
  type: string
  name?: string
  text?: string
  bounds: PresentationElementBounds
}>

export type PresentationSelection = Readonly<{
  slideIndex: number
  slideNumber: number
  elementIds: readonly string[]
  elements: readonly PresentationElementSelection[]
}>

export type PresentationAnnotationMarker =
  OfficeAnnotationMarker<PresentationSelection>

export type PresentationDocumentState = OfficeDocumentState

export type PresentationSelectionAction =
  OfficeSelectionAction<PresentationSelection>

export function isPptxPresentation(input: {
  fileName: string
  mimeType?: string | null
}) {
  return (
    input.mimeType?.toLowerCase() === PPTX_MIME_TYPE ||
    input.fileName.toLowerCase().endsWith(".pptx")
  )
}
