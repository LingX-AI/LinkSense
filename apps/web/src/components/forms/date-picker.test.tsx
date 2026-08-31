import { useState } from "react"
import { cleanup, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import dayjs from "dayjs"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { I18nextProvider } from "react-i18next"

import { DatePicker } from "@/components/forms/date-picker"
import { FieldShell } from "@/components/forms/form-field"
import i18n from "@/i18n"

function DatePickerHarness({
  initialValue = "",
  clearable = true,
}: {
  initialValue?: string
  clearable?: boolean
}) {
  const [value, setValue] = useState(initialValue)
  return (
    <I18nextProvider i18n={i18n}>
      <FieldShell id="test-date" label="测试日期">
        <DatePicker
          id="test-date"
          value={value}
          min="2026-07-10"
          max="2026-07-12"
          placeholder="请选择"
          clearLabel="清除日期"
          clearable={clearable}
          onValueChange={setValue}
        />
      </FieldShell>
    </I18nextProvider>
  )
}

function findCalendarDay(value: string) {
  return Array.from(
    document.querySelectorAll<HTMLButtonElement>("button[data-day]")
  ).find(
    (button) =>
      button.dataset.day &&
      dayjs(button.dataset.day).format("YYYY-MM-DD") === value
  )
}

describe("DatePicker", () => {
  beforeEach(async () => {
    await i18n.changeLanguage("zh-CN")
  })

  afterEach(() => {
    cleanup()
  })

  it("selects, constrains, serializes, and clears dates through shadcn Calendar", async () => {
    const interaction = userEvent.setup()
    render(<DatePickerHarness />)

    await interaction.click(screen.getByLabelText("测试日期"))
    const validDay = await waitFor(() => {
      const button = findCalendarDay("2026-07-11")
      expect(button).toBeDefined()
      return button!
    })
    expect(findCalendarDay("2026-07-09")).toBeDisabled()
    expect(findCalendarDay("2026-07-13")).toBeDisabled()
    await interaction.click(validDay)

    expect(screen.getByLabelText("测试日期")).toHaveTextContent("2026年7月11日")
    await interaction.click(screen.getByRole("button", { name: "清除日期" }))
    expect(screen.getByLabelText("测试日期")).toHaveTextContent("请选择")
  })

  it("formats the selected date with the active English locale", async () => {
    await i18n.changeLanguage("en-US")
    render(<DatePickerHarness initialValue="2026-07-11" />)

    expect(screen.getByLabelText("测试日期")).toHaveTextContent("Jul 11, 2026")
  })

  it("keeps required date filters non-clearable when requested", () => {
    render(<DatePickerHarness initialValue="2026-07-11" clearable={false} />)

    expect(
      screen.queryByRole("button", { name: "清除日期" })
    ).not.toBeInTheDocument()
  })

  it("uses the same semantic background as the shared input", () => {
    render(<DatePickerHarness initialValue="2026-07-11" />)

    const trigger = screen.getByLabelText("测试日期")
    expect(trigger).toHaveClass("bg-input/50")
    expect(trigger).not.toHaveClass("bg-secondary")
  })

  it("keeps the date trigger and calendar days free of focus rings", async () => {
    const interaction = userEvent.setup()
    render(<DatePickerHarness />)

    const trigger = screen.getByLabelText("测试日期")
    expect(trigger).toHaveClass("focus-visible:ring-0")
    expect(trigger).not.toHaveClass("focus-visible:ring-3")

    await interaction.click(trigger)
    const day = await waitFor(() => {
      const button = findCalendarDay("2026-07-11")
      expect(button).toBeDefined()
      return button!
    })
    expect(day).toHaveClass("focus-visible:ring-0")
    expect(day).not.toHaveClass("focus-visible:ring-3")
  })
})
