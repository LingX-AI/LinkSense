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

const REPLACE_ACTIVE_REGISTRATION_SCRIPT = `
local previous = redis.call('GET', KEYS[1])
redis.call('SET', KEYS[1], ARGV[1], 'EX', tonumber(ARGV[2]))
return previous
`;

const CLEAR_MATCHING_VALUE_SCRIPT = `
if redis.call('GET', KEYS[1]) == ARGV[1] then
  return redis.call('DEL', KEYS[1])
end
return 0
`;

const REGISTRATION_SESSION_PREFIX = "linksense:v1:feishu-registration:";
const ACTIVE_REGISTRATION_PREFIX = "linksense:v1:feishu-active-registration:";
const LEASE_PREFIX = "linksense:v1:feishu-lease:";

export type FeishuLease = {
  key: string;
  token: string;
};

export class FeishuCoordinationError extends Error {
  constructor(options?: { cause?: unknown }) {
    super("FEISHU_COORDINATION_UNAVAILABLE", options);
    this.name = "FeishuCoordinationError";
  }
}

export class RedisFeishuCoordinator {
  constructor(private readonly redis: Redis) {}

  async setRegistrationSession(
    sessionId: string,
    encryptedValue: string,
    ttlSeconds: number,
  ): Promise<void> {
    try {
      await this.redis.set(
        REGISTRATION_SESSION_PREFIX + sessionId,
        encryptedValue,
        "EX",
        ttlSeconds,
      );
    } catch (error) {
      throw new FeishuCoordinationError({ cause: error });
    }
  }

  async getRegistrationSession(sessionId: string): Promise<string | null> {
    try {
      return await this.redis.get(REGISTRATION_SESSION_PREFIX + sessionId);
    } catch (error) {
      throw new FeishuCoordinationError({ cause: error });
    }
  }

  async replaceActiveRegistration(
    ownerId: string,
    sessionId: string,
    ttlSeconds: number,
  ): Promise<string | null> {
    try {
      const result = await this.redis.eval(
        REPLACE_ACTIVE_REGISTRATION_SCRIPT,
        1,
        ACTIVE_REGISTRATION_PREFIX + digest(ownerId),
        sessionId,
        ttlSeconds,
      );
      return typeof result === "string" ? result : null;
    } catch (error) {
      throw new FeishuCoordinationError({ cause: error });
    }
  }

  async isActiveRegistration(
    ownerId: string,
    sessionId: string,
  ): Promise<boolean> {
    try {
      return (
        (await this.redis.get(ACTIVE_REGISTRATION_PREFIX + digest(ownerId))) ===
        sessionId
      );
    } catch (error) {
      throw new FeishuCoordinationError({ cause: error });
    }
  }

  async clearActiveRegistration(
    ownerId: string,
    sessionId: string,
  ): Promise<void> {
    try {
      await this.redis.eval(
        CLEAR_MATCHING_VALUE_SCRIPT,
        1,
        ACTIVE_REGISTRATION_PREFIX + digest(ownerId),
        sessionId,
      );
    } catch (error) {
      throw new FeishuCoordinationError({ cause: error });
    }
  }

  async acquireLease(
    scope:
      | "inbound"
      | "delivery"
      | "websocket"
      | "user-lifecycle"
      | "conversation",
    resourceId: string,
    ttlMilliseconds: number,
  ): Promise<FeishuLease | null> {
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
      throw new FeishuCoordinationError({ cause: error });
    }
  }

  async renewLease(
    lease: FeishuLease,
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
      throw new FeishuCoordinationError({ cause: error });
    }
  }

  async releaseLease(lease: FeishuLease): Promise<void> {
    try {
      await this.redis.eval(
        RELEASE_LEASE_SCRIPT,
        1,
        lease.key,
        lease.token,
      );
    } catch (error) {
      throw new FeishuCoordinationError({ cause: error });
    }
  }
}

function leaseKey(
  scope:
    | "inbound"
    | "delivery"
    | "websocket"
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
