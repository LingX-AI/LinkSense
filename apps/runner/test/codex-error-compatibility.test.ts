import { describe, expect, it } from "vitest";

import { mapCodexNotification } from "../src/codex/event-mapper.js";

const newErrorCodes = [
  "flexUnavailable",
  "modelNotFound",
  "policyCapacityUnavailable",
  "tooManyDenials",
] as const;

describe("Codex error compatibility", () => {
  it.each(newErrorCodes)("preserves %s without changing native retry decisions", (codexErrorInfo) => {
    for (const willRetry of [true, false]) {
      const events = mapCodexNotification({
        method: "error",
        params: {
          threadId: "thread-error-probe",
          turnId: "turn-error-probe",
          willRetry,
          error: {
            message: "Provider failure: api_key=codex-error-probe-secret",
            codexErrorInfo,
            additionalDetails: "private-provider-response",
          },
        },
      });

      expect(events).toEqual([{
        method: "error",
        visibility: willRetry ? "user_collapsed" : "user_visible",
        params: {
          threadId: "thread-error-probe",
          turnId: "turn-error-probe",
          willRetry,
          error: {
            message: "Provider failure: api_key=[REDACTED]",
            codexErrorInfo,
          },
        },
      }]);
      expect(JSON.stringify(events)).not.toMatch(/codex-error-probe-secret|private-provider-response/u);
    }
  });

  it.each(newErrorCodes)("retains the failed native terminal state for %s", (codexErrorInfo) => {
    expect(mapCodexNotification({
      method: "turn/completed",
      params: {
        threadId: "thread-error-probe",
        turn: {
          id: "turn-error-probe",
          status: "failed",
          items: [],
          error: { message: "Synthetic provider failure", codexErrorInfo, additionalDetails: null },
        },
      },
    })).toEqual([{
      method: "turn/completed",
      visibility: "user_visible",
      params: {
        threadId: "thread-error-probe",
        turn: {
          id: "turn-error-probe",
          status: "failed",
          error: { message: "Synthetic provider failure", codexErrorInfo },
        },
      },
    }]);
  });

  it.each([
    "futureProviderError=private-probe-value",
    { futureProviderError: { response: "private-probe-value" } },
    { responseStreamDisconnected: { httpStatusCode: 503, response: "private-probe-value" } },
    null,
    undefined,
  ])("redacts unknown or absent error details without losing willRetry: %j", (codexErrorInfo) => {
    const events = mapCodexNotification({
      method: "error",
      params: {
        threadId: "thread-error-probe",
        turnId: "turn-error-probe",
        willRetry: true,
        error: { message: "Synthetic provider failure", codexErrorInfo },
      },
    });

    expect(events).toMatchObject([{
      method: "error",
      params: { willRetry: true, error: { codexErrorInfo: null } },
    }]);
    expect(JSON.stringify(events)).not.toContain("private-probe-value");
  });

  it.each([
    "contextWindowExceeded",
    "rateLimitExceeded",
    "serverOverloaded",
    { responseStreamDisconnected: { httpStatusCode: 503 } },
  ])("retains pre-upgrade error classifications: %j", (codexErrorInfo) => {
    expect(mapCodexNotification({
      method: "error",
      params: {
        threadId: "thread-error-probe",
        turnId: "turn-error-probe",
        willRetry: false,
        error: { message: "Synthetic provider failure", codexErrorInfo },
      },
    })).toMatchObject([{
      method: "error",
      params: { willRetry: false, error: { codexErrorInfo } },
    }]);
  });

  it.each([null, undefined])("accepts old terminal records without an error: %j", (error) => {
    const [event] = mapCodexNotification({
      method: "turn/completed",
      params: {
        threadId: "thread-error-probe",
        turn: { id: "turn-error-probe", status: "completed", items: [], error },
      },
    });

    expect(event).toMatchObject({
      method: "turn/completed",
      params: { turn: { id: "turn-error-probe", status: "completed" } },
    });
  });
});
