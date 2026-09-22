import { z } from "zod"
import type { LinkSenseRedis } from "../../adapters/redis.js"
import { sha256 } from "../../lib/crypto.js"

export interface SocialStateStore {
  put(key: string, value: unknown, ttl: number): Promise<void>
  read<T>(
    key: string,
    schema: z.ZodType<T>,
    consume?: boolean,
  ): Promise<T | null>
  throttle(key: string, ttl: number): Promise<boolean>
}

export class RedisSocialStateStore implements SocialStateStore {
  constructor(private readonly redis: Pick<LinkSenseRedis, "client">) {}
  private key(value: string): string {
    return `linksense:social-auth:${sha256(value)}`
  }
  async put(key: string, value: unknown, ttl: number): Promise<void> {
    const result = await this.redis.client.set(
      this.key(key),
      JSON.stringify(value),
      "EX",
      ttl,
      "NX",
    )
    if (result !== "OK") throw new Error("social state collision")
  }
  async read<T>(
    key: string,
    schema: z.ZodType<T>,
    consume = false,
  ): Promise<T | null> {
    const value = consume
      ? await this.redis.client.eval(
          "local v = redis.call('GET', KEYS[1]); if v then redis.call('DEL', KEYS[1]); end; return v",
          1,
          this.key(key),
        )
      : await this.redis.client.get(this.key(key))
    if (typeof value !== "string") return null
    const result = schema.safeParse(JSON.parse(value))
    return result.success ? result.data : null
  }
  async throttle(key: string, ttl: number): Promise<boolean> {
    return (
      (await this.redis.client.set(
        this.key(`throttle:${key}`),
        "1",
        "EX",
        ttl,
        "NX",
      )) === "OK"
    )
  }
}
