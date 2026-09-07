// @vitest-environment node

import { describe, expect, it } from "vitest"

import {
  getConversationComposerInputSegments,
  type ConversationComposerInputSegment,
} from "@/features/conversations/conversation-composer-url-highlighting"

function getUrls(segments: readonly ConversationComposerInputSegment[]) {
  return segments
    .filter(
      (
        segment
      ): segment is Extract<
        ConversationComposerInputSegment,
        { kind: "url" }
      > => segment.kind === "url"
    )
    .map((segment) => segment.value)
}

describe("conversation composer URL highlighting", () => {
  it("stops a URL before following Chinese prose", () => {
    const segments = getConversationComposerInputSegments(
      "https://www.infocare.org.cn/后续说明"
    )

    expect(getUrls(segments)).toEqual(["https://www.infocare.org.cn/"])
    expect(segments.at(-1)).toEqual({
      kind: "text",
      value: "后续说明",
      start: "https://www.infocare.org.cn/".length,
      end: "https://www.infocare.org.cn/后续说明".length,
    })
  })

  it("keeps ASCII paths and query parameters while excluding prose punctuation", () => {
    const segments = getConversationComposerInputSegments(
      "请查看 https://example.com/reports/monthly?from=chat，随后整理。"
    )

    expect(getUrls(segments)).toEqual([
      "https://example.com/reports/monthly?from=chat",
    ])
    expect(segments.at(-1)).toMatchObject({
      kind: "text",
      value: "，随后整理。",
    })
  })

  it("recognizes www URLs and removes closing prose punctuation", () => {
    const segments = getConversationComposerInputSegments(
      "参考（www.linksense.ai/library）。"
    )

    expect(getUrls(segments)).toEqual(["www.linksense.ai/library"])
  })

  it("does not highlight malformed or embedded URL-like text", () => {
    const segments = getConversationComposerInputSegments(
      "versionhttps://example.com 和 https://，都不是可用网址"
    )

    expect(getUrls(segments)).toEqual([])
  })
})
