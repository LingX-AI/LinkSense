import { describe, expect, it, vi } from "vitest"
import { z } from "zod"
import type { LinkSenseRedis } from "../src/adapters/redis.js"
import { RedisSocialStateStore } from "../src/modules/social-auth/state.js"

describe("Redis social flow state", () => {
  it("uses expiring, hashed keys and atomically consumes cross-worker state", async () => {
    let saved: string | null = null
    const client = {
      set: vi.fn(async (_key: string, value: string) => {
        saved = value
        return "OK"
      }),
      get: vi.fn(async () => saved),
      eval: vi.fn(async () => {
        const value = saved
        saved = null
        return value
      }),
    }
    const store = new RedisSocialStateStore({
      client: client as unknown as LinkSenseRedis["client"],
    })
    const schema = z.object({ nonce: z.string() })
    await store.put("sensitive-state", { nonce: "nonce" }, 900)
    const key = client.set.mock.calls[0]?.[0]
    expect(key).toMatch(/^linksense:social-auth:[a-f0-9]{64}$/u)
    expect(key).not.toContain("sensitive-state")
    expect(client.set).toHaveBeenCalledWith(
      key,
      JSON.stringify({ nonce: "nonce" }),
      "EX",
      900,
      "NX",
    )
    expect(await store.read("sensitive-state", schema)).toEqual({
      nonce: "nonce",
    })
    expect(await store.read("sensitive-state", schema, true)).toEqual({
      nonce: "nonce",
    })
    expect(client.eval).toHaveBeenCalledWith(
      expect.stringContaining("redis.call('DEL'"),
      1,
      key,
    )
    expect(await store.read("sensitive-state", schema, true)).toBeNull()
  })
  it("fails closed on state collisions and rejects repeated throttle reservations", async () => {
    const client = { set: vi.fn(async () => null) }
    const store = new RedisSocialStateStore({
      client: client as unknown as LinkSenseRedis["client"],
    })
    await expect(store.put("same-state", {}, 900)).rejects.toThrow(
      "social state collision",
    )
    expect(await store.throttle("same-ip", 60)).toBe(false)
  })
})
