import { cleanup, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"

import i18n from "@/i18n"
import { FeedbackReplyStatus } from "./feedback-reply-status"

afterEach(async () => {
  cleanup()
  await i18n.changeLanguage("zh-CN")
})

describe("FeedbackReplyStatus", () => {
  it.each([
    ["zh-CN", "已回复"],
    ["en-US", "Replied"],
    ["fr-FR", "已回复"],
  ])(
    "shows a green check without a background in %s",
    async (locale, label) => {
      await i18n.changeLanguage(locale)
      render(<FeedbackReplyStatus count={1} />)

      const status = screen.getByText(label)
      expect(status).toHaveClass("text-foreground")
      expect(status.className).not.toMatch(/(?:^|\s|:)bg-/u)
      expect(status.querySelector("svg")).toHaveClass("text-success")
      expect(status.querySelector("svg")).toHaveAttribute("aria-hidden", "true")
    }
  )

  it("keeps the waiting state neutral when there are no replies", async () => {
    await i18n.changeLanguage("zh-CN")
    render(<FeedbackReplyStatus count={0} />)

    const status = screen.getByText("待回复")
    expect(status).toHaveClass("bg-secondary", "text-secondary-foreground")
    expect(status.querySelector("svg")).not.toHaveClass("text-success")
  })
})
