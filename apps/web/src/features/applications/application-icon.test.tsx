import { act, cleanup, render } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { applicationIconPresets } from "@linksense/shared"
import { Button } from "@/components/ui/button"
import { defaultApplicationIcon } from "./application-icon-default"

import {
  ApplicationIconDisplay,
  ApplicationPresetIcon,
} from "@/features/applications/application-icon"
import {
  applicationIconPresetDefinitions,
  applicationIconPresetOptions,
} from "@/features/applications/application-icon-presets"

describe("application icons", () => {
  it("keeps enlarged application artwork inside buttons instead of inheriting action-icon sizing", () => {
    const { container } = render(
      <Button aria-label="Edit application icon">
        <ApplicationIconDisplay
          icon={defaultApplicationIcon}
          className="size-12"
        />
      </Button>
    )
    expect(
      container.querySelector('[data-application-icon-preset="bot"] svg')
    ).toHaveClass("size-[85%]")
  })
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

describe("custom application icon refresh", () => {
  const requests: ControlledImage[] = []
  class ControlledImage {
    src = ""
    complete = false
    naturalWidth = 0
    onload: (() => void) | null = null
    onerror: (() => void) | null = null
    constructor() {
      requests.push(this)
    }
  }

  const signedUrl = (signature: string, path = "icon-a", query = "") =>
    `https://icons.example.test/${path}?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Date=${signature}&X-Amz-Expires=300&X-Amz-Signature=${signature}${query}`
  const display = (url: string) => (
    <ApplicationIconDisplay
      icon={{ type: "custom", url, fallback_preset: "bot" }}
    />
  )
  function finish(index: number, result: "load" | "error" = "load") {
    const request = requests[index]
    if (!request) throw new Error(`Missing image request ${index}`)
    act(() => {
      if (result === "load") request.onload?.()
      else request.onerror?.()
    })
  }

  beforeEach(() => {
    requests.length = 0
    vi.stubGlobal("Image", ControlledImage)
  })
  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  it("keeps the loaded image mounted without requests or fallback flashes when polling renews its signature", () => {
    const { container, rerender } = render(display(signedUrl("first")))
    expect(
      container.querySelector('[data-slot="avatar-fallback"]')
    ).not.toBeNull()
    finish(0)
    const image = container.querySelector("img")
    expect(image).toHaveAttribute("src", signedUrl("first"))

    for (const signature of ["second", "third", "fourth"]) {
      rerender(display(signedUrl(signature)))
      expect(container.querySelector("img")).toBe(image)
      expect(
        container.querySelector('[data-slot="avatar-fallback"]')
      ).toBeNull()
    }
    expect(requests).toHaveLength(1)
  })

  it("does not restart an in-flight image load at each poll", () => {
    const { container, rerender } = render(display(signedUrl("first")))
    rerender(display(signedUrl("second")))
    finish(0)
    expect(requests).toHaveLength(1)
    expect(container.querySelector("img")).toHaveAttribute(
      "src",
      signedUrl("first")
    )
  })

  it("retries a failed or expired URL using the newest signed URL", () => {
    const { container, rerender } = render(display(signedUrl("expired")))
    finish(0, "error")
    expect(container.querySelector("img")).toBeNull()
    rerender(display(signedUrl("fresh")))
    expect(requests).toHaveLength(2)
    expect(requests[1]?.src).toBe(signedUrl("fresh"))
    finish(1)
    expect(container.querySelector("img")).toHaveAttribute(
      "src",
      signedUrl("fresh")
    )
  })

  it("uses the latest URL if a pending load fails after polling has renewed it", () => {
    const { container, rerender } = render(display(signedUrl("first")))
    rerender(display(signedUrl("latest")))
    finish(0, "error")
    expect(requests[1]?.src).toBe(signedUrl("latest"))
    finish(1)
    expect(container.querySelector("img")).toHaveAttribute(
      "src",
      signedUrl("latest")
    )
  })

  it("uses the current signature when the icon is mounted again", () => {
    const first = render(display(signedUrl("expired")))
    finish(0)
    first.unmount()
    const next = render(display(signedUrl("fresh")))
    expect(requests[1]?.src).toBe(signedUrl("fresh"))
    finish(1)
    expect(next.container.querySelector("img")).toHaveAttribute(
      "src",
      signedUrl("fresh")
    )
  })

  it("does not discard resource query parameters on unsigned URLs", () => {
    const { container, rerender } = render(
      display("https://icons.example.test/icon?v=1")
    )
    finish(0)
    rerender(display("https://icons.example.test/icon?v=2"))
    expect(requests[1]?.src).toBe("https://icons.example.test/icon?v=2")
    finish(1)
    expect(container.querySelector("img")).toHaveAttribute(
      "src",
      "https://icons.example.test/icon?v=2"
    )
  })

  it.each([
    signedUrl("second", "icon-b"),
    signedUrl("second", "icon-a", "&versionId=2"),
    signedUrl("second").replace("icons.example.test", "other.example.test"),
  ])(
    "loads a different icon resource instead of retaining the previous image: %s",
    (nextUrl) => {
      const { container, rerender } = render(display(signedUrl("first")))
      finish(0)
      rerender(display(nextUrl))
      expect(container.querySelector("img")).toBeNull()
      expect(requests[1]?.src).toBe(nextUrl)
      finish(1)
      expect(container.querySelector("img")).toHaveAttribute("src", nextUrl)
    }
  )

  it("ignores completion of a replaced icon and immediately supports switching to a preset", () => {
    const { container, rerender } = render(display(signedUrl("first")))
    const nextUrl = signedUrl("second", "icon-b")
    rerender(display(nextUrl))
    finish(0)
    expect(container.querySelector("img")).toBeNull()
    finish(1)
    expect(container.querySelector("img")).toHaveAttribute("src", nextUrl)
    rerender(
      <ApplicationIconDisplay icon={{ type: "preset", preset: "code-xml" }} />
    )
    expect(container.querySelector("img")).toBeNull()
    expect(
      container.querySelector('[data-application-icon-preset="code-xml"]')
    ).not.toBeNull()
  })
})
