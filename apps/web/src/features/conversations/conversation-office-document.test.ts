import { describe, expect, it } from "vitest"

import { getConversationOfficeDocumentKind } from "@/features/conversations/conversation-office-document"

describe("conversation office document detection", () => {
  it.each([
    ["slides.pptx", null, "presentation"],
    [
      "slides.bin",
      "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      "presentation",
    ],
    ["brief.DOCX", null, "word"],
    [
      "brief.bin",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "word",
    ],
    ["budget.xlsx", null, "spreadsheet"],
    [
      "budget.bin",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "spreadsheet",
    ],
    ["landing.html", null, "html"],
    ["legacy.HTM", null, "html"],
    ["landing.bin", "text/html", "html"],
    ["bundle.zip", null, "archive"],
    ["bundle.bin", "application/zip", "archive"],
    ["bundle.7z", "application/x-7z-compressed", "archive"],
    ["bundle.rar", "application/x-rar-compressed", "archive"],
    ["logs.tar.gz", "application/gzip", "archive"],
  ] as const)("detects %s as %s", (name, mimeType, expected) => {
    expect(
      getConversationOfficeDocumentKind({ name, mime_type: mimeType })
    ).toBe(expected)
  })

  it("does not route legacy or unrelated formats into the Office viewers", () => {
    expect(
      getConversationOfficeDocumentKind({
        name: "legacy.xls",
        mime_type: "application/vnd.ms-excel",
      })
    ).toBeNull()
    expect(
      getConversationOfficeDocumentKind({
        name: "report.pdf",
        mime_type: "application/pdf",
      })
    ).toBeNull()
    expect(
      getConversationOfficeDocumentKind({
        name: "bundle.bin",
        mime_type: "application/octet-stream",
      })
    ).toBeNull()
  })
})
