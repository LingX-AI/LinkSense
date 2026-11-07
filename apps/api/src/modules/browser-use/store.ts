import type { Redis } from "ioredis";

export interface BrowserStore {
  get(key: string): Promise<string | null>;
  put(
    key: string,
    value: string,
    ttl: number,
    exclusive?: boolean,
  ): Promise<boolean>;
  take(key: string): Promise<string | null>;
  putIf(
    key: string,
    value: string,
    ttl: number,
    guard: string,
    expected: string,
  ): Promise<boolean>;
  takeIf(key: string, guard: string, expected: string): Promise<string | null>;
  touch(key: string, expected: string, ttl: number): Promise<boolean>;
  remove(key: string, expected?: string): Promise<void>;
}

export class RedisBrowserStore implements BrowserStore {
  constructor(private readonly redis: Redis) {}
  get(key: string): Promise<string | null> {
    return this.redis.get(key);
  }
  async put(
    key: string,
    value: string,
    ttl: number,
    exclusive = false,
  ): Promise<boolean> {
    return (
      (exclusive
        ? await this.redis.set(key, value, "PX", ttl, "NX")
        : await this.redis.set(key, value, "PX", ttl)) === "OK"
    );
  }
  take(key: string): Promise<string | null> {
    return this.redis.getdel(key);
  }
  async putIf(
    key: string,
    value: string,
    ttl: number,
    guard: string,
    expected: string,
  ): Promise<boolean> {
    return (
      (await this.redis.eval(
        "if redis.call('GET', KEYS[2]) ~= ARGV[1] then return 0 end; redis.call('SET', KEYS[1], ARGV[2], 'PX', ARGV[3]); return 1",
        2,
        key,
        guard,
        expected,
        value,
        String(ttl),
      )) === 1
    );
  }
  async takeIf(
    key: string,
    guard: string,
    expected: string,
  ): Promise<string | null> {
    const value = await this.redis.eval(
      "if redis.call('GET', KEYS[2]) ~= ARGV[1] then return nil end; return redis.call('GETDEL', KEYS[1])",
      2,
      key,
      guard,
      expected,
    );
    return typeof value === "string" ? value : null;
  }
  async touch(key: string, expected: string, ttl: number): Promise<boolean> {
    return (
      (await this.redis.eval(
        "if redis.call('GET', KEYS[1]) ~= ARGV[1] then return 0 end; return redis.call('PEXPIRE', KEYS[1], ARGV[2])",
        1,
        key,
        expected,
        String(ttl),
      )) === 1
    );
  }
  async remove(key: string, expected?: string): Promise<void> {
    if (expected === undefined) {
      await this.redis.del(key);
      return;
    }
    await this.redis.eval(
      "if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) else return 0 end",
      1,
      key,
      expected,
    );
  }
}
