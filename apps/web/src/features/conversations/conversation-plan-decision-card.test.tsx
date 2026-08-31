import { cleanup, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import {
  ConversationPlanDecisionCard,
  type ConversationPlanDecisionBusyAction,
} from "@/features/conversations/conversation-plan-decision-card"
import i18n from "@/i18n"

const reviewId = "plan-review-1"

function handlers() {
  return {
    onImplement: vi.fn(),
    onRevisionSubmit: vi.fn(),
    onDismiss: vi.fn(),
    onExit: vi.fn(),
  }
}

describe("ConversationPlanDecisionCard", () => {
  beforeEach(async () => {
    await i18n.changeLanguage("zh-CN")
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it("keeps implement, skip, and exit as distinct decisions", async () => {
    const interaction = userEvent.setup()
    const callbacks = handlers()
    render(<ConversationPlanDecisionCard reviewId={reviewId} {...callbacks} />)

    const card = screen.getByRole("region", { name: "实施此计划？" })
    expect(card).toHaveAttribute("data-review-id", reviewId)
    expect(card).toHaveAttribute("data-size", "sm")
    expect(card).toHaveAttribute("tabindex", "-1")
    expect(card).toHaveClass("mr-auto", "w-full", "shadow-none")
    expect(card).not.toHaveClass("max-w-3xl")
    expect(card).not.toHaveClass("mx-auto", "shadow-sm")

    const implement = screen.getByRole("button", {
      name: "是，实施此计划",
    })
    expect(implement).toHaveClass("h-10", "rounded-full", "bg-accent", "px-3")
    expect(implement.querySelector(".lucide-arrow-right")).toHaveClass(
      "text-muted-foreground"
    )
    expect(screen.getByText("切换到默认模式并开始执行。")).toHaveClass(
      "sr-only"
    )

    const revise = screen.getByRole("button", { name: "否，先修改计划" })
    expect(revise).toHaveTextContent("否，并告诉 LinkSense 应该如何做得不同")
    expect(revise).toHaveClass("hover:bg-transparent")
    const secondaryRow = screen.getByTestId(
      "conversation-plan-decision-secondary-row"
    )
    expect(secondaryRow).toHaveClass(
      "rounded-full",
      "pl-3",
      "pr-2",
      "hover:bg-hover",
      "focus-within:bg-hover"
    )
    expect(secondaryRow).not.toHaveClass("px-2")
    expect(secondaryRow).toContainElement(revise)
    const dismiss = screen.getByRole("button", { name: "跳过" })
    expect(dismiss).toHaveClass("hover:bg-card")
    expect(secondaryRow).toContainElement(dismiss)
    expect(card.querySelector('[data-slot="card-footer"]')).toBeNull()
    expect(screen.getByRole("button", { name: "退出计划模式" })).toHaveClass(
      "text-muted-foreground"
    )

    await interaction.click(implement)
    await interaction.click(screen.getByRole("button", { name: "跳过" }))
    await interaction.click(
      screen.getByRole("button", { name: "退出计划模式" })
    )

    expect(callbacks.onImplement).toHaveBeenCalledOnce()
    expect(callbacks.onImplement).toHaveBeenCalledWith(reviewId)
    expect(callbacks.onDismiss).toHaveBeenCalledOnce()
    expect(callbacks.onDismiss).toHaveBeenCalledWith(reviewId)
    expect(callbacks.onExit).toHaveBeenCalledOnce()
    expect(callbacks.onExit).toHaveBeenCalledWith(reviewId)
    expect(callbacks.onRevisionSubmit).not.toHaveBeenCalled()
  })

  it("collects revision feedback, trims it on submit, and preserves it across back navigation", async () => {
    const interaction = userEvent.setup()
    const callbacks = handlers()
    render(<ConversationPlanDecisionCard reviewId={reviewId} {...callbacks} />)

    await interaction.click(
      screen.getByRole("button", { name: "否，先修改计划" })
    )
    const feedback = screen.getByRole("textbox", { name: "修改意见" })
    const submit = screen.getByRole("button", { name: "提交修改意见" })
    expect(feedback).not.toHaveFocus()
    expect(submit).toBeDisabled()

    await interaction.type(feedback, "  先缩小首版范围，再补充失败路径。  ")
    expect(submit).toBeEnabled()
    await interaction.click(submit)

    expect(callbacks.onRevisionSubmit).toHaveBeenCalledWith(
      reviewId,
      "先缩小首版范围，再补充失败路径。"
    )

    await interaction.click(screen.getByRole("button", { name: "返回" }))
    expect(
      screen.queryByRole("textbox", { name: "修改意见" })
    ).not.toBeInTheDocument()
    await interaction.click(
      screen.getByRole("button", { name: "否，先修改计划" })
    )
    expect(screen.getByRole("textbox", { name: "修改意见" })).toHaveValue(
      "  先缩小首版范围，再补充失败路径。  "
    )
  })

  it.each([
    ["implement", "正在开始实施"],
    ["revise", "正在提交修改意见"],
    ["dismiss", "正在跳过"],
    ["exit", "正在退出计划模式"],
  ] satisfies Array<[ConversationPlanDecisionBusyAction, string]>)(
    "locks every decision while %s is pending",
    async (busyAction, activeLabel) => {
      const interaction = userEvent.setup()
      const callbacks = handlers()
      const { rerender } = render(
        <ConversationPlanDecisionCard reviewId={reviewId} {...callbacks} />
      )

      if (busyAction === "revise") {
        await interaction.click(
          screen.getByRole("button", { name: "否，先修改计划" })
        )
        await interaction.type(
          screen.getByRole("textbox", { name: "修改意见" }),
          "调整计划"
        )
      }

      rerender(
        <ConversationPlanDecisionCard
          reviewId={reviewId}
          busyAction={busyAction}
          {...callbacks}
        />
      )

      const card = screen.getByRole("region", { name: "实施此计划？" })
      expect(card).toHaveAttribute("aria-busy", "true")
      expect(screen.getByRole("button", { name: activeLabel })).toBeDisabled()
      for (const button of screen.getAllByRole("button")) {
        expect(button).toBeDisabled()
      }
    }
  )
})
