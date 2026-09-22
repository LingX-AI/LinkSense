import { useState } from "react"
import { cleanup, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import dayjs from "dayjs"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { DateRangePicker, type DateRangeValue } from "./date-range-picker"
import i18n from "@/i18n"

function Harness({
  initialValue,
  onChange,
  disabled = false,
}: {
  initialValue?: DateRangeValue
  onChange: (value: DateRangeValue | undefined) => void
  disabled?: boolean
}) {
  const [value, setValue] = useState(initialValue)
  return (
    <DateRangePicker
      id="range"
      label={i18n.t("common.dateRange.label")}
      value={value}
      disabled={disabled}
      onValueChange={(next) => {
        setValue(next)
        onChange(next)
      }}
    />
  )
}

async function selectDay(
  interaction: ReturnType<typeof userEvent.setup>,
  value: string
) {
  const button = await waitFor(() => {
    const day = Array.from(
      document.querySelectorAll<HTMLButtonElement>("button[data-day]")
    ).find((item) => dayjs(item.dataset.day).format("YYYY-MM-DD") === value)
    expect(day).toBeDefined()
    return day!
  })
  await interaction.click(button)
}

describe("DateRangePicker", () => {
  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ["Date"] })
    vi.setSystemTime(new Date("2026-07-15T12:00:00Z"))
    await i18n.changeLanguage("zh-CN")
  })
  afterEach(() => {
    cleanup()
    vi.useRealTimers()
  })

  it.each(["zh-CN", "en-US"])(
    "commits a complete cross-month range in %s",
    async (language) => {
      await i18n.changeLanguage(language)
      const interaction = userEvent.setup()
      const onChange = vi.fn()
      render(<Harness onChange={onChange} />)
      const trigger = screen.getByLabelText(i18n.t("common.dateRange.label"))
      await interaction.click(trigger)
      await selectDay(interaction, "2026-07-20")
      expect(onChange).not.toHaveBeenCalled()
      expect(
        screen.getByText(
          i18n.t("common.dateRange.selectEnd", { date: "2026-07-20" })
        )
      ).toHaveAttribute("role", "status")
      expect(trigger).toHaveAttribute("aria-expanded", "true")
      await interaction.click(
        document.querySelector<HTMLButtonElement>(".rdp-button_next")!
      )
      await selectDay(interaction, "2026-08-10")
      expect(onChange).toHaveBeenCalledExactlyOnceWith({
        from: "2026-07-20",
        to: "2026-08-10",
      })
      expect(trigger).toHaveTextContent(
        i18n.t("common.dateRange.value", {
          from: "2026-07-20",
          to: "2026-08-10",
        })
      )
      await waitFor(() =>
        expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
      )
    }
  )

  it.each([
    ["2026-07-20", "2026-07-20", "2026-07-20", "2026-07-20"],
    ["2026-07-20", "2026-07-10", "2026-07-10", "2026-07-20"],
  ])("normalizes selection from %s to %s", async (first, second, from, to) => {
    const interaction = userEvent.setup()
    const onChange = vi.fn()
    render(<Harness onChange={onChange} />)
    await interaction.click(screen.getByLabelText("日期范围"))
    await selectDay(interaction, first)
    await selectDay(interaction, second)
    expect(onChange).toHaveBeenCalledExactlyOnceWith({ from, to })
  })

  it("discards an incomplete replacement on dismissal and starts fresh when reopened", async () => {
    const interaction = userEvent.setup()
    const onChange = vi.fn()
    render(
      <Harness
        initialValue={{ from: "2026-07-01", to: "2026-07-05" }}
        onChange={onChange}
      />
    )
    const trigger = screen.getByLabelText("日期范围")
    await interaction.click(trigger)
    await selectDay(interaction, "2026-07-10")
    await interaction.keyboard("{Escape}")
    expect(onChange).not.toHaveBeenCalled()
    expect(trigger).toHaveTextContent("2026-07-01 至 2026-07-05")
    await interaction.click(trigger)
    await selectDay(interaction, "2026-07-20")
    expect(onChange).not.toHaveBeenCalled()
    await selectDay(interaction, "2026-07-25")
    expect(onChange).toHaveBeenCalledExactlyOnceWith({
      from: "2026-07-20",
      to: "2026-07-25",
    })
  })

  it("prevents disabled changes and clears both dates by keyboard with focus restored", async () => {
    const interaction = userEvent.setup()
    const onChange = vi.fn()
    const initialValue = { from: "2026-07-01", to: "2026-07-05" }
    const { rerender } = render(
      <Harness initialValue={initialValue} onChange={onChange} disabled />
    )
    expect(screen.getByLabelText("日期范围")).toBeDisabled()
    expect(screen.getByLabelText("清除日期范围")).toBeDisabled()
    await interaction.click(screen.getByLabelText("清除日期范围"))
    expect(onChange).not.toHaveBeenCalled()
    rerender(<Harness initialValue={initialValue} onChange={onChange} />)
    const trigger = screen.getByLabelText("日期范围")
    trigger.focus()
    await interaction.tab()
    expect(screen.getByLabelText("清除日期范围")).toHaveFocus()
    await interaction.keyboard("{Enter}")
    expect(onChange).toHaveBeenCalledExactlyOnceWith(undefined)
    expect(trigger).toHaveTextContent("日期范围")
    expect(trigger).toHaveFocus()
    expect(screen.queryByLabelText("清除日期范围")).not.toBeInTheDocument()
  })
})
