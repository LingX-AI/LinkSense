import { describe, expect, it } from "vitest"

import {
  conversationDetailSchema,
  type Conversation,
  type ConversationFile,
} from "@/api/contracts"
import {
  findFirstCompletedTurnPreviewFile,
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

function completedConversation(
  content: string,
  files: readonly ConversationFile[]
): Conversation {
  return conversationDetailSchema.parse({
    conversation: {
      id: "conversation",
      title: "Artifact delivery",
      project_id: null,
      archive_status: "active",
      updated_at: "2026-10-06T00:02:00.000Z",
    },
    turns: [{ id: "current-turn", status: "completed" }],
    messages: [
      {
        id: "request",
        role: "user",
        turn_id: "current-turn",
        content: "Task request",
      },
      {
        id: "final",
        role: "assistant",
        turn_id: "current-turn",
        phase: "final_answer",
        content,
      },
    ],
    files,
  })
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

  it("selects a file delivered by the final answer rather than an earlier draft", () => {
    const draft = file("draft", "draft.pdf", {
      turn_id: "current-turn",
      created_at: "2026-09-23T09:59:00.000Z",
    })
    const first = file("first", "first.pdf", {
      turn_id: "current-turn",
      created_at: "2026-09-23T10:00:00.000Z",
    })
    const later = file("later", "later.pdf", {
      turn_id: "current-turn",
      created_at: "2026-09-23T10:01:00.000Z",
    })
    const conversation = completedConversation(
      "[First report](artifacts/first.pdf)\n[Second report](artifacts/later.pdf)",
      [
        draft,
        later,
        first,
        file("old", "old.pdf", { turn_id: "old-turn" }),
        file("attachment", "input.pdf", {
          kind: "attachment",
          turn_id: "current-turn",
        }),
      ]
    )

    expect(
      findFirstCompletedTurnPreviewFile(conversation, "current-turn")?.id
    ).toBe(first.id)
  })

  it("skips unavailable or unsupported files and never opens a running turn", () => {
    const previewable = file("previewable", "report.pdf", {
      turn_id: "current-turn",
    })
    const conversation = {
      turns: [{ id: "current-turn", status: "running" }],
      artifacts: [
        file("unavailable", "draft.pdf", {
          turn_id: "current-turn",
          download_available: false,
        }),
        file("unsupported", "archive.bin", {
          turn_id: "current-turn",
          mime_type: "application/octet-stream",
        }),
        previewable,
      ],
      messages: [
        {
          id: "final",
          role: "assistant",
          turn_id: "current-turn",
          phase: "final_answer",
          content:
            "[Draft](draft.pdf) [Unsupported](archive.bin) [Report](report.pdf)",
        },
      ],
    } as unknown as Conversation

    expect(
      findFirstCompletedTurnPreviewFile(conversation, "current-turn")
    ).toBeNull()
    conversation.turns![0]!.status = "completed"
    expect(
      findFirstCompletedTurnPreviewFile(conversation, "current-turn")
    ).toBe(previewable)
  })

  it("does not open process files grafted onto a text-only final answer by the API projection", () => {
    const conversation = completedConversation("Investigation complete.", [
      file("screenshot", "screenshot.png", {
        turn_id: "current-turn",
        mime_type: "image/png",
      }),
      file("draft", "draft.pdf", { turn_id: "current-turn" }),
    ])

    expect(conversation.messages?.at(-1)?.artifacts).toHaveLength(2)
    expect(
      findFirstCompletedTurnPreviewFile(conversation, "current-turn")
    ).toBeNull()
    expect(getConversationFiles(conversation)).toHaveLength(2)
  })

  it("opens a final image even when the same image was viewed during the process", () => {
    const imageId = "30000000-0000-4000-8000-000000000001"
    const image = file(imageId, "result.png", {
      turn_id: "current-turn",
      mime_type: "image/png",
    })
    const conversation = completedConversation(
      `![Result](linksense-artifact:${imageId})`,
      [image]
    )

    expect(
      findFirstCompletedTurnPreviewFile(conversation, "current-turn")?.id
    ).toBe(image.id)
  })

  it.each([
    "```markdown\n[Report](artifacts/report.pdf)\n```",
    "`[Report](artifacts/report.pdf)`",
    "[unused]: artifacts/report.pdf",
    "[Reference](https://example.com/report.pdf)",
    "The process used report.pdf, but no file is being delivered.",
  ])(
    "does not interpret examples or incidental mentions as delivery: %s",
    (content) => {
      const conversation = completedConversation(content, [
        file("report", "report.pdf", { turn_id: "current-turn" }),
      ])

      expect(
        findFirstCompletedTurnPreviewFile(conversation, "current-turn")
      ).toBeNull()
    }
  )

  it("resolves used Markdown reference links and encoded filenames", () => {
    const conversation = completedConversation(
      "[Report][delivery]\n\n[delivery]: artifacts/%E6%8A%A5%E5%91%8A.pdf",
      [file("report", "报告.pdf", { turn_id: "current-turn" })]
    )

    expect(
      findFirstCompletedTurnPreviewFile(conversation, "current-turn")?.id
    ).toBe("report")
  })

  it("does not guess which file was delivered when filenames are ambiguous", () => {
    const conversation = completedConversation(
      "[Report](artifacts/report.pdf)",
      [
        file("draft", "report.pdf", { turn_id: "current-turn" }),
        file("final", "report.pdf", { turn_id: "current-turn" }),
      ]
    )

    expect(
      findFirstCompletedTurnPreviewFile(conversation, "current-turn")
    ).toBeNull()
  })

  it("does not mistake an input reference for a generated file with the same name", () => {
    const conversation = completedConversation(
      "[Input](attachments/report.pdf)",
      [
        file("input", "report.pdf", {
          kind: "attachment",
          turn_id: "current-turn",
        }),
        file("generated", "report.pdf", { turn_id: "current-turn" }),
      ]
    )

    expect(
      findFirstCompletedTurnPreviewFile(conversation, "current-turn")
    ).toBeNull()
  })

  it("resolves an exact artifact ID when multiple files have the same name", () => {
    const finalId = "30000000-0000-4000-8000-00000000000a"
    const conversation = completedConversation(
      `![Result](linksense-artifact:${finalId.toUpperCase()})`,
      [
        file("draft", "result.png", {
          turn_id: "current-turn",
          mime_type: "image/png",
        }),
        file(finalId, "result.png", {
          turn_id: "current-turn",
          mime_type: "image/png",
        }),
      ]
    )

    expect(
      findFirstCompletedTurnPreviewFile(conversation, "current-turn")?.id
    ).toBe(finalId)
  })

  it("never resolves a prior turn's artifact ID to a current file with the same name", () => {
    const oldId = "30000000-0000-4000-8000-000000000001"
    const conversation = completedConversation(
      `![Reference](linksense-artifact:${oldId})`,
      [
        file(oldId, "result.png", {
          turn_id: "old-turn",
          mime_type: "image/png",
        }),
        file("current", "result.png", {
          turn_id: "current-turn",
          mime_type: "image/png",
        }),
      ]
    )

    expect(
      findFirstCompletedTurnPreviewFile(conversation, "current-turn")
    ).toBeNull()
  })

  it("ignores commentary references when the final answer has no deliverable", () => {
    const conversation = completedConversation("Investigation complete.", [
      file("report", "report.pdf", { turn_id: "current-turn" }),
    ])
    conversation.messages?.unshift({
      id: "commentary",
      role: "assistant",
      turn_id: "current-turn",
      phase: "commentary",
      content: "[Process report](artifacts/report.pdf)",
    })

    expect(
      findFirstCompletedTurnPreviewFile(conversation, "current-turn")
    ).toBeNull()
  })

  it("uses only the latest final answer when earlier answers referenced a draft", () => {
    const conversation = completedConversation("Investigation complete.", [
      file("draft", "draft.pdf", { turn_id: "current-turn" }),
    ])
    conversation.messages?.unshift({
      id: "earlier-final",
      role: "assistant",
      turn_id: "current-turn",
      phase: "final_answer",
      content: "[Draft](artifacts/draft.pdf)",
    })

    expect(
      findFirstCompletedTurnPreviewFile(conversation, "current-turn")
    ).toBeNull()
  })

  it("does not auto-preview without a final answer or from a proposed plan", () => {
    const conversation = completedConversation("[Report](report.pdf)", [
      file("report", "report.pdf", { turn_id: "current-turn" }),
    ])
    conversation.messages!.at(-1)!.phase = "commentary"
    expect(
      findFirstCompletedTurnPreviewFile(conversation, "current-turn")
    ).toBeNull()
    conversation.messages!.at(-1)!.phase = "final_answer"
    conversation.messages!.at(-1)!.output_kind = "plan"
    expect(
      findFirstCompletedTurnPreviewFile(conversation, "current-turn")
    ).toBeNull()
  })

  it("supports a delivered file in a completed provider reply with a null native phase", () => {
    const conversation = completedConversation("[Report](report.pdf)", [
      file("report", "report.pdf", { turn_id: "current-turn" }),
    ])
    conversation.messages!.at(-1)!.phase = null

    expect(
      findFirstCompletedTurnPreviewFile(conversation, "current-turn")?.id
    ).toBe("report")
  })

  it("opens the first usable final reference in reply order rather than registration order", () => {
    const conversation = completedConversation(
      "[Main report](final.pdf) [Appendix](appendix.pdf)",
      [
        file("appendix", "appendix.pdf", {
          turn_id: "current-turn",
          created_at: "2026-10-06T00:00:00.000Z",
        }),
        file("final", "final.pdf", {
          turn_id: "current-turn",
          created_at: "2026-10-06T00:01:00.000Z",
        }),
      ]
    )

    expect(
      findFirstCompletedTurnPreviewFile(conversation, "current-turn")?.id
    ).toBe("final")
  })

  it("resolves a registered image nested inside an external Markdown link", () => {
    const imageId = "30000000-0000-4000-8000-000000000001"
    const conversation = completedConversation(
      `[![Result](linksense-artifact:${imageId})](https://example.com)`,
      [
        file(imageId, "result.png", {
          turn_id: "current-turn",
          mime_type: "image/png",
        }),
      ]
    )

    expect(
      findFirstCompletedTurnPreviewFile(conversation, "current-turn")?.id
    ).toBe(imageId)
  })

  it.each([
    "[Input](input.pdf)",
    "[Previous output](old.pdf)",
    "[Missing file](missing.pdf)",
    "[Remote file](file://example.com/report.pdf)",
    "[Invalid path](artifacts/%XXreport.pdf)",
    "[Invalid ID](linksense-artifact:unavailable)",
    "[Invalid protocol](javascript:report.pdf)",
  ])(
    "ignores references outside the current turn's registered artifacts: %s",
    (content) => {
      const conversation = completedConversation(content, [
        file("attachment", "input.pdf", {
          kind: "attachment",
          turn_id: "current-turn",
        }),
        file("old", "old.pdf", { turn_id: "old-turn" }),
        file("report", "report.pdf", { turn_id: "current-turn" }),
      ])

      expect(
        findFirstCompletedTurnPreviewFile(conversation, "current-turn")
      ).toBeNull()
    }
  )

  it("does not promote a still-streaming reply or an embedded proposed plan", () => {
    const conversation = completedConversation("[Report](report.pdf)", [
      file("report", "report.pdf", { turn_id: "current-turn" }),
    ])
    conversation.messages!.at(-1)!.streaming = true
    expect(
      findFirstCompletedTurnPreviewFile(conversation, "current-turn")
    ).toBeNull()
    conversation.messages!.at(-1)!.streaming = false
    conversation.messages!.at(-1)!.content =
      "<proposed_plan>\n[Report](report.pdf)\n</proposed_plan>"
    expect(
      findFirstCompletedTurnPreviewFile(conversation, "current-turn")
    ).toBeNull()
  })
})
