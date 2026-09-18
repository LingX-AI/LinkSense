import { describe, expect, it } from "vitest";
import { applicationTestSessionsQuerySchema, applicationTestRestartSchema, applicationTestInspectionInputSchema, applicationTestInspectionSchema } from "../src/application-development.js";

describe("application test contracts", () => {
  it("bounds paging and rejects caller-controlled ownership", () => {
    expect(applicationTestSessionsQuerySchema.parse({})).toEqual({ limit: 20 });
    for (const value of [{ limit: 0 }, { limit: 101 }, { cursor: "invalid" }, { owner_id: "someone" }]) expect(applicationTestSessionsQuerySchema.safeParse(value).success).toBe(false);
  });
  it("requires the displayed session and revision when restarting", () => {
    expect(applicationTestRestartSchema.parse({ revision: 0, preview_conversation_id: null })).toEqual({ revision: 0, preview_conversation_id: null });
    for (const value of [{}, { revision: -1, preview_conversation_id: null }, { revision: 1, preview_conversation_id: "invalid" }]) expect(applicationTestRestartSchema.safeParse(value).success).toBe(false);
  });
  it("restricts tool inspection to bounded session ids and bounded messages", () => {
    expect(applicationTestInspectionInputSchema.safeParse({ application_id: "other" }).success).toBe(false);
    expect(applicationTestInspectionSchema.safeParse({ sessions: { items: [], next_cursor: null }, detail: { conversation_id: "10000000-0000-4000-8000-000000000001", messages: [{ role: "assistant", content: "a".repeat(8001) }], truncated: true } }).success).toBe(false);
  });
});
