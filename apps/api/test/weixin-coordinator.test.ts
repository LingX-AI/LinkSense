import type { Redis } from "ioredis";
import { describe, expect, it, vi } from "vitest";

import { RedisWeixinCoordinator } from "../src/modules/weixin/coordinator.js";

describe("RedisWeixinCoordinator", () => {
  it("atomically consumes a pairing code", async () => {
    const redis = {
      eval: vi.fn(async () => "encrypted-code"),
    };
    const coordinator = new RedisWeixinCoordinator(redis as unknown as Redis);

    await expect(
      coordinator.takeLoginVerification("session-id"),
    ).resolves.toBe("encrypted-code");
    expect(redis.eval).toHaveBeenCalledWith(
      expect.stringContaining("redis.call('DEL', KEYS[1])"),
      1,
      "linksense:v1:weixin-login-verification:session-id",
    );
  });

  it("renews only the lease held by the same token", async () => {
    const redis = {
      set: vi.fn(async () => "OK"),
      eval: vi.fn(async () => 1),
    };
    const coordinator = new RedisWeixinCoordinator(redis as unknown as Redis);
    const lease = await coordinator.acquireLease(
      "user-lifecycle",
      "user-id",
      30_000,
    );

    expect(lease).not.toBeNull();
    expect(redis.set).toHaveBeenCalledWith(
      "linksense:user-lifecycle-lock:user-id",
      expect.any(String),
      "PX",
      30_000,
      "NX",
    );
    await expect(
      coordinator.renewLease(lease!, 30_000),
    ).resolves.toBe(true);
    expect(redis.eval).toHaveBeenCalledWith(
      expect.stringContaining("PEXPIRE"),
      1,
      lease?.key,
      lease?.token,
      30_000,
    );
  });
});
