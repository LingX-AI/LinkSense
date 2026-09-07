import { createHash, randomUUID } from "node:crypto";

import type { Redis } from "ioredis";

const RELEASE_LEASE_SCRIPT = `
if redis.call('GET', KEYS[1]) == ARGV[1] then
  return redis.call('DEL', KEYS[1])
end
return 0
`;

const RENEW_LEASE_SCRIPT = `
if redis.call('GET', KEYS[1]) == ARGV[1] then
  return redis.call('PEXPIRE', KEYS[1], tonumber(ARGV[2]))
end
return 0
`;

const LEASE_PREFIX = "linksense:v1:bot-channel-lease:";
export type BotChannelLease = { key: string; token: string };
export class BotChannelCoordinationError extends Error {
  constructor(options?: ErrorOptions) {
    super("BOT_CHANNEL_CONNECTION_FAILED", options);
  }
}
export class RedisBotChannelCoordinator {
  constructor(private readonly redis: Redis) {}
  async acquireLease(
    scope:
      | "inbound"
      | "delivery"
      | "websocket"
      | "connection"
      | "user-lifecycle"
      | "conversation",
    resourceId: string,
    ttlMilliseconds: number,
  ): Promise<BotChannelLease | null> {
    const key = leaseKey(scope, resourceId);
    const token = randomUUID();
    try {
      const result = await this.redis.set(
        key,
        token,
        "PX",
        ttlMilliseconds,
        "NX",
      );
      return result === "OK" ? { key, token } : null;
    } catch (error) {
      throw new BotChannelCoordinationError({ cause: error });
    }
  }

  async renewLease(
    lease: BotChannelLease,
    ttlMilliseconds: number,
  ): Promise<boolean> {
    try {
      const result = await this.redis.eval(
        RENEW_LEASE_SCRIPT,
        1,
        lease.key,
        lease.token,
        ttlMilliseconds,
      );
      return Number(result) === 1;
    } catch (error) {
      throw new BotChannelCoordinationError({ cause: error });
    }
  }

  async releaseLease(lease: BotChannelLease): Promise<void> {
    try {
      await this.redis.eval(RELEASE_LEASE_SCRIPT, 1, lease.key, lease.token);
    } catch (error) {
      throw new BotChannelCoordinationError({ cause: error });
    }
  }
}

function leaseKey(
  scope:
    | "inbound"
    | "delivery"
    | "websocket"
    | "connection"
    | "user-lifecycle"
    | "conversation",
  resourceId: string,
): string {
  if (scope === "user-lifecycle") {
    return `linksense:user-lifecycle-lock:${resourceId}`;
  }
  if (scope === "conversation") {
    return `linksense:conversation-lock:${resourceId}`;
  }
  return `${LEASE_PREFIX}${scope}:${digest(resourceId)}`;
}

function digest(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
