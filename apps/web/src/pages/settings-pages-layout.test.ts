// @vitest-environment node

import { describe, expect, it } from "vitest"

import appStyles from "@/index.css?raw"
import settingsPageSource from "@/pages/settings-pages.tsx?raw"

describe("settings page layout", () => {
  it("keeps the interface language control on the right side of its field row", () => {
    expect(settingsPageSource).toContain(
      'className="settings-panel settings-language-panel"'
    )
    expect(settingsPageSource).toContain('className="settings-language-field"')

    expect(appStyles).toMatch(
      /\.settings-language-field \{[\s\S]*?display: grid;[\s\S]*?grid-template-columns: minmax\(0, 1fr\) 220px;[\s\S]*?align-items: center;[\s\S]*?gap: 16px 24px;[\s\S]*?margin-top: 16px;[\s\S]*?\}/u
    )
    expect(appStyles).toMatch(
      /@media \(max-width: 767px\) \{[\s\S]*?\.settings-language-field \{[\s\S]*?grid-template-columns: 1fr;[\s\S]*?gap: 6px;[\s\S]*?\}/u
    )
  })
})
