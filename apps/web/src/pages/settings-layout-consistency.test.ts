// @vitest-environment node

import appStyles from "@/index.css?raw"
import { describe, expect, it } from "vitest"

function cssRules(selector: string) {
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")
  return Array.from(
    appStyles.matchAll(
      new RegExp(`(?:^|\\n)\\s*${escapedSelector}\\s*\\{([^}]*)\\}`, "gu")
    )
  ).map((match) => match[1])
}

function lastCssRule(selector: string) {
  return cssRules(selector).at(-1)
}

function firstCssRule(selector: string) {
  return cssRules(selector)[0]
}

describe("settings center layout consistency", () => {
  it("uses the same 16px description-to-form spacing for personal settings", () => {
    for (const selector of [
      ".settings-form",
      ".personalization-instructions-form",
    ]) {
      expect(firstCssRule(selector)).toContain("margin-top: 16px;")
    }
  })

  it("lets the health section grid own spacing without legacy margins or title insets", () => {
    expect(firstCssRule(".health-summary")).not.toContain("margin-bottom")
    expect(firstCssRule(".docker-resource-section")).not.toContain(
      "padding-bottom"
    )
    expect(
      firstCssRule(".health-page .knowledge-section-heading")
    ).toBeUndefined()
    expect(
      firstCssRule(".docker-resource-section + .entity-list")
    ).toBeUndefined()
  })

  it("extends list row backgrounds through the card inset while preserving content alignment", () => {
    const rule = firstCssRule(".list-card-content > .entity-row")
    expect(rule).toContain("margin-inline: -16px;")
    expect(rule).toContain("padding-inline: 16px;")
  })

  it("uses a 16px gap without extra top padding between settings cards", () => {
    const rule = firstCssRule(
      '.settings-section + .settings-section[data-slot="settings-card"]'
    )
    expect(rule).toContain("margin-top: 16px;")
    expect(rule).toContain("padding-top: 0;")
  })

  it("excludes bordered settings cards from section divider backgrounds", () => {
    expect(
      firstCssRule(
        '.settings-section + .settings-section:not([data-slot="settings-card"])'
      )
    ).toContain(
      "background-image: linear-gradient(var(--app-divider), var(--app-divider));"
    )
    expect(
      cssRules(".settings-section + .settings-section").join("\n")
    ).not.toContain("background-image")
  })

  it("centers all settings pages while widening only the administration container", () => {
    expect(firstCssRule(":root")).toContain("--app-settings-page-width: 920px;")
    for (const selector of [".settings-content", ".management-page"]) {
      expect(firstCssRule(selector)).toContain(
        "width: min(100%, var(--app-settings-page-width));"
      )
      expect(firstCssRule(selector)).toContain("margin-inline: auto;")
    }
    expect(firstCssRule(":root")).toContain(
      "--app-administration-page-width: 1200px;"
    )
    expect(firstCssRule(".settings-content-administration")).toContain(
      "--app-settings-page-width: var(--app-administration-page-width);"
    )
  })

  it("lets settings sections fill their shared page instead of imposing local widths", () => {
    for (const selector of [
      ".settings-section",
      ".settings-panel",
      ".settings-form",
      ".personalization-section",
      ".personalization-loading",
      ".appearance-theme-fieldset",
      ".channel-access-list",
      ".role-summary",
      ".role-permission-section",
    ]) {
      expect(firstCssRule(selector), selector).not.toMatch(/max-width:/u)
    }
  })

  it("uses one desktop and mobile inset for personal and administration pages", () => {
    const selector = ".settings-content :is(.settings-page, .management-page)"
    expect(firstCssRule(selector)).toContain("padding: 44px 52px 72px;")
    expect(lastCssRule(selector)).toContain("padding: 24px 16px 52px;")
  })

  it("keeps personal and administration page headers on the same rhythm", () => {
    expect(firstCssRule(".settings-page-header")).toContain(
      "margin-bottom: 28px;"
    )
    expect(firstCssRule(".management-header")).toContain("margin-bottom: 28px;")
  })

  it("uses the same section-title tier across setting page variants", () => {
    for (const selector of [
      ".settings-section h2",
      ".settings-panel h2",
      ".profile-section-heading h2",
    ]) {
      const rule = lastCssRule(selector)

      expect(rule).toContain("font-size: var(--app-ui-font-size);")
      expect(rule).toContain("font-weight: 600;")
      expect(rule).toContain("line-height: var(--app-line-20);")
    }
  })

  it("uses a 16px tab-to-content gap and prevents tab panels from overflowing", () => {
    expect(
      lastCssRule(
        '.settings-shell [data-slot="tabs"][data-orientation="horizontal"]'
      )
    ).toContain("gap: 16px;")
    expect(lastCssRule('.settings-shell [data-slot="tabs-content"]')).toContain(
      "min-width: 0;"
    )
  })

  it("aligns sidebar search and navigation rows to the same control height", () => {
    expect(lastCssRule(".settings-search-field input")).toContain(
      "height: 32px;"
    )
    expect(lastCssRule(".settings-navigation-link")).toContain(
      "min-height: 32px;"
    )
  })
})
