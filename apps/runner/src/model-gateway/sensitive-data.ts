import { setTimeout as delay } from "node:timers/promises"
import {
  sensitiveDataChoiceWaitMs,
  sensitiveDataContextLimit,
  type SensitiveDataRelayInput,
  type SensitiveDataRelayResult,
} from "@linksense/shared"

type ModelRequest = Record<string, unknown>
type RequestScope = Pick<SensitiveDataRelayInput, "conversation_id" | "execution_model" | "turn_id">
type LocalRuntime = Extract<SensitiveDataRelayResult, { action: "local" }>["runtime"]

export type SensitiveDataRelay = (
  ownerId: string,
  input: SensitiveDataRelayInput,
  signal: AbortSignal,
) => Promise<SensitiveDataRelayResult>

export class SensitiveDataRequestBlocked extends Error {
  constructor() {
    super("sensitive_data_protection_blocked")
    this.name = "SensitiveDataRequestBlocked"
  }
}

export async function resolveSensitiveDataRequest(
  relay: SensitiveDataRelay,
  ownerId: string,
  scope: RequestScope,
  target: { model: string; baseUrl: string; auxiliary: boolean },
  body: ModelRequest,
  signal: AbortSignal,
): Promise<{ body: ModelRequest; local: LocalRuntime | null }> {
  const result = await relay(ownerId, {
    kind: "inspect",
    ...scope,
    auxiliary: target.auxiliary,
    context: inspectionContext(body),
  }, signal)
  if (result.action === "forward") return { body, local: null }

  const decision = result.action === "waiting"
    ? await waitForSelection(relay, ownerId, scope, signal)
    : result
  signal.throwIfAborted()
  if (decision.action !== "local") throw new SensitiveDataRequestBlocked()
  const { runtime } = decision
  const sameTarget = target.model === runtime.model &&
    new URL(target.baseUrl).href === new URL(runtime.baseUrl).href
  return {
    body: sameTarget ? body : redirectModelRequest(body, runtime),
    local: runtime,
  }
}

async function waitForSelection(
  relay: SensitiveDataRelay,
  ownerId: string,
  scope: RequestScope,
  signal: AbortSignal,
): Promise<SensitiveDataRelayResult> {
  const waiting = AbortSignal.any([signal, AbortSignal.timeout(sensitiveDataChoiceWaitMs)])
  try {
    for (;;) {
      await delay(850, undefined, { signal: waiting })
      const decision = await relay(ownerId, { kind: "selection", ...scope }, waiting)
      if (decision.action !== "waiting") return decision
    }
  } catch (error) {
    if (!waiting.aborted || signal.aborted) throw error
    return { action: "blocked" }
  }
}

function inspectionContext(body: ModelRequest): string | null {
  if (containsUninspectableInput(body)) return null
  // Provider-issued reasoning ciphertext is already known to its provider.
  // Keep every other field, including JSON inside tool results.
  const input = body.input
  const inspected = Array.isArray(input) ? {
    ...body,
    input: input.map((item: unknown) => isRecord(item) && item.type === "reasoning"
      ? { ...item, encrypted_content: undefined }
      : item),
  } : body
  const serialized = JSON.stringify(inspected)
  if (serialized.length > sensitiveDataContextLimit ||
    Buffer.byteLength(serialized) > sensitiveDataContextLimit) return null
  return serialized
}

function containsUninspectableInput(body: ModelRequest): boolean {
  if (body.previous_response_id != null || body.conversation != null) return true
  const pending: unknown[] = [body.input]
  while (pending.length > 0) {
    const item = pending.pop()
    if (Array.isArray(item)) {
      for (const part of item) pending.push(part)
    } else if (isRecord(item)) {
      if (item.type === "input_image" || item.type === "input_file" ||
        item.type === "item_reference" || item.type === "computer_screenshot" ||
        item.type === "compaction") return true
      for (const value of Object.values(item)) {
        if (value !== null && typeof value === "object") pending.push(value)
      }
    }
  }
  return false
}

function redirectModelRequest(body: ModelRequest, runtime: LocalRuntime): ModelRequest {
  if (body.previous_response_id != null || body.conversation != null) {
    // A provider-held conversation cannot be reconstructed from this request.
    throw new SensitiveDataRequestBlocked()
  }
  const input = body.input
  if (Array.isArray(input) && input.some(
    (item: unknown) => isRecord(item) && (item.type === "item_reference" || item.type === "compaction"),
  )) throw new SensitiveDataRequestBlocked()

  const redirected = {
    ...body,
    model: runtime.model,
    ...(Array.isArray(input) ? {
      input: input.filter((item: unknown) => !(isRecord(item) && item.type === "reasoning")),
    } : {}),
    reasoning: { effort: runtime.reasoningEffort },
  }
  const request: ModelRequest = redirected
  delete request.service_tier
  delete request.prompt_cache_key
  return request
}

function isRecord(value: unknown): value is ModelRequest {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}
