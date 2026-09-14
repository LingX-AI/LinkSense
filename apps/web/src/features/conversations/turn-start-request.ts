import { ApiError, apiRequest } from "@/api/client"
import { turnStartReceiptSchema, type TurnStartReceipt } from "@/api/contracts"
import { retireOperationId, type OperationReference } from "./operation-id"

export async function requestTurnStart(
  reference: OperationReference,
  path: string,
  body: Record<string, unknown> & { idempotency_key: string }
): Promise<TurnStartReceipt> {
  try {
    return await apiRequest(path, {
      method: "POST",
      body,
      schema: turnStartReceiptSchema,
    })
  } catch (error) {
    if (error instanceof ApiError && error.errorCode === "TURN_START_CLOSED") {
      retireOperationId(reference, body.idempotency_key)
    }
    // Advance only on the next explicit submission. Transport failures and
    // uncertain native results retain their ID and must never replay a turn.
    throw error
  }
}
