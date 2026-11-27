import { z } from "zod";
import type { AppConfig } from "../../config.js";
import { decryptJson, encryptJson, sha256 } from "../../lib/crypto.js";
import { AppError } from "../../lib/errors.js";

export const visitorSessionSeconds = 30 * 24 * 60 * 60;
const sessionSchema = z.object({ cookie: z.string().max(16_384) });
const capabilitySchema = z.strictObject({
  backendId: z.uuid(), siteId: z.uuid(), visitor: z.string().length(64), expires: z.number(),
});
export type VisitorSession = { cookie: string; version: string | null };
export type VisitorSessionConfig = Pick<AppConfig, "credentialMasterKey" | "credentialKeyId">;
export interface VisitorSessionRedis {
  get(key: string): Promise<string | null>;
  eval(script: string, keys: number, key: string, ...args: Array<string | number>): Promise<unknown>;
}
export class WebSiteVisitorSessions {
  constructor(private readonly redis: VisitorSessionRedis, private readonly config: VisitorSessionConfig) {}

  capability(backendId: string, siteId: string, visitor: string): string {
    return encryptJson({ backendId, siteId, visitor: sha256(visitor), expires: Date.now() + visitorSessionSeconds * 1000 },
      this.config.credentialMasterKey, this.config.credentialKeyId, "public-app-capability");
  }

  authorize(token: unknown, backendId: string, siteId: string, visitor: string): void {
    try {
      const value = capabilitySchema.parse(decryptJson<unknown>(z.string().max(2048).parse(token),
        this.config.credentialMasterKey, this.config.credentialKeyId, "public-app-capability"));
      if (value.backendId !== backendId || value.siteId !== siteId || value.visitor !== sha256(visitor) ||
          value.expires <= Date.now()) throw new Error("Expired or mismatched capability");
    } catch { throw new AppError("FORBIDDEN"); }
  }

  private key(backendId: string, visitor: string): string {
    return `linksense:public-app:session:${backendId}:${sha256(visitor)}`;
  }

  async read(backendId: string, visitor: string): Promise<VisitorSession> {
    const key = this.key(backendId, visitor);
    const version = await this.redis.get(key);
    if (!version) return { cookie: "", version: null };
    try {
      return { cookie: sessionSchema.parse(decryptJson<unknown>(version,
        this.config.credentialMasterKey, this.config.credentialKeyId, key)).cookie, version };
    } catch { throw new AppError("WEB_SITE_BACKEND_UNAVAILABLE"); }
  }

  async save(backendId: string, visitor: string, previous: VisitorSession, cookie: string): Promise<void> {
    const key = this.key(backendId, visitor);
    const value = encryptJson(sessionSchema.parse({ cookie }), this.config.credentialMasterKey, this.config.credentialKeyId, key);
    // Compare-and-set prevents an in-flight login/logout from restoring a newer session.
    const saved = await this.redis.eval(`
      local current = redis.call('GET', KEYS[1])
      if (current or '') ~= ARGV[1] then return 0 end
      redis.call('SET', KEYS[1], ARGV[2], 'EX', ARGV[3])
      return 1`, 1, key, previous.version ?? "", value, visitorSessionSeconds);
    if (saved !== 1) throw new AppError("CONFLICT");
  }

  async admit(backendId: string, ip: string): Promise<void> {
    const accepted = await this.redis.eval(`
      local count = redis.call('INCR', KEYS[1])
      if count == 1 then redis.call('EXPIRE', KEYS[1], 60) end
      return count`, 1, `linksense:public-app:rate:${backendId}:${sha256(ip)}`);
    if (typeof accepted !== "number" || accepted > 180) throw new AppError("APPLICATION_EXTERNAL_RATE_LIMITED");
  }
}
