// @vitest-environment node

import { describe, expect, it } from "vitest"

import {
  clearLocalConversationDraft,
  consumeAcceptedLocalConversationDraft,
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
  it("retains a pending receipt across hydration but never discards an edited draft", () => {
    const storage = memoryStorage()
    const draft = {
      input: "submitted",
      capabilityIds: ["skill-1"],
      knowledgeBaseIds: [],
    }
    writeLocalConversationDraft(storage, "user-1", "task-1", {
      ...draft,
      idempotencyKey: "submission-1",
    })
    writeLocalConversationDraft(storage, "user-1", "task-1", draft)
    expect(
      consumeAcceptedLocalConversationDraft(storage, "user-1", "task-1", [
        "unrelated",
      ])
    ).toBeNull()
    expect(
      readLocalConversationDraft(storage, "user-1", "task-1").idempotencyKey
    ).toBe("submission-1")
    expect(
      consumeAcceptedLocalConversationDraft(storage, "user-1", "task-1", [
        "submission-1",
      ])?.input
    ).toBe("submitted")
    expect(readLocalConversationDraft(storage, "user-1", "task-1").input).toBe(
      ""
    )

    for (const edited of [
      { ...draft, input: "unsent edit" },
      { ...draft, capabilityIds: [] },
      { ...draft, knowledgeBaseIds: ["kb-1"] },
    ]) {
      writeLocalConversationDraft(storage, "user-1", "task-1", {
        ...draft,
        idempotencyKey: "submission-1",
      })
      writeLocalConversationDraft(storage, "user-1", "task-1", edited)
      expect(
        consumeAcceptedLocalConversationDraft(storage, "user-1", "task-1", [
          "submission-1",
        ])
      ).toBeNull()
      expect(readLocalConversationDraft(storage, "user-1", "task-1")).toEqual(
        edited
      )
    }
  })
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
