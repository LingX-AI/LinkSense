import { DESKTOP_MODEL_PROXY_PATH, type DesktopExecutionCommand } from "@linksense/shared";
import type { FastifyInstance } from "fastify";
import { DesktopDeviceTransport } from "../../adapters/desktop-device-transport.js";
import { DesktopRunner } from "../../adapters/desktop-runner.js";
import { AppError } from "../../lib/errors.js";
import type { AppServices } from "../../services.js";
import { isDesktopRunActive } from "../desktop-credentials/run-authority.js";
import { DesktopRunLeases } from "../desktop-credentials/run-leases.js";
import { desktopModelProxyRoutes } from "../model-proxy/routes.js";
import type { RedisDesktopDeviceCoordinator } from "./coordinator.js";

type ExecutionServices = Pick<AppServices,
  "config" | "redis" | "prisma" | "runner" | "conversations" | "events" |
  "modelProviderSettings" | "creditLimits" | "privacyMaskingSettings"
>;

export async function registerDesktopExecution(
  app: FastifyInstance,
  services: ExecutionServices,
  coordinator: RedisDesktopDeviceCoordinator,
): Promise<DesktopDeviceTransport | undefined> {
  const { config, prisma, redis } = services;
  if (!config.desktopLocalExecutionEnabled) return undefined;
  const leases = new DesktopRunLeases(redis.client, (scope, phase) => isDesktopRunActive(prisma, coordinator, scope, phase));
  const turnScope = (frame: Pick<DesktopExecutionCommand, "conversation_id" | "turn_id" | "runtime_generation">) => ({
    conversationId: frame.conversation_id,
    turnId: frame.turn_id,
    runtimeGeneration: frame.runtime_generation,
  });
  const transport = new DesktopDeviceTransport(redis.client, (binding, command) =>
    isDesktopRunActive(prisma, coordinator, {
      ...binding, ownerId: command.owner_id, ...turnScope(command),
    }, command.operation === "turn.start" ? "issue" : "settle"),
    app.log, { masterKey: config.credentialMasterKey, keyId: config.credentialKeyId },
    async ({ ownerId, ...binding }, frame, signal) => {
      const scope = { ownerId, deviceId: binding.deviceId, connectionId: binding.connectionId, ...turnScope(frame) };
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
      const accepted = await services.events.ingestDesktopBatch({ scope, check }, frame.body, (error, deliveryId) => {
        app.log.warn({ deliveryId, errorCode: error instanceof AppError ? error.code : "INTERNAL_ERROR" }, "desktop event batch stopped before acknowledgement");
      });
      return { type: "execution.ack", id: frame.id, operation: frame.operation, ok: true, data: { accepted_delivery_ids: accepted } };
    },
  );
  services.runner.useDesktopRunner(new DesktopRunner(({ ownerId, conversationId }) => prisma.conversation.findFirst({
    where: { id: conversationId, ownerId, archiveStatus: "active", executionTarget: "local" },
    select: { desktopDeviceId: true, runtimeGeneration: true },
  }), transport, leases, ({ turnId: projectionTurnId, ...scope }, expiresAt) =>
    services.events.scheduleDesktopRecovery({ ...scope, projectionTurnId, expiresAt })));
  await app.register(desktopModelProxyRoutes, {
    prefix: DESKTOP_MODEL_PROXY_PATH,
    leases,
    settings: services.modelProviderSettings,
    creditLimits: services.creditLimits,
    privacyMasking: services.privacyMaskingSettings,
    redis: redis.client,
    rateLimitSecret: config.loginRateLimitHmacSecret,
  });
  return transport;
}
