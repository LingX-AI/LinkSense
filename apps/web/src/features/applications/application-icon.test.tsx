import { render } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { applicationIconPresets } from "@linksense/shared"

import {
  ApplicationIconDisplay,
  ApplicationPresetIcon,
} from "@/features/applications/application-icon"
import {
  applicationIconPresetDefinitions,
  applicationIconPresetOptions,
} from "@/features/applications/application-icon-presets"

describe("application icons", () => {
  it("provides twenty distinct simple scene icons in the shared preset order", () => {
    expect(applicationIconPresetOptions.map((option) => option.value)).toEqual(
      applicationIconPresets
    )
    expect(
      new Set(applicationIconPresetOptions.map((option) => option.icon)).size
    ).toBe(20)
    expect(Object.keys(applicationIconPresetDefinitions)).toHaveLength(20)
  })

  it("renders preset choices and application fallbacks as multicolor artwork", () => {
    const { container, rerender } = render(
      <ApplicationPresetIcon preset="chart-column" />
    )
    const choice = container.querySelector(
      '[data-application-icon-preset="chart-column"]'
    )
    expect(choice).not.toBeNull()
    expect(choice?.querySelector("svg")).not.toBeNull()
    expect(
      new Set(
        Array.from(choice?.querySelectorAll("[fill]") ?? []).map((element) =>
          element.getAttribute("fill")
        )
      ).size
    ).toBeGreaterThanOrEqual(3)

    rerender(
      <ApplicationIconDisplay
        icon={{ type: "preset", preset: "shield-check" }}
      />
    )
    const fallback = container.querySelector(
      '[data-application-icon-preset="shield-check"]'
    )
    expect(fallback).not.toBeNull()
    expect(fallback?.querySelector("svg")).not.toBeNull()
    expect(
      new Set(
        Array.from(fallback?.querySelectorAll("[fill]") ?? []).map((element) =>
          element.getAttribute("fill")
        )
      ).size
    ).toBeGreaterThanOrEqual(3)
  })

  it("uses transparent icon surfaces with a subtle semantic border", () => {
    const { container, rerender } = render(
      <ApplicationIconDisplay
        icon={{ type: "preset", preset: "shield-check" }}
      />
    )
    const display = container.querySelector('[data-slot="avatar"]')
    const fallback = container.querySelector('[data-slot="avatar-fallback"]')

    expect(display).toHaveClass("bg-transparent", "after:border-border/60")
    expect(display).not.toHaveClass("bg-muted")
    expect(fallback).toHaveClass("bg-transparent")
    expect(fallback).not.toHaveClass("bg-muted")

    rerender(<ApplicationPresetIcon preset="chart-column" />)
    const preset = container.querySelector(
      '[data-application-icon-preset="chart-column"]'
    )
    expect(preset).toHaveClass("border", "border-border/60", "bg-transparent")
    expect(preset).not.toHaveClass("bg-muted")
  })
})
