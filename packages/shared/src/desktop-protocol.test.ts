import { describe, expect, it } from "vitest";
import { conversationCreateInputSchema } from "./conversations.js";
import { conversationExecutionSelectionSchema } from "./desktop-protocol.js";

const device = "10000000-0000-4000-8000-000000000009";

describe("conversation execution selections", () => {
  it("defaults pre-desktop requests to cloud and retains the same refinement in create requests", () => {
    expect(conversationExecutionSelectionSchema.parse({})).toEqual({ execution_target: "cloud", desktop_device_id: null });
    expect(conversationCreateInputSchema.parse({})).toEqual({
      collaboration_mode: "default", execution_target: "cloud", desktop_device_id: null,
    });
    expect(conversationCreateInputSchema.parse({ execution_target: "local", desktop_device_id: device }))
      .toMatchObject({ execution_target: "local", desktop_device_id: device });
  });

  it.each([
    { execution_target: "local" }, { execution_target: "cloud", desktop_device_id: device },
    { execution_target: "local", desktop_device_id: null }, { execution_target: "hybrid" },
  ])("rejects an inconsistent or unknown target: %j", input => {
    expect(conversationExecutionSelectionSchema.safeParse(input).success).toBe(false);
    expect(conversationCreateInputSchema.safeParse(input).success).toBe(false);
  });
});
