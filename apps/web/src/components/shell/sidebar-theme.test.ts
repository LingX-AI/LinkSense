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
    expect(lightTheme).toContain(
      "--app-media-control-hover: rgb(32 32 32 / 10%);"
    )
    expect(darkTheme).toContain("--accent: #2c2c2c;")
    expect(darkTheme).toContain("--app-hover: rgb(255 255 255 / 6%);")
    expect(darkTheme).toContain(
      "--app-media-control-hover: rgb(255 255 255 / 16%);"
    )
    expect(sidebarStyles).toContain("--color-hover: var(--app-hover);")
  })

  it("uses the documented dark canvas and elevated surfaces", () => {
    const darkTheme = cssRule(".dark")

    expect(darkTheme).toContain("--background: #000000;")
    expect(darkTheme).toContain("--app-canvas: #000000;")
    expect(darkTheme).toContain("--app-topbar: rgb(0 0 0 / 94%);")
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

  it("uses the shared subtle custom scrollbar treatment for recent tasks", () => {
    const scrollRule = cssRule(".sidebar-conversation-scroll")

    expect(scrollRule).toContain("scrollbar-width: thin;")
    expect(scrollRule).toMatch(
      /scrollbar-color:\s*color-mix\(\s*in srgb,\s*var\(--app-sidebar-muted\) 24%,\s*transparent\s*\)\s*transparent;/u
    )
    expect(
      cssRule(".sidebar-conversation-scroll::-webkit-scrollbar")
    ).toContain("width: 7px;")
    expect(
      cssRule(".sidebar-conversation-scroll::-webkit-scrollbar-track")
    ).toContain("background: transparent;")
    expect(
      cssRule(".sidebar-conversation-scroll::-webkit-scrollbar-thumb")
    ).toMatch(
      /background:\s*color-mix\(\s*in srgb,\s*var\(--app-sidebar-muted\) 22%,\s*transparent\s*\);/u
    )
    expect(
      cssRule(".sidebar-conversation-scroll::-webkit-scrollbar-thumb:hover")
    ).toMatch(
      /background:\s*color-mix\(\s*in srgb,\s*var\(--app-sidebar-muted\) 34%,\s*transparent\s*\);/u
    )
  })

  it("reveals a subtle top divider only after the recent task list scrolls", () => {
    const dividerRule = cssRule(".sidebar-conversation-region::before")

    expect(cssRule(".sidebar-conversation-region")).toContain(
      "position: relative;"
    )
    expect(dividerRule).toContain("position: absolute;")
    expect(dividerRule).toContain("height: 0.5px;")
    expect(dividerRule).toContain("background: var(--app-divider);")
    expect(dividerRule).toContain("opacity: 0;")
    expect(dividerRule).toContain("pointer-events: none;")
    expect(
      cssRule('.sidebar-conversation-region[data-scrolled="true"]::before')
    ).toContain("opacity: 1;")
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

  it("keeps recent tasks vertically comfortable at the configured UI size", () => {
    expect(sidebarStyles).toMatch(
      /(?:^|\n)\.sidebar-conversation-link\s*\{[^}]*min-height:\s*36px;[^}]*padding:\s*8px;/u
    )
  })

  it("softens the title color inside the wider task preview card", () => {
    expect(cssRule(".sidebar-conversation-preview-title")).toContain(
      "color: color-mix(in srgb, var(--app-text) 70%, var(--app-muted));"
    )
  })

  it("keeps a clear title gap before conversation actions across input modes", () => {
    expect(sidebarStyles).toMatch(
      /\.sidebar-conversation-item:hover\s+\.sidebar-conversation-link,[^}]*\.sidebar-conversation-item:focus-within\s+\.sidebar-conversation-link\s*\{[^}]*padding-right:\s*60px;/u
    )
    expect(sidebarStyles).toMatch(
      /@media \(hover:\s*none\)\s*\{[^}]*\.sidebar-conversation-link,[^}]*\.sidebar-conversation-item\[data-running="true"\]\s+\.sidebar-conversation-link,[^}]*\.sidebar-conversation-item\[data-warning="true"\]\s+\.sidebar-conversation-link\s*\{[^}]*padding-right:\s*60px;/u
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
  })
})
