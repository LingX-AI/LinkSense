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
  size = "default",
  disabled = false,
  valuePrefix,
  iconPosition,
}: {
  initialValue?: string
  clearable?: boolean
  size?: "default" | "sm"
  disabled?: boolean
  valuePrefix?: string
  iconPosition?: "start" | "end"
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
          valuePrefix={valuePrefix}
          iconPosition={iconPosition}
          clearLabel="清除日期"
          clearable={clearable}
          size={size}
          disabled={disabled}
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
  it("keeps a filter date's purpose visible and clears it with the icon at the start", async () => {
    const interaction = userEvent.setup()
    render(
      <DatePickerHarness
        initialValue="2026-07-11"
        valuePrefix="开始日期"
        iconPosition="start"
      />
    )
    const trigger = screen.getByLabelText("测试日期")
    expect(trigger).toHaveTextContent("开始日期")
    expect(trigger).toHaveTextContent("2026年7月11日")
    const clear = screen.getByRole("button", { name: "清除日期" })
    expect(clear).toHaveClass("right-3")
    await interaction.click(clear)
    expect(trigger).toHaveTextContent("请选择")
    expect(trigger).not.toHaveTextContent("2026年7月11日")
    expect(
      screen.queryByRole("button", { name: "清除日期" })
    ).not.toBeInTheDocument()
    expect(trigger).toHaveFocus()
  })
  it.each(["default", "sm"] as const)(
    "places a small clear action before the calendar icon without nesting buttons for %s",
    async (size) => {
      const interaction = userEvent.setup()
      render(<DatePickerHarness initialValue="2026-07-11" size={size} />)
      const trigger = screen.getByLabelText("测试日期")
      const clear = screen.getByRole("button", { name: "清除日期" })
      expect(trigger.parentElement).toHaveClass("relative")
      expect(clear).toHaveClass(
        "absolute",
        "inset-y-0",
        "right-9",
        "my-auto",
        "size-6",
        "active:not-aria-[haspopup]:translate-y-0"
      )
      expect(clear).not.toHaveClass("top-1/2", "-translate-y-1/2")
      expect(trigger).not.toContainElement(clear)
      expect(trigger.querySelector("span")).toHaveClass("pr-8")
      await interaction.click(clear)
      expect(trigger).toHaveTextContent("请选择")
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
      expect(
        screen.queryByRole("button", { name: "清除日期" })
      ).not.toBeInTheDocument()
      expect(trigger).toHaveFocus()
    }
  )

  it("supports clearing with the keyboard and prevents clearing a disabled picker", async () => {
    const interaction = userEvent.setup()
    const { rerender } = render(
      <DatePickerHarness initialValue="2026-07-11" disabled />
    )
    const clear = screen.getByRole("button", { name: "清除日期" })
    expect(clear).toBeDisabled()
    await interaction.click(clear)
    expect(screen.getByLabelText("测试日期")).toHaveTextContent("2026年7月11日")
    rerender(<DatePickerHarness initialValue="2026-07-11" />)
    screen.getByLabelText("测试日期").focus()
    await interaction.tab()
    expect(clear).toHaveFocus()
    await interaction.keyboard("{Enter}")
    expect(screen.getByLabelText("测试日期")).toHaveTextContent("请选择")
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
  })

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
    expect(trigger).toHaveClass("bg-field")
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
