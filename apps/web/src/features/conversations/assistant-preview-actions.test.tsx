import { cleanup, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"
import { AssistantPreviewActions } from "@/features/conversations/assistant-preview-actions"
import { DropdownMenuItem } from "@/components/ui/dropdown-menu"

afterEach(cleanup)

describe("shared preview actions", () => {
  it("keeps the outside menu open until selection and restores focus on Escape", async () => {
    const user = userEvent.setup()
    const select = vi.fn()
    const { container } = render(
      <section className="group relative">
        <AssistantPreviewActions label="Preview actions">
          <DropdownMenuItem onClick={select}>Copy</DropdownMenuItem>
          <DropdownMenuItem disabled>Export</DropdownMenuItem>
        </AssistantPreviewActions>
      </section>
    )
    const trigger = screen.getByRole("button", { name: "Preview actions" })
    const actions = container.querySelector(".assistant-html-preview-actions")
    expect(actions).toHaveClass("absolute", "left-full", "top-2", "pl-2")
    expect(actions).not.toHaveClass("is-open")
    expect(screen.queryByRole("menu")).toBeNull()
    await user.tab()
    expect(trigger).toHaveFocus()
    await user.keyboard("{Enter}")
    expect(await screen.findByRole("menu")).toBeVisible()
    expect(actions).toHaveClass("is-open")
    expect(screen.getByRole("menuitem", { name: "Export" })).toHaveAttribute(
      "aria-disabled",
      "true"
    )
    await user.keyboard("{Escape}")
    expect(trigger).toHaveFocus()
    expect(actions).not.toHaveClass("is-open")
    await user.keyboard("{Enter}")
    await user.click(screen.getByRole("menuitem", { name: "Copy" }))
    expect(select).toHaveBeenCalledOnce()
    expect(actions).not.toHaveClass("is-open")
  })
})
