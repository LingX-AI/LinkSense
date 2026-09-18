import { act, fireEvent, screen, waitFor } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

import { SidebarConversationActions } from "@/components/shell/sidebar-conversation-actions"
import { SIDEBAR_WIDTH_STORAGE_KEY } from "@/components/shell/sidebar-width"
import {
  conversations,
  installApiMock,
  json,
  renderApp,
  setupApplicationTests,
} from "./fixture"

vi.mock(
  "@/components/shell/sidebar-conversation-actions",
  async (importOriginal) => {
    const actual =
      await importOriginal<
        typeof import("@/components/shell/sidebar-conversation-actions")
      >()
    return {
      ...actual,
      SidebarConversationActions: vi.fn(actual.SidebarConversationActions),
    }
  }
)

describe("sidebar resize rendering", () => {
  setupApplicationTests()

  it("resizes a populated sidebar without rendering task actions again", async () => {
    const tasks = Array.from({ length: 100 }, (_, index) => ({
      ...conversations[0],
      id: `10000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
      title: `Resize task ${index}`,
    }))
    installApiMock({
      conversationListResponse: () =>
        json({ success: true, data: { items: tasks, next_cursor: null } }),
    })
    const { container } = renderApp()
    await screen.findByText("Resize task 99")
    // Settle initial query notifications before measuring resize-only work.
    await act(
      () =>
        new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
    )
    const handle = screen.getByRole("separator", { name: "调整侧边栏宽度" })
    const shell = container.querySelector(".app-shell")
    const renderCount = vi.mocked(SidebarConversationActions).mock.calls.length
    expect(renderCount).toBeGreaterThanOrEqual(tasks.length)

    fireEvent.pointerDown(handle, { button: 0, clientX: 248, pointerId: 7 })
    for (const clientX of [270, 300, 320]) {
      fireEvent.pointerMove(handle, { clientX, pointerId: 7 })
    }
    await waitFor(() =>
      expect(shell).toHaveStyle({ "--app-sidebar-width": "320px" })
    )
    expect(shell).toHaveAttribute("data-sidebar-resizing", "true")
    expect(window.localStorage.getItem(SIDEBAR_WIDTH_STORAGE_KEY)).toBeNull()
    fireEvent.pointerUp(handle, { clientX: 320, pointerId: 7 })

    expect(shell).not.toHaveAttribute("data-sidebar-resizing")
    expect(handle).toHaveAttribute("aria-valuenow", "320")
    expect(window.localStorage.getItem(SIDEBAR_WIDTH_STORAGE_KEY)).toBe("320")
    expect(SidebarConversationActions).toHaveBeenCalledTimes(renderCount)

    fireEvent.keyDown(handle, { key: "ArrowRight" })
    expect(shell).toHaveStyle({ "--app-sidebar-width": "328px" })
    expect(window.localStorage.getItem(SIDEBAR_WIDTH_STORAGE_KEY)).toBe("328")
    expect(SidebarConversationActions).toHaveBeenCalledTimes(renderCount)
  })
})
