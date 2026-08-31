import { officeAnnotationInputSchema } from "@linksense/shared"
import { describe, expect, it } from "vitest"

import type { ConversationFile } from "@/api/contracts"
import { buildOfficeAnnotationInput } from "@/features/conversations/conversation-office-annotation"

const file: ConversationFile = {
  id: "70000000-0000-4000-8000-000000000001",
  name: "office-file",
  mime_type: null,
  size: 0,
  download_available: true,
}

describe("Office selection annotation input", () => {
  it("maps a Word selection to the bounded shared contract", () => {
    const result = buildOfficeAnnotationInput(file, [
      {
        officeSelection: {
          kind: "word",
          selection: {
            type: "text",
            paraId: "paragraph-7",
            selectedText: "季度目标",
            paragraphText: "将季度目标调整为年度目标",
            before: "将",
            after: "调整为年度目标",
            startParagraphIndex: 6,
            endParagraphIndex: 6,
            isMultiParagraph: false,
            pageNumber: 2,
            positionFrom: 42,
            positionTo: 50,
          },
        },
        request: "改成年度目标",
      },
    ])

    expect(result).toEqual({
      kind: "word_annotation",
      file_id: file.id,
      annotations: [
        {
          request: "改成年度目标",
          selection: {
            type: "text",
            para_id: "paragraph-7",
            selected_text: "季度目标",
            paragraph_text: "将季度目标调整为年度目标",
            before: "将",
            after: "调整为年度目标",
            start_paragraph_index: 6,
            end_paragraph_index: 6,
            is_multi_paragraph: false,
            page_number: 2,
            position_from: 42,
            position_to: 50,
          },
        },
      ],
    })
    expect(officeAnnotationInputSchema.safeParse(result).success).toBe(true)
  })

  it("maps an HTML element selection without preview-only DOM state", () => {
    const result = buildOfficeAnnotationInput(
      { ...file, name: "landing.html", mime_type: "text/html" },
      [
        {
          officeSelection: {
            kind: "html",
            selection: {
              elements: [
                {
                  selector: "#hero",
                  domPath: [0, 1],
                  tagName: "h1",
                  id: "hero",
                  classNames: ["title"],
                  text: "欢迎使用 LinkSense",
                  outerHtml:
                    '<h1 id="hero" class="title">欢迎使用 LinkSense</h1>',
                  attributes: { "data-testid": "hero-title" },
                  bounds: { x: 16, y: 24, width: 320, height: 56 },
                },
              ],
            },
          },
          request: "改为英文",
        },
      ]
    )

    expect(result).toEqual({
      kind: "html_annotation",
      file_id: file.id,
      annotations: [
        {
          request: "改为英文",
          elements: [
            {
              selector: "#hero",
              dom_path: [0, 1],
              tag_name: "h1",
              id: "hero",
              class_names: ["title"],
              text: "欢迎使用 LinkSense",
              outer_html: '<h1 id="hero" class="title">欢迎使用 LinkSense</h1>',
              attributes: { "data-testid": "hero-title" },
              bounds: { x: 16, y: 24, width: 320, height: 56 },
            },
          ],
        },
      ],
    })
    expect(officeAnnotationInputSchema.safeParse(result).success).toBe(true)
  })

  it("maps an Excel range with its sheet locator, text, and formula", () => {
    const result = buildOfficeAnnotationInput(file, [
      {
        officeSelection: {
          kind: "spreadsheet",
          selection: {
            type: "range",
            sheetName: "预算",
            sheetIndex: 1,
            rangeAddress: "B2:D4",
            activeCellAddress: "B2",
            startRow: 1,
            startColumn: 1,
            endRow: 3,
            endColumn: 3,
            selectedText: "100\t200",
            selectedFormula: "=SUM(B2:D2)",
          },
        },
        request: "把金额增加 10%",
      },
    ])

    expect(result).toMatchObject({
      kind: "spreadsheet_annotation",
      annotations: [
        {
          request: "把金额增加 10%",
          sheet_name: "预算",
          sheet_index: 1,
          selection: {
            type: "range",
            range_address: "B2:D4",
            active_cell_address: "B2",
            selected_text: "100\t200",
            selected_formula: "=SUM(B2:D2)",
          },
        },
      ],
    })
    expect(officeAnnotationInputSchema.safeParse(result).success).toBe(true)
  })

  it("normalizes an Excel chart point locator without leaking chart internals", () => {
    const result = buildOfficeAnnotationInput(file, [
      {
        officeSelection: {
          kind: "spreadsheet",
          selection: {
            type: "chart",
            sheetName: "Dashboard",
            sheetIndex: 0,
            objectId: "chart-1",
            name: "Revenue",
            title: "Revenue by month",
            chartType: "line",
            element: {
              kind: "point",
              chartId: "chart-1",
              seriesId: "series-2",
              seriesIndex: 1,
              pointIndex: 3,
            },
            formula: "Sheet1!$B$2:$B$13",
          },
        },
        request: "突出这个数据点",
      },
    ])

    expect(result).toMatchObject({
      annotations: [
        {
          selection: {
            type: "chart",
            object_id: "chart-1",
            chart_type: "line",
            element: {
              kind: "point",
              series_id: "series-2",
              series_index: 1,
              point_index: 3,
            },
          },
        },
      ],
    })
    expect(result).not.toHaveProperty("annotations.0.selection.element.chartId")
    expect(officeAnnotationInputSchema.safeParse(result).success).toBe(true)
  })

  it("bounds Excel object metadata before submitting the shared contract", () => {
    const result = buildOfficeAnnotationInput(file, [
      {
        officeSelection: {
          kind: "spreadsheet",
          selection: {
            type: "chart",
            sheetName: `  ${"S".repeat(300)}  `,
            sheetIndex: 0,
            objectId: `chart\n${"I".repeat(600)}`,
            name: `  ${"N".repeat(300)}  `,
            title: "T".repeat(600),
            chartType: `  ${"C".repeat(160)}  `,
            element: {
              kind: "series",
              chartId: "chart-1",
              seriesId: `series\n${"R".repeat(600)}`,
              seriesIndex: 1,
            },
            formula: "F".repeat(5_000),
          },
        },
        request: "调整图表",
      },
    ])

    expect(officeAnnotationInputSchema.safeParse(result).success).toBe(true)
    if (
      result.kind !== "spreadsheet_annotation" ||
      result.annotations[0]?.selection.type !== "chart"
    ) {
      throw new Error("spreadsheet chart expected")
    }
    const annotation = result.annotations[0]
    if (!annotation || annotation.selection.type !== "chart") {
      throw new Error("spreadsheet chart expected")
    }
    expect(annotation.sheet_name).toHaveLength(240)
    expect(annotation.selection).toMatchObject({
      type: "chart",
      chart_type: "C".repeat(120),
      title: "T".repeat(500),
      formula: "F".repeat(4_000),
    })
    expect(annotation.selection.object_id).not.toContain("\n")
    expect(annotation.selection.object_id).toHaveLength(500)
    expect(annotation.selection.name).toHaveLength(240)
    expect(annotation.selection.element).toMatchObject({
      kind: "series",
      series_index: 1,
    })
    if (annotation.selection.element?.kind !== "series") {
      throw new Error("series expected")
    }
    expect(annotation.selection.element.series_id).not.toContain("\n")
    expect(annotation.selection.element.series_id).toHaveLength(500)
  })
})
