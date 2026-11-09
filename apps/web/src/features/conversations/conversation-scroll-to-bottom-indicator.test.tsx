import { render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

import {
  ConversationScrollToBottomButton,
  ConversationScrollToBottomIndicator,
} from "@/features/conversations/conversation-scroll-to-bottom-indicator"
import i18n from "@/i18n"
import appStyles from "@/index.css?raw"

describe("ConversationScrollToBottomIndicator", () => {
  it("shows three animated dots while the current task is running", () => {
    const { container } = render(
      <ConversationScrollToBottomIndicator running />
    )
    const indicator = container.querySelector(
      '[data-slot="conversation-running-indicator"]'
    )
    const dots = container.querySelectorAll(
      '[data-slot="conversation-running-dot"]'
    )

    expect(indicator).toHaveAttribute("aria-hidden", "true")
    expect(container.querySelector(".lucide-arrow-down")).toBeNull()
    expect(dots).toHaveLength(3)
    dots.forEach((dot) => {
      expect(dot).toHaveClass(
        "conversation-running-dot",
        "size-1",
        "bg-muted-foreground/90"
      )
      expect(dot).not.toHaveClass("size-0.875")
    })
  })

  it("uses a larger vertical offset and stops moving when reduced motion is requested", () => {
    expect(appStyles).toMatch(
      /@keyframes conversation-running-dot-bounce\s*\{[\s\S]*?translateY\(-2px\)[\s\S]*?translateY\(1px\)[\s\S]*?\}/u
    )
    expect(appStyles).toMatch(
      /@media \(prefers-reduced-motion: reduce\)\s*\{\s*\.conversation-running-dot\s*\{\s*animation: none;/u
    )
  })

  it("shows the down arrow after the current task finishes", () => {
    const { container } = render(
      <ConversationScrollToBottomIndicator running={false} />
    )

    expect(container.querySelector(".lucide-arrow-down")).toHaveAttribute(
      "aria-hidden",
      "true"
    )
    expect(
      container.querySelector('[data-slot="conversation-running-indicator"]')
    ).toBeNull()
  })
})

describe("ConversationScrollToBottomButton", () => {
  it("does not count older replies loaded while reading history", () => {
    const messages = [
      { id: "reply-10", role: "assistant" as const, sequence_no: 10 },
    ]
    const { rerender } = render(
      <ConversationScrollToBottomButton
        messages={messages}
        running={false}
        onScrollToBottom={vi.fn()}
      />
    )

    rerender(
      <ConversationScrollToBottomButton
        messages={[
          { id: "reply-2", role: "assistant", sequence_no: 2 },
          ...messages,
        ]}
        running={false}
        onScrollToBottom={vi.fn()}
      />
    )

    expect(
      screen.getByRole("button", {
        name: i18n.t("conversation.scrollToBottom"),
      })
    ).not.toHaveAttribute("data-count")
  })

  it.each([
    { item_id: "native-item-2" },
    { client_render_key: "assistant-item-legacy-2" },
  ])(
    "counts a streamed reply only once when its database ID arrives: %j",
    (identity) => {
      const messages = [{ id: "reply-1", role: "assistant" as const }]
      const { rerender } = render(
        <ConversationScrollToBottomButton
          messages={messages}
          running
          onScrollToBottom={vi.fn()}
        />
      )
      const reply = {
        ...identity,
        id: "streaming-reply-2",
        role: "assistant" as const,
      }
      rerender(
        <ConversationScrollToBottomButton
          messages={[...messages, reply]}
          running
          onScrollToBottom={vi.fn()}
        />
      )
      expect(screen.getByRole("button")).toHaveAttribute("data-count", "1")

      rerender(
        <ConversationScrollToBottomButton
          messages={[...messages, { ...reply, id: "persisted-reply-2" }]}
          running={false}
          onScrollToBottom={vi.fn()}
        />
      )
      expect(screen.getByRole("button")).toHaveAttribute("data-count", "1")
    }
  )

  it("counts assistant replies that arrive while the reader is scrolled away", async () => {
    await i18n.changeLanguage("zh-CN")
    const messages = [{ id: "reply-1", role: "assistant" as const }]
    const { rerender } = render(
      <ConversationScrollToBottomButton
        messages={messages}
        running={false}
        onScrollToBottom={vi.fn()}
      />
    )
    expect(screen.getByRole("button", { name: "回到底部" })).toBeVisible()

    rerender(
      <ConversationScrollToBottomButton
        messages={[...messages, { id: "reply-2", role: "assistant" as const }]}
        running
        onScrollToBottom={vi.fn()}
      />
    )

    expect(
      await screen.findByRole("button", {
        name: i18n.t("conversation.newReplies", { count: 1 }),
      })
    ).toBeVisible()
  })
})
