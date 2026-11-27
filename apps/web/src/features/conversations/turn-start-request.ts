import { ApiError, apiRequest, type ApiRequestOptions } from "@/api/client"
import { turnStartReceiptSchema, type TurnStartReceipt } from "@/api/contracts"
import { retireOperationId, type OperationReference } from "./operation-id"

export type TurnStartRequestOptions = Pick<
  ApiRequestOptions<never>,
  "beforeAttempt" | "loginSessionBoundary"
>

export async function requestTurnStart(
  reference: OperationReference,
  path: string,
  body: Record<string, unknown> & { idempotency_key: string },
  options?: TurnStartRequestOptions
): Promise<TurnStartReceipt> {
  try {
    return await apiRequest(path, {
      method: "POST",
      body,
      schema: turnStartReceiptSchema,
      ...(options?.beforeAttempt
        ? { beforeAttempt: options.beforeAttempt }
        : {}),
      ...(options?.loginSessionBoundary !== undefined
        ? { loginSessionBoundary: options.loginSessionBoundary }
        : {}),
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
