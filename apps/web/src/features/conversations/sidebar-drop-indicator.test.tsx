import { cleanup, render } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"
import {
  SidebarConversationDropTargetContext,
  type SidebarConversationDropTarget,
} from "./sidebar-conversation-drag-state"
import { SidebarDropIndicator } from "./sidebar-drop-indicator"

afterEach(cleanup)

describe("sidebar insertion marker", () => {
  it.each([
    { kind: "reorder", id: "task", edge: "before" },
    { kind: "reorder", id: "task", edge: "after" },
    { kind: "project", id: "project", edge: "after" },
  ] satisfies SidebarConversationDropTarget[])(
    "draws a blue hollow dot and thicker line for $kind $edge without changing row height",
    (target) => {
      const { container } = render(
        <SidebarConversationDropTargetContext.Provider value={target}>
          <SidebarDropIndicator targetId={target.id} />
          <SidebarDropIndicator targetId="other" />
        </SidebarConversationDropTargetContext.Provider>
      )
      const marker = container.querySelector(
        '[data-slot="sidebar-drop-indicator"]'
      )!
      expect(
        container.querySelectorAll('[data-slot="sidebar-drop-indicator"]')
      ).toHaveLength(1)
      expect(marker).toHaveAttribute("aria-hidden", "true")
      expect(marker).toHaveClass(
        "absolute",
        "pointer-events-none",
        "text-[var(--app-brand)]",
        "left-[calc(8px+var(--sidebar-conversation-indent,0px))]",
        target.edge === "before" ? "top-0" : "bottom-0"
      )
      expect(marker.firstElementChild).toHaveClass(
        "rounded-full",
        "border-2",
        "border-current",
        "bg-[var(--app-sidebar)]"
      )
      expect(marker.lastElementChild).toHaveClass(
        "h-0.5",
        "flex-1",
        "bg-current"
      )
      expect(marker.className).not.toMatch(/\[--sidebar-conversation-indent:/u)
    }
  )

  it("does not render without a valid insertion target", () => {
    const { container } = render(<SidebarDropIndicator targetId="task" />)
    expect(container).toBeEmptyDOMElement()
  })

  it.each(["before", "after"] as const)(
    "places a project-order marker %s the whole group without indenting it into task content",
    (edge) => {
      const { container } = render(
        <SidebarConversationDropTargetContext.Provider
          value={{ kind: "project-reorder", id: "project", edge }}
        >
          <SidebarDropIndicator targetId="project" />
          <SidebarDropIndicator targetId="project" scope="project" />
        </SidebarConversationDropTargetContext.Provider>
      )
      expect(
        container.querySelectorAll('[data-slot="sidebar-drop-indicator"]')
      ).toHaveLength(1)
      expect(container.firstElementChild).toHaveClass(
        "left-2",
        edge === "before" ? "top-0" : "bottom-0"
      )
    }
  )
})
