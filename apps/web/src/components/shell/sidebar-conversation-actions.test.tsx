import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { SidebarConversationActions } from "@/components/shell/sidebar-conversation-actions"
import { TooltipProvider } from "@/components/ui/tooltip"
import i18n from "@/i18n"

function renderActions(pinned: boolean) {
  const callbacks = {
    onTogglePinned: vi.fn(),
    onArchive: vi.fn(),
  }

  return {
    ...callbacks,
    ...render(
      <TooltipProvider>
        <SidebarConversationActions
          title="整理项目会议纪要"
          pinned={pinned}
          pinDisabled={false}
          archiveDisabled={false}
          focusActionsVisible
          {...callbacks}
        />
      </TooltipProvider>
    ),
  }
}

describe("SidebarConversationActions", () => {
  beforeEach(async () => {
    await i18n.changeLanguage("zh-CN")
  })

  afterEach(() => {
    cleanup()
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it("waits 300 milliseconds before showing an action name on hover", async () => {
    vi.useFakeTimers()
    renderActions(false)
    const pinButton = screen.getByRole("button", {
      name: "置顶任务“整理项目会议纪要”",
    })

    fireEvent.pointerEnter(pinButton, { pointerType: "mouse" })
    fireEvent.mouseEnter(pinButton)
    fireEvent.mouseMove(pinButton, { movementX: 3, movementY: 0 })
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument()

    await act(async () => {
      vi.advanceTimersByTime(299)
    })
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument()

    await act(async () => {
      vi.advanceTimersByTime(1)
      vi.runOnlyPendingTimers()
    })
    expect(screen.getByRole("tooltip")).toHaveTextContent("置顶任务")
  })

  it("shows pin and archive names on hover and keeps their actions clickable", async () => {
    const interaction = userEvent.setup()
    const callbacks = renderActions(false)
    const pinButton = screen.getByRole("button", {
      name: "置顶任务“整理项目会议纪要”",
    })
    const archiveButton = screen.getByRole("button", {
      name: "归档任务“整理项目会议纪要”",
    })

    expect(pinButton).not.toHaveAttribute("title")
    await interaction.hover(pinButton)
    const pinTooltip = await screen.findByRole("tooltip")
    expect(pinTooltip).toHaveTextContent("置顶任务")
    expect(pinTooltip).toHaveClass(
      "rounded-md",
      "border",
      "border-[var(--app-border)]",
      "bg-[var(--app-popover)]",
      "font-medium",
      "text-[var(--app-text)]"
    )
    expect(pinTooltip).not.toHaveClass("shadow-sm")
    expect(pinTooltip).not.toHaveClass("rounded-full", "rounded-xl")
    expect(document.querySelector(".rotate-45")).not.toBeInTheDocument()
    await interaction.unhover(pinButton)
    await waitFor(() => {
      expect(screen.queryByRole("tooltip")).not.toBeInTheDocument()
    })

    expect(archiveButton).not.toHaveAttribute("title")
    await interaction.hover(archiveButton)
    const archiveTooltip = await screen.findByRole("tooltip")
    expect(archiveTooltip).toHaveTextContent("归档任务")
    expect(archiveTooltip).toHaveClass(
      "rounded-md",
      "border",
      "border-[var(--app-border)]",
      "bg-[var(--app-popover)]",
      "font-medium",
      "text-[var(--app-text)]"
    )
    expect(archiveTooltip).not.toHaveClass("shadow-sm")
    expect(archiveTooltip).not.toHaveClass("rounded-full", "rounded-xl")
    expect(document.querySelector(".rotate-45")).not.toBeInTheDocument()

    await interaction.click(pinButton)
    await interaction.click(archiveButton)
    expect(callbacks.onTogglePinned).toHaveBeenCalledOnce()
    expect(callbacks.onArchive).toHaveBeenCalledOnce()
  })

  it("shows the unpin name for a pinned task in both supported languages", async () => {
    const interaction = userEvent.setup()
    const fixture = renderActions(true)
    const unpinButton = screen.getByRole("button", {
      name: "取消置顶任务“整理项目会议纪要”",
    })

    await interaction.hover(unpinButton)
    expect(await screen.findByRole("tooltip")).toHaveTextContent("取消置顶")

    await i18n.changeLanguage("en-US")
    fixture.rerender(
      <TooltipProvider>
        <SidebarConversationActions
          title="Project meeting notes"
          pinned
          pinDisabled={false}
          archiveDisabled={false}
          focusActionsVisible
          onTogglePinned={fixture.onTogglePinned}
          onArchive={fixture.onArchive}
        />
      </TooltipProvider>
    )

    expect(
      screen.getByRole("button", {
        name: "Unpin task “Project meeting notes”",
      })
    ).toBeInTheDocument()
    expect(
      screen.getByRole("button", {
        name: "Archive task “Project meeting notes”",
      })
    ).toBeInTheDocument()
  })
})
