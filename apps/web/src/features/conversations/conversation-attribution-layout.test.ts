import { cleanup, render, screen } from "@testing-library/react"
import { createElement } from "react"
import { compile } from "tailwindcss"
import tailwindTheme from "tailwindcss/theme.css?raw"
import { beforeAll, describe, expect, it } from "vitest"

import { PoweredByLinkSense } from "@/components/brand/powered-by-linksense"
import i18n from "@/i18n"
import conversationStyles from "@/index.css?raw"

describe("conversation attribution layout", () => {
  let attributionStyles: string

  beforeAll(async () => {
    await i18n.changeLanguage("zh-CN")
    render(createElement(PoweredByLinkSense, { placement: "conversation" }))
    const frame = screen.getByRole("link", {
      name: "由 LinkSense 提供支持",
    }).parentElement
    if (!frame) throw new Error("Attribution frame is missing")
    const compiler = await compile(`${tailwindTheme}\n@tailwind utilities;`)
    attributionStyles = compiler.build(Array.from(frame.classList))
    cleanup()
  })

  it("removes attribution from the composer grid only when the workspace has room beside the input", () => {
    const wideWorkspaceRule = attributionStyles.match(
      /@container conversation-workspace \(width >= 76rem\)\s*\{[^}]*position:\s*absolute;/u
    )?.[0]

    expect(wideWorkspaceRule).toBeDefined()
    expect(attributionStyles).not.toMatch(/(?:^|\n)\.absolute\s*\{/u)
    expect(attributionStyles).not.toMatch(/position:\s*fixed;/u)
    expect(attributionStyles).toMatch(
      /@container conversation-workspace \(width >= 76rem\)\s*\{[^}]*right:\s*calc\(var\(--attribution-inset\)\s*-\s*var\(--conversation-horizontal-gutter\)\);/u
    )
    expect(attributionStyles).toMatch(
      /@container conversation-workspace \(width >= 76rem\)\s*\{[^}]*bottom:\s*calc\(var\(--attribution-inset\)\s*-\s*var\(--conversation-bottom-inset\)\);/u
    )
    expect(attributionStyles).toMatch(
      /@container conversation-workspace \(width >= 76rem\)\s*\{[^}]*margin:\s*0;/u
    )
  })

  it("keeps the shared edge inset in grid flow without moving the composer on mobile", () => {
    expect(attributionStyles).toMatch(/--attribution-inset:\s*18px;/u)
    expect(attributionStyles).toMatch(
      /margin-right:\s*calc\(var\(--attribution-inset\)\s*-\s*var\(--conversation-horizontal-gutter\)\);/u
    )
    expect(attributionStyles).toMatch(
      /margin-bottom:\s*calc\(var\(--attribution-inset\)\s*-\s*var\(--conversation-bottom-inset\)\);/u
    )
    expect(conversationStyles).toMatch(
      /^\.conversation-bottom-stack\s*\{[^}]*--conversation-bottom-inset:\s*18px;[^}]*inset:\s*auto var\(--conversation-horizontal-gutter\)\s*var\(--conversation-bottom-inset\);/mu
    )
    expect(conversationStyles).toMatch(
      /@media \(max-width:\s*767px\)[\s\S]*?\.conversation-bottom-stack\s*\{[^}]*--conversation-bottom-inset:\s*10px;/u
    )
    expect(conversationStyles).toMatch(
      /^\.conversation-workspace\s*\{[^}]*container:\s*conversation-workspace \/ inline-size;/mu
    )
    expect(attributionStyles).toMatch(/\.hidden\s*\{\s*display:\s*none;/u)
    expect(attributionStyles).toMatch(
      /@media \(width >= 48rem\)\s*\{\s*display:\s*flex;/u
    )
  })
})
