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
  async setRegistration(
    id: string,
    encryptedValue: string,
    ttlSeconds: number,
  ): Promise<void> {
    await this.redis.set(
      "linksense:v2:bot-registration:" + id,
      encryptedValue,
      "EX",
      ttlSeconds,
    );
  }
  getRegistration(id: string): Promise<string | null> {
    return this.redis.get("linksense:v2:bot-registration:" + id);
  }
  async issueLinkCode(
    connectionId: string,
    userId: string,
    code: string,
    ttlSeconds: number,
  ): Promise<void> {
    const ownerKey =
      "linksense:v2:bot-link-owner:" + digest(connectionId + ":" + userId);
    const tokenKey =
      "linksense:v2:bot-link-code:" + digest(connectionId + ":" + code);
    await this.redis.eval(
      `
local previous = redis.call('GET', KEYS[1])
if previous then redis.call('DEL', previous) end
redis.call('SET', KEYS[1], KEYS[2], 'EX', ARGV[2])
redis.call('SET', KEYS[2], ARGV[1], 'EX', ARGV[2])
return 1`,
      2,
      ownerKey,
      tokenKey,
      userId,
      ttlSeconds,
    );
  }
  async revokeLinkCode(connectionId: string, userId: string): Promise<void> {
    await this.redis.eval(
      `local previous = redis.call('GET', KEYS[1]); if previous then redis.call('DEL', previous) end; return redis.call('DEL', KEYS[1])`,
      1,
      "linksense:v2:bot-link-owner:" + digest(connectionId + ":" + userId),
    );
  }
  async activateRegistration(ownerId: string, id: string): Promise<void> {
    await this.redis.set(
      "linksense:v2:bot-active-registration:" + digest(ownerId),
      id,
      "EX",
      7500,
    );
  }
  async isActiveRegistration(ownerId: string, id: string): Promise<boolean> {
    return (
      (await this.redis.get(
        "linksense:v2:bot-active-registration:" + digest(ownerId),
      )) === id
    );
  }
  async cancelRegistration(ownerId: string): Promise<void> {
    await this.redis.del(
      "linksense:v2:bot-active-registration:" + digest(ownerId),
    );
  }
  async consumeLinkCode(
    connectionId: string,
    code: string,
  ): Promise<string | null> {
    return this.redis.getdel(
      "linksense:v2:bot-link-code:" + digest(connectionId + ":" + code),
    );
  }
  async allowIdentityNotice(
    connectionId: string,
    senderId: string,
  ): Promise<boolean> {
    return (
      (await this.redis.set(
        "linksense:v2:bot-identity-notice:" +
          digest(connectionId + ":" + senderId),
        "1",
        "EX",
        60,
        "NX",
      )) === "OK"
    );
  }

  async acquireLease(
    scope:
      | "registration"
      | "registration-owner"
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
    | "registration"
    | "registration-owner"
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
