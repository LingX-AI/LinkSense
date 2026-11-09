import { cleanup, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it } from "vitest"

import {
  ActionTooltipContent,
  Tooltip,
  TooltipTrigger,
} from "@/components/ui/tooltip"

describe("ActionTooltipContent", () => {
  afterEach(cleanup)

  it("uses the design-system name bubble without an arrow", async () => {
    render(
      <Tooltip defaultOpen>
        <TooltipTrigger>Action</TooltipTrigger>
        <ActionTooltipContent>Action description</ActionTooltipContent>
      </Tooltip>
    )

    const tooltip = await screen.findByRole("tooltip")
    expect(tooltip).toHaveClass(
      "rounded-md",
      "border",
      "border-[var(--app-border)]",
      "bg-[var(--app-popover)]",
      "px-2",
      "py-1.5",
      "text-xs",
      "leading-[var(--app-line-18)]",
      "font-normal",
      "text-[var(--app-text)]",
      "shadow-[var(--app-dialog-shadow)]"
    )
    expect(tooltip.childElementCount).toBe(0)
  })

  it("keeps disabled-action guidance keyboard accessible and dismissible", async () => {
    const user = userEvent.setup()
    render(
      <Tooltip>
        <TooltipTrigger
          render={<span role="group" tabIndex={0} aria-label="Unavailable" />}
        >
          <button disabled>Action</button>
        </TooltipTrigger>
        <ActionTooltipContent>Action unavailable</ActionTooltipContent>
      </Tooltip>
    )

    await user.tab()
    expect(screen.getByRole("group", { name: "Unavailable" })).toHaveFocus()
    expect(
      await screen.findByRole("tooltip", { name: "Action unavailable" })
    ).toBeVisible()
    await user.keyboard("{Escape}")
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument()
  })
})
