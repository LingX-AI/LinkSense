import { cleanup, render, screen } from "@testing-library/react"
import { SparklesIcon } from "lucide-react"
import { afterEach, describe, expect, it } from "vitest"

import { Marker, MarkerContent, MarkerIcon } from "@/components/ui/marker"

describe("Marker", () => {
  afterEach(() => cleanup())

  it("composes the Base UI marker slots and variant state", () => {
    render(
      <Marker variant="border" role="status" aria-busy="true">
        <MarkerIcon>
          <SparklesIcon />
        </MarkerIcon>
        <MarkerContent className="shimmer">正在处理</MarkerContent>
      </Marker>
    )

    const marker = screen.getByRole("status")
    const content = screen.getByText("正在处理")
    const icon = marker.querySelector('[data-slot="marker-icon"]')

    expect(marker).toHaveAttribute("data-slot", "marker")
    expect(marker).toHaveAttribute("data-variant", "border")
    expect(marker).toHaveAttribute("aria-busy", "true")
    expect(icon).toHaveAttribute("aria-hidden", "true")
    expect(content).toHaveAttribute("data-slot", "marker-content")
    expect(content).toHaveClass("shimmer")
  })
})
