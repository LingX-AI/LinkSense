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
  DESKTOP_COMPUTER_STATUS_HEADER,
  DESKTOP_CONVERSATION_REFERENCE_PROTOCOL_HEADER,
  DESKTOP_EXECUTION_PROTOCOL_HEADER,
  DESKTOP_TOOL_PROTOCOL_HEADER,
  DESKTOP_TOOL_OPERATIONS_HEADER,
  desktopDeviceAppVersionSchema,
  desktopDeviceClientFrameSchema,
  desktopDeviceListSchema,
  desktopDevicePairInputSchema,
  desktopDeviceRegisterInputSchema,
  desktopDeviceRenameInputSchema,
  desktopDeviceRenameResultSchema,
  desktopAttachmentProtocolVersion,
  desktopComputerControlResultSchema,
  desktopComputerControlSchema,
  desktopComputerStatusProtocolVersion,
  desktopConversationReferenceProtocolVersion,
  desktopExecutionCallbackSchema,
  desktopExecutionDeviceReadySchema,
  desktopExecutionMaxFrameBytes,
  desktopExecutionProtocolVersion,
  desktopModelSwitchOperation,
  desktopExecutionResultSchema,
  desktopProtocolVersion,
  desktopToolCancelSchema,
  desktopNegotiatedOperationSchema,
  desktopComputerExecuteOperation,
  desktopComputerWaitOperation,
  desktopConversationReferenceReadOperation,
  desktopToolProtocolVersion,
  type DesktopNegotiatedOperation,
} from "@linksense/shared";
import type { DesktopDeviceTransport } from "../../adapters/desktop-device-transport.js";
import { hmacSha256 } from "../../lib/crypto.js";
import { AppError } from "../../lib/errors.js";
import { ok } from "../../lib/http.js";
import type { DesktopDeviceRecord } from "./repository.js";
import type { DesktopDeviceService } from "./service.js";
import {
  type DesktopComputerControl,
  type DesktopComputerResumeReceipt,
} from "./computer-control.js";
import type { DesktopComputerPauseAudit } from "./pause-audit.js";

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
    /** Fixture-only negotiation gate; app.ts enables it only for the product controller. */
    computerExecute?: boolean;
    /** Product M1b selection/control path; absent in the joined fixture lane. */
    computerControl?: Pick<DesktopComputerControl, "handle" | "releaseConnection" | "revokeTurn">;
    /**
     * Best-effort Pause audit supervisor. It runs only after an accepted
     * positive Pause reply and never gates control.
     */
    pauseAudit?: Pick<DesktopComputerPauseAudit, "record" | "close">;
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
    routes.post("/register", { bodyLimit: 4096, config: { rateLimit: { max: 10, timeWindow: "1 minute" } } }, async request => {
      const body = desktopDeviceRegisterInputSchema.parse(request.body);
      return ok(
        await service.register(request.authUser!.id, request.authUser!.authValidAfter, body),
        request.id,
      );
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
    device: DesktopDeviceRecord; connectionId: string; execution: boolean;
    tools: readonly DesktopNegotiatedOperation[]; computerStatus: boolean; detach?: () => void;
    ready: boolean; controls: Set<string>; /** Exact id of the one open transition. */
    controlInFlight: string | null;
    /** Exact action and target of the open transition for the one stop takeover. */
    controlKind: "select" | "pause" | "resume" | "stop" | null;
    controlTarget: { conversationId: string; turnId: string; selectionId: string } | null;
    /** The one reserved exact stop id, or null. */
    controlTakeover: string | null;
    /** One bounded receipt from this socket's last committed resume, or null. */
    resumeReceipt: DesktopComputerResumeReceipt | null;
    /** Resolves once the open transition's handler has fully settled. */
    controlSettled: Promise<void> | null;
  }>();
  const backgroundWork = new Set<Promise<void>>();
  let closing = false;
  let subscription: Promise<() => void> | null = null;
  let subscriptionGeneration = 0;
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
          void options.computerControl?.revokeTurn(notice.turnId)
            .catch(() => app.log.warn({ turnId: notice.turnId }, "desktop computer selection revocation failed"));
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
    const supportsConversationReference = supportsExecution &&
      request.headers[DESKTOP_CONVERSATION_REFERENCE_PROTOCOL_HEADER] === String(desktopConversationReferenceProtocolVersion);
    const supportsTools = supportsExecution &&
      request.headers[DESKTOP_TOOL_PROTOCOL_HEADER] === String(desktopToolProtocolVersion);
    const toolOffer = request.headers[DESKTOP_TOOL_OPERATIONS_HEADER];
    const offered = typeof toolOffer === "string" ? new Set(toolOffer.split(",")) : undefined;
    const tools = !supportsTools ? [] : !offered ? ["web.search"] as const
      : desktopNegotiatedOperationSchema.options.filter(operation => offered.has(operation) &&
        (operation === "web.search" || operation === desktopModelSwitchOperation ||
          (operation === "approval.respond" ? options.nativeApprovals
            : operation === "connection.execute" ? options.connectionTools
            : operation === "browser.execute" ? options.browserTools
            : operation === "artifact.prepare" || operation === "artifact.multipart"
              ? options.artifactTools && offered.has("artifact.prepare")
              : operation === "artifact.website"
                ? options.artifactTools && options.websiteArtifacts === true && offered.has("artifact.prepare")
                : operation === "computer.execute"
                  ? options.computerExecute === true
                  : operation === desktopComputerWaitOperation
                    // The marker rides the product Mac lane and is echoed only
                    // together with computer.execute; an old Mac/API list is
                    // otherwise unchanged.
                    ? options.computerExecute === true && offered.has(desktopComputerExecuteOperation)
                    : operation === desktopConversationReferenceReadOperation ? true
                    : options.knowledgeTools)));
    const supportsComputerStatus = supportsTools && options.computerExecute === true &&
      offered?.has(desktopComputerExecuteOperation) === true &&
      request.headers[DESKTOP_COMPUTER_STATUS_HEADER] === String(desktopComputerStatusProtocolVersion);
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
        if (options.computerControl) {
          const control = desktopComputerControlSchema.safeParse(value);
          if (control.success) {
            if (!current.tools.includes("computer.execute") || !current.ready) {
              socket.close(4400);
              return;
            }
            // Synchronous single-send continuation. The control handler invokes
            // it at most once; a positive active ack invokes it inside the
            // final locked DB session/grant check.
            const reply = (result: unknown): boolean => {
              if (connected.get(socket) !== current || !current.ready || socket.readyState !== WebSocket.OPEN ||
                  socket.bufferedAmount >= desktopExecutionMaxFrameBytes) return false;
              try {
                const parsed = desktopComputerControlResultSchema.parse(result);
                // A reserved matching stop owns the next transition; it
                // suppresses the stale positive select/renewal/resume/pause ack
                // so the Mac cannot treat a superseded transition as current.
                // A negative result for the earlier request may still be sent.
                if (parsed.ok && current.controlTakeover !== null) return false;
                socket.send(JSON.stringify(parsed), error => {
                  if (error) socket.terminate();
                });
                return true;
              } catch {
                return false;
              }
            };
            const rememberControl = (id: string) => {
              current.controls.add(id);
              if (current.controls.size > 64) {
                const oldest = current.controls.values().next().value;
                if (oldest !== undefined) current.controls.delete(oldest);
              }
            };
            // One correlated control transition per socket; a duplicate id or
            // an overlapping request is never replayed. A duplicate of the
            // exact open id is dropped so the original transition keeps its
            // one answer; a different overlapping id fails immediately, and a
            // finished id is rejected by the bounded set below.
            //
            // The single exception is an exact same-socket Stop for the
            // identical conversation/turn/selection while that selection's
            // select, renewal, resume, or pause is still settling. It is
            // reserved synchronously here and runs only after the prior
            // transition has settled, so a Stop can never overtake a select
            // and let the old frame recreate authority. A resume target is its
            // original paused id, so the same predicate names the exact
            // predecessor; a pause keeps the installed id. Only a pause that
            // completed with its holder released and no retained pending input
            // avoids extra cleanup; otherwise the Stop uses its existing exact
            // cleanup quiesce and proof.
            // Everything else keeps the existing immediate rejection.
            const body = control.data.body;
            if (current.controlInFlight !== null) {
              if (current.controlInFlight === control.data.id) return;
              if (current.controlTakeover === control.data.id) return;
              const pendingTarget = current.controlTarget;
              if (body.action === "stop" && current.controlTakeover === null &&
                  !current.controls.has(control.data.id) &&
                  (current.controlKind === "select" || current.controlKind === "resume" ||
                    current.controlKind === "pause") &&
                  current.controlSettled !== null && pendingTarget !== null &&
                  pendingTarget.conversationId === body.conversation_id &&
                  pendingTarget.turnId === body.turn_id &&
                  pendingTarget.selectionId === body.selection_id) {
                current.controlTakeover = control.data.id;
                const prior = current.controlSettled;
                await prior;
                try {
                  // The wait may have lost the exact link. Recheck readiness
                  // and presence with the existing guards before one stop.
                  if (connected.get(socket) !== current || !current.ready ||
                      socket.readyState !== WebSocket.OPEN) return;
                  if (!await service.coordinator.isCurrentConnection(current.device.id, current.connectionId)) return;
                  current.controlInFlight = control.data.id;
                  current.controlKind = "stop";
                  current.controlTarget = {
                    conversationId: body.conversation_id, turnId: body.turn_id,
                    selectionId: body.selection_id,
                  };
                  current.controlTakeover = null;
                  let settle!: () => void;
                  current.controlSettled = new Promise<void>(resolve => { settle = resolve; });
                  try {
                    // The receipt, if any, is read only after the prior
                    // transition settled, so a resume that just committed its
                    // exact successor is visible to this stop.
                    await options.computerControl.handle({
                      ownerId: current.device.ownerId, deviceId: current.device.id,
                      connectionId: current.connectionId,
                      verifyCredential: () => service.hasCurrentCredential(current.device),
                      frame: control.data,
                      ...(current.resumeReceipt === null ? {} : { resumeReceipt: current.resumeReceipt }),
                    }, reply);
                  } finally {
                    settle();
                    current.controlSettled = null;
                    current.controlInFlight = null;
                    current.controlKind = null;
                    current.controlTarget = null;
                    rememberControl(control.data.id);
                  }
                } finally {
                  // A failed recheck abandoned the reserved stop; leave the
                  // socket free instead of a permanently busy transition.
                  if (current.controlTakeover === control.data.id) {
                    current.controlTakeover = null;
                    current.controlInFlight = null;
                    current.controlKind = null;
                    current.controlTarget = null;
                  }
                }
                return;
              }
              reply({
                type: "computer.control.result", id: control.data.id, ok: false,
                error_code: "RUNNER_OPERATION_UNCERTAIN",
              });
              return;
            }
            if (current.controls.has(control.data.id)) {
              reply({
                type: "computer.control.result", id: control.data.id, ok: false,
                error_code: "RUNNER_OPERATION_UNCERTAIN",
              });
              return;
            }
            current.controlInFlight = control.data.id;
            current.controlKind = body.action;
            current.controlTarget = {
              conversationId: body.conversation_id, turnId: body.turn_id,
              selectionId: body.selection_id,
            };
            let settle!: () => void;
            current.controlSettled = new Promise<void>(resolve => { settle = resolve; });
            try {
              // A result for a superseded link would let the Mac activate a
              // selection the API no longer considers current. The final
              // active check repeats presence while the DB lock is held.
              if (!await service.coordinator.isCurrentConnection(current.device.id, current.connectionId)) return;
              // The handler performs the one reply through the continuation.
              // It never rejects; a lost continuation fails closed with no ack.
              // A stop may reuse this socket's one committed-resume receipt; a
              // resume may replace that slot only through its own commit.
              await options.computerControl.handle({
                ownerId: current.device.ownerId, deviceId: current.device.id,
                connectionId: current.connectionId,
                verifyCredential: () => service.hasCurrentCredential(current.device),
                frame: control.data,
                ...(current.resumeReceipt === null ? {} : { resumeReceipt: current.resumeReceipt }),
                onResumed: receipt => { current.resumeReceipt = receipt; },
                // Emergency Stop never takes this path: its takeover call above
                // omits the callback, and a superseded Pause reply is refused
                // before the handler can notify.
                onPauseAcknowledged: receipt => {
                  // Keep the shutdown guard: a late callback must not open a
                  // new audit connection while the route is tearing down.
                  if (!closing) options.pauseAudit?.record(receipt);
                },
              }, reply);
            } finally {
              settle();
              current.controlSettled = null;
              // A reserved exact stop owns the next transition; keep this slot
              // busy until it has run so unrelated frames cannot interleave.
              if (current.controlTakeover === null) {
                current.controlInFlight = null;
                current.controlKind = null;
                current.controlTarget = null;
              }
              rememberControl(control.data.id);
            }
            return;
          }
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
            computerStatus: device.platform === "darwin" && supportsComputerStatus,
            ready: false, controls: new Set(), controlInFlight: null,
            controlKind: null, controlTarget: null, controlTakeover: null,
            resumeReceipt: null, controlSettled: null,
          };
          connected.set(socket, state);
          app.log.info({
            event: "desktop_execution_negotiation",
            deviceId: device.id,
            execution: state.execution,
            platform: device.platform,
          }, "desktop execution negotiation");
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
              conversationReferences: supportsConversationReference,
              computerStatus: supportsComputerStatus,
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
            ...(supportsConversationReference ? { conversation_reference_protocol_version: desktopConversationReferenceProtocolVersion } : {}),
            ...(state.tools.length ? {
              tool_protocol_version: desktopToolProtocolVersion,
              ...(offered ? { tool_operations: state.tools } : {}),
            } : {}),
            ...(state.computerStatus ? { computer_status_version: desktopComputerStatusProtocolVersion } : {}),
          }) : ready));
          readySent = true;
          state.ready = true;
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
      if (current) {
        void service.coordinator.disconnect(current.device.id, current.connectionId)
          .catch(() => app.log.warn("desktop device disconnect cleanup failed"));
        // Compare-delete only this exact connection's selection and holder.
        void options.computerControl?.releaseConnection(current.device.id, current.connectionId)
          .catch(() => app.log.warn("desktop computer selection disconnect cleanup failed"));
      }
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
    await options.pauseAudit?.close();
    const unsubscribe = await subscription?.catch(() => undefined);
    unsubscribe?.();
    await execution?.close();
  });
}
