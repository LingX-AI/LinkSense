import type {
  OfficeAnnotationMarker,
  OfficeDocumentState,
  OfficeSelectionAction,
} from "@/components/media/office-preview/office-preview.types"

export const DOCX_MIME_TYPE =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document"

export type WordSelection = Readonly<{
  type: "text"
  paraId?: string
  selectedText: string
  paragraphText: string
  before: string
  after: string
  startParagraphIndex: number
  endParagraphIndex: number
  isMultiParagraph: boolean
  pageNumber?: number
  positionFrom?: number
  positionTo?: number
}>

export type WordDocumentState = OfficeDocumentState

export type WordSelectionAction = OfficeSelectionAction<WordSelection>

export type WordAnnotationMarker = OfficeAnnotationMarker<WordSelection>

export function isDocxDocument(input: {
  fileName: string
  mimeType?: string | null
}) {
  return (
    input.mimeType?.toLowerCase() === DOCX_MIME_TYPE ||
    input.fileName.toLowerCase().endsWith(".docx")
  )
}
