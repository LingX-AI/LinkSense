import { randomUUID } from "node:crypto";
import { desktopAttachmentStartLifetimeMs } from "@linksense/shared";
import type { Redis } from "ioredis";
import { AppError } from "../../lib/errors.js";

const key = "linksense:desktop-attachment-downloads";
const maximum = 4;

export async function reserveDesktopAttachmentSlot(redis: Pick<Redis, "eval" | "zrem">): Promise<() => Promise<void>> {
  const ticket = randomUUID();
  const admitted = await redis.eval(`
    local time = redis.call('TIME')
    local now = tonumber(time[1]) * 1000 + math.floor(tonumber(time[2]) / 1000)
    redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', now)
    if redis.call('ZCARD', KEYS[1]) >= tonumber(ARGV[1]) then return 0 end
    redis.call('ZADD', KEYS[1], now + tonumber(ARGV[2]), ARGV[3])
    redis.call('PEXPIRE', KEYS[1], ARGV[2])
    return 1
  `, 1, key, maximum, desktopAttachmentStartLifetimeMs, ticket);
  if (admitted !== 1) throw new AppError("RUNNER_UNAVAILABLE", undefined, 429);
  return async () => { await redis.zrem(key, ticket); };
}
