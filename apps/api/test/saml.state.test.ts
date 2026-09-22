import { describe, expect, it, vi } from "vitest";
import type { LinkSenseRedis } from "../src/adapters/redis.js";
import { RedisSamlStateStore } from "../src/modules/saml/state.js";

describe("SAML Redis state", () => {
  it("uses expiring opaque keys and atomically consumes shared worker state", async () => {
    let saved: string | null = null;
    const client = {
      set: vi.fn(async (_key: string, value: string) => {
        saved = value;
        return "OK";
      }),
      get: vi.fn(async () => saved),
      eval: vi.fn(async () => {
        const value = saved;
        saved = null;
        return value;
      }),
    };
    const state = new RedisSamlStateStore({
      client: client as unknown as LinkSenseRedis["client"],
    });
    await state.put("private-relay-state", "flow", 300);
    const key = client.set.mock.calls[0]?.[0];
    expect(key).toMatch(/^linksense:saml:[a-f0-9]{64}$/u);
    expect(client.set).toHaveBeenCalledWith(key, "flow", "EX", 300, "NX");
    expect(await state.get("private-relay-state")).toBe("flow");
    const anotherWorker = new RedisSamlStateStore({
      client: client as unknown as LinkSenseRedis["client"],
    });
    expect(await anotherWorker.get("private-relay-state", true)).toBe("flow");
    expect(await state.get("private-relay-state", true)).toBeNull();
    expect(client.eval).toHaveBeenCalledWith(
      expect.stringContaining("redis.call('DEL'"),
      1,
      key,
    );
  });
  it("fails closed on collisions and invalid Redis results, and limits IP starts to 20 per minute", async () => {
    const client = {
      set: vi.fn(async () => null),
      eval: vi
        .fn()
        .mockResolvedValueOnce(20)
        .mockResolvedValueOnce(21)
        .mockResolvedValueOnce("invalid"),
    };
    const state = new RedisSamlStateStore({
      client: client as unknown as LinkSenseRedis["client"],
    });
    await expect(state.put("collision", "data", 300)).rejects.toThrow(
      "SAML state collision",
    );
    expect(await state.throttle("192.0.2.1")).toBe(true);
    expect(await state.throttle("192.0.2.1")).toBe(false);
    await expect(state.throttle("192.0.2.1")).rejects.toThrow();
    expect(client.eval.mock.calls[0]?.[0]).toContain(
      "redis.call('EXPIRE', KEYS[1], 60)",
    );
    expect(client.eval.mock.calls[0]?.[2]).not.toContain("192.0.2.1");
  });
});
