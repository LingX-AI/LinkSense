import { describe, expect, it } from "vitest"

import type { Conversation, ConversationFile } from "@/api/contracts"
import {
  findUpdatedOfficePreviewFile,
  getConversationFiles,
} from "@/features/conversations/conversation-office-preview-update"

function file(
  id: string,
  name: string,
  options: Partial<ConversationFile> = {}
): ConversationFile {
  return {
    id,
    name,
    mime_type: "text/html",
    kind: "artifact",
    size: 0,
    download_available: true,
    ...options,
  }
}

describe("conversation office preview updates", () => {
  it("finds the newest compatible artifact created after an annotated preview", () => {
    const source = file("source", "deck.html")
    const first = file("first", "deck (draft).html")
    const latest = file("latest", "deck (revised).html")

    expect(
      findUpdatedOfficePreviewFile({
        sourceFile: source,
        knownFileIds: [source.id],
        files: [source, first, latest],
      })
    ).toBe(latest)
  })

  it("does not surface existing, unrelated, or incompatible files", () => {
    const source = file("source", "deck.html")
    expect(
      findUpdatedOfficePreviewFile({
        sourceFile: source,
        knownFileIds: [source.id, "existing"],
        files: [
          source,
          file("existing", "deck (old).html"),
          file("word", "brief.docx", {
            mime_type:
              "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
          }),
          file("attachment", "page.html", { kind: "attachment" }),
        ],
      })
    ).toBeNull()
  })

  it("finds a replacement for a read-only code preview", () => {
    const source = file("source", "dashboard.ts", {
      mime_type: "text/plain",
    })
    const latest = file("latest", "dashboard (revised).ts", {
      mime_type: "text/plain",
    })

    expect(
      findUpdatedOfficePreviewFile({
        sourceFile: source,
        knownFileIds: [source.id],
        files: [source, latest],
      })
    ).toBe(latest)
  })

  it("collects message artifacts and removes duplicate ids", () => {
    const artifact = file("artifact", "deck.html")
    const conversation = {
      attachments: [file("attachment", "source.html", { kind: "attachment" })],
      artifacts: [artifact],
      messages: [{ attachments: [], artifacts: [artifact] }],
    } as unknown as Conversation

    expect(getConversationFiles(conversation).map((item) => item.id)).toEqual([
      "attachment",
      "artifact",
    ])
  })
})
