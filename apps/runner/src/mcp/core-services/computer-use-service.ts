import {
  computerActInputSchema,
  computerActResultSchema,
  computerActToolName,
  computerFailure,
  computerObservationSchema,
  computerObserveInputSchema,
  computerObserveToolName,
  computerScreenshotMaxBytes,
  computerScreenshotMaxDimension,
  computerScreenshotMaxPixels,
  computerScreenshotMaxResultBytes,
  computerStatusInputSchema,
  computerStatusResultSchema,
  computerStatusToolName,
  computerWaitInputSchema,
  computerWaitResultSchema,
  computerWaitToolName,
  type ComputerActInput,
  type ComputerActResult,
  type ComputerFailureCode,
  type ComputerObservation,
  type ComputerScreenshot,
  type ComputerStatusResult,
  type ComputerWaitInput,
  type ComputerWaitResult,
} from "@linksense/shared";
import type { CallToolResult, Tool } from "@modelcontextprotocol/sdk/types.js";
import sharp from "sharp";
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

/** Preserves a bounded failure code through the executor boundary. */
export class ComputerUseFailureError extends Error {
  constructor(readonly code: ComputerFailureCode) {
    super(code);
    this.name = "ComputerUseFailureError";
  }
}

export type ComputerUseExecutor = {
  status(input: {
    signal: AbortSignal;
  }): Promise<ComputerStatusResult>;
  observe(input: {
    signal: AbortSignal;
  }): Promise<ComputerObservation>;
  act(input: {
    nativeCallId: string;
    observationId: string;
    ref: string;
    action: "click" | "type";
    text?: string;
    timeoutMs: number;
    signal: AbortSignal;
  }): Promise<ComputerActResult>;
  wait(input: {
    observationId: string;
    ref: string;
    timeoutMs: number;
    signal: AbortSignal;
  }): Promise<ComputerWaitResult>;
};

export function createComputerUseCoreMcpModule(input: {
  mode: CoreMcpCollaborationMode;
  executor: ComputerUseExecutor;
  /**
   * Fixture-only raster fallback. Production stays text-only until the full
   * model-capability, masking and screen-consent contract is proven; the
   * production relay always passes false.
   */
  screenshots?: boolean;
  /**
   * Only the supervised worker whose own device connection offered the wait
   * marker registers the read-only tool. An unnegotiated worker keeps the
   * pre-existing tool set.
   */
  wait?: boolean;
}): CoreMcpModuleDefinition {
  const plan = input.mode === "plan";
  const screenshots = input.screenshots === true;
  const wait = input.wait === true && !plan;
  const toolNames = plan
    ? [computerStatusToolName, computerObserveToolName]
    : [computerStatusToolName, computerObserveToolName, computerActToolName,
        ...(wait ? [computerWaitToolName] : [])];

  return {
    key: "computer_use",
    modes: [input.mode],
    toolNames,
    create(): CoreMcpToolModule {
      return {
        key: "computer_use",
        tools: plan ? [statusTool, observeTool(screenshots)]
          : [statusTool, observeTool(screenshots), actTool, ...(wait ? [waitTool] : [])],
        async callTool(call) {
          if (call.toolName === computerStatusToolName) {
            return status(input.executor, call);
          }
          if (call.toolName === computerObserveToolName) {
            return observe(screenshots, input.executor, call);
          }
          if (call.toolName === computerActToolName && !plan) {
            return act(input.executor, call);
          }
          if (call.toolName === computerWaitToolName) {
            // Plan never registers or executes wait, even if a caller invokes
            // the name directly.
            return wait && !plan
              ? runWait(input.executor, call)
              : failureToolResult(computerFailure("COMPUTER_ACCESS_DENIED"));
          }
          return failureToolResult(computerFailure("COMPUTER_ACCESS_DENIED"));
        },
      };
    },
  };
}

async function status(
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
    const settled = await settle(executor.status({ signal: deadline }), deadline);
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
  screenshots: boolean,
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
    const settled = await settle(executor.observe({ signal: deadline }), deadline);
    call.signal.throwIfAborted();
    if (settled.kind === "aborted" || deadline.aborted) {
      return failureToolResult(computerFailure("COMPUTER_TIMEOUT"));
    }
    const observation = computerObservationSchema.safeParse(settled.value);
    if (!observation.success) {
      // A screenshot-bearing result is a malformed fallback, not a broken
      // tree; keep the stable COMPUTER_INVALID failure for that path.
      return failureToolResult(
        computerFailure(
          typeof settled.value === "object" &&
            settled.value !== null &&
            "screenshot" in settled.value
            ? "COMPUTER_INVALID"
            : "COMPUTER_UNAVAILABLE",
        ),
      );
    }
    if (!observation.data.screenshot || !screenshots) {
      // A model connection that cannot accept raster gets the tree only. The
      // producer's bounded bytes never become text and are never persisted.
      return textObservationResult(observation.data);
    }
    if (observation.data.tree_quality === "good") {
      return failureToolResult(computerFailure("COMPUTER_INVALID"));
    }
    // Race the decode against the same observe deadline: a delayed pipeline or
    // queued decoder must not publish an image after the tool has returned.
    const verified = await settle(
      verifyScreenshot(observation.data.screenshot),
      deadline,
    );
    call.signal.throwIfAborted();
    if (verified.kind === "aborted" || deadline.aborted) {
      return failureToolResult(computerFailure("COMPUTER_TIMEOUT"));
    }
    if (!verified.value) {
      return failureToolResult(computerFailure("COMPUTER_INVALID"));
    }
    return observationToolResult(observation.data, verified.value);
  } catch (error) {
    call.signal.throwIfAborted();
    return failureToolResult(
      computerFailure(error instanceof ComputerUseFailureError
        ? error.code : deadline.aborted ? "COMPUTER_TIMEOUT" : "COMPUTER_UNAVAILABLE"),
    );
  }
}

const screenshotDecodeTimeoutSeconds = 2;
const pngRasterSignature = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);

function withoutScreenshot(
  observation: ComputerObservation,
): Omit<ComputerObservation, "screenshot"> {
  const tree = { ...observation };
  delete tree.screenshot;
  return tree;
}

/** Text only; healthy and non-fallback observations keep the existing shape. */
function textObservationResult(observation: ComputerObservation): CallToolResult {
  return successToolResult(withoutScreenshot(observation));
}

/**
 * Text plus image only. Image bytes and any producer metadata stay out of the
 * text part, and no competing structuredContent accompanies an image.
 */
function observationToolResult(
  observation: ComputerObservation,
  screenshot: ComputerScreenshot,
): CallToolResult {
  const tree = withoutScreenshot(observation);
  const result: CallToolResult = {
    content: [
      {
        type: "text",
        text: JSON.stringify({
          ...tree,
          screenshot: {
            mime_type: screenshot.mime_type,
            width: screenshot.width,
            height: screenshot.height,
          },
        }),
      },
      {
        type: "image",
        data: screenshot.data_base64,
        mimeType: screenshot.mime_type,
      },
    ],
    isError: false,
  };
  // Measure the actual serialized result; the base64 bound leaves ample room,
  // but the observation text shares this budget.
  if (
    Buffer.byteLength(JSON.stringify(result), "utf8") >
    computerScreenshotMaxResultBytes
  ) {
    return failureToolResult(computerFailure("COMPUTER_INVALID"));
  }
  return result;
}

/** A declared MIME type must not let another sharp loader inspect the bytes. */
function hasRasterSignature(
  bytes: Buffer,
  mimeType: ComputerScreenshot["mime_type"],
): boolean {
  if (mimeType === "image/png") {
    return bytes.subarray(0, pngRasterSignature.length).equals(pngRasterSignature);
  }
  return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
}

/**
 * A header or declared dimensions alone accept truncated or corrupt payloads.
 * Check the raster signature before sharp selects a loader, verify the actual
 * type and dimensions from the header, then fully decode bounded pixels.
 * Consent and Screen Recording remain the native producer's responsibility.
 */
async function verifyScreenshot(
  screenshot: ComputerScreenshot,
): Promise<ComputerScreenshot | undefined> {
  const bytes = Buffer.from(screenshot.data_base64, "base64");
  if (
    bytes.length === 0 ||
    bytes.length > computerScreenshotMaxBytes ||
    bytes.toString("base64") !== screenshot.data_base64 ||
    !hasRasterSignature(bytes, screenshot.mime_type)
  ) {
    return undefined;
  }
  try {
    const image = sharp(bytes, {
      failOn: "warning",
      limitInputPixels: computerScreenshotMaxPixels,
    });
    const metadata = await image.metadata();
    const mimeType: ComputerScreenshot["mime_type"] | undefined =
      metadata.format === "png"
        ? "image/png"
        : metadata.format === "jpeg"
          ? "image/jpeg"
          : undefined;
    if (
      !mimeType ||
      mimeType !== screenshot.mime_type ||
      !metadata.width ||
      !metadata.height ||
      metadata.width !== screenshot.width ||
      metadata.height !== screenshot.height ||
      metadata.width > computerScreenshotMaxDimension ||
      metadata.height > computerScreenshotMaxDimension ||
      metadata.width * metadata.height > computerScreenshotMaxPixels ||
      (metadata.pages ?? 1) > 1
    ) {
      return undefined;
    }
    // metadata() reads only the header and ignores sharp's timeout. A raw
    // pipeline fully decodes the bounded pixels and does apply it.
    const decoded = await image
      .timeout({ seconds: screenshotDecodeTimeoutSeconds })
      .raw()
      .toBuffer({ resolveWithObject: true });
    if (
      decoded.info.format !== "raw" ||
      decoded.info.width !== metadata.width ||
      decoded.info.height !== metadata.height ||
      decoded.info.channels < 1 ||
      decoded.info.channels > 4 ||
      decoded.data.length !==
        decoded.info.width * decoded.info.height * decoded.info.channels
    ) {
      return undefined;
    }
    return screenshot;
  } catch {
    // Decoder diagnostics can contain target-controlled metadata; never expose them.
    return undefined;
  }
}

async function act(
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

async function runWait(
  executor: ComputerUseExecutor,
  call: CoreMcpToolCall,
): Promise<CallToolResult> {
  let request: ComputerWaitInput;
  try {
    request = computerWaitInputSchema.parse(call.argumentsValue);
  } catch {
    return failureToolResult(computerFailure("COMPUTER_INVALID"));
  }
  call.signal.throwIfAborted();
  // Match the host's bounded wait plus its finite identity-check grace; the
  // existing 25s computer tool request lifetime still caps the whole call.
  const deadline = withRequestTimeout(call.signal, request.timeout_ms + 4_000);
  try {
    const settled = await settle(
      executor.wait({
        observationId: request.observation_id,
        ref: request.ref,
        timeoutMs: request.timeout_ms,
        signal: deadline,
      }),
      deadline,
    );
    call.signal.throwIfAborted();
    if (settled.kind === "aborted" || deadline.aborted) {
      return failureToolResult(computerFailure("COMPUTER_TIMEOUT"));
    }
    const result = computerWaitResultSchema.safeParse(settled.value);
    // met and timed_out are both normal bounded outcomes; never retried here.
    return result.success
      ? successToolResult(result.data)
      : failureToolResult(computerFailure("COMPUTER_UNAVAILABLE"));
  } catch (error) {
    call.signal.throwIfAborted();
    return failureToolResult(
      computerFailure(error instanceof ComputerUseFailureError
        ? error.code : deadline.aborted ? "COMPUTER_TIMEOUT" : "COMPUTER_UNAVAILABLE"),
    );
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

const observeTool = (screenshots: boolean) => ({
  name: computerObserveToolName,
  description:
    "Read a bounded accessibility tree for the single local application chosen by the host for this task. Returns an opaque observation_id and opaque element refs." +
    (screenshots
      ? " When tree_quality is partial or unusable, a bounded screenshot of that same host-selected window may also be returned as visual evidence; use it only to understand what is visible."
      : "") +
    " Act only on refs from the latest observation, and re-observe after an action before acting again. Do not guess selectors, coordinates, windows, processes, paths or commands. Read-only.",
  inputSchema: observeInputJsonSchema as Tool["inputSchema"],
  annotations: {
    title: "Observe local computer",
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: false,
  },
}) satisfies Tool;

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

const waitInputJsonSchema = z.toJSONSchema(computerWaitInputSchema, { io: "input" });

const waitTool = {
  name: computerWaitToolName,
  description:
    "Wait, up to a bounded timeout, for an element ref from the latest computer_observe result of the host-chosen local application to become actionable. Pass that observation's exact observation_id and its qualified ref (the @snapshot:eN form returned by computer_observe). Returns only met or timed_out with waited_ms; it never reads a new tree, returns refs, changes the application, or repeats itself. A timed_out result is an observation: re-observe before choosing another step. Read-only.",
  inputSchema: waitInputJsonSchema as Tool["inputSchema"],
  annotations: {
    title: "Wait for local computer element",
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: false,
  },
} satisfies Tool;
