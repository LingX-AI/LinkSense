import type { FastifyInstance, preHandlerAsyncHookHandler } from "fastify";
import { z } from "zod";
import pino from "pino";
import { publicKnowledgeRunnerInputSchema } from "@linksense/shared";
import type { RunnerConfig } from "../config.js";
import { PublicKnowledgeRuntime } from "./runtime.js";
import type { RunnerEventSink } from "../event-sink.js";
import type { WorkspaceManager } from "../workspace/workspace-manager.js";

export function registerPublicKnowledgeRuntime(
  app: FastifyInstance,
  config: RunnerConfig,
  workspaceManager: WorkspaceManager,
  eventSink: Pick<RunnerEventSink, "publishBatch"> | undefined,
): PublicKnowledgeRuntime {
  const runtime = new PublicKnowledgeRuntime({
    root: config.LINKSENSE_USER_DATA_ROOT,
    command: config.CODEX_BIN,
    logger: pino({ level: process.env.LOG_LEVEL ?? "info" }),
    ...(config.LINKSENSE_RUNNER_MODE === "worker" &&
    config.LINKSENSE_WORKER_PROVIDER !== "local-process"
      ? { processIdentity: { uid: 1001, gid: 1000 } }
      : {}),
  });
  const scope: preHandlerAsyncHookHandler = async (request, reply) => {
    const id = z.uuid().safeParse(request.headers["x-linksense-owner-id"]);
    if (
      !id.success ||
      (config.LINKSENSE_RUNNER_MODE === "worker" &&
        (config.LINKSENSE_WORKER_OWNER_ID !== id.data ||
          config.LINKSENSE_SERVICE_SESSION_ID !== id.data))
    )
      return reply.code(403).send({ error_code: "FORBIDDEN" });
  };
  const owner = (header: unknown): string => z.uuid().parse(header);
  app.post(
    "/public-knowledge/turn",
    { preHandler: scope },
    async (request, reply) => {
      const input = publicKnowledgeRunnerInputSchema.parse(request.body);
      if (
        owner(request.headers["x-linksense-owner-id"]) !== input.applicationId
      )
        return reply.code(403).send({ error_code: "FORBIDDEN" });
      try {
        if (!eventSink)
          return reply.code(503).send({ error_code: "RUNNER_UNAVAILABLE" });
        workspaceManager.bindOwner(input.conversationId, input.applicationId);
        return await runtime.run(input, (events) =>
          eventSink.publishBatch(input.conversationId, events),
        );
      } catch {
        return reply.code(503).send({ error_code: "RUNNER_UNAVAILABLE" });
      }
    },
  );
  const params = z.strictObject({
    conversationId: z.uuid(),
    operationId: z.uuid(),
  });
  const operation =
    "/public-knowledge/conversations/:conversationId/operations/:operationId";
  app.get(operation, { preHandler: scope }, async (request, reply) => {
    const { conversationId, operationId } = params.parse(request.params);
    const applicationId = owner(request.headers["x-linksense-owner-id"]);
    return reply.send({
      result: await runtime.result(applicationId, conversationId, operationId),
    });
  });
  app.post(
    `${operation}/interrupt`,
    { preHandler: scope },
    async (request, reply) => {
      const { conversationId, operationId } = params.parse(request.params);
      await runtime.interrupt(
        owner(request.headers["x-linksense-owner-id"]),
        conversationId,
        operationId,
      );
      return reply.code(204).send();
    },
  );
  app.addHook("onClose", async () => runtime.close());
  return runtime;
}
