import { z } from "zod";
import type { LinkSenseRedis } from "../../adapters/redis.js";
import { sha256 } from "../../lib/crypto.js";

export interface SamlStateStore {
  put(key: string, value: string, ttlSeconds: number): Promise<void>;
  get(key: string, consume?: boolean): Promise<string | null>;
  throttle(ip: string): Promise<boolean>;
}
export class RedisSamlStateStore implements SamlStateStore {
  constructor(private readonly redis: Pick<LinkSenseRedis, "client">) {}
  private key(value: string): string {
    return `linksense:saml:${sha256(value)}`;
  }
  async put(key: string, value: string, ttlSeconds: number): Promise<void> {
    if (
      (await this.redis.client.set(
        this.key(key),
        value,
        "EX",
        ttlSeconds,
        "NX",
      )) !== "OK"
    )
      throw new Error("SAML state collision");
  }
  async get(key: string, consume = false): Promise<string | null> {
    const result = consume
      ? await this.redis.client.eval(
          "local v = redis.call('GET', KEYS[1]); if v then redis.call('DEL', KEYS[1]); end; return v",
          1,
          this.key(key),
        )
      : await this.redis.client.get(this.key(key));
    return z.string().nullable().parse(result);
  }
  async throttle(ip: string): Promise<boolean> {
    const result = await this.redis.client.eval(
      "local n = redis.call('INCR', KEYS[1]); if n == 1 then redis.call('EXPIRE', KEYS[1], 60); end; return n",
      1,
      this.key(`rate:${ip}`),
    );
    return z.number().parse(result) <= 20;
  }
}
