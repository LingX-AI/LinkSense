import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import welcomeOrb from "@/assets/home/welcome-orb.svg"
import i18n, { supportedLanguages } from "@/i18n"
import { WelcomeOrb } from "./welcome-orb"

const preference = vi.hoisted(() => ({ reduced: false }))
vi.mock("framer-motion", async (importOriginal) => ({
  ...(await importOriginal<typeof import("framer-motion")>()),
  useReducedMotion: () => preference.reduced,
}))

function renderOrb() {
  const view = render(<WelcomeOrb />)
  const root = view.container.querySelector<HTMLDivElement>(
    ".conversation-welcome-icon"
  )
  if (!root) throw new Error("Expected the original design orb")
  vi.spyOn(root, "getBoundingClientRect").mockReturnValue(
    new DOMRect(0, 0, 176, 176)
  )
  return { ...view, root }
}

beforeEach(() => {
  preference.reduced = false
  vi.stubGlobal("PointerEvent", MouseEvent)
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe("original design orb interactions", () => {
  it("keeps the original SVG, reveals nearby connections on hover, and settles on leave", () => {
    const { root, container } = renderOrb()
    const image = container.querySelector("img")
    expect(image).toHaveAttribute("src", welcomeOrb)
    expect(image).toHaveAttribute("width", "176")
    expect(image).toHaveAttribute("height", "176")
    expect(container.querySelector("canvas")).toBeNull()
    fireEvent.pointerOver(root)
    fireEvent.pointerMove(root, { clientX: 100, clientY: 85 })
    expect(root).toHaveAttribute("data-active", "true")
    expect(container.querySelectorAll("line")).toHaveLength(4)
    expect(image).toHaveAttribute("src", welcomeOrb)
    fireEvent.pointerOut(root)
    expect(root).toHaveAttribute("data-active", "false")
  })

  it.each(supportedLanguages)(
    "supports keyboard pause and resume in %s",
    async (language) => {
      await i18n.changeLanguage(language)
      const { root } = renderOrb()
      const interaction = userEvent.setup()
      screen
        .getByRole("button", { name: i18n.t("workspaceHome.pauseMotion") })
        .focus()
      await interaction.keyboard(" ")
      expect(root).toHaveAttribute("data-paused", "true")
      expect(
        screen.getByRole("button", {
          name: i18n.t("workspaceHome.resumeMotion"),
        })
      ).toHaveFocus()
      fireEvent.pointerOver(root)
      fireEvent.pointerMove(root, { clientX: 100, clientY: 85 })
      expect(root).toHaveAttribute("data-active", "false")
      await interaction.keyboard(" ")
      expect(root).toHaveAttribute("data-paused", "false")
    }
  )

  it("stays static for reduced motion and preserves pause across preference changes", () => {
    preference.reduced = true
    const { root, container, rerender } = renderOrb()
    fireEvent.pointerOver(root)
    fireEvent.pointerMove(root, { clientX: 100, clientY: 85 })
    expect(root).toHaveAttribute("data-active", "false")
    expect(container.querySelectorAll("line")).toHaveLength(0)
    preference.reduced = false
    rerender(<WelcomeOrb />)
    fireEvent.click(
      screen.getByRole("button", { name: i18n.t("workspaceHome.pauseMotion") })
    )
    preference.reduced = true
    rerender(<WelcomeOrb />)
    preference.reduced = false
    rerender(<WelcomeOrb />)
    expect(root).toHaveAttribute("data-paused", "true")
    fireEvent.click(
      screen.getByRole("button", { name: i18n.t("workspaceHome.resumeMotion") })
    )
    expect(root).toHaveAttribute("data-paused", "false")
  })
})
