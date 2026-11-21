import {
  computerActResultSchema,
  computerObservationSchema,
  computerStatusResultSchema,
  type ComputerActInput,
  type ComputerExecuteInput,
  type ComputerExecuteResult,
  type DesktopToolResult,
} from "@linksense/shared"
import {
  ComputerUseFailureError,
  type ComputerUseExecutor,
} from "../../../src/mcp/core-services/computer-use-service.js"
import type { DesktopLink } from "../../../src/desktop/link.js"
import type { DesktopRuntimeRun } from "../../../src/desktop/turns.js"

/**
 * Fixture-only adapter between the host-side computer_use executor contract and
 * the existing authenticated desktop tool.request channel.
 *
 * This is deliberately not registered in production: the real M1b worker will
 * reach the Mac engine through the Go bridge, while this adapter lets a test
 * drive the exact same request/result envelopes with fault injection.
 */
export function desktopComputerUseExecutor(link: DesktopLink, run: DesktopRuntimeRun): ComputerUseExecutor {
  const request = async (input: ComputerExecuteInput, signal: AbortSignal): Promise<ComputerExecuteResult> => {
    const result = await link.requestTool(run, { operation: "computer.execute", body: input }, signal)
    if (!result.ok) throw new ComputerUseFailureError(toolFailure(result))
    if (result.operation !== "computer.execute") throw new ComputerUseFailureError("RUNNER_OPERATION_UNCERTAIN")
    return result.data
  }
  return {
    async status({ signal }) {
      const result = await request({ kind: "status" }, signal)
      if (result.kind === "failure") throw new ComputerUseFailureError(result.error)
      if (result.kind !== "status") throw new ComputerUseFailureError("RUNNER_OPERATION_UNCERTAIN")
      return computerStatusResultSchema.parse(result.result)
    },
    async observe({ signal }) {
      const result = await request({ kind: "observe" }, signal)
      if (result.kind === "failure") throw new ComputerUseFailureError(result.error)
      if (result.kind !== "observe") throw new ComputerUseFailureError("RUNNER_OPERATION_UNCERTAIN")
      return computerObservationSchema.parse(result.result)
    },
    async act(input) {
      const startedAt = Date.now()
      let act: ComputerActInput
      if (input.action === "type") {
        if (input.text === undefined) throw new ComputerUseFailureError("COMPUTER_INVALID")
        act = {
          action: "type", observation_id: input.observationId, ref: input.ref,
          text: input.text, timeout_ms: input.timeoutMs,
        }
      } else {
        act = { action: "click", observation_id: input.observationId, ref: input.ref, timeout_ms: input.timeoutMs }
      }
      const result = await request({ kind: "act", native_call_id: input.nativeCallId, input: act }, input.signal)
      if (result.kind === "failure") {
        return { ok: false, error: result.error, waited_ms: boundedWait(startedAt) }
      }
      if (result.kind !== "act") throw new ComputerUseFailureError("RUNNER_OPERATION_UNCERTAIN")
      return computerActResultSchema.parse(result.result)
    },
  }
}

function boundedWait(startedAt: number): number {
  return Math.min(Math.max(Date.now() - startedAt, 0), 20_000)
}

function toolFailure(result: Extract<DesktopToolResult, { ok: false }>): "RUNNER_OPERATION_UNCERTAIN" | "COMPUTER_ACCESS_DENIED" | "COMPUTER_UNAVAILABLE" {
  if (result.error_code === "RUNNER_OPERATION_UNCERTAIN") return "RUNNER_OPERATION_UNCERTAIN"
  if (result.error_code === "FORBIDDEN") return "COMPUTER_ACCESS_DENIED"
  return "COMPUTER_UNAVAILABLE"
}
