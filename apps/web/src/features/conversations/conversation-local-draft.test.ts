import { describe, expect, it } from "vitest"

import {
  clearLocalConversationDraft,
  localConversationDraftStorageKey,
  readLocalConversationDraft,
  writeLocalConversationDraft,
} from "@/features/conversations/conversation-local-draft"

function memoryStorage(): Storage {
  const values = new Map<string, string>()
  return {
    get length() {
      return values.size
    },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => values.delete(key),
    setItem: (key, value) => values.set(key, value),
  }
}

describe("local conversation drafts", () => {
  it("isolates drafts by user and task", () => {
    const storage = memoryStorage()
    writeLocalConversationDraft(storage, "user-1", "task-1", {
      input: "继续分析",
      capabilityIds: ["skill-1"],
      knowledgeBaseIds: ["kb-1"],
    })

    expect(readLocalConversationDraft(storage, "user-1", "task-1")).toEqual({
      input: "继续分析",
      capabilityIds: ["skill-1"],
      knowledgeBaseIds: ["kb-1"],
    })
    expect(readLocalConversationDraft(storage, "user-2", "task-1")).toEqual({
      input: "",
      capabilityIds: [],
      knowledgeBaseIds: [],
    })
  })

  it("removes empty and successfully submitted drafts", () => {
    const storage = memoryStorage()
    const key = localConversationDraftStorageKey("user-1", "task-1")
    writeLocalConversationDraft(storage, "user-1", "task-1", {
      input: "待发送",
      capabilityIds: [],
      knowledgeBaseIds: [],
    })
    clearLocalConversationDraft(storage, "user-1", "task-1")
    expect(storage.getItem(key)).toBeNull()

    writeLocalConversationDraft(storage, "user-1", "task-1", {
      input: "",
      capabilityIds: [],
      knowledgeBaseIds: [],
    })
    expect(storage.getItem(key)).toBeNull()
  })

  it("ignores corrupt data and unavailable storage", () => {
    const storage = memoryStorage()
    const key = localConversationDraftStorageKey("user-1", "task-1")
    storage.setItem(key, "not-json")
    expect(readLocalConversationDraft(storage, "user-1", "task-1").input).toBe(
      ""
    )
    expect(storage.getItem(key)).toBeNull()

    const unavailable = {
      getItem: () => {
        throw new Error("disabled")
      },
      setItem: () => {
        throw new Error("disabled")
      },
      removeItem: () => {
        throw new Error("disabled")
      },
    }
    expect(readLocalConversationDraft(unavailable, "user-1", "task-1")).toEqual(
      { input: "", capabilityIds: [], knowledgeBaseIds: [] }
    )
    expect(() =>
      writeLocalConversationDraft(unavailable, "user-1", "task-1", {
        input: "内容",
        capabilityIds: [],
        knowledgeBaseIds: [],
      })
    ).not.toThrow()
  })
})
