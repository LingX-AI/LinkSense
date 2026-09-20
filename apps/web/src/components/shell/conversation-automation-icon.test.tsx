import { cleanup, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it } from "vitest"

import { ConversationAutomationIcon } from "@/components/shell/conversation-automation-icon"
import i18n from "@/i18n"

describe("conversation automation icon", () => {
  beforeEach(async () => {
    await i18n.changeLanguage("zh-CN")
  })

  afterEach(() => cleanup())

  it("renders the automation indicator before a linked task title", () => {
    render(
      <div>
        <ConversationAutomationIcon hasAutomation />
        <span>下班前定时发送工时记录消息</span>
      </div>
    )

    const icon = screen.getByRole("img", { name: "自动化任务" })
    const title = screen.getByText("下班前定时发送工时记录消息")
    expect(icon).toHaveClass("sidebar-conversation-automation-icon", "shrink-0")
    expect(icon).toHaveAttribute("title", "自动化任务")
    const automationIcon = icon.querySelector(".lucide-calendar-clock")
    expect(automationIcon).toHaveClass("size-3.5")
    expect(automationIcon).not.toHaveClass("size-4")
    expect(
      icon.compareDocumentPosition(title) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy()
  })

  it("renders nothing for a regular task", () => {
    const { container } = render(
      <ConversationAutomationIcon hasAutomation={false} />
    )

    expect(container).toBeEmptyDOMElement()
  })
})
