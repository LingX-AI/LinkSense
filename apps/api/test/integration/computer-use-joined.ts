import { randomUUID } from "node:crypto";
import Fastify from "fastify";

import { LocalFilesystemObjectStorage } from "../../src/adapters/object-storage.js";
import { LinkSenseRedis } from "../../src/adapters/redis.js";
import { RunnerClient } from "../../src/adapters/runner.js";
import type { PrismaClient } from "../../src/generated/prisma/client.js";
import type { Redis } from "ioredis";
import { sendAppError } from "../../src/lib/http.js";
import { AuditService } from "../../src/modules/audit/service.js";
import { ConversationService } from "../../src/modules/conversations/service.js";
import { isDesktopRunActive } from "../../src/modules/desktop-credentials/run-authority.js";
import { DesktopRunLeases } from "../../src/modules/desktop-credentials/run-leases.js";
import { DesktopComputerExecuteFixture, desktopComputerFixtureBindingKey, type DesktopComputerExecuteFactory } from "../../src/modules/desktop-devices/computer-execute.js";
import { RedisDesktopDeviceCoordinator } from "../../src/modules/desktop-devices/coordinator.js";
import { registerDesktopExecution } from "../../src/modules/desktop-devices/execution.js";
import { PrismaDesktopDeviceRepository } from "../../src/modules/desktop-devices/repository.js";
import { registerDesktopDeviceRoutes } from "../../src/modules/desktop-devices/routes.js";
import { DesktopDeviceService } from "../../src/modules/desktop-devices/service.js";
import { ConversationEventService } from "../../src/modules/events/service.js";
import { localComputerGuiOccupancyKey } from "../../src/modules/local-computer/occupancy.js";
import { LocalComputerService } from "../../src/modules/local-computer/service.js";
import { PrivacyMaskingSettingsService } from "../../src/modules/privacy-masking/service.js";
import { ModelProviderSettingsService } from "../../src/modules/system/model-provider-settings.js";
import { WebSearchSettingsService } from "../../src/modules/system/web-search-settings.js";
import { CreditLimitService } from "../../src/modules/usage/credit-limit.js";
import { UsageAnalyticsService } from "../../src/modules/usage/service.js";
import { testConfig } from "../test-config.js";

const outsideFixture = async (): Promise<never> => {
  throw new Error("Unexpected cloud, connector, browser, or artifact call in the joined fixture");
};

/**
 * The API half of the joined Mac Computer Use fixture.
 *
 * It is the real Fastify device-socket route plus the real
 * `registerDesktopExecution` transport and the real fixture-only
 * `computer.execute` interceptor. PostgreSQL authorization, Redis lease
 * fencing, GUI occupancy, native-call claims, and the authenticated device
 * WebSocket are all the production implementations; only the host selection,
 * grants, and synthetic Mac executor are test data.
 */
export async function startJoinedComputerApi(input: {
  prisma: PrismaClient;
  redisClient: Redis;
  databaseUrl: string;
  workspaceRoot: string;
  ownerId: string;
  deviceId: string;
  conversationId: string;
  runtimeGeneration: string;
  turnId: string;
  sessionId: string;
  selectionId: string;
  bundleId: string;
}): Promise<{
  origin: string;
  coordinator: RedisDesktopDeviceCoordinator;
  leases: DesktopRunLeases;
  redisClient: LinkSenseRedis["client"];
  fixture: () => DesktopComputerExecuteFixture | undefined;
  occupancyKey: string;
  bindingKey: (scope: Parameters<typeof desktopComputerFixtureBindingKey>[0]) => string;
  sessionExpiresAt: number;
  close(): Promise<void>;
}> {
  const config = testConfig({
    DATABASE_URL: input.databaseUrl,
    LINKSENSE_USER_DATA_ROOT: input.workspaceRoot,
    LINKSENSE_RUNNER_URL: "http://127.0.0.1:1",
    LINKSENSE_DESKTOP_LOCAL_EXECUTION_ENABLED: "true",
  });
  const redis = new LinkSenseRedis(config, input.redisClient);
  const coordinator = new RedisDesktopDeviceCoordinator(redis.client);
  const leases = new DesktopRunLeases(redis.client, (scope, phase) =>
    isDesktopRunActive(input.prisma, coordinator, scope, phase));
  const service = new DesktopDeviceService(new PrismaDesktopDeviceRepository(input.prisma), coordinator);
  const audit = new AuditService(input.prisma);
  const modelProviderSettings = new ModelProviderSettingsService(input.prisma, config);
  const usageAnalytics = new UsageAnalyticsService(input.prisma, { modelCatalog: modelProviderSettings });
  const creditLimits = new CreditLimitService(input.prisma, { timeZone: config.billingTimeZone });
  const privacyMaskingSettings = new PrivacyMaskingSettingsService(input.prisma, config);
  const webSearchSettings = new WebSearchSettingsService(input.prisma, config);
  const runner = new RunnerClient(config, async () => "local");
  const conversations = new ConversationService(
    input.prisma, redis, runner, audit,
    {
      ensureUserHome: outsideFixture, resolve: outsideFixture, resolveRecovery: outsideFixture,
      resolveStartIntentRecovery: outsideFixture, withCapabilityStartBarrier: outsideFixture,
    },
    input.workspaceRoot,
    {
      enqueueRuntimeCleanup: outsideFixture, enqueueConversationPrewarm: outsideFixture,
      enqueueFormRecommendation: outsideFixture,
    },
    undefined, modelProviderSettings, undefined, creditLimits,
  );
  const events = new ConversationEventService(input.prisma, redis, conversations);
  const storage = new LocalFilesystemObjectStorage({
    ...config,
    objectStorage: { ...config.objectStorage, provider: "local-filesystem", localRoot: input.workspaceRoot },
  });

  // Grants come from the production service; the IDs are fixture-generated only.
  const user = await input.prisma.user.findUniqueOrThrow({
    where: { id: input.ownerId },
    select: { email: true, name: true, role: true, status: true, preferredLocale: true, avatarObjectKey: true, authValidAfter: true },
  });
  const localComputer = new LocalComputerService(input.prisma);
  const actor = { id: input.ownerId, authValidAfter: user.authValidAfter };
  const started = await localComputer.start(actor, input.conversationId, input.sessionId);
  if (!started.session) throw new Error("joined fixture local computer session did not start");
  for (const capability of ["computer.observe", "computer.act"] as const) {
    await localComputer.changePermission(actor, input.conversationId, {
      action: "grant", session_id: input.sessionId, grant_id: randomUUID(),
      capability, target: { bundle_id: input.bundleId },
    });
  }

  const app = Fastify();
  app.setErrorHandler((error, request, reply) => sendAppError(reply, request, error));
  app.decorate("authenticate", async request => {
    request.authUser = {
      id: input.ownerId, name: user.name, email: user.email,
      role: user.role === "admin" ? "admin" : "user", status: "active",
      preferredLocale: null, avatarObjectKey: user.avatarObjectKey,
      authValidAfter: user.authValidAfter,
    };
  });

  let fixture: DesktopComputerExecuteFixture | undefined;
  const computerExecute: DesktopComputerExecuteFactory = host => {
    fixture = new DesktopComputerExecuteFixture({
      ...host,
      select: () => ({ selectionId: input.selectionId, bundleId: input.bundleId }),
    });
    return fixture;
  };
  const transport = await registerDesktopExecution(app, {
    config, prisma: input.prisma, redis, runner, conversations, events, storage,
    jobs: {
      enqueueDesktopArtifactCleanup: async () => undefined,
      enqueueDesktopWebsiteCleanup: async () => undefined,
    },
    files: { registerVerifiedDesktopArtifact: outsideFixture },
    modelProviderSettings, creditLimits, privacyMaskingSettings, webSearchSettings, audit,
    usageAnalytics, knowledgeSearch: null, computerExecute,
  }, coordinator, leases);
  if (!transport) throw new Error("joined fixture Mac execution must be enabled");
  await registerDesktopDeviceRoutes(app, {
    service, redis: redis.client, rateLimitHmacSecret: config.loginRateLimitHmacSecret,
    execution: transport, computerExecute: true,
  });
  const origin = await app.listen({ host: "127.0.0.1", port: 0 });
  return {
    origin,
    coordinator,
    leases,
    redisClient: redis.client,
    fixture: () => fixture,
    occupancyKey: localComputerGuiOccupancyKey(input.deviceId),
    bindingKey: scope => desktopComputerFixtureBindingKey(scope),
    sessionExpiresAt: Date.parse(started.session.expires_at),
    async close() {
      await app.close();
    },
  };
}
