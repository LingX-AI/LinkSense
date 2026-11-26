import { cleanup, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { SidebarConversationActions } from "@/components/shell/sidebar-conversation-actions"
import i18n from "@/i18n"

function renderActions(pinned = false, disabled = false) {
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
        pinDisabled={disabled}
        archiveDisabled={disabled}
        {...callbacks}
      />
    ),
  }
}

const archiveLabel = "归档任务“整理项目会议纪要”"
const pinLabel = "置顶任务“整理项目会议纪要”"
const unpinLabel = "取消置顶任务“整理项目会议纪要”"

describe("SidebarConversationActions", () => {
  beforeEach(async () => {
    await i18n.changeLanguage("zh-CN")
  })
  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it("pins and archives directly without a menu", async () => {
    const interaction = userEvent.setup()
    const callbacks = renderActions()
    const archive = screen.getByRole("button", { name: archiveLabel })
    const pin = screen.getByRole("button", { name: pinLabel })
    expect(screen.getAllByRole("button")).toEqual([pin, archive])
    expect(
      screen.queryByRole("button", { name: /更多操作/u })
    ).not.toBeInTheDocument()
    for (const button of [pin, archive]) {
      expect(button).toHaveClass(
        "hover:bg-transparent",
        "aria-expanded:bg-transparent"
      )
    }
    await interaction.click(pin)
    expect(callbacks.onTogglePinned).toHaveBeenCalledOnce()
    await interaction.click(archive)
    expect(callbacks.onArchive).toHaveBeenCalledOnce()
  })

  it("shows the unpin icon and unpin label for a pinned task", () => {
    renderActions(true)
    const pin = screen.getByRole("button", { name: unpinLabel })
    expect(pin.querySelector("svg")).toHaveAttribute(
      "data-icon",
      "sidebar-pin-off"
    )
  })

  it("keeps pending pin and archive actions disabled", async () => {
    const interaction = userEvent.setup()
    const callbacks = renderActions(false, true)
    const archive = screen.getByRole("button", { name: archiveLabel })
    const pin = screen.getByRole("button", { name: pinLabel })
    expect(archive).toBeDisabled()
    expect(pin).toBeDisabled()
    await interaction.click(archive)
    await interaction.click(pin)
    expect(callbacks.onTogglePinned).not.toHaveBeenCalled()
    expect(callbacks.onArchive).not.toHaveBeenCalled()
  })

  it.each([
    ["zh-CN", pinLabel],
    ["en-US", "Pin task “整理项目会议纪要”"],
    ["de-DE", pinLabel],
  ])("translates the pin action in %s", async (language, label) => {
    await i18n.changeLanguage(language)
    renderActions(false)
    expect(screen.getByRole("button", { name: label })).toBeVisible()
  })

  it("uses native titles for the pin and archive actions", () => {
    const { unmount } = renderActions()
    expect(
      screen.getByRole("button", { name: pinLabel })
    ).toHaveAttribute("title", "置顶任务")
    expect(
      screen.getByRole("button", { name: archiveLabel })
    ).toHaveAttribute("title", "归档任务")
    unmount()

    renderActions(true)
    expect(
      screen.getByRole("button", { name: unpinLabel })
    ).toHaveAttribute("title", "取消置顶")
  })
})
