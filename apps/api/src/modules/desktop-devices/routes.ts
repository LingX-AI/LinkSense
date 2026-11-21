import type { FastifyInstance } from "fastify";
import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import rateLimit, { normalizeIP } from "@fastify/rate-limit";
import type { Redis } from "ioredis";
import { WebSocket, WebSocketServer } from "ws";
import { z, ZodError } from "zod";
import {
  DESKTOP_APP_VERSION_HEADER,
  DESKTOP_ATTACHMENT_PROTOCOL_HEADER,
  DESKTOP_EXECUTION_PROTOCOL_HEADER,
  DESKTOP_TOOL_PROTOCOL_HEADER,
  DESKTOP_TOOL_OPERATIONS_HEADER,
  desktopDeviceAppVersionSchema,
  desktopDeviceClientFrameSchema,
  desktopDeviceListSchema,
  desktopDevicePairInputSchema,
  desktopDeviceRenameInputSchema,
  desktopDeviceRenameResultSchema,
  desktopAttachmentProtocolVersion,
  desktopExecutionCallbackSchema,
  desktopExecutionDeviceReadySchema,
  desktopExecutionMaxFrameBytes,
  desktopExecutionProtocolVersion,
  desktopExecutionResultSchema,
  desktopProtocolVersion,
  desktopToolCancelSchema,
  desktopNegotiatedOperationSchema,
  desktopToolProtocolVersion,
  type DesktopNegotiatedOperation,
} from "@linksense/shared";
import type { DesktopDeviceTransport } from "../../adapters/desktop-device-transport.js";
import { hmacSha256 } from "../../lib/crypto.js";
import { AppError } from "../../lib/errors.js";
import { ok } from "../../lib/http.js";
import type { DesktopDeviceRecord } from "./repository.js";
import type { DesktopDeviceService } from "./service.js";

const deviceParamsSchema = z.strictObject({ id: z.uuid() });
const revocationCheckIntervalMs = 5_000;

export async function registerDesktopDeviceRoutes(
  app: FastifyInstance,
  options: {
    service: DesktopDeviceService;
    redis: Redis;
    rateLimitHmacSecret: string;
    execution?: DesktopDeviceTransport;
    knowledgeTools?: boolean;
    connectionTools?: boolean;
    browserTools?: boolean;
    nativeApprovals?: boolean;
    artifactTools?: boolean;
    websiteArtifacts?: boolean;
    /** Fixture-only negotiation gate; app.ts never enables it. */
    computerExecute?: boolean;
    onExecutionReady?: (binding: { deviceId: string; ownerId: string; connectionId: string }) => Promise<void>;
  },
): Promise<void> {
  const { service, execution } = options;
  await app.register(async routes => {
    routes.addHook("preHandler", routes.authenticate);
    await routes.register(rateLimit, {
      redis: options.redis, max: 10, timeWindow: "1 minute",
      global: false, hook: "preHandler",
      nameSpace: "linksense:desktop-pairing-create:", skipOnError: false,
      keyGenerator: request => request.authUser!.id,
      errorResponseBuilder: () => new AppError("VALIDATION_ERROR", undefined, 429),
    });
    routes.post("/pairing", { bodyLimit: 1024, config: { rateLimit: { max: 10, timeWindow: "1 minute" } } }, async request => {
      z.strictObject({}).parse(request.body);
      return ok(await service.pairing(request.authUser!.id, request.authUser!.authValidAfter), request.id);
    });
    routes.get("/", async request =>
      ok(desktopDeviceListSchema.parse(await service.list(request.authUser!.id)), request.id));
    routes.patch("/:id", { bodyLimit: 1024 }, async request => {
      const { id } = deviceParamsSchema.parse(request.params);
      const { name } = desktopDeviceRenameInputSchema.parse(request.body);
      return ok(desktopDeviceRenameResultSchema.parse(await service.rename(request.authUser!.id, id, name)), request.id);
    });
    routes.delete("/:id", async request => {
      const { id } = deviceParamsSchema.parse(request.params);
      await service.revoke(request.authUser!.id, id);
      return ok({ revoked: true }, request.id);
    });
  }, { prefix: "/api/v1/desktop/devices" });

  await app.register(async routes => {
    await routes.register(rateLimit, {
      redis: options.redis, max: 10, timeWindow: "1 minute",
      nameSpace: "linksense:desktop-pair-exchange:", skipOnError: false,
      keyGenerator: request => hmacSha256(options.rateLimitHmacSecret, "desktop-pair:ip:", normalizeIP(request.ip)),
      errorResponseBuilder: () => new AppError("VALIDATION_ERROR", undefined, 429),
    });
    routes.post("/api/v1/desktop/devices/pair", { bodyLimit: 4096 }, async request =>
      ok(await service.pair(desktopDevicePairInputSchema.parse(request.body)), request.id));
  });

  const presenceMaxFrameBytes = 8192;
  const server = new WebSocketServer({
    noServer: true, maxPayload: execution ? desktopExecutionMaxFrameBytes : presenceMaxFrameBytes, perMessageDeflate: false,
  });
  const connected = new Map<WebSocket, {
    device: DesktopDeviceRecord; connectionId: string; execution: boolean; tools: readonly DesktopNegotiatedOperation[]; detach?: () => void;
  }>();
  const backgroundWork = new Set<Promise<void>>();
  let subscription: Promise<() => void> | null = null;
  let subscriptionGeneration = 0;
  let closing = false;
  let revocationCheck: Promise<void> | null = null;
  const revocations = setInterval(() => {
    if (closing || revocationCheck || connected.size === 0) return;
    const connections = [...connected];
    const ids = [...new Set(connections.map(([, current]) => current.device.id))];
    revocationCheck = service.revokedIds(ids).then(revoked => {
      for (const [socket, current] of connections) {
        if (revoked.has(current.device.id)) socket.close(4403);
      }
    }).catch(() => {
      app.log.warn("desktop device revocation check unavailable");
      for (const [socket] of connections) socket.close(4500);
    }).finally(() => { revocationCheck = null; });
  }, revocationCheckIntervalMs);
  revocations.unref();
  const ensureSubscription = async () => {
    if (closing) return Promise.reject(new Error("desktop device gateway is closing"));
    if (!subscription) {
      const generation = ++subscriptionGeneration;
      subscription = service.coordinator.subscribe(notice => {
        if (notice.type === "run_revoked") {
          execution?.cancelRunTools(notice.turnId);
          return;
        }
        for (const [socket, current] of connected) {
          if (current.device.id === notice.deviceId &&
            (notice.type === "revoked" || current.connectionId === notice.supersededConnectionId)) {
            socket.close(notice.type === "revoked" ? 4403 : 4409);
          }
        }
      }, () => {
        if (generation === subscriptionGeneration) {
          subscriptionGeneration++;
          subscription = null;
          for (const socket of server.clients) socket.close(4500);
        }
      }).catch((error: unknown) => {
        if (generation === subscriptionGeneration) {
          subscriptionGeneration++;
          subscription = null;
        }
        throw error;
      });
    }
    const current = subscription;
    const generation = subscriptionGeneration;
    const close = await current;
    if (subscription !== current || subscriptionGeneration !== generation || closing) {
      throw new Error("desktop device subscription is unavailable");
    }
    return close;
  };
  const upgrade = (request: IncomingMessage, socket: Duplex, head: Buffer) => {
    if (request.url?.split("?")[0] !== "/api/v1/desktop/devices/socket") return;
    if (closing || request.headers.origin || request.url.includes("?") || server.clients.size >= 1000) {
      socket.destroy();
      return;
    }
    server.handleUpgrade(request, socket, head, ws => server.emit("connection", ws, request));
  };
  app.server.on("upgrade", upgrade);
  server.on("connection", (socket, request: IncomingMessage) => {
    // Malformed or duplicated metadata is ignored; it never denies the upgrade.
    const reportedAppVersion = desktopDeviceAppVersionSchema.safeParse(request.headers[DESKTOP_APP_VERSION_HEADER]);
    const supportsExecution = execution !== undefined &&
      request.headers[DESKTOP_EXECUTION_PROTOCOL_HEADER] === String(desktopExecutionProtocolVersion);
    const supportsAttachments = supportsExecution &&
      request.headers[DESKTOP_ATTACHMENT_PROTOCOL_HEADER] === String(desktopAttachmentProtocolVersion);
    const supportsTools = supportsExecution &&
      request.headers[DESKTOP_TOOL_PROTOCOL_HEADER] === String(desktopToolProtocolVersion);
    const toolOffer = request.headers[DESKTOP_TOOL_OPERATIONS_HEADER];
    const offered = typeof toolOffer === "string" ? new Set(toolOffer.split(",")) : undefined;
    const tools = !supportsTools ? [] : !offered ? ["web.search"] as const
      : desktopNegotiatedOperationSchema.options.filter(operation => offered.has(operation) &&
        (operation === "web.search" ||
          (operation === "approval.respond" ? options.nativeApprovals
            : operation === "connection.execute" ? options.connectionTools
            : operation === "browser.execute" ? options.browserTools
            : operation === "artifact.prepare" || operation === "artifact.multipart"
              ? options.artifactTools && offered.has("artifact.prepare")
              : operation === "artifact.website"
                ? options.artifactTools && options.websiteArtifacts === true && offered.has("artifact.prepare")
                : operation === "computer.execute"
                  ? options.computerExecute === true
                  : options.knowledgeTools)));
    let handling = false;
    let lastPing = Date.now();
    const authDeadline = setTimeout(() => socket.close(4401), 5000);
    const heartbeat = setInterval(() => {
      if (Date.now() - lastPing > 45_000) socket.close(4408);
    }, 15_000);
    heartbeat.unref();
    const handle = async (raw: string) => {
      const current = connected.get(socket);
      const value: unknown = JSON.parse(raw);
      if (current?.execution) {
        const result = desktopExecutionResultSchema.safeParse(value);
        if (result.success) {
          await execution?.receive(current.connectionId, result.data);
          return;
        }
        const callback = desktopExecutionCallbackSchema.safeParse(value);
        if (callback.success) {
          if (callback.data.type === "tool.request" && !current.tools.includes(callback.data.operation)) { socket.close(4400); return; }
          if (callback.data.operation === "attachments.ready" && !supportsAttachments) { socket.close(4400); return; }
          await execution?.receiveCallback(current.connectionId, callback.data);
          return;
        }
        const cancel = desktopToolCancelSchema.safeParse(value);
        if (cancel.success && current.tools.includes(cancel.data.operation)) {
          execution?.cancelTool(current.connectionId, cancel.data);
          return;
        }
      }
      if (handling) { socket.close(4400); return; }
      handling = true;
      try {
        const frame = desktopDeviceClientFrameSchema.parse(value);
        if (!current) {
          if (frame.type !== "hello") { socket.close(4401); return; }
          await ensureSubscription();
          const device = await service.authenticate(frame.token);
          if (!device) { socket.close(4401); return; }
          const connectionId = await service.connect(device);
          const state: NonNullable<ReturnType<typeof connected.get>> = {
            device, connectionId, execution: supportsExecution && device.platform === "darwin",
            tools: device.platform === "darwin" ? tools : [],
          };
          connected.set(socket, state);
          const active = await service.maintain(device, connectionId);
          if (socket.readyState !== WebSocket.OPEN || active !== "online") {
            socket.close(active === "revoked" ? 4403 : active === "replaced" ? 4409 : 4500);
            await service.coordinator.disconnect(device.id, connectionId);
            connected.delete(socket);
            return;
          }
          const ready = {
            type: "ready", device_id: device.id, connection_id: connectionId,
            protocol_version: desktopProtocolVersion, heartbeat_interval_ms: 15_000,
          };
          let readySent = false;
          if (state.execution && execution) {
            const detach = await execution.attach({
              ownerId: device.ownerId, deviceId: device.id, connectionId,
              attachments: supportsAttachments,
              toolOperations: state.tools,
              verifyCredential: () => service.hasCurrentCredential(device),
              send: frame => {
                if (!readySent || socket.readyState !== WebSocket.OPEN || socket.bufferedAmount >= desktopExecutionMaxFrameBytes) return false;
                socket.send(JSON.stringify(frame), error => { if (error) socket.terminate(); });
                return true;
              },
              close: () => socket.terminate(),
            });
            if (socket.readyState !== WebSocket.OPEN || !detach) {
              detach?.();
              socket.close(4500);
              return;
            }
            state.detach = detach;
          }
          clearTimeout(authDeadline);
          socket.send(JSON.stringify(state.execution ? desktopExecutionDeviceReadySchema.parse({
            ...ready, execution_protocol_version: desktopExecutionProtocolVersion,
            ...(supportsAttachments ? { attachment_protocol_version: desktopAttachmentProtocolVersion } : {}),
            ...(state.tools.length ? {
              tool_protocol_version: desktopToolProtocolVersion,
              ...(offered ? { tool_operations: state.tools } : {}),
            } : {}),
          }) : ready));
          readySent = true;
          if (reportedAppVersion.success) {
            // Descriptive metadata only; readiness and the message handler must not wait for it.
            const refresh = service.refreshAppVersion(device, connectionId, reportedAppVersion.data)
              .catch(() => app.log.warn("desktop app version refresh failed"))
              .finally(() => { backgroundWork.delete(refresh); });
            backgroundWork.add(refresh);
          }
          if (state.execution && options.onExecutionReady) {
            const enqueue = options.onExecutionReady({ deviceId: device.id, ownerId: device.ownerId, connectionId })
              .catch(() => {
                app.log.warn({ deviceId: device.id }, "desktop reconnect recovery could not be queued");
                socket.terminate();
              })
              .finally(() => { backgroundWork.delete(enqueue); });
            backgroundWork.add(enqueue);
          }
          return;
        }
        if (frame.type !== "ping") {
          socket.close(4400);
          return;
        }
        const state = await service.maintain(current.device, current.connectionId);
        if (state !== "online") {
          socket.close(state === "revoked" ? 4403 : state === "replaced" ? 4409 : 4500);
          return;
        }
        lastPing = Date.now();
        socket.send(JSON.stringify({ type: "pong" }));
      } finally {
        handling = false;
      }
    };
    socket.on("message", (data, isBinary) => {
      if (isBinary || !Buffer.isBuffer(data)) {
        socket.terminate();
        return;
      }
      if (!connected.get(socket)?.execution && data.length > presenceMaxFrameBytes) {
        socket.close(1009);
        return;
      }
      void handle(data.toString()).catch((error: unknown) => {
        socket.close(error instanceof ZodError || error instanceof SyntaxError ? 4400 : 4500);
      });
    });
    socket.on("error", () => socket.close());
    socket.on("close", () => {
      clearTimeout(authDeadline);
      clearInterval(heartbeat);
      const current = connected.get(socket);
      connected.delete(socket);
      current?.detach?.();
      if (current) void service.coordinator.disconnect(current.device.id, current.connectionId)
        .catch(() => app.log.warn("desktop device disconnect cleanup failed"));
    });
  });
  app.addHook("preClose", async () => {
    closing = true;
    clearInterval(revocations);
    app.server.off("upgrade", upgrade);
    for (const socket of server.clients) socket.terminate();
    await new Promise<void>(resolve => server.close(() => resolve()));
    await revocationCheck;
    await Promise.all(backgroundWork);
    const unsubscribe = await subscription?.catch(() => undefined);
    unsubscribe?.();
    await execution?.close();
  });
}
