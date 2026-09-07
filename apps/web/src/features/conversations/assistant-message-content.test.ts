// @vitest-environment node

import { describe, expect, it } from "vitest"

import {
  normalizeAssistantMessageContent,
  parseAssistantProposedPlanBlock,
} from "@/features/conversations/assistant-message-content"

describe("normalizeAssistantMessageContent", () => {
  it("repairs placeholders injected into HTML closing tags", () => {
    const content = [
      "```html",
      "<head><title>待办事项<$ABSOLUTE/title>",
      "$ABSOLUTE/head>",
      "<body><div><p>全部<$ABSOLUTE/p><$ABSOLUTE/div></body>",
      "```",
    ].join("\n")

    expect(normalizeAssistantMessageContent(content)).toBe(
      [
        "```html",
        "<head><title>待办事项</title>",
        "</head>",
        "<body><div><p>全部</p></div></body>",
        "```",
      ].join("\n")
    )
  })

  it("repairs placeholders injected into remote and knowledge asset URLs", () => {
    const assetId = "50000000-0000-5000-8000-000000000001"
    const content = [
      "https:$ABSOLUTEupload.wikimedia.org$ABSOLUTE/wikipedia/commons/image.jpg",
      `kb-asset:$ABSOLUTE${assetId}`,
    ].join("\n")

    expect(normalizeAssistantMessageContent(content)).toBe(
      [
        "https://upload.wikimedia.org/wikipedia/commons/image.jpg",
        `kb-asset://${assetId}`,
      ].join("\n")
    )
  })

  it("is idempotent and leaves current assistant content unchanged", () => {
    const content =
      "正常回复 https://example.test/image.png\n\n![图](kb-asset://50000000-0000-5000-8000-000000000001)"

    expect(normalizeAssistantMessageContent(content)).toBe(content)
    expect(
      normalizeAssistantMessageContent(
        normalizeAssistantMessageContent(content)
      )
    ).toBe(content)
  })
})

describe("parseAssistantProposedPlanBlock", () => {
  it("extracts one complete standalone proposed plan and preserves surrounding Markdown", () => {
    const content = [
      "计划前说明。",
      "",
      "  <proposed_plan>  ",
      "## 实施方案",
      "",
      "- 修改实现",
      "  </proposed_plan>",
      "",
      "计划后说明。",
    ].join("\r\n")

    expect(parseAssistantProposedPlanBlock(content)).toEqual({
      before: "计划前说明。\r\n\r\n",
      plan: "## 实施方案\r\n\r\n- 修改实现\r\n",
      after: "\r\n计划后说明。",
    })
  })

  it("ignores proposed-plan markers inside fenced code blocks", () => {
    expect(
      parseAssistantProposedPlanBlock(
        [
          "```xml",
          "<proposed_plan>",
          "不会成为卡片",
          "</proposed_plan>",
          "```",
        ].join("\n")
      )
    ).toBeNull()
  })

  it("ignores fenced examples while extracting the single block outside them", () => {
    const content = [
      "~~~xml",
      "<proposed_plan>",
      "示例",
      "</proposed_plan>",
      "~~~",
      "<proposed_plan>",
      "## 实际方案",
      "</proposed_plan>",
    ].join("\n")

    expect(parseAssistantProposedPlanBlock(content)).toEqual({
      before: [
        "~~~xml",
        "<proposed_plan>",
        "示例",
        "</proposed_plan>",
        "~~~",
        "",
      ].join("\n"),
      plan: "## 实际方案\n",
      after: "",
    })
  })

  it.each([
    ["inline", "前文 <proposed_plan>\n方案\n</proposed_plan>"],
    ["malformed", "<proposed_plan extra>\n方案\n</proposed_plan>"],
    ["unclosed", "<proposed_plan>\n方案"],
    [
      "repeated",
      "<proposed_plan>\n方案一\n</proposed_plan>\n<proposed_plan>\n方案二\n</proposed_plan>",
    ],
  ])("ignores %s proposed-plan markup", (_, content) => {
    expect(parseAssistantProposedPlanBlock(content)).toBeNull()
  })
})
