import { cleanup, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it } from "vitest"

import { ConversationProposedPlanCard } from "@/features/conversations/conversation-proposed-plan-card"
import i18n from "@/i18n"

describe("ConversationProposedPlanCard", () => {
  beforeEach(async () => {
    await i18n.changeLanguage("zh-CN")
  })

  afterEach(() => cleanup())

  it("exposes the proposed plan as a labelled region without owning its renderer", () => {
    render(
      <ConversationProposedPlanCard>
        <p>先更新接口，再补齐交互测试。</p>
      </ConversationProposedPlanCard>
    )

    const card = screen.getByRole("region", { name: "方案" })
    expect(card).toBeVisible()
    expect(screen.getByRole("heading", { name: "方案" })).toBeVisible()
    expect(card).toHaveTextContent("先更新接口，再补齐交互测试。")
    expect(card).not.toHaveAttribute("aria-busy")
  })

  it("announces streaming state and uses the English label", async () => {
    await i18n.changeLanguage("en-US")

    render(
      <ConversationProposedPlanCard streaming>
        <p>Implementation plan</p>
      </ConversationProposedPlanCard>
    )

    const card = screen.getByRole("region", { name: "Plan" })
    expect(card).toHaveAttribute("aria-busy", "true")
    expect(card).toHaveAttribute("data-streaming", "true")
  })
})
