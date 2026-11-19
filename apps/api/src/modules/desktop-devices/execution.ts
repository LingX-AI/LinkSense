import { DESKTOP_MODEL_PROXY_PATH, desktopArtifactMaxBytes, supportsDesktopUserInput, webBundleManifestSchema, type DesktopExecutionCommand } from "@linksense/shared";
import type { FastifyInstance } from "fastify";
import { DesktopDeviceTransport } from "../../adapters/desktop-device-transport.js";
import { DesktopRunner } from "../../adapters/desktop-runner.js";
import { AppError } from "../../lib/errors.js";
import type { AppServices } from "../../services.js";
import type { ConnectionService } from "../connections/service.js";
import { isDesktopRunActive, lockDesktopArtifactPublication, lockDesktopConversation } from "../desktop-credentials/run-authority.js";
import type { DesktopRunLeases } from "../desktop-credentials/run-leases.js";
import { registerDesktopArtifactRoutes } from "../files/desktop-artifact-routes.js";
import { DesktopArtifacts } from "../files/desktop-artifacts.js";
import { DesktopAttachments } from "../files/desktop-attachments.js";
import { registerDesktopAttachmentRoute } from "../files/desktop-attachment-route.js";
import { reserveDesktopArtifactSlot, reserveDesktopAttachmentSlot } from "../files/desktop-attachment-slots.js";
import { desktopModelProxyRoutes } from "../model-proxy/routes.js";
import type { RedisDesktopDeviceCoordinator } from "./coordinator.js";
import { registerDesktopBrowserScreenshotRoute, type DesktopBrowserUse } from "./browser-use.js";
import { assertDesktopKnowledgeAssetCurrent } from "./knowledge-publication.js";
import { executeDesktopTool } from "./tool-requests.js";

type ExecutionServices = Pick<AppServices,
  "config" | "redis" | "prisma" | "runner" | "conversations" | "events" |
  "modelProviderSettings" | "creditLimits" | "privacyMaskingSettings" | "webSearchSettings" | "audit" | "knowledgeSearch"
  | "storage"
> & { files: Pick<AppServices["files"], "registerVerifiedDesktopArtifact">; jobs: Pick<AppServices["jobs"], "enqueueDesktopArtifactCleanup" | "enqueueDesktopWebsiteCleanup"> };

export async function registerDesktopExecution(
  app: FastifyInstance,
  services: ExecutionServices & {
    connections?: Pick<ConnectionService, "executeScoped">;
    browserUse?: DesktopBrowserUse;
  },
  coordinator: RedisDesktopDeviceCoordinator,
  leases: DesktopRunLeases,
): Promise<DesktopDeviceTransport | undefined> {
  const { config, prisma, redis } = services;
  if (!config.desktopLocalExecutionEnabled) return undefined;
  const attachments = new DesktopAttachments(prisma, config);
  const canPublishArtifact = async (db: Pick<typeof prisma, "$queryRaw">, scope: Parameters<typeof isDesktopRunActive>[2]) =>
    !await leases.isArtifactPublicationPaused(scope.turnId) && await isDesktopRunActive(db, coordinator, scope, "artifact");
  const artifacts = config.desktopArtifactsEnabled ? new DesktopArtifacts({
    redis: redis.client,
    storage: services.storage,
    maximumBytes: Math.min(config.upload.maxFileSizeBytes, desktopArtifactMaxBytes),
    scratchRoot: config.capabilityRoot,
    running: scope => canPublishArtifact(prisma, scope),
    committed: async ({ ownerId, conversationId, turnId }, artifactId, website) => {
      const file = await prisma.conversationFile.findFirst({
        where: { id: artifactId, conversationId, turnId, kind: "artifact", status: "registered" },
        select: { sizeBytes: true, checksumSha256: true },
      });
      if (!file) return null;
      const snapshot = website ? await prisma.webArtifactBundle.findFirst({
        where: { fileId: artifactId, ownerId, conversationId },
        select: { manifestJson: true },
      }) : null;
      const manifest = webBundleManifestSchema.safeParse(snapshot?.manifestJson);
      return {
        size_bytes: Number(file.sizeBytes), sha256: file.checksumSha256 ?? "",
        ...(manifest.success && { webBundle: manifest.data }),
      };
    },
    register: (input, fence) => services.files.registerVerifiedDesktopArtifact(input, fence),
    reserveTransfer: () => reserveDesktopArtifactSlot(redis.client),
    scheduleCleanup: async (conversationId, artifactId, expiresAt, partCount) => {
      // An admitted upload can still be writing when the signed form expires.
      const delay = Math.max(0, expiresAt - Date.now()) + 5 * 60_000;
      await services.jobs.enqueueDesktopArtifactCleanup(conversationId, artifactId, delay, partCount);
    },
    scheduleWebsiteCleanup: (conversationId, artifactId, paths, expiresAt) =>
      services.jobs.enqueueDesktopWebsiteCleanup(conversationId, artifactId, paths, Math.max(0, expiresAt - Date.now()) + 5 * 60_000),
  }) : undefined;
  const turnScope = (frame: Pick<DesktopExecutionCommand, "conversation_id" | "turn_id" | "runtime_generation">) => ({
    conversationId: frame.conversation_id,
    turnId: frame.turn_id,
    runtimeGeneration: frame.runtime_generation,
  });
  const transport = new DesktopDeviceTransport(redis.client, (binding, command) => {
    const scope = {
      deviceId: binding.deviceId, connectionId: binding.connectionId, ownerId: command.owner_id, ...turnScope(command),
    };
    return command.operation === "user-input.respond"
      ? leases.isActiveToolScope(scope)
      : isDesktopRunActive(prisma, coordinator, scope, command.operation === "turn.start" ? "issue" : "settle");
  },
    app.log, { masterKey: config.credentialMasterKey, keyId: config.credentialKeyId },
    async ({ ownerId, toolOperations, ...binding }, frame, signal) => {
      const scope = { ownerId, deviceId: binding.deviceId, connectionId: binding.connectionId, ...turnScope(frame) };
      if (frame.type === "tool.request") {
        return executeDesktopTool({
          leases, ...(artifacts && { artifacts }), audit: services.audit,
          webSearchSettings: services.webSearchSettings, knowledgeSearch: services.knowledgeSearch,
          ...(services.connections ? { connections: services.connections } : {}),
          ...(services.browserUse ? { browserUse: services.browserUse } : {}),
          checkPublication: async (tx, source) => {
            signal.throwIfAborted();
            await assertDesktopKnowledgeAssetCurrent(prisma, tx, scope, source);
            if (!await isDesktopRunActive(tx, coordinator, scope, "use")) throw new AppError("FORBIDDEN");
            await leases.fenceRunBinding(scope, frame.run_token);
            signal.throwIfAborted();
          },
        }, scope, frame, signal);
      }
      if (frame.operation === "attachments.ready") {
        await leases.verifyRunBinding(scope, frame.run_token, "use");
        await attachments.ready(scope);
        await leases.verifyRunBinding(scope, frame.run_token, "use");
        signal.throwIfAborted();
        return { type: "execution.ack", id: frame.id, operation: frame.operation, ok: true };
      }
      if (frame.type === "execution.callback") await leases.verifyRunBinding(scope, frame.run_token);
      const check = async () => {
        signal.throwIfAborted();
        if (frame.type === "execution.callback") {
          await leases.fenceRunBinding(scope, frame.run_token);
          if (!await coordinator.isCurrentConnection(scope.deviceId, scope.connectionId)) {
            throw new AppError("FORBIDDEN");
          }
        } else if (!await coordinator.mayDispatch(binding, frame.drain_id)) {
          throw new AppError("FORBIDDEN");
        }
        signal.throwIfAborted();
      };
      await check();
      if (frame.operation === "start.settled") {
        const settled = await services.conversations.settleStartOperation(ownerId, frame.body, {
          connectionId: scope.connectionId, scope, check,
        });
        return { type: "execution.ack", id: frame.id, operation: frame.operation, ok: true, data: { settled } };
      }
      if (frame.operation === "turn.exited") {
        const { turnId: projectionTurnId, ...binding } = scope;
        await services.events.scheduleDesktopRecovery({ ...binding, projectionTurnId });
        return { type: "execution.ack", id: frame.id, operation: frame.operation, ok: true };
      }
      const questions = frame.type === "execution.callback" && supportsDesktopUserInput(toolOperations);
      const accepted = await services.events.ingestDesktopBatch({ scope, check, questions }, frame.body, (error, deliveryId) => {
        app.log.warn({ deliveryId, errorCode: error instanceof AppError ? error.code : "INTERNAL_ERROR" }, "desktop event batch stopped before acknowledgement");
      });
      return { type: "execution.ack", id: frame.id, operation: frame.operation, ok: true, data: { accepted_delivery_ids: accepted } };
    },
  );
  services.runner.useDesktopRunner(new DesktopRunner(({ ownerId, conversationId }) => prisma.conversation.findFirst({
    where: { id: conversationId, ownerId, archiveStatus: "active", executionTarget: "local" },
    select: { desktopDeviceId: true, runtimeGeneration: true },
  }), transport, leases, ({ turnId: projectionTurnId, ...scope }, expiresAt) =>
    services.events.scheduleDesktopRecovery({ ...scope, projectionTurnId, expiresAt }), attachments,
  artifacts ? async turnId => {
    const release = await prisma.$transaction(async tx => {
      await lockDesktopArtifactPublication(tx, turnId);
      return leases.pauseArtifactPublication(turnId);
    });
    return async () => {
      await release().catch(() => app.log.warn({ turnId }, "desktop artifact pause could not be released"));
    };
  } : undefined));
  registerDesktopAttachmentRoute(app, attachments, leases, () => reserveDesktopAttachmentSlot(redis.client), async (scope, commandId) => {
    const binding = await coordinator.executionConnection(scope.deviceId);
    if (binding?.connectionId !== scope.connectionId || !await coordinator.mayDispatch(binding, commandId)) {
      throw new AppError("FORBIDDEN");
    }
  });
  if (artifacts) await app.register(registerDesktopArtifactRoutes, {
    artifacts, leases,
    checkPublication: async (tx, scope) => {
      await lockDesktopConversation(tx, scope);
      await lockDesktopArtifactPublication(tx, scope.turnId);
      await tx.$queryRaw`SELECT id FROM conversation_turns WHERE id = ${scope.turnId}::uuid FOR SHARE`;
      if (!await canPublishArtifact(tx, scope)) throw new AppError("FORBIDDEN");
    },
  });
  await app.register(desktopModelProxyRoutes, {
    prefix: DESKTOP_MODEL_PROXY_PATH,
    leases,
    settings: services.modelProviderSettings,
    creditLimits: services.creditLimits,
    privacyMasking: services.privacyMaskingSettings,
    redis: redis.client,
    rateLimitSecret: config.loginRateLimitHmacSecret,
  });
  if (services.browserUse) registerDesktopBrowserScreenshotRoute(app, services.browserUse, leases);
  return transport;
}
