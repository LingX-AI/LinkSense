import { describe, expect, it } from "vitest"

import {
  applySidebarConversationOrder,
  reorderConversationIds,
  sortSidebarConversations,
} from "@/features/conversations/conversation-order"

function conversation(
  id: string,
  updatedAt: string,
  sortOrder: number | null = null,
  pinnedAt: string | null = null
) {
  return {
    id,
    title: id,
    updated_at: updatedAt,
    pinned_at: pinnedAt,
    sort_order: sortOrder,
    collaboration_mode: "default",
    has_unread_completion: false,
  }
}

describe("sidebar conversation ordering", () => {
  it("keeps unranked new tasks first and persists ranked tasks by sort order", () => {
    const result = sortSidebarConversations(
      [
        conversation("ranked-last", "2026-08-12T08:00:00.000Z", 1),
        conversation("new", "2026-08-12T10:00:00.000Z"),
        conversation("ranked-first", "2026-08-12T09:00:00.000Z", 0),
      ],
      "recent"
    )

    expect(result.map((item) => item.id)).toEqual([
      "new",
      "ranked-first",
      "ranked-last",
    ])
  })

  it("moves a task to the dropped position without mutating the source", () => {
    const source = ["a", "b", "c"]

    expect(reorderConversationIds(source, "c", "a")).toEqual(["c", "a", "b"])
    expect(source).toEqual(["a", "b", "c"])
  })

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
})
