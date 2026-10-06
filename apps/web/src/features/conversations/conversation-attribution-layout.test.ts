// @vitest-environment node

import { compile } from "tailwindcss"
import tailwindTheme from "tailwindcss/theme.css?raw"
import { beforeAll, describe, expect, it } from "vitest"

import conversationPageSource from "@/pages/conversation-pages.tsx?raw"
import conversationStyles from "@/index.css?raw"

describe("conversation attribution layout", () => {
  let attributionStyles: string

  beforeAll(async () => {
    const attributionClasses = conversationPageSource.match(
      /<PoweredByLinkSense\s+className="([^"]+)"/u
    )?.[1]
    expect(attributionClasses).toBeDefined()
    const compiler = await compile(`${tailwindTheme}\n@tailwind utilities;`)
    attributionStyles = compiler.build(attributionClasses?.split(/\s+/u) ?? [])
  })

  it("removes attribution from the composer grid only when the workspace has room beside the input", () => {
    const wideWorkspaceRule = attributionStyles.match(
      /@container conversation-workspace \(width >= 76rem\)\s*\{[^}]*position:\s*absolute;/u
    )?.[0]

    expect(wideWorkspaceRule).toBeDefined()
    expect(attributionStyles).not.toMatch(/(?:^|\n)\.absolute\s*\{/u)
    expect(attributionStyles).not.toMatch(/position:\s*fixed;/u)
    expect(attributionStyles).toMatch(
      /@container conversation-workspace \(width >= 76rem\)\s*\{[^}]*right:\s*var\(--spacing\);/u
    )
    expect(attributionStyles).toMatch(
      /@container conversation-workspace \(width >= 76rem\)\s*\{[^}]*bottom:\s*var\(--spacing\);/u
    )
    expect(attributionStyles).toMatch(
      /@container conversation-workspace \(width >= 76rem\)\s*\{[^}]*margin:\s*0;/u
    )
  })

  it("keeps the compact composer bottom inset and hides attribution on mobile", () => {
    expect(conversationStyles).toMatch(
      /^\.conversation-bottom-stack\s*\{[^}]*inset:\s*auto var\(--conversation-horizontal-gutter\) 18px;/mu
    )
    expect(conversationStyles).toMatch(
      /^\.conversation-workspace\s*\{[^}]*container:\s*conversation-workspace \/ inline-size;/mu
    )
    expect(attributionStyles).toMatch(/\.hidden\s*\{\s*display:\s*none;/u)
    expect(attributionStyles).toMatch(
      /@media \(width >= 48rem\)\s*\{\s*display:\s*inline-flex;/u
    )
  })
})
