import { cleanup, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { SidebarConversationActions } from "@/components/shell/sidebar-conversation-actions"
import i18n from "@/i18n"

function renderActions(pinned: boolean, onMoveToCategory?: () => void) {
  const callbacks = {
    onTogglePinned: vi.fn(),
    onArchive: vi.fn(),
    onMoveToCategory,
  }

  return {
    ...callbacks,
    ...render(
      <SidebarConversationActions
        title="整理项目会议纪要"
        pinned={pinned}
        pinDisabled={false}
        archiveDisabled={false}
        {...callbacks}
      />
    ),
  }
}

describe("SidebarConversationActions", () => {
  beforeEach(async () => {
    await i18n.changeLanguage("zh-CN")
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it("shows the pin and archive action names in the shared tooltip", async () => {
    const interaction = userEvent.setup()
    renderActions(false)
    const pinButton = screen.getByRole("button", {
      name: "置顶任务“整理项目会议纪要”",
    })
    const archiveButton = screen.getByRole("button", {
      name: "归档任务“整理项目会议纪要”",
    })

    expect(pinButton).not.toHaveAttribute("title")
    expect(archiveButton).not.toHaveAttribute("title")

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

    await interaction.unhover(pinButton)
    await waitFor(() =>
      expect(screen.queryByRole("tooltip")).not.toBeInTheDocument()
    )

    await interaction.hover(archiveButton)
    expect(await screen.findByRole("tooltip")).toHaveTextContent("归档任务")
  })

  it("keeps pin and archive actions clickable", async () => {
    const interaction = userEvent.setup()
    const callbacks = renderActions(false)
    const pinButton = screen.getByRole("button", {
      name: "置顶任务“整理项目会议纪要”",
    })
    const archiveButton = screen.getByRole("button", {
      name: "归档任务“整理项目会议纪要”",
    })
    const actions = pinButton.parentElement

    expect(actions).toHaveClass(
      "group-has-[:focus-visible]:pointer-events-auto",
      "group-has-[:focus-visible]:opacity-100"
    )
    expect(actions).not.toHaveClass(
      "group-focus-within:pointer-events-auto",
      "group-focus-within:opacity-100"
    )

    await interaction.click(pinButton)
    await interaction.click(archiveButton)
    expect(callbacks.onTogglePinned).toHaveBeenCalledOnce()
    expect(callbacks.onArchive).toHaveBeenCalledOnce()
  })

  it("matches the move icon size to archive and the stroke weight to both neighboring actions", () => {
    renderActions(false, vi.fn())
    const moveIcon = screen
      .getByRole("button", {
        name: "将“整理项目会议纪要”移动到分类",
      })
      .querySelector("svg")
    const archiveIcon = screen
      .getByRole("button", {
        name: "归档任务“整理项目会议纪要”",
      })
      .querySelector("svg")
    const pinIcon = screen
      .getByRole("button", {
        name: "置顶任务“整理项目会议纪要”",
      })
      .querySelector("svg")

    expect(moveIcon).toHaveClass("size-3.5")
    expect(archiveIcon).toHaveClass("size-3.5")
    for (const icon of [moveIcon, archiveIcon, pinIcon]) {
      expect(icon).toHaveAttribute("stroke-width", "2")
      expect(icon).toHaveAttribute("aria-hidden", "true")
    }
  })

  it.each([false, true])(
    "keeps every task action background transparent when pinned is %s",
    async (pinned) => {
      const interaction = userEvent.setup()
      const onMoveToCategory = vi.fn()
      const callbacks = renderActions(pinned, onMoveToCategory)
      const buttons = screen.getAllByRole("button")

      expect(buttons).toHaveLength(3)
      for (const button of buttons) {
        expect(button).toHaveClass(
          "hover:bg-transparent",
          "aria-expanded:bg-transparent"
        )
        expect(button).not.toHaveClass(
          "hover:bg-hover",
          "aria-expanded:bg-muted"
        )
        await interaction.click(button)
      }
      expect(onMoveToCategory).toHaveBeenCalledOnce()
      expect(callbacks.onTogglePinned).toHaveBeenCalledOnce()
      expect(callbacks.onArchive).toHaveBeenCalledOnce()
    }
  )

  it("shows the unpin name for a pinned task in both supported languages", async () => {
    const fixture = renderActions(true)
    const unpinButton = screen.getByRole("button", {
      name: "取消置顶任务“整理项目会议纪要”",
    })

    expect(unpinButton).not.toHaveAttribute("title")

    await i18n.changeLanguage("en-US")
    fixture.rerender(
      <SidebarConversationActions
        title="Project meeting notes"
        pinned
        pinDisabled={false}
        archiveDisabled={false}
        onTogglePinned={fixture.onTogglePinned}
        onArchive={fixture.onArchive}
      />
    )

    const englishUnpinButton = screen.getByRole("button", {
      name: "Unpin task “Project meeting notes”",
    })
    const englishArchiveButton = screen.getByRole("button", {
      name: "Archive task “Project meeting notes”",
    })
    expect(englishUnpinButton).not.toHaveAttribute("title")
    expect(englishArchiveButton).not.toHaveAttribute("title")
  })
})
