import { describe, expect, it } from "vitest"

import {
  createConversationDraftSnapshot,
  mergeConversationDraftSnapshots,
} from "@/features/conversations/conversation-draft-sync"

describe("conversation draft synchronization", () => {
  it("keeps the local draft when only the local side changed", () => {
    const base = createConversationDraftSnapshot("", [], [])
    const local = createConversationDraftSnapshot("当前页面内容", [], [])

    expect(mergeConversationDraftSnapshots(base, local, base)).toEqual({
      snapshot: local,
      conflictingFields: [],
    })
  })

  it("combines changes made to different draft fields", () => {
    const base = createConversationDraftSnapshot("", [], [])
    const local = createConversationDraftSnapshot("当前页面内容", [], [])
    const remote = createConversationDraftSnapshot("", [], ["kb-1"])

    expect(mergeConversationDraftSnapshots(base, local, remote)).toEqual({
      snapshot: createConversationDraftSnapshot("当前页面内容", [], ["kb-1"]),
      conflictingFields: [],
    })
  })

  it("reports a conflict when both sides changed the same field", () => {
    const base = createConversationDraftSnapshot("原始内容", [], [])
    const local = createConversationDraftSnapshot("当前页面内容", [], [])
    const remote = createConversationDraftSnapshot("服务器最新内容", [], [])

    expect(mergeConversationDraftSnapshots(base, local, remote)).toEqual({
      snapshot: local,
      conflictingFields: ["input"],
    })
  })

  it("does not treat matching concurrent changes as a conflict", () => {
    const base = createConversationDraftSnapshot("", [], [])
    const matching = createConversationDraftSnapshot(
      "相同内容",
      ["skill-1"],
      []
    )

    expect(mergeConversationDraftSnapshots(base, matching, matching)).toEqual({
      snapshot: matching,
      conflictingFields: [],
    })
  })
})
