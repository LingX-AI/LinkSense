import { describe, expect, it } from "vitest"

import { operationAttemptId } from "@/features/conversations/operation-id"

describe("operationAttemptId", () => {
  it("stays stable for retries and rotates after a successful operation resets it", () => {
    const reference: { current: string | null } = { current: null }
    const first = operationAttemptId(reference)

    expect(operationAttemptId(reference)).toBe(first)

    reference.current = null
    expect(operationAttemptId(reference)).not.toBe(first)
  })
})
