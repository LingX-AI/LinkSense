import {
  computerActInputSchema,
  computerActResultSchema,
  computerActToolName,
  computerFailure,
  computerObservationSchema,
  computerObserveInputSchema,
  computerObserveToolName,
  computerStatusInputSchema,
  computerStatusResultSchema,
  computerStatusToolName,
  localComputerGrantSchema,
  type ComputerActInput,
  type ComputerActResult,
  type ComputerFailureCode,
  type ComputerObservation,
  type ComputerStatusResult,
} from "@linksense/shared";
import type { CallToolResult, Tool } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

import {
  failureToolResult,
  successToolResult,
  withRequestTimeout,
  type CoreMcpCollaborationMode,
  type CoreMcpModuleDefinition,
  type CoreMcpToolCall,
  type CoreMcpToolModule,
} from "../core-service-module.js";

/** Chosen by the host for one task; never accepted from the model. */
export type ComputerUseTarget = Readonly<{ bundleId: string }>;

/** Preserves a bounded failure code through the executor boundary. */
export class ComputerUseFailureError extends Error {
  constructor(readonly code: ComputerFailureCode) {
    super(code);
    this.name = "ComputerUseFailureError";
  }
}

export type ComputerUseExecutor = {
  status(input: {
    target: ComputerUseTarget;
    signal: AbortSignal;
  }): Promise<ComputerStatusResult>;
  observe(input: {
    target: ComputerUseTarget;
    signal: AbortSignal;
  }): Promise<ComputerObservation>;
  act(input: {
    target: ComputerUseTarget;
    nativeCallId: string;
    observationId: string;
    ref: string;
    action: "click" | "type";
    text?: string;
    timeoutMs: number;
    signal: AbortSignal;
  }): Promise<ComputerActResult>;
};

export function createComputerUseCoreMcpModule(input: {
  mode: CoreMcpCollaborationMode;
  target: ComputerUseTarget;
  executor: ComputerUseExecutor;
}): CoreMcpModuleDefinition {
  const target = z
    .strictObject({
      bundleId: localComputerGrantSchema.shape.target.shape.bundle_id,
    })
    .parse(input.target);
  const plan = input.mode === "plan";
  const toolNames = plan
    ? [computerStatusToolName, computerObserveToolName]
    : [computerStatusToolName, computerObserveToolName, computerActToolName];

  return {
    key: "computer_use",
    modes: [input.mode],
    toolNames,
    create(): CoreMcpToolModule {
      return {
        key: "computer_use",
        tools: plan ? [statusTool, observeTool] : [statusTool, observeTool, actTool],
        async callTool(call) {
          if (call.toolName === computerStatusToolName) {
            return status(target, input.executor, call);
          }
          if (call.toolName === computerObserveToolName) {
            return observe(target, input.executor, call);
          }
          if (call.toolName === computerActToolName && !plan) {
            return act(target, input.executor, call);
          }
          return failureToolResult(computerFailure("COMPUTER_ACCESS_DENIED"));
        },
      };
    },
  };
}

async function status(
  target: ComputerUseTarget,
  executor: ComputerUseExecutor,
  call: CoreMcpToolCall,
): Promise<CallToolResult> {
  try {
    computerStatusInputSchema.parse(argumentsWithDefault(call.argumentsValue));
  } catch {
    return failureToolResult(computerFailure("COMPUTER_INVALID"));
  }
  call.signal.throwIfAborted();
  const deadline = withRequestTimeout(call.signal, 10_000);
  try {
    const settled = await settle(executor.status({ target, signal: deadline }), deadline);
    call.signal.throwIfAborted();
    if (settled.kind === "aborted" || deadline.aborted) {
      return failureToolResult(computerFailure("COMPUTER_TIMEOUT"));
    }
    try {
      return successToolResult(computerStatusResultSchema.parse(settled.value));
    } catch {
      return failureToolResult(computerFailure("COMPUTER_UNAVAILABLE"));
    }
  } catch (error) {
    call.signal.throwIfAborted();
    return failureToolResult(
      computerFailure(error instanceof ComputerUseFailureError
        ? error.code : deadline.aborted ? "COMPUTER_TIMEOUT" : "COMPUTER_UNAVAILABLE"),
    );
  }
}

async function observe(
  target: ComputerUseTarget,
  executor: ComputerUseExecutor,
  call: CoreMcpToolCall,
): Promise<CallToolResult> {
  try {
    computerObserveInputSchema.parse(argumentsWithDefault(call.argumentsValue));
  } catch {
    return failureToolResult(computerFailure("COMPUTER_INVALID"));
  }
  call.signal.throwIfAborted();
  const deadline = withRequestTimeout(call.signal, 10_000);
  try {
    const settled = await settle(executor.observe({ target, signal: deadline }), deadline);
    call.signal.throwIfAborted();
    if (settled.kind === "aborted" || deadline.aborted) {
      return failureToolResult(computerFailure("COMPUTER_TIMEOUT"));
    }
    try {
      return successToolResult(computerObservationSchema.parse(settled.value));
    } catch {
      return failureToolResult(computerFailure("COMPUTER_UNAVAILABLE"));
    }
  } catch (error) {
    call.signal.throwIfAborted();
    return failureToolResult(
      computerFailure(error instanceof ComputerUseFailureError
        ? error.code : deadline.aborted ? "COMPUTER_TIMEOUT" : "COMPUTER_UNAVAILABLE"),
    );
  }
}

async function act(
  target: ComputerUseTarget,
  executor: ComputerUseExecutor,
  call: CoreMcpToolCall,
): Promise<CallToolResult> {
  if (!call.nativeCallId) {
    return failureToolResult(computerFailure("COMPUTER_ACCESS_DENIED"));
  }
  let request: ComputerActInput;
  try {
    request = computerActInputSchema.parse(call.argumentsValue);
  } catch {
    return failureToolResult(computerFailure("COMPUTER_INVALID"));
  }
  call.signal.throwIfAborted();
  const deadline = withRequestTimeout(call.signal, request.timeout_ms + 1_000);
  const startedAt = Date.now();
  try {
    const settled = await settle(
      executor.act({
        target,
        nativeCallId: call.nativeCallId,
        observationId: request.observation_id,
        ref: request.ref,
        action: request.action,
        ...(request.action === "type" ? { text: request.text } : {}),
        timeoutMs: request.timeout_ms,
        signal: deadline,
      }),
      deadline,
    );
    call.signal.throwIfAborted();
    if (settled.kind === "aborted" || deadline.aborted) {
      return actResult(uncertain(startedAt));
    }
    const result = computerActResultSchema.safeParse(settled.value);
    return result.success ? actResult(result.data) : actResult(uncertain(startedAt));
  } catch {
    call.signal.throwIfAborted();
    return actResult(uncertain(startedAt));
  }
}

function actResult(result: ComputerActResult): CallToolResult {
  const value = { type: "text" as const, text: JSON.stringify(result) };
  if (!result.ok) {
    return {
      content: [
        value,
        {
          type: "text",
          text:
            result.error === "RUNNER_OPERATION_UNCERTAIN"
              ? "The action may already have happened. Do not repeat it; observe the current state before deciding what to do."
              : "The action did not complete successfully. Do not automatically repeat it; observe the current state first.",
        },
      ],
      isError: true,
    };
  }
  return result.effect === "no_effect"
    ? {
        content: [
          value,
          {
            type: "text",
            text: "No visible change was observed. Do not repeat the same action; choose a different target or approach.",
          },
        ],
        isError: false,
      }
    : { content: [value], isError: false };
}

function uncertain(startedAt: number): ComputerActResult {
  return {
    ok: false,
    error: "RUNNER_OPERATION_UNCERTAIN",
    waited_ms: Math.min(Math.max(Date.now() - startedAt, 0), 20_000),
  };
}

function argumentsWithDefault(value: unknown): unknown {
  return value === undefined ? {} : value;
}

type Settled<T> = { kind: "value"; value: T } | { kind: "aborted" };

/** Bound the wait without another timer: the existing deadline signal ends it. */
function settle<T>(promise: Promise<T>, signal: AbortSignal): Promise<Settled<T>> {
  return Promise.race([
    promise.then((value) => ({ kind: "value" as const, value })),
    new Promise<Settled<T>>((resolve) => {
      if (signal.aborted) return resolve({ kind: "aborted" });
      signal.addEventListener("abort", () => resolve({ kind: "aborted" }), {
        once: true,
      });
    }),
  ]);
}

const statusInputJsonSchema = z.toJSONSchema(computerStatusInputSchema, { io: "input" });
const observeInputJsonSchema = z.toJSONSchema(computerObserveInputSchema, { io: "input" });

const statusTool = {
  name: computerStatusToolName,
  description:
    "Report whether the single local desktop target chosen by the user for this task is available, and whether accessibility permission and this task's computer.act grant are active. Takes no input. Read-only; use before observing or acting.",
  inputSchema: statusInputJsonSchema as Tool["inputSchema"],
  annotations: {
    title: "Computer status",
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
} satisfies Tool;

const observeTool = {
  name: computerObserveToolName,
  description:
    "Read a bounded accessibility tree for the single local application chosen by the host for this task. Returns an opaque observation_id and opaque element refs. Act only on refs from the latest observation, and re-observe after an action before acting again. If tree_quality is unusable, report that the target cannot be inspected instead of guessing. Do not guess selectors, coordinates, windows, processes, paths or commands. Read-only.",
  inputSchema: observeInputJsonSchema as Tool["inputSchema"],
  annotations: {
    title: "Observe local computer",
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: false,
  },
} satisfies Tool;

// MCP requires a root "type: object" schema; the discriminated union projects to oneOf.
const actTool = {
  name: computerActToolName,
  description:
    "Perform one click, or type UTF-8 text, on an element ref from the latest computer_observe result for the host-chosen local application. Pass that observation's observation_id and ref. Never estimate coordinates, and never name applications, windows, processes, paths or commands: those are not accepted. The engine waits for a bounded effect and reports done, small_change, no_effect or place_changed. Never repeat an uncertain action. When effect is no_effect, choose a different approach instead of repeating the same action.",
  inputSchema: {
    type: "object",
    properties: {
      action: { type: "string", enum: ["click", "type"] },
      observation_id: {
        type: "string",
        minLength: 1,
        maxLength: 120,
        description: "The observation_id from the latest computer_observe result.",
      },
      ref: {
        type: "string",
        minLength: 1,
        maxLength: 200,
        description: "An element ref from that latest observation.",
      },
      text: {
        type: "string",
        minLength: 1,
        maxLength: 8_000,
        description: "For type only: UTF-8 text, at most 8192 bytes.",
      },
      timeout_ms: {
        type: "integer",
        minimum: 100,
        maximum: 20_000,
        default: 8_000,
        description: "Maximum time to wait for the bounded effect.",
      },
    },
    required: ["action", "observation_id", "ref"],
    additionalProperties: false,
  },
  annotations: {
    title: "Act on local computer",
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: false,
    openWorldHint: false,
  },
} satisfies Tool;
