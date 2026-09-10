import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import type { Conversation } from "@/api/contracts"
import { SortableConversationGroup } from "@/features/conversations/sortable-conversation-group"
import { SidebarConversationDnd } from "./sidebar-conversation-dnd"
import i18n from "@/i18n"

const conversations = [
  {
    id: "task-first",
    title: "第一项任务",
    archived: false,
    category_id: null,
    updated_at: "2026-08-12T08:00:00.000Z",
    pinned_at: null,
    sort_order: 0,
    collaboration_mode: "default",
    has_unread_completion: false,
    has_automation: false,
    user_input_requests: [],
  },
  {
    id: "task-second",
    title: "第二项任务",
    archived: false,
    category_id: null,
    updated_at: "2026-08-12T07:00:00.000Z",
    pinned_at: null,
    sort_order: 1,
    collaboration_mode: "default",
    has_unread_completion: false,
    has_automation: false,
    user_input_requests: [],
  },
] satisfies Conversation[]

describe("sortable conversation group", () => {
  beforeEach(async () => {
    await i18n.changeLanguage("zh-CN")
  })

  afterEach(cleanup)

  it("uses the task row for pointer dragging without rendering a visible handle", () => {
    render(
      <SidebarConversationDnd
        conversations={conversations}
        categories={[]}
        disabled={false}
        onReorder={vi.fn(async () => undefined)}
        onReorderCategories={vi.fn(async () => undefined)}
        onMove={vi.fn(async () => undefined)}
        onError={vi.fn()}
      >
        <SortableConversationGroup conversations={conversations}>
          {(conversation, sortable) => (
            <div
              ref={sortable.setNodeRef}
              data-testid={`task-${conversation.id}`}
              data-dragging={sortable.isDragging || undefined}
              onPointerDown={sortable.onPointerDown}
            >
              <span>{conversation.title}</span>
              {sortable.keyboardActivator}
              {sortable.dropIndicator}
            </div>
          )}
        </SortableConversationGroup>
      </SidebarConversationDnd>
    )

    expect(screen.getAllByText(/项任务$/u)).toHaveLength(2)
    const keyboardActivator = screen.getByRole("button", {
      name: "使用键盘调整任务“第一项任务”，当前第 1 位",
    })
    expect(keyboardActivator).toHaveAttribute(
      "aria-roledescription",
      "sortable"
    )
    expect(keyboardActivator).toHaveClass("sr-only")
    expect(keyboardActivator.querySelector("svg")).toBeNull()
    expect(keyboardActivator).toBeEnabled()

    const firstTask = screen.getByTestId("task-task-first")
    fireEvent.pointerDown(firstTask, {
      button: 0,
      clientX: 10,
      clientY: 10,
      isPrimary: true,
    })
    fireEvent.pointerMove(document, { clientX: 10, clientY: 20 })
    expect(firstTask).toHaveAttribute("data-dragging", "true")
    fireEvent.pointerUp(document)
  })

  it("cancels native link navigation after a pointer drag", async () => {
    const openTask = vi.fn()

    render(
      <SidebarConversationDnd
        conversations={conversations}
        categories={[]}
        disabled={false}
        onReorder={vi.fn(async () => undefined)}
        onReorderCategories={vi.fn(async () => undefined)}
        onMove={vi.fn(async () => undefined)}
        onError={vi.fn()}
      >
        <SortableConversationGroup conversations={conversations}>
          {(conversation, sortable) => (
            <div
              ref={sortable.setNodeRef}
              data-testid={`task-${conversation.id}`}
              data-dragging={sortable.isDragging || undefined}
              onPointerDown={sortable.onPointerDown}
            >
              <a
                href={`/conversations/${conversation.id}`}
                data-testid={`task-link-${conversation.id}`}
                onClick={(event) => {
                  event.preventDefault()
                  openTask()
                }}
              >
                {conversation.title}
              </a>
              {sortable.keyboardActivator}
              {sortable.dropIndicator}
            </div>
          )}
        </SortableConversationGroup>
      </SidebarConversationDnd>
    )

    const firstTask = screen.getByTestId("task-task-first")
    const firstLink = screen.getByTestId("task-link-task-first")

    await new Promise((resolve) => window.setTimeout(resolve, 60))
    expect(fireEvent.click(firstLink)).toBe(false)
    expect(openTask).toHaveBeenCalledTimes(1)

    fireEvent.pointerDown(firstTask, {
      button: 0,
      clientX: 10,
      clientY: 10,
      isPrimary: true,
    })
    fireEvent.pointerMove(document, { clientX: 10, clientY: 20 })
    expect(firstTask).toHaveAttribute("data-dragging", "true")
    fireEvent.pointerUp(document)

    expect(fireEvent.click(firstLink)).toBe(false)
    expect(openTask).toHaveBeenCalledTimes(1)

    await new Promise((resolve) => window.setTimeout(resolve, 260))
    expect(fireEvent.click(firstLink)).toBe(false)
    expect(openTask).toHaveBeenCalledTimes(2)
  })
})
