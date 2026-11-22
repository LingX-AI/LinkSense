import {
  computerExecuteResultSchema,
  type ComputerActResult,
  type ComputerExecuteInput,
  type ComputerExecuteResult,
  type ComputerFailureCode,
  type ComputerObservation,
  type ComputerStatusResult,
} from "@linksense/shared";
import { z } from "zod";

import type {
  CoreMcpCollaborationMode,
  CoreMcpModuleDefinition,
} from "../core-service-module.js";
import {
  ComputerUseFailureError,
  createComputerUseCoreMcpModule,
  type ComputerUseExecutor,
} from "./computer-use-service.js";

const endpointSchema = z.url();
const tokenSchema = z.string().min(32).max(512);
const relayResponseSchema = z.union([
  computerExecuteResultSchema,
  z.strictObject({ error_code: z.string().min(1).max(120) }),
]);

/**
 * Production adapter for one macOS supervised worker that negotiated
 * `computer.execute`. It posts only the closed ComputerExecuteInput shape to
 * the worker's authenticated callback; the target, holder, selection and
 * session are supplied by the host/API and never by this process.
 */
export function createComputerUseRelayExecutor(input: {
  endpoint: string;
  token: string;
  fetch?: typeof globalThis.fetch;
}): ComputerUseExecutor {
  const endpoint = endpointSchema.parse(input.endpoint);
  const token = tokenSchema.parse(input.token);
  const fetcher = input.fetch ?? globalThis.fetch;

  const send = async (
    request: ComputerExecuteInput,
    signal: AbortSignal,
  ): Promise<ComputerExecuteResult> => {
    const effect = request.kind === "act";
    let response: Response;
    try {
      response = await fetcher(new URL(endpoint), {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          input: request,
          ...(effect ? { nativeCallId: request.native_call_id } : {}),
        }),
        signal,
      });
    } catch {
      return failure(effect ? "RUNNER_OPERATION_UNCERTAIN" : "COMPUTER_UNAVAILABLE");
    }
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      return failure(httpFailure(response.status, effect));
    }
    const parsed = relayResponseSchema.safeParse(
      await response.json().catch(() => null),
    );
    if (!parsed.success) {
      return failure(effect ? "RUNNER_OPERATION_UNCERTAIN" : "COMPUTER_UNAVAILABLE");
    }
    if (!("kind" in parsed.data)) {
      return failure(httpFailure(response.status, effect, parsed.data.error_code));
    }
    if (
      parsed.data.kind === "failure" &&
      !effect &&
      parsed.data.error === "RUNNER_OPERATION_UNCERTAIN"
    ) {
      // Reads have no effect to reconcile: an ambiguous transport failure is
      // simply unavailable.
      return failure("COMPUTER_UNAVAILABLE");
    }
    return parsed.data;
  };

  return {
    async status({ signal }) {
      const result = await send({ kind: "status" }, signal);
      if (result.kind === "failure") throw new ComputerUseFailureError(result.error);
      if (result.kind !== "status") {
        throw new ComputerUseFailureError("COMPUTER_UNAVAILABLE");
      }
      return result.result as ComputerStatusResult;
    },
    async observe({ signal }) {
      const result = await send({ kind: "observe" }, signal);
      if (result.kind === "failure") throw new ComputerUseFailureError(result.error);
      if (result.kind !== "observe") {
        throw new ComputerUseFailureError("COMPUTER_UNAVAILABLE");
      }
      return result.result as ComputerObservation;
    },
    async act(request) {
      const startedAt = Date.now();
      if (request.action === "type" && request.text === undefined) {
        return { ok: false, error: "COMPUTER_INVALID", waited_ms: 0 };
      }
      const result = await send({
        kind: "act",
        native_call_id: request.nativeCallId,
        input: request.action === "type"
          ? {
              action: "type",
              observation_id: request.observationId,
              ref: request.ref,
              text: request.text ?? "",
              timeout_ms: request.timeoutMs,
            }
          : {
              action: "click",
              observation_id: request.observationId,
              ref: request.ref,
              timeout_ms: request.timeoutMs,
            },
      }, request.signal);
      if (result.kind === "act") return result.result as ComputerActResult;
      return {
        ok: false,
        error: result.kind === "failure" ? result.error : "RUNNER_OPERATION_UNCERTAIN",
        waited_ms: Math.min(Math.max(Date.now() - startedAt, 0), 20_000),
      };
    },
  };
}

/**
 * Registers the production computer_use module only from the environment that
 * process-pool writes for an admitted macOS run. Missing or malformed values
 * fail closed by not advertising any computer tool.
 */
export function computerUseRelayCoreMcpModules(input: {
  environment: NodeJS.ProcessEnv;
  mode: CoreMcpCollaborationMode;
  fetch?: typeof globalThis.fetch;
}): CoreMcpModuleDefinition[] {
  const endpoint = input.environment.LINKSENSE_COMPUTER_ENDPOINT?.trim();
  const token = input.environment.LINKSENSE_COMPUTER_TOKEN?.trim();
  if (!endpoint || !token) return [];
  const validEndpoint = endpointSchema.safeParse(endpoint);
  const validToken = tokenSchema.safeParse(token);
  if (!validEndpoint.success || !validToken.success) return [];
  return [
    createComputerUseCoreMcpModule({
      mode: input.mode,
      executor: createComputerUseRelayExecutor({
        endpoint: validEndpoint.data,
        token: validToken.data,
        ...(input.fetch ? { fetch: input.fetch } : {}),
      }),
      // Production stays text-only. The desktop proxy omits the API privacy
      // masking preference, so the worker cannot prove the raster path is
      // unmasked, and no environment flag may select it. Synthetic probes pass
      // `screenshots` directly to createComputerUseCoreMcpModule.
      screenshots: false,
    }),
  ];
}

function failure(error: ComputerFailureCode): ComputerExecuteResult {
  return { kind: "failure", error };
}

function httpFailure(
  status: number,
  effect: boolean,
  errorCode?: string,
): ComputerFailureCode {
  if (
    status === 401 ||
    status === 403 ||
    errorCode === "COMPUTER_ACCESS_DENIED" ||
    errorCode === "FORBIDDEN"
  ) {
    return "COMPUTER_ACCESS_DENIED";
  }
  if (status === 400 || errorCode === "COMPUTER_INVALID") return "COMPUTER_INVALID";
  // No response after an effect request may already have been delivered.
  return effect ? "RUNNER_OPERATION_UNCERTAIN" : "COMPUTER_UNAVAILABLE";
}
