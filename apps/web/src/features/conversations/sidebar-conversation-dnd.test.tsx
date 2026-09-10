import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { Conversation } from "@/api/contracts"
import { SidebarTaskGroups } from "@/features/task-categories/sidebar-task-groups"
import { SidebarConversationDnd } from "./sidebar-conversation-dnd"
import { SortableConversationGroup } from "./sortable-conversation-group"
import i18n from "@/i18n"

const now = "2026-09-09T00:00:00.000Z"
const categories = ["工作", "生活"].map((name, index) => ({
  id: `category-${index}`,
  name,
  created_at: now,
  updated_at: now,
}))
function task(
  id: string,
  category_id: string | null = null,
  pinned = false
): Conversation {
  return {
    id,
    title: id,
    category_id,
    archived: false,
    updated_at: now,
    pinned_at: pinned ? now : null,
    sort_order: id === "second" ? 1 : 0,
    collaboration_mode: "default",
    has_unread_completion: false,
    has_automation: false,
    user_input_requests: [],
  }
}

function mount(tasks: Conversation[], disabled = false) {
  const onMove = vi.fn(async (): Promise<void> => undefined)
  const onReorder = vi.fn(async (): Promise<void> => undefined)
  const onReorderCategories = vi
    .fn<(ids: string[]) => Promise<void>>()
    .mockResolvedValue(undefined)
  const onError = vi.fn()
  const renderTask = vi.fn<(id: string) => void>()
  render(
    <SidebarConversationDnd
      conversations={tasks}
      categories={categories}
      disabled={disabled}
      onMove={onMove}
      onReorder={onReorder}
      onReorderCategories={onReorderCategories}
      onError={onError}
    >
      <SidebarTaskGroups
        pinned={tasks.filter((item) => item.pinned_at)}
        recent={tasks.filter((item) => !item.pinned_at)}
        categories={categories}
        loadingMore={false}
        onAction={vi.fn()}
      >
        {(group) => (
          <SortableConversationGroup conversations={group.conversations}>
            {(conversation, sortable) => {
              renderTask(conversation.id)
              return (
                <div
                  ref={sortable.setNodeRef}
                  data-testid={conversation.id}
                  data-dragging={sortable.isDragging || undefined}
                  onPointerDown={sortable.onPointerDown}
                >
                  {conversation.title}
                  {sortable.keyboardActivator}
                  {sortable.dropIndicator}
                </div>
              )
            }}
          </SortableConversationGroup>
        )}
      </SidebarTaskGroups>
    </SidebarConversationDnd>
  )
  return { onMove, onReorder, onReorderCategories, onError, renderTask }
}

function categoryHeader(name: string) {
  return screen.getByRole("button", { name }).parentElement!
}

function layout(nodes: HTMLElement[]) {
  const rects = new Map(
    nodes.map((node, index) => [node, new DOMRect(0, index * 40, 240, 36)])
  )
  const original = HTMLElement.prototype.getBoundingClientRect
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
    function (this: HTMLElement) {
      // jsdom does not lay out the fixed preview; honor the dimensions that
      // dnd-kit measured from the task so keyboard collisions use its bounds.
      const fixed = this.style.position === "fixed" ? this : this.parentElement
      if (fixed?.style.position === "fixed" && fixed.style.width) {
        return new DOMRect(
          Number.parseFloat(fixed.style.left),
          Number.parseFloat(fixed.style.top),
          Number.parseFloat(fixed.style.width),
          Number.parseFloat(fixed.style.height)
        )
      }
      return rects.get(this) ?? original.call(this)
    }
  )
}

async function startDrag(node: HTMLElement, y: number) {
  fireEvent.pointerDown(node, {
    button: 0,
    clientX: 20,
    clientY: y,
    isPrimary: true,
  })
  fireEvent.pointerMove(document, { clientX: 20, clientY: y + 6 })
  await waitFor(() => expect(node).toHaveAttribute("data-dragging", "true"))
}

describe("sidebar task dragging between categories", () => {
  beforeEach(async () => {
    await i18n.changeLanguage("zh-CN")
  })
  afterEach(async () => {
    cleanup()
    // The native pointer sensor removes its document click listener 50ms after
    // dropping. Let that cleanup finish before the next test clicks a folder.
    await act(() => new Promise((resolve) => window.setTimeout(resolve, 60)))
    vi.restoreAllMocks()
  })

  it.each([false, true])(
    "reorders a category as a whole and preserves its collapsed state, collapsed=%s",
    async (collapsed) => {
      const { onReorderCategories, onReorder, onMove, renderTask } = mount([
        task("nested", "category-1"),
      ])
      const source = categoryHeader("工作")
      const destination = categoryHeader("生活")
      const sourceButton = within(source).getByRole("button", { name: "工作" })
      if (collapsed) fireEvent.click(sourceButton)
      layout([source, destination])
      fireEvent.pointerDown(sourceButton, {
        button: 0,
        clientX: 20,
        clientY: 10,
        isPrimary: true,
      })
      fireEvent.pointerMove(document, { clientX: 20, clientY: 16 })
      await waitFor(() =>
        expect(source).toHaveAttribute("data-dragging", "true")
      )
      fireEvent.pointerMove(document, { clientX: 20, clientY: 65 })
      const destinationGroup = screen.getByRole("region", { name: "生活" })
      await waitFor(() =>
        expect(
          destinationGroup.querySelector('[data-slot="sidebar-drop-indicator"]')
        ).toHaveAttribute("data-edge", "after")
      )
      const marker = destinationGroup.querySelector<HTMLElement>(
        '[data-slot="sidebar-drop-indicator"]'
      )!
      expect(marker.parentElement).toBe(destinationGroup)
      expect(marker).toHaveClass("left-2")
      expect(destination).not.toContainElement(marker)
      expect(source).toBeVisible()
      expect(source.style.transform).toBe("")
      expect(sourceButton).toHaveAttribute("aria-expanded", String(!collapsed))
      const previewTitle = screen.getByText("工作", {
        selector: '[aria-hidden="true"] span',
      })
      expect(previewTitle).toHaveClass("font-medium")
      expect(previewTitle.parentElement).toHaveClass("opacity-80", "h-8")
      expect(previewTitle.parentElement?.querySelector("svg")).toHaveClass(
        collapsed ? "lucide-folder-closed" : "lucide-folder-open"
      )
      renderTask.mockClear()
      for (let y = 66; y < 74; y++)
        fireEvent.pointerMove(document, { clientX: 20, clientY: y })
      expect(renderTask).not.toHaveBeenCalled()
      fireEvent.pointerUp(document)
      await waitFor(() =>
        expect(onReorderCategories).toHaveBeenCalledWith([
          "category-1",
          "category-0",
        ])
      )
      expect(onReorder).not.toHaveBeenCalled()
      expect(onMove).not.toHaveBeenCalled()
      fireEvent.click(sourceButton)
      expect(sourceButton).toHaveAttribute("aria-expanded", String(!collapsed))
    }
  )

  it("supports keyboard category ordering without collapsing the source", async () => {
    const { onReorderCategories } = mount([])
    const source = categoryHeader("工作")
    layout([source, categoryHeader("生活")])
    const handle = within(source).getByRole("button", {
      name: /使用键盘调整分类/u,
    })
    handle.focus()
    fireEvent.keyDown(handle, { key: " ", code: "Space" })
    await waitFor(() => expect(source).toHaveAttribute("data-dragging", "true"))
    fireEvent.keyDown(document, { key: "ArrowDown", code: "ArrowDown" })
    await waitFor(() =>
      expect(
        screen
          .getByRole("region", { name: "生活" })
          .querySelector('[data-slot="sidebar-drop-indicator"]')
      ).toHaveAttribute("data-edge", "after")
    )
    fireEvent.keyDown(document, { key: " ", code: "Space" })
    await waitFor(() =>
      expect(onReorderCategories).toHaveBeenCalledWith([
        "category-1",
        "category-0",
      ])
    )
    expect(
      within(source).getByRole("button", { name: "工作" })
    ).toHaveAttribute("aria-expanded", "true")
  })

  it.each(["same-boundary", "task", "outside", "escape"])(
    "does not save category ordering for %s",
    async (target) => {
      const { onReorderCategories, onReorder, onMove } = mount([task("plain")])
      const source = categoryHeader("工作")
      layout([source, categoryHeader("生活"), screen.getByTestId("plain")])
      fireEvent.pointerDown(
        within(source).getByRole("button", { name: "工作" }),
        { button: 0, clientX: 20, clientY: 10, isPrimary: true }
      )
      fireEvent.pointerMove(document, { clientX: 20, clientY: 16 })
      await waitFor(() =>
        expect(source).toHaveAttribute("data-dragging", "true")
      )
      fireEvent.pointerMove(document, {
        clientX: target === "outside" ? 500 : 20,
        clientY: target === "same-boundary" ? 45 : target === "task" ? 90 : 65,
      })
      if (target === "escape")
        fireEvent.keyDown(document, { key: "Escape", code: "Escape" })
      else fireEvent.pointerUp(document)
      expect(onReorderCategories).not.toHaveBeenCalled()
      expect(onReorder).not.toHaveBeenCalled()
      expect(onMove).not.toHaveBeenCalled()
      expect(
        document.querySelector('[data-slot="sidebar-drop-indicator"]')
      ).toBeNull()
    }
  )

  it("restores category order and reports a failed save", async () => {
    const { onReorderCategories, onError } = mount([])
    const error = new Error("offline")
    onReorderCategories.mockRejectedValue(error)
    const source = categoryHeader("工作")
    layout([source, categoryHeader("生活")])
    fireEvent.pointerDown(
      within(source).getByRole("button", { name: "工作" }),
      { button: 0, clientX: 20, clientY: 10, isPrimary: true }
    )
    fireEvent.pointerMove(document, { clientX: 20, clientY: 16 })
    await waitFor(() => expect(source).toHaveAttribute("data-dragging", "true"))
    fireEvent.pointerMove(document, { clientX: 20, clientY: 65 })
    fireEvent.pointerUp(document)
    await waitFor(() => expect(onError).toHaveBeenCalledWith(error))
    expect(
      screen
        .getAllByRole("region", { name: /工作|生活/u })
        .map((node) => node.getAttribute("aria-label"))
    ).toEqual(["工作", "生活"])
    expect(screen.getByText("分类顺序保存失败，请重试。")).toHaveAttribute(
      "role",
      "status"
    )
  })

  it("does not rerender task content during continuous pointer movement", async () => {
    const { renderTask } = mount([task("first"), task("second")])
    const first = screen.getByTestId("first")
    const second = screen.getByTestId("second")
    layout([first, second])
    await startDrag(first, 10)
    fireEvent.pointerMove(document, { clientX: 20, clientY: 65 })
    await waitFor(() =>
      expect(
        second.querySelector('[data-slot="sidebar-drop-indicator"]')
      ).toHaveAttribute("data-edge", "after")
    )
    renderTask.mockClear()
    for (let y = 66; y <= 74; y += 1)
      fireEvent.pointerMove(document, { clientX: 20, clientY: y })
    expect(renderTask).not.toHaveBeenCalled()
    fireEvent.pointerMove(document, { clientX: 20, clientY: 45 })
    await waitFor(() =>
      expect(
        second.querySelector('[data-slot="sidebar-drop-indicator"]')
      ).toHaveAttribute("data-edge", "before")
    )
    expect(renderTask).not.toHaveBeenCalled()
    fireEvent.keyDown(document, { code: "Escape", key: "Escape" })
  })

  it("keeps the source order when dropped on its existing insertion boundary", async () => {
    const { onReorder } = mount([task("first"), task("second")])
    const first = screen.getByTestId("first")
    layout([first, screen.getByTestId("second")])
    await startDrag(first, 10)
    fireEvent.pointerMove(document, { clientX: 20, clientY: 45 })
    fireEvent.pointerUp(document)
    expect(onReorder).not.toHaveBeenCalled()
    expect(
      document.querySelector('[data-slot="sidebar-drop-indicator"]')
    ).toBeNull()
    expect(screen.queryByText("正在保存任务位置。")).not.toBeInTheDocument()
  })

  it.each([
    ["first", "ArrowDown", "second", "after"],
    ["second", "ArrowUp", "first", "before"],
  ])(
    "sorts from %s using %s at the displayed %s %s boundary",
    async (source, direction, anchor, edge) => {
      const { onReorder } = mount([task("first"), task("second")])
      const first = screen.getByTestId("first")
      const second = screen.getByTestId("second")
      layout([first, second])
      const handle = within(screen.getByTestId(source)).getByRole("button")
      handle.focus()
      fireEvent.keyDown(handle, { code: "Space", key: " " })
      await act(() => new Promise((resolve) => window.setTimeout(resolve, 0)))
      fireEvent.keyDown(document, { code: direction, key: direction })
      await waitFor(() =>
        expect(
          screen
            .getByTestId(anchor)
            .querySelector('[data-slot="sidebar-drop-indicator"]')
        ).toHaveAttribute("data-edge", edge)
      )
      fireEvent.keyDown(document, { code: "Space", key: " " })
      await waitFor(() =>
        expect(onReorder).toHaveBeenCalledWith({
          group: "recent",
          categoryId: null,
          conversationIds: ["second", "first"],
        })
      )
    }
  )

  it.each([false, true])(
    "moves a single task onto an empty category, collapsed=%s",
    async (collapsed) => {
      const { onMove, onReorder } = mount([task("task")])
      if (collapsed)
        fireEvent.click(screen.getByRole("button", { name: "生活" }))
      const header = categoryHeader("生活")
      const row = screen.getByTestId("task")
      layout([header, row])
      await startDrag(row, 50)
      fireEvent.pointerMove(document, { clientX: 20, clientY: 10 })
      await waitFor(() =>
        expect(header).toHaveAttribute("data-drop-target", "true")
      )
      expect(header).toHaveClass(
        "data-[drop-target]:bg-[var(--app-sidebar-hover)]"
      )
      expect(
        header.querySelector('[data-slot="sidebar-drop-indicator"]')
      ).toHaveAttribute("data-edge", "after")
      expect(header.className).not.toMatch(
        /data-\[drop-target\]:(?:ring|border|outline)/u
      )
      expect(within(header).getByText("生活")).not.toHaveAttribute("title")
      const previewTitle = screen.getByText("task", {
        selector: '[aria-hidden="true"] span',
      })
      const preview = previewTitle.parentElement!
      expect(preview).toHaveClass("h-8", "items-center", "opacity-80")
      expect(previewTitle).toHaveClass("font-medium")
      expect(preview.className).not.toMatch(
        /(?:^|\s)(?:ring|border|outline)(?:-|\s|$)/u
      )
      fireEvent.pointerUp(document)
      await waitFor(() =>
        expect(onMove).toHaveBeenCalledWith("task", "category-1")
      )
      expect(onReorder).not.toHaveBeenCalled()
      expect(header).not.toHaveAttribute("data-drop-target")
      expect(
        document.querySelector('[data-slot="sidebar-drop-indicator"]')
      ).toBeNull()
      expect(within(header).getByText("生活")).toHaveAttribute("title", "生活")
    }
  )

  it("keeps every row stationary and shows the exact insertion boundary", async () => {
    const { onReorder } = mount([
      task("first", "category-0"),
      task("second", "category-0"),
      { ...task("third", "category-0"), sort_order: 2 },
    ])
    const first = screen.getByTestId("first")
    const second = screen.getByTestId("second")
    const third = screen.getByTestId("third")
    layout([first, second, third])
    await startDrag(first, 10)
    fireEvent.pointerMove(document, { clientX: 20, clientY: 90 })
    await waitFor(() =>
      expect(
        third.querySelector('[data-slot="sidebar-drop-indicator"]')
      ).toHaveAttribute("data-edge", "before")
    )
    for (const row of [first, second, third])
      expect(row.style.transform).toBe("")
    expect(
      first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy()
    expect(
      second.compareDocumentPosition(third) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy()
    expect(
      document.querySelectorAll('[data-slot="sidebar-drop-indicator"]')
    ).toHaveLength(1)
    fireEvent.pointerMove(document, { clientX: 20, clientY: 110 })
    await waitFor(() =>
      expect(
        third.querySelector('[data-slot="sidebar-drop-indicator"]')
      ).toHaveAttribute("data-edge", "after")
    )
    fireEvent.pointerUp(document)
    await waitFor(() =>
      expect(onReorder).toHaveBeenCalledWith({
        group: "recent",
        categoryId: "category-0",
        conversationIds: ["second", "third", "first"],
      })
    )
    expect(
      document.querySelector('[data-slot="sidebar-drop-indicator"]')
    ).toBeNull()
  })

  it("clears the insertion marker outside the list and on cancellation", async () => {
    const { onReorder, onMove } = mount([task("first"), task("second")])
    const first = screen.getByTestId("first")
    layout([first, screen.getByTestId("second")])
    await startDrag(first, 10)
    fireEvent.pointerMove(document, { clientX: 20, clientY: 70 })
    await waitFor(() =>
      expect(
        document.querySelector('[data-slot="sidebar-drop-indicator"]')
      ).not.toBeNull()
    )
    fireEvent.pointerMove(document, { clientX: 400, clientY: 70 })
    await waitFor(() =>
      expect(
        document.querySelector('[data-slot="sidebar-drop-indicator"]')
      ).toBeNull()
    )
    fireEvent.pointerMove(document, { clientX: 20, clientY: 70 })
    fireEvent.keyDown(document, { code: "Escape", key: "Escape" })
    expect(
      document.querySelector('[data-slot="sidebar-drop-indicator"]')
    ).toBeNull()
    expect(onReorder).not.toHaveBeenCalled()
    expect(onMove).not.toHaveBeenCalled()
  })

  it.each([false, true])(
    "moves a categorized task without changing its pinned state, pinned=%s",
    async (pinned) => {
      const { onMove, onReorder } = mount([task("task", "category-0", pinned)])
      const row = screen.getByTestId("task")
      const header = categoryHeader("生活")
      layout([header, row])
      await startDrag(row, 50)
      fireEvent.pointerMove(document, { clientX: 20, clientY: 10 })
      fireEvent.pointerUp(document)
      await waitFor(() =>
        expect(onMove).toHaveBeenCalledWith("task", "category-1")
      )
      expect(onReorder).not.toHaveBeenCalled()
    }
  )

  it.each(["same-category", "outside", "cancel", "other-group-row"])(
    "leaves the task unchanged after %s",
    async (destination) => {
      const { onMove, onReorder } = mount([
        task("task", "category-0"),
        task("other", "category-1"),
      ])
      const row = screen.getByTestId("task")
      const target =
        destination === "other-group-row"
          ? screen.getByTestId("other")
          : categoryHeader(destination === "same-category" ? "工作" : "生活")
      layout([target, row])
      await startDrag(row, 50)
      fireEvent.pointerMove(document, {
        clientX: destination === "outside" ? 400 : 20,
        clientY: 10,
      })
      if (destination === "cancel")
        fireEvent.keyDown(document, { code: "Escape", key: "Escape" })
      else fireEvent.pointerUp(document)
      await waitFor(() => expect(row).not.toHaveAttribute("data-dragging"))
      expect(onMove).not.toHaveBeenCalled()
      expect(onReorder).not.toHaveBeenCalled()
    }
  )

  it.each([
    { categoryId: "category-0", pinned: false },
    { categoryId: null, pinned: false },
    { categoryId: "category-0", pinned: true },
  ])(
    "continues to reorder within the source group: %j",
    async ({ categoryId, pinned }) => {
      const { onMove, onReorder } = mount([
        task("first", categoryId, pinned),
        task("second", pinned ? "category-1" : categoryId, pinned),
      ])
      const first = screen.getByTestId("first")
      layout([first, screen.getByTestId("second")])
      await startDrag(first, 10)
      fireEvent.pointerMove(document, { clientX: 20, clientY: 70 })
      fireEvent.pointerUp(document)
      await waitFor(() =>
        expect(onReorder).toHaveBeenCalledWith({
          group: pinned ? "pinned" : "recent",
          categoryId: pinned ? null : categoryId,
          conversationIds: ["second", "first"],
        })
      )
      expect(onMove).not.toHaveBeenCalled()
    }
  )

  it("reports a failed move and retains the source task", async () => {
    const { onMove, onError } = mount([task("task", "category-0")])
    const error = new Error("move failed")
    onMove.mockRejectedValueOnce(error)
    const row = screen.getByTestId("task")
    layout([categoryHeader("生活"), row])
    await startDrag(row, 50)
    fireEvent.pointerMove(document, { clientX: 20, clientY: 10 })
    fireEvent.pointerUp(document)
    await waitFor(() => expect(onError).toHaveBeenCalledWith(error))
    expect(
      within(screen.getByRole("region", { name: "工作" })).getByTestId("task")
    ).toBeVisible()
    expect(
      screen.getByRole("button", { name: /使用键盘调整任务/u })
    ).toBeEnabled()
  })

  it("disables dragging while the task list is incomplete or saving", () => {
    mount([task("task")], true)
    expect(
      screen.getByRole("button", { name: /使用键盘调整任务/u })
    ).toBeDisabled()
    const row = screen.getByTestId("task")
    fireEvent.pointerDown(row, {
      button: 0,
      clientX: 20,
      clientY: 10,
      isPrimary: true,
    })
    fireEvent.pointerMove(document, { clientX: 20, clientY: 20 })
    expect(row).not.toHaveAttribute("data-dragging")
  })

  it.each(["zh-CN", "en-US", "fr-FR"])(
    "supports keyboard category drops and localized feedback in %s",
    async (locale) => {
      await i18n.changeLanguage(locale)
      const { onMove } = mount([task("task")])
      const row = screen.getByTestId("task")
      const header = categoryHeader("生活")
      layout([header, row])
      const handle = within(row).getByRole("button")
      handle.focus()
      fireEvent.keyDown(handle, { code: "Space", key: " " })
      await waitFor(() => expect(row).toHaveAttribute("data-dragging", "true"))
      await act(() => new Promise((resolve) => window.setTimeout(resolve, 0)))
      fireEvent.keyDown(document, { code: "ArrowUp", key: "ArrowUp" })
      await waitFor(() =>
        expect(header).toHaveAttribute("data-drop-target", "true")
      )
      fireEvent.keyDown(document, { code: "Space", key: " " })
      await waitFor(() =>
        expect(onMove).toHaveBeenCalledWith("task", "category-1")
      )
      await waitFor(() =>
        expect(
          screen.getByText(
            locale === "en-US"
              ? "Moved task “task” into category “生活”."
              : "已将任务“task”移入分类“生活”。"
          )
        ).toHaveAttribute("role", "status")
      )
    }
  )

  it("blocks a second drag until a move finishes", async () => {
    const { onMove } = mount([task("task")])
    let complete: () => void = () => undefined
    onMove.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          complete = resolve
        })
    )
    const row = screen.getByTestId("task")
    layout([categoryHeader("生活"), row])
    await startDrag(row, 50)
    fireEvent.pointerMove(document, { clientX: 20, clientY: 10 })
    fireEvent.pointerUp(document)
    await waitFor(() => expect(within(row).getByRole("button")).toBeDisabled())
    fireEvent.pointerDown(row, {
      button: 0,
      clientX: 20,
      clientY: 50,
      isPrimary: true,
    })
    fireEvent.pointerMove(document, { clientX: 20, clientY: 10 })
    fireEvent.pointerUp(document)
    expect(onMove).toHaveBeenCalledTimes(1)
    await act(async () => complete())
    expect(within(row).getByRole("button")).toBeEnabled()
  })

  it("restores the original order when saving the new order fails", async () => {
    const { onReorder, onError } = mount([
      task("first", "category-0"),
      task("second", "category-0"),
    ])
    const error = new Error("order failed")
    onReorder.mockRejectedValueOnce(error)
    const first = screen.getByTestId("first")
    layout([first, screen.getByTestId("second")])
    await startDrag(first, 10)
    fireEvent.pointerMove(document, { clientX: 20, clientY: 70 })
    fireEvent.pointerUp(document)
    await waitFor(() => expect(onError).toHaveBeenCalledWith(error))
    expect(
      first.compareDocumentPosition(screen.getByTestId("second")) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy()
  })
})
