// @vitest-environment node
import { describe, expect, it } from "vitest"

import {
  conversationFileSchema,
  type ConversationFile,
  type ConversationMessage,
  type NativeCodexItem,
} from "@/api/contracts"
import {
  selectConversationArtifactCards,
  selectConversationGeneratedImageIds,
} from "@/features/conversations/conversation-artifact-selection"

function image(
  id: string,
  turnId = "current",
  checksum: string | null = "a".repeat(64)
): ConversationFile {
  return {
    id,
    name: `${id}.png`,
    kind: "artifact",
    turn_id: turnId,
    mime_type: "image/png",
    checksum_sha256: checksum,
    size: 1024,
    download_available: true,
  }
}

function select(
  files: ConversationFile[],
  content = "",
  inlineArtifactIds = new Set<string>(),
  activityImageArtifactIds = new Set<string>()
) {
  const final: ConversationMessage = {
    id: "final",
    role: "assistant",
    turn_id: "current",
    content,
    phase: "final_answer",
  }
  return selectConversationArtifactCards({
    files,
    turns: [
      { id: "previous", status: "completed" },
      { id: "current", status: "completed" },
    ],
    finalMessagesByTurn: new Map([["current", final]]),
    inlineArtifactIds,
    activityImageArtifactIds,
  })
}

describe("conversation artifact card selection", () => {
  it("deduplicates renamed images by content and prefers the final reply's download filename", () => {
    const generated = image("generated")
    const renamed = image("renamed")
    expect([
      ...select([generated, renamed], "[下载](renamed.png)")
        .get("current")!
        .values(),
    ]).toEqual([renamed])
  })

  it("uses exact artifact IDs and reference links to select the delivered alias", () => {
    const generated = image("generated")
    const renamed = image("11111111-1111-4111-8111-111111111111")
    expect([
      ...select(
        [generated, renamed],
        `[下载][result]\n\n[result]: linksense-artifact:${renamed.id}`
      )
        .get("current")!
        .values(),
    ]).toEqual([renamed])
  })

  it("keeps the first registration when duplicate images have no final download reference", () => {
    const first = image("first")
    expect([
      ...select([first, image("copy")])
        .get("current")!
        .values(),
    ]).toEqual([first])
  })

  it("ignores external links and code when choosing a duplicate alias", () => {
    const first = image("first")
    expect([
      ...select(
        [first, image("copy")],
        "[external](https://example.com/copy.png) `[code](copy.png)`"
      )
        .get("current")!
        .values(),
    ]).toEqual([first])
  })

  it("keeps previous images in their original turn and excludes renamed copies from later turns regardless of file order", () => {
    const previous = image("previous-image", "previous")
    const copy = image("copy")
    const fresh = image("fresh", "current", "b".repeat(64))
    const cards = select(
      [copy, fresh, previous],
      "[fresh](fresh.png) [copy](copy.png)"
    )
    expect([...cards.get("previous")!.values()]).toEqual([previous])
    expect([...cards.get("current")!.values()]).toEqual([fresh])
  })

  it("does not remove older cards because a later turn contains the same image", () => {
    const previous = image("old", "previous")
    const cards = select([image("new"), previous])
    expect([...cards.get("previous")!.values()]).toEqual([previous])
    expect([...cards.get("current")!.values()]).toEqual([])
  })

  it("does not repeat an inline image under a separately registered file ID", () => {
    const inline = image("inline")
    expect([
      ...select([image("copy"), inline], "", new Set([inline.id]))
        .get("current")!
        .values(),
    ]).toEqual([])
  })

  it("keeps a code-generated deliverable when an activity preview has the same image content", () => {
    const preview = image("process-preview")
    const deliverable = image("grassland-puppy")
    const cards = select(
      [preview, deliverable],
      "草地小狗图片已经生成。",
      new Set(),
      new Set([preview.id])
    )
    expect([...cards.get("current")!.values()]).toEqual([deliverable])
  })

  it("does not let a previous turn's process preview hide a later deliverable", () => {
    const preview = image("process-preview", "previous")
    const deliverable = image("delivered-image")
    const cards = select(
      [preview, deliverable],
      "[下载](delivered-image.png)",
      new Set(),
      new Set([preview.id])
    )
    expect([...cards.get("previous")!.values()]).toEqual([])
    expect([...cards.get("current")!.values()]).toEqual([deliverable])
  })

  it("does not let a process image embedded in commentary hide a later deliverable", () => {
    const preview = image("process-preview", "previous")
    const deliverable = image("delivered-image")
    const cards = select(
      [preview, deliverable],
      "[下载](delivered-image.png)",
      new Set([preview.id]),
      new Set([preview.id])
    )
    expect([...cards.get("previous")!.values()]).toEqual([])
    expect([...cards.get("current")!.values()]).toEqual([deliverable])
  })

  it("excludes unreferenced process images without suppressing their later delivery in another turn", () => {
    const draft = image("draft", "previous")
    const final = image("final", "previous", "b".repeat(64))
    const deliveredLater = image("delivered-later")
    const cards = selectConversationArtifactCards({
      files: [draft, final, deliveredLater],
      turns: [
        { id: "previous", status: "completed" },
        { id: "current", status: "completed" },
      ],
      finalMessagesByTurn: new Map([
        [
          "previous",
          {
            id: "previous-final",
            role: "assistant",
            turn_id: "previous",
            content: "[下载](final.png)",
          },
        ],
        [
          "current",
          {
            id: "current-final",
            role: "assistant",
            turn_id: "current",
            content: "[下载](delivered-later.png)",
          },
        ],
      ]),
      inlineArtifactIds: new Set(),
      activityImageArtifactIds: new Set(),
    })
    expect([...cards.get("previous")!.values()]).toEqual([final])
    expect([...cards.get("current")!.values()]).toEqual([deliveredLater])
  })

  it("keeps a viewed image explicitly delivered in the final reply but hides unrelated process images", () => {
    const preview = image("process-preview")
    const deliverable = image("delivered-image", "current", "b".repeat(64))
    const cards = select(
      [preview, deliverable],
      "[下载](delivered-image.png)",
      new Set(),
      new Set([preview.id, deliverable.id])
    )
    expect([...cards.get("current")!.values()]).toEqual([deliverable])
  })

  it("compares checksums without case sensitivity and keeps different contents with the same filename", () => {
    const first = image("first")
    const different = {
      ...image("different", "current", "b".repeat(64)),
      name: first.name,
    }
    expect([
      ...select([first, image("copy", "current", "A".repeat(64)), different])
        .get("current")!
        .values(),
    ]).toEqual([first, different])
  })

  it.each([null, undefined, "", "invalid"])(
    "preserves distinct historical files with checksum %s",
    (checksum) => {
      const first = { ...image("first"), checksum_sha256: checksum }
      const second = { ...image("second"), checksum_sha256: checksum }
      expect([...select([first, second]).get("current")!.values()]).toEqual([
        first,
        second,
      ])
      expect(conversationFileSchema.parse(first).checksum_sha256).toBe(checksum)
    }
  )

  it("keeps non-image deliverables even when they share the same checksum", () => {
    const files = [image("one"), image("two")].map((file) => ({
      ...file,
      name: `${file.id}.pdf`,
      mime_type: "application/pdf",
    }))
    expect([...select(files).get("current")!.values()]).toEqual(files)
  })

  it("does not treat attachments and files without a turn as delivered images", () => {
    const fresh = image("fresh")
    const cards = select([
      { ...image("input", "previous"), kind: "attachment" },
      { ...image("unassigned"), turn_id: null },
      fresh,
    ])
    expect([...cards.get("current")!.values()]).toEqual([fresh])
  })

  it("recomputes the same cards after a refresh with repeated file projections", () => {
    const previous = image("previous", "previous")
    const generated = image("generated", "current", "b".repeat(64))
    const renamed = { ...generated, id: "renamed", name: "renamed.png" }
    const files = [previous, generated, renamed, image("old-copy")]
    expect(select([...files, ...files], "[下载](renamed.png)")).toEqual(
      select(files, "[下载](renamed.png)")
    )
  })
})

describe("generated image delivery selection", () => {
  const generation = (
    id: string,
    fileIds: string[]
  ): Extract<NativeCodexItem, { type: "mcpToolCall" }> => ({
    id,
    type: "mcpToolCall",
    server: "linksense_core",
    tool: "generate_image",
    status: "completed",
    generatedImageFileIds: fileIds,
  })
  const finalMessage = (content: string): ConversationMessage => ({
    id: "final",
    role: "assistant",
    turn_id: "current",
    phase: "final_answer",
    content,
  })
  const draft = image("11111111-1111-4111-8111-111111111111")
  const delivered = image(
    "22222222-2222-4222-8222-222222222222",
    "current",
    "b".repeat(64)
  )
  const filesById = new Map([draft, delivered].map((file) => [file.id, file]))
  const items = [
    generation("draft", [draft.id]),
    generation("delivered", [delivered.id]),
  ]

  it("shows only images explicitly delivered by the final reply, in reply order", () => {
    expect(
      selectConversationGeneratedImageIds({
        items,
        turnId: "current",
        filesById,
        finalMessage: finalMessage(
          `[下载](linksense-artifact:${delivered.id})`
        ),
      })
    ).toEqual([delivered.id])
    expect(
      selectConversationGeneratedImageIds({
        items,
        turnId: "current",
        filesById,
        finalMessage: finalMessage(
          `![结果二](linksense-artifact:${delivered.id})\n\n![结果一](linksense-artifact:${draft.id})`
        ),
      })
    ).toEqual([delivered.id, draft.id])
  })

  it("keeps all successful generations when the final reply has no file references", () => {
    expect(
      selectConversationGeneratedImageIds({
        items: [
          ...items,
          { ...generation("failed", []), generatedImageFileIds: undefined },
        ],
        turnId: "current",
        filesById,
        finalMessage: finalMessage("两张不同场景的图片已完成。"),
      })
    ).toEqual([draft.id, delivered.id])
  })

  it("keeps separately registered code outputs and deduplicates generated copies by checksum", () => {
    const renamed = { ...delivered, id: "renamed", name: "final.png" }
    expect(
      selectConversationGeneratedImageIds({
        items,
        registeredFileIds: [renamed.id],
        turnId: "current",
        filesById: new Map([...filesById, [renamed.id, renamed]]),
        finalMessage: finalMessage("图片已完成。"),
      })
    ).toEqual([renamed.id, draft.id])
  })

  it("keeps the final renamed output when automatic cards have already hidden its duplicate", () => {
    const renamed = { ...delivered, id: "renamed", name: "final.png" }
    expect(
      selectConversationGeneratedImageIds({
        items,
        registeredFileIds: [],
        turnId: "current",
        filesById: new Map([...filesById, [renamed.id, renamed]]),
        finalMessage: finalMessage("[下载](final.png)"),
      })
    ).toEqual([renamed.id])
  })

  it("does not promote an intermediate image when the final reply delivers a document", () => {
    const report = {
      ...image("report"),
      name: "report.pdf",
      mime_type: "application/pdf",
    }
    expect(
      selectConversationGeneratedImageIds({
        items,
        turnId: "current",
        filesById: new Map([...filesById, [report.id, report]]),
        finalMessage: finalMessage("[报告](report.pdf)"),
      })
    ).toEqual([])
  })

  it("preserves missing image IDs for loading or unavailable feedback", () => {
    expect(
      selectConversationGeneratedImageIds({
        items,
        turnId: "current",
        filesById: new Map(),
        finalMessage: finalMessage("图片已完成。"),
      })
    ).toEqual([draft.id, delivered.id])
  })

  it("does not select another turn's files or user attachments", () => {
    expect(
      selectConversationGeneratedImageIds({
        items,
        turnId: "current",
        filesById: new Map([
          [draft.id, { ...draft, kind: "attachment" }],
          [delivered.id, { ...delivered, turn_id: "previous" }],
        ]),
        finalMessage: finalMessage("图片已完成。"),
      })
    ).toEqual([])
  })
})
