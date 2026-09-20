// @vitest-environment node

import { describe, expect, it } from "vitest"

import {
  applySidebarConversationOrder,
  patchConversationTitle,
  patchSidebarConversationExecutionStatus,
  patchSidebarConversationTitle,
  removeSidebarConversation,
  replaceSidebarConversation,
  reorderConversationIds,
  sortSidebarConversations,
  upsertSidebarConversation,
} from "@/features/conversations/conversation-order"

function conversation(
  id: string,
  updatedAt: string,
  sortOrder: number | null = null,
  pinnedAt: string | null = null,
  overrides: Partial<{
    created_at: string
    last_run_at: string | null
    execution_status: "idle" | "running" | "pending" | "completed"
    has_unread_completion: boolean
    needs_attention: boolean
  }> = {}
) {
  return {
    id,
    title: id,
    updated_at: updatedAt,
    pinned_at: pinnedAt,
    sort_order: sortOrder,
    collaboration_mode: "default",
    has_unread_completion: false,
    ...overrides,
  }
}

describe("sidebar conversation ordering", () => {
  it("keeps stored tasks first and appends new tasks in manual mode", () => {
    const result = sortSidebarConversations(
      [
        conversation("ranked-last", "2026-08-12T08:00:00.000Z", 1),
        conversation("new", "2026-08-12T10:00:00.000Z"),
        conversation("ranked-first", "2026-08-12T09:00:00.000Z", 0),
      ],
      "manual"
    )

    expect(result.map((item) => item.id)).toEqual([
      "ranked-first",
      "ranked-last",
      "new",
    ])
  })

  it("sorts by Codex recency instead of metadata update time", () => {
    const result = sortSidebarConversations(
      [
        conversation("metadata-newer", "2026-08-12T12:00:00.000Z", null, null, {
          created_at: "2026-08-12T07:00:00.000Z",
          last_run_at: "2026-08-12T08:00:00.000Z",
        }),
        conversation("activity-newer", "2026-08-12T09:00:00.000Z", null, null, {
          created_at: "2026-08-12T07:00:00.000Z",
          last_run_at: "2026-08-12T10:00:00.000Z",
        }),
      ],
      "updated_at"
    )

    expect(result.map((item) => item.id)).toEqual([
      "activity-newer",
      "metadata-newer",
    ])
  })

  it("uses Codex priority order and recency within each state", () => {
    const at = (hour: number) =>
      `2026-08-12T${String(hour).padStart(2, "0")}:00:00.000Z`
    const result = sortSidebarConversations(
      [
        conversation("idle", at(12)),
        conversation("active-old", at(8), null, null, {
          execution_status: "running",
        }),
        conversation("unread", at(7), null, null, {
          has_unread_completion: true,
        }),
        conversation("waiting", at(6), null, null, {
          needs_attention: true,
        }),
        conversation("active-new", at(10), null, null, {
          execution_status: "pending",
        }),
      ],
      "priority"
    )

    expect(result.map((item) => item.id)).toEqual([
      "waiting",
      "unread",
      "active-new",
      "active-old",
      "idle",
    ])
  })

  it("moves a task to the dropped position without mutating the source", () => {
    const source = ["a", "b", "c"]

    expect(reorderConversationIds(source, "c", "a", "before")).toEqual([
      "c",
      "a",
      "b",
    ])
    expect(source).toEqual(["a", "b", "c"])
  })

  it.each([
    ["a", "c", "after", ["b", "c", "a"]],
    ["a", "c", "before", ["b", "a", "c"]],
    ["c", "a", "after", ["a", "c", "b"]],
    ["c", "a", "before", ["c", "a", "b"]],
    ["a", "b", "before", ["a", "b", "c"]],
    ["b", "a", "after", ["a", "b", "c"]],
    ["b", "b", "after", ["a", "b", "c"]],
    ["missing", "b", "after", ["a", "b", "c"]],
  ] as const)(
    "places %s %s %s at the indicated boundary",
    (active, anchor, edge, expected) => {
      expect(
        reorderConversationIds(["a", "b", "c"], active, anchor, edge)
      ).toEqual(expected)
    }
  )

  it("applies a persisted sidebar order to cached list data without touching other groups", () => {
    const pinned = conversation(
      "pinned",
      "2026-08-12T11:00:00.000Z",
      9,
      "2026-08-12T11:00:00.000Z"
    )
    const first = conversation("first", "2026-08-12T10:00:00.000Z", 0)
    const second = conversation("second", "2026-08-12T09:00:00.000Z", 1)
    const data = {
      pages: [
        {
          items: [pinned, first, second],
          next_cursor: null,
        },
      ],
      pageParams: [undefined],
    }

    const result = applySidebarConversationOrder(data, "recent", [
      "second",
      "first",
    ])

    expect(result?.pages[0]?.items).toEqual([
      pinned,
      { ...first, sort_order: 1 },
      { ...second, sort_order: 0 },
    ])
    expect(result?.pages[0]?.items[0]).toBe(pinned)
  })

  it("inserts a newly created task into the first cached sidebar page without duplicating it", () => {
    const first = conversation("first", "2026-08-12T10:00:00.000Z")
    const second = conversation("second", "2026-08-12T09:00:00.000Z")
    const created = conversation("created", "2026-08-12T11:00:00.000Z")
    const data = {
      pages: [
        { items: [first], total_count: 2, next_cursor: "next" },
        { items: [second], total_count: 2, next_cursor: null },
      ],
      pageParams: [undefined, "next"],
    }

    const inserted = upsertSidebarConversation(data, created)
    const replaced = upsertSidebarConversation(inserted, {
      ...created,
      title: "created-updated",
    })

    expect(
      inserted?.pages.map((page) => page.items.map((item) => item.id))
    ).toEqual([["created", "first"], ["second"]])
    expect(inserted?.pages.map((page) => page.total_count)).toEqual([3, 3])
    expect(replaced?.pages[0]?.items[0]?.title).toBe("created-updated")
    expect(replaced?.pages.map((page) => page.total_count)).toEqual([3, 3])
    expect(data.pages[0]?.items).toEqual([first])
  })

  it("replaces a temporary new task without duplicating or changing the total", () => {
    const placeholder = conversation("new", "2026-08-12T10:00:00.000Z")
    const persisted = conversation("persisted", "2026-08-12T10:00:01.000Z")
    const existing = conversation("existing", "2026-08-12T09:00:00.000Z")
    const data = {
      pages: [
        {
          items: [placeholder, existing],
          total_count: 2,
          next_cursor: null,
        },
      ],
      pageParams: [undefined],
    }

    const result = replaceSidebarConversation(data, placeholder.id, persisted)

    expect(result?.pages[0]?.items).toEqual([persisted, existing])
    expect(result?.pages[0]?.total_count).toBe(2)
    expect(data.pages[0]?.items).toEqual([placeholder, existing])
  })

  it("removes an optimistic new task and restores the cached total", () => {
    const placeholder = conversation("new", "2026-08-12T10:00:00.000Z")
    const existing = conversation("existing", "2026-08-12T09:00:00.000Z")
    const data = {
      pages: [
        {
          items: [placeholder, existing],
          total_count: 2,
          next_cursor: null,
        },
      ],
      pageParams: [undefined],
    }

    const result = removeSidebarConversation(data, placeholder.id)

    expect(result?.pages[0]?.items).toEqual([existing])
    expect(result?.pages[0]?.total_count).toBe(1)
    expect(removeSidebarConversation(result, placeholder.id)).toBe(result)
  })

  it("patches only the matching cached task title", () => {
    const first = conversation("first", "2026-08-12T10:00:00.000Z")
    const second = conversation("second", "2026-08-12T09:00:00.000Z")
    const data = {
      pages: [
        { items: [first], next_cursor: "next" },
        { items: [second], next_cursor: null },
      ],
      pageParams: [undefined, "next"],
    }

    const result = patchSidebarConversationTitle(data, "second", "新标题")

    expect(result?.pages[0]).toBe(data.pages[0])
    expect(result?.pages[1]?.items[0]).toEqual({
      ...second,
      title: "新标题",
    })
    expect(second.title).toBe("second")
    expect(patchSidebarConversationTitle(result, "second", "新标题")).toBe(
      result
    )
  })

  it("does not replace a manually assigned cached task title", () => {
    const manual = {
      ...conversation("manual", "2026-08-12T10:00:00.000Z"),
      title: "手动标题",
      title_source: "manual",
    }
    const data = {
      pages: [{ items: [manual], next_cursor: null }],
      pageParams: [undefined],
    }

    expect(
      patchSidebarConversationTitle(data, manual.id, "延迟的自动标题")
    ).toBe(data)
    expect(patchConversationTitle(manual, "延迟的自动标题")).toBe(manual)
  })

  it("applies repeated manual renames immediately while retaining category and ordering metadata", () => {
    const task = {
      ...conversation("task", "2026-08-12T10:00:00.000Z"),
      project_id: "work",
      sort_order: 2,
      title_source: "manual",
    }
    const data = {
      pages: [{ items: [task], next_cursor: null }],
      pageParams: [undefined],
    }
    const renamed = patchSidebarConversationTitle(
      data,
      task.id,
      "新名称",
      "manual"
    )
    expect(renamed?.pages[0]?.items[0]).toEqual({ ...task, title: "新名称" })
    expect(data.pages[0]?.items[0]?.title).toBe("task")
    expect(
      patchSidebarConversationTitle(renamed, task.id, "延迟自动名称")
    ).toBe(renamed)
    expect(
      patchSidebarConversationTitle(renamed, task.id, "新名称", "manual")
    ).toBe(renamed)
  })

  it("marks a confirmed manual title even when its text has not changed", () => {
    expect(
      patchConversationTitle(
        { title: "任务", title_source: "generated" },
        "任务",
        "manual"
      )
    ).toEqual({ title: "任务", title_source: "manual" })
  })

  it("patches only the matching cached task execution status", () => {
    const first = {
      ...conversation("first", "2026-08-12T10:00:00.000Z"),
      execution_status: "completed" as const,
    }
    const second = {
      ...conversation("second", "2026-08-12T09:00:00.000Z"),
      execution_status: "idle" as const,
    }
    const data = {
      pages: [
        { items: [first], next_cursor: "next" },
        { items: [second], next_cursor: null },
      ],
      pageParams: [undefined, "next"],
    }

    const result = patchSidebarConversationExecutionStatus(
      data,
      "second",
      "running"
    )

    expect(result?.pages[0]).toBe(data.pages[0])
    expect(result?.pages[1]?.items[0]).toEqual({
      ...second,
      execution_status: "running",
    })
    expect(second.execution_status).toBe("idle")
    expect(
      patchSidebarConversationExecutionStatus(result, "second", "running")
    ).toBe(result)
  })

  it("updates unread completion only on the matching terminal task", () => {
    const first = {
      ...conversation("first", "2026-08-12T10:00:00.000Z"),
      execution_status: "running" as const,
      has_unread_completion: false,
    }
    const second = {
      ...conversation("second", "2026-08-12T09:00:00.000Z"),
      execution_status: "running" as const,
      has_unread_completion: false,
    }
    const data = {
      pages: [{ items: [first, second], next_cursor: null }],
      pageParams: [undefined],
    }

    const result = patchSidebarConversationExecutionStatus(
      data,
      "second",
      "completed",
      { hasUnreadCompletion: true }
    )

    expect(result?.pages[0]?.items).toEqual([
      first,
      {
        ...second,
        execution_status: "completed",
        has_unread_completion: true,
      },
    ])
  })
})
