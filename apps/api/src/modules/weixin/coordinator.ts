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

const TAKE_VALUE_SCRIPT = `
local value = redis.call('GET', KEYS[1])
if value then redis.call('DEL', KEYS[1]) end
return value
`;

const LOGIN_SESSION_PREFIX = "linksense:v1:weixin-login:";
const LOGIN_VERIFICATION_PREFIX = "linksense:v1:weixin-login-verification:";
const LEASE_PREFIX = "linksense:v1:weixin-lease:";

export type WeixinLease = {
  key: string;
  token: string;
};

export class WeixinCoordinationError extends Error {
  constructor(options?: { cause?: unknown }) {
    super("WEIXIN_COORDINATION_UNAVAILABLE", options);
    this.name = "WeixinCoordinationError";
  }
}

export class RedisWeixinCoordinator {
  constructor(private readonly redis: Redis) {}

  async setLoginSession(
    sessionId: string,
    encryptedValue: string,
    ttlSeconds: number,
  ): Promise<void> {
    try {
      await this.redis.set(
        LOGIN_SESSION_PREFIX + sessionId,
        encryptedValue,
        "EX",
        ttlSeconds,
      );
    } catch (error) {
      throw new WeixinCoordinationError({ cause: error });
    }
  }

  async getLoginSession(sessionId: string): Promise<string | null> {
    try {
      return await this.redis.get(LOGIN_SESSION_PREFIX + sessionId);
    } catch (error) {
      throw new WeixinCoordinationError({ cause: error });
    }
  }

  async deleteLoginSession(sessionId: string): Promise<void> {
    try {
      await this.redis.del(
        LOGIN_SESSION_PREFIX + sessionId,
        LOGIN_VERIFICATION_PREFIX + sessionId,
      );
    } catch (error) {
      throw new WeixinCoordinationError({ cause: error });
    }
  }

  async setLoginVerification(
    sessionId: string,
    encryptedValue: string,
    ttlSeconds: number,
  ): Promise<void> {
    try {
      await this.redis.set(
        LOGIN_VERIFICATION_PREFIX + sessionId,
        encryptedValue,
        "EX",
        ttlSeconds,
      );
    } catch (error) {
      throw new WeixinCoordinationError({ cause: error });
    }
  }

  async takeLoginVerification(sessionId: string): Promise<string | null> {
    try {
      const result = await this.redis.eval(
        TAKE_VALUE_SCRIPT,
        1,
        LOGIN_VERIFICATION_PREFIX + sessionId,
      );
      return typeof result === "string" ? result : null;
    } catch (error) {
      throw new WeixinCoordinationError({ cause: error });
    }
  }

  async clearLoginVerification(sessionId: string): Promise<void> {
    try {
      await this.redis.del(LOGIN_VERIFICATION_PREFIX + sessionId);
    } catch (error) {
      throw new WeixinCoordinationError({ cause: error });
    }
  }

  async acquireLease(
    scope:
      | "login"
      | "poll"
      | "inbound"
      | "delivery"
      | "connection"
      | "user-lifecycle"
      | "conversation",
    resourceId: string,
    ttlMilliseconds: number,
  ): Promise<WeixinLease | null> {
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
      throw new WeixinCoordinationError({ cause: error });
    }
  }

  async renewLease(
    lease: WeixinLease,
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
      throw new WeixinCoordinationError({ cause: error });
    }
  }

  async releaseLease(lease: WeixinLease): Promise<void> {
    try {
      await this.redis.eval(
        RELEASE_LEASE_SCRIPT,
        1,
        lease.key,
        lease.token,
      );
    } catch (error) {
      throw new WeixinCoordinationError({ cause: error });
    }
  }
}

function leaseKey(
  scope:
    | "login"
    | "poll"
    | "inbound"
    | "delivery"
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
