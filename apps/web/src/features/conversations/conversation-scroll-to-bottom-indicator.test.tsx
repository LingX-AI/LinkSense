import { render } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import { ConversationScrollToBottomIndicator } from "@/features/conversations/conversation-scroll-to-bottom-indicator"
import appStyles from "@/index.css?raw"

describe("ConversationScrollToBottomIndicator", () => {
  it("shows three animated dots while the current task is running", () => {
    const { container } = render(
      <ConversationScrollToBottomIndicator running />
    )
    const indicator = container.querySelector(
      '[data-slot="conversation-running-indicator"]'
    )
    const dots = container.querySelectorAll(
      '[data-slot="conversation-running-dot"]'
    )

    expect(indicator).toHaveAttribute("aria-hidden", "true")
    expect(container.querySelector(".lucide-arrow-down")).toBeNull()
    expect(dots).toHaveLength(3)
    dots.forEach((dot) => {
      expect(dot).toHaveClass(
        "conversation-running-dot",
        "size-1",
        "bg-muted-foreground/90"
      )
      expect(dot).not.toHaveClass("size-0.875")
    })
  })

  it("uses a larger vertical offset and stops moving when reduced motion is requested", () => {
    expect(appStyles).toMatch(
      /@keyframes conversation-running-dot-bounce\s*\{[\s\S]*?translateY\(-2px\)[\s\S]*?translateY\(1px\)[\s\S]*?\}/u
    )
    expect(appStyles).toMatch(
      /@media \(prefers-reduced-motion: reduce\)\s*\{\s*\.conversation-running-dot\s*\{\s*animation: none;/u
    )
  })

  it("shows the down arrow after the current task finishes", () => {
    const { container } = render(
      <ConversationScrollToBottomIndicator running={false} />
    )

    expect(container.querySelector(".lucide-arrow-down")).toHaveAttribute(
      "aria-hidden",
      "true"
    )
    expect(
      container.querySelector('[data-slot="conversation-running-indicator"]')
    ).toBeNull()
  })
})
