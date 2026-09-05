// @vitest-environment node

import appStyles from "@/index.css?raw"
import { describe, expect, it } from "vitest"

function cssRule(selector: string) {
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")
  return appStyles.match(
    new RegExp(`${escapedSelector}\\s*\\{([^}]*)\\}`, "u")
  )?.[1]
}

describe("browser notification prompt style", () => {
  it("uses the compact LinkSense surface instead of the generic card treatment", () => {
    const promptRule = cssRule(".browser-notification-prompt")

    expect(promptRule).toContain("padding-block: 14px;")
    expect(promptRule).toContain("border-radius: 14px;")
    expect(promptRule).toContain(
      "border: 1px solid color-mix(in srgb, var(--app-muted) 16%, transparent);"
    )
    expect(promptRule).toContain("background: var(--app-popover);")
    expect(promptRule).toContain("box-shadow: 0 6px 18px rgb(0 0 0 / 7%);")
  })

  it("follows the adjustable LinkSense typography and compact control density", () => {
    const titleRule = cssRule(
      '.browser-notification-prompt [data-slot="card-title"]'
    )
    const buttonRule = cssRule(
      '.browser-notification-prompt [data-slot="button"]'
    )

    expect(titleRule).toContain("font-size: var(--app-ui-font-size);")
    expect(titleRule).toContain("font-weight: 500;")
    expect(titleRule).toContain("line-height: var(--app-ui-copy-line-height);")
    expect(buttonRule).toContain("height: 32px;")
    expect(buttonRule).toContain("border-radius: 8px;")
    expect(buttonRule).toContain("font-size: var(--app-font-13);")
  })

  it("aligns a compact bell with the first line of the prompt copy", () => {
    const headerRule = cssRule(
      '.browser-notification-prompt [data-slot="card-header"]'
    )
    const iconRule = cssRule(".browser-notification-prompt-icon")

    expect(headerRule).toContain("gap: 8px;")
    expect(iconRule).toContain("width: 14px;")
    expect(iconRule).toContain("height: 14px;")
    expect(iconRule).toContain(
      "margin-top: calc((var(--app-ui-copy-line-height) - 14px) / 2);"
    )
  })
})
