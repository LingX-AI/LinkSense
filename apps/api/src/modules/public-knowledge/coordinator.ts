import { randomUUID } from "node:crypto";
import type { Redis } from "ioredis";
import { publicKnowledgeConcurrencyLimit } from "@linksense/shared";
import { AppError } from "../../lib/errors.js";
import { sha256 } from "../../lib/crypto.js";

const RATE = `local n=redis.call('INCR',KEYS[1]); if n==1 then redis.call('PEXPIRE',KEYS[1],ARGV[1]) end; return n`;
const RELEASE = `if redis.call('GET',KEYS[1])==ARGV[1] then return redis.call('DEL',KEYS[1]) end; return 0`;
const RENEW = `if redis.call('GET',KEYS[1])==ARGV[1] then return redis.call('PEXPIRE',KEYS[1],ARGV[2]) end; return 0`;
const ACQUIRE = `local used=0; local free=0; for i=1,#KEYS do if redis.call('GET',KEYS[i]) then used=used+1 elseif free==0 then free=i end end; if used>=tonumber(ARGV[3]) or free==0 then return 0 end; redis.call('SET',KEYS[free],ARGV[1],'PX',ARGV[2]); return free`;

export class PublicKnowledgeCapacityUnavailableError extends AppError {
  constructor() {
    super("APPLICATION_EXTERNAL_RATE_LIMITED");
    this.name = "PublicKnowledgeCapacityUnavailableError";
  }
}
export interface PublicKnowledgeCoordinator {
  rateLimit(scope: string, subject: string, limit: number): Promise<void>;
  acquire(
    applicationId: string,
    conversationId: string,
    limit: number,
  ): Promise<{
    release(options?: { retainUntilExpiry: boolean }): Promise<void>;
    assertCurrent(): void;
  }>;
}

/** Redis owns admission across API processes; runtime lifetime remains native. */
export class RedisPublicKnowledgeCoordinator implements PublicKnowledgeCoordinator {
  constructor(
    private readonly redis: Redis,
    private readonly globalLimit = publicKnowledgeConcurrencyLimit,
  ) {}
  async rateLimit(
    scope: string,
    subject: string,
    limit: number,
  ): Promise<void> {
    try {
      const n = Number(
        await this.redis.eval(
          RATE,
          1,
          `linksense:public-knowledge:rate:${scope}:${sha256(subject)}`,
          "60000",
        ),
      );
      if (n > limit) throw new AppError("APPLICATION_EXTERNAL_RATE_LIMITED");
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError("RUNNER_UNAVAILABLE");
    }
  }
  async acquire(applicationId: string, conversationId: string, limit: number) {
    const token = randomUUID(),
      keys: string[] = [];
    const ttl = 240_000;
    const release = async () => {
      await Promise.all(
        keys.map((key) => this.redis.eval(RELEASE, 1, key, token)),
      );
    };
    const slot = async (scope: string, limit: number, capacity: number) => {
      const candidates = Array.from(
        { length: capacity },
        (_, index) => `linksense:public-knowledge:admission:${scope}:${index}`,
      );
      const index = Number(
        await this.redis.eval(
          ACQUIRE,
          candidates.length,
          ...candidates,
          token,
          String(ttl),
          String(limit),
        ),
      );
      const key = index > 0 ? candidates[index - 1] : undefined;
      if (!key) throw new PublicKnowledgeCapacityUnavailableError();
      keys.push(key);
    };
    try {
      await slot(`conversation:${conversationId}`, 1, 1);
      await slot(
        `application:${applicationId}`,
        limit,
        publicKnowledgeConcurrencyLimit,
      );
      await slot(
        "global",
        this.globalLimit,
        Math.max(this.globalLimit, publicKnowledgeConcurrencyLimit),
      );
    } catch (error) {
      await release();
      if (error instanceof AppError) throw error;
      throw new AppError("RUNNER_UNAVAILABLE");
    }
    let current = true,
      renewing: Promise<void> | undefined;
    const timer = setInterval(() => {
      if (renewing) return;
      renewing = Promise.all(
        keys.map((key) => this.redis.eval(RENEW, 1, key, token, String(ttl))),
      )
        .then((results) => {
          if (results.some((result) => Number(result) !== 1)) current = false;
        })
        .catch(() => {
          current = false;
        })
        .finally(() => {
          renewing = undefined;
        });
    }, 30_000);
    timer.unref();
    return {
      assertCurrent: () => {
        if (!current) throw new AppError("RUNNER_UNAVAILABLE");
      },
      release: async (options?: { retainUntilExpiry: boolean }) => {
        clearInterval(timer);
        await renewing;
        if (!options?.retainUntilExpiry) await release();
      },
    };
  }
}
