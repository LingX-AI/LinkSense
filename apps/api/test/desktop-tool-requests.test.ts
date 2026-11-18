import { randomUUID } from "node:crypto";
import { expect, it, vi } from "vitest";
import type { DesktopToolRequest } from "@linksense/shared";
import { AppError } from "../src/lib/errors.js";
import { executeDesktopTool } from "../src/modules/desktop-devices/tool-requests.js";

it("does not return a search result after the turn loses authority during the audit write", async () => {
  const scope = {
    ownerId: randomUUID(), deviceId: randomUUID(), connectionId: randomUUID(),
    conversationId: randomUUID(), turnId: randomUUID(), runtimeGeneration: randomUUID(),
  };
  const frame: DesktopToolRequest = {
    type: "tool.request", operation: "web.search", id: randomUUID(),
    conversation_id: scope.conversationId, turn_id: scope.turnId, runtime_generation: scope.runtimeGeneration,
    expires_at: new Date(Date.now() + 5_000).toISOString(), run_token: `lsdr_${"a".repeat(43)}`,
    body: { query: "sample" },
  };
  let active = true;
  const audit = vi.fn(async () => { active = false; });
  await expect(executeDesktopTool({
    leases: {
      claimToolRequest: async () => true,
      verifyRunBinding: async () => { if (!active) throw new AppError("AUTH_REQUIRED"); },
    },
    audit: { write: audit },
    webSearchSettings: {
      search: async () => ({ success: true, provider: "brave", query: frame.body.query, results: [] }),
    },
  }, scope, frame, new AbortController().signal)).rejects.toMatchObject({ code: "AUTH_REQUIRED" });
  expect(audit).toHaveBeenCalledOnce();
});
