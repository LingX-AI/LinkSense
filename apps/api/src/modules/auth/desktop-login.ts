import { createHash, randomBytes } from "node:crypto"
import {
  desktopLoginAuthorizeInputSchema,
  desktopLoginExchangeInputSchema,
  desktopLoginChallengeSchema,
  type DesktopLoginAuthorizeInput,
  type DesktopLoginExchangeInput,
} from "@linksense/shared"
import { z } from "zod"

import type { LinkSenseRedis } from "../../adapters/redis.js"
import { sha256 } from "../../lib/crypto.js"
import { AppError } from "../../lib/errors.js"
import { LoginRateLimitedError, type AuthService, type AuthSession } from "./service.js"
import type { AuthenticatedUser, SessionMetadata } from "./types.js"

const grantSchema = z.strictObject({
  userId: z.uuid(),
  email: z.email(),
  authValidAfter: z.iso.datetime(),
  challenge: desktopLoginChallengeSchema,
})
type DesktopLoginGrant = z.infer<typeof grantSchema>

export interface DesktopLoginStore {
  save(code: string, grant: DesktopLoginGrant): Promise<void>
  consume(code: string, challenge: string): Promise<DesktopLoginGrant | null>
  takeRequest(key: string): Promise<boolean>
}

export class RedisDesktopLoginStore implements DesktopLoginStore {
  constructor(private readonly redis: Pick<LinkSenseRedis, "client">) {}

  async save(code: string, grant: DesktopLoginGrant): Promise<void> {
    const result = await this.redis.client.set(
      this.key("code", code), JSON.stringify(grant), "EX", 60, "NX",
    )
    if (result !== "OK") throw new Error("Desktop login code unavailable")
  }

  async consume(code: string, challenge: string): Promise<DesktopLoginGrant | null> {
    const value = await this.redis.client.eval(`
      local value = redis.call('GET', KEYS[1])
      if not value then return nil end
      local ok, grant = pcall(cjson.decode, value)
      if not ok or type(grant) ~= 'table' or grant.challenge ~= ARGV[1] then return nil end
      redis.call('DEL', KEYS[1])
      return value
    `, 1, this.key("code", code), challenge)
    if (typeof value !== "string") return null
    try {
      const parsed = grantSchema.safeParse(JSON.parse(value))
      return parsed.success ? parsed.data : null
    } catch {
      return null
    }
  }

  async takeRequest(key: string): Promise<boolean> {
    const count = await this.redis.client.eval(`
      local n = redis.call('INCR', KEYS[1])
      if n == 1 then redis.call('EXPIRE', KEYS[1], 60) end
      return n
    `, 1, this.key("limit", key))
    return typeof count === "number" && count <= 60
  }

  private key(purpose: string, value: string): string {
    return `linksense:desktop-login:${purpose}:${sha256(value)}`
  }
}

export class DesktopLoginService {
  constructor(
    private readonly auth: Pick<AuthService, "createDesktopSession">,
    private readonly store: DesktopLoginStore,
  ) {}

  async authorize(
    raw: DesktopLoginAuthorizeInput,
    user: AuthenticatedUser,
    metadata: SessionMetadata,
  ): Promise<{ code: string }> {
    const input = desktopLoginAuthorizeInputSchema.parse(raw)
    await this.admit(`authorize:user:${user.id}`)
    await this.admit(`authorize:ip:${metadata.ipAddress ?? "unknown"}`)
    const code = randomBytes(32).toString("base64url")
    await this.store.save(code, {
      userId: user.id, email: user.email, authValidAfter: user.authValidAfter.toISOString(),
      challenge: input.code_challenge,
    })
    return { code }
  }

  async exchange(raw: DesktopLoginExchangeInput, metadata: SessionMetadata): Promise<AuthSession> {
    const input = desktopLoginExchangeInputSchema.parse(raw)
    await this.admit(`exchange:ip:${metadata.ipAddress ?? "unknown"}`)
    const challenge = createHash("sha256").update(input.code_verifier).digest("base64url")
    const grant = await this.store.consume(input.code, challenge)
    if (!grant) throw new AppError("AUTH_SESSION_EXPIRED")
    return this.auth.createDesktopSession(grant.userId, grant.email, grant.authValidAfter, metadata)
  }

  private async admit(key: string): Promise<void> {
    let allowed: boolean
    try {
      allowed = await this.store.takeRequest(key)
    } catch {
      throw new AppError("AUTH_LOGIN_PROTECTION_UNAVAILABLE")
    }
    if (!allowed) throw new LoginRateLimitedError(60)
  }
}
