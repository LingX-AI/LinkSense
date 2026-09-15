import { randomUUID } from "node:crypto"
import { isIP } from "node:net"

import { Redis } from "ioredis"
import ipaddr from "ipaddr.js"
import { runnerHeartbeatLeaseMs } from "@linksense/shared"
import { z } from "zod"

import type { AppConfig } from "../config.js"
import { hmacSha256 } from "../lib/crypto.js"
import {
  conversationPrewarmReservationSchema,
  conversationPrewarmReservationTtlMs,
  type ConversationPrewarmReservation,
} from "../modules/conversations/prewarm.js"

const LOGIN_PRECHECK_SCRIPT = `
local ip_ttl = redis.call('TTL', KEYS[1])
local email_ttl = redis.call('TTL', KEYS[2])
if ip_ttl < 0 then ip_ttl = 0 end
if email_ttl < 0 then email_ttl = 0 end
return {ip_ttl, email_ttl}
`

const LOGIN_RECORD_FAILURE_SCRIPT = `
local function bump(window_key, cooldown_key, limit, window_ttl, cooldown_ttl)
  local existing_ttl = redis.call('TTL', cooldown_key)
  if existing_ttl > 0 then return {existing_ttl, 0} end
  local count = redis.call('INCR', window_key)
  if count == 1 then redis.call('EXPIRE', window_key, window_ttl) end
  if count >= limit then
    redis.call('SET', cooldown_key, '1', 'NX', 'EX', cooldown_ttl)
    redis.call('DEL', window_key)
    local ttl = redis.call('TTL', cooldown_key)
    if ttl < 1 then ttl = cooldown_ttl end
    return {ttl, 1}
  end
  return {0, 0}
end
local ip = bump(KEYS[1], KEYS[2], tonumber(ARGV[1]), tonumber(ARGV[2]), tonumber(ARGV[3]))
local email = bump(KEYS[3], KEYS[4], tonumber(ARGV[4]), tonumber(ARGV[5]), tonumber(ARGV[6]))
return {ip[1], email[1], ip[2], email[2]}
`

const RESET_RATE_LIMIT_SCRIPT = `
local function take(key, limit, ttl)
  local count = redis.call('INCR', key)
  if count == 1 then redis.call('EXPIRE', key, ttl) end
  if count > limit then return 0 end
  return 1
end
local email_allowed = take(KEYS[1], tonumber(ARGV[1]), tonumber(ARGV[2]))
local ip_allowed = take(KEYS[2], tonumber(ARGV[3]), tonumber(ARGV[4]))
if email_allowed == 1 and ip_allowed == 1 then return 1 end
return 0
`

const ACQUIRE_CONCURRENCY_SCRIPT = `
local function watch_owner()
  local time = redis.call('TIME')
  local deadline = time[1] * 1000 + math.floor(time[2] / 1000) + ${runnerHeartbeatLeaseMs}
  redis.call('ZADD', KEYS[5], 'NX', deadline, ARGV[3])
  redis.call('ZADD', KEYS[6], 0, ARGV[3] .. ':' .. ARGV[1])
end
local recovery_outcome = redis.call('HGET', KEYS[4], 'outcome')
local recovery_last_success_at = redis.call(
  'HGET',
  KEYS[4],
  'last_success_at'
)
local capacity_ready = recovery_outcome == 'succeeded'
  or (
    recovery_outcome == 'running'
    and recovery_last_success_at
    and recovery_last_success_at ~= ''
  )
local count = redis.call('HLEN', KEYS[1])
if not capacity_ready then return {0, count, 0} end

local current_turn = redis.call('HGET', KEYS[1], ARGV[1])
if current_turn then
  if current_turn == ARGV[2] then
    redis.call('HSET', KEYS[2], ARGV[1], ARGV[3])
    watch_owner()
    return {1, count, 1}
  end
  return {0, count, 1}
end
if count >= tonumber(ARGV[4]) then return {0, count, 1} end
redis.call('HSET', KEYS[1], ARGV[1], ARGV[2])
redis.call('HSET', KEYS[2], ARGV[1], ARGV[3])
redis.call('HDEL', KEYS[3], ARGV[1] .. ':' .. ARGV[2])
watch_owner()
return {1, count + 1, 1}
`

const RELEASE_CONCURRENCY_SCRIPT = `
if redis.call('HGET', KEYS[1], ARGV[1]) == ARGV[2] then
  local owner = redis.call('HGET', KEYS[2], ARGV[1])
  if owner then redis.call('ZREM', KEYS[4], owner .. ':' .. ARGV[1]) end
  redis.call('HDEL', KEYS[1], ARGV[1])
  redis.call('HDEL', KEYS[2], ARGV[1])
  -- Only a concurrent bootstrap snapshot can resurrect a released token.
  -- Ordinary event-driven releases must not accumulate historical markers.
  if redis.call('EXISTS', KEYS[5]) == 1 then
    redis.call('HSET', KEYS[3], ARGV[1] .. ':' .. ARGV[2], '1')
  end
  return 1
end
return 0
`

const RECONCILE_CONCURRENCY_SCRIPT = `
if redis.call('GET', KEYS[4]) ~= ARGV[1] then
  return {0, redis.call('HLEN', KEYS[1]), 0}
end
if tonumber(redis.call('GET', KEYS[5]) or '0') ~= tonumber(ARGV[2]) then
  return {0, redis.call('HLEN', KEYS[1]), 0}
end

-- Detect an existing token that disagrees with the durable snapshot before
-- mutating tombstones or adding any missing slots.
for index = 3, #ARGV, 3 do
  local conversation_id = ARGV[index]
  local database_turn = ARGV[index + 1]
  local current_turn = redis.call('HGET', KEYS[1], conversation_id)
  if current_turn and current_turn ~= database_turn then
    return {1, redis.call('HLEN', KEYS[1]), 1}
  end
end

local active_markers = {}
for index = 3, #ARGV, 3 do
  active_markers[ARGV[index] .. ':' .. ARGV[index + 1]] = true
end

local existing_markers = redis.call('HKEYS', KEYS[3])
for _, marker_key in ipairs(existing_markers) do
  if not active_markers[marker_key] then
    redis.call('HDEL', KEYS[3], marker_key)
  end
end

for index = 3, #ARGV, 3 do
  local conversation_id = ARGV[index]
  local database_turn = ARGV[index + 1]
  local owner_id = ARGV[index + 2]
  local time = redis.call('TIME')
  redis.call('ZADD', KEYS[6], 'NX', time[1] * 1000 + math.floor(time[2] / 1000) + ${runnerHeartbeatLeaseMs}, owner_id)
  local current_turn = redis.call('HGET', KEYS[1], conversation_id)
  if not current_turn then
    local released = redis.call(
      'HGET',
      KEYS[3],
      conversation_id .. ':' .. database_turn
    )
    if not released then
      redis.call('HSET', KEYS[1], conversation_id, database_turn)
      redis.call('HSET', KEYS[2], conversation_id, owner_id)
    end
  elseif current_turn == database_turn then
    redis.call('HSET', KEYS[2], conversation_id, owner_id)
  end
  if redis.call('HGET', KEYS[1], conversation_id) == database_turn then
    redis.call('ZADD', KEYS[7], 0, owner_id .. ':' .. conversation_id)
  end
end

return {1, redis.call('HLEN', KEYS[1]), 0}
`

const ACQUIRE_RECONCILE_LEASE_SCRIPT = `
if redis.call('SET', KEYS[1], ARGV[1], 'NX', 'PX', ARGV[2]) then
  return redis.call('INCR', KEYS[2])
end
return 0
`

const BEGIN_RUNNING_TURN_RECOVERY_SCRIPT = `
if redis.call('GET', KEYS[1]) ~= ARGV[1] then return 0 end
if tonumber(redis.call('GET', KEYS[2]) or '0') ~= tonumber(ARGV[2]) then
  return 0
end

local attempt = redis.call('INCR', KEYS[3])
local last_success_at = redis.call('HGET', KEYS[4], 'last_success_at') or ''
local last_failure_at = redis.call('HGET', KEYS[4], 'last_failure_at') or ''
redis.call(
  'HSET',
  KEYS[4],
  'attempt', attempt,
  'fence', ARGV[2],
  'outcome', 'running',
  'last_attempt_at', ARGV[3],
  'last_success_at', last_success_at,
  'last_failure_at', last_failure_at,
  'reason_code', ''
)
return attempt
`

const COMPLETE_RUNNING_TURN_RECOVERY_SCRIPT = `
if tonumber(redis.call('GET', KEYS[1]) or '0') ~= tonumber(ARGV[2]) then
  return 0
end
if tonumber(redis.call('HGET', KEYS[2], 'attempt') or '0') ~= tonumber(ARGV[1]) then
  return 0
end
if tonumber(redis.call('HGET', KEYS[2], 'fence') or '0') ~= tonumber(ARGV[2]) then
  return 0
end

redis.call('HSET', KEYS[2], 'outcome', ARGV[3], 'reason_code', ARGV[5])
if ARGV[3] == 'succeeded' then
  redis.call('HSET', KEYS[2], 'last_success_at', ARGV[4])
else
  redis.call('HSET', KEYS[2], 'last_failure_at', ARGV[4])
end
return 1
`

const RUNNING_TURN_SLOTS_KEY = "linksense:running-turn-slots"
const RUNNER_OWNER_DEADLINES_KEY = "linksense:runner-owner-deadlines"
const RUNNING_TURN_OWNER_INDEX_KEY = "linksense:running-turn-owner-index"
const RECOVERY_DISPATCH_CURSORS_KEY = "linksense:recovery-dispatch-cursors"
const recoveryDispatchCursorSchema = z.strictObject({
  id: z.uuid(),
  createdAt: z.iso.datetime(),
})
export type RecoveryDispatchCursor = z.infer<typeof recoveryDispatchCursorSchema>
const RUNNING_TURN_SLOT_OWNERS_KEY = "linksense:running-turn-slot-owners"
const RUNNING_TURN_RELEASE_MARKERS_KEY =
  "linksense:running-turn-release-markers"
const RUNNING_TURN_RECONCILE_LOCK_KEY =
  "linksense:running-turn-reconcile-lock"
const RUNNING_TURN_RECONCILE_FENCE_KEY =
  "linksense:running-turn-reconcile-fence"
const RUNNING_TURN_RECOVERY_ATTEMPT_KEY =
  "linksense:running-turn-recovery-attempt"
const RUNNING_TURN_RECOVERY_STATUS_KEY =
  "linksense:running-turn-recovery-status"
const SITE_ICON_CACHE_KEY_PREFIX = "linksense:v2:site-icon:"
const SYSTEM_UPDATE_CACHE_KEY = "linksense:v1:system-update"
const SITE_ICON_RATE_LIMIT_KEY_PREFIX = "linksense:v2:site-icon-rate:"
const SITE_ICON_RATE_LIMIT_MAX_REQUESTS = 60
const SITE_ICON_RATE_LIMIT_WINDOW_SECONDS = 60
const VOICE_TRANSCRIPTION_RATE_LIMIT_KEY_PREFIX =
  "linksense:v1:voice-transcription-rate:"
const APPLICATION_EMBED_VOICE_TRANSCRIPTION_RATE_LIMIT_KEY_PREFIX =
  "linksense:v1:application-embed-voice-transcription-rate:"
const VOICE_TRANSCRIPTION_RATE_LIMIT_MAX_REQUESTS = 20
const VOICE_TRANSCRIPTION_RATE_LIMIT_WINDOW_SECONDS = 60
const CLAWHUB_PREVIEW_RATE_LIMIT_KEY_PREFIX =
  "linksense:v1:clawhub-preview-rate:"
const CLAWHUB_PREVIEW_LOCK_KEY_PREFIX =
  "linksense:v1:clawhub-preview-lock:"
const CLAWHUB_PREVIEW_ACTIVE_KEY_PREFIX =
  "linksense:v1:clawhub-preview-active:"
const CLAWHUB_PREVIEW_GLOBAL_IN_FLIGHT_KEY =
  "linksense:v1:clawhub-preview-global-in-flight"
const CLAWHUB_PREVIEW_MAX_REQUESTS = 6
const CLAWHUB_PREVIEW_RATE_WINDOW_MS = 60 * 60 * 1_000
const CLAWHUB_PREVIEW_MAX_ACTIVE = 2
const CLAWHUB_PREVIEW_MAX_GLOBAL_IN_FLIGHT = 2
const CLAWHUB_PREVIEW_ACTIVE_TTL_MS = 15 * 60 * 1_000
const CLAWHUB_PREVIEW_LOCK_TTL_MS = 15 * 60 * 1_000

const TAKE_SITE_ICON_REQUEST_SCRIPT = `
local count = redis.call('INCR', KEYS[1])
if count == 1 then redis.call('EXPIRE', KEYS[1], tonumber(ARGV[2])) end
if count <= tonumber(ARGV[1]) then return 1 end
return 0
`

const TAKE_VOICE_TRANSCRIPTION_REQUEST_SCRIPT = `
local count = redis.call('INCR', KEYS[1])
if count == 1 then redis.call('EXPIRE', KEYS[1], tonumber(ARGV[2])) end
local ttl = redis.call('TTL', KEYS[1])
if ttl < 1 then ttl = tonumber(ARGV[2]) end
if count <= tonumber(ARGV[1]) then return {1, ttl} end
return {0, ttl}
`

const BEGIN_CLAWHUB_PREVIEW_SCRIPT = `
local current_time = redis.call('TIME')
local now_ms = tonumber(current_time[1]) * 1000
  + math.floor(tonumber(current_time[2]) / 1000)
redis.call('ZREMRANGEBYSCORE', KEYS[3], '-inf', now_ms)
redis.call('ZREMRANGEBYSCORE', KEYS[4], '-inf', now_ms)

if redis.call('EXISTS', KEYS[2]) == 1 then return 2 end
if redis.call('ZCARD', KEYS[3]) >= tonumber(ARGV[4]) then return 4 end
if redis.call('ZCARD', KEYS[4]) >= tonumber(ARGV[7]) then return 2 end

local request_count = tonumber(redis.call('GET', KEYS[1]) or '0')
if request_count >= tonumber(ARGV[2]) then return 3 end
if not redis.call('SET', KEYS[2], ARGV[1], 'NX', 'PX', ARGV[6]) then
  return 2
end

request_count = redis.call('INCR', KEYS[1])
if request_count == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[3]) end
redis.call('ZADD', KEYS[3], now_ms + tonumber(ARGV[5]), ARGV[1])
redis.call('PEXPIRE', KEYS[3], tonumber(ARGV[5]) + 60000)
redis.call('ZADD', KEYS[4], now_ms + tonumber(ARGV[6]), ARGV[1])
redis.call('PEXPIRE', KEYS[4], tonumber(ARGV[6]) + 60000)
return 1
`

const FINISH_CLAWHUB_PREVIEW_SCRIPT = `
if redis.call('GET', KEYS[1]) == ARGV[1] then
  redis.call('DEL', KEYS[1])
end
redis.call('ZREM', KEYS[3], ARGV[1])
if ARGV[2] ~= '1' then
  redis.call('ZREM', KEYS[2], ARGV[1])
  if redis.call('ZCARD', KEYS[2]) == 0 then redis.call('DEL', KEYS[2]) end
end
return 1
`

export type RunningTurnSlot = {
  conversationId: string
  turnId: string
  ownerId: string
}

export type ObservedRunningTurnSlot = Omit<RunningTurnSlot, "ownerId"> & {
  ownerId: string | null
}

export type RunningTurnReconcileLease = {
  token: string
  fence: number
}

export type RunningTurnRecoveryStatus = {
  outcome: "not_started" | "running" | "succeeded" | "failed"
  last_attempt_at: string | null
  last_success_at: string | null
  last_failure_at: string | null
  reason_code: string | null
}

export function isRunningTurnCapacityReady(
  status: RunningTurnRecoveryStatus,
): boolean {
  return status.outcome === "succeeded" ||
    (status.outcome === "running" && Boolean(status.last_success_at))
}

export type RunningTurnRecoveryAttempt = {
  attempt: number
  fence: number
}

export type RunningTurnRecoveryCompletion =
  | {
      outcome: "succeeded"
      completedAt: string
    }
  | {
      outcome: "failed"
      completedAt: string
      reasonCode: string
    }

export class RedisUnavailableError extends Error {
  constructor(readonly stage: string) {
    super("Redis operation unavailable")
    this.name = "RedisUnavailableError"
  }
}

export type LoginRateLimitKeys = {
  ipWindow: string
  ipCooldown: string
  emailWindow: string
  emailCooldown: string
}

export type ClawHubInstallPreviewAdmission =
  | { status: "acquired"; token: string }
  | { status: "busy" | "rate_limited" | "quota_exceeded" }

export class LinkSenseRedis {
  readonly client: Redis

  constructor(
    private readonly config: AppConfig,
    client?: Redis,
  ) {
    this.client =
      client ??
      new Redis(config.redisUrl, {
        maxRetriesPerRequest: 1,
        enableOfflineQueue: false,
        connectTimeout: 2_000,
        commandTimeout: 2_000,
        lazyConnect: true,
      })
  }

  get maxConcurrentTurns(): number {
    return this.config.maxConcurrentConversations
  }

  async connect(): Promise<void> {
    if (this.client.status === "wait") await this.client.connect()
  }

  normalizeEmail(email: string): string {
    return email.trim().toLocaleLowerCase("en-US")
  }

  normalizeIp(ip: string): string {
    if (!isIP(ip)) return "invalid"
    const parsed = ipaddr.parse(ip)
    if (parsed instanceof ipaddr.IPv6 && parsed.isIPv4MappedAddress()) {
      return parsed.toIPv4Address().toString()
    }
    return parsed.toNormalizedString()
  }

  loginKeys(email: string, ip: string): LoginRateLimitKeys {
    const normalizedEmail = this.normalizeEmail(email)
    const normalizedIp = this.normalizeIp(ip)
    const emailDigest = hmacSha256(
      this.config.loginRateLimitHmacSecret,
      "login:email:",
      normalizedEmail,
    )
    const ipDigest = hmacSha256(
      this.config.loginRateLimitHmacSecret,
      "login:ip:",
      normalizedIp,
    )
    return {
      ipWindow: `linksense:login:ip:${ipDigest}:window`,
      ipCooldown: `linksense:login:ip:${ipDigest}:cooldown`,
      emailWindow: `linksense:login:email:${emailDigest}:window`,
      emailCooldown: `linksense:login:email:${emailDigest}:cooldown`,
    }
  }

  async precheckLogin(keys: LoginRateLimitKeys): Promise<number> {
    try {
      const result = await this.client.eval(
        LOGIN_PRECHECK_SCRIPT,
        2,
        keys.ipCooldown,
        keys.emailCooldown,
      )
      const values = parseNumberArray(result, 2)
      return Math.max(...values)
    } catch {
      throw new RedisUnavailableError("precheck")
    }
  }

  async recordLoginFailure(keys: LoginRateLimitKeys): Promise<number> {
    const policy = this.config.localLogin
    try {
      const result = await this.client.eval(
        LOGIN_RECORD_FAILURE_SCRIPT,
        4,
        keys.ipWindow,
        keys.ipCooldown,
        keys.emailWindow,
        keys.emailCooldown,
        policy.ipFailureLimit,
        policy.ipWindowSeconds,
        policy.ipCooldownSeconds,
        policy.emailFailureLimit,
        policy.emailWindowSeconds,
        policy.emailCooldownSeconds,
      )
      const values = parseNumberArray(result, 4)
      return Math.max(values[0] ?? 0, values[1] ?? 0)
    } catch {
      throw new RedisUnavailableError("record_failure")
    }
  }

  async clearEmailLoginState(keys: LoginRateLimitKeys): Promise<void> {
    try {
      await this.client.del(keys.emailWindow, keys.emailCooldown)
    } catch {
      throw new RedisUnavailableError("clear_email_state")
    }
  }

  async takePasswordResetRequest(email: string, ip: string): Promise<boolean> {
    return this.takeAuthenticationEmailRequest("password-reset", email, ip)
  }

  async takeRegistrationRequest(email: string, ip: string): Promise<boolean> {
    return this.takeAuthenticationEmailRequest("registration", email, ip)
  }

  private async takeAuthenticationEmailRequest(
    purpose: "password-reset" | "registration",
    email: string,
    ip: string,
  ): Promise<boolean> {
    const emailDigest = hmacSha256(
      this.config.passwordResetRateLimitHmacSecret,
      `${purpose}:email:`,
      this.normalizeEmail(email),
    )
    const ipDigest = hmacSha256(
      this.config.passwordResetRateLimitHmacSecret,
      `${purpose}:ip:`,
      this.normalizeIp(ip),
    )
    try {
      const result = await this.client.eval(
        RESET_RATE_LIMIT_SCRIPT,
        2,
        `linksense:${purpose}:email:${emailDigest}`,
        `linksense:${purpose}:ip:${ipDigest}`,
        this.config.passwordReset.emailLimit,
        this.config.passwordReset.emailWindowSeconds,
        this.config.passwordReset.ipLimit,
        this.config.passwordReset.ipWindowSeconds,
      )
      if (result !== 0 && result !== 1) throw new Error("invalid response")
      return result === 1
    } catch {
      throw new RedisUnavailableError(`${purpose.replace("-", "_")}_precheck`)
    }
  }

  async acquireTurnSlot(
    conversationId: string,
    turnId: string,
    ownerId: string,
    maxConcurrentTurns = this.config.maxConcurrentConversations,
  ): Promise<{ acquired: boolean; count: number; capacityReady: boolean }> {
    try {
      const result = await this.client.eval(
        ACQUIRE_CONCURRENCY_SCRIPT,
        6,
        RUNNING_TURN_SLOTS_KEY,
        RUNNING_TURN_SLOT_OWNERS_KEY,
        RUNNING_TURN_RELEASE_MARKERS_KEY,
        RUNNING_TURN_RECOVERY_STATUS_KEY,
        RUNNER_OWNER_DEADLINES_KEY,
        RUNNING_TURN_OWNER_INDEX_KEY,
        conversationId,
        turnId,
        ownerId,
        maxConcurrentTurns,
      )
      const [acquired, count, capacityReady] = parseNumberArray(result, 3)
      return {
        acquired: acquired === 1,
        count: count ?? 0,
        capacityReady: capacityReady === 1,
      }
    } catch {
      throw new RedisUnavailableError("concurrency_acquire")
    }
  }

  async releaseTurnSlot(conversationId: string, turnId: string): Promise<void> {
    try {
      await this.client.eval(
        RELEASE_CONCURRENCY_SCRIPT,
        5,
        RUNNING_TURN_SLOTS_KEY,
        RUNNING_TURN_SLOT_OWNERS_KEY,
        RUNNING_TURN_RELEASE_MARKERS_KEY,
        RUNNING_TURN_OWNER_INDEX_KEY,
        RUNNING_TURN_RECONCILE_LOCK_KEY,
        conversationId,
        turnId,
      )
    } catch {
      throw new RedisUnavailableError("concurrency_release")
    }
  }

  async acquireUserLifecycleLock(
    userId: string,
    ttlMilliseconds = 120_000,
  ): Promise<string | null> {
    const token = randomUUID()
    try {
      const result = await this.client.set(
        `linksense:user-lifecycle-lock:${userId}`,
        token,
        "PX",
        ttlMilliseconds,
        "NX",
      )
      return result === "OK" ? token : null
    } catch {
      throw new RedisUnavailableError("user_lifecycle_lock")
    }
  }

  async releaseUserLifecycleLock(userId: string, token: string): Promise<void> {
    const script = `
      if redis.call('GET', KEYS[1]) == ARGV[1] then
        return redis.call('DEL', KEYS[1])
      end
      return 0
    `
    try {
      await this.client.eval(
        script,
        1,
        `linksense:user-lifecycle-lock:${userId}`,
        token,
      )
    } catch {
      throw new RedisUnavailableError("user_lifecycle_unlock")
    }
  }

  async acquireConversationLock(
    conversationId: string,
    ttlMilliseconds = 15_000,
  ): Promise<string | null> {
    const token = randomUUID()
    try {
      const result = await this.client.set(
        `linksense:conversation-lock:${conversationId}`,
        token,
        "PX",
        ttlMilliseconds,
        "NX",
      )
      return result === "OK" ? token : null
    } catch {
      throw new RedisUnavailableError("conversation_lock")
    }
  }

  async reserveConversationPrewarm(
    input: ConversationPrewarmReservation,
    create: boolean,
  ): Promise<boolean> {
    const reservation = conversationPrewarmReservationSchema.parse(input)
    const key = `linksense:conversation-prewarm:${reservation.conversationId}`
    const value = `${reservation.ownerId}:${reservation.reservationRevision}`
    try {
      if (create) {
        const result = await this.client.set(
          key,
          value,
          "PX",
          conversationPrewarmReservationTtlMs,
          "NX",
        )
        return result === "OK"
      }
      const script = `
        local value = redis.call('GET', KEYS[1])
        local ownerPrefix = ARGV[1] .. ':'
        if not value or string.sub(value, 1, string.len(ownerPrefix)) ~= ownerPrefix then return 0 end
        redis.call('SET', KEYS[1], ARGV[2], 'PX', ARGV[3])
        return 1
      `
      const result = await this.client.eval(
        script,
        1,
        key,
        reservation.ownerId,
        value,
        conversationPrewarmReservationTtlMs,
      )
      return Number(result) === 1
    } catch {
      throw new RedisUnavailableError("conversation_prewarm_reserve")
    }
  }

  async isConversationPrewarmCurrent(
    input: ConversationPrewarmReservation,
  ): Promise<boolean> {
    const reservation = conversationPrewarmReservationSchema.parse(input)
    try {
      const value = await this.client.get(
        `linksense:conversation-prewarm:${reservation.conversationId}`,
      )
      return value === `${reservation.ownerId}:${reservation.reservationRevision}`
    } catch {
      throw new RedisUnavailableError("conversation_prewarm_read")
    }
  }

  async claimConversationPrewarm(
    ownerId: string,
    conversationId: string,
  ): Promise<boolean> {
    conversationPrewarmReservationSchema
      .pick({ ownerId: true, conversationId: true })
      .parse({ ownerId, conversationId })
    try {
      const script = `
        local value = redis.call('GET', KEYS[1])
        local ownerPrefix = ARGV[1] .. ':'
        if not value or string.sub(value, 1, string.len(ownerPrefix)) ~= ownerPrefix then return 0 end
        return redis.call('DEL', KEYS[1])
      `
      const result = await this.client.eval(
        script,
        1,
        `linksense:conversation-prewarm:${conversationId}`,
        ownerId,
      )
      return Number(result) === 1
    } catch {
      throw new RedisUnavailableError("conversation_prewarm_claim")
    }
  }

  async releaseConversationLock(
    conversationId: string,
    token: string,
  ): Promise<void> {
    const script = `
      if redis.call('GET', KEYS[1]) == ARGV[1] then
        return redis.call('DEL', KEYS[1])
      end
      return 0
    `
    try {
      await this.client.eval(
        script,
        1,
        `linksense:conversation-lock:${conversationId}`,
        token,
      )
    } catch {
      throw new RedisUnavailableError("conversation_unlock")
    }
  }

  async acquireRecoveryLock(
    conversationId: string,
    ttlMilliseconds = 30_000,
  ): Promise<string | null> {
    const token = randomUUID()
    try {
      const result = await this.client.set(
        `linksense:recovery-lock:${conversationId}`,
        token,
        "PX",
        ttlMilliseconds,
        "NX",
      )
      return result === "OK" ? token : null
    } catch {
      throw new RedisUnavailableError("recovery_lock")
    }
  }

  async releaseRecoveryLock(
    conversationId: string,
    token: string,
  ): Promise<void> {
    const script = `
      if redis.call('GET', KEYS[1]) == ARGV[1] then
        return redis.call('DEL', KEYS[1])
      end
      return 0
    `
    try {
      await this.client.eval(
        script,
        1,
        `linksense:recovery-lock:${conversationId}`,
        token,
      )
    } catch {
      throw new RedisUnavailableError("recovery_unlock")
    }
  }

  async renewRecoveryLock(
    conversationId: string,
    token: string,
    ttlMilliseconds = 30_000,
  ): Promise<boolean> {
    const script = `
      if redis.call('GET', KEYS[1]) == ARGV[1] then
        redis.call('PEXPIRE', KEYS[1], ARGV[2])
        return 1
      end
      return 0
    `
    try {
      return Number(
        await this.client.eval(
          script,
          1,
          `linksense:recovery-lock:${conversationId}`,
          token,
          ttlMilliseconds,
        ),
      ) === 1
    } catch {
      throw new RedisUnavailableError("recovery_lock_renew")
    }
  }

  async runningTurnCount(): Promise<number> {
    try {
      return await this.client.hlen(RUNNING_TURN_SLOTS_KEY)
    } catch {
      throw new RedisUnavailableError("concurrency_count")
    }
  }

  async runningTurnSlotsForOwner(
    ownerId: string,
    after?: string,
  ): Promise<{
    slots: Array<{ conversationId: string; turnId: string }>
    after: string | null
  }> {
    try {
      z.uuid().parse(ownerId)
      if (after) z.uuid().parse(after)
      const values = z.array(z.string()).parse(
        await this.client.eval(
          `
        local prefix = ARGV[1] .. ':'
        local minimum = '[' .. prefix
        if ARGV[2] ~= '' then minimum = '(' .. prefix .. ARGV[2] end
        local members = redis.call('ZRANGEBYLEX', KEYS[1], minimum, '[' .. prefix .. '~', 'LIMIT', 0, 100)
        local result = {''}
        if #members == 100 then result[1] = string.sub(members[#members], #prefix + 1) end
        for _, member in ipairs(members) do
          local conversation = string.sub(member, #prefix + 1)
          local turn = redis.call('HGET', KEYS[2], conversation)
          if turn and redis.call('HGET', KEYS[3], conversation) == ARGV[1] then
            table.insert(result, conversation)
            table.insert(result, turn)
          else
            redis.call('ZREM', KEYS[1], member)
          end
        end
        return result
      `,
          3,
          RUNNING_TURN_OWNER_INDEX_KEY,
          RUNNING_TURN_SLOTS_KEY,
          RUNNING_TURN_SLOT_OWNERS_KEY,
          ownerId,
          after ?? "",
        ),
      )
      const slots: Array<{ conversationId: string; turnId: string }> = []
      for (let index = 1; index < values.length; index += 2) {
        slots.push({
          conversationId: z.uuid().parse(values[index]),
          turnId: z.uuid().parse(values[index + 1]),
        })
      }
      return { slots, after: values[0] ? z.uuid().parse(values[0]) : null }
    } catch {
      throw new RedisUnavailableError("concurrency_owner_read")
    }
  }

  async hasTurnSlot(
    conversationId: string,
    turnId: string,
    ownerId: string,
  ): Promise<boolean> {
    try {
      const result = await this.client.eval(
        `
        if redis.call('HGET', KEYS[1], ARGV[1]) == ARGV[2]
          and redis.call('HGET', KEYS[2], ARGV[1]) == ARGV[3] then return 1 end
        return 0
      `,
        2,
        RUNNING_TURN_SLOTS_KEY,
        RUNNING_TURN_SLOT_OWNERS_KEY,
        conversationId,
        turnId,
        ownerId,
      )
      return result === 1
    } catch {
      throw new RedisUnavailableError("concurrency_read")
    }
  }

  async recordRunnerHeartbeat(ownerId: string, serviceSessionId?: string): Promise<void> {
    try {
      await this.client.eval(
        `
        local time = redis.call('TIME')
        redis.call('ZADD', KEYS[1], time[1] * 1000 + math.floor(time[2] / 1000) + ARGV[2], ARGV[1])
      `,
        1,
        RUNNER_OWNER_DEADLINES_KEY,
        runnerEnvironmentKey(ownerId, serviceSessionId),
        runnerHeartbeatLeaseMs,
      )
    } catch {
      throw new RedisUnavailableError("runner_heartbeat")
    }
  }

  async expiredRunnerOwners(): Promise<
    Array<{ ownerId: string; serviceSessionId?: string; deadline: number }>
  > {
    try {
      const rows = z.array(z.string()).parse(
        await this.client.eval(
          `
        local time = redis.call('TIME')
        return redis.call('ZRANGEBYSCORE', KEYS[1], '-inf', time[1] * 1000 + math.floor(time[2] / 1000), 'WITHSCORES', 'LIMIT', 0, 100)
      `,
          1,
          RUNNER_OWNER_DEADLINES_KEY,
        ),
      )
      const result: Array<{ ownerId: string; serviceSessionId?: string; deadline: number }> = []
      for (let i = 0; i < rows.length; i += 2) {
        result.push({
          ...parseRunnerEnvironmentKey(rows[i]),
          deadline: z.coerce
            .number()
            .int()
            .nonnegative()
            .parse(rows[i + 1]),
        })
      }
      return result
    } catch {
      throw new RedisUnavailableError("runner_heartbeat_expired")
    }
  }

  async runnerOwnerDeadline(ownerId: string, serviceSessionId?: string): Promise<number | null> {
    try {
      const value = await this.client.zscore(
        RUNNER_OWNER_DEADLINES_KEY,
        runnerEnvironmentKey(ownerId, serviceSessionId),
      )
      return value === null
        ? null
        : z.coerce.number().int().nonnegative().parse(value)
    } catch {
      throw new RedisUnavailableError("runner_heartbeat_read")
    }
  }

  async acknowledgeExpiredRunnerOwner(
    ownerId: string,
    deadline: number,
    serviceSessionId?: string,
  ): Promise<void> {
    try {
      // Enqueue first, then remove only the observed lease. A concurrent beat
      // must survive acknowledgement of an older worker failure.
      await this.client.eval(
        `
        if tonumber(redis.call('ZSCORE', KEYS[1], ARGV[1])) == tonumber(ARGV[2]) then
          redis.call('ZREM', KEYS[1], ARGV[1])
        end
      `,
        1,
        RUNNER_OWNER_DEADLINES_KEY,
        runnerEnvironmentKey(ownerId, serviceSessionId),
        deadline,
      )
    } catch {
      throw new RedisUnavailableError("runner_heartbeat_acknowledge")
    }
  }

  async recoveryDispatchCursor(
    kind: "start" | "context",
  ): Promise<RecoveryDispatchCursor | null> {
    const value = await this.client.hget(RECOVERY_DISPATCH_CURSORS_KEY, kind)
    return value ? recoveryDispatchCursorSchema.parse(JSON.parse(value)) : null
  }

  async setRecoveryDispatchCursor(
    kind: "start" | "context",
    cursor: RecoveryDispatchCursor | null,
  ): Promise<void> {
    if (cursor) {
      await this.client.hset(
        RECOVERY_DISPATCH_CURSORS_KEY,
        kind,
        JSON.stringify(recoveryDispatchCursorSchema.parse(cursor)),
      )
    } else {
      await this.client.hdel(RECOVERY_DISPATCH_CURSORS_KEY, kind)
    }
  }

  async runningTurnSlots(): Promise<ObservedRunningTurnSlot[]> {
    try {
      const [turns, owners] = await Promise.all([
        this.client.hgetall(RUNNING_TURN_SLOTS_KEY),
        this.client.hgetall(RUNNING_TURN_SLOT_OWNERS_KEY),
      ])
      return Object.entries(turns).map(([conversationId, turnId]) => ({
        conversationId,
        turnId,
        ownerId: owners[conversationId] ?? null,
      }))
    } catch {
      throw new RedisUnavailableError("concurrency_list")
    }
  }

  async acquireRunningTurnReconcileLease(
    ttlMilliseconds = 30_000,
  ): Promise<RunningTurnReconcileLease | null> {
    const token = randomUUID()
    try {
      const fence = Number(
        await this.client.eval(
          ACQUIRE_RECONCILE_LEASE_SCRIPT,
          2,
          RUNNING_TURN_RECONCILE_LOCK_KEY,
          RUNNING_TURN_RECONCILE_FENCE_KEY,
          token,
          ttlMilliseconds,
        ),
      )
      if (!Number.isSafeInteger(fence) || fence < 0) {
        throw new Error("invalid reconcile lease response")
      }
      return fence === 0 ? null : { token, fence }
    } catch {
      throw new RedisUnavailableError("concurrency_reconcile_lock")
    }
  }

  async releaseRunningTurnReconcileLease(
    lease: RunningTurnReconcileLease,
  ): Promise<void> {
    const script = `
      if redis.call('GET', KEYS[1]) == ARGV[1] then
        return redis.call('DEL', KEYS[1])
      end
      return 0
    `
    try {
      await this.client.eval(
        script,
        1,
        RUNNING_TURN_RECONCILE_LOCK_KEY,
        lease.token,
      )
    } catch {
      throw new RedisUnavailableError("concurrency_reconcile_unlock")
    }
  }

  async reconcileRunningTurnSlots(
    slots: RunningTurnSlot[],
    lease: RunningTurnReconcileLease,
  ): Promise<{ applied: boolean; conflicted: boolean }> {
    try {
      const result = await this.client.eval(
        RECONCILE_CONCURRENCY_SCRIPT,
        7,
        RUNNING_TURN_SLOTS_KEY,
        RUNNING_TURN_SLOT_OWNERS_KEY,
        RUNNING_TURN_RELEASE_MARKERS_KEY,
        RUNNING_TURN_RECONCILE_LOCK_KEY,
        RUNNING_TURN_RECONCILE_FENCE_KEY,
        RUNNER_OWNER_DEADLINES_KEY,
        RUNNING_TURN_OWNER_INDEX_KEY,
        lease.token,
        lease.fence,
        ...slots.flatMap(({ conversationId, turnId, ownerId }) => [
          conversationId,
          turnId,
          ownerId,
        ]),
      )
      const [applied, , conflicted] = parseNumberArray(result, 3)
      return { applied: applied === 1, conflicted: conflicted === 1 }
    } catch {
      throw new RedisUnavailableError("concurrency_reconcile")
    }
  }

  async beginRunningTurnRecoveryAttempt(
    lease: RunningTurnReconcileLease,
    attemptedAt: string,
  ): Promise<RunningTurnRecoveryAttempt | null> {
    try {
      assertRecoveryTimestamp(attemptedAt)
      const attempt = Number(
        await this.client.eval(
          BEGIN_RUNNING_TURN_RECOVERY_SCRIPT,
          4,
          RUNNING_TURN_RECONCILE_LOCK_KEY,
          RUNNING_TURN_RECONCILE_FENCE_KEY,
          RUNNING_TURN_RECOVERY_ATTEMPT_KEY,
          RUNNING_TURN_RECOVERY_STATUS_KEY,
          lease.token,
          lease.fence,
          attemptedAt,
        ),
      )
      if (!Number.isSafeInteger(attempt) || attempt < 0) {
        throw new Error("invalid recovery attempt response")
      }
      return attempt === 0 ? null : { attempt, fence: lease.fence }
    } catch {
      throw new RedisUnavailableError("concurrency_recovery_begin")
    }
  }

  async completeRunningTurnRecoveryAttempt(
    attempt: RunningTurnRecoveryAttempt,
    completion: RunningTurnRecoveryCompletion,
  ): Promise<boolean> {
    try {
      assertRecoveryTimestamp(completion.completedAt)
      if (
        completion.outcome === "failed" &&
        !/^[A-Z][A-Z0-9_]{0,119}$/u.test(completion.reasonCode)
      ) {
        throw new Error("invalid recovery reason")
      }
      const result = Number(
        await this.client.eval(
          COMPLETE_RUNNING_TURN_RECOVERY_SCRIPT,
          2,
          RUNNING_TURN_RECONCILE_FENCE_KEY,
          RUNNING_TURN_RECOVERY_STATUS_KEY,
          attempt.attempt,
          attempt.fence,
          completion.outcome,
          completion.completedAt,
          completion.outcome === "failed" ? completion.reasonCode : "",
        ),
      )
      if (result !== 0 && result !== 1) {
        throw new Error("invalid recovery completion response")
      }
      return result === 1
    } catch {
      throw new RedisUnavailableError("concurrency_recovery_complete")
    }
  }

  async runningTurnRecoveryStatus(): Promise<RunningTurnRecoveryStatus> {
    try {
      const value = await this.client.hgetall(RUNNING_TURN_RECOVERY_STATUS_KEY)
      if (Object.keys(value).length === 0) return notStartedRecoveryStatus()
      if (
        value.outcome !== "running" &&
        value.outcome !== "succeeded" &&
        value.outcome !== "failed"
      ) {
        throw new Error("invalid recovery status")
      }
      const reasonCode = value.reason_code || null
      if (reasonCode && !/^[A-Z][A-Z0-9_]{0,119}$/u.test(reasonCode)) {
        throw new Error("invalid recovery reason")
      }
      return {
        outcome: value.outcome,
        last_attempt_at: parseRecoveryTimestamp(value.last_attempt_at, false),
        last_success_at: parseRecoveryTimestamp(value.last_success_at, true),
        last_failure_at: parseRecoveryTimestamp(value.last_failure_at, true),
        reason_code: reasonCode,
      }
    } catch (error) {
      if (error instanceof RedisUnavailableError) throw error
      throw new RedisUnavailableError("concurrency_recovery_status")
    }
  }

  async publishConversationEvent(conversationId: string, event: unknown): Promise<void> {
    try {
      await this.client.publish(
        `linksense:conversation-events:${conversationId}`,
        JSON.stringify(event),
      )
    } catch {
      throw new RedisUnavailableError("event_publish")
    }
  }

  async publishConversationEvents(conversationId: string, events: readonly unknown[]): Promise<void> {
    if (events.length === 0) return
    try {
      const pipeline = this.client.pipeline()
      for (const event of events) {
        pipeline.publish(`linksense:conversation-events:${conversationId}`, JSON.stringify(event))
      }
      const results = await pipeline.exec()
      if (!results || results.length !== events.length || results.some(([error]) => error !== null)) {
        throw new RedisUnavailableError("event_publish")
      }
    } catch {
      throw new RedisUnavailableError("event_publish")
    }
  }

  async getSiteIconCache(cacheKey: string): Promise<Buffer | null> {
    try {
      return await this.client.getBuffer(SITE_ICON_CACHE_KEY_PREFIX + cacheKey)
    } catch {
      throw new RedisUnavailableError("site_icon_cache_get")
    }
  }

  async getSystemUpdateCache(): Promise<string | null> {
    try {
      return await this.client.get(SYSTEM_UPDATE_CACHE_KEY)
    } catch {
      throw new RedisUnavailableError("system_update_cache_get")
    }
  }

  async setSystemUpdateCache(
    value: string,
    ttlSeconds: number,
  ): Promise<void> {
    try {
      await this.client.set(SYSTEM_UPDATE_CACHE_KEY, value, "EX", ttlSeconds)
    } catch {
      throw new RedisUnavailableError("system_update_cache_set")
    }
  }

  async setSiteIconCache(
    cacheKey: string,
    value: Buffer,
    ttlSeconds: number,
  ): Promise<void> {
    try {
      await this.client.set(
        SITE_ICON_CACHE_KEY_PREFIX + cacheKey,
        value,
        "EX",
        ttlSeconds,
      )
    } catch {
      throw new RedisUnavailableError("site_icon_cache_set")
    }
  }

  async takeSiteIconRequest(userId: string): Promise<boolean> {
    const userDigest = hmacSha256(
      this.config.loginRateLimitHmacSecret,
      "site-icon:user:",
      userId,
    )
    try {
      const result = await this.client.eval(
        TAKE_SITE_ICON_REQUEST_SCRIPT,
        1,
        SITE_ICON_RATE_LIMIT_KEY_PREFIX + userDigest,
        SITE_ICON_RATE_LIMIT_MAX_REQUESTS,
        SITE_ICON_RATE_LIMIT_WINDOW_SECONDS,
      )
      return Number(result) === 1
    } catch {
      throw new RedisUnavailableError("site_icon_rate_limit")
    }
  }

  async takeVoiceTranscriptionRequest(
    userId: string,
  ): Promise<{ allowed: boolean; retryAfterSeconds: number }> {
    const userDigest = hmacSha256(
      this.config.loginRateLimitHmacSecret,
      "voice-transcription:user:",
      userId,
    )
    try {
      const result = await this.client.eval(
        TAKE_VOICE_TRANSCRIPTION_REQUEST_SCRIPT,
        1,
        VOICE_TRANSCRIPTION_RATE_LIMIT_KEY_PREFIX + userDigest,
        VOICE_TRANSCRIPTION_RATE_LIMIT_MAX_REQUESTS,
        VOICE_TRANSCRIPTION_RATE_LIMIT_WINDOW_SECONDS,
      )
      return parseVoiceTranscriptionRateLimitAdmission(result)
    } catch {
      throw new RedisUnavailableError("voice_transcription_rate_limit")
    }
  }

  async takeApplicationEmbedVoiceTranscriptionRequest(
    sessionId: string,
  ): Promise<{ allowed: boolean; retryAfterSeconds: number }> {
    const sessionDigest = hmacSha256(
      this.config.loginRateLimitHmacSecret,
      "application-embed-voice-transcription:session:",
      sessionId,
    )
    try {
      const result = await this.client.eval(
        TAKE_VOICE_TRANSCRIPTION_REQUEST_SCRIPT,
        1,
        APPLICATION_EMBED_VOICE_TRANSCRIPTION_RATE_LIMIT_KEY_PREFIX +
          sessionDigest,
        VOICE_TRANSCRIPTION_RATE_LIMIT_MAX_REQUESTS,
        VOICE_TRANSCRIPTION_RATE_LIMIT_WINDOW_SECONDS,
      )
      return parseVoiceTranscriptionRateLimitAdmission(result)
    } catch {
      throw new RedisUnavailableError(
        "application_embed_voice_transcription_rate_limit",
      )
    }
  }

  async beginClawHubInstallPreview(
    userId: string,
  ): Promise<ClawHubInstallPreviewAdmission> {
    const token = randomUUID()
    const userDigest = hmacSha256(
      this.config.loginRateLimitHmacSecret,
      "clawhub-preview:user:",
      userId,
    )
    try {
      const result = Number(
        await this.client.eval(
          BEGIN_CLAWHUB_PREVIEW_SCRIPT,
          4,
          CLAWHUB_PREVIEW_RATE_LIMIT_KEY_PREFIX + userDigest,
          CLAWHUB_PREVIEW_LOCK_KEY_PREFIX + userDigest,
          CLAWHUB_PREVIEW_ACTIVE_KEY_PREFIX + userDigest,
          CLAWHUB_PREVIEW_GLOBAL_IN_FLIGHT_KEY,
          token,
          CLAWHUB_PREVIEW_MAX_REQUESTS,
          CLAWHUB_PREVIEW_RATE_WINDOW_MS,
          CLAWHUB_PREVIEW_MAX_ACTIVE,
          CLAWHUB_PREVIEW_ACTIVE_TTL_MS,
          CLAWHUB_PREVIEW_LOCK_TTL_MS,
          CLAWHUB_PREVIEW_MAX_GLOBAL_IN_FLIGHT,
        ),
      )
      if (result === 1) return { status: "acquired", token }
      if (result === 2) return { status: "busy" }
      if (result === 3) return { status: "rate_limited" }
      if (result === 4) return { status: "quota_exceeded" }
      throw new Error("invalid ClawHub preview admission response")
    } catch {
      throw new RedisUnavailableError("clawhub_preview_admission")
    }
  }

  async finishClawHubInstallPreview(
    userId: string,
    token: string,
    keepActiveReservation: boolean,
  ): Promise<void> {
    const userDigest = hmacSha256(
      this.config.loginRateLimitHmacSecret,
      "clawhub-preview:user:",
      userId,
    )
    try {
      await this.client.eval(
        FINISH_CLAWHUB_PREVIEW_SCRIPT,
        3,
        CLAWHUB_PREVIEW_LOCK_KEY_PREFIX + userDigest,
        CLAWHUB_PREVIEW_ACTIVE_KEY_PREFIX + userDigest,
        CLAWHUB_PREVIEW_GLOBAL_IN_FLIGHT_KEY,
        token,
        keepActiveReservation ? "1" : "0",
      )
    } catch {
      throw new RedisUnavailableError("clawhub_preview_release")
    }
  }

  duplicate(): Redis {
    return this.client.duplicate({ enableOfflineQueue: false })
  }

  async ping(): Promise<void> {
    try {
      await this.client.ping()
    } catch {
      throw new RedisUnavailableError("health")
    }
  }

  async close(): Promise<void> {
    await this.client.quit().catch(() => this.client.disconnect())
  }
}

function parseNumberArray(value: unknown, expectedLength: number): number[] {
  if (!Array.isArray(value) || value.length !== expectedLength) {
    throw new Error("invalid Redis script response")
  }
  const numbers = value.map((item) => Number(item))
  if (numbers.some((item) => !Number.isFinite(item))) {
    throw new Error("invalid Redis script response")
  }
  return numbers
}

function notStartedRecoveryStatus(): RunningTurnRecoveryStatus {
  return {
    outcome: "not_started",
    last_attempt_at: null,
    last_success_at: null,
    last_failure_at: null,
    reason_code: null,
  }
}

function parseRecoveryTimestamp(
  value: string | undefined,
  nullable: boolean,
): string | null {
  if (!value) {
    if (nullable) return null
    throw new Error("missing recovery timestamp")
  }
  if (!Number.isFinite(Date.parse(value))) {
    throw new Error("invalid recovery timestamp")
  }
  return value
}

function assertRecoveryTimestamp(value: string): void {
  if (!Number.isFinite(Date.parse(value))) {
    throw new Error("invalid recovery timestamp")
  }
}

function parseVoiceTranscriptionRateLimitAdmission(
  result: unknown,
): { allowed: boolean; retryAfterSeconds: number } {
  const [allowed, retryAfterSeconds] = parseNumberArray(result, 2)
  if (allowed !== 0 && allowed !== 1) {
    throw new Error("invalid voice transcription rate limit response")
  }
  return {
    allowed: allowed === 1,
    retryAfterSeconds: Math.max(1, retryAfterSeconds ?? 0),
  }
}

export const redisScriptsForTesting = {
  LOGIN_PRECHECK_SCRIPT,
  LOGIN_RECORD_FAILURE_SCRIPT,
  RESET_RATE_LIMIT_SCRIPT,
  TAKE_VOICE_TRANSCRIPTION_REQUEST_SCRIPT,
  ACQUIRE_CONCURRENCY_SCRIPT,
  BEGIN_RUNNING_TURN_RECOVERY_SCRIPT,
  COMPLETE_RUNNING_TURN_RECOVERY_SCRIPT,
}

function runnerEnvironmentKey(ownerId: string, serviceSessionId?: string): string {
  const owner = z.uuid().parse(ownerId);
  return serviceSessionId ? `${owner}:${z.uuid().parse(serviceSessionId)}` : owner;
}

function parseRunnerEnvironmentKey(value: unknown): { ownerId: string; serviceSessionId?: string } {
  const parts = z.string().parse(value).split(":");
  if (parts.length > 2) throw new Error("Invalid runtime identity");
  return { ownerId: z.uuid().parse(parts[0]), ...(parts[1] ? { serviceSessionId: z.uuid().parse(parts[1]) } : {}) };
}
