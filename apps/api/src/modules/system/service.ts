import { randomUUID } from "node:crypto"
import { access, constants, mkdir } from "node:fs/promises"
import type { Readable } from "node:stream"
import {
  maintenanceStatusSchema,
  maintenanceStateSchema,
  isLocale,
  supportedLocales,
  type Locale,
  type MaintenanceState,
  resolveOrganizationDisplayName,
  type ExecutionConcurrencySettings,
  type MaintenanceStatus,
  type RegistrationSettings,
  type ResolvedExecutionConcurrencySettings,
  type UpdateExecutionConcurrencySettings,
  type UpdateMaintenanceSettings,
  type UpdateRegistrationSettings,
} from "@linksense/shared"

import type { Prisma, PrismaClient } from "../../generated/prisma/client.js"
import type { AppConfig } from "../../config.js"
import {
  isRunningTurnCapacityReady,
  type LinkSenseRedis,
  type RunningTurnRecoveryStatus,
} from "../../adapters/redis.js"
import type { RunnerClient } from "../../adapters/runner.js"
import type { ObjectStorage } from "../../adapters/object-storage.js"
import type { Mailer } from "../../adapters/mailer.js"
import {
  CleanupJobNotFoundError,
  CleanupJobNotRetryableError,
  type BackgroundJobs,
  type CleanupFailure,
} from "../../adapters/jobs.js"
import { AppError } from "../../lib/errors.js"
import {
  detectSafeRasterImage,
  type SafeRasterImageMimeType,
} from "../../lib/safe-raster-image.js"
import type { AuditContext, AuditService } from "../audit/service.js"
import type {
  KnowledgeHealthComponent,
  KnowledgeProcessingHealthSnapshot,
} from "../knowledge-processing/health.js"
import {
  resolveEnvironmentAuthenticationSettings,
  type AuthenticationSettingsReader,
  type ResolvedAuthenticationSettings,
} from "./authentication-settings.js"

const SYSTEM_SETTINGS_ID = "00000000-0000-4000-8000-000000000001"
const PRODUCT_LOGO_MAX_BYTES = 2 * 1024 * 1024
const PRODUCT_LOGO_SETTING_KEY = "organization_logo"
const PRODUCT_LOGO_OBJECT_PREFIX = "system/product-logo"
const EXECUTION_CONCURRENCY_SETTING_KEY = "execution_concurrency"
const EMPTY_MAINTENANCE_SETTINGS = {
  maintenance_id: null,
  enabled: false,
  reason: null,
  start_at: null,
  end_at: null,
} as const
const PRODUCT_LOGO_EXTENSIONS: Record<SafeRasterImageMimeType, string> = {
  "image/gif": "gif",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
}

type ProductLogoMetadata = {
  objectKey: string
  contentType: SafeRasterImageMimeType
  updatedAt: string
}

export type ProductLogoUpload = {
  filename: string
  declaredMimeType: string
  bytes: Buffer
}

export type ProductLogoContent = {
  data: Buffer
  contentType: SafeRasterImageMimeType
  updatedAt: string
}

export type ProductSettings = {
  organization_display_name: string
  default_locale: Locale
  logo_url: string | null
  logo_updated_at: string | null
}

export class SystemService {
  private defaultLocaleCache: Locale = "zh-CN"

  constructor(
    private readonly prisma: PrismaClient,
    private readonly redis: LinkSenseRedis,
    private readonly runner: RunnerClient,
    private readonly storage: ObjectStorage,
    private readonly mailer: Mailer,
    private readonly audit: AuditService,
    private readonly config: AppConfig,
    private readonly jobs: BackgroundJobs,
    private readonly authenticationSettings?: AuthenticationSettingsReader,
    private readonly knowledgeHealth?: {
      check(): Promise<KnowledgeProcessingHealthSnapshot>
      checkStorage(): Promise<KnowledgeHealthComponent>
    },
  ) {}

  get defaultLocale(): Locale {
    return this.defaultLocaleCache
  }

  async prepare(): Promise<void> {
    await this.expireMaintenanceSettings()
    const settings = await this.getProductSettings()
    this.defaultLocaleCache = settings.default_locale
  }

  async bootstrap() {
    const raw = await this.readCurrentSystemSettings(new Date())
    const settings = productSettings(raw)
    const { maintenance_id, ...maintenance } = maintenanceStatus(raw, new Date())
    const registration = registrationAvailability(raw)
    const authentication = await this.resolveAuthenticationSettings()
    const initialized = raw.system_initialized === true
    this.defaultLocaleCache = settings.default_locale
    return {
      initialized,
      initialization_credential_required:
        !initialized && this.config.initializationToken !== undefined,
      organization_display_name: settings.organization_display_name,
      default_locale: settings.default_locale,
      logo_url: settings.logo_url,
      logo_updated_at: settings.logo_updated_at,
      supported_locales: [...supportedLocales],
      maintenance_id,
      maintenance,
      registration,
      auth: {
        password: { status: "available" },
        oidc: {
          status:
            authentication.oidc.status === "configured"
              ? this.config.publicUrlUsesHttps
                ? "available"
                : "unavailable"
              : authentication.oidc.status === "not_configured"
                ? "not_configured"
                : "unavailable",
        },
        teams: {
          status:
            authentication.teams.status === "configured"
              ? this.config.publicUrlUsesHttps
                ? "available"
                : "unavailable"
              : authentication.teams.status === "not_configured"
                ? "not_configured"
                : "unavailable",
        },
      },
      upload: {
        max_file_size_bytes: this.config.upload.maxFileSizeBytes,
        max_files_per_conversation: this.config.upload.maxFilesPerConversation,
      },
    }
  }

  async getProductSettings(): Promise<ProductSettings> {
    const row = await this.prisma.systemSetting.findUnique({
      where: { id: SYSTEM_SETTINGS_ID },
    })
    const settings = productSettings(asObject(row?.settingsJson))
    this.defaultLocaleCache = settings.default_locale
    return settings
  }

  async resolveExecutionConcurrencySettings(): Promise<ResolvedExecutionConcurrencySettings> {
    const row = await this.prisma.systemSetting.findUnique({
      where: { id: SYSTEM_SETTINGS_ID },
      select: { settingsJson: true },
    })
    return executionConcurrencySettings(
      asObject(row?.settingsJson),
      this.executionConcurrencyEnvironmentDefaults(),
    ).effective
  }

  async getExecutionConcurrencySettings(): Promise<ExecutionConcurrencySettings> {
    const row = await this.prisma.systemSetting.findUnique({
      where: { id: SYSTEM_SETTINGS_ID },
      select: { settingsJson: true },
    })
    return executionConcurrencySettings(
      asObject(row?.settingsJson),
      this.executionConcurrencyEnvironmentDefaults(),
    )
  }

  async updateExecutionConcurrencySettings(
    actorId: string,
    settings: UpdateExecutionConcurrencySettings,
    context: AuditContext,
  ): Promise<ExecutionConcurrencySettings> {
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`
        SELECT pg_advisory_xact_lock(hashtextextended('linksense-system-settings', 0))
      `
      const row = await tx.systemSetting.findUnique({
        where: { id: SYSTEM_SETTINGS_ID },
      })
      const current = asObject(row?.settingsJson)
      const merged = {
        ...current,
        [EXECUTION_CONCURRENCY_SETTING_KEY]: {
          max_concurrent_conversations:
            settings.max_concurrent_conversations,
          runner_app_server_process_limit:
            settings.runner_app_server_process_limit,
        },
      }
      await tx.systemSetting.upsert({
        where: { id: SYSTEM_SETTINGS_ID },
        create: {
          id: SYSTEM_SETTINGS_ID,
          settingsJson: merged,
          updatedBy: actorId,
        },
        update: { settingsJson: merged, updatedBy: actorId },
      })
      await tx.auditLog.create({
        data: {
          actorId,
          action: "execution_concurrency_settings_updated",
          targetType: "system_settings",
          targetId: SYSTEM_SETTINGS_ID,
          result: "success",
          metadataJson: {
            max_concurrent_conversations:
              settings.max_concurrent_conversations,
            runner_app_server_process_limit:
              settings.runner_app_server_process_limit,
          },
          ipAddress: context.ipAddress ?? null,
          userAgent: context.userAgent ?? null,
        },
      })
      return executionConcurrencySettings(
        merged,
        this.executionConcurrencyEnvironmentDefaults(),
      )
    })
  }

  private executionConcurrencyEnvironmentDefaults(): ResolvedExecutionConcurrencySettings {
    return {
      max_concurrent_conversations: this.config.maxConcurrentConversations,
      runner_app_server_process_limit:
        this.config.runnerAppServerProcessLimit,
    }
  }

  async getMaintenanceStatus(now = new Date()): Promise<MaintenanceStatus> {
    const settings = await this.readCurrentSystemSettings(now)
    return maintenanceStatusSchema.strip().parse(maintenanceStatus(settings, now))
  }

  async expireMaintenanceSettings(): Promise<void> {
    await this.readCurrentSystemSettings(new Date())
  }

  private async readCurrentSystemSettings(now: Date): Promise<Record<string, unknown>> {
    const row = await this.prisma.systemSetting.findUnique({
      where: { id: SYSTEM_SETTINGS_ID },
    })
    const current = asObject(row?.settingsJson)
    if (!isMaintenanceExpired(current, now)) return current

    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`
        SELECT pg_advisory_xact_lock(hashtextextended('linksense-system-settings', 0))
      `
      // A concurrent administrator may have extended or replaced this plan.
      // Read again under the same lock used by all system-settings writers.
      const latest = await tx.systemSetting.findUnique({ where: { id: SYSTEM_SETTINGS_ID } })
      const settings = asObject(latest?.settingsJson)
      if (!isMaintenanceExpired(settings, now)) return settings
      const merged = { ...settings, maintenance: EMPTY_MAINTENANCE_SETTINGS }
      await tx.systemSetting.update({
        where: { id: SYSTEM_SETTINGS_ID },
        data: { settingsJson: merged },
      })
      await tx.auditLog.create({
        data: {
          actorId: null,
          action: "maintenance_settings_expired",
          targetType: "system_settings",
          targetId: SYSTEM_SETTINGS_ID,
          result: "success",
        },
      })
      return merged
    })
  }

  async getRegistrationSettings(): Promise<RegistrationSettings> {
    const row = await this.prisma.systemSetting.findUnique({
      where: { id: SYSTEM_SETTINGS_ID },
      select: { settingsJson: true },
    })
    return registrationSettings(asObject(row?.settingsJson))
  }

  async updateRegistrationSettings(
    actorId: string,
    settings: UpdateRegistrationSettings,
    context: AuditContext,
  ): Promise<RegistrationSettings> {
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`
        SELECT pg_advisory_xact_lock(hashtextextended('linksense-system-settings', 0))
      `
      const row = await tx.systemSetting.findUnique({
        where: { id: SYSTEM_SETTINGS_ID },
      })
      const current = asObject(row?.settingsJson)
      const merged = {
        ...current,
        self_registration: {
          enabled: settings.enabled,
        },
      }
      await tx.systemSetting.upsert({
        where: { id: SYSTEM_SETTINGS_ID },
        create: {
          id: SYSTEM_SETTINGS_ID,
          settingsJson: merged,
          updatedBy: actorId,
        },
        update: { settingsJson: merged, updatedBy: actorId },
      })
      await tx.auditLog.create({
        data: {
          actorId,
          action: "self_registration_settings_updated",
          targetType: "system_settings",
          targetId: SYSTEM_SETTINGS_ID,
          result: "success",
          metadataJson: {
            enabled: settings.enabled,
          },
          ipAddress: context.ipAddress ?? null,
          userAgent: context.userAgent ?? null,
        },
      })
      return registrationSettings(merged)
    })
  }

  async updateMaintenanceSettings(
    actorId: string,
    settings: UpdateMaintenanceSettings,
    context: AuditContext,
  ): Promise<MaintenanceState> {
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`
        SELECT pg_advisory_xact_lock(hashtextextended('linksense-system-settings', 0))
      `
      const row = await tx.systemSetting.findUnique({
        where: { id: SYSTEM_SETTINGS_ID },
      })
      const current = asObject(row?.settingsJson)
      const now = new Date()
      const previous = maintenanceStatus(current, now)
      // Edits within a live/scheduled period retain its identity. Expiry,
      // disabling, or moving active maintenance into the future ends that period.
      const continuesPeriod =
        previous.enabled &&
        previous.maintenance_id !== null &&
        previous.end_at !== null &&
        Date.parse(previous.end_at) > now.getTime() &&
        !(
          previous.active &&
          settings.start_at !== null &&
          Date.parse(settings.start_at) > now.getTime()
        )
      const maintenance = {
        maintenance_id: settings.enabled
          ? continuesPeriod
            ? previous.maintenance_id
            : randomUUID()
          : null,
        enabled: settings.enabled,
        reason: settings.reason,
        start_at: settings.start_at,
        end_at: settings.end_at,
      }
      const merged = {
        ...current,
        maintenance: isMaintenanceExpired({ maintenance }, now)
          ? EMPTY_MAINTENANCE_SETTINGS
          : maintenance,
      }
      await tx.systemSetting.upsert({
        where: { id: SYSTEM_SETTINGS_ID },
        create: {
          id: SYSTEM_SETTINGS_ID,
          settingsJson: merged,
          updatedBy: actorId,
        },
        update: { settingsJson: merged, updatedBy: actorId },
      })
      await tx.auditLog.create({
        data: {
          actorId,
          action: "maintenance_settings_updated",
          targetType: "system_settings",
          targetId: SYSTEM_SETTINGS_ID,
          result: "success",
          metadataJson: {
            enabled: settings.enabled,
            start_at: settings.start_at,
            end_at: settings.end_at,
          },
          ipAddress: context.ipAddress ?? null,
          userAgent: context.userAgent ?? null,
        },
      })
      return maintenanceStatus(merged, now)
    })
  }

  async patchProductSettings(
    actorId: string,
    patch: Partial<Pick<ProductSettings, "organization_display_name" | "default_locale">>,
    context: AuditContext,
  ): Promise<ProductSettings> {
    const result = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`
        SELECT pg_advisory_xact_lock(hashtextextended('linksense-system-settings', 0))
      `
      const row = await tx.systemSetting.findUnique({ where: { id: SYSTEM_SETTINGS_ID } })
      const current = asObject(row?.settingsJson)
      const merged = { ...current, ...patch }
      const after = productSettings(merged)
      await tx.systemSetting.upsert({
        where: { id: SYSTEM_SETTINGS_ID },
        create: { id: SYSTEM_SETTINGS_ID, settingsJson: merged, updatedBy: actorId },
        update: { settingsJson: merged, updatedBy: actorId },
      })
      await tx.auditLog.create({
        data: {
          actorId,
          action: "product_settings_updated",
          targetType: "system_settings",
          targetId: SYSTEM_SETTINGS_ID,
          result: "success",
          metadataJson: {
            changed_keys: Object.keys(patch).sort().join(","),
          },
          ipAddress: context.ipAddress ?? null,
          userAgent: context.userAgent ?? null,
        },
      })
      return after
    })
    this.defaultLocaleCache = result.default_locale
    return result
  }

  async replaceProductLogo(
    actorId: string,
    upload: ProductLogoUpload,
    context: AuditContext,
  ): Promise<ProductSettings> {
    const metadata = await this.writeProductLogoUpload(upload)
    let previousObjectKey: string | null = null
    try {
      const result = await this.prisma.$transaction(async (tx) => {
        await tx.$executeRaw`
          SELECT pg_advisory_xact_lock(hashtextextended('linksense-system-settings', 0))
        `
        const row = await tx.systemSetting.findUnique({
          where: { id: SYSTEM_SETTINGS_ID },
        })
        const current = asObject(row?.settingsJson)
        previousObjectKey = productLogoMetadata(current)?.objectKey ?? null
        const merged = {
          ...current,
          [PRODUCT_LOGO_SETTING_KEY]: {
            object_key: metadata.objectKey,
            content_type: metadata.contentType,
            updated_at: metadata.updatedAt,
          },
        }
        const after = productSettings(merged)
        await tx.systemSetting.upsert({
          where: { id: SYSTEM_SETTINGS_ID },
          create: {
            id: SYSTEM_SETTINGS_ID,
            settingsJson: merged,
            updatedBy: actorId,
          },
          update: { settingsJson: merged, updatedBy: actorId },
        })
        await tx.auditLog.create({
          data: {
            actorId,
            action: "product_logo_updated",
            targetType: "system_settings",
            targetId: SYSTEM_SETTINGS_ID,
            result: "success",
            metadataJson: {
              content_type: metadata.contentType,
              size_bytes: upload.bytes.byteLength,
            },
            ipAddress: context.ipAddress ?? null,
            userAgent: context.userAgent ?? null,
          },
        })
        return after
      })
      if (previousObjectKey && previousObjectKey !== metadata.objectKey) {
        await this.jobs.enqueueObjectDelete(previousObjectKey).catch(() => undefined)
      }
      return result
    } catch (error) {
      await this.jobs.enqueueObjectDelete(metadata.objectKey).catch(() => undefined)
      throw error
    }
  }

  async deleteProductLogo(
    actorId: string,
    context: AuditContext,
  ): Promise<ProductSettings> {
    let previousObjectKey: string | null = null
    const result = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`
        SELECT pg_advisory_xact_lock(hashtextextended('linksense-system-settings', 0))
      `
      const row = await tx.systemSetting.findUnique({
        where: { id: SYSTEM_SETTINGS_ID },
      })
      const current = asObject(row?.settingsJson)
      previousObjectKey = productLogoMetadata(current)?.objectKey ?? null
      const merged: Record<string, unknown> = { ...current }
      delete merged[PRODUCT_LOGO_SETTING_KEY]
      const settingsJson = merged as Prisma.InputJsonObject
      const after = productSettings(merged)
      await tx.systemSetting.upsert({
        where: { id: SYSTEM_SETTINGS_ID },
        create: {
          id: SYSTEM_SETTINGS_ID,
          settingsJson,
          updatedBy: actorId,
        },
        update: { settingsJson, updatedBy: actorId },
      })
      await tx.auditLog.create({
        data: {
          actorId,
          action: "product_logo_deleted",
          targetType: "system_settings",
          targetId: SYSTEM_SETTINGS_ID,
          result: "success",
          metadataJson: {},
          ipAddress: context.ipAddress ?? null,
          userAgent: context.userAgent ?? null,
        },
      })
      return after
    })
    if (previousObjectKey) {
      await this.jobs.enqueueObjectDelete(previousObjectKey).catch(() => undefined)
    }
    return result
  }

  async readProductLogo(): Promise<ProductLogoContent | null> {
    const row = await this.prisma.systemSetting.findUnique({
      where: { id: SYSTEM_SETTINGS_ID },
    })
    const metadata = productLogoMetadata(asObject(row?.settingsJson))
    if (!metadata) return null
    try {
      const data = await streamToBuffer(
        await this.storage.getObjectStream(metadata.objectKey),
        PRODUCT_LOGO_MAX_BYTES + 1,
      )
      const detectedType = detectSafeRasterImage(data)
      if (
        data.byteLength === 0 ||
        data.byteLength > PRODUCT_LOGO_MAX_BYTES ||
        detectedType !== metadata.contentType
      ) {
        return null
      }
      return {
        data,
        contentType: metadata.contentType,
        updatedAt: metadata.updatedAt,
      }
    } catch {
      return null
    }
  }

  private async writeProductLogoUpload(
    upload: ProductLogoUpload,
  ): Promise<ProductLogoMetadata> {
    if (upload.bytes.byteLength === 0 || upload.bytes.byteLength > PRODUCT_LOGO_MAX_BYTES) {
      throw new AppError("PRODUCT_LOGO_UPLOAD_INVALID")
    }
    const detectedType = detectSafeRasterImage(upload.bytes)
    if (!detectedType || (upload.declaredMimeType && upload.declaredMimeType !== detectedType)) {
      throw new AppError("PRODUCT_LOGO_UPLOAD_INVALID")
    }
    const updatedAt = new Date().toISOString()
    const objectKey = `${PRODUCT_LOGO_OBJECT_PREFIX}/${randomUUID()}.${PRODUCT_LOGO_EXTENSIONS[detectedType]}`
    await this.storage.putObject(objectKey, upload.bytes, {
      "content-type": detectedType,
      "original-filename": sanitizeMetadataValue(upload.filename),
    })
    return { objectKey, contentType: detectedType, updatedAt }
  }

  private async probeReadinessDependencies(includeResourceUsage = false) {
    const checkedAt = new Date().toISOString()
    const [database, redis, runningTurnCapacity, runningTurnRecovery, minio, runnerProbe, workspace, capabilityRoot, knowledgeStorage] = await Promise.all([
      probe(async () => { await this.prisma.$queryRaw`SELECT 1` }, "DATABASE_UNAVAILABLE"),
      probe(() => this.redis.ping(), "REDIS_UNAVAILABLE"),
      probeValue(() => this.redis.runningTurnCount(), "RUNNING_TURN_CAPACITY_UNAVAILABLE"),
      probeValue(() => this.redis.runningTurnRecoveryStatus(), "RUNNING_TURN_RECOVERY_STATUS_UNAVAILABLE"),
      probe(() => this.storage.health(), "MINIO_UNAVAILABLE"),
      probeValue(() => this.runner.health({ includeResourceUsage }), "RUNNER_UNAVAILABLE"),
      probe(() => probeWritableDirectory(this.config.workspaceRoot), "WORKSPACE_ROOT_UNAVAILABLE"),
      probe(() => probeWritableDirectory(this.config.capabilityRoot), "CAPABILITY_ROOT_UNAVAILABLE"),
      this.knowledgeHealth
        ? this.knowledgeHealth.checkStorage().catch(() => unavailableComponent("MINIO_UNAVAILABLE"))
        : Promise.resolve(availableComponent()),
    ])
    const runnerHealth = runnerProbe.value
    const recovery = recoveryComponent(runningTurnRecovery, checkedAt)
    const ready = (recovery.status === "available" || recovery.status === "warning") && [
      database, redis, runningTurnCapacity, minio, knowledgeStorage,
      workspace, capabilityRoot, runnerHealth, runnerHealth?.workspace,
      runnerHealth?.codex_home, runnerHealth?.codex_app_server,
    ].every((component) => component?.status === "available")
    return { checkedAt, database, redis, runningTurnCapacity, runningTurnRecovery, minio, runnerProbe, workspace, capabilityRoot, knowledgeStorage, ready }
  }

  async readiness(): Promise<{ status: "available" | "unavailable"; readiness: "ready" | "unready"; checked_at: string }> {
    const { ready, checkedAt } = await this.probeReadinessDependencies()
    return { status: ready ? "available" : "unavailable", readiness: ready ? "ready" : "unready", checked_at: checkedAt }
  }

  async health(options: { includeCleanupFailures?: boolean } = {}) {
    const checkedAt = new Date().toISOString()
    const knowledgeHealth = this.knowledgeHealth
    const [
      requiredHealth,
      smtp,
      authenticationProbe,
      cleanup,
      durableCleanup,
      knowledgeProbe,
      executionConcurrencyProbe,
    ] = await Promise.all([
        this.probeReadinessDependencies(true),
        this.mailer.health(),
        probeValue(
          () => this.resolveAuthenticationSettings(),
          "AUTHENTICATION_SETTINGS_UNAVAILABLE",
        ),
        probeValue(
          () =>
            options.includeCleanupFailures
              ? this.jobs.listFailedCleanupJobs(100)
              : Promise.resolve([]),
          "CLEANUP_QUEUE_UNAVAILABLE",
        ),
        probeValue(
          () =>
            options.includeCleanupFailures
              ? this.jobs.listDurableRuntimeCleanupFailures(100)
              : Promise.resolve([]),
          "CLEANUP_OUTBOX_UNAVAILABLE",
        ),
        knowledgeHealth
          ? probeValue(
              () => knowledgeHealth.check(),
              "KNOWLEDGE_HEALTH_UNAVAILABLE",
            )
          : Promise.resolve({
              status: "available" as const,
              reason_code: null,
              value: null,
            }),
        probeValue(
          () => this.resolveExecutionConcurrencySettings(),
          "EXECUTION_CONCURRENCY_SETTINGS_UNAVAILABLE",
        ),
      ])
    const { database, redis, runningTurnCapacity, runningTurnRecovery, minio, runnerProbe, workspace, capabilityRoot, knowledgeStorage, ready } = requiredHealth
    const executionConcurrency =
      executionConcurrencyProbe.value ??
      this.executionConcurrencyEnvironmentDefaults()
    const runnerHealth = runnerProbe.value
    const dockerResourceUsage = runnerHealth?.docker_resource_usage ?? {
      status: "unavailable" as const,
      checked_at: checkedAt,
      reason_code: "RUNNER_UNAVAILABLE",
      services: [],
    }
    const redisRunningTurnCount = runningTurnCapacity.value
    const runnerRunningTurnCount = runnerHealth?.running_turns
    const observedUnresolvedSlotCount =
      redisRunningTurnCount === undefined || runnerRunningTurnCount === undefined
        ? undefined
        : Math.max(redisRunningTurnCount - runnerRunningTurnCount, 0)
    const recoveryStatus = runningTurnRecovery.value
    const runner = runnerHealth?.status === "available"
      ? availableComponent()
      : unavailableComponent("RUNNER_UNAVAILABLE")
    const codexHome = runnerHealth?.codex_home ??
      unavailableComponent("RUNNER_UNAVAILABLE")
    const codexAppServer = runnerHealth?.codex_app_server ??
      unavailableComponent("RUNNER_UNAVAILABLE")
    const runnerWorkspace = runnerHealth?.workspace
    const effectiveWorkspace =
      workspace.status === "unavailable" || runnerWorkspace?.status === "unavailable"
        ? unavailableComponent("WORKSPACE_ROOT_UNAVAILABLE")
        : workspace
    const localPasswordLogin =
      redis.status === "available"
        ? availableComponent()
        : unavailableComponent("AUTH_LOGIN_PROTECTION_UNAVAILABLE")
    const knowledge = knowledgeProbe.value
    const effectiveMinio =
      minio.status === "unavailable" ||
      knowledgeStorage.status === "unavailable"
        ? unavailableComponent(
            minio.reason_code ??
              knowledgeStorage.reason_code ??
              "MINIO_UNAVAILABLE",
          )
        : minio
    const runningTurnRecoveryComponent = recoveryComponent(
      runningTurnRecovery,
      checkedAt,
    )
    const smtpStatus = {
      status: smtp.status,
      checked_at: checkedAt,
      reason_code: smtp.reasonCode,
    }
    const authentication = authenticationProbe.value
    const cleanupFailures = [
      ...(durableCleanup.value ?? []),
      ...(cleanup.value ?? []),
    ]
    return {
      status: ready ? "available" : "unavailable",
      overall_status: ready ? "available" : "unavailable",
      readiness: ready ? "ready" : "unready",
      checked_at: checkedAt,
      ...(redisRunningTurnCount === undefined
        ? {}
        : {
            // Backwards-compatible alias. Redis is the admission authority.
            running_turn_count: redisRunningTurnCount,
            redis_running_turn_count: redisRunningTurnCount,
          }),
      ...(runnerHealth
        ? {
            runner_running_turn_count: runnerHealth.running_turns,
            app_server_process_count: runnerHealth.app_server_processes,
            process_limit: runnerHealth.app_server_process_limit,
            runner_metadata: runnerHealth,
          }
        : {}),
      docker_resource_usage: dockerResourceUsage,
      ...(observedUnresolvedSlotCount === undefined
        ? {}
        : {
            // An observation-only delta, not a definitive orphan count.
            observed_unresolved_running_turn_slot_count:
              observedUnresolvedSlotCount,
          }),
      ...(recoveryStatus ? { running_turn_recovery: recoveryStatus } : {}),
      concurrency_limit: executionConcurrency.max_concurrent_conversations,
      process_limit: executionConcurrency.runner_app_server_process_limit,
      ...(options.includeCleanupFailures
        ? {
            cleanup_failures: cleanupFailures,
            cleanup_failure_summary: {
              total: cleanupFailures.length,
              requires_attention: cleanupFailures.length > 0,
            },
            cleanup_failures_status: withTime(
              cleanup.status === "unavailable" ||
                durableCleanup.status === "unavailable"
                ? {
                    status: "unavailable",
                    reason_code:
                      cleanup.reason_code ?? durableCleanup.reason_code,
                  }
                : { status: "available", reason_code: null },
              checkedAt,
            ),
          }
        : {}),
      components: {
        api: { status: "available", checked_at: checkedAt, reason_code: null },
        public_url: {
          status: this.config.publicUrlUsesHttps ? "available" : "warning",
          checked_at: checkedAt,
          reason_code: this.config.publicUrlUsesHttps
            ? null
            : "PUBLIC_URL_INSECURE",
        },
        database: withTime(database, checkedAt),
        redis: withTime(redis, checkedAt),
        running_turn_capacity: withTime(runningTurnCapacity, checkedAt),
        local_password_login: withTime(localPasswordLogin, checkedAt),
        minio: withTime(effectiveMinio, checkedAt),
        runner: withTime(runner, checkedAt),
        codex_app_server: withTime(codexAppServer, checkedAt),
        workspace: withTime(effectiveWorkspace, checkedAt),
        codex_home: withTime(codexHome, checkedAt),
        capability_root: withTime(capabilityRoot, checkedAt),
        running_turn_recovery: runningTurnRecoveryComponent,
        ...(knowledge
          ? {
              document_parsing: withTime(
                knowledge.document_parsing,
                checkedAt,
              ),
              knowledge_search_and_indexing: withTime(
                knowledge.knowledge_search_and_indexing,
                checkedAt,
              ),
              rerank: withTime(knowledge.rerank, checkedAt),
            }
          : {}),
        smtp: smtpStatus,
        auth_email: {
          status: smtp.status === "available" ? "available" : "degraded",
          severity: smtp.status === "available" ? "info" : "warning",
          warning_code:
            smtp.status === "available" ? null : "AUTH_EMAIL_CAPABILITY_DEGRADED",
        },
        oidc: {
          status:
            authentication?.oidc.status === "configured" &&
            !this.config.publicUrlUsesHttps
              ? "unavailable"
              : authentication
                ? mapConfigStatus(authentication.oidc.status)
                : "unavailable",
          checked_at: checkedAt,
          reason_code:
            !authentication
              ? authenticationProbe.reason_code
              : authentication.oidc.status === "configured" &&
                  !this.config.publicUrlUsesHttps
                ? "AUTH_HTTPS_REQUIRED"
              : authentication.oidc.status === "invalid"
                ? "OIDC_CONFIGURATION_INVALID"
                : null,
        },
        teams: {
          status:
            authentication?.teams.status === "configured" &&
            !this.config.publicUrlUsesHttps
              ? "unavailable"
              : authentication
                ? mapConfigStatus(authentication.teams.status)
                : "unavailable",
          checked_at: checkedAt,
          reason_code:
            !authentication
              ? authenticationProbe.reason_code
              : authentication.teams.status === "configured" &&
                  !this.config.publicUrlUsesHttps
                ? "AUTH_HTTPS_REQUIRED"
              : authentication.teams.status === "invalid"
                ? "TEAMS_CONFIGURATION_INVALID"
                : null,
        },
      },
    }
  }

  async retryCleanupFailure(
    actorId: string,
    jobId: string,
    context: AuditContext,
  ): Promise<{ code: "CLEANUP_RETRY_REQUESTED"; cleanup_failure: CleanupFailure }> {
    try {
      const cleanupFailure = await this.jobs.retryFailedCleanupJob(jobId)
      await this.audit.write({
        actorId,
        action: "cleanup_retry_requested",
        targetType: "maintenance_job",
        targetId: jobId,
        result: "success",
        metadata: {
          resource_type: cleanupFailure.resource_type,
          attempts_made: cleanupFailure.attempts_made,
        },
        ...context,
      })
      return {
        code: "CLEANUP_RETRY_REQUESTED",
        cleanup_failure: cleanupFailure,
      }
    } catch (error) {
      const appError =
        error instanceof AppError
          ? error
          : error instanceof CleanupJobNotFoundError
          ? new AppError("NOT_FOUND")
          : error instanceof CleanupJobNotRetryableError
            ? new AppError("CONFLICT")
            : new AppError("INTERNAL_ERROR")
      await this.audit
        .write({
          actorId,
          action: "cleanup_retry_requested",
          targetType: "maintenance_job",
          targetId: jobId,
          result: "rejected",
          metadata: { reason_code: appError.code },
          ...context,
        })
        .catch(() => undefined)
      throw appError
    }
  }

  async retryAllCleanupFailures(
    actorId: string,
    context: AuditContext,
  ): Promise<{
    code: "CLEANUP_BULK_RETRY_REQUESTED"
    requested_count: number
    rejected_count: number
  }> {
    try {
      const result = await this.jobs.retryAllFailedCleanupJobs(100)
      await this.audit.write({
        actorId,
        action: "cleanup_bulk_retry_requested",
        targetType: "maintenance_job",
        result: "success",
        metadata: {
          requested_count: result.requested,
          rejected_count: result.rejected,
        },
        ...context,
      })
      return {
        code: "CLEANUP_BULK_RETRY_REQUESTED",
        requested_count: result.requested,
        rejected_count: result.rejected,
      }
    } catch {
      await this.audit
        .write({
          actorId,
          action: "cleanup_bulk_retry_requested",
          targetType: "maintenance_job",
          result: "failed",
          metadata: { requested_count: 0, rejected_count: 0 },
          ...context,
        })
        .catch(() => undefined)
      throw new AppError("INTERNAL_ERROR")
    }
  }

  private resolveAuthenticationSettings(): Promise<ResolvedAuthenticationSettings> {
    return this.authenticationSettings
      ? this.authenticationSettings.resolveAll()
      : Promise.resolve(resolveEnvironmentAuthenticationSettings(this.config))
  }
}

async function probe(
  action: () => Promise<unknown>,
  reasonCode: string,
): Promise<{ status: "available" | "unavailable"; reason_code: string | null }> {
  try {
    await action()
    return { status: "available", reason_code: null }
  } catch {
    return { status: "unavailable", reason_code: reasonCode }
  }
}

async function probeValue<T>(
  action: () => Promise<T>,
  reasonCode: string,
): Promise<{
  status: "available" | "unavailable"
  reason_code: string | null
  value?: T
}> {
  try {
    return { status: "available", reason_code: null, value: await action() }
  } catch {
    return { status: "unavailable", reason_code: reasonCode }
  }
}

function availableComponent(): {
  status: "available"
  reason_code: null
} {
  return { status: "available", reason_code: null }
}

function unavailableComponent(reasonCode: string): {
  status: "unavailable"
  reason_code: string
} {
  return { status: "unavailable", reason_code: reasonCode }
}

async function probeWritableDirectory(directory: string): Promise<void> {
  await mkdir(directory, { recursive: true })
  await access(directory, constants.R_OK | constants.W_OK)
}

function withTime<T extends { status: string; reason_code: string | null }>(
  value: T,
  checkedAt: string,
) {
  return { ...value, checked_at: checkedAt }
}

function recoveryComponent(
  recoveryProbe: {
    status: "available" | "unavailable"
    reason_code: string | null
    value?: RunningTurnRecoveryStatus
  },
  checkedAt: string,
) {
  if (recoveryProbe.status === "unavailable") {
    return {
      status: "unavailable" as const,
      checked_at: checkedAt,
      reason_code:
        recoveryProbe.reason_code ?? "RUNNING_TURN_RECOVERY_STATUS_UNAVAILABLE",
    }
  }
  const recovery = recoveryProbe.value
  if (!recovery || recovery.outcome === "not_started") {
    return {
      status: "not_observed" as const,
      checked_at: checkedAt,
      reason_code: "RUNNING_TURN_RECOVERY_NOT_OBSERVED",
    }
  }
  if (recovery.outcome === "running") {
    return {
      status: isRunningTurnCapacityReady(recovery)
        ? ("warning" as const)
        : ("not_observed" as const),
      checked_at: checkedAt,
      reason_code: "RUNNING_TURN_RECOVERY_IN_PROGRESS",
      last_attempt_at: recovery.last_attempt_at,
      last_success_at: recovery.last_success_at,
      last_failure_at: recovery.last_failure_at,
    }
  }
  return {
    status: recovery.outcome === "failed"
      ? ("unavailable" as const)
      : ("available" as const),
    checked_at: checkedAt,
    reason_code: recovery.reason_code,
    last_attempt_at: recovery.last_attempt_at,
    last_success_at: recovery.last_success_at,
    last_failure_at: recovery.last_failure_at,
  }
}

function mapConfigStatus(status: "configured" | "invalid" | "not_configured") {
  return status === "configured"
    ? "available"
    : status === "not_configured"
      ? "not_configured"
      : "unavailable"
}

function productSettings(raw: Record<string, unknown>): ProductSettings {
  const logoMetadata = productLogoMetadata(raw)
  return {
    organization_display_name: resolveOrganizationDisplayName(
      raw.organization_display_name,
    ),
    default_locale: isLocale(raw.default_locale) ? raw.default_locale : "zh-CN",
    logo_url: productLogoUrl(logoMetadata),
    logo_updated_at: logoMetadata?.updatedAt ?? null,
  }
}

export function executionConcurrencySettings(
  raw: Record<string, unknown>,
  environmentDefaults: ResolvedExecutionConcurrencySettings,
): ExecutionConcurrencySettings {
  const concurrency = asObject(raw[EXECUTION_CONCURRENCY_SETTING_KEY])
  const maxConcurrentConversations = positiveSafeInteger(
    concurrency.max_concurrent_conversations,
  )
  const runnerAppServerProcessLimit = positiveSafeInteger(
    concurrency.runner_app_server_process_limit,
  )
  return {
    max_concurrent_conversations: maxConcurrentConversations,
    runner_app_server_process_limit: runnerAppServerProcessLimit,
    environment_defaults: environmentDefaults,
    effective: {
      max_concurrent_conversations:
        maxConcurrentConversations ??
        environmentDefaults.max_concurrent_conversations,
      runner_app_server_process_limit:
        runnerAppServerProcessLimit ??
        environmentDefaults.runner_app_server_process_limit,
    },
  }
}

function positiveSafeInteger(value: unknown): number | null {
  return typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value > 0
    ? value
    : null
}

export function registrationSettings(
  raw: Record<string, unknown>,
): RegistrationSettings {
  const registration = asObject(raw.self_registration)
  return {
    enabled: registration.enabled === true,
  }
}

function registrationAvailability(raw: Record<string, unknown>) {
  return { enabled: registrationSettings(raw).enabled }
}

function productLogoMetadata(
  raw: Record<string, unknown>,
): ProductLogoMetadata | null {
  const logo = asObject(raw[PRODUCT_LOGO_SETTING_KEY])
  const objectKey =
    typeof logo.object_key === "string" &&
    logo.object_key.startsWith(`${PRODUCT_LOGO_OBJECT_PREFIX}/`)
      ? logo.object_key
      : null
  const contentType =
    typeof logo.content_type === "string" &&
    logo.content_type in PRODUCT_LOGO_EXTENSIONS
      ? (logo.content_type as SafeRasterImageMimeType)
      : null
  const updatedAt = validTimestamp(logo.updated_at)
  if (!objectKey || !contentType || !updatedAt) return null
  return { objectKey, contentType, updatedAt }
}

function productLogoUrl(metadata: ProductLogoMetadata | null): string | null {
  if (!metadata) return null
  return `/api/v1/system/logo?v=${encodeURIComponent(metadata.updatedAt)}`
}

export function maintenanceStatus(
  raw: Record<string, unknown>,
  now: Date,
): MaintenanceState {
  const maintenance = asObject(raw.maintenance)
  const enabled = maintenance.enabled === true
  const reason =
    typeof maintenance.reason === "string" && maintenance.reason.trim()
      ? maintenance.reason.trim().slice(0, 1_000)
      : null
  const startAt = validTimestamp(maintenance.start_at)
  const endAt = validTimestamp(maintenance.end_at)
  const currentTime = now.getTime()
  const active =
    enabled &&
    startAt !== null &&
    endAt !== null &&
    Date.parse(startAt) <= currentTime &&
    currentTime < Date.parse(endAt)

  return maintenanceStateSchema.parse({
    maintenance_id: maintenance.maintenance_id ?? null,
    enabled,
    active,
    reason,
    start_at: startAt,
    end_at: endAt,
  })
}

function isMaintenanceExpired(raw: Record<string, unknown>, now: Date): boolean {
  const maintenance = asObject(raw.maintenance)
  const endAt = validTimestamp(maintenance.end_at)
  return maintenance.enabled === true && endAt !== null && Date.parse(endAt) <= now.getTime()
}

function validTimestamp(value: unknown): string | null {
  if (typeof value !== "string") return null
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null
}

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

function sanitizeMetadataValue(value: string): string {
  return value.replace(/[\r\n]/g, " ").slice(0, 200)
}

async function streamToBuffer(
  stream: Readable,
  maximumBytes: number,
): Promise<Buffer> {
  const chunks: Buffer[] = []
  let total = 0
  for await (const chunk of stream) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    total += bytes.byteLength
    chunks.push(bytes)
    if (total >= maximumBytes) break
  }
  return Buffer.concat(chunks, Math.min(total, maximumBytes)).subarray(
    0,
    maximumBytes,
  )
}
