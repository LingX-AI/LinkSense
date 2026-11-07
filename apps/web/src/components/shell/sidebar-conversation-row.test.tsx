import { cleanup, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"

import { SidebarConversationOverlays } from "./sidebar-conversation-overlays"
import { SidebarConversationRow } from "./sidebar-conversation-row"

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

function mountRow() {
  return render(
    <SidebarConversationOverlays>
      <SidebarConversationRow actions={<button type="button">Archive</button>}>
        <a href="#task">Task</a>
      </SidebarConversationRow>
    </SidebarConversationOverlays>
  )
}

describe("sidebar task action activation", () => {
  it("defers mouse-only controls until hover and preserves their menu/focus anchor afterward", async () => {
    const interaction = userEvent.setup()
    mountRow()
    expect(screen.queryByRole("button", { name: "Archive" })).toBeNull()
    await interaction.hover(screen.getByRole("link", { name: "Task" }))
    const archive = screen.getByRole("button", { name: "Archive" })
    await interaction.unhover(screen.getByRole("link", { name: "Task" }))
    expect(archive).toBeInTheDocument()
  })

  it("makes the action the next Tab destination after the task link receives focus", async () => {
    const interaction = userEvent.setup()
    mountRow()
    await interaction.tab()
    expect(screen.getByRole("link", { name: "Task" })).toHaveFocus()
    await interaction.tab()
    expect(screen.getByRole("button", { name: "Archive" })).toHaveFocus()
  })

  it("immediately mounts visible controls on touch devices that cannot hover", () => {
    const media = window.matchMedia("(hover: none)")
    vi.spyOn(window, "matchMedia").mockImplementation((query) => ({
      ...media,
      matches: query === "(hover: none)",
      media: query,
    }))
    mountRow()
    expect(screen.getByRole("button", { name: "Archive" })).toBeInTheDocument()
  })
})
