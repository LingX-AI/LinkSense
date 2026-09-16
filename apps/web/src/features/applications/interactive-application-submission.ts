import type { QueryClient } from "@tanstack/react-query"
import dayjs from "dayjs"
import type {
  InteractiveApplicationTaskInput,
  InteractiveApplicationFile,
} from "@linksense/shared"
import { interactiveApplicationFilesKey } from "./interactive-application-files"

import { ApiError, apiRequest } from "@/api/client"
import {
  turnStartReceiptSchema,
  type Conversation,
  type TurnStartReceipt,
} from "@/api/contracts"
import {
  clearPendingConversationTurnSubmission,
  getPendingConversationTurnSubmission,
  setPendingConversationTurnSubmission,
  updatePendingConversationTurnSubmission,
} from "@/features/conversations/conversation-pending-turn-submission"
import {
  bindPendingConversationTurn,
  clearPendingConversationExecution,
  getPendingConversationExecution,
  markConversationExecutionPending,
} from "@/features/conversations/conversation-pending-execution"

/** One submitter per application session; shared pending state is rendered by native chat. */
export function createInteractiveApplicationSubmitter({
  queryClient,
  applicationId,
  conversationId,
}: {
  queryClient: QueryClient
  applicationId: string
  conversationId: string
}): (input: InteractiveApplicationTaskInput) => Promise<TurnStartReceipt> {
  let active: {
    fingerprint: string
    promise: Promise<TurnStartReceipt>
  } | null = null
  let attempt: { fingerprint: string; idempotencyKey: string } | null = null

  return (input) => {
    const conversation = queryClient.getQueryData<Conversation>([
      "conversation",
      conversationId,
    ])
    const fingerprint = JSON.stringify({
      input,
      precedingTurnId: conversation?.turns?.at(-1)?.id ?? null,
    })
    if (active) {
      return active.fingerprint === fingerprint
        ? active.promise
        : Promise.reject(new ApiError({ status: 409, errorCode: "CONFLICT" }))
    }
    const pending = getPendingConversationTurnSubmission(
      queryClient,
      conversationId
    )
    if (
      pending ||
      getPendingConversationExecution(queryClient, conversationId) ||
      conversation?.running_turn
    ) {
      if (
        pending?.turnId &&
        pending.status &&
        attempt?.fingerprint === fingerprint &&
        pending.idempotencyKey === attempt.idempotencyKey
      ) {
        return Promise.resolve({
          turn_id: pending.turnId,
          accepted: true,
          status: pending.status,
        })
      }
      return Promise.reject(
        new ApiError({ status: 409, errorCode: "CONFLICT" })
      )
    }

    if (attempt?.fingerprint !== fingerprint) {
      attempt = {
        fingerprint,
        idempotencyKey:
          input.idempotency_key ?? `interactive:${crypto.randomUUID()}`,
      }
    }
    const idempotencyKey = attempt.idempotencyKey
    const optimisticId = crypto.randomUUID()
    const capabilities = new Map(
      conversation?.available_capabilities?.map((item) => [item.id, item])
    )
    const files =
      queryClient.getQueryData<{ items: InteractiveApplicationFile[] }>(
        interactiveApplicationFilesKey(conversationId)
      )?.items ?? []
    setPendingConversationTurnSubmission(queryClient, conversationId, {
      conversationId,
      idempotencyKey,
      optimisticId,
      message: {
        id: `optimistic-${optimisticId}`,
        role: "user",
        content: input.prompt,
        turn_id: null,
        created_at: dayjs().toISOString(),
        display: {
          kind: "interactive_application",
          application_id: applicationId,
        },
        delivery_status: "sending",
        selected_capabilities: input.capability_ids.flatMap((id) => {
          const capability = capabilities.get(id)
          return capability
            ? [{ id, name: capability.name, type: capability.type }]
            : []
        }),
        selected_knowledge_base_ids: input.knowledge_base_ids,
        attachments: files
          .filter((file) => input.file_ids.includes(file.id))
          .map((file) => ({
            ...file,
            name: file.filename,
            size: file.size_bytes,
            download_available: false,
          })),
      },
    })
    markConversationExecutionPending(queryClient, conversationId)

    const promise = apiRequest(`/conversations/${conversationId}/turns`, {
      method: "POST",
      body: {
        input_text: input.prompt,
        message_source: "interactive_application",
        file_ids: input.file_ids,
        priority_capability_ids: input.capability_ids,
        knowledge_base_ids: input.knowledge_base_ids,
        idempotency_key: idempotencyKey,
        collaboration_mode: "default",
      },
      schema: turnStartReceiptSchema,
    })
      .then(
        (receipt) => {
          if (
            getPendingConversationTurnSubmission(queryClient, conversationId)
              ?.optimisticId === optimisticId
          ) {
            updatePendingConversationTurnSubmission(
              queryClient,
              conversationId,
              (current) => ({
                ...current,
                turnId: receipt.turn_id,
                status: receipt.status,
                message: {
                  ...current.message,
                  turn_id: receipt.turn_id,
                  delivery_status: undefined,
                },
              })
            )
            bindPendingConversationTurn(
              queryClient,
              conversationId,
              receipt.turn_id
            )
          }
          // Refetch errors belong to the conversation query. An accepted submission
          // must not become a failed SDK request merely because this refresh is slow.
          void queryClient.invalidateQueries(
            { queryKey: ["conversation", conversationId], exact: true },
            { throwOnError: false }
          )
          return receipt
        },
        (error: unknown) => {
          if (
            getPendingConversationTurnSubmission(queryClient, conversationId)
              ?.optimisticId === optimisticId
          ) {
            clearPendingConversationTurnSubmission(queryClient, conversationId)
            clearPendingConversationExecution(queryClient, conversationId)
          }
          throw error
        }
      )
      .finally(() => {
        active = null
      })
    active = { fingerprint, promise }
    return promise
  }
}
