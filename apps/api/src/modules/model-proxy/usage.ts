import type { DesktopProviderTokenUsage } from "../usage/model-usage.js";

type JsonObject = Record<string, unknown>;

export type ProviderUsageRead =
  | { status: "valid"; usage: DesktopProviderTokenUsage }
  | { status: "invalid" }
  | null;

/**
 * Extracts usage from a native Responses payload. Completed, incomplete, and
 * failed terminal frames may report upstream usage; a non-stream response
 * carries the same object directly. A terminal frame without usage is reported
 * as missing, not as zero usage. Error shaping remains the sanitizer's job.
 */
export function responseProviderUsage(value: JsonObject): ProviderUsageRead {
  const terminal = value.type === "response.completed" ||
    value.type === "response.incomplete" ||
    value.type === "response.failed";
  const response =
    terminal && isRecord(value.response)
      ? value.response
      : value.object === "response"
        ? value
        : null;
  if (!response || !("usage" in response)) return null;
  return readUsage(response.usage);
}

/**
 * Extracts usage from a Chat Completions chunk or JSON body. Usage normally
 * arrives on the final streamed chunk; earlier chunks without usage are
 * ignored so the last upstream value wins.
 */
export function chatProviderUsage(value: JsonObject): ProviderUsageRead {
  if (!("usage" in value)) return null;
  return readUsage(value.usage);
}

function readUsage(value: unknown): ProviderUsageRead {
  // A null usage field is the normal "not available" marker in streamed Chat
  // chunks and must not be reported as malformed usage.
  if (value === null || value === undefined) return null;
  if (!isRecord(value)) return { status: "invalid" };
  const inputTokens =
    tokenCount(value.input_tokens) ?? tokenCount(value.prompt_tokens);
  const outputTokens =
    tokenCount(value.output_tokens) ?? tokenCount(value.completion_tokens);
  if (inputTokens === null || outputTokens === null) {
    return { status: "invalid" };
  }
  const totalTokens =
    value.total_tokens === undefined
      ? inputTokens + outputTokens
      : tokenCount(value.total_tokens);
  if (totalTokens === null) return { status: "invalid" };
  const inputDetails = isRecord(value.input_tokens_details)
    ? value.input_tokens_details
    : isRecord(value.prompt_tokens_details)
      ? value.prompt_tokens_details
      : {};
  const outputDetails = isRecord(value.output_tokens_details)
    ? value.output_tokens_details
    : isRecord(value.completion_tokens_details)
      ? value.completion_tokens_details
      : {};
  const cachedInputTokens =
    inputDetails.cached_tokens === undefined
      ? 0
      : tokenCount(inputDetails.cached_tokens);
  const reasoningOutputTokens =
    outputDetails.reasoning_tokens === undefined
      ? 0
      : tokenCount(outputDetails.reasoning_tokens);
  if (
    cachedInputTokens === null ||
    reasoningOutputTokens === null ||
    cachedInputTokens > inputTokens ||
    reasoningOutputTokens > outputTokens
  ) {
    return { status: "invalid" };
  }
  return {
    status: "valid",
    usage: {
      totalTokens,
      inputTokens,
      cachedInputTokens,
      outputTokens,
      reasoningOutputTokens,
    },
  };
}

function tokenCount(value: unknown): number | null {
  return typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= 0
    ? value
    : null;
}

function isRecord(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
