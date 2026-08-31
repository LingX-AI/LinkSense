import pendingRequestStyles from "@/index.css?raw"
import { describe, expect, it } from "vitest"

describe("pending request action layout", () => {
  it("keeps the guide action compact and visually light", () => {
    const guideRule = pendingRequestStyles.match(
      /\.pending-request-context-guide\s*\{([^}]*)\}/u
    )?.[1]
    const guideHoverRule = pendingRequestStyles.match(
      /\.pending-request-context-guide:hover,\s*\.pending-request-context-guide:focus-visible\s*\{([^}]*)\}/u
    )?.[1]
    const guideIconRule = pendingRequestStyles.match(
      /\.pending-request-context-guide\s*>\s*svg\s*\{([^}]*)\}/u
    )?.[1]

    expect(guideRule).toMatch(/height:\s*24px;/u)
    expect(guideRule).toMatch(/min-height:\s*24px;/u)
    expect(guideRule).toMatch(/padding-inline:\s*9px;/u)
    expect(guideRule).toMatch(/font-size:\s*var\(--app-font-12\);/u)
    expect(guideRule).toMatch(/line-height:\s*var\(--app-line-16\);/u)
    expect(guideRule).toMatch(
      /background:\s*color-mix\(in srgb,\s*var\(--secondary\) 58%,\s*var\(--background\)\);/u
    )
    expect(guideHoverRule).toMatch(/background:\s*var\(--app-hover\);/u)
    expect(guideIconRule).toMatch(/width:\s*13px;/u)
    expect(guideIconRule).toMatch(/height:\s*13px;/u)
  })

  it("matches queued and guide action typography", () => {
    const queuedRules = Array.from(
      pendingRequestStyles.matchAll(
        /(?:^|\n)\.pending-request-context-mode\s*\{([^}]*)\}/gu
      )
    )
    const queuedRule = queuedRules.at(-1)?.[1]

    expect(queuedRule).toMatch(/font-size:\s*var\(--app-font-12\);/u)
    expect(queuedRule).toMatch(/line-height:\s*var\(--app-line-16\);/u)
  })

  it("presents the leading icon as a vertical drag handle", () => {
    const handleRule = pendingRequestStyles.match(
      /\.pending-request-drag-handle\s*\{([^}]*)\}/u
    )?.[1]
    const activeRule = pendingRequestStyles.match(
      /\.pending-request-drag-handle:active\s*\{([^}]*)\}/u
    )?.[1]

    expect(handleRule).toMatch(/cursor:\s*grab;/u)
    expect(handleRule).toMatch(/touch-action:\s*none;/u)
    expect(activeRule).toMatch(/cursor:\s*grabbing;/u)
  })
})
