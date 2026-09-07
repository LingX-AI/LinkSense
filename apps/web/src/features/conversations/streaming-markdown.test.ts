import { describe, expect, it } from "vitest"

import {
  normalizeAssistantMarkdown,
  prepareStreamingAssistantMarkdown,
} from "@/features/conversations/streaming-markdown"

describe("normalizeAssistantMarkdown", () => {
  it("moves trailing whitespace outside malformed strong emphasis", () => {
    const markdown = [
      "**版本： **2.0",
      "- **创建人： **Jon Hansen",
      "**审核人：   **Senior Leadership Team",
    ].join("\n")

    const normalized = normalizeAssistantMarkdown(markdown)

    expect(normalized).toBe(
      [
        "**版本：** 2.0",
        "- **创建人：** Jon Hansen",
        "**审核人：**   Senior Leadership Team",
      ].join("\n")
    )
    expect(normalized).toHaveLength(markdown.length)
  })

  it("moves leading whitespace outside malformed strong emphasis", () => {
    const markdown = [
      "公司宣布** Neo He 提前转正**，表扬其项目表现。",
      "任命** Jegan Chen、Rhoda Chen、Liz Xukur**分别兼任产品线负责人。",
      "Rhoda 获奖励** 300元京东购物卡**。",
    ].join("\n")

    const normalized = normalizeAssistantMarkdown(markdown)

    expect(normalized).toBe(
      [
        "公司宣布 **Neo He 提前转正**，表扬其项目表现。",
        "任命 **Jegan Chen、Rhoda Chen、Liz Xukur**分别兼任产品线负责人。",
        "Rhoda 获奖励 **300元京东购物卡**。",
      ].join("\n")
    )
    expect(normalized).toHaveLength(markdown.length)
  })

  it("repairs whitespace on both sides of malformed strong emphasis", () => {
    const markdown = "** 重点内容 **随后继续说明。"
    const normalized = normalizeAssistantMarkdown(markdown)

    expect(normalized).toBe(" **重点内容** 随后继续说明。")
    expect(normalized).toHaveLength(markdown.length)
  })

  it("leaves valid emphasis, escaped text, inline code, and code fences unchanged", () => {
    const markdown = [
      "**有效标签：** value",
      "\\**转义标签： **value",
      "`公司宣布** Neo He 提前转正**`",
      "`**行内示例： **value`",
      "```md",
      "**代码块： **value",
      "公司宣布** Neo He 提前转正**",
      "```",
      "~~~md",
      "**波浪代码块： **value",
      "~~~",
    ].join("\n")

    expect(normalizeAssistantMarkdown(markdown)).toBe(markdown)
  })

  it("normalizes paired TeX delimiters without changing citation offsets", () => {
    const markdown = [
      "行内公式：\\(v = s / t\\)。",
      "",
      "\\[",
      "\\mathrm{tokens}/s \\approx \\frac{\\text{有效显存带宽}}{\\text{模型权重大小}}",
      "\\]",
    ].join("\n")

    const normalized = normalizeAssistantMarkdown(markdown)

    expect(normalized).toBe(
      [
        "行内公式：$ v = s / t $。",
        "",
        "$$",
        "\\mathrm{tokens}/s \\approx \\frac{\\text{有效显存带宽}}{\\text{模型权重大小}}",
        "$$",
      ].join("\n")
    )
    expect(normalized).toHaveLength(markdown.length)
  })

  it("leaves unmatched and code-contained TeX delimiters unchanged", () => {
    const markdown = [
      "未完成公式：\\(v = s / t",
      "`\\(code\\)`",
      "```tex",
      "\\[code\\]",
      "```",
    ].join("\n")

    expect(normalizeAssistantMarkdown(markdown)).toBe(markdown)
  })
})

describe("prepareStreamingAssistantMarkdown", () => {
  it.each([
    ["图片说明未结束", "回答\n\n![步骤一"],
    ["图片地址未结束", "回答\n\n![步骤一](kb-asset://50000000-0000"],
    [
      "闭合括号尚未到达",
      "回答\n\n![步骤一](kb-asset://50000000-0000-5000-8000-000000000001",
    ],
  ])("hides an unfinished trailing image when %s", (_label, markdown) => {
    expect(prepareStreamingAssistantMarkdown(markdown)).toBe("回答\n\n")
  })

  it("keeps completed images and hides only the unfinished tail", () => {
    const complete =
      "![步骤一](kb-asset://50000000-0000-5000-8000-000000000001)"
    expect(
      prepareStreamingAssistantMarkdown(`${complete}\n\n![步骤二](kb-asset://`)
    ).toBe(`${complete}\n\n`)
  })

  it("leaves complete image Markdown unchanged", () => {
    const markdown =
      "回答\n\n![步骤一](kb-asset://50000000-0000-5000-8000-000000000001)"
    expect(prepareStreamingAssistantMarkdown(markdown)).toBe(markdown)
  })

  it.each([
    ["inline code", "回答 `![示例](kb-asset://partial`"],
    ["fenced code", "```md\n![示例](kb-asset://partial\n```"],
    ["escaped text", "回答 \\![不是图片"],
  ])("does not hide image-like text inside %s", (_label, markdown) => {
    expect(prepareStreamingAssistantMarkdown(markdown)).toBe(markdown)
  })
})
