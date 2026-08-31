import { describe, expect, it } from "vitest"

import appStyles from "@/index.css?raw"

describe("archived conversation list layout", () => {
  it("matches the grouped archived-chat card layout", () => {
    expect(appStyles).toContain(
      ".archived-conversation-row:hover {\n  background: transparent;\n}"
    )
    expect(appStyles).toMatch(
      /\.archived-conversation-list \{[\s\S]*?gap: 0;[\s\S]*?border-radius: 16px;[\s\S]*?padding-block: 0;[\s\S]*?\}/u
    )
    expect(appStyles).toMatch(
      /\.archived-conversation-list-content \{[\s\S]*?padding-inline: 16px;[\s\S]*?\}/u
    )
    expect(appStyles).toMatch(
      /\.archived-conversation-row \{[\s\S]*?min-height: 60px;[\s\S]*?border: 0;[\s\S]*?border-radius: 0;[\s\S]*?padding: 11px 0;[\s\S]*?\}/u
    )
    expect(appStyles).toMatch(
      /\.archived-conversation-separator \{[\s\S]*?background: var\(--app-border\);[\s\S]*?\}/u
    )
    expect(appStyles).toMatch(
      /\.archived-conversation-summary \{[\s\S]*?justify-content: flex-end;[\s\S]*?color: var\(--app-muted\);[\s\S]*?\}/u
    )
    expect(appStyles).toMatch(
      /\.archived-conversation-copy \{[\s\S]*?flex: 1;[\s\S]*?flex-direction: column;[\s\S]*?align-items: flex-start;[\s\S]*?\}/u
    )
    expect(appStyles).toMatch(
      /\.archived-conversation-actions \{[\s\S]*?align-items: center;[\s\S]*?gap: 8px;[\s\S]*?\}/u
    )
  })
})
