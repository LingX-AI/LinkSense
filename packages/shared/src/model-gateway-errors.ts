export const modelGatewayErrorMessages = {
  model_provider_error: "The model provider request failed.",
  model_provider_authentication_failed: "The model provider denied access.",
  model_provider_rate_limited: "The model provider rate or usage limit was reached.",
  model_provider_invalid_request: "The model provider rejected the request.",
  model_provider_unavailable: "The model provider is temporarily unavailable.",
  model_provider_timeout: "The model provider request timed out.",
  model_gateway_error: "The model gateway request failed.",
  privacy_masking_unavailable:
    "Privacy masking is unavailable, so the request was not sent.",
  privacy_masking_blocked:
    "Privacy masking blocked this request because it contains a value the current policy does not allow.",
} as const;

export type ModelGatewayFailureCode = keyof typeof modelGatewayErrorMessages;

export function modelGatewayFailureCode(status: number): ModelGatewayFailureCode {
  if (status === 401 || status === 403) return "model_provider_authentication_failed";
  if (status === 429) return "model_provider_rate_limited";
  if (status === 408 || status === 504) return "model_provider_timeout";
  if (status >= 500) return "model_provider_unavailable";
  if ([400, 404, 413, 415, 422].includes(status)) return "model_provider_invalid_request";
  return "model_provider_error";
}

export const CONTEXT_LENGTH_EXCEEDED = "context_length_exceeded";

function isProviderErrorObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function providerErrors(value: unknown): Record<string, unknown>[] {
  if (!isProviderErrorObject(value)) return [];
  const nested = isProviderErrorObject(value.response) ? value.response.error : undefined;
  return [value.error, nested, value].filter(isProviderErrorObject);
}

export function isContextLengthExceededError(payload: unknown, status?: number): boolean {
  return providerErrors(payload).some(error =>
    error.code === CONTEXT_LENGTH_EXCEEDED || (status === 400 && isVllmContextLengthExceededError(error)),
  );
}

function isVllmContextLengthExceededError(error: Record<string, unknown>): boolean {
  const lower = (value: unknown) => typeof value === "string" ? value.toLowerCase() : "";
  const message = lower(error.message);
  const type = lower(error.type);
  const parameter = lower(error.parameter) || lower(error.param);
  const messageMatches = message.includes("maximum context length") ||
    (message.includes("max_model_len") && (message.includes("exceed") || message.includes("larger than"))) ||
    (message.includes("input tokens") && message.includes("reduce the length of the input prompt"));
  return messageMatches && (
    error.code === 400 || error.code === "400" ||
    type.includes("badrequest") || type.includes("invalid_request") ||
    ["input_tokens", "prompt_tokens", "prompt", "messages", "input"].includes(parameter)
  );
}

// Safe protocol values recognized by the pinned Codex 0.170.0 error handlers.
const nativeProviderCodes = new Set([
  CONTEXT_LENGTH_EXCEEDED,
  "insufficient_quota", "credit_balance_exhausted", "organization_spend_limit_exceeded", "project_spend_limit_exceeded",
  "organization_usage_limit_exceeded",
  "usage_not_included", "usage_limit_reached", "cyber_policy", "bio_policy", "misalignment_policy_violation",
  "invalid_prompt", "policy_capacity_unavailable", "server_is_overloaded", "rate_limit_exceeded", "slow_down",
  "budget_reached", "audio_too_large", "audio_too_short", "invalid_audio", "invalid_audio_data",
  "invalid_audio_format", "missing_audio_sample_rate", "flex_unavailable", "model_not_found",
]);

export function nativeProviderFailureCode(payload: unknown): string | undefined {
  for (const error of providerErrors(payload)) {
    for (const value of [error.code, error.type]) {
      if (typeof value === "string" && nativeProviderCodes.has(value)) return value;
    }
  }
  return undefined;
}
