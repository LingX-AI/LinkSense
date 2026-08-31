import { render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { ConversationTimeSeparator } from "@/features/conversations/conversation-time-separator"
import { shouldShowConversationTimeSeparator } from "@/features/conversations/conversation-time-separator-utils"
import i18n from "@/i18n"

describe("conversation time separators", () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it("only separates messages whose gap is strictly greater than two hours", () => {
    const previous = "2026-08-28T07:33:00.000Z"

    expect(
      shouldShowConversationTimeSeparator(previous, "2026-08-28T09:33:00.000Z")
    ).toBe(false)
    expect(
      shouldShowConversationTimeSeparator(previous, "2026-08-28T09:33:00.001Z")
    ).toBe(true)
  })

  it.each([
    [undefined, "2026-08-28T09:33:00.001Z"],
    ["not-a-date", "2026-08-28T09:33:00.001Z"],
    ["2026-08-28T09:33:00.001Z", "not-a-date"],
    ["2026-08-28T09:33:00.001Z", "2026-08-28T07:33:00.000Z"],
  ])(
    "does not separate invalid or reversed timestamps",
    (previous, current) => {
      expect(shouldShowConversationTimeSeparator(previous, current)).toBe(false)
    }
  )

  it("renders a localized semantic time marker", async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-08-28T12:00:00"))
    await i18n.changeLanguage("en-US")

    render(<ConversationTimeSeparator timestamp="2026-08-28T09:33:00" />)

    const separator = screen.getByRole("separator", {
      name: "Message time: Aug 28, 2026, 09:33",
    })
    const time = screen.getByText("Today 9:33")
    expect(separator).toContainElement(time)
    expect(time.tagName).toBe("TIME")
    expect(time).toHaveAttribute("datetime", "2026-08-28T09:33:00")
    expect(time.parentElement).toHaveClass("text-xs")
  })
})
