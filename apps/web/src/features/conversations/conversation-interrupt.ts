import { runnerTurnInterruptResultSchema } from "@linksense/shared"
import { z } from "zod"

import { ApiError, apiRequest } from "@/api/client"

const interruptReceiptSchema = runnerTurnInterruptResultSchema.strip()

export const conversationInterruptTimeoutMs = 20_000
export const conversationInterruptPollIntervalMs = 1_000

export type ConversationInterruptTarget = Readonly<{
  conversationId: string
  turnId?: string
  submissionKey?: string
}>

export async function interruptConversationTurn(
  conversationId: string,
  turnId: string
): Promise<void> {
  await requestInterrupt(
    `/conversations/${conversationId}/turns/${turnId}/interrupt`
  )
}

export async function interruptDesktopTurnSubmission(
  conversationId: string,
  idempotencyKey: string
): Promise<void> {
  const body = { idempotency_key: z.uuid().parse(idempotencyKey) }
  await requestInterrupt(
    `/conversations/${conversationId}/turn-start/interrupt`,
    body
  )
}

async function requestInterrupt(
  path: string,
  body?: { idempotency_key: string }
): Promise<void> {
  const controller = new AbortController()
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      reject(
        new ApiError({ status: 0, errorCode: "TURN_INTERRUPT_REQUEST_FAILED" })
      )
      controller.abort()
    }, conversationInterruptTimeoutMs)
  })
  try {
    // Bound the whole authenticated operation, including session refresh.
    await Promise.race([
      apiRequest(path, {
        method: "POST",
        body,
        schema: interruptReceiptSchema,
        signal: controller.signal,
      }),
      timeout,
    ])
  } finally {
    clearTimeout(timer)
  }
}
