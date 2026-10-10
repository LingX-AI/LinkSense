// @vitest-environment node

import { afterEach, describe, expect, it, vi } from "vitest"

import {
  operationAttemptId,
  retireOperationId,
  stableOperationId,
  type OperationReference,
} from "@/features/conversations/operation-id"

afterEach(() => vi.unstubAllGlobals())

function storageFixture(): Pick<Storage, "getItem" | "setItem"> {
  const entries = new Map<string, string>()
  return {
    getItem: (key) => entries.get(key) ?? null,
    setItem: (key, value) => {
      entries.set(key, value)
    },
  }
}

describe("stableOperationId", () => {
  const payload = {
    operation: "turn_start",
    conversation_id: "c1",
    input_text: "same message",
  }

  it.each([
    {
      input: "same message",
      original: "9c1d6815-d1a2-5906-b481-301745978a5e",
      next: "ccfea3fa-8228-5ab8-8c62-89b2835a2087",
    },
    {
      input: "普通 HTTP 的安全随机 ID 🔐",
      original: "6cc02104-a096-5a41-99ff-36cee9cdfceb",
      next: "402ca364-7c14-59f2-a005-736366ffe394",
    },
  ])(
    "preserves pre-change submission and stored retirement IDs over HTTP for $input",
    async ({ input, original, next }) => {
      vi.stubGlobal("crypto", {
        getRandomValues: crypto.getRandomValues.bind(crypto),
      })
      const submission = { ...payload, input_text: input }
      const reference: OperationReference = { current: null }
      const storage = storageFixture()
      expect(await stableOperationId(reference, submission, storage)).toBe(
        original
      )
      storage.setItem(`linksense.closed-operation.v1:${original}`, original)
      expect(
        await stableOperationId({ current: null }, submission, storage)
      ).toBe(next)
      expect(await stableOperationId(reference, submission, storage)).toBe(
        original
      )
      retireOperationId(reference, original, storage)
      expect(await stableOperationId(reference, submission, storage)).toBe(next)
    }
  )

  it("keeps the same ID across retries and reloads until that exact submission is closed", async () => {
    const storage = storageFixture()
    const reference: OperationReference = { current: null }
    const first = await stableOperationId(reference, payload, storage)
    expect(await stableOperationId(reference, payload, storage)).toBe(first)
    expect(await stableOperationId({ current: null }, payload, storage)).toBe(
      first
    )
    retireOperationId(reference, first, storage)
    const next = await stableOperationId(reference, payload, storage)
    expect(next).not.toBe(first)
    expect(await stableOperationId(reference, payload, storage)).toBe(next)
    expect(await stableOperationId({ current: null }, payload, storage)).toBe(
      next
    )
    retireOperationId(reference, next, storage)
    const third = await stableOperationId(reference, payload, storage)
    expect(third).not.toBe(first)
    expect(third).not.toBe(next)
    expect(await stableOperationId({ current: null }, payload, storage)).toBe(
      third
    )
  })

  it("does not retire a newer submission when an earlier request fails late", async () => {
    const storage = storageFixture()
    const reference: OperationReference = { current: null }
    const first = await stableOperationId(reference, payload, storage)
    const nextPayload = { ...payload, input_text: "next message" }
    const next = await stableOperationId(reference, nextPayload, storage)
    retireOperationId(reference, first, storage)
    expect(await stableOperationId(reference, nextPayload, storage)).toBe(next)
    expect(
      await stableOperationId({ current: null }, nextPayload, storage)
    ).toBe(next)
  })

  it("keeps other conversations and operations independent of a closed submission", async () => {
    const storage = storageFixture()
    const reference: OperationReference = { current: null }
    const otherPayload = { ...payload, conversation_id: "c2" }
    const other = await stableOperationId(
      { current: null },
      otherPayload,
      storage
    )
    const first = await stableOperationId(reference, payload, storage)
    retireOperationId(reference, first, storage)
    expect(
      await stableOperationId({ current: null }, otherPayload, storage)
    ).toBe(other)
    expect(
      await stableOperationId({ current: null }, payload, storage)
    ).not.toBe(first)
  })

  it("derives the same next submission when storage is unavailable and the closed ID is encountered again", async () => {
    const storage = {
      getItem: () => {
        throw new Error("unavailable")
      },
      setItem: () => {
        throw new Error("unavailable")
      },
    }
    const reference: OperationReference = { current: null }
    const first = await stableOperationId(reference, payload, storage)
    retireOperationId(reference, first, storage)
    const next = await stableOperationId(reference, payload, storage)
    const reloaded: OperationReference = { current: null }
    expect(await stableOperationId(reloaded, payload, storage)).toBe(first)
    retireOperationId(reloaded, first, storage)
    expect(await stableOperationId(reloaded, payload, storage)).toBe(next)
  })

  it("ignores malformed storage without changing the original operation identity", async () => {
    const original = await stableOperationId(
      { current: null },
      payload,
      storageFixture()
    )
    const storage = { getItem: () => "not-a-uuid", setItem: () => undefined }
    expect(await stableOperationId({ current: null }, payload, storage)).toBe(
      original
    )
  })
})

describe("operationAttemptId", () => {
  it("creates a stable secure attempt ID without native randomUUID", () => {
    vi.stubGlobal("crypto", {
      getRandomValues: crypto.getRandomValues.bind(crypto),
    })
    const reference: { current: string | null } = { current: null }
    const first = operationAttemptId(reference)
    expect(first).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
    )
    expect(operationAttemptId(reference)).toBe(first)
  })

  it("stays stable for retries and rotates after a successful operation resets it", () => {
    const reference: { current: string | null } = { current: null }
    const first = operationAttemptId(reference)

    expect(operationAttemptId(reference)).toBe(first)

    reference.current = null
    expect(operationAttemptId(reference)).not.toBe(first)
  })
})
