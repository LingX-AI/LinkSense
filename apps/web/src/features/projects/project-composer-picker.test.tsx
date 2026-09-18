import { cleanup, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import i18n from "@/i18n"
import { ProjectComposerPicker } from "./project-composer-picker"

const projectsQuery = vi.hoisted(() => ({
  data: [{ id: "daily", name: "日常", icon: "book", color: "blue" }],
  isPending: false,
  isFetching: false,
  isError: false,
}))

vi.mock("./project-api", () => ({ useProjects: () => projectsQuery }))

beforeEach(async () => {
  projectsQuery.isPending = false
  await i18n.changeLanguage("zh-CN")
})

afterEach(cleanup)

describe("project composer clear selection", () => {
  it("replaces the project icon with a clickable clear button while the pointer is over the picker", async () => {
    const interaction = userEvent.setup()
    const onChange = vi.fn()
    render(<ProjectComposerPicker value="daily" onChange={onChange} />)
    const trigger = screen.getByRole("combobox", { name: "项目" })
    const icon = trigger.querySelector("[data-project-icon]")
    const clear = screen.getByRole("button", { name: "取消项目选择" })

    expect(clear).toHaveClass("opacity-0", "pointer-events-none")
    await interaction.hover(trigger)
    expect(icon).toHaveClass("opacity-0")
    expect(clear).toHaveClass("opacity-100", "pointer-events-auto")

    await interaction.hover(clear)
    expect(clear).toHaveClass("opacity-100", "pointer-events-auto")
    await interaction.unhover(clear)
    expect(icon).not.toHaveClass("opacity-0")
    expect(clear).toHaveClass("opacity-0", "pointer-events-none")

    await interaction.hover(trigger)
    await interaction.click(clear)
    expect(onChange).toHaveBeenCalledExactlyOnceWith(null)
    expect(trigger).toHaveFocus()
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
  })

  it.each([
    { value: null, disabled: false, pending: false },
    { value: "daily", disabled: true, pending: false },
    { value: "daily", disabled: false, pending: true },
  ])(
    "does not hide the icon when clearing is unavailable: %j",
    async ({ value, disabled, pending }) => {
      projectsQuery.isPending = pending
      const interaction = userEvent.setup()
      const { container } = render(
        <ProjectComposerPicker
          value={value}
          disabled={disabled}
          onChange={vi.fn()}
        />
      )
      const picker = screen.getByRole("combobox", { name: "项目" }).parentElement
      if (!picker) throw new Error("Expected project picker")
      await interaction.hover(picker)
      expect(
        screen.queryByRole("button", { name: "取消项目选择" })
      ).not.toBeInTheDocument()
      expect(container.querySelector("[data-project-icon]")).not.toHaveClass(
        "opacity-0"
      )
    }
  )
})
