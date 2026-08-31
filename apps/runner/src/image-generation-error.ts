import type { ImageGenerationMcpFailure } from "@linksense/shared";

export type ImageGenerationErrorCode = ImageGenerationMcpFailure["code"];
type ImageGenerationProviderFailureDetails = Pick<
  ImageGenerationMcpFailure,
  "provider_code" | "provider_message" | "provider_request_id"
>;

export class ImageGenerationRequestError extends Error {
  constructor(
    readonly code: ImageGenerationErrorCode,
    readonly retryable: boolean,
    readonly statusCode: number,
    readonly providerDetails: ImageGenerationProviderFailureDetails = {},
  ) {
    super(code);
    this.name = "ImageGenerationRequestError";
  }
}

export function imageGenerationErrorFromApi(
  statusCode: number,
  responseBody: unknown,
): ImageGenerationRequestError {
  const value = asRecord(responseBody);
  const apiCode = typeof value.error_code === "string" ? value.error_code : null;
  const providerDetails = providerDetailsFromResponse(value);

  switch (apiCode) {
    case "IMAGE_GENERATION_NOT_CONFIGURED":
      return new ImageGenerationRequestError(
        "IMAGE_GENERATION_NOT_CONFIGURED",
        false,
        503,
      );
    case "IMAGE_GENERATION_TURN_INACTIVE":
      return new ImageGenerationRequestError(
        "IMAGE_GENERATION_TURN_INACTIVE",
        false,
        409,
      );
    case "IMAGE_GENERATION_PROVIDER_REJECTED":
      return new ImageGenerationRequestError(
        "IMAGE_GENERATION_PROVIDER_REJECTED",
        false,
        422,
        providerDetails,
      );
    case "IMAGE_GENERATION_OUTPUT_INVALID":
      return new ImageGenerationRequestError(
        "IMAGE_GENERATION_OUTPUT_INVALID",
        true,
        502,
      );
    case "IMAGE_GENERATION_TRANSPARENCY_UNSUPPORTED":
      return new ImageGenerationRequestError(
        "IMAGE_GENERATION_TRANSPARENCY_UNSUPPORTED",
        false,
        422,
      );
    case "IMAGE_GENERATION_TRANSPARENCY_INVALID":
      return new ImageGenerationRequestError(
        "IMAGE_GENERATION_TRANSPARENCY_INVALID",
        false,
        502,
      );
    case "IMAGE_GENERATION_RECORDING_FAILED":
      return new ImageGenerationRequestError(
        "IMAGE_GENERATION_RECORDING_FAILED",
        false,
        500,
      );
    case "IMAGE_GENERATION_ARTIFACT_REGISTRATION_FAILED":
      return new ImageGenerationRequestError(
        "IMAGE_GENERATION_ARTIFACT_REGISTRATION_FAILED",
        false,
        500,
      );
    case "VALIDATION_ERROR":
      return new ImageGenerationRequestError(
        "IMAGE_GENERATION_INVALID",
        false,
        400,
        providerDetails,
      );
    case "AUTH_REQUIRED":
    case "FORBIDDEN":
    case "ACCESS_DENIED":
      return new ImageGenerationRequestError(
        "IMAGE_GENERATION_FORBIDDEN",
        false,
        403,
      );
    default:
      return new ImageGenerationRequestError(
        "IMAGE_GENERATION_UNAVAILABLE",
        true,
        503,
        providerDetails,
      );
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function providerDetailsFromResponse(
  value: Record<string, unknown>,
): ImageGenerationProviderFailureDetails {
  const params = asRecord(value.params);
  return {
    ...optionalString("provider_code", params),
    ...optionalString("provider_message", params),
    ...optionalString("provider_request_id", params),
  };
}

function optionalString(
  key: keyof ImageGenerationProviderFailureDetails,
  value: Record<string, unknown>,
): ImageGenerationProviderFailureDetails {
  const item = value[key];
  return typeof item === "string" && item.trim()
    ? { [key]: item } as ImageGenerationProviderFailureDetails
    : {};
}
