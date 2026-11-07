import {
  cleanup,
  act,
  fireEvent,
  render,
  screen,
  within,
  waitFor,
} from "@testing-library/react"
import { DndContext } from "@dnd-kit/core"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { supportedLocales } from "@linksense/shared"

import type { Conversation } from "@/api/contracts"
import { SortableConversationGroup } from "./sortable-conversation-group"
import { SidebarConversationDragState } from "./sidebar-conversation-drag-state"
import { SidebarConversationDnd } from "./sidebar-conversation-dnd"
import i18n from "@/i18n"

const tasks: Conversation[] = Array.from({ length: 2_500 }, (_, index) => ({
  id: `task-${index}`,
  title: `Task ${index}`,
  archived: false,
  project_id: null,
  updated_at: "2026-11-07T00:00:00.000Z",
  pinned_at: null,
  sort_order: index,
  collaboration_mode: "default",
  has_unread_completion: false,
  has_automation: false,
  user_input_requests: [],
}))

let listOffset = 200
let viewportHeight = 340
const originalResizeObserver = window.ResizeObserver
const originalScrollTo = Object.getOwnPropertyDescriptor(
  HTMLElement.prototype,
  "scrollTo"
)

function taskList(
  conversations = tasks,
  totalConversationCount?: number,
  onRender?: (id: string) => void
) {
  return (
    <div className="sidebar-conversation-scroll" data-testid="viewport">
      <div>
        <DndContext>
          <SidebarConversationDragState.Provider
            value={{
              disabled: false,
              projectsDisabled: false,
              pendingOrder: null,
              pendingProjectOrder: null,
            }}
          >
            <SortableConversationGroup
              conversations={conversations}
              totalConversationCount={totalConversationCount}
            >
              {(conversation, sortable) => {
                onRender?.(conversation.id)
                return (
                  <div ref={sortable.setNodeRef}>
                    {sortable.keyboardActivator}
                    <a href={`/conversations/${conversation.id}`}>
                      {conversation.title}
                    </a>
                  </div>
                )
              }}
            </SortableConversationGroup>
          </SidebarConversationDragState.Provider>
        </DndContext>
      </div>
    </div>
  )
}

function scrollToTask(index: number) {
  const viewport = screen.getByTestId("viewport")
  viewport.scrollTop = listOffset + index * 34
  fireEvent.scroll(viewport)
}

describe("large sidebar conversation groups", () => {
  beforeEach(async () => {
    await i18n.changeLanguage("en-US")
    listOffset = 200
    viewportHeight = 340
    vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockImplementation(
      function (this: HTMLElement) {
        return this.closest("[data-sidebar-conversation-id]")
          ? 32
          : viewportHeight
      }
    )
    vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockReturnValue(240)
    vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockImplementation(
      () => viewportHeight
    )
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
      function (this: HTMLElement) {
        const fixed =
          this.style.position === "fixed" ? this : this.parentElement
        if (fixed?.style.position === "fixed" && fixed.style.width)
          return new DOMRect(
            Number.parseFloat(fixed.style.left),
            Number.parseFloat(fixed.style.top),
            Number.parseFloat(fixed.style.width),
            Number.parseFloat(fixed.style.height)
          )
        const row = this.closest<HTMLElement>("[data-sidebar-conversation-id]")
        const scrollTop = screen.queryByTestId("viewport")?.scrollTop ?? 0
        return DOMRect.fromRect({
          y: this.classList.contains("sidebar-virtual-conversations")
            ? listOffset - scrollTop
            : row
              ? listOffset + Number(row.dataset.index) * 34 - scrollTop
              : 0,
          width: 240,
          height: this.offsetHeight,
        })
      }
    )
    Object.defineProperty(HTMLElement.prototype, "scrollTo", {
      configurable: true,
      value: function (this: HTMLElement, options: ScrollToOptions) {
        this.scrollTop = options.top ?? this.scrollTop
      },
    })
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
    window.ResizeObserver = originalResizeObserver
    if (originalScrollTo)
      Object.defineProperty(HTMLElement.prototype, "scrollTo", originalScrollTo)
    else Reflect.deleteProperty(HTMLElement.prototype, "scrollTo")
  })

  it("mounts only a viewport of tasks instead of all 2,500 draggable rows", () => {
    render(taskList())
    expect(screen.getByRole("link", { name: "Task 0" })).toBeInTheDocument()
    expect(screen.getAllByRole("link").length).toBeLessThan(30)
    expect(screen.queryByRole("link", { name: "Task 2499" })).toBeNull()
  })

  it("also virtualizes smaller groups when the combined sidebar is large", () => {
    render(taskList(tasks.slice(0, 30), 2_500))
    expect(screen.getAllByRole("link").length).toBeLessThan(20)
    scrollToTask(25)
    expect(screen.getByRole("link", { name: "Task 29" })).toBeInTheDocument()
  })

  it("does not re-render unchanged task presentations as the visible window moves", () => {
    const onRender = vi.fn()
    render(taskList(tasks, undefined, onRender))
    onRender.mockClear()
    scrollToTask(5)
    expect(screen.getByRole("link", { name: "Task 0" })).toBeInTheDocument()
    expect(onRender).not.toHaveBeenCalledWith("task-0")
    expect(onRender).toHaveBeenCalled()
  })

  it("reaches the middle and end using the existing sidebar viewport and full list positions", () => {
    render(taskList())
    scrollToTask(1_200)
    const middle = screen.getByRole("link", { name: "Task 1200" })
    const row = middle.closest("[data-sidebar-conversation-id]")
    expect(row).toHaveAttribute("aria-posinset", "1201")
    expect(row).toHaveAttribute("aria-setsize", "2500")
    expect(within(row as HTMLElement).getByRole("button")).toHaveAccessibleName(
      /1201/u
    )
    expect(screen.queryByRole("link", { name: "Task 0" })).toBeNull()
    expect(screen.getAllByRole("link").length).toBeLessThan(30)

    scrollToTask(2_490)
    expect(screen.getByRole("link", { name: "Task 2499" })).toBeInTheDocument()
    expect(screen.getAllByRole("link").length).toBeLessThan(30)
  })

  it.each(["focus", "pointerDown"] as const)(
    "retains a task with %s while scrolling so drag sources and menu anchors stay mounted",
    (interaction) => {
      render(taskList())
      const first = screen.getByRole("link", { name: "Task 0" })
      fireEvent[interaction](first)
      scrollToTask(1_200)
      expect(first).toBeInTheDocument()
      expect(
        screen.getByRole("link", { name: "Task 1200" })
      ).toBeInTheDocument()
      expect(screen.getAllByRole("link").length).toBeLessThan(31)

      fireEvent.focus(screen.getByRole("link", { name: "Task 1200" }))
      expect(first).not.toBeInTheDocument()
    }
  )

  it("updates the group offset after preceding sections change without changing the viewport position", () => {
    const { rerender } = render(taskList())
    scrollToTask(1_200)
    const viewport = screen.getByTestId("viewport")
    const previousOffset = viewport.scrollTop
    listOffset += 340
    rerender(taskList([...tasks]))
    expect(viewport.scrollTop).toBe(previousOffset)
    expect(screen.getByRole("link", { name: "Task 1190" })).toBeInTheDocument()
    expect(screen.queryByRole("link", { name: "Task 1210" })).toBeNull()
  })

  it("reacts to preceding section resizing and viewport height changes without new task props", () => {
    const observers: TestResizeObserver[] = []
    class TestResizeObserver implements ResizeObserver {
      readonly targets = new Set<Element>()
      readonly callback: ResizeObserverCallback
      constructor(callback: ResizeObserverCallback) {
        this.callback = callback
        observers.push(this)
      }
      observe(target: Element) {
        this.targets.add(target)
      }
      unobserve(target: Element) {
        this.targets.delete(target)
      }
      disconnect() {
        this.targets.clear()
      }
    }
    window.ResizeObserver = TestResizeObserver
    const { unmount } = render(taskList())
    scrollToTask(1_200)
    const viewport = screen.getByTestId("viewport")
    const previousScrollTop = viewport.scrollTop
    const notify = (target: Element) =>
      act(() => {
        const rect = target.getBoundingClientRect()
        const entry: ResizeObserverEntry = {
          target,
          contentRect: rect,
          borderBoxSize: [{ inlineSize: rect.width, blockSize: rect.height }],
          contentBoxSize: [],
          devicePixelContentBoxSize: [],
        }
        for (const observer of observers)
          if (observer.targets.has(target)) observer.callback([entry], observer)
      })
    listOffset += 340
    notify(viewport.firstElementChild as Element)
    expect(viewport.scrollTop).toBe(previousScrollTop)
    expect(screen.getByRole("link", { name: "Task 1190" })).toBeInTheDocument()
    expect(screen.queryByRole("link", { name: "Task 1212" })).toBeNull()
    viewportHeight = 680
    notify(viewport)
    expect(screen.getByRole("link", { name: "Task 1212" })).toBeInTheDocument()
    unmount()
    expect(observers.every((observer) => observer.targets.size === 0)).toBe(
      true
    )
  })

  it("preserves existing records and their actions when old task metadata omits optional fields", () => {
    render(taskList())
    scrollToTask(1_200)
    const link = screen.getByRole("link", { name: "Task 1200" })
    expect(link).toHaveAttribute("href", "/conversations/task-1200")
    expect(
      within(link.parentElement as HTMLElement).getByRole("button")
    ).toBeEnabled()
  })

  it("persists the complete 2,500-task order when keyboard sorting a virtual window", async () => {
    const onReorder = vi.fn(async () => undefined)
    render(
      <div className="sidebar-conversation-scroll" data-testid="viewport">
        <div>
          <SidebarConversationDnd
            conversations={tasks}
            projects={[]}
            disabled={false}
            sortModes={{
              pinned: "manual",
              projects: "manual",
              recent: "manual",
            }}
            onMove={vi.fn(async () => undefined)}
            onReorder={onReorder}
            onReorderProjects={vi.fn(async () => undefined)}
            onError={vi.fn()}
          >
            <SortableConversationGroup conversations={tasks}>
              {(conversation, sortable) => (
                <div
                  ref={sortable.setNodeRef}
                  data-dragging={sortable.isDragging || undefined}
                >
                  {sortable.keyboardActivator}
                  <a href={`#${conversation.id}`}>{conversation.title}</a>
                  {sortable.dropIndicator}
                </div>
              )}
            </SortableConversationGroup>
          </SidebarConversationDnd>
        </div>
      </div>
    )
    scrollToTask(1_200)
    const row = screen.getByRole("link", { name: "Task 1200" })
      .parentElement as HTMLElement
    const handle = within(row).getByRole("button")
    act(() => handle.focus())
    fireEvent.keyDown(handle, { key: " ", code: "Space" })
    await waitFor(() => expect(row).toHaveAttribute("data-dragging", "true"))
    fireEvent.keyDown(document, { key: "ArrowDown", code: "ArrowDown" })
    await waitFor(() => {
      const target = screen.getByRole("link", {
        name: "Task 1201",
      }).parentElement
      expect(
        target?.querySelector('[data-slot="sidebar-drop-indicator"]')
      ).toHaveAttribute("data-edge", "after")
    })
    fireEvent.keyDown(document, { key: " ", code: "Space" })
    const expectedIds = tasks.map((task) => task.id)
    expectedIds.splice(1_200, 2, tasks[1_201].id, tasks[1_200].id)
    await waitFor(() =>
      expect(onReorder).toHaveBeenCalledExactlyOnceWith({
        group: "recent",
        projectId: null,
        conversationIds: expectedIds,
      })
    )
  })

  it.each(supportedLocales)(
    "keeps the existing localized keyboard action and full position in %s",
    async (locale) => {
      await i18n.changeLanguage(locale)
      render(taskList())
      scrollToTask(1_200)
      expect(
        screen.getByRole("button", {
          name: i18n.t("conversation.reorderHandle", {
            title: "Task 1200",
            position: 1201,
          }),
        })
      ).toBeEnabled()
    }
  )
})
