import { QueryClient } from "@tanstack/react-query"
import { afterEach, describe, expect, it, vi } from "vitest"
import { interactiveApplicationTaskInputSchema } from "@linksense/shared"

import { ApiError, apiRequest } from "@/api/client"
import {
  getPendingConversationTurnSubmission,
  setPendingConversationTurnSubmission,
} from "@/features/conversations/conversation-pending-turn-submission"
import {
  getPendingConversationExecution,
  markConversationExecutionPending,
} from "@/features/conversations/conversation-pending-execution"
import { createInteractiveApplicationSubmitter } from "./interactive-application-submission"

vi.mock("@/api/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/api/client")>()),
  apiRequest: vi.fn(),
}))

const applicationId = "20000000-0000-4000-8000-000000000001"
const conversationId = "30000000-0000-4000-8000-000000000001"
const receipt = {
  accepted: true,
  turn_id: "40000000-0000-4000-8000-000000000001",
  status: "starting",
} as const
const input = interactiveApplicationTaskInputSchema.parse({
  prompt: "研究要求",
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.clearAllMocks()
})

describe("interactive application submission", () => {
  it("does not let a late receipt overwrite a newer native submission", async () => {
    const queryClient = new QueryClient()
    vi.mocked(apiRequest).mockResolvedValueOnce(receipt)
    const promise = createInteractiveApplicationSubmitter({
      queryClient,
      applicationId,
      conversationId,
    })(input)
    const newer = {
      conversationId,
      idempotencyKey: "newer",
      message: { id: "newer", role: "user", content: "新的任务" },
    } as const
    setPendingConversationTurnSubmission(queryClient, conversationId, newer)
    markConversationExecutionPending(queryClient, conversationId)
    await promise
    expect(
      getPendingConversationTurnSubmission(queryClient, conversationId)
    ).toEqual(newer)
    expect(
      getPendingConversationExecution(queryClient, conversationId)
    ).toEqual({ turnId: null })
  })
  it("deduplicates a repeated click while retaining the full prompt and resource selection", async () => {
    const queryClient = new QueryClient()
    const submit = createInteractiveApplicationSubmitter({
      queryClient,
      applicationId,
      conversationId,
    })
    vi.mocked(apiRequest).mockResolvedValue(receipt)
    const selectedInput = {
      ...input,
      prompt: "完整提示词\n".repeat(100),
      capability_ids: ["skill-1"],
      knowledge_base_ids: ["50000000-0000-4000-8000-000000000001"],
    }
    const first = submit(selectedInput)
    expect(submit(selectedInput)).toBe(first)
    expect(
      getPendingConversationTurnSubmission(queryClient, conversationId)?.message
        .content
    ).toBe(selectedInput.prompt)
    await expect(
      submit({ ...selectedInput, prompt: "不同要求" })
    ).rejects.toMatchObject({ errorCode: "CONFLICT" })
    await expect(first).resolves.toEqual(receipt)
    await expect(submit(selectedInput)).resolves.toEqual(receipt)
    expect(apiRequest).toHaveBeenCalledOnce()
    expect(apiRequest).toHaveBeenCalledWith(
      `/conversations/${conversationId}/turns`,
      expect.objectContaining({
        body: expect.objectContaining({
          input_text: selectedInput.prompt,
          priority_capability_ids: selectedInput.capability_ids,
          knowledge_base_ids: selectedInput.knowledge_base_ids,
          message_source: "interactive_application",
        }),
      })
    )
  })

  it("does not replace a native chat submission or submit into an executing conversation", async () => {
    const queryClient = new QueryClient()
    const submit = createInteractiveApplicationSubmitter({
      queryClient,
      applicationId,
      conversationId,
    })
    const pending = {
      conversationId,
      idempotencyKey: "native",
      message: { id: "native", role: "user", content: "手动提交" },
    } as const
    setPendingConversationTurnSubmission(queryClient, conversationId, pending)
    await expect(submit(input)).rejects.toMatchObject({ errorCode: "CONFLICT" })
    expect(
      getPendingConversationTurnSubmission(queryClient, conversationId)
    ).toEqual(pending)
    const otherClient = new QueryClient()
    markConversationExecutionPending(otherClient, conversationId)
    await expect(
      createInteractiveApplicationSubmitter({
        queryClient: otherClient,
        applicationId,
        conversationId,
      })(input)
    ).rejects.toMatchObject({ errorCode: "CONFLICT" })
    expect(apiRequest).not.toHaveBeenCalled()
  })

  it("keeps the same idempotency key when the user resubmits after a lost response, without automatically replaying", async () => {
    const queryClient = new QueryClient()
    const submit = createInteractiveApplicationSubmitter({
      queryClient,
      applicationId,
      conversationId,
    })
    vi.mocked(apiRequest)
      .mockRejectedValueOnce(
        new ApiError({ status: 0, errorCode: "NETWORK_UNAVAILABLE" })
      )
      .mockResolvedValueOnce(receipt)
    await expect(submit(input)).rejects.toMatchObject({
      errorCode: "NETWORK_UNAVAILABLE",
    })
    expect(apiRequest).toHaveBeenCalledOnce()
    expect(
      getPendingConversationTurnSubmission(queryClient, conversationId)
    ).toBeNull()
    await expect(submit(input)).resolves.toEqual(receipt)
    const bodies = vi
      .mocked(apiRequest)
      .mock.calls.map(([, options]) => options?.body)
    expect(bodies[0]).toEqual(bodies[1])
  })

  it("preserves a stop request when binding the server receipt to the optimistic message", async () => {
    const queryClient = new QueryClient()
    vi.mocked(apiRequest).mockResolvedValueOnce(receipt)
    const promise = createInteractiveApplicationSubmitter({
      queryClient,
      applicationId,
      conversationId,
    })(input)
    const pending = getPendingConversationTurnSubmission(
      queryClient,
      conversationId
    )!
    setPendingConversationTurnSubmission(queryClient, conversationId, {
      ...pending,
      interruptRequested: true,
    })
    await promise
    expect(
      getPendingConversationTurnSubmission(queryClient, conversationId)
    ).toMatchObject({ interruptRequested: true, turnId: receipt.turn_id })
  })
})
