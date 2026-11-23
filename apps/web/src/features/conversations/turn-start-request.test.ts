// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest"

import { ApiError } from "@/api/client"
import type { OperationReference } from "./operation-id"
import { requestTurnStart } from "./turn-start-request"

const mocks = vi.hoisted(() => ({ request: vi.fn() }))

vi.mock("@/api/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/api/client")>()),
  apiRequest: mocks.request,
}))

const reference: OperationReference = { current: null }
const body = { idempotency_key: "idempotency-key" }
const receipt = {
  accepted: true as const,
  status: "starting" as const,
  turn_id: "30000000-0000-4000-8000-000000000001",
}

beforeEach(() => {
  reference.current = null
  mocks.request.mockReset()
})

describe("turn start request", () => {
  it("forwards the attempt guard and login boundary to the physical request", async () => {
    mocks.request.mockResolvedValue(receipt)
    const beforeAttempt = vi.fn()

    await expect(
      requestTurnStart(reference, "/conversations/task/turns", body, {
        beforeAttempt,
        loginSessionBoundary: 7,
      })
    ).resolves.toEqual(receipt)

    expect(mocks.request).toHaveBeenCalledWith(
      "/conversations/task/turns",
      expect.objectContaining({
        method: "POST",
        body,
        beforeAttempt,
        loginSessionBoundary: 7,
      })
    )
  })

  it("retires the operation only when the server confirms the turn start is closed", async () => {
    const stable = {
      fingerprint: "fingerprint",
      baseId: "base-id",
      id: "idempotency-key",
    }
    reference.current = stable
    mocks.request.mockRejectedValue(
      new ApiError({ status: 409, errorCode: "TURN_START_CLOSED" })
    )

    await expect(
      requestTurnStart(reference, "/conversations/task/turns", body)
    ).rejects.toMatchObject({ errorCode: "TURN_START_CLOSED" })

    expect(reference.current).toMatchObject({
      ...stable,
      closedId: "idempotency-key",
    })
  })

  it("retains the operation for transport and uncertain results", async () => {
    const stable = {
      fingerprint: "fingerprint",
      baseId: "base-id",
      id: "idempotency-key",
    }
    reference.current = stable
    mocks.request.mockRejectedValue(
      new ApiError({ status: 0, errorCode: "NETWORK_UNAVAILABLE" })
    )

    await expect(
      requestTurnStart(reference, "/conversations/task/turns", body)
    ).rejects.toMatchObject({ errorCode: "NETWORK_UNAVAILABLE" })

    expect(reference.current).toEqual(stable)
  })
})
