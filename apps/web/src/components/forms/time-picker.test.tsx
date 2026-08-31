import { useState } from "react"
import { render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"

import { TimePicker } from "@/components/forms/time-picker"

describe("TimePicker", () => {
  it("uses one combined shadcn time picker and emits a 24-hour HH:mm value", async () => {
    const interaction = userEvent.setup()

    function TestTimePicker() {
      const [value, setValue] = useState("09:00")
      return (
        <>
          <span id="time-label">Time</span>
          <TimePicker
            id="time"
            value={value}
            onValueChange={setValue}
            labelledBy="time-label"
            hourLabel="Hour"
            minuteLabel="Minute"
          />
          <output>{value}</output>
        </>
      )
    }

    const { container } = render(<TestTimePicker />)

    expect(container.querySelector('input[type="time"]')).toBeNull()
    expect(screen.getByRole("group", { name: "Time" })).toBeVisible()
    expect(
      screen.queryByRole("combobox", { name: "Hour" })
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole("combobox", { name: "Minute" })
    ).not.toBeInTheDocument()

    await interaction.click(screen.getByRole("button", { name: "Time 09:00" }))
    const content = document.querySelector('[data-slot="popover-content"]')
    expect(content).toHaveClass("w-[13.75rem]")
    expect(content?.firstElementChild).toHaveClass("grid-cols-2")
    const hourList = await screen.findByRole("listbox", { name: "Hour" })
    const minuteList = screen.getByRole("listbox", { name: "Minute" })
    const hour14 = within(hourList).getByRole("option", { name: "14" })
    Object.defineProperty(hourList, "clientHeight", {
      configurable: true,
      value: 100,
    })
    vi.spyOn(hourList, "getBoundingClientRect").mockReturnValue(
      rectangle(0, 100)
    )
    vi.spyOn(hour14, "getBoundingClientRect").mockReturnValue(
      rectangle(180, 20)
    )
    const scrollIntoView = vi.mocked(HTMLElement.prototype.scrollIntoView)
    scrollIntoView.mockClear()

    await interaction.click(hour14)

    expect(hourList.scrollTop).toBe(140)
    expect(scrollIntoView).not.toHaveBeenCalled()
    await interaction.click(
      within(minuteList).getByRole("option", { name: "35" })
    )

    expect(screen.getByRole("button", { name: "Time 14:35" })).toBeVisible()
  })
})

function rectangle(top: number, height: number): DOMRect {
  return {
    x: 0,
    y: top,
    width: 100,
    height,
    top,
    right: 100,
    bottom: top + height,
    left: 0,
    toJSON: () => ({}),
  }
}
