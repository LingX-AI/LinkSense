// @vitest-environment node

import capabilityPageStyles from "@/index.css?raw"
import { describe, expect, it } from "vitest"

describe("capability card layout", () => {
  it("uses transparent subtly bordered icon surfaces for plugins, skills, and MCP", () => {
    expect(capabilityPageStyles).toMatch(
      /\.capability-menu-icon,\s*\.capability-logo\s*\{[^}]*border:\s*1px solid\s*color-mix\(in srgb, var\(--app-divider\) 80%, transparent\);[^}]*background:\s*transparent;/u
    )
    expect(capabilityPageStyles).toMatch(
      /\.capability-library-logo,\s*\.capability-library-row \.capability-logo\s*\{[^}]*border:\s*1px solid\s*color-mix\(in srgb, var\(--app-divider\) 80%, transparent\);[^}]*background:\s*transparent;/u
    )
  })

  it("top-aligns the icon, content, and actions for variable-height cards", () => {
    expect(capabilityPageStyles).toMatch(
      /\.capability-library-row\s*\{[^}]*align-items:\s*flex-start;/u
    )
  })

  it("uses distinct semantic colors for enabled and disabled capabilities", () => {
    expect(capabilityPageStyles).toMatch(
      /\.capability-status-badge\s*\{[^}]*border:\s*0;/u
    )
    expect(capabilityPageStyles).toMatch(
      /\.capability-status-badge\s*\{[^}]*min-width:\s*28px;[^}]*height:\s*24px;/u
    )
    expect(capabilityPageStyles).toMatch(
      /\.capability-status-badge-icon-only\s*\{[^}]*padding-inline:\s*0;/u
    )
    expect(capabilityPageStyles).toMatch(
      /\.capability-status-badge svg\s*\{[^}]*width:\s*18px;[^}]*height:\s*18px;/u
    )
    expect(capabilityPageStyles).toMatch(
      /\.capability-status-badge-active\s*\{[^}]*background:\s*transparent;[^}]*color:\s*var\(--app-text\);/u
    )
    expect(capabilityPageStyles).toMatch(
      /\.capability-status-badge-inactive\s*\{[^}]*background:\s*color-mix\(in srgb, var\(--destructive\) 10%, var\(--app-canvas\)\);[^}]*color:\s*var\(--destructive\);/u
    )
  })

  it("uses a smaller built-in capability badge", () => {
    expect(capabilityPageStyles).toMatch(
      /\.capability-built-in-badge\s*\{[^}]*font-size:\s*var\(--app-font-10\);[^}]*line-height:\s*var\(--app-line-14\);/u
    )
  })

  it("keeps the three-dot action menu visible without requiring hover", () => {
    expect(capabilityPageStyles).toMatch(
      /\.capability-library-actions\s*\{[^}]*opacity:\s*1;/u
    )
    expect(capabilityPageStyles).not.toMatch(
      /\.capability-library-row:(?:hover|focus-within)[^{]*\{[^}]*\.capability-library-actions/u
    )
  })

  it("pins publication status above its card actions at the top right", () => {
    expect(capabilityPageStyles).toMatch(
      /\.capability-library-tail-status-top-right\s*\{[^}]*align-self:\s*stretch;[^}]*flex-direction:\s*column;[^}]*align-items:\s*flex-end;[^}]*justify-content:\s*space-between;/u
    )
  })

  it("pins the marketplace primary action at the bottom right", () => {
    expect(capabilityPageStyles).toMatch(
      /\.capability-library-tail-status-bottom-right\s*\{[^}]*align-self:\s*stretch;[^}]*flex-direction:\s*column;[^}]*align-items:\s*flex-end;[^}]*justify-content:\s*space-between;/u
    )
  })

  it("places the personal MCP management action at the right of its heading", () => {
    expect(capabilityPageStyles).toMatch(
      /\.capability-center-section-header,\s*\.capability-center-personal-actions\s*\{[^}]*display:\s*flex;[^}]*align-items:\s*center;[^}]*justify-content:\s*space-between;/u
    )
  })
})
