import { fireEvent, render } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import mcpIconUrl from "@/assets/capabilities/mcp-icon.svg"
import pluginIconUrl from "@/assets/capabilities/plugin-icon.png"
import skillIconUrl from "@/assets/capabilities/skill-icon.png"
import {
  CapabilityIcon,
  McpIcon,
} from "@/components/capabilities/capability-icon"

function renderIcon(
  props: React.ComponentProps<typeof CapabilityIcon>
): HTMLImageElement {
  const { container } = render(<CapabilityIcon {...props} />)
  const icon = container.querySelector("img")
  if (!(icon instanceof HTMLImageElement)) {
    throw new Error("Expected CapabilityIcon to render an image")
  }
  return icon
}

describe("CapabilityIcon", () => {
  it("uses the bundled colorful image for MCP identity", () => {
    const { container } = render(<McpIcon />)
    const icon = container.querySelector("img")

    expect(icon).toHaveAttribute("src", mcpIconUrl)
    expect(icon).toHaveAttribute("data-default-capability-icon", "mcp")
    expect(icon).toHaveAttribute("aria-hidden", "true")
  })

  it("uses the plugin image when a plugin has no custom logo", () => {
    const icon = renderIcon({ type: "plugin" })

    expect(icon).toHaveAttribute("src", pluginIconUrl)
    expect(icon).toHaveAttribute("data-default-capability-icon", "plugin")
    expect(icon).toHaveAttribute("aria-hidden", "true")
    expect(icon).toHaveAttribute("draggable", "false")
  })

  it("uses the skill image when a skill has no custom logo", () => {
    const icon = renderIcon({ type: "skill" })

    expect(icon).toHaveAttribute("src", skillIconUrl)
    expect(icon).toHaveAttribute("data-default-capability-icon", "skill")
  })

  it("keeps a capability custom logo ahead of the default image", () => {
    const icon = renderIcon({
      type: "plugin",
      logoUrl: "https://example.com/logo.png",
    })

    expect(icon).toHaveAttribute("src", "https://example.com/logo.png")
    expect(icon).not.toHaveAttribute("data-default-capability-icon")
  })

  it("falls back to the bundled plugin image when a custom logo expires", () => {
    const icon = renderIcon({
      type: "plugin",
      logoUrl: "https://example.com/expired-logo.png",
    })

    fireEvent.error(icon)

    expect(icon).toHaveAttribute("src", pluginIconUrl)
    expect(icon).toHaveAttribute("data-default-capability-icon", "plugin")
  })

  it("retries a refreshed custom logo after the previous URL failed", () => {
    const { container, rerender } = render(
      <CapabilityIcon
        type="skill"
        logoUrl="https://example.com/expired-logo.png"
      />
    )
    const icon = container.querySelector("img")
    if (!(icon instanceof HTMLImageElement)) {
      throw new Error("Expected CapabilityIcon to render an image")
    }
    fireEvent.error(icon)
    expect(icon).toHaveAttribute("src", skillIconUrl)

    rerender(
      <CapabilityIcon
        type="skill"
        logoUrl="https://example.com/refreshed-logo.png"
      />
    )

    expect(icon).toHaveAttribute(
      "src",
      "https://example.com/refreshed-logo.png"
    )
  })
})
