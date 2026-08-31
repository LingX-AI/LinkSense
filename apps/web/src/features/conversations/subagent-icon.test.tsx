import { render } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import { SubAgentIcon } from "@/features/conversations/subagent-icon"

describe("SubAgentIcon", () => {
  it("uses ten distinct SVG icons before cycling through the set again", () => {
    const { container } = render(
      <>
        {Array.from({ length: 11 }, (_, index) => (
          <SubAgentIcon key={index} ordinal={index + 1} />
        ))}
      </>
    )
    const sources = Array.from(
      container.querySelectorAll('[data-slot="subagent-icon"]'),
      (icon) => icon.getAttribute("src")
    )

    expect(new Set(sources.slice(0, 10))).toHaveLength(10)
    expect(sources[10]).toBe(sources[0])
  })

  it("renders the selected SVG as a decorative image", () => {
    const { container } = render(<SubAgentIcon ordinal={7} />)
    const icon = container.querySelector('[data-slot="subagent-icon"]')

    expect(icon).toHaveAttribute("alt", "")
    expect(icon).toHaveAttribute("aria-hidden", "true")
    expect(icon).toHaveAttribute("src")
  })
})
