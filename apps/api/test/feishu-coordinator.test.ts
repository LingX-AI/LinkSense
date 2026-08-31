import type { Redis } from "ioredis";
import { describe, expect, it, vi } from "vitest";

import { RedisFeishuCoordinator } from "../src/modules/feishu/coordinator.js";

describe("RedisFeishuCoordinator", () => {
  it("replaces the owner's active registration atomically", async () => {
    const redis = { eval: vi.fn(async () => "previous-session") };
    const coordinator = new RedisFeishuCoordinator(redis as unknown as Redis);

    await expect(
      coordinator.replaceActiveRegistration("owner-id", "new-session", 600),
    ).resolves.toBe("previous-session");
    expect(redis.eval).toHaveBeenCalledWith(
      expect.stringContaining("return previous"),
      1,
      expect.stringMatching(/^linksense:v1:feishu-active-registration:/u),
      "new-session",
      600,
    );
  });

  it("shares lifecycle and conversation locks with other message channels", async () => {
    const redis = { set: vi.fn(async () => "OK") };
    const coordinator = new RedisFeishuCoordinator(redis as unknown as Redis);

    await coordinator.acquireLease("user-lifecycle", "user-id", 30_000);
    await coordinator.acquireLease("conversation", "conversation-id", 30_000);

    expect(redis.set).toHaveBeenNthCalledWith(
      1,
      "linksense:user-lifecycle-lock:user-id",
      expect.any(String),
      "PX",
      30_000,
      "NX",
    );
    expect(redis.set).toHaveBeenNthCalledWith(
      2,
      "linksense:conversation-lock:conversation-id",
      expect.any(String),
      "PX",
      30_000,
      "NX",
    );
  });
});
