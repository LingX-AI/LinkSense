import { useState } from "react"
import {
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it } from "vitest"

import i18n from "@/i18n"
import { KnowledgeSourceSyncScheduleFields } from "@/features/knowledge-bases/knowledge-source-schedule-fields"
import {
  createDefaultKnowledgeSourceSyncScheduleDraft,
  knowledgeSourceSyncScheduleFromDraft,
  type KnowledgeSourceSyncScheduleDraft,
} from "@/features/knowledge-bases/knowledge-source-schedule"

describe("KnowledgeSourceSyncScheduleFields", () => {
  afterEach(cleanup)

  beforeEach(async () => {
    await i18n.changeLanguage("zh-CN")
  })

  function TestForm({
    initial = createDefaultKnowledgeSourceSyncScheduleDraft(),
  }: {
    initial?: KnowledgeSourceSyncScheduleDraft
  }) {
    const [value, setValue] =
      useState<KnowledgeSourceSyncScheduleDraft>(initial)
    return (
      <>
        <KnowledgeSourceSyncScheduleFields
          value={value}
          onValueChange={setValue}
        />
        <output>
          {JSON.stringify(knowledgeSourceSyncScheduleFromDraft(value))}
        </output>
      </>
    )
  }

  it("selects one weekly day and a shared time", async () => {
    const interaction = userEvent.setup()

    render(<TestForm />)

    const frequency = screen.getByRole("combobox", { name: "同步频率" })
    expect(
      document.querySelector(
        "label[for='knowledge-base-sync-frequency'] span.text-destructive[aria-hidden='true']"
      )
    ).toHaveTextContent("*")
    expect(
      document.querySelector(
        "#knowledge-base-sync-time-label span.text-destructive[aria-hidden='true']"
      )
    ).toHaveTextContent("*")
    expect(frequency).toHaveTextContent("每天")
    await interaction.click(frequency)
    await interaction.click(await screen.findByRole("option", { name: "每周" }))
    await waitFor(() =>
      expect(frequency).toHaveAttribute("aria-expanded", "false")
    )
    await waitFor(() =>
      expect(
        screen.queryByRole("option", { name: "每周" })
      ).not.toBeInTheDocument()
    )

    const weekday = screen.getByRole("combobox", { name: "星期" })
    expect(
      document.querySelector(
        "label[for='knowledge-base-sync-weekday'] span.text-destructive[aria-hidden='true']"
      )
    ).toHaveTextContent("*")
    expect(weekday).toHaveTextContent("周一")
    await interaction.click(weekday)
    await interaction.click(await screen.findByRole("option", { name: "周三" }))
    await waitFor(() =>
      expect(weekday).toHaveAttribute("aria-expanded", "false")
    )
    expect(weekday).toHaveTextContent("周三")

    await interaction.click(screen.getByRole("button", { name: "时间 09:00" }))
    await interaction.click(
      within(screen.getByRole("listbox", { name: "小时" })).getByRole(
        "option",
        { name: "14" }
      )
    )
    await interaction.click(
      within(screen.getByRole("listbox", { name: "分钟" })).getByRole(
        "option",
        { name: "35" }
      )
    )
    expect(screen.getByRole("status")).toHaveTextContent('"frequency":"weekly"')
    expect(screen.getByRole("status")).toHaveTextContent('"weekday":3')
    expect(screen.getByRole("status")).toHaveTextContent('"time":"14:35"')
  })

  it("selects a monthly date and explains missing calendar days", async () => {
    const interaction = userEvent.setup()
    render(
      <TestForm
        initial={{
          ...createDefaultKnowledgeSourceSyncScheduleDraft(),
          frequency: "monthly",
        }}
      />
    )

    const day = screen.getByRole("combobox", { name: "日期" })
    expect(
      document.querySelector(
        "label[for='knowledge-base-sync-day-of-month'] span.text-destructive[aria-hidden='true']"
      )
    ).toHaveTextContent("*")
    await interaction.click(day)
    await interaction.click(
      await screen.findByRole("option", { name: "31 日" })
    )

    expect(screen.getByRole("status")).toHaveTextContent(
      '"frequency":"monthly"'
    )
    expect(screen.getByRole("status")).toHaveTextContent('"day_of_month":31')
    expect(screen.getByText("没有该日期的月份会被跳过。")).toBeVisible()
  })
})
