import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { SidebarConversationActions } from "@/components/shell/sidebar-conversation-actions"
import i18n from "@/i18n"

function renderActions(pinned = false, disabled = false, movable = true) {
  const callbacks = {
    onTogglePinned: vi.fn(),
    onArchive: vi.fn(),
    onMoveToProject: movable ? vi.fn() : undefined,
  }
  return {
    ...callbacks,
    ...render(
      <SidebarConversationActions
        title="整理项目会议纪要"
        pinned={pinned}
        pinDisabled={disabled}
        archiveDisabled={disabled}
        moveDisabled={disabled}
        currentProjectId="project-work"
        projects={[
          { id: "project-work", name: "工作", icon: "folder", color: "default" },
          { id: "project-personal", name: "生活", icon: "heart", color: "pink" },
        ]}
        {...callbacks}
      />
    ),
  }
}

const moreLabel = "整理项目会议纪要的更多操作"

describe("SidebarConversationActions", () => {
  beforeEach(async () => {
    await i18n.changeLanguage("zh-CN")
  })
  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it("opens project destinations on hover and moves directly from the submenu", async () => {
    const interaction = userEvent.setup()
    const callbacks = renderActions()
    const more = screen.getByRole("button", { name: moreLabel })
    const archive = screen.getByRole("button", {
      name: "归档任务“整理项目会议纪要”",
    })
    expect(screen.getAllByRole("button")).toEqual([archive, more])
    expect(screen.queryByRole("menuitem")).not.toBeInTheDocument()
    for (const button of [more, archive]) {
      expect(button).toHaveClass(
        "hover:bg-transparent",
        "aria-expanded:bg-transparent"
      )
    }
    await interaction.click(more)
    await screen.findByRole("menu")
    expect(more).toHaveAttribute("aria-expanded", "true")
    expect(more).toHaveAttribute("data-popup-open")
    expect(more.closest(".sidebar-conversation-actions")).toHaveClass(
      "has-data-[popup-open]:pointer-events-auto",
      "has-data-[popup-open]:opacity-100"
    )
    expect(screen.getAllByRole("menuitem")).toHaveLength(2)
    expect(
      screen.queryByRole("menuitem", { name: "归档任务" })
    ).not.toBeInTheDocument()
    const move = await screen.findByRole("menuitem", { name: "移动到项目" })
    await interaction.hover(move)
    const commonWorkspace = await screen.findByRole("menuitem", {
      name: "公共空间",
    })
    expect(commonWorkspace).toBeVisible()
    expect(
      commonWorkspace.closest('[data-slot="dropdown-menu-sub-content"]')
    ).toHaveAttribute("data-side", "right")
    expect(
      await screen.findByRole("menuitem", { name: "工作" })
    ).toHaveAttribute("aria-disabled", "true")
    expect(screen.getAllByRole("menu")).toHaveLength(2)
    fireEvent.click(screen.getByRole("menuitem", { name: "生活" }))
    expect(callbacks.onMoveToProject).toHaveBeenCalledOnce()
    expect(callbacks.onMoveToProject).toHaveBeenCalledWith("project-personal")
    await waitFor(() =>
      expect(screen.queryByRole("menu")).not.toBeInTheDocument()
    )
    await interaction.click(more)
    await interaction.click(
      await screen.findByRole("menuitem", { name: "置顶任务" })
    )
    expect(callbacks.onTogglePinned).toHaveBeenCalledOnce()
    await waitFor(() =>
      expect(screen.queryByRole("menu")).not.toBeInTheDocument()
    )
    await interaction.click(archive)
    expect(callbacks.onArchive).toHaveBeenCalledOnce()
  })

  it("opens with the keyboard and restores focus when Escape closes the menu", async () => {
    const interaction = userEvent.setup()
    renderActions()
    const more = screen.getByRole("button", { name: moreLabel })
    await interaction.tab()
    expect(
      screen.getByRole("button", { name: "归档任务“整理项目会议纪要”" })
    ).toHaveFocus()
    await interaction.tab()
    expect(more).toHaveFocus()
    await interaction.keyboard("{Enter}")
    expect(await screen.findByRole("menu")).toBeVisible()
    await interaction.keyboard("{Escape}")
    await waitFor(() =>
      expect(screen.queryByRole("menu")).not.toBeInTheDocument()
    )
    expect(more).toHaveFocus()
  })

  it("keeps pending pin and archive actions disabled and omits unavailable project actions", async () => {
    const interaction = userEvent.setup()
    const callbacks = renderActions(false, true, false)
    const archive = screen.getByRole("button", {
      name: "归档任务“整理项目会议纪要”",
    })
    expect(archive).toBeDisabled()
    await interaction.click(archive)
    await interaction.click(screen.getByRole("button", { name: moreLabel }))
    const pin = await screen.findByRole("menuitem", { name: "置顶任务" })
    expect(pin).toHaveAttribute("aria-disabled", "true")
    expect(
      screen.queryByRole("menuitem", { name: "移动到项目" })
    ).not.toBeInTheDocument()
    await interaction.keyboard("{Enter}")
    expect(callbacks.onTogglePinned).not.toHaveBeenCalled()
    expect(callbacks.onArchive).not.toHaveBeenCalled()
  })

  it.each([
    ["zh-CN", moreLabel, "取消置顶"],
    ["en-US", "More Actions for 整理项目会议纪要", "Unpin"],
    ["de-DE", moreLabel, "取消置顶"],
  ])(
    "translates the menu and pinned state in %s",
    async (language, more, unpin) => {
      await i18n.changeLanguage(language)
      const interaction = userEvent.setup()
      const callbacks = renderActions(true)
      await interaction.click(screen.getByRole("button", { name: more }))
      const item = await screen.findByRole("menuitem", { name: unpin })
      expect(item.querySelector("svg")).toHaveAttribute(
        "data-icon",
        "sidebar-pin-filled"
      )
      await interaction.click(item)
      expect(callbacks.onTogglePinned).toHaveBeenCalledOnce()
    }
  )

  it("preserves the shared archive tooltip", async () => {
    const interaction = userEvent.setup()
    renderActions()
    await interaction.hover(
      screen.getByRole("button", { name: "归档任务“整理项目会议纪要”" })
    )
    const tooltip = await screen.findByRole("tooltip")
    expect(tooltip).toHaveTextContent("归档任务")
    expect(tooltip).toHaveClass(
      "rounded-md",
      "border-[var(--app-border)]",
      "bg-[var(--app-popover)]"
    )
  })
})
