import type {
  XlsxChartElementSelection,
  XlsxImageAnchor,
} from "@extend-ai/react-xlsx"

import type {
  OfficeAnnotationMarker,
  OfficeDocumentState,
  OfficeSelectionAction,
} from "@/components/media/office-preview/office-preview.types"

export const XLSX_MIME_TYPE =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"

type SpreadsheetSelectionLocation = Readonly<{
  sheetName: string
  sheetIndex: number
}>

export type SpreadsheetRangeSelection = SpreadsheetSelectionLocation &
  Readonly<{
    type: "range"
    rangeAddress: string
    activeCellAddress?: string
    startRow: number
    startColumn: number
    endRow: number
    endColumn: number
    selectedText?: string
    selectedFormula?: string
  }>

export type SpreadsheetImageSelection = SpreadsheetSelectionLocation &
  Readonly<{
    type: "image"
    objectId: string
    name?: string
    description?: string
    anchor?: XlsxImageAnchor
  }>

export type SpreadsheetChartSelection = SpreadsheetSelectionLocation &
  Readonly<{
    type: "chart"
    objectId: string
    name?: string
    title?: string
    chartType: string
    anchor?: XlsxImageAnchor
    element?: XlsxChartElementSelection
    formula?: string
  }>

export type SpreadsheetSelection =
  | SpreadsheetRangeSelection
  | SpreadsheetImageSelection
  | SpreadsheetChartSelection

export type SpreadsheetDocumentState = OfficeDocumentState

export type SpreadsheetSelectionAction =
  OfficeSelectionAction<SpreadsheetSelection>

export type SpreadsheetAnnotationMarker =
  OfficeAnnotationMarker<SpreadsheetSelection>

export function isXlsxDocument(input: {
  fileName: string
  mimeType?: string | null
}) {
  return (
    input.mimeType?.toLowerCase() === XLSX_MIME_TYPE ||
    input.fileName.toLowerCase().endsWith(".xlsx")
  )
}
