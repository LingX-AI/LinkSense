import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { Button } from "./button"
import { Card } from "./card"
import { cardSpotlightProps } from "./card-spotlight"

let motionEnabled = true

function showCards() {
  render(
    <>
      <Button {...cardSpotlightProps} onClick={onSelect}>
        <span>Task prompt</span>
      </Button>
      <Card {...cardSpotlightProps} role="article" aria-label="Application">
        <Button onClick={onDetails}>Details</Button>
        <Button onClick={onUse}>Use application</Button>
      </Card>
    </>
  )
  const prompt = screen.getByRole("button", { name: "Task prompt" })
  const application = screen.getByRole("article", { name: "Application" })
  for (const card of [prompt, application]) {
    vi.spyOn(card, "getBoundingClientRect").mockReturnValue(
      new DOMRect(100, 200, 400, 200)
    )
  }
  return { prompt, application }
}

const onSelect = vi.fn()
const onDetails = vi.fn()
const onUse = vi.fn()

beforeEach(() => {
  motionEnabled = true
  vi.stubGlobal("PointerEvent", MouseEvent)
  vi.spyOn(window, "matchMedia").mockImplementation((media) => ({
    matches: motionEnabled,
    media,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }))
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

describe("card spotlight decoration", () => {
  it("tracks the pointer within each card and clears on leave or cancellation", () => {
    const { prompt, application } = showCards()
    fireEvent.pointerMove(screen.getByText("Task prompt"), {
      clientX: 200,
      clientY: 350,
    })
    expect(prompt.style.getPropertyValue("--card-spotlight-x")).toBe("25%")
    expect(prompt.style.getPropertyValue("--card-spotlight-y")).toBe("75%")
    expect(prompt).toHaveAttribute("data-spotlight-active", "true")
    expect(application).not.toHaveAttribute("data-spotlight-active")

    fireEvent.pointerLeave(prompt)
    expect(prompt).not.toHaveAttribute("data-spotlight-active")
    fireEvent.pointerMove(application, { clientX: 550, clientY: 150 })
    expect(application.style.getPropertyValue("--card-spotlight-x")).toBe(
      "100%"
    )
    expect(application.style.getPropertyValue("--card-spotlight-y")).toBe("0%")
    fireEvent.pointerCancel(application)
    expect(application).not.toHaveAttribute("data-spotlight-active")
    expect(onSelect).not.toHaveBeenCalled()
    expect(onDetails).not.toHaveBeenCalled()
    expect(onUse).not.toHaveBeenCalled()
  })

  it("stops pointer decoration when motion or hover support is disabled", () => {
    const { prompt } = showCards()
    fireEvent.pointerMove(prompt, { clientX: 200, clientY: 350 })
    motionEnabled = false
    fireEvent.pointerMove(prompt, { clientX: 300, clientY: 300 })
    expect(prompt).not.toHaveAttribute("data-spotlight-active")
    expect(prompt.style.getPropertyValue("--card-spotlight-x")).toBe("25%")
    motionEnabled = true
    fireEvent.pointerMove(prompt, { clientX: 300, clientY: 300 })
    expect(prompt).toHaveAttribute("data-spotlight-active", "true")
    expect(prompt.style.getPropertyValue("--card-spotlight-x")).toBe("50%")
  })

  it("ignores touch pointers, disabled controls and surfaces without dimensions", () => {
    const { prompt, application } = showCards()
    const touch = new MouseEvent("pointermove", {
      bubbles: true,
      clientX: 200,
      clientY: 350,
    })
    Object.defineProperty(touch, "pointerType", { value: "touch" })
    fireEvent(prompt, touch)
    expect(prompt).not.toHaveAttribute("data-spotlight-active")
    application.setAttribute("aria-disabled", "true")
    fireEvent.pointerMove(application, { clientX: 200, clientY: 350 })
    expect(application).not.toHaveAttribute("data-spotlight-active")
    vi.mocked(prompt.getBoundingClientRect).mockReturnValue(new DOMRect())
    fireEvent.pointerMove(prompt, { clientX: 200, clientY: 350 })
    expect(prompt).not.toHaveAttribute("data-spotlight-active")
  })

  it("preserves the original tab order and invokes only the selected action", async () => {
    const { prompt } = showCards()
    const interaction = userEvent.setup()
    await interaction.tab()
    expect(prompt).toHaveFocus()
    await interaction.keyboard("{Enter}")
    await interaction.tab()
    expect(screen.getByRole("button", { name: "Details" })).toHaveFocus()
    await interaction.keyboard("{Enter}")
    await interaction.tab()
    expect(
      screen.getByRole("button", { name: "Use application" })
    ).toHaveFocus()
    await interaction.keyboard(" ")
    expect(onSelect).toHaveBeenCalledTimes(1)
    expect(onDetails).toHaveBeenCalledTimes(1)
    expect(onUse).toHaveBeenCalledTimes(1)
    expect(prompt).not.toHaveAttribute("data-spotlight-active")
  })
})
