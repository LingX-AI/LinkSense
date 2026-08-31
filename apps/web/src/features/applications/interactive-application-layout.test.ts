import applicationStyles from "@/index.css?raw"
import { describe, expect, it } from "vitest"

describe("interactive application split layout", () => {
  it("animates chat width while keeping drag updates immediate", () => {
    expect(applicationStyles).toMatch(
      /\.interactive-application-layout\s*\{[^}]*display:\s*grid;[^}]*grid-template-columns:\s*100% 0;[^}]*transition:\s*grid-template-columns 220ms cubic-bezier\(0\.22, 1, 0\.36, 1\);/u
    )
    expect(applicationStyles).toMatch(
      /\.interactive-application-layout\[data-chat-open="true"\]:not\([\s\S]*?\{[\s\S]*?grid-template-columns:[\s\S]*?--interactive-application-workspace-width/u
    )
    expect(applicationStyles).toMatch(
      /\.interactive-application-layout\[data-chat-resizing="true"\]\s*\{[^}]*transition:\s*none;/u
    )
  })

  it("disables the chat transition when reduced motion is requested", () => {
    expect(applicationStyles).toMatch(
      /@media \(prefers-reduced-motion: reduce\)\s*\{[\s\S]*?\.interactive-application-layout,[\s\S]*?\.interactive-application-chat-pane\s*\{[^}]*transition:\s*none;/u
    )
  })
})
