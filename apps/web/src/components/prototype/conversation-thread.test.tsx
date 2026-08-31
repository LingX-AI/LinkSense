import { cleanup, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it } from "vitest"

import { ConversationThread } from "@/components/prototype/conversation-thread"
import i18n from "@/i18n"

describe("prototype ConversationThread markers", () => {
  beforeEach(async () => {
    await i18n.changeLanguage("zh-CN")
  })

  afterEach(() => cleanup())

  it("uses shadcn markers and shimmer for running work", async () => {
    const interaction = userEvent.setup()
    const { container, rerender } = render(
      <ConversationThread isRunning={true} />
    )

    const runningMarker = screen.getByRole("status")
    const runningContent = runningMarker.querySelector(
      '[data-slot="marker-content"]'
    )
    expect(runningMarker).toHaveAttribute("data-slot", "marker")
    expect(runningMarker).toHaveAttribute("aria-busy", "true")
    expect(runningContent).toHaveClass("shimmer")

    await interaction.click(runningMarker.closest("button") as HTMLElement)
    expect(container.querySelectorAll('[data-slot="marker"]')).toHaveLength(4)

    rerender(<ConversationThread isRunning={false} />)
    expect(screen.queryByRole("status")).toBeNull()
    expect(
      container.querySelector('[data-slot="marker-content"]')
    ).not.toHaveClass("shimmer")
  })
})
