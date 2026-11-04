import { describe, expect, it } from "vitest";

import { imageGenerationErrorFromApi, imageGenerationErrorFromTransport } from "../src/image-generation-error.js";

describe("imageGenerationErrorFromApi", () => {
  it.each([new TypeError("fetch failed"), new DOMException("timed out", "TimeoutError"), new DOMException("aborted", "AbortError")])(
    "maps a fetch transport error to retryable unavailability: %s", (error) => {
      expect(imageGenerationErrorFromTransport(error)).toMatchObject({ code: "IMAGE_GENERATION_UNAVAILABLE", retryable: true, statusCode: 503 })
    },
  );
  it.each([new RangeError("Maximum call stack size exceeded"), new Error("synthetic-private-token")])(
    "never treats a program exception as a transport outage: %s", (error) => {
      expect(imageGenerationErrorFromTransport(error)).toMatchObject({ code: "INTERNAL_ERROR", retryable: false, statusCode: 500 })
    },
  );
  it.each([
    ["IMAGE_GENERATION_INPUT_INVALID", 400],
    ["IMAGE_GENERATION_EDIT_UNSUPPORTED", 422],
  ] as const)("preserves %s as a non-retryable editing failure", (code, status) => {
    expect(imageGenerationErrorFromApi(status, { error_code: code })).toMatchObject({ code, retryable: false, statusCode: status });
  });
  it("preserves provider rejection details from the API envelope", () => {
    const error = imageGenerationErrorFromApi(422, {
      success: false,
      error_code: "IMAGE_GENERATION_PROVIDER_REJECTED",
      message: "图片生成供应商拒绝了本次请求。",
      params: {
        provider_code: "InvalidApiKey",
        provider_message: "Invalid API-key provided.",
        provider_request_id: "31f808fd-8eef-9004",
      },
    });

    expect(error).toMatchObject({
      code: "IMAGE_GENERATION_PROVIDER_REJECTED",
      retryable: false,
      statusCode: 422,
      providerDetails: {
        provider_code: "InvalidApiKey",
        provider_message: "Invalid API-key provided.",
        provider_request_id: "31f808fd-8eef-9004",
      },
    });
  });

  it.each([
    [500, { error_code: "INTERNAL_ERROR" }],
    [404, { error_code: "RUNNER_ROUTE_NOT_FOUND" }],
    [500, null],
    [500, { message: "Maximum call stack size exceeded; synthetic-secret" }],
  ])("does not turn an internal or unrecognized API failure (%i) into a retryable provider outage", (status, body) => {
    const error = imageGenerationErrorFromApi(status, body);
    expect(error).toMatchObject({ code: "INTERNAL_ERROR", retryable: false, statusCode: 500, providerDetails: {} });
    expect(error.message).toBe("INTERNAL_ERROR");
    expect(JSON.stringify(error)).not.toContain("synthetic-secret");
  });

  it("keeps retryable provider outage details without calling it a rejection", () => {
    const error = imageGenerationErrorFromApi(503, {
      success: false,
      error_code: "IMAGE_GENERATION_UNAVAILABLE",
      params: {
        provider_code: "rate_limit_error",
        provider_message: "Too many image requests.",
        provider_request_id: "rate-limit-request-1",
      },
    });

    expect(error).toMatchObject({
      code: "IMAGE_GENERATION_UNAVAILABLE",
      retryable: true,
      statusCode: 503,
      providerDetails: {
        provider_code: "rate_limit_error",
        provider_message: "Too many image requests.",
        provider_request_id: "rate-limit-request-1",
      },
    });
  });

  it("does not retry after the provider succeeded but usage recording failed", () => {
    const error = imageGenerationErrorFromApi(500, {
      error_code: "IMAGE_GENERATION_RECORDING_FAILED",
    });

    expect(error).toMatchObject({
      code: "IMAGE_GENERATION_RECORDING_FAILED",
      retryable: false,
      statusCode: 500,
      providerDetails: {},
    });
  });

  it("does not contact another model for unsupported native transparency", () => {
    const error = imageGenerationErrorFromApi(422, {
      error_code: "IMAGE_GENERATION_TRANSPARENCY_UNSUPPORTED",
    });

    expect(error).toMatchObject({
      code: "IMAGE_GENERATION_TRANSPARENCY_UNSUPPORTED",
      retryable: false,
      statusCode: 422,
      providerDetails: {},
    });
  });

  it("does not retry after billed transparent output fails validation", () => {
    const error = imageGenerationErrorFromApi(502, {
      error_code: "IMAGE_GENERATION_TRANSPARENCY_INVALID",
    });

    expect(error).toMatchObject({
      code: "IMAGE_GENERATION_TRANSPARENCY_INVALID",
      retryable: false,
      statusCode: 502,
      providerDetails: {},
    });
  });

  it("does not retry after the provider succeeded but artifact registration failed", () => {
    const error = imageGenerationErrorFromApi(500, {
      error_code: "IMAGE_GENERATION_ARTIFACT_REGISTRATION_FAILED",
    });

    expect(error).toMatchObject({
      code: "IMAGE_GENERATION_ARTIFACT_REGISTRATION_FAILED",
      retryable: false,
      statusCode: 500,
      providerDetails: {},
    });
  });
});
