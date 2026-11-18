import { cleanup, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { SidebarConversationActions } from "@/components/shell/sidebar-conversation-actions"
import { SidebarConversationOverlays } from "./sidebar-conversation-overlays"
import i18n from "@/i18n"

function renderActions(pinned = false, disabled = false) {
  const callbacks = {
    onTogglePinned: vi.fn(),
    onArchive: vi.fn(),
  }
  return {
    ...callbacks,
    ...render(
      <SidebarConversationOverlays>
        <SidebarConversationActions
          title="整理项目会议纪要"
          pinned={pinned}
          pinDisabled={disabled}
          archiveDisabled={disabled}
          {...callbacks}
        />
      </SidebarConversationOverlays>
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

  it("shows the filled pin and unpin label for a pinned task", () => {
    renderActions(true)
    const pin = screen.getByRole("button", { name: unpinLabel })
    expect(pin.querySelector("svg")).toHaveAttribute(
      "data-icon",
      "sidebar-pin-filled"
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

  it("preserves the shared archive and pin tooltips", async () => {
    const interaction = userEvent.setup()
    renderActions()
    await interaction.hover(
      screen.getByRole("button", { name: archiveLabel })
    )
    const archiveTooltip = await screen.findByRole("tooltip")
    expect(archiveTooltip).toHaveTextContent("归档任务")
    await interaction.unhover(
      screen.getByRole("button", { name: archiveLabel })
    )
    await interaction.hover(screen.getByRole("button", { name: pinLabel }))
    const pinTooltip = await screen.findByRole("tooltip")
    expect(pinTooltip).toHaveTextContent("置顶任务")
  })
})
