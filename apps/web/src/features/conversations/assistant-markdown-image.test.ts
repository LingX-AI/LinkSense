import { describe, expect, it } from "vitest"

import {
  assistantMarkdownUrlTransform,
  collectInlineArtifactIds,
  getKnowledgeAssetId,
  getSafeAssistantMarkdownLinkUrl,
} from "@/features/conversations/assistant-markdown-image-utils"

describe("assistant Markdown image URL boundary", () => {
  it("allows logical artifacts and public URLs while blocking server-local paths", () => {
    const image = { tagName: "img" }
    const link = { tagName: "a" }
    const fileId = "30000000-0000-4000-8000-000000000001"
    const knowledgeAssetId = "50000000-0000-4000-8000-000000000003"

    expect(
      assistantMarkdownUrlTransform(
        `linksense-artifact:${fileId}`,
        "src",
        image
      )
    ).toBe(`linksense-artifact:${fileId}`)
    expect(
      assistantMarkdownUrlTransform(
        "https://example.com/reference.png",
        "src",
        image
      )
    ).toBe("https://example.com/reference.png")
    expect(
      assistantMarkdownUrlTransform(
        `kb-asset://${knowledgeAssetId}`,
        "src",
        image
      )
    ).toBe(`kb-asset://${knowledgeAssetId}`)
    expect(getKnowledgeAssetId(`kb-asset://${knowledgeAssetId}`)).toBe(
      knowledgeAssetId
    )
    expect(
      assistantMarkdownUrlTransform(
        `kb-asset:$ABSOLUTE${knowledgeAssetId}`,
        "src",
        image
      )
    ).toBe(`kb-asset://${knowledgeAssetId}`)
    expect(getKnowledgeAssetId(`kb-asset:$ABSOLUTE${knowledgeAssetId}`)).toBe(
      knowledgeAssetId
    )
    expect(
      assistantMarkdownUrlTransform(
        "kb-asset://../../private.png",
        "src",
        image
      )
    ).toBe("linksense-artifact:unavailable")
    expect(getKnowledgeAssetId("kb-asset://../../private.png")).toBeNull()
    expect(
      assistantMarkdownUrlTransform(
        "%2Fdata%2Flinksense%2Fprivate.png",
        "src",
        image
      )
    ).toBe("linksense-artifact:unavailable")
    expect(
      assistantMarkdownUrlTransform("assets/private-preview.png", "src", image)
    ).toBe("linksense-artifact:unavailable")
    expect(
      assistantMarkdownUrlTransform(
        "file:///data/linksense/private.png",
        "href",
        link
      )
    ).toBe("")
  })

  it("collects referenced artifact IDs case-insensitively", () => {
    expect(
      collectInlineArtifactIds(
        "![一](linksense-artifact:30000000-0000-4000-8000-000000000001)\n" +
          "![二](linksense-artifact:40000000-0000-4000-8000-000000000002)"
      )
    ).toEqual(
      new Set([
        "30000000-0000-4000-8000-000000000001",
        "40000000-0000-4000-8000-000000000002",
      ])
    )
  })

  it("only accepts public web and email destinations for assistant links", () => {
    expect(
      getSafeAssistantMarkdownLinkUrl("https://example.com/file.zip")
    ).toBe("https://example.com/file.zip")
    expect(getSafeAssistantMarkdownLinkUrl("mailto:support@example.com")).toBe(
      "mailto:support@example.com"
    )
    expect(getSafeAssistantMarkdownLinkUrl()).toBeNull()
    expect(getSafeAssistantMarkdownLinkUrl("  ")).toBeNull()
    expect(getSafeAssistantMarkdownLinkUrl("artifacts/result.zip")).toBeNull()
    expect(getSafeAssistantMarkdownLinkUrl("/data/result.zip")).toBeNull()
    expect(
      getSafeAssistantMarkdownLinkUrl("file:///data/result.zip")
    ).toBeNull()
    expect(getSafeAssistantMarkdownLinkUrl("http://localhost:5210")).toBeNull()
    expect(getSafeAssistantMarkdownLinkUrl("http://127.0.0.1:5210")).toBeNull()
    expect(getSafeAssistantMarkdownLinkUrl("http://[::1]:5210")).toBeNull()
  })
})
