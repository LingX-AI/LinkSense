import type {
  OfficeAnnotationMarker,
  OfficeDocumentState,
  OfficeSelectionAction,
} from "@/components/media/office-preview/office-preview.types"

export const HTML_MIME_TYPE = "text/html"

export type HtmlElementBounds = Readonly<{
  x: number
  y: number
  width: number
  height: number
}>

export type HtmlElementSelection = Readonly<{
  selector: string
  domPath: readonly number[]
  tagName: string
  id?: string
  classNames: readonly string[]
  text?: string
  outerHtml?: string
  attributes: Readonly<Record<string, string>>
  bounds: HtmlElementBounds
}>

export type HtmlSelection = Readonly<{
  elements: readonly HtmlElementSelection[]
}>

export type HtmlDocumentState = OfficeDocumentState

export type HtmlSelectionAction = OfficeSelectionAction<HtmlSelection>

export type HtmlAnnotationMarker = OfficeAnnotationMarker<HtmlSelection>
