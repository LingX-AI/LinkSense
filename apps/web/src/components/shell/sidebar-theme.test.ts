// @vitest-environment node

import sidebarStyles from "@/index.css?raw"
import appShellSource from "@/components/shell/app-shell.tsx?raw"
import { describe, expect, it } from "vitest"

function cssRule(selector: string) {
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")
  return sidebarStyles.match(
    new RegExp(`${escapedSelector}\\s*\\{([^}]*)\\}`, "u")
  )?.[1]
}

describe("sidebar theme", () => {
  it("indents category task content inside full-width rows", () => {
    expect(sidebarStyles).toMatch(
      /(?:^|\n)\.sidebar-conversation-link\s*\{[^}]*padding-left:\s*calc\(8px \+ var\(--sidebar-conversation-indent, 0px\)\);/u
    )
    expect(cssRule(".sidebar-conversation-item")).not.toMatch(
      /margin-left|padding-left/u
    )
  })

  it("softens active task backgrounds without changing other sidebar selections", () => {
    expect(cssRule('.sidebar-conversation-item[data-active="true"]')).toMatch(
      /background:\s*color-mix\(\s*in srgb,\s*var\(--app-sidebar-active\) 65%,\s*transparent\s*\);/u
    )
    expect(sidebarStyles).toContain(
      ".sidebar-conversation-item.sidebar-link-active,"
    )
    expect(cssRule('.sidebar-nav-item[data-active="true"]')).toContain(
      "background: var(--app-sidebar-active);"
    )
    expect(cssRule(".sidebar-link-active")).toContain(
      "background: var(--app-sidebar-active);"
    )
  })

  it("paints hover and keyboard focus backgrounds once on the entire task row", () => {
    expect(sidebarStyles).toMatch(
      /\.sidebar-conversation-item:not\(\[data-active="true"\]\):not\(\s*\.sidebar-link-active\s*\):has\(:focus-visible\),[^}]*background:\s*var\(--app-sidebar-hover\);/u
    )
    expect(sidebarStyles).not.toMatch(
      /\.sidebar-conversation-link\s*\{[^}]*background:\s*var\(--app-sidebar-hover\);/u
    )
  })

  it("reserves room for the task menu and archive button", () => {
    expect(cssRule(".sidebar-conversation-item")).toContain(
      "--sidebar-conversation-actions-width: 56px;"
    )
  })
  it("uses the documented 248px default for task and settings sidebars", () => {
    expect(cssRule(":root")).toContain("--app-sidebar-width: 248px;")
    expect(cssRule(".prototype-shell")).toContain(
      "grid-template-columns: var(--app-sidebar-width) minmax(0, 1fr);"
    )
    expect(cssRule(".settings-shell")).toContain(
      "grid-template-columns: var(--app-sidebar-width) minmax(0, 1fr);"
    )
  })

  it("uses neutral sidebar surfaces and interaction tokens", () => {
    const lightTheme = cssRule(":root")
    const darkTheme = cssRule(".dark")

    expect(lightTheme).toContain("--sidebar: #f5f5f5;")
    expect(lightTheme).toContain("--app-sidebar: #f5f5f5;")
    expect(lightTheme).toContain("--app-sidebar-muted: #626262;")
    expect(lightTheme).toContain("--sidebar-accent: rgb(32 32 32 / 3%);")
    expect(lightTheme).toContain("--app-sidebar-hover: rgb(32 32 32 / 3%);")
    expect(lightTheme).toContain("--app-hover-subtle: rgb(32 32 32 / 2%);")
    expect(lightTheme).toContain("--app-sidebar-active: rgb(32 32 32 / 8%);")
    expect(lightTheme).toContain("--app-user-surface: #f5f5f5;")
    expect(lightTheme).toContain("--app-brand: #1866e1;")
    expect(lightTheme).toContain("--app-brand-foreground: #ffffff;")
    expect(lightTheme).toContain("--destructive: #b84048;")
    expect(lightTheme).toContain("--app-sidebar-avatar: var(--app-brand);")
    expect(lightTheme).toContain(
      "--app-sidebar-avatar-foreground: var(--app-brand-foreground);"
    )
    expect(lightTheme).toContain(
      "--app-mobile-sidebar-edge: rgb(32 32 32 / 8%);"
    )
    expect(darkTheme).toContain("--sidebar: #202020;")
    expect(darkTheme).toContain("--app-sidebar: #202020;")
    expect(darkTheme).toContain("--sidebar-accent: #282828;")
    expect(darkTheme).toContain("--app-sidebar-hover: #282828;")
    expect(darkTheme).toContain("--app-hover-subtle: rgb(255 255 255 / 3%);")
    expect(darkTheme).toContain("--app-sidebar-active: #343434;")
    expect(darkTheme).toContain("--app-user-surface: #292929;")
    expect(darkTheme).toContain("--app-sidebar-muted: #b3b3b3;")
    expect(darkTheme).toContain("--app-sidebar-avatar: var(--app-brand);")
    expect(darkTheme).toContain(
      "--app-sidebar-avatar-foreground: var(--app-brand-foreground);"
    )
  })

  it("uses the same subtle interaction surface across shared and custom controls", () => {
    const lightTheme = cssRule(":root")
    const darkTheme = cssRule(".dark")

    expect(lightTheme).toContain("--accent: #e9e9e9;")
    expect(lightTheme).toContain("--app-hover: rgb(32 32 32 / 4%);")
    expect(lightTheme).toContain("--app-media-control-hover: #e9e9e9;")
    expect(darkTheme).toContain("--accent: #2c2c2c;")
    expect(darkTheme).toContain("--app-hover: rgb(255 255 255 / 6%);")
    expect(darkTheme).toContain("--app-media-control-hover: #393939;")
    expect(sidebarStyles).toContain("--color-hover: var(--app-hover);")
  })

  it("uses a soft charcoal dark canvas with matching topbar and elevated surfaces", () => {
    const darkTheme = cssRule(".dark")

    expect(darkTheme).toContain("--background: #141414;")
    expect(darkTheme).toContain("--app-canvas: #141414;")
    expect(darkTheme).toContain("--app-topbar: rgb(20 20 20 / 94%);")
    expect(darkTheme).toContain("--card: #252525;")
    expect(darkTheme).toContain("--app-composer: #252525;")
    expect(darkTheme).toContain("--app-popover: #252525;")
    expect(darkTheme).toContain("--app-control-surface: #303030;")
  })

  it("uses sidebar-specific avatar colors for the account identity", () => {
    expect(cssRule(".sidebar-account-avatar")).toContain(
      "background: var(--app-sidebar-avatar);"
    )
    expect(
      cssRule('.sidebar-account-avatar [data-slot="avatar-fallback"]')
    ).toContain("color: var(--app-sidebar-avatar-foreground);")
  })

  it("keeps sidebar menus on sidebar-specific interaction tokens", () => {
    expect(sidebarStyles).toMatch(
      /\.sidebar-nav-item,[^}]*color:\s*var\(--app-sidebar-muted\);/u
    )
    expect(cssRule(".sidebar-link")).toContain(
      "color: var(--app-sidebar-muted);"
    )
    expect(sidebarStyles).toMatch(
      /\.sidebar-nav-item:not\(\[data-active="true"\]\):hover,[^}]*background:\s*var\(--app-sidebar-hover\);/u
    )
    expect(cssRule(".sidebar-link-active")).toContain(
      "background: var(--app-sidebar-active);"
    )
    expect(cssRule(".settings-back-link:hover")).toContain(
      "background: var(--app-sidebar-hover);"
    )
    expect(
      cssRule(
        ".settings-navigation-link:not(.settings-navigation-link-active):hover"
      )
    ).toContain("background: var(--app-sidebar-hover);")
    expect(cssRule(".settings-navigation-link-active")).toContain(
      "background: var(--app-sidebar-active);"
    )
  })

  it("keeps the current new-task link emphasized without an active surface", () => {
    expect(appShellSource).toMatch(
      /to:\s*"\/conversations\/new",[\s\S]*?activeClassName:\s*"sidebar-link-current"/u
    )
    expect(cssRule(".sidebar-link-current")).toContain(
      "color: var(--app-text);"
    )
    expect(cssRule(".sidebar-link-current")).not.toContain("background:")
  })

  it("keeps the divider attached to the sidebar without narrowing the resize target", () => {
    expect(cssRule(".sidebar-resize-handle")).toContain("width: 10px;")
    expect(cssRule(".app-shell > .app-sidebar")).toContain(
      "border-right: 1px solid var(--app-divider);"
    )
    expect(cssRule(".settings-sidebar")).toContain(
      "border-right: 1px solid var(--app-divider);"
    )
    expect(sidebarStyles).toMatch(
      /@media \(max-width: 767px\)\s*\{[\s\S]*?\.settings-sidebar\s*\{[^}]*border-right:\s*0;/u
    )
    expect(sidebarStyles).not.toContain(
      ".app-shell > .sidebar-resize-handle::before"
    )

    const indicatorRule = cssRule(".sidebar-resize-handle::after")
    expect(indicatorRule).toContain("left: 50%;")
    expect(indicatorRule).toContain("width: 1px;")
    expect(indicatorRule).toContain("transform: translateX(-100%);")
    expect(
      cssRule(".sidebar-resize-handle:focus-visible::after")
    ).not.toContain("width:")
  })

  it("keeps the sidebar width synchronized with the pointer while resizing", () => {
    expect(cssRule(".app-shell")).not.toContain("transition:")
    expect(cssRule('.app-shell[data-sidebar-resizing="true"]')).toContain(
      "transition: none;"
    )
    expect(sidebarStyles).toMatch(
      /@media \(min-width: 768px\)\s*\{[\s\S]*?\.app-shell\s*\{[^}]*transition:\s*grid-template-columns 160ms ease;[^}]*\}[\s\S]*?\.app-shell\[data-sidebar-resizing="true"\]\s*\{[^}]*transition:\s*none;/u
    )
  })

  it("centers the mobile navigation button against the conversation title bar", () => {
    const titleBarRule = sidebarStyles.match(
      /(?:^|\n)\.conversation-top-bar\s*\{([^}]*)\}/u
    )?.[1]
    expect(titleBarRule).toContain(
      "height: var(--conversation-top-bar-height);"
    )
    expect(titleBarRule).toContain("align-items: center;")
    expect(cssRule(".mobile-shell-trigger")).toContain(
      "top: calc((var(--conversation-top-bar-height) - 28px) / 2);"
    )
  })

  it("collapses the desktop sidebar and makes room for its restore control", () => {
    expect(cssRule('.app-shell[data-sidebar-collapsed="true"]')).toContain(
      "grid-template-columns: 0 minmax(0, 1fr);"
    )
    expect(
      cssRule('.app-shell[data-sidebar-collapsed="true"] .app-sidebar')
    ).toContain("visibility: hidden;")
    expect(
      cssRule('.app-shell[data-sidebar-collapsed="true"] .app-top-bar')
    ).toContain("padding-left: 52px;")
    expect(
      cssRule('.app-shell[data-sidebar-collapsed="true"] .conversation-top-bar')
    ).toContain("padding-left: 52px;")
    expect(cssRule(".desktop-sidebar-trigger")).toContain("top: 11px;")
    expect(cssRule(".desktop-sidebar-trigger")).toContain("left: 10px;")
    expect(
      cssRule(
        '.app-main[data-compact-top-bar="true"] > .desktop-sidebar-trigger'
      )
    ).toContain("top: calc((var(--conversation-top-bar-height) - 28px) / 2);")
    expect(cssRule(".desktop-sidebar-trigger:hover")).toContain(
      "background: transparent;"
    )
    expect(
      cssRule(
        '.sidebar-nav-item.sidebar-collapse-control[aria-expanded="true"]'
      )
    ).toContain("background: transparent;")
  })

  it("uses the configured UI font size for primary sidebar text", () => {
    expect(sidebarStyles).toMatch(
      /\.sidebar-link,\s*\.sidebar-conversation-link\s*\{[^}]*font-size:\s*var\(--app-ui-font-size\);[^}]*line-height:\s*var\(--app-ui-compact-line-height\);/u
    )
  })

  it("uses the configured UI font size throughout settings navigation", () => {
    for (const selector of [
      ".settings-back-link",
      ".settings-search-field input",
      ".settings-navigation-group h2",
      ".settings-navigation-link",
      ".settings-navigation-empty",
    ]) {
      expect(cssRule(selector)).toContain("font-size: var(--app-ui-font-size);")
      expect(cssRule(selector)).toContain(
        "line-height: var(--app-ui-compact-line-height);"
      )
    }
  })

  it("matches the 32px category rows without vertical padding inflating task height", () => {
    expect(sidebarStyles).toMatch(
      /\.sidebar-link,\s*\.sidebar-conversation-link\s*\{[^}]*min-height:\s*32px;/u
    )
    expect(sidebarStyles).toMatch(
      /(?:^|\n)\.sidebar-conversation-link\s*\{[^}]*padding:\s*0 8px;/u
    )
    expect(sidebarStyles).not.toMatch(
      /(?:^|\n)\.sidebar-conversation-link\s*\{[^}]*min-height:\s*36px;/u
    )
    expect(appShellSource).toContain(
      'className="sidebar-conversation-link h-8"'
    )
    expect(cssRule(".sidebar-conversation-item")).toContain(
      "contain-intrinsic-size: auto 32px;"
    )
  })

  it("keeps a clear title gap before conversation actions across input modes", () => {
    expect(sidebarStyles).toMatch(
      /\.sidebar-conversation-item:hover\s+\.sidebar-conversation-link,[^}]*\.sidebar-conversation-item:has\(:focus-visible\)\s+\.sidebar-conversation-link,[^}]*\.sidebar-conversation-item:has\(\[data-popup-open\]\)\s+\.sidebar-conversation-link\s*\{[^}]*padding-right:\s*var\(--sidebar-conversation-actions-width\);/u
    )
    expect(sidebarStyles).toMatch(
      /@media \(hover:\s*none\)\s*\{\s*\.sidebar-conversation-link\s*\{[^}]*padding-right:\s*var\(--sidebar-conversation-actions-width\);/u
    )
  })

  it("keeps touch task statuses visible beside actions with enough title space", () => {
    const touchStyles = sidebarStyles
      .split("@media (hover: none) {")[1]
      ?.split(".sidebar-link-active {")[0]
    expect(touchStyles).toMatch(
      /\.sidebar-conversation-item\[data-running="true"\]\s+\.sidebar-conversation-link,\s*\.sidebar-conversation-item\[data-warning="true"\]\s+\.sidebar-conversation-link\s*\{[^}]*padding-right:\s*calc\(var\(--sidebar-conversation-actions-width\) \+ 22px\);/u
    )
    expect(touchStyles).toMatch(
      /\.sidebar-conversation-running,\s*\.sidebar-conversation-warning\s*\{[^}]*right:\s*var\(--sidebar-conversation-actions-width\);[^}]*opacity:\s*1;/u
    )
    expect(touchStyles).toMatch(
      /\.sidebar-conversation-actions\s*\{[^}]*pointer-events:\s*auto;[^}]*opacity:\s*1;/u
    )
  })

  it("reveals recent task title fading and actions without hover transitions", () => {
    expect(sidebarStyles).toMatch(
      /(?:^|\n)\.sidebar-conversation-link\s*\{[^}]*transition:\s*none;/u
    )
    expect(cssRule(".sidebar-conversation-link:focus-visible")).toContain(
      "outline: none;"
    )
    expect(cssRule(".sidebar-link")).toMatch(
      /transition:\s*background-color 160ms ease,\s*color 160ms ease;/u
    )
    expect(sidebarStyles).not.toMatch(
      /\.sidebar-conversation-item:focus-within\s+\.sidebar-conversation-link/u
    )
  })

  it("handles task hover presentation in CSS without sidebar state updates", () => {
    expect(appShellSource).not.toContain("hoveredConversationId")
    expect(sidebarStyles).toMatch(
      /\.sidebar-conversation-scroll:has\(\.sidebar-conversation-item:hover\)[\s\S]*?\.sidebar-conversation-item:not\(:hover\)[\s\S]*?\.sidebar-conversation-actions\s*\{[^}]*pointer-events:\s*none;[^}]*opacity:\s*0;/u
    )
    expect(sidebarStyles).toMatch(
      /\.sidebar-conversation-scroll:has\(\.sidebar-conversation-item:hover\)[\s\S]*?\.sidebar-conversation-item:not\(:hover\)[\s\S]*?\.sidebar-conversation-running,[\s\S]*?\.sidebar-conversation-warning\s*\{[^}]*opacity:\s*1;/u
    )
  })
})
