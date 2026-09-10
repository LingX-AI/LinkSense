import { spawn, type ChildProcess } from "node:child_process"
import { access, mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { Redis } from "ioredis"
import { Queue, Worker } from "bullmq"
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import { TaskRecoveryScheduler, type TaskRecoveryQueueControl } from "../src/modules/events/recovery-scheduler.js"

import {
  LinkSenseRedis,
  type RunningTurnSlot,
} from "../src/adapters/redis.js"
import { testConfig } from "./test-config.js"

const RUNNING_TURN_RECOVERY_STATUS_KEY =
  "linksense:running-turn-recovery-status"

describe("Redis atomic protection", () => {
  let processHandle: ChildProcess
  let directory: string
  let client: Redis
  let protection: LinkSenseRedis

  beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), "linksense-redis-test-"))
    const socket = join(directory, "redis.sock")
    processHandle = spawn(
      process.env.REDIS_SERVER_BIN ?? "redis-server",
      [
        "--port",
        "0",
        "--unixsocket",
        socket,
        "--unixsocketperm",
        "700",
        "--save",
        "",
        "--appendonly",
        "no",
      ],
      { stdio: "ignore" },
    )
    await waitForSocket(socket)
    client = new Redis({ path: socket, maxRetriesPerRequest: 1 })
    protection = new LinkSenseRedis(
      testConfig({
        LINKSENSE_LOCAL_LOGIN_EMAIL_FAILURE_LIMIT: "3",
        LINKSENSE_LOCAL_LOGIN_EMAIL_WINDOW_SECONDS: "30",
        LINKSENSE_LOCAL_LOGIN_EMAIL_COOLDOWN_SECONDS: "5",
        LINKSENSE_LOCAL_LOGIN_IP_FAILURE_LIMIT: "50",
        LINKSENSE_LOCAL_LOGIN_IP_WINDOW_SECONDS: "30",
        LINKSENSE_LOCAL_LOGIN_IP_COOLDOWN_SECONDS: "5",
        LINKSENSE_PASSWORD_RESET_EMAIL_LIMIT: "3",
        LINKSENSE_PASSWORD_RESET_IP_LIMIT: "20",
      }),
      client,
    )
  })

  afterAll(async () => {
    await client?.quit().catch(() => undefined)
    processHandle?.kill("SIGTERM")
    await rm(directory, { recursive: true, force: true })
  })

  beforeEach(async () => {
    await client.flushdb()
    await setSuccessfulRecoveryBaseline(client)
  })

  it("keeps prewarm reservations owner-bound and replaces only a live owned revision", async () => {
    const reservation = {
      ownerId: "71000000-0000-4000-8000-000000000001",
      conversationId: "71000000-0000-4000-8000-000000000002",
      reservationRevision: "71000000-0000-4000-8000-000000000003",
    }
    const next = { ...reservation, reservationRevision: "71000000-0000-4000-8000-000000000004" }
    const otherOwner = { ...next, ownerId: "71000000-0000-4000-8000-000000000005" }
    expect(await protection.reserveConversationPrewarm(reservation, true)).toBe(true)
    expect(await protection.reserveConversationPrewarm(next, true)).toBe(false)
    expect(await protection.reserveConversationPrewarm(otherOwner, false)).toBe(false)
    expect(await protection.claimConversationPrewarm(otherOwner.ownerId, reservation.conversationId)).toBe(false)
    expect(await protection.isConversationPrewarmCurrent(reservation)).toBe(true)
    expect(await protection.reserveConversationPrewarm(next, false)).toBe(true)
    expect(await protection.isConversationPrewarmCurrent(reservation)).toBe(false)
    expect(await protection.isConversationPrewarmCurrent(next)).toBe(true)
    const ttl = await client.pttl(`linksense:conversation-prewarm:${reservation.conversationId}`)
    expect(ttl).toBeGreaterThan(0)
    expect(ttl).toBeLessThanOrEqual(15 * 60_000)
  })

  it("claims prewarm once across API instances and never renews an expired or claimed reservation", async () => {
    const reservation = {
      ownerId: "71000000-0000-4000-8000-000000000011",
      conversationId: "71000000-0000-4000-8000-000000000012",
      reservationRevision: "71000000-0000-4000-8000-000000000013",
    }
    const secondInstance = new LinkSenseRedis(testConfig(), client)
    expect(await protection.reserveConversationPrewarm(reservation, true)).toBe(true)
    const claims = await Promise.all([protection, secondInstance].map(instance =>
      instance.claimConversationPrewarm(reservation.ownerId, reservation.conversationId)))
    expect(claims.sort()).toEqual([false, true])
    expect(await protection.reserveConversationPrewarm(reservation, false)).toBe(false)
    expect(await protection.isConversationPrewarmCurrent(reservation)).toBe(false)
    expect(await protection.reserveConversationPrewarm(reservation, true)).toBe(true)
    await client.pexpire(`linksense:conversation-prewarm:${reservation.conversationId}`, 0)
    expect(await protection.reserveConversationPrewarm(reservation, false)).toBe(false)
    expect(await protection.claimConversationPrewarm(reservation.ownerId, reservation.conversationId)).toBe(false)
  })

  it("registers a worker atomically with capacity and checks only the exact slot", async () => {
    const owner = "10000000-0000-4000-8000-000000000001"
    const slot = await protection.acquireTurnSlot("conversation", "turn", owner)
    expect(slot.acquired).toBe(true)
    expect(await protection.runnerOwnerDeadline(owner)).toBeGreaterThan(Date.now())
    expect(await protection.hasTurnSlot("conversation", "turn", owner)).toBe(true)
    expect(await protection.hasTurnSlot("conversation", "old-turn", owner)).toBe(false)
    expect(await protection.hasTurnSlot("conversation", "turn", "other-owner")).toBe(false)
    await client.zadd("linksense:runner-owner-deadlines", 42, owner)
    await protection.acquireTurnSlot("conversation", "turn", owner)
    expect(await protection.runnerOwnerDeadline(owner)).toBe(42)
  })

  it("returns only expired workers and never removes a newer concurrent heartbeat", async () => {
    const expired = "10000000-0000-4000-8000-000000000001"
    const live = "10000000-0000-4000-8000-000000000002"
    await client.zadd("linksense:runner-owner-deadlines", 42, expired)
    await protection.recordRunnerHeartbeat(live)
    expect(await protection.expiredRunnerOwners()).toEqual([{ ownerId: expired, deadline: 42 }])
    await protection.recordRunnerHeartbeat(expired)
    await protection.acknowledgeExpiredRunnerOwner(expired, 42)
    expect(await protection.runnerOwnerDeadline(expired)).toBeGreaterThan(Date.now())
    expect(await protection.expiredRunnerOwners()).toEqual([])
  })

  it("maintains an isolated owner slot index through acquire, release and Redis bootstrap", async () => {
    const owner = "10000000-0000-4000-8000-000000000001"
    const other = "10000000-0000-4000-8000-000000000002"
    const conversationId = "10000000-0000-4000-8000-000000000003"
    const turnId = "10000000-0000-4000-8000-000000000004"
    await protection.acquireTurnSlot(conversationId, turnId, owner)
    expect(await protection.runningTurnSlotsForOwner(owner)).toEqual({ slots: [{ conversationId, turnId }], after: null })
    expect(await protection.runningTurnSlotsForOwner(other)).toEqual({ slots: [], after: null })
    await client.del("linksense:running-turn-owner-index", "linksense:runner-owner-deadlines")
    const lease = await protection.acquireRunningTurnReconcileLease()
    expect(lease).not.toBeNull()
    await protection.reconcileRunningTurnSlots([{ conversationId, turnId, ownerId: owner }], lease!)
    expect((await protection.runningTurnSlotsForOwner(owner)).slots).toEqual([{ conversationId, turnId }])
    expect(await protection.runnerOwnerDeadline(owner)).toBeGreaterThan(Date.now())
    await protection.releaseTurnSlot(conversationId, "old-turn")
    expect((await protection.runningTurnSlotsForOwner(owner)).slots).toHaveLength(1)
    await protection.releaseTurnSlot(conversationId, turnId)
    expect((await protection.runningTurnSlotsForOwner(owner)).slots).toHaveLength(0)
  })

  it("bounds expiry discovery and acknowledges only the enqueued lease", async () => {
    for (let index = 0; index < 105; index++) {
      await client.zadd("linksense:runner-owner-deadlines", 42, `10000000-0000-4000-8000-${String(index).padStart(12, "0")}`)
    }
    const entries = await protection.expiredRunnerOwners()
    expect(entries).toHaveLength(100)
    const first = entries[0]!
    await protection.acknowledgeExpiredRunnerOwner(first.ownerId, first.deadline)
    expect(await protection.runnerOwnerDeadline(first.ownerId)).toBeNull()
  })

  it("persists dispatch pagination across API instances and clears it at the end", async () => {
    const other = new LinkSenseRedis(testConfig(), client)
    const cursor = { id: "10000000-0000-4000-8000-000000000001", createdAt: "2026-09-07T00:00:00.000Z" }
    await protection.setRecoveryDispatchCursor("start", cursor)
    expect(await other.recoveryDispatchCursor("start")).toEqual(cursor)
    expect(await other.recoveryDispatchCursor("context")).toBeNull()
    await other.setRecoveryDispatchCursor("start", null)
    expect(await protection.recoveryDispatchCursor("start")).toBeNull()
  })

  it("recovers one expired worker through real BullMQ delivery and bounded retry", async () => {
    const ownerId = "10000000-0000-4000-8000-000000000001"
    const conversationId = "10000000-0000-4000-8000-000000000003"
    const projectionTurnId = "10000000-0000-4000-8000-000000000004"
    const capabilityGeneration = "a".repeat(64)
    await protection.acquireTurnSlot(conversationId, projectionTurnId, ownerId)
    await client.zadd("linksense:runner-owner-deadlines", 1, ownerId)
    const connection = { path: join(directory, "redis.sock") }
    type RecoveryJob = Parameters<TaskRecoveryQueueControl["add"]>[1]
    const queue = new Queue<RecoveryJob, void, RecoveryJob["type"]>("test-task-recovery", { connection, defaultJobOptions: { attempts: 2, backoff: { type: "fixed", delay: 1 } } })
    const reconcileAfterProcessExit = vi.fn()
      .mockResolvedValueOnce({ outcome: "failed", reasonCode: "RUNNER_UNAVAILABLE" })
      .mockImplementationOnce(async () => {
        await protection.releaseTurnSlot(conversationId, projectionTurnId)
        return { outcome: "not_applicable" }
      })
    const events = { recoverRunningTurns: vi.fn(), reconcileAfterProcessExit }
    const prisma = {
      $transaction: vi.fn((run: (tx: unknown) => Promise<unknown>): Promise<unknown> => run(prisma)),
      conversationTurn: { findMany: vi.fn(async () => [{ id: projectionTurnId, conversationId, capabilityGeneration, submittedBy: ownerId }]) },
      conversationTurnStartIntent: { findMany: vi.fn(async () => []) },
      conversationTurnAttempt: { findMany: vi.fn(async () => []) },
    }
    const conversations = { recoverStartIntent: vi.fn(), recoverContextWindowAttempt: vi.fn() }
    const scheduler = new TaskRecoveryScheduler(
      { redisUrl: "redis://unused" }, prisma as never, protection, events,
      conversations, queue,
      (processor) => new Worker("test-task-recovery", processor, { connection }),
    )
    try {
      await scheduler.start()
      await vi.waitFor(() => expect(reconcileAfterProcessExit).toHaveBeenCalledTimes(2))
      await vi.waitFor(async () => expect(await protection.runningTurnCount()).toBe(0))
      expect(events.recoverRunningTurns).not.toHaveBeenCalled()
      expect(conversations.recoverStartIntent).not.toHaveBeenCalled()
      expect(reconcileAfterProcessExit).toHaveBeenNthCalledWith(1, { conversationId, projectionTurnId, capabilityGeneration })
      expect(reconcileAfterProcessExit).toHaveBeenNthCalledWith(2, { conversationId, projectionTurnId, capabilityGeneration })
    } finally {
      await scheduler.close()
    }
  })

  it("sets a fixed window TTL and begins cooldown exactly at the threshold", async () => {
    const keys = protection.loginKeys("limit@example.test", "192.0.2.1")
    expect(await protection.recordLoginFailure(keys)).toBe(0)
    const firstTtl = await client.ttl(keys.emailWindow)
    expect(firstTtl).toBeGreaterThan(0)
    expect(await protection.recordLoginFailure(keys)).toBe(0)
    expect(await client.ttl(keys.emailWindow)).toBeLessThanOrEqual(firstTtl)
    expect(await protection.recordLoginFailure(keys)).toBeGreaterThan(0)
    expect(await client.exists(keys.emailWindow)).toBe(0)

    const cooldownTtl = await client.ttl(keys.emailCooldown)
    expect(await protection.precheckLogin(keys)).toBeGreaterThan(0)
    expect(await client.ttl(keys.emailCooldown)).toBeLessThanOrEqual(cooldownTtl)
  })

  it("shares atomic counters across workers without losing concurrent failures", async () => {
    const keys = protection.loginKeys("parallel@example.test", "192.0.2.2")
    const results = await Promise.all(
      Array.from({ length: 8 }, () => protection.recordLoginFailure(keys)),
    )
    expect(results.filter((ttl) => ttl > 0).length).toBeGreaterThanOrEqual(1)
    expect(await protection.precheckLogin(keys)).toBeGreaterThan(0)
    expect(await client.exists(keys.emailWindow)).toBe(0)
  })

  it("suppresses reset work after the fixed email threshold without extending TTL", async () => {
    const calls = []
    for (let index = 0; index < 5; index += 1) {
      calls.push(
        await protection.takePasswordResetRequest(
          "reset@example.test",
          `198.51.100.${index + 1}`,
        ),
      )
    }
    expect(calls).toEqual([true, true, true, false, false])
  })

  it("rate-limits registration independently from password reset without storing raw email", async () => {
    const email = "registration@example.test"
    const registrationCalls = []
    for (let index = 0; index < 4; index += 1) {
      registrationCalls.push(
        await protection.takeRegistrationRequest(
          email,
          `203.0.113.${index + 1}`,
        ),
      )
    }

    expect(registrationCalls).toEqual([true, true, true, false])
    await expect(
      protection.takePasswordResetRequest(email, "203.0.113.20"),
    ).resolves.toBe(true)

    const keys = await client.keys("linksense:registration:*")
    expect(keys.length).toBeGreaterThan(0)
    expect(keys.every((key) => !key.includes(email))).toBe(true)
  })

  it("limits site-icon cache admission per user without storing the raw user id", async () => {
    const userId = "10000000-0000-4000-8000-000000000001"
    const calls: boolean[] = []
    for (let index = 0; index < 61; index += 1) {
      calls.push(await protection.takeSiteIconRequest(userId))
    }

    expect(calls.slice(0, 60)).toEqual(Array.from({ length: 60 }, () => true))
    expect(calls[60]).toBe(false)

    const keys = await client.keys("linksense:v2:site-icon-rate:*")
    expect(keys).toHaveLength(1)
    expect(keys[0]).not.toContain(userId)
    const ttl = await client.ttl(keys[0]!)
    expect(ttl).toBeGreaterThan(0)
    expect(ttl).toBeLessThanOrEqual(60)
  })

  it("allows 20 voice transcription requests per user in a fixed minute without storing the raw user id", async () => {
    const userId = "10000000-0000-4000-8000-000000000021"
    const calls = []
    for (let index = 0; index < 21; index += 1) {
      calls.push(await protection.takeVoiceTranscriptionRequest(userId))
    }

    expect(calls.slice(0, 20).every((call) => call.allowed)).toBe(true)
    expect(calls[20]).toMatchObject({
      allowed: false,
      retryAfterSeconds: expect.any(Number),
    })

    const keys = await client.keys("linksense:v1:voice-transcription-rate:*")
    expect(keys).toHaveLength(1)
    expect(keys[0]).not.toContain(userId)
    const ttl = await client.ttl(keys[0]!)
    expect(ttl).toBeGreaterThan(0)
    expect(ttl).toBeLessThanOrEqual(60)
    expect(calls[20]!.retryAfterSeconds).toBe(ttl)
  })

  it("allows 20 embedded voice transcription requests per session without storing the raw session id", async () => {
    const sessionId = "50000000-0000-4000-8000-000000000021"
    const calls = []
    for (let index = 0; index < 21; index += 1) {
      calls.push(
        await protection.takeApplicationEmbedVoiceTranscriptionRequest(
          sessionId,
        ),
      )
    }

    expect(calls.slice(0, 20).every((call) => call.allowed)).toBe(true)
    expect(calls[20]).toMatchObject({
      allowed: false,
      retryAfterSeconds: expect.any(Number),
    })

    const keys = await client.keys(
      "linksense:v1:application-embed-voice-transcription-rate:*",
    )
    expect(keys).toHaveLength(1)
    expect(keys[0]).not.toContain(sessionId)
    const ttl = await client.ttl(keys[0]!)
    expect(ttl).toBeGreaterThan(0)
    expect(ttl).toBeLessThanOrEqual(60)
    expect(calls[20]!.retryAfterSeconds).toBe(ttl)
  })

  it("serializes ClawHub previews and only releases the owning admission", async () => {
    const userId = "10000000-0000-4000-8000-000000000901"
    const first = await protection.beginClawHubInstallPreview(userId)
    expect(first.status).toBe("acquired")
    if (first.status !== "acquired") throw new Error("missing admission")

    await expect(protection.beginClawHubInstallPreview(userId)).resolves.toEqual(
      { status: "busy" },
    )
    await protection.finishClawHubInstallPreview(
      userId,
      "00000000-0000-4000-8000-000000000999",
      false,
    )
    await expect(protection.beginClawHubInstallPreview(userId)).resolves.toEqual(
      { status: "busy" },
    )

    await protection.finishClawHubInstallPreview(userId, first.token, false)
    await expect(protection.beginClawHubInstallPreview(userId)).resolves.toMatchObject(
      { status: "acquired" },
    )
  })

  it("caps active ClawHub previews and fixed-window requests per user", async () => {
    const activeUserId = "10000000-0000-4000-8000-000000000902"
    for (let index = 0; index < 2; index += 1) {
      const admission = await protection.beginClawHubInstallPreview(activeUserId)
      expect(admission.status).toBe("acquired")
      if (admission.status !== "acquired") throw new Error("missing admission")
      await protection.finishClawHubInstallPreview(
        activeUserId,
        admission.token,
        true,
      )
    }
    await expect(
      protection.beginClawHubInstallPreview(activeUserId),
    ).resolves.toEqual({ status: "quota_exceeded" })

    const rateUserId = "10000000-0000-4000-8000-000000000903"
    for (let index = 0; index < 6; index += 1) {
      const admission = await protection.beginClawHubInstallPreview(rateUserId)
      expect(admission.status).toBe("acquired")
      if (admission.status !== "acquired") throw new Error("missing admission")
      await protection.finishClawHubInstallPreview(
        rateUserId,
        admission.token,
        false,
      )
    }
    await expect(
      protection.beginClawHubInstallPreview(rateUserId),
    ).resolves.toEqual({ status: "rate_limited" })

    const keys = await client.keys("linksense:v1:clawhub-preview-*:*")
    expect(keys.every((key) => !key.includes(activeUserId))).toBe(true)
    expect(keys.every((key) => !key.includes(rateUserId))).toBe(true)
  })

  it("caps ClawHub download preparation globally across users", async () => {
    const first = await protection.beginClawHubInstallPreview(
      "10000000-0000-4000-8000-000000000911",
    )
    const second = await protection.beginClawHubInstallPreview(
      "10000000-0000-4000-8000-000000000912",
    )
    expect(first.status).toBe("acquired")
    expect(second.status).toBe("acquired")

    await expect(
      protection.beginClawHubInstallPreview(
        "10000000-0000-4000-8000-000000000913",
      ),
    ).resolves.toEqual({ status: "busy" })

    if (first.status !== "acquired") throw new Error("missing admission")
    await protection.finishClawHubInstallPreview(
      "10000000-0000-4000-8000-000000000911",
      first.token,
      true,
    )
    await expect(
      protection.beginClawHubInstallPreview(
        "10000000-0000-4000-8000-000000000913",
      ),
    ).resolves.toMatchObject({ status: "acquired" })
  })

  it("enforces the global running-turn limit atomically", async () => {
    const results = await Promise.all(
      Array.from({ length: 24 }, (_, index) =>
        protection.acquireTurnSlot(
          `conversation-${index}`,
          `turn-${index}`,
          `owner-${index}`,
        ),
      ),
    )
    expect(results.filter((result) => result.acquired)).toHaveLength(20)
    expect(await protection.runningTurnCount()).toBe(20)
  })

  it("uses the effective system setting supplied for the current admission", async () => {
    const results = await Promise.all(
      Array.from({ length: 4 }, (_, index) =>
        protection.acquireTurnSlot(
          `configured-conversation-${index}`,
          `configured-turn-${index}`,
          `configured-owner-${index}`,
          3,
        ),
      ),
    )

    expect(results.filter((result) => result.acquired)).toHaveLength(3)
    expect(await protection.runningTurnCount()).toBe(3)
  })

  it("fails admission closed after Redis state is flushed", async () => {
    await client.flushdb()

    await expect(
      protection.acquireTurnSlot(
        "conversation-after-flush",
        "turn-after-flush",
        "owner-after-flush",
      ),
    ).resolves.toEqual({
      acquired: false,
      count: 0,
      capacityReady: false,
    })
    expect(await protection.runningTurnCount()).toBe(0)
  })

  it("fails admission closed before recovery has been observed", async () => {
    await client.del(RUNNING_TURN_RECOVERY_STATUS_KEY)

    await expect(
      protection.acquireTurnSlot(
        "conversation-not-started",
        "turn-not-started",
        "owner-not-started",
      ),
    ).resolves.toEqual({
      acquired: false,
      count: 0,
      capacityReady: false,
    })
  })

  it("fails admission closed after the latest recovery attempt failed", async () => {
    await client.hset(
      RUNNING_TURN_RECOVERY_STATUS_KEY,
      "outcome",
      "failed",
      "last_success_at",
      "2026-07-15T00:00:00.000Z",
    )

    await expect(
      protection.acquireTurnSlot(
        "conversation-failed",
        "turn-failed",
        "owner-failed",
      ),
    ).resolves.toEqual({
      acquired: false,
      count: 0,
      capacityReady: false,
    })
  })

  it("fails admission closed while the first recovery attempt is running", async () => {
    await client.hset(
      RUNNING_TURN_RECOVERY_STATUS_KEY,
      "outcome",
      "running",
      "last_success_at",
      "",
    )

    await expect(
      protection.acquireTurnSlot(
        "conversation-first-running",
        "turn-first-running",
        "owner-first-running",
      ),
    ).resolves.toEqual({
      acquired: false,
      count: 0,
      capacityReady: false,
    })
  })

  it("keeps admission ready during recovery when a successful baseline exists", async () => {
    await client.hset(
      RUNNING_TURN_RECOVERY_STATUS_KEY,
      "outcome",
      "running",
      "last_success_at",
      "2026-07-15T00:00:00.000Z",
    )

    await expect(
      protection.acquireTurnSlot(
        "conversation-running-baseline",
        "turn-running-baseline",
        "owner-running-baseline",
      ),
    ).resolves.toEqual({
      acquired: true,
      count: 1,
      capacityReady: true,
    })
  })

  it("only releases the slot owned by the matching turn token", async () => {
    expect(
      await protection.acquireTurnSlot(
        "conversation-tokenized",
        "turn-old",
        "owner-tokenized",
      ),
    ).toEqual({ acquired: true, count: 1, capacityReady: true })

    await protection.releaseTurnSlot("conversation-tokenized", "turn-stale")
    expect(await protection.runningTurnCount()).toBe(1)
    await expect(
      protection.acquireTurnSlot(
        "conversation-tokenized",
        "turn-new",
        "owner-tokenized",
      ),
    ).resolves.toEqual({ acquired: false, count: 1, capacityReady: true })

    await protection.releaseTurnSlot("conversation-tokenized", "turn-old")
    await expect(
      protection.acquireTurnSlot(
        "conversation-tokenized",
        "turn-new",
        "owner-tokenized",
      ),
    ).resolves.toEqual({ acquired: true, count: 1, capacityReady: true })
  })

  it("preserves a newly acquired slot while reconciling the database snapshot", async () => {
    await protection.acquireTurnSlot(
      "conversation-starting",
      "turn-starting",
      "owner-starting",
    )

    await reconcileSlots(
      protection,
      [{
        conversationId: "conversation-running",
        turnId: "turn-running",
        ownerId: "owner-running",
      }],
    )

    expect(await protection.runningTurnCount()).toBe(2)
    await expect(
      protection.acquireTurnSlot(
        "conversation-starting",
        "turn-replacement",
        "owner-starting",
      ),
    ).resolves.toEqual({ acquired: false, count: 2, capacityReady: true })
  })

  it("does not resurrect a turn released after the database snapshot started", async () => {
    await protection.acquireTurnSlot(
      "conversation-finished",
      "turn-finished",
      "owner-finished",
    )
    const lease = await protection.acquireRunningTurnReconcileLease()
    expect(lease).not.toBeNull()
    await protection.releaseTurnSlot("conversation-finished", "turn-finished")

    await protection.reconcileRunningTurnSlots(
      [{
        conversationId: "conversation-finished",
        turnId: "turn-finished",
        ownerId: "owner-finished",
      }],
      lease!,
    )

    expect(await protection.runningTurnCount()).toBe(0)
  })

  it("keeps exact release tombstones across a newer turn on the same conversation", async () => {
    await protection.acquireTurnSlot(
      "conversation-aba",
      "turn-a",
      "owner-aba",
    )
    const lease = await protection.acquireRunningTurnReconcileLease()
    expect(lease).not.toBeNull()
    await protection.releaseTurnSlot("conversation-aba", "turn-a")
    await protection.acquireTurnSlot(
      "conversation-aba",
      "turn-b",
      "owner-aba",
    )
    await protection.releaseTurnSlot("conversation-aba", "turn-b")

    await protection.reconcileRunningTurnSlots([
      {
        conversationId: "conversation-aba",
        turnId: "turn-a",
        ownerId: "owner-aba",
      },
    ], lease!)

    expect(await protection.runningTurnCount()).toBe(0)
    await expect(
      client.hget(
        "linksense:running-turn-release-markers",
        "conversation-aba:turn-a",
      ),
    ).resolves.toBe("1")
  })

  it("lists slot owners and prunes release tombstones after a serialized fresh snapshot", async () => {
    await protection.acquireTurnSlot(
      "conversation-observed",
      "turn-observed",
      "owner-observed",
    )
    await expect(protection.runningTurnSlots()).resolves.toEqual([
      {
        conversationId: "conversation-observed",
        turnId: "turn-observed",
        ownerId: "owner-observed",
      },
    ])
    await protection.releaseTurnSlot("conversation-observed", "turn-observed")
    await client.hset("linksense:running-turn-release-markers", "previous-snapshot:released-turn", "1")

    await reconcileSlots(protection, [])

    await expect(
      client.hlen("linksense:running-turn-release-markers"),
    ).resolves.toBe(0)
  })

  it("does not accumulate historical release markers during ordinary task completion", async () => {
    for (let index = 0; index < 10; index++) {
      await protection.acquireTurnSlot("conversation-normal", `turn-${index}`, "owner-normal")
      await protection.releaseTurnSlot("conversation-normal", `turn-${index}`)
    }
    expect(await client.hlen("linksense:running-turn-release-markers")).toBe(0)
  })

  it("rejects a stale reconciliation lease after a newer API instance takes ownership", async () => {
    await protection.acquireTurnSlot(
      "conversation-fenced",
      "turn-fenced",
      "owner-fenced",
    )
    await protection.releaseTurnSlot("conversation-fenced", "turn-fenced")
    const staleLease = await protection.acquireRunningTurnReconcileLease()
    expect(staleLease).not.toBeNull()

    await client.del("linksense:running-turn-reconcile-lock")
    const currentLease = await protection.acquireRunningTurnReconcileLease()
    expect(currentLease).not.toBeNull()
    await expect(
      protection.reconcileRunningTurnSlots([], currentLease!),
    ).resolves.toEqual({ applied: true, conflicted: false })
    await expect(
      protection.reconcileRunningTurnSlots(
        [
          {
            conversationId: "conversation-fenced",
            turnId: "turn-fenced",
            ownerId: "owner-fenced",
          },
        ],
        staleLease!,
      ),
    ).resolves.toEqual({ applied: false, conflicted: false })
    expect(await protection.runningTurnCount()).toBe(0)
    await protection.releaseRunningTurnReconcileLease(currentLease!)
  })

  it("reports a durable-snapshot token conflict atomically without replacing the observed slot", async () => {
    await protection.acquireTurnSlot(
      "conversation-conflicted",
      "turn-observed",
      "owner-conflicted",
    )
    const lease = await protection.acquireRunningTurnReconcileLease()
    expect(lease).not.toBeNull()

    await expect(
      protection.reconcileRunningTurnSlots(
        [
          {
            conversationId: "conversation-conflicted",
            turnId: "turn-durable",
            ownerId: "owner-conflicted",
          },
        ],
        lease!,
      ),
    ).resolves.toEqual({ applied: true, conflicted: true })
    await expect(protection.runningTurnSlots()).resolves.toEqual([
      {
        conversationId: "conversation-conflicted",
        turnId: "turn-observed",
        ownerId: "owner-conflicted",
      },
    ])
    await protection.releaseRunningTurnReconcileLease(lease!)
  })

  it("shares recovery status and rejects completion from an older attempt and fence", async () => {
    await client.del(RUNNING_TURN_RECOVERY_STATUS_KEY)
    await expect(protection.runningTurnRecoveryStatus()).resolves.toEqual({
      outcome: "not_started",
      last_attempt_at: null,
      last_success_at: null,
      last_failure_at: null,
      reason_code: null,
    })

    const staleLease = await protection.acquireRunningTurnReconcileLease()
    expect(staleLease).not.toBeNull()
    const staleAttempt = await protection.beginRunningTurnRecoveryAttempt(
      staleLease!,
      "2026-07-15T00:00:00.000Z",
    )
    expect(staleAttempt).toEqual({ attempt: 1, fence: staleLease!.fence })
    await expect(protection.runningTurnRecoveryStatus()).resolves.toMatchObject({
      outcome: "running",
      last_attempt_at: "2026-07-15T00:00:00.000Z",
    })

    await client.del("linksense:running-turn-reconcile-lock")
    const currentLease = await protection.acquireRunningTurnReconcileLease()
    expect(currentLease).not.toBeNull()
    const currentAttempt = await protection.beginRunningTurnRecoveryAttempt(
      currentLease!,
      "2026-07-15T00:00:01.000Z",
    )
    expect(currentAttempt).toEqual({ attempt: 2, fence: currentLease!.fence })

    await expect(
      protection.completeRunningTurnRecoveryAttempt(staleAttempt!, {
        outcome: "failed",
        completedAt: "2026-07-15T00:00:02.000Z",
        reasonCode: "RUNNING_TURN_RECOVERY_RUNNER_UNAVAILABLE",
      }),
    ).resolves.toBe(false)
    await expect(
      protection.completeRunningTurnRecoveryAttempt(currentAttempt!, {
        outcome: "succeeded",
        completedAt: "2026-07-15T00:00:03.000Z",
      }),
    ).resolves.toBe(true)
    await expect(protection.runningTurnRecoveryStatus()).resolves.toEqual({
      outcome: "succeeded",
      last_attempt_at: "2026-07-15T00:00:01.000Z",
      last_success_at: "2026-07-15T00:00:03.000Z",
      last_failure_at: null,
      reason_code: null,
    })
    await protection.releaseRunningTurnReconcileLease(currentLease!)
  })

  it("keeps an unknown reservation fail-closed until its exact turn releases it", async () => {
    await protection.acquireTurnSlot(
      "conversation-orphan",
      "turn-orphan",
      "owner-orphan",
    )
    await reconcileSlots(protection, [])

    expect(await protection.runningTurnCount()).toBe(1)
  })

  it("stores running-turn state only in the current unversioned namespace", async () => {
    await protection.acquireTurnSlot(
      "conversation-current",
      "turn-current",
      "owner-current",
    )
    await expect(
      client.hget("linksense:running-turn-slots", "conversation-current"),
    ).resolves.toBe("turn-current")
    await expect(client.keys("linksense:v*:running-turn-*")).resolves.toEqual(
      [],
    )
  })

  it("serializes user lifecycle mutations and only releases with the owning token", async () => {
    const userId = "00000000-0000-4000-8000-000000000123"
    const first = await protection.acquireUserLifecycleLock(userId)
    expect(first).toBeTruthy()
    await expect(protection.acquireUserLifecycleLock(userId)).resolves.toBeNull()

    await protection.releaseUserLifecycleLock(userId, "not-the-owner")
    await expect(protection.acquireUserLifecycleLock(userId)).resolves.toBeNull()

    await protection.releaseUserLifecycleLock(userId, first!)
    const second = await protection.acquireUserLifecycleLock(userId)
    expect(second).toBeTruthy()
    await protection.releaseUserLifecycleLock(userId, second!)
  })

  it("renews only the recovery lock held by the calling API instance", async () => {
    const conversationId = "00000000-0000-4000-8000-000000000321"
    const token = await protection.acquireRecoveryLock(conversationId, 500)
    expect(token).toBeTruthy()

    await expect(
      protection.renewRecoveryLock(conversationId, "not-the-owner", 5_000),
    ).resolves.toBe(false)
    await expect(
      protection.renewRecoveryLock(conversationId, token!, 5_000),
    ).resolves.toBe(true)
    expect(
      await client.pttl(`linksense:recovery-lock:${conversationId}`),
    ).toBeGreaterThan(500)

    await protection.releaseRecoveryLock(conversationId, token!)
  })
})

async function waitForSocket(socket: string): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      await access(socket)
      return
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 20))
    }
  }
  throw new Error("redis-server did not create its Unix socket")
}

async function reconcileSlots(
  protection: LinkSenseRedis,
  slots: RunningTurnSlot[],
): Promise<void> {
  const lease = await protection.acquireRunningTurnReconcileLease()
  expect(lease).not.toBeNull()
  try {
    await expect(
      protection.reconcileRunningTurnSlots(slots, lease!),
    ).resolves.toEqual({ applied: true, conflicted: false })
  } finally {
    await protection.releaseRunningTurnReconcileLease(lease!)
  }
}

async function setSuccessfulRecoveryBaseline(client: Redis): Promise<void> {
  await client.hset(
    RUNNING_TURN_RECOVERY_STATUS_KEY,
    "outcome",
    "succeeded",
    "last_attempt_at",
    "2026-07-15T00:00:00.000Z",
    "last_success_at",
    "2026-07-15T00:00:01.000Z",
    "last_failure_at",
    "",
    "reason_code",
    "",
  )
}
