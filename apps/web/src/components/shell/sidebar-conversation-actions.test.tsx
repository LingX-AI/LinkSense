import { cleanup, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { SidebarConversationActions } from "@/components/shell/sidebar-conversation-actions"
import i18n from "@/i18n"

function renderActions(pinned: boolean) {
  const callbacks = {
    onTogglePinned: vi.fn(),
    onArchive: vi.fn(),
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
