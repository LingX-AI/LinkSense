// @vitest-environment node
import { describe, expect, it } from "vitest"

import {
  conversationFileSchema,
  type ConversationFile,
  type ConversationMessage,
} from "@/api/contracts"
import { selectConversationArtifactCards } from "@/features/conversations/conversation-artifact-selection"

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
  inlineArtifactIds = new Set<string>()
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
    const cards = select([copy, fresh, previous], "[copy](copy.png)")
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
