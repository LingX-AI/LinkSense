import { describe, expect, it } from "vitest";

import { runnerCodexErrorInfoSchema, runnerCodexEventSchema } from "../src/events.js";

describe("Codex error event contracts", () => {
  it.each([
    "flexUnavailable",
    "modelNotFound",
    "policyCapacityUnavailable",
    "tooManyDenials",
    "contextWindowExceeded",
    "rateLimitExceeded",
    "serverOverloaded",
  ])("accepts %s in retry notifications and persisted failed turns", (codexErrorInfo) => {
    expect(runnerCodexErrorInfoSchema.parse(codexErrorInfo)).toBe(codexErrorInfo);
    for (const willRetry of [true, false]) {
      expect(runnerCodexEventSchema.safeParse({
        method: "error",
        visibility: willRetry ? "user_collapsed" : "user_visible",
        params: { threadId: "thread-probe", turnId: "turn-probe", willRetry, error: { codexErrorInfo } },
      }).success).toBe(true);
    }
    expect(runnerCodexEventSchema.safeParse({
      method: "turn/completed",
      visibility: "user_visible",
      params: {
        threadId: "thread-probe",
        turn: { id: "turn-probe", status: "failed", error: { codexErrorInfo } },
      },
    }).success).toBe(true);
  });

  it.each([
    "futureProviderError",
    { futureProviderError: { response: "private-response" } },
    { responseStreamDisconnected: { httpStatusCode: 503, response: "private-response" } },
  ])("rejects unrecognized raw native details: %j", (codexErrorInfo) => {
    expect(runnerCodexErrorInfoSchema.safeParse(codexErrorInfo).success).toBe(false);
  });
});
