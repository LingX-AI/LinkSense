import { cleanup, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"
import { RadioGroup, RadioGroupItem, RadioGroupOption } from "./radio-group"

afterEach(cleanup)

describe("shared radio choices", () => {
  it("uses compact bordered options and selects through the whole label or keyboard", async () => {
    const onValueChange = vi.fn()
    render(
      <RadioGroup
        aria-label="Choice"
        defaultValue="first"
        onValueChange={onValueChange}
      >
        <RadioGroupOption htmlFor="first">
          <RadioGroupItem id="first" value="first" />
          <span>First</span>
        </RadioGroupOption>
        <RadioGroupOption htmlFor="second">
          <RadioGroupItem id="second" value="second" />
          <span>Second</span>
        </RadioGroupOption>
      </RadioGroup>
    )
    const user = userEvent.setup()
    expect(screen.getByRole("radiogroup")).toHaveClass(
      "flex",
      "flex-wrap",
      "gap-2"
    )
    for (const radio of screen.getAllByRole("radio")) {
      expect(radio.closest('[data-slot="radio-group-option"]')).toHaveClass(
        "w-auto",
        "max-w-full",
        "rounded-xl",
        "border",
        "border-[var(--app-border)]",
        "has-[[aria-checked=true]]:bg-field"
      )
    }
    const second = screen.getByRole("radio", { name: "Second" })
    const label = second.closest("label")
    if (!label) throw new Error("Expected a clickable option label")
    await user.click(label)
    expect(second).toBeChecked()
    expect(screen.getByRole("radio", { name: "First" })).not.toBeChecked()
    expect(onValueChange).toHaveBeenLastCalledWith("second", expect.anything())
    await user.keyboard("{ArrowLeft}")
    expect(screen.getByRole("radio", { name: "First" })).toBeChecked()
  })

  it.each(["group", "option"])(
    "keeps a disabled %s inert when clicking its label",
    async (target) => {
      const onValueChange = vi.fn()
      render(
        <RadioGroup
          aria-label="Choice"
          defaultValue="first"
          disabled={target === "group"}
          onValueChange={onValueChange}
        >
          <RadioGroupOption htmlFor="first">
            <RadioGroupItem id="first" value="first" />
            First
          </RadioGroupOption>
          <RadioGroupOption htmlFor="second">
            <RadioGroupItem
              id="second"
              value="second"
              disabled={target === "option"}
            />
            Second
          </RadioGroupOption>
        </RadioGroup>
      )
      await userEvent.setup().click(screen.getByText("Second"))
      expect(screen.getByRole("radio", { name: "Second" })).toHaveAttribute(
        "aria-disabled",
        "true"
      )
      expect(screen.getByRole("radio", { name: "First" })).toBeChecked()
      expect(onValueChange).not.toHaveBeenCalled()
    }
  )
})
