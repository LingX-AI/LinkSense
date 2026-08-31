import { afterEach, describe, expect, it, vi } from "vitest"

import {
  desktopViewportQuery,
  shouldAutoFocusOnDesktop,
} from "@/lib/responsive"

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("responsive helpers", () => {
  it("allows autofocus only when the desktop media query matches", () => {
    const matchMedia = vi.fn((query: string) => ({
      matches: query === desktopViewportQuery,
    }))
    vi.stubGlobal("matchMedia", matchMedia)

    expect(shouldAutoFocusOnDesktop()).toBe(true)
    expect(matchMedia).toHaveBeenCalledWith(desktopViewportQuery)
  })

  it("does not autofocus when the viewport is mobile", () => {
    vi.stubGlobal(
      "matchMedia",
      vi.fn(() => ({ matches: false }))
    )

    expect(shouldAutoFocusOnDesktop()).toBe(false)
  })

  it("keeps desktop autofocus when media queries are unavailable", () => {
    vi.stubGlobal("matchMedia", undefined)

    expect(shouldAutoFocusOnDesktop()).toBe(true)
  })
})
