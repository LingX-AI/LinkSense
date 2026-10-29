import { Redis } from "ioredis";
import { describe, expect, it, vi } from "vitest";
import { RedisHtmlPreviewSessionStore } from "../src/modules/html-preview/service.js";
import { ownerId, taskId, fileId } from "./web-sites.fixture.js";

describe("Redis HTML preview sessions", () => {
  it("uses expiring shared storage with hashed keys and fails closed for corrupt state", async () => {
    const client = new Redis({ lazyConnect: true });
    const set = vi.spyOn(client, "set").mockResolvedValue("OK");
    const get = vi.spyOn(client, "get");
    const session = "a".repeat(64);
    const state = { ownerId, conversationId: taskId, fileId, manifestDigest: "b".repeat(64), expiresAt: Date.now() + 900_000 };
    const writer = new RedisHtmlPreviewSessionStore({ client });
    const reader = new RedisHtmlPreviewSessionStore({ client });
    try {
      await writer.save(session, state, 900);
      expect(set).toHaveBeenCalledWith(expect.stringMatching(/^html-preview:[a-f0-9]{64}$/u), JSON.stringify(state), "EX", 900);
      expect(set.mock.calls[0]?.[0]).not.toContain(session);
      get.mockResolvedValueOnce(JSON.stringify(state));
      await expect(reader.get(session)).resolves.toEqual(state);
      for (const value of [null, "invalid", "{}", JSON.stringify({ ...state, ownerId: "invalid" })]) {
        get.mockResolvedValueOnce(value);
        await expect(reader.get(session)).resolves.toBeNull();
      }
    } finally { client.disconnect(); }
  });
});
