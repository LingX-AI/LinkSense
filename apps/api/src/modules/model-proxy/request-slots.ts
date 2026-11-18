import { randomUUID } from "node:crypto";

import type { Redis } from "ioredis";
import { z } from "zod";

import { AppError } from "../../lib/errors.js";

const concurrentRequestsPerRun = 4;
const slotTtlMs = 190_000;

export async function reserveDesktopModelSlot(
  redis: Pick<Redis, "eval" | "zrem">,
  turnId: string,
): Promise<() => Promise<void>> {
  const key = `linksense:desktop-model-slots:${z.uuid().parse(turnId).toLowerCase()}`;
  const ticket = randomUUID();
  const acquired = await redis.eval(`
    local clock = redis.call('TIME')
    local now = tonumber(clock[1]) * 1000 + math.floor(tonumber(clock[2]) / 1000)
    redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', now)
    if redis.call('ZCARD', KEYS[1]) >= tonumber(ARGV[1]) then return 0 end
    redis.call('ZADD', KEYS[1], now + tonumber(ARGV[2]), ARGV[3])
    redis.call('PEXPIRE', KEYS[1], ARGV[2])
    return 1
  `, 1, key, concurrentRequestsPerRun, slotTtlMs, ticket);
  if (acquired !== 1) throw new AppError("RUNNER_UNAVAILABLE", undefined, 429);
  return async () => { await redis.zrem(key, ticket); };
}
