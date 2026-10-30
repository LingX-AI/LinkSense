import { cleanup, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"
import { TaskOverviewFileIcon } from "./task-overview-file-icon"
import pdfShape from "@/assets/figma/task-overview/pdf-shape.svg"
import spreadsheetShape from "@/assets/figma/task-overview/spreadsheet-shape.svg"

afterEach(cleanup)

describe("task overview file icons", () => {
  it.each([
    ["briefing.pdf", null, "PDF"],
    ["analysis.xlsx", null, "XLS"],
    ["enrollment.csv", null, "CSV"],
    ["download", "application/pdf", "PDF"],
    ["download", "text/csv", "CSV"],
    ["download", "TEXT/CSV; charset=utf-8", "CSV"],
    ["export.data", "text/csv", "CSV"],
    ["enrollment.csv ", null, "CSV"],
    ["analysis.xlsx", "text/csv", "XLS"],
  ])(
    "uses the design's file glyph for %s with MIME %s",
    (filename, mimeType, label) => {
      const { container } = render(
        <TaskOverviewFileIcon filename={filename} mimeType={mimeType} />
      )
      expect(screen.getByText(label)).toHaveClass("font-bold", "text-white")
      expect(container.firstElementChild).toHaveClass("size-5")
      expect(container.firstElementChild).toHaveAttribute("aria-hidden", "true")
      expect(container.querySelector("img")).toHaveAttribute("alt", "")
      expect(container.querySelector("img")).toHaveAttribute(
        "src",
        label === "PDF" ? pdfShape : spreadsheetShape
      )
    }
  )

  it.each([
    ["notes.txt", null, "text"],
    ["analysis.ods", null, "excel"],
    ["analysis.numbers", null, "excel"],
    ["download", "application/vnd.oasis.opendocument.spreadsheet", "excel"],
  ])("retains the established icon for %s", (filename, mimeType, kind) => {
    const { container } = render(
      <TaskOverviewFileIcon filename={filename} mimeType={mimeType} />
    )
    expect(container.firstElementChild).toHaveAttribute(
      "data-file-icon-kind",
      kind
    )
    expect(container.firstElementChild).toHaveClass("file-type-icon", "size-5")
  })
})
