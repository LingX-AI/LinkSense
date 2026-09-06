import { mkdir, mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { RUNNER_TURN_START_CONTRACT_VERSION } from "@linksense/shared"

import type { PrismaClient } from "../src/generated/prisma/client.js"
import type { LinkSenseRedis } from "../src/adapters/redis.js"
import type { RunnerClient } from "../src/adapters/runner.js"
import type { ObjectStorage } from "../src/adapters/object-storage.js"
import type { Mailer } from "../src/adapters/mailer.js"
import type { AuditService } from "../src/modules/audit/service.js"
import type { BackgroundJobs } from "../src/adapters/jobs.js"
import { SystemService } from "../src/modules/system/service.js"
import type {
  AuthenticationSettingsReader,
  ResolvedAuthenticationSettings,
} from "../src/modules/system/authentication-settings.js"
import { testConfig } from "./test-config.js"

describe("system health", () => {
  let directory: string

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "linksense-health-test-"))
    await Promise.all([
      mkdir(join(directory, "workspaces"), { recursive: true }),
      mkdir(join(directory, "capabilities"), { recursive: true }),
    ])
  })

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true })
  })

  it("checks readiness without waiting for optional email or knowledge diagnostics", async () => {
    const fixture = createSystemService(directory)
    const runnerHealth = vi.spyOn(fixture.runner, "health")
    const mailerHealth = vi.spyOn(fixture.mailer, "health").mockImplementation(() => new Promise(() => {}))
    await expect(fixture.service.readiness()).resolves.toMatchObject({ status: "available", readiness: "ready" })
    expect(mailerHealth).not.toHaveBeenCalled()
    expect(runnerHealth).toHaveBeenLastCalledWith({ includeResourceUsage: false })
  })

  it("retains Runner resource statistics in full health diagnostics", async () => {
    const fixture = createSystemService(directory)
    const runnerHealth = vi.spyOn(fixture.runner, "health")
    await fixture.service.health()
    expect(runnerHealth).toHaveBeenCalledWith({ includeResourceUsage: true })
  })

  it("keeps both health and readiness unavailable when a required dependency fails", async () => {
    const { service } = createSystemService(directory, {
      redisPing: async () => { throw new Error("private Redis failure") },
    })
    await expect(service.readiness()).resolves.toMatchObject({ readiness: "unready" })
    await expect(service.health()).resolves.toMatchObject({ readiness: "unready" })
  })

  it("keeps readiness ready when SMTP is not configured", async () => {
    const { service } = createSystemService(directory, {
      smtpHealth: { status: "not_configured", reasonCode: "SMTP_NOT_CONFIGURED" },
    })

    const health = await service.health()

    expect(health.readiness).toBe("ready")
    expect(health.components.smtp.status).toBe("not_configured")
    expect(health.components.auth_email).toMatchObject({
      status: "degraded",
      severity: "warning",
    })
  })

  it("requires the deployment credential only before initialization", async () => {
    const initializationToken = "initialization-credential-".padEnd(64, "1")
    const uninitialized = createSystemService(directory, {
      initializationToken,
    })
    const initialized = createSystemService(directory, {
      initializationToken,
      systemSettingsJson: { system_initialized: true },
    })

    await expect(uninitialized.service.bootstrap()).resolves.toMatchObject({
      initialized: false,
      initialization_credential_required: true,
    })
    await expect(initialized.service.bootstrap()).resolves.toMatchObject({
      initialized: true,
      initialization_credential_required: false,
    })
  })

  it("does not advertise an initialization credential when none is configured", async () => {
    const { service } = createSystemService(directory)

    await expect(service.bootstrap()).resolves.toMatchObject({
      initialized: false,
      initialization_credential_required: false,
    })
  })

  it("exposes Docker resource usage from the runner without affecting readiness", async () => {
    const runnerMetadata = {
      ...healthyRunnerMetadata(),
      docker_resource_usage: {
        status: "available" as const,
        checked_at: "2026-08-05T08:00:00.000Z",
        reason_code: null,
        services: [
          {
            key: "api",
            service_type: "compose" as const,
            status: "available" as const,
            container_count: 2,
            running_container_count: 2,
            cpu_percent: 17.5,
            memory_used_bytes: 512 * 1024 * 1024,
            memory_limit_bytes: 2 * 1024 * 1024 * 1024,
            memory_percent: 25,
            pids: 88,
            state: "running",
          },
        ],
      },
    }
    const { service } = createSystemService(directory, {
      runnerHealth: vi.fn().mockResolvedValue(runnerMetadata),
    })

    const health = await service.health()

    expect(health.readiness).toBe("ready")
    expect(health.docker_resource_usage).toEqual(
      runnerMetadata.docker_resource_usage,
    )
  })

  it("reports knowledge capabilities without making optional services readiness gates", async () => {
    const { service } = createSystemService(directory, {
      knowledgeHealth: {
        checkStorage: vi.fn().mockResolvedValue(healthCapability("available", null)),
        check: vi.fn().mockResolvedValue({
          checked_at: "2026-07-22T00:00:00.000Z",
          readiness: "ready",
          minio: healthCapability("available", null),
          document_parsing: healthCapability(
            "unavailable",
            "KNOWLEDGE_DOCLING_UNAVAILABLE",
          ),
          knowledge_search_and_indexing: healthCapability(
            "unavailable",
            "KNOWLEDGE_ELASTICSEARCH_UNAVAILABLE",
          ),
          rerank: {
            status: "not_configured",
            reason_code: null,
            latency_ms: 0,
          },
        }),
      },
    })

    const health = await service.health()

    expect(health.readiness).toBe("ready")
    expect(health.components.document_parsing).toMatchObject({
      status: "unavailable",
      reason_code: "KNOWLEDGE_DOCLING_UNAVAILABLE",
    })
    expect(health.components.knowledge_search_and_indexing).toMatchObject({
      status: "unavailable",
    })
    expect(health.components.rerank).toMatchObject({ status: "not_configured" })
  })

  it("fails readiness when the private knowledge MinIO bucket is unavailable", async () => {
    const { service } = createSystemService(directory, {
      knowledgeHealth: {
        checkStorage: vi.fn().mockResolvedValue(healthCapability("unavailable", "MINIO_UNAVAILABLE")),
        check: vi.fn().mockResolvedValue({
          checked_at: "2026-07-22T00:00:00.000Z",
          readiness: "unready",
          minio: healthCapability("unavailable", "MINIO_UNAVAILABLE"),
          document_parsing: healthCapability("available", null),
          knowledge_search_and_indexing: healthCapability("available", null),
          rerank: healthCapability("available", null),
        }),
      },
    })

    const health = await service.health()

    expect(health.readiness).toBe("unready")
    await expect(service.readiness()).resolves.toMatchObject({ readiness: "unready" })
    expect(health.components.minio).toMatchObject({
      status: "unavailable",
      reason_code: "MINIO_UNAVAILABLE",
    })
  })

  it("reads updated OIDC and Teams settings on each health check", async () => {
    let configured = false
    const resolveAll = vi.fn(async (): Promise<ResolvedAuthenticationSettings> => ({
        smtp: {
          mode: "inherit" as const,
          status: "not_configured" as const,
          source: "none" as const,
          revision: 0,
        },
        oidc: configured
          ? {
              mode: "managed" as const,
              status: "configured" as const,
              source: "system" as const,
              revision: 1,
              configuration: {
                issuerUrl: "https://identity.example.com",
                clientId: "linksense-web",
                clientSecret: "oidc-secret",
                redirectUri:
                  "https://linksense.example.test/api/v1/auth/oidc/callback",
              },
            }
          : {
              mode: "inherit" as const,
              status: "not_configured" as const,
              source: "none" as const,
              revision: 0,
            },
        teams: configured
          ? {
              mode: "managed" as const,
              status: "configured" as const,
              source: "system" as const,
              revision: 1,
              configuration: {
                tenantId: "00000000-0000-4000-8000-000000000111",
                clientId: "00000000-0000-4000-8000-000000000222",
              },
            }
          : {
              mode: "inherit" as const,
              status: "not_configured" as const,
              source: "none" as const,
              revision: 0,
            },
      }))
    const authenticationSettings: AuthenticationSettingsReader = {
      resolveAll,
      resolveSmtp: async () => (await resolveAll()).smtp,
      resolveOidc: async () => (await resolveAll()).oidc,
      resolveTeams: async () => (await resolveAll()).teams,
    }
    const { service } = createSystemService(directory, { authenticationSettings })

    const before = await service.health()
    expect(before.components.oidc.status).toBe("not_configured")
    expect(before.components.teams.status).toBe("not_configured")

    configured = true
    const after = await service.health()
    expect(after.components.oidc.status).toBe("available")
    expect(after.components.teams.status).toBe("available")
    expect(resolveAll).toHaveBeenCalledTimes(2)
  })

  it("warns about HTTP without failing readiness and disables configured federated sign-in", async () => {
    const configuredAuthentication: ResolvedAuthenticationSettings = {
      smtp: {
        mode: "inherit",
        status: "not_configured",
        source: "none",
        revision: 0,
      },
      oidc: {
        mode: "managed",
        status: "configured",
        source: "system",
        revision: 1,
        configuration: {
          issuerUrl: "https://identity.example.com",
          clientId: "linksense-web",
          clientSecret: "oidc-secret",
          redirectUri:
            "https://linksense.example.test/api/v1/auth/oidc/callback",
        },
      },
      teams: {
        mode: "managed",
        status: "configured",
        source: "system",
        revision: 1,
        configuration: {
          tenantId: "00000000-0000-4000-8000-000000000111",
          clientId: "00000000-0000-4000-8000-000000000222",
        },
      },
    }
    const authenticationSettings: AuthenticationSettingsReader = {
      resolveAll: vi.fn(async () => configuredAuthentication),
      resolveSmtp: vi.fn(async () => configuredAuthentication.smtp),
      resolveOidc: vi.fn(async () => configuredAuthentication.oidc),
      resolveTeams: vi.fn(async () => configuredAuthentication.teams),
    }
    const { service } = createSystemService(directory, {
      publicBaseUrl: "http://linksense.example.test",
      authenticationSettings,
    })

    const health = await service.health()

    expect(health.readiness).toBe("ready")
    expect(health.components.public_url).toMatchObject({
      status: "warning",
      reason_code: "PUBLIC_URL_INSECURE",
    })
    expect(health.components.oidc).toMatchObject({
      status: "unavailable",
      reason_code: "AUTH_HTTPS_REQUIRED",
    })
    expect(health.components.teams).toMatchObject({
      status: "unavailable",
      reason_code: "AUTH_HTTPS_REQUIRED",
    })

    const bootstrap = await service.bootstrap()
    expect(bootstrap.auth.password.status).toBe("available")
    expect(bootstrap.auth.oidc.status).toBe("unavailable")
    expect(bootstrap.auth.teams.status).toBe("unavailable")
  })

  it("marks Redis and local password login unavailable and recovers without restart", async () => {
    let redisAvailable = false
    const { service } = createSystemService(directory, {
      redisPing: vi.fn(async () => {
        if (!redisAvailable) throw new Error("redis://secret@127.0.0.1:6379")
      }),
    })

    const unavailable = await service.health()
    expect(unavailable.readiness).toBe("unready")
    expect(unavailable.components.redis).toMatchObject({
      status: "unavailable",
      reason_code: "REDIS_UNAVAILABLE",
    })
    expect(unavailable.components.local_password_login).toMatchObject({
      status: "unavailable",
      reason_code: "AUTH_LOGIN_PROTECTION_UNAVAILABLE",
    })
    expect(JSON.stringify(unavailable)).not.toContain("redis://secret")

    redisAvailable = true
    const recovered = await service.health()
    expect(recovered.readiness).toBe("ready")
    expect(recovered.components.redis.status).toBe("available")
    expect(recovered.components.local_password_login.status).toBe("available")
  })

  it("separates runner connectivity from app-server health and preserves safe metadata", async () => {
    const runnerHealth = vi
      .fn<RunnerClient["health"]>()
      .mockRejectedValueOnce(new Error("Bearer runner-secret"))
      .mockResolvedValueOnce(healthyRunnerMetadata())
    const { service } = createSystemService(directory, {
      runnerHealth,
      redisRunningTurnCount: vi.fn().mockResolvedValue(6),
    })

    const unavailable = await service.health()
    expect(unavailable.components.runner.status).toBe("unavailable")
    expect(unavailable.components.codex_app_server.status).toBe("unavailable")
    expect(JSON.stringify(unavailable)).not.toContain("runner-secret")

    const recovered = await service.health()
    expect(recovered.readiness).toBe("ready")
    expect(recovered.components.runner.status).toBe("available")
    expect(recovered.components.codex_app_server.status).toBe("available")
    expect(recovered).toMatchObject({
      running_turn_count: 6,
      redis_running_turn_count: 6,
      runner_running_turn_count: 2,
      observed_unresolved_running_turn_slot_count: 4,
      app_server_process_count: 3,
      concurrency_limit: 20,
      process_limit: 20,
    })
    expect(recovered.runner_metadata).toMatchObject({
      status: "available",
      running_turns: 2,
      app_server_processes: 3,
    })
    expect(recovered.runner_metadata).not.toHaveProperty("cleanup_failures")
  })

  it("marks capacity unavailable instead of substituting runner counts", async () => {
    const { service } = createSystemService(directory, {
      redisRunningTurnCount: vi
        .fn<LinkSenseRedis["runningTurnCount"]>()
        .mockRejectedValue(new Error("slot payload must not leak")),
    })

    const health = await service.health()

    expect(health.readiness).toBe("unready")
    expect(health).not.toHaveProperty("running_turn_count")
    expect(health).not.toHaveProperty("redis_running_turn_count")
    expect(health.runner_running_turn_count).toBe(2)
    expect(health.components.running_turn_capacity).toMatchObject({
      status: "unavailable",
      reason_code: "RUNNING_TURN_CAPACITY_UNAVAILABLE",
    })
    expect(JSON.stringify(health)).not.toContain("slot payload")
  })

  it("marks the runner unavailable when its structured health response reports unavailable", async () => {
    const { service } = createSystemService(directory, {
      runnerHealth: vi.fn().mockResolvedValue({
        ...healthyRunnerMetadata(),
        status: "unavailable",
      }),
    })

    const health = await service.health()

    expect(health.readiness).toBe("unready")
    expect(health.components.runner).toMatchObject({
      status: "unavailable",
      reason_code: "RUNNER_UNAVAILABLE",
    })
  })

  it("exposes only structured running-turn recovery state", async () => {
    const runningTurnRecoveryStatus = vi.fn().mockResolvedValue({
        outcome: "failed",
        last_attempt_at: "2026-07-15T00:00:00.000Z",
        last_success_at: "2026-07-14T23:59:45.000Z",
        last_failure_at: "2026-07-15T00:00:01.000Z",
        reason_code: "RUNNING_TURN_RECOVERY_REDIS_UNAVAILABLE",
      })
    const { service } = createSystemService(directory, {
      redisRunningTurnRecoveryStatus: runningTurnRecoveryStatus,
    })

    const health = await service.health()

    expect(health.running_turn_recovery).toEqual(
      await runningTurnRecoveryStatus(),
    )
    expect(health.components.running_turn_recovery).toMatchObject({
      status: "unavailable",
      reason_code: "RUNNING_TURN_RECOVERY_REDIS_UNAVAILABLE",
      last_failure_at: "2026-07-15T00:00:01.000Z",
    })
    expect(health.readiness).toBe("unready")
  })

  it("does not report recovery available before a shared success exists", async () => {
    const { service } = createSystemService(directory, {
      redisRunningTurnRecoveryStatus: vi.fn().mockResolvedValue({
        outcome: "running",
        last_attempt_at: "2026-07-15T00:00:00.000Z",
        last_success_at: null,
        last_failure_at: null,
        reason_code: null,
      }),
    })

    const health = await service.health()

    expect(health.components.running_turn_recovery).toMatchObject({
      status: "not_observed",
      reason_code: "RUNNING_TURN_RECOVERY_IN_PROGRESS",
    })
    expect(health.readiness).toBe("unready")
  })

  it("keeps readiness ready during recovery when a successful capacity baseline exists", async () => {
    const { service } = createSystemService(directory, {
      redisRunningTurnRecoveryStatus: vi.fn().mockResolvedValue({
        outcome: "running",
        last_attempt_at: "2026-07-15T00:00:02.000Z",
        last_success_at: "2026-07-15T00:00:01.000Z",
        last_failure_at: null,
        reason_code: null,
      }),
    })

    const health = await service.health()

    expect(health.components.running_turn_recovery).toMatchObject({
      status: "warning",
      reason_code: "RUNNING_TURN_RECOVERY_IN_PROGRESS",
      last_success_at: "2026-07-15T00:00:01.000Z",
    })
    expect(health.readiness).toBe("ready")
  })

  it("fails readiness closed before any capacity recovery is observed", async () => {
    const { service } = createSystemService(directory, {
      redisRunningTurnRecoveryStatus: vi.fn().mockResolvedValue({
        outcome: "not_started",
        last_attempt_at: null,
        last_success_at: null,
        last_failure_at: null,
        reason_code: null,
      }),
    })

    const health = await service.health()

    expect(health.components.running_turn_recovery).toMatchObject({
      status: "not_observed",
      reason_code: "RUNNING_TURN_RECOVERY_NOT_OBSERVED",
    })
    expect(health.readiness).toBe("unready")
  })

  it("sanitizes a shared recovery-status read failure and fails readiness closed", async () => {
    const { service } = createSystemService(directory, {
      redisRunningTurnRecoveryStatus: vi
        .fn<LinkSenseRedis["runningTurnRecoveryStatus"]>()
        .mockRejectedValue(new Error("recovery-key-with-secret")),
    })

    const health = await service.health()

    expect(health.readiness).toBe("unready")
    expect(health.components.running_turn_recovery).toMatchObject({
      status: "unavailable",
      reason_code: "RUNNING_TURN_RECOVERY_STATUS_UNAVAILABLE",
    })
    expect(JSON.stringify(health)).not.toContain("recovery-key-with-secret")
  })

  it("audits a cleanup retry without storing a cleanup target or raw failure", async () => {
    const retryCleanupJob = vi.fn().mockResolvedValue({
      id: "runtime-redacted-id",
      resource_type: "workspace",
      status: "failed",
      conversation_id: "01900000-0000-7000-8000-000000000001",
      failed_at: "2026-07-11T00:00:00.000Z",
      reason_code: "CLEANUP_OPERATION_FAILED",
      attempts_made: 5,
      max_attempts: 5,
    })
    const { service, auditWrite } = createSystemService(directory, {
      retryCleanupJob,
    })

    await expect(
      service.retryCleanupFailure("01900000-0000-7000-8000-000000000099", "runtime-redacted-id", {
        ipAddress: "192.0.2.1",
        userAgent: "health-test",
      }),
    ).resolves.toMatchObject({ code: "CLEANUP_RETRY_REQUESTED" })
    expect(retryCleanupJob).toHaveBeenCalledWith("runtime-redacted-id")
    expect(auditWrite).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "cleanup_retry_requested",
        result: "success",
        targetId: "runtime-redacted-id",
        metadata: {
          resource_type: "workspace",
          attempts_made: 5,
        },
      }),
    )
    expect(JSON.stringify(auditWrite.mock.calls)).not.toContain("000000000001")
  })

  it("audits a bounded bulk cleanup retry without exposing resource ids", async () => {
    const retryAllCleanupJobs = vi.fn().mockResolvedValue({
      requested: 4,
      rejected: 1,
    })
    const { service, auditWrite } = createSystemService(directory, {
      retryAllCleanupJobs,
    })

    await expect(
      service.retryAllCleanupFailures(
        "01900000-0000-7000-8000-000000000099",
        { userAgent: "health-bulk-test" },
      ),
    ).resolves.toEqual({
      code: "CLEANUP_BULK_RETRY_REQUESTED",
      requested_count: 4,
      rejected_count: 1,
    })
    expect(retryAllCleanupJobs).toHaveBeenCalledWith(100)
    expect(auditWrite).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "cleanup_bulk_retry_requested",
        metadata: { requested_count: 4, rejected_count: 1 },
      }),
    )
  })

  it("only returns cleanup job identifiers in the administrator health view", async () => {
    const cleanupFailures = [
      {
        id: "runtime-redacted-id",
        resource_type: "workspace" as const,
        status: "failed" as const,
        conversation_id: "01900000-0000-7000-8000-000000000001",
        failed_at: "2026-07-11T00:00:00.000Z",
        reason_code: "CLEANUP_OPERATION_FAILED" as const,
        attempts_made: 5,
        max_attempts: 5,
      },
    ]
    const { service } = createSystemService(directory, { cleanupFailures })

    const readiness = await service.health()
    expect(readiness).not.toHaveProperty("cleanup_failures")
    expect(JSON.stringify(readiness)).not.toContain("runtime-redacted-id")

    const administratorHealth = await service.health({
      includeCleanupFailures: true,
    })
    expect(administratorHealth.cleanup_failures).toEqual(cleanupFailures)
  })

  it("still exposes durable runtime cleanup records when the BullMQ list is unavailable", async () => {
    const durableFailure = {
      id: "database-runtime-01900000-0000-7000-8000-000000000003",
      resource_type: "workspace" as const,
      status: "failed" as const,
      conversation_id: "01900000-0000-7000-8000-000000000001",
      failed_at: "2026-07-11T00:00:00.000Z",
      reason_code: "CLEANUP_OPERATION_FAILED" as const,
      attempts_made: 0,
      max_attempts: 5,
    }
    const { service } = createSystemService(directory, {
      cleanupListError: new Error("redis unavailable"),
      durableCleanupFailures: [durableFailure],
    })

    const health = await service.health({ includeCleanupFailures: true })

    expect(health.cleanup_failures).toContainEqual(durableFailure)
    expect(health.cleanup_failures_status).toMatchObject({
      status: "unavailable",
      reason_code: "CLEANUP_QUEUE_UNAVAILABLE",
    })
  })

})

function createSystemService(
  directory: string,
  overrides: {
    redisPing?: LinkSenseRedis["ping"]
    redisRunningTurnCount?: LinkSenseRedis["runningTurnCount"]
    redisRunningTurnRecoveryStatus?: LinkSenseRedis["runningTurnRecoveryStatus"]
    runnerHealth?: RunnerClient["health"]
    smtpHealth?: Awaited<ReturnType<Mailer["health"]>>
    retryCleanupJob?: BackgroundJobs["retryFailedCleanupJob"]
    retryAllCleanupJobs?: BackgroundJobs["retryAllFailedCleanupJobs"]
    cleanupFailures?: Awaited<ReturnType<BackgroundJobs["listFailedCleanupJobs"]>>
    durableCleanupFailures?: Awaited<
      ReturnType<BackgroundJobs["listDurableRuntimeCleanupFailures"]>
    >
    cleanupListError?: Error
    publicBaseUrl?: string
    initializationToken?: string
    systemSettingsJson?: Record<string, unknown>
    authenticationSettings?: AuthenticationSettingsReader
    knowledgeHealth?: ConstructorParameters<typeof SystemService>[9]
  } = {},
) {
  const prisma = {
    $queryRaw: vi.fn().mockResolvedValue([{ result: 1 }]),
    systemSetting: {
      findUnique: vi.fn().mockResolvedValue(
        overrides.systemSettingsJson === undefined
          ? null
          : { settingsJson: overrides.systemSettingsJson },
      ),
    },
  } as unknown as PrismaClient
  const redis = {
    ping: overrides.redisPing ?? vi.fn().mockResolvedValue(undefined),
    runningTurnCount:
      overrides.redisRunningTurnCount ?? vi.fn().mockResolvedValue(2),
    runningTurnRecoveryStatus:
      overrides.redisRunningTurnRecoveryStatus ??
      vi.fn().mockResolvedValue({
        outcome: "succeeded",
        last_attempt_at: "2026-07-15T00:00:00.000Z",
        last_success_at: "2026-07-15T00:00:01.000Z",
        last_failure_at: null,
        reason_code: null,
      }),
  } as unknown as LinkSenseRedis
  const runner = {
    health: overrides.runnerHealth ?? vi.fn().mockResolvedValue(healthyRunnerMetadata()),
  } as unknown as RunnerClient
  const storage = {
    health: vi.fn().mockResolvedValue(undefined),
  } as unknown as ObjectStorage
  const mailer = {
    health: vi
      .fn()
      .mockResolvedValue(
        overrides.smtpHealth ?? { status: "available", reasonCode: null },
      ),
  } as unknown as Mailer
  const auditWrite = vi.fn().mockResolvedValue(undefined)
  const audit = { write: auditWrite } as unknown as AuditService
  const jobs = {
    listFailedCleanupJobs: overrides.cleanupListError
      ? vi.fn().mockRejectedValue(overrides.cleanupListError)
      : vi.fn().mockResolvedValue(overrides.cleanupFailures ?? []),
    listDurableRuntimeCleanupFailures: vi
      .fn()
      .mockResolvedValue(overrides.durableCleanupFailures ?? []),
    retryFailedCleanupJob: overrides.retryCleanupJob ?? vi.fn(),
    retryAllFailedCleanupJobs: overrides.retryAllCleanupJobs ?? vi.fn(),
  } as unknown as BackgroundJobs
  const config = testConfig({
    LINKSENSE_USER_DATA_ROOT: join(directory, "users"),
    ...(overrides.publicBaseUrl
      ? { LINKSENSE_PUBLIC_BASE_URL: overrides.publicBaseUrl }
      : {}),
    LINKSENSE_INITIALIZATION_TOKEN: overrides.initializationToken,
  })
  return {
    service: new SystemService(
      prisma,
      redis,
      runner,
      storage,
      mailer,
      audit,
      config,
      jobs,
      overrides.authenticationSettings,
      overrides.knowledgeHealth,
    ),
    audit,
    auditWrite,
    mailer,
    runner,
    jobs,
  }
}

function healthCapability(
  status: "available" | "unavailable",
  reasonCode: string | null,
) {
  return { status, reason_code: reasonCode, latency_ms: 1 }
}

function healthyRunnerMetadata(): Awaited<ReturnType<RunnerClient["health"]>> {
  return {
    status: "available",
    checked_at: "2026-07-11T00:00:00.000Z",
    workspace: {
      status: "available",
      reason_code: null,
      checked_at: "2026-07-11T00:00:00.000Z",
    },
    codex_home: {
      status: "available",
      reason_code: null,
      checked_at: "2026-07-11T00:00:00.000Z",
    },
    codex_app_server: {
      status: "available",
      reason_code: null,
      checked_at: "2026-07-11T00:00:00.000Z",
      cached: false,
    },
    running_turns: 2,
    app_server_processes: 3,
    concurrency_limit: 20,
    app_server_process_limit: 7,
    process_limit: 7,
    turn_start_contract_version: RUNNER_TURN_START_CONTRACT_VERSION,
  }
}
