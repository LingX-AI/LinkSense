import { useState } from "react"
import { cleanup, render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it } from "vitest"

import { DateTimePicker } from "@/components/forms/date-time-picker"
import { FieldShell } from "@/components/forms/form-field"
import i18n from "@/i18n"

describe("DateTimePicker", () => {
  beforeEach(async () => {
    await i18n.changeLanguage("zh-CN")
  })

  afterEach(cleanup)

  it("combines shadcn date and time controls without a native datetime input", async () => {
    const interaction = userEvent.setup()

    function Harness() {
      const [value, setValue] = useState("2026-08-05T09:00")
      return (
        <FieldShell id="maintenance-at" label="维护时间">
          <DateTimePicker
            id="maintenance-at"
            value={value}
            onValueChange={setValue}
            label="维护时间"
            datePlaceholder="选择日期"
            clearDateLabel="清除日期"
            hourLabel="小时"
            minuteLabel="分钟"
          />
          <output>{value}</output>
        </FieldShell>
      )
    }

    const { container } = render(<Harness />)

    expect(container.querySelector('input[type="datetime-local"]')).toBeNull()
    expect(document.getElementById("maintenance-at")).toHaveTextContent(
      "2026年8月5日"
    )
    await interaction.click(
      screen.getByRole("button", { name: "维护时间 09:00" })
    )
    const hourList = await screen.findByRole("listbox", { name: "小时" })
    await interaction.click(within(hourList).getByRole("option", { name: "14" }))
    expect(screen.getByText("2026-08-05T14:00")).toBeVisible()
  })

  it("disables times that are not later than an exclusive minimum", async () => {
    const interaction = userEvent.setup()

    render(
      <FieldShell id="maintenance-end-at" label="结束时间">
        <DateTimePicker
          id="maintenance-end-at"
          value="2026-08-05T14:31"
          min="2026-08-05T14:30"
          minExclusive
          onValueChange={() => undefined}
          label="结束时间"
          datePlaceholder="选择日期"
          clearDateLabel="清除日期"
          hourLabel="结束时间 · 小时"
          minuteLabel="结束时间 · 分钟"
        />
      </FieldShell>
    )

    await interaction.click(
      screen.getByRole("button", { name: "结束时间 14:31" })
    )
    const hourList = await screen.findByRole("listbox", {
      name: "结束时间 · 小时",
    })
    const minuteList = screen.getByRole("listbox", {
      name: "结束时间 · 分钟",
    })
    expect(
      within(hourList).getByRole("option", { name: "13" })
    ).toHaveAttribute("aria-disabled", "true")
    expect(
      within(hourList).getByRole("option", { name: "14" })
    ).not.toHaveAttribute("aria-disabled", "true")
    expect(
      within(minuteList).getByRole("option", { name: "30" })
    ).toHaveAttribute("aria-disabled", "true")
    expect(
      within(minuteList).getByRole("option", { name: "31" })
    ).not.toHaveAttribute("aria-disabled", "true")
  })
})
