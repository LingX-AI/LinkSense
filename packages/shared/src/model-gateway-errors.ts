export const modelGatewayErrorMessages = {
  model_provider_error: "The model provider request failed.",
  model_provider_authentication_failed: "The model provider denied access.",
  model_provider_rate_limited: "The model provider rate or usage limit was reached.",
  model_provider_invalid_request: "The model provider rejected the request.",
  model_provider_unavailable: "The model provider is temporarily unavailable.",
  model_provider_timeout: "The model provider request timed out.",
  model_gateway_error: "The model gateway request failed.",
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
