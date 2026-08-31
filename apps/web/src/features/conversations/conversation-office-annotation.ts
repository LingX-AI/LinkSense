import type { OfficeAnnotationInput } from "@linksense/shared"

import type { ConversationFile } from "@/api/contracts"
import type { ConversationOfficeSelection } from "@/features/conversations/conversation-office-preview"

const locatorLimit = 500
const nameLimit = 240

function boundedLocator(value: string) {
  return value
    .replace(/[\r\n]+/gu, " ")
    .trim()
    .slice(0, locatorLimit)
}

function boundedRequiredText(value: string, maximumLength: number) {
  return value.trim().slice(0, maximumLength)
}

function boundedOptionalTrimmedText(
  value: string | undefined,
  maximumLength: number
) {
  const bounded = value?.trim().slice(0, maximumLength)
  return bounded || undefined
}

function boundedOptionalText(value: string | undefined, maximumLength: number) {
  return value === undefined ? undefined : value.slice(0, maximumLength)
}

export function buildOfficeAnnotationInput(
  file: ConversationFile,
  requests: ReadonlyArray<
    Readonly<{
      officeSelection: ConversationOfficeSelection
      request: string
    }>
  >
): OfficeAnnotationInput {
  const firstRequest = requests[0]
  if (!firstRequest) throw new Error("office_annotation_required")

  if (firstRequest.officeSelection.kind === "presentation") {
    return {
      kind: "presentation_annotation" as const,
      file_id: file.id,
      annotations: requests.map(({ officeSelection, request }) => {
        if (officeSelection.kind !== "presentation") {
          throw new Error("office_annotation_kind_mismatch")
        }
        const selection = officeSelection.selection
        return {
          request,
          slide_number: selection.slideNumber,
          elements: selection.elements.map((element) => ({
            element_id: element.elementId,
            ...(element.shapeId ? { shape_id: element.shapeId } : {}),
            type: element.type,
            ...(element.name ? { name: element.name } : {}),
            ...(element.text !== undefined ? { text: element.text } : {}),
            bounds: element.bounds,
          })),
        }
      }),
    }
  }

  if (firstRequest.officeSelection.kind === "word") {
    return {
      kind: "word_annotation" as const,
      file_id: file.id,
      annotations: requests.map(({ officeSelection, request }) => {
        if (officeSelection.kind !== "word") {
          throw new Error("office_annotation_kind_mismatch")
        }
        const selection = officeSelection.selection
        return {
          request,
          selection: {
            type: "text" as const,
            ...(selection.paraId
              ? { para_id: boundedLocator(selection.paraId) }
              : {}),
            selected_text: selection.selectedText,
            paragraph_text: selection.paragraphText,
            before: selection.before,
            after: selection.after,
            start_paragraph_index: selection.startParagraphIndex,
            end_paragraph_index: selection.endParagraphIndex,
            is_multi_paragraph: selection.isMultiParagraph,
            ...(selection.pageNumber !== undefined
              ? { page_number: selection.pageNumber }
              : {}),
            ...(selection.positionFrom !== undefined
              ? { position_from: selection.positionFrom }
              : {}),
            ...(selection.positionTo !== undefined
              ? { position_to: selection.positionTo }
              : {}),
          },
        }
      }),
    }
  }

  if (firstRequest.officeSelection.kind === "html") {
    return {
      kind: "html_annotation" as const,
      file_id: file.id,
      annotations: requests.map(({ officeSelection, request }) => {
        if (officeSelection.kind !== "html") {
          throw new Error("office_annotation_kind_mismatch")
        }
        return {
          request,
          elements: officeSelection.selection.elements
            .slice(0, 20)
            .map((element) => ({
              selector: element.selector
                .replace(/[\r\n]+/gu, " ")
                .trim()
                .slice(0, 1_000),
              dom_path: element.domPath.slice(0, 128),
              tag_name: element.tagName.trim().slice(0, 80),
              ...(element.id?.trim()
                ? { id: element.id.trim().slice(0, 500) }
                : {}),
              class_names: [...new Set(element.classNames)]
                .map((className) => className.trim().slice(0, 120))
                .filter(Boolean)
                .slice(0, 50),
              ...(element.text !== undefined
                ? { text: element.text.slice(0, 4_000) }
                : {}),
              ...(element.outerHtml !== undefined
                ? { outer_html: element.outerHtml.slice(0, 8_000) }
                : {}),
              attributes: Object.fromEntries(
                Object.entries(element.attributes)
                  .filter(([name]) =>
                    /^[a-zA-Z_:][a-zA-Z0-9:._-]*$/u.test(name)
                  )
                  .slice(0, 50)
                  .map(([name, value]) => [
                    name.slice(0, 120),
                    value.slice(0, 2_000),
                  ])
              ),
              bounds: element.bounds,
            })),
        }
      }),
    }
  }

  return {
    kind: "spreadsheet_annotation" as const,
    file_id: file.id,
    annotations: requests.map(({ officeSelection, request }) => {
      if (officeSelection.kind !== "spreadsheet") {
        throw new Error("office_annotation_kind_mismatch")
      }
      const selection = officeSelection.selection
      const spreadsheetInput = {
        request,
        sheet_name: boundedRequiredText(selection.sheetName, nameLimit),
        sheet_index: selection.sheetIndex,
      }
      if (selection.type === "range") {
        return {
          ...spreadsheetInput,
          selection: {
            type: "range" as const,
            range_address: boundedLocator(selection.rangeAddress),
            ...(selection.activeCellAddress
              ? {
                  active_cell_address: boundedLocator(
                    selection.activeCellAddress
                  ),
                }
              : {}),
            start_row: selection.startRow,
            start_column: selection.startColumn,
            end_row: selection.endRow,
            end_column: selection.endColumn,
            ...(selection.selectedText !== undefined
              ? { selected_text: selection.selectedText }
              : {}),
            ...(selection.selectedFormula !== undefined
              ? { selected_formula: selection.selectedFormula }
              : {}),
          },
        }
      }
      if (selection.type === "image") {
        const name = boundedOptionalTrimmedText(selection.name, nameLimit)
        const description = boundedOptionalText(selection.description, 1_000)
        return {
          ...spreadsheetInput,
          selection: {
            type: "image" as const,
            object_id: boundedLocator(selection.objectId),
            ...(name ? { name } : {}),
            ...(description !== undefined ? { description } : {}),
          },
        }
      }
      const element = selection.element
        ? selection.element.kind === "chart"
          ? { kind: "chart" as const }
          : selection.element.kind === "series"
            ? {
                kind: "series" as const,
                series_id: boundedLocator(selection.element.seriesId),
                series_index: selection.element.seriesIndex,
              }
            : selection.element.kind === "point"
              ? {
                  kind: "point" as const,
                  series_id: boundedLocator(selection.element.seriesId),
                  series_index: selection.element.seriesIndex,
                  point_index: selection.element.pointIndex,
                }
              : {
                  kind: "legend_entry" as const,
                  series_id: boundedLocator(selection.element.seriesId),
                  series_index: selection.element.seriesIndex,
                }
        : undefined
      const name = boundedOptionalTrimmedText(selection.name, nameLimit)
      const title = boundedOptionalText(selection.title, 500)
      return {
        ...spreadsheetInput,
        selection: {
          type: "chart" as const,
          object_id: boundedLocator(selection.objectId),
          ...(name ? { name } : {}),
          ...(title !== undefined ? { title } : {}),
          chart_type: boundedRequiredText(selection.chartType, 120),
          ...(element ? { element } : {}),
          ...(selection.formula
            ? { formula: selection.formula.slice(0, 4_000) }
            : {}),
        },
      }
    }),
  }
}
