import { randomUUID } from "node:crypto";
import dayjs from "dayjs";
import {
  desktopCommandCapacity,
  desktopExecutionCancelSchema,
  desktopExecutionLifetimeFor,
  desktopExecutionCommandSchema,
  desktopExecutionMaxFrameBytes,
  desktopExecutionMaxInFlight,
  desktopExecutionResultSchema,
  desktopToolClockSkewAllowanceMs,
  desktopToolMaxInFlight,
  desktopToolLifetimeFor,
  supportsDesktopUserInput,
  type DesktopExecutionAck,
  type DesktopExecutionCallback,
  type DesktopExecutionCancel,
  type DesktopExecutionCommand,
  type DesktopExecutionResult,
  type DesktopToolCancel,
  type DesktopNegotiatedOperation,
  type DesktopToolRequest,
} from "@linksense/shared";
import type { Redis } from "ioredis";
import type { Logger } from "pino";
import { z } from "zod";
import { decryptJson, encryptJson } from "../lib/crypto.js";
import { AppError } from "../lib/errors.js";
import {
  desktopComputerDispatchAdmissionSchema,
  type DesktopComputerDispatchAdmission,
  type DesktopComputerDispatchAdmissionInput,
} from "../modules/desktop-devices/computer-admission.js";
import {
  desktopExecutionBindingSchema,
  RedisDesktopDeviceCoordinator,
  type DesktopExecutionBinding,
} from "../modules/desktop-devices/coordinator.js";
import { subscribeDesktopChannel } from "../modules/desktop-devices/notices.js";

const envelopeSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("dispatch"), binding: desktopExecutionBindingSchema, replyGatewayId: z.uuid(),
    frame: z.union([desktopExecutionCommandSchema, desktopExecutionCancelSchema]),
    admission: desktopComputerDispatchAdmissionSchema.optional(),
  }),
  z.strictObject({
    kind: z.literal("reply"), binding: desktopExecutionBindingSchema, frame: desktopExecutionResultSchema,
    beforeDelivery: z.literal(true).optional(),
  }),
]);
type Envelope = z.infer<typeof envelopeSchema>;
type Dispatch = Extract<Envelope, { kind: "dispatch" }>;
type CommandOperation = DesktopExecutionCommand["operation"];
type PendingDelivery = {
  request: Dispatch;
  command: DesktopExecutionCommand;
  timer: NodeJS.Timeout;
  expiresAt: number;
  lifetime: AbortController;
  state: "checking" | "sent" | "receiving";
};
type DeviceSocket = {
  ownerId: string;
  binding: DesktopExecutionBinding;
  verifyCredential: () => Promise<boolean>;
  send: (frame: DesktopExecutionCommand | DesktopExecutionCancel | DesktopExecutionAck) => boolean;
  close: () => void;
  pending: Map<string, PendingDelivery>;
  callbacks: Set<string>;
  attachments: boolean;
  toolOperations: readonly DesktopNegotiatedOperation[];
  tools: Map<string, { frame: DesktopToolRequest; controller: AbortController }>;
  lifetime: AbortController;
};
type PendingReply = {
  binding: DesktopExecutionBinding;
  command: DesktopExecutionCommand;
  expiresAt: number;
  resolve: (frame: DesktopExecutionResult) => void;
  reject: (error: Error) => void;
};
type ExecutionAuthority = (
  binding: DesktopExecutionBinding,
  command: DesktopExecutionCommand,
  admission?: DesktopComputerDispatchAdmission,
) => Promise<boolean>;
type ExecutionCallback = (
  binding: DesktopExecutionBinding & { ownerId: string; toolOperations: readonly DesktopNegotiatedOperation[] },
  frame: DesktopExecutionCallback,
  signal: AbortSignal,
) => Promise<DesktopExecutionAck>;

const channel = (gatewayId: string) => `linksense:desktop-execution:${gatewayId}`;
const encryptedEnvelopeSchema = z.string().max(2 * desktopExecutionMaxFrameBytes);
const knowledgeTools = ["knowledge.search", "knowledge.documents", "knowledge.markdown"] as const;

export class DesktopCommandUncertainError extends Error {
  constructor() {
    super("RUNNER_OPERATION_UNCERTAIN");
    this.name = "DesktopCommandUncertainError";
  }
}

export class DesktopCommandUndeliveredError extends AppError {
  constructor(code: "RUNNER_UNAVAILABLE" | "FORBIDDEN" = "RUNNER_UNAVAILABLE") {
    super(code);
    this.name = "DesktopCommandUndeliveredError";
  }
}

/** Redis fences the current connection; maps only hold this API replica's live IO. */
export class DesktopDeviceTransport {
  private readonly id = randomUUID();
  private readonly sockets = new Map<string, DeviceSocket>();
  private readonly waiting = new Map<string, PendingReply>();
  private readonly publisher: Redis;
  private readonly coordinator: RedisDesktopDeviceCoordinator;
  private readonly dispatchCoordinator: RedisDesktopDeviceCoordinator;
  private publisherReady: Promise<void> | undefined;
  private subscription: Promise<() => void> | undefined;
  private closed = false;

  constructor(
    private readonly redis: Redis,
    private readonly authorize: ExecutionAuthority,
    private readonly logger: Pick<Logger, "warn">,
    private readonly encryption: { masterKey: string; keyId: string },
    private readonly callback?: ExecutionCallback,
  ) {
    this.coordinator = new RedisDesktopDeviceCoordinator(redis);
    this.publisher = redis.duplicate({
      lazyConnect: true, enableOfflineQueue: false, autoResendUnfulfilledCommands: false,
      maxRetriesPerRequest: 0, connectTimeout: 2_000, commandTimeout: 2_000,
    });
    this.publisher.on("error", () => logger.warn("desktop execution publisher unavailable"));
    this.dispatchCoordinator = new RedisDesktopDeviceCoordinator(this.publisher);
  }

  async attach(
    socket: Omit<DeviceSocket, "binding" | "pending" | "callbacks" | "tools" | "lifetime"> & Pick<DesktopExecutionBinding, "deviceId" | "connectionId">,
  ): Promise<(() => void) | null> {
    await this.ready();
    const { ownerId, deviceId, connectionId, verifyCredential, send, close, toolOperations, attachments } = socket;
    const binding = { deviceId, connectionId, gatewayId: this.id };
    const connection: DeviceSocket = {
      ownerId, binding, verifyCredential, send, close, toolOperations, attachments, pending: new Map(), callbacks: new Set(), tools: new Map(), lifetime: new AbortController(),
    };
    this.sockets.set(connectionId, connection);
    const detach = () => {
      if (this.sockets.get(connectionId) !== connection) return;
      this.sockets.delete(connectionId);
      connection.lifetime.abort();
      for (const delivery of connection.pending.values()) {
        this.finish(connection, delivery, deliveryFailure(delivery));
      }
    };
    try {
      if (await this.coordinator.enableExecution(binding, knowledgeTools.every(op => toolOperations.includes(op)), attachments) &&
        this.sockets.get(connectionId) === connection) return detach;
      detach();
      return null;
    } catch (error) {
      detach();
      throw error;
    }
  }

  connection(deviceId: string): Promise<DesktopExecutionBinding | null> {
    return this.coordinator.executionConnection(deviceId);
  }

  supportsKnowledge(binding: DesktopExecutionBinding): Promise<boolean> {
    return this.coordinator.supportsKnowledge(binding);
  }

  supportsAttachments(binding: DesktopExecutionBinding): Promise<boolean> {
    return this.coordinator.supportsAttachments(binding);
  }

  async send(
    binding: DesktopExecutionBinding,
    raw: DesktopExecutionCommand,
    signal?: AbortSignal,
    admission?: DesktopComputerDispatchAdmissionInput,
  ): Promise<DesktopExecutionResult> {
    const command = desktopExecutionCommandSchema.parse(raw);
    const dispatchAdmission = admission === undefined
      ? undefined : desktopComputerDispatchAdmissionSchema.parse(admission);
    if (command.operation === "computer.execute" && command.body.request.kind !== "quiesce" &&
        dispatchAdmission === undefined) {
      throw new DesktopCommandUndeliveredError("FORBIDDEN");
    }
    const expiresAt = dayjs(command.expires_at).valueOf();
    const lifetime = expiresAt - Date.now();
    const request: Dispatch = {
      kind: "dispatch", binding, replyGatewayId: this.id, frame: command,
      ...(dispatchAdmission === undefined ? {} : { admission: dispatchAdmission }),
    };
    if (lifetime <= 0 || lifetime > desktopExecutionLifetimeFor(command) || signal?.aborted ||
      Buffer.byteLength(JSON.stringify(command)) > desktopExecutionMaxFrameBytes) {
      throw new DesktopCommandUndeliveredError();
    }
    try {
      await this.ready();
    } catch {
      throw new DesktopCommandUndeliveredError();
    }
    if (signal?.aborted || this.closed || this.publisher.status !== "ready" || Date.now() >= expiresAt ||
      this.waiting.size >= 1000) throw new DesktopCommandUndeliveredError();
    if (this.waiting.has(command.id)) throw new DesktopCommandUncertainError();
    let timeout: NodeJS.Timeout | undefined;
    let abort: (() => void) | undefined;
    try {
      return await new Promise<DesktopExecutionResult>((resolve, reject) => {
        const waiting = { binding, command, expiresAt, resolve, reject };
        this.waiting.set(command.id, waiting);
        abort = () => {
          if (this.waiting.get(command.id) !== waiting) return;
          const message: Dispatch = {
            kind: "dispatch", binding, replyGatewayId: this.id,
            frame: { type: "command.cancel", id: command.id },
          };
          void this.publish(message, expiresAt).catch(() =>
            this.logger.warn({ commandId: command.id }, "desktop command cancellation publication failed"));
          reject(new DesktopCommandUncertainError());
        };
        timeout = setTimeout(abort, Math.max(1, expiresAt - Date.now()));
        signal?.addEventListener("abort", abort, { once: true });
        // A failed Redis reply does not prove the publish did not happen.
        void this.publish(request, expiresAt).then(status => {
          if (status === "unavailable") reject(new DesktopCommandUndeliveredError());
          if (status === "duplicate") reject(new DesktopCommandUncertainError());
        }, () => {
          this.logger.warn({ commandId: command.id }, "desktop command publication result unavailable");
          reject(new DesktopCommandUncertainError());
        });
      });
    } finally {
      clearTimeout(timeout);
      if (abort) signal?.removeEventListener("abort", abort);
      this.waiting.delete(command.id);
    }
  }

  async receive(connectionId: string, frame: DesktopExecutionResult): Promise<void> {
    const socket = this.sockets.get(connectionId);
    const pending = socket?.pending.get(frame.id);
    if (!socket || pending?.state !== "sent") return;
    if (!matchesResult(pending.command, frame)) {
      socket.close();
      return;
    }
    pending.state = "receiving";
    if (!await socket.verifyCredential()) {
      socket.close();
      return;
    }
    if (socket.pending.get(frame.id) !== pending || Date.now() >= pending.expiresAt) return;
    this.remove(socket, pending);
    const status = await this.dispatchCoordinator.publishExecution(
      socket.binding, channel(pending.request.replyGatewayId), this.encodeReply(pending.request, frame),
      { expiresAt: pending.expiresAt },
    ).catch(() => {
      this.logger.warn({ commandId: frame.id }, "desktop command receipt publication failed");
      return "unavailable" as const;
    });
    if (status !== "sent") await this.reply(pending.request, deliveryFailure(pending)).catch(() =>
      this.logger.warn({ commandId: frame.id }, "desktop command uncertainty publication failed"));
  }

  async receiveCallback(connectionId: string, frame: DesktopExecutionCallback): Promise<void> {
    const socket = this.sockets.get(connectionId);
    if (!socket) return;
    // Only one request per turn and operation may advance while the previous
    // batch is being projected. Start settlement can still unblock event IO.
    const key = frame.type === "tool.request" ? `tool:${frame.id}` : `${frame.turn_id}:${frame.operation}`;
    const reject = (error_code: "FORBIDDEN" | "RUNNER_UNAVAILABLE"): DesktopExecutionAck => frame.type === "tool.request"
      ? { type: "tool.result", id: frame.id, operation: frame.operation, ok: false, error_code }
      : { type: "execution.ack", id: frame.id, operation: frame.operation, ok: false, error_code };
    const reply = (ack: DesktopExecutionAck) => {
      if (!socket.lifetime.signal.aborted && !socket.send(ack)) socket.close();
    };
    if (frame.type === "tool.request" && socket.callbacks.has(key)) return;
    if (socket.callbacks.has(key) || socket.callbacks.size >= desktopExecutionMaxInFlight ||
      (frame.type === "tool.request" && socket.tools.size >= desktopToolMaxInFlight)) {
      reply(reject("RUNNER_UNAVAILABLE"));
      return;
    }
    const lifetime = frame.type === "tool.request" ? desktopToolLifetimeFor(frame.operation) : 4_000;
    const remaining = frame.type === "tool.request"
      ? dayjs(frame.expires_at).valueOf() - Date.now()
      : lifetime;
    if (remaining <= 0 || remaining > lifetime + desktopToolClockSkewAllowanceMs) {
      reply(reject("RUNNER_UNAVAILABLE"));
      return;
    }
    socket.callbacks.add(key);
    const pending = frame.type === "execution.recovery" ? socket.pending.get(frame.drain_id)
      : frame.operation === "attachments.ready" ? socket.pending.get(frame.start_id) : undefined;
    const tool = frame.type === "tool.request" ? { frame, controller: new AbortController() } : undefined;
    if (tool) socket.tools.set(frame.id, tool);
    const signal = AbortSignal.any([
      socket.lifetime.signal, AbortSignal.timeout(Math.min(remaining, lifetime)),
      ...(pending ? [pending.lifetime.signal] : []), ...(tool ? [tool.controller.signal] : []),
    ]);
    try {
      const { binding, ownerId } = socket;
      if (!await socket.verifyCredential()) {
        socket.close();
        return;
      }
      if (frame.operation === "attachments.ready") {
        const command = pending?.command;
        if (!socket.attachments || pending?.state !== "sent" || pending.expiresAt <= Date.now() ||
            command?.operation !== "turn.start" || !command.body.attachments?.length ||
            command.turn_id !== frame.turn_id || command.conversation_id !== frame.conversation_id ||
            command.runtime_generation !== frame.runtime_generation ||
            !await this.coordinator.mayDispatch(binding, command.id)) {
          reply(reject("FORBIDDEN"));
          return;
        }
      } else if (frame.type === "execution.recovery") {
        const command = pending?.command;
        if (!pending || pending.state !== "sent" || pending.expiresAt <= Date.now() || command?.operation !== "turn.drain" ||
            command.conversation_id !== frame.conversation_id || command.runtime_generation !== frame.runtime_generation ||
            command.turn_id !== frame.turn_id || !await this.authorize(binding, command) ||
            !await this.coordinator.mayDispatch(binding, command.id) || socket.pending.get(command.id) !== pending) {
          reply(reject("FORBIDDEN"));
          return;
        }
      } else if (!await this.coordinator.isCurrentConnection(binding.deviceId, binding.connectionId)) {
        reply(reject("FORBIDDEN"));
        return;
      }
      signal.throwIfAborted();
      if (!this.callback) {
        reply(reject("FORBIDDEN"));
        return;
      }
      const ack = await this.callback({ ...binding, ownerId, toolOperations: socket.toolOperations }, frame, signal);
      if (frame.operation === "attachments.ready" &&
          (!pending || !await this.coordinator.mayDispatch(binding, pending.command.id))) return;
      if (!signal.aborted && (!pending || socket.pending.get(pending.command.id) === pending)) reply(ack);
    } catch (error) {
      if (!signal.aborted) reply(reject(error instanceof AppError && (error.code === "FORBIDDEN" || error.code === "AUTH_REQUIRED")
        ? "FORBIDDEN" : "RUNNER_UNAVAILABLE"));
    } finally {
      socket.callbacks.delete(key);
      if (tool) socket.tools.delete(frame.id);
    }
  }

  cancelTool(connectionId: string, cancel: DesktopToolCancel): void {
    const pending = this.sockets.get(connectionId)?.tools.get(cancel.id);
    const request = pending?.frame;
    if (request && request.operation === cancel.operation && request.turn_id === cancel.turn_id &&
      request.conversation_id === cancel.conversation_id && request.runtime_generation === cancel.runtime_generation) {
      pending.controller.abort();
    }
  }

  cancelRunTools(turnId: string): void {
    for (const socket of this.sockets.values()) {
      for (const request of socket.tools.values()) {
        if (request.frame.turn_id.toLowerCase() === turnId) request.controller.abort();
      }
    }
  }

  async close(): Promise<void> {
    this.closed = true;
    this.closeLiveIO();
    this.publisher.disconnect();
    const unsubscribe = await this.subscription?.catch(() => undefined);
    unsubscribe?.();
  }

  private closeLiveIO(): void {
    for (const socket of this.sockets.values()) socket.close();
    for (const pending of this.waiting.values()) pending.reject(new DesktopCommandUncertainError());
  }

  private async ready(): Promise<void> {
    await this.subscribe();
    if (this.publisher.status === "wait") {
      this.publisherReady = this.publisher.connect().finally(() => { this.publisherReady = undefined; });
    }
    try {
      await this.publisherReady;
    } catch {
      throw new AppError("RUNNER_UNAVAILABLE");
    }
    if (this.closed || this.publisher.status !== "ready") throw new AppError("RUNNER_UNAVAILABLE");
  }

  private async subscribe(): Promise<void> {
    if (this.closed) throw new AppError("RUNNER_UNAVAILABLE");
    const topic = channel(this.id);
    const decode = encryptedEnvelopeSchema.transform(encrypted =>
      envelopeSchema.parse(decryptJson<unknown>(encrypted, this.encryption.masterKey, this.encryption.keyId, topic)));
    const pending = this.subscription ??= subscribeDesktopChannel(this.redis, topic, decode, envelope => {
      if (envelope.kind === "reply") {
        const waiting = this.waiting.get(envelope.frame.id);
        if (waiting && waiting.expiresAt > Date.now() &&
          sameBinding(waiting.binding, envelope.binding) && matchesResult(waiting.command, envelope.frame)) {
          const { frame } = envelope;
          if (envelope.beforeDelivery && !frame.ok && (frame.operation === "turn.start" || frame.operation === "turn.interrupt") &&
              (frame.error_code === "RUNNER_UNAVAILABLE" || frame.error_code === "FORBIDDEN")) {
            waiting.reject(new DesktopCommandUndeliveredError(frame.error_code));
          } else {
            waiting.resolve(frame);
          }
        }
      } else {
        void this.dispatch(envelope).catch(() => {
          // The request origin will time out rather than retry an ambiguous delivery.
          this.logger.warn({ commandId: envelope.frame.id }, "desktop command dispatch failed");
          this.sockets.get(envelope.binding.connectionId)?.close();
        });
      }
    }, () => {
      if (this.subscription !== pending) return;
      this.subscription = undefined;
      this.closeLiveIO();
    });
    try {
      await pending;
      if (this.subscription === pending && !this.closed) return;
    } catch {
      if (this.subscription === pending) this.subscription = undefined;
    }
    throw new AppError("RUNNER_UNAVAILABLE");
  }

  private publish(request: Dispatch, expiresAt: number) {
    const { frame } = request;
    return this.dispatchCoordinator.publishExecution(
      request.binding, channel(request.binding.gatewayId), this.encode(request, request.binding.gatewayId),
      { expiresAt, command: { id: frame.id, kind: frame.type === "command" ? "dispatch" : "cancel" } },
    );
  }

  private async dispatch(request: Dispatch): Promise<void> {
    const socket = this.sockets.get(request.binding.connectionId);
    const { frame } = request;
    if (!socket || !sameBinding(socket.binding, request.binding)) {
      if (frame.type === "command") await this.reply(request, failure(frame, "RUNNER_UNAVAILABLE"), true);
      return;
    }
    const pending = socket.pending.get(frame.id);
    if (frame.type === "command.cancel") {
      if (pending?.request.replyGatewayId !== request.replyGatewayId) return;
      if (pending.state !== "checking" && !socket.send(frame)) socket.close();
      this.finish(socket, pending, deliveryFailure(pending));
      return;
    }
    if (pending) return;
    if (frame.operation === "computer.execute" && frame.body.request.kind !== "quiesce" &&
        !request.admission) {
      // A computer action without its internal authorization permit must never
      // reach the socket; quiescence remains exempt.
      await this.reply(request, failure(frame, "FORBIDDEN"), true);
      return;
    }
    if (frame.operation === "user-input.respond" && !supportsDesktopUserInput(socket.toolOperations, frame.body.response)) {
      await this.reply(request, failure(frame, "USER_INPUT_REQUEST_UNAVAILABLE"), true);
      return;
    }
    if (frame.operation === "turn.start" && (
      (frame.body.selected_knowledge_bases?.length && !knowledgeTools.every(op => socket.toolOperations.includes(op))) ||
      (frame.body.attachments?.length && !socket.attachments)
    )) {
      await this.reply(request, failure(frame, "RUNNER_UNAVAILABLE"), true);
      return;
    }
    const expiresAt = dayjs(frame.expires_at).valueOf();
    const remaining = expiresAt - Date.now();
    if (remaining <= 0 || remaining > desktopExecutionLifetimeFor(frame) ||
      socket.pending.size >= desktopCommandCapacity(frame.operation, socket.attachments)) {
      await this.reply(request, failure(frame, "RUNNER_UNAVAILABLE"), true);
      return;
    }
    if (frame.owner_id !== socket.ownerId) {
      await this.reply(request, failure(frame, "FORBIDDEN"), true);
      return;
    }
    const timer = setTimeout(() => {
      const pending = socket.pending.get(frame.id);
      if (pending) {
        if (pending.state !== "checking") socket.send({ type: "command.cancel", id: frame.id });
        this.finish(socket, pending, deliveryFailure(pending));
      }
    }, remaining);
    const delivery: PendingDelivery = { request, command: frame, timer, expiresAt, lifetime: new AbortController(), state: "checking" };
    socket.pending.set(frame.id, delivery);
    const authorized = await socket.verifyCredential() &&
      await this.authorize(socket.binding, frame, request.admission);
    const current = authorized && await this.coordinator.mayDispatch(socket.binding, frame.id);
    if (socket.pending.get(frame.id) !== delivery || this.sockets.get(socket.binding.connectionId) !== socket) return;
    if (current && frame.operation === "turn.interrupt") {
      const start = [...socket.pending.values()].find(({ command }) => command.operation === "turn.start" &&
        command.body.attachments?.length && command.turn_id === frame.turn_id &&
        command.conversation_id === frame.conversation_id && command.runtime_generation === frame.runtime_generation);
      if (start) {
        start.lifetime.abort();
        await this.coordinator.cancelAttachmentPreparation(start.command.id);
      }
    }
    if (socket.pending.get(frame.id) !== delivery || this.sockets.get(socket.binding.connectionId) !== socket) return;
    if (!current ||
      Date.now() >= expiresAt || !socket.send(frame)) {
      this.finish(socket, delivery, failure(frame, authorized ? "RUNNER_UNAVAILABLE" : "FORBIDDEN"));
    } else {
      delivery.state = "sent";
    }
  }

  private finish(socket: DeviceSocket, pending: PendingDelivery, frame: DesktopExecutionResult): void {
    this.remove(socket, pending);
    void this.reply(pending.request, frame, pending.state === "checking").catch(() =>
      this.logger.warn({ commandId: frame.id }, "desktop command receipt publication failed"));
  }

  private remove(socket: DeviceSocket, pending: PendingDelivery): void {
    clearTimeout(pending.timer);
    socket.pending.delete(pending.command.id);
    pending.lifetime.abort();
  }

  private async reply(request: Dispatch, frame: DesktopExecutionResult, beforeDelivery = false): Promise<void> {
    await this.publisher.publish(channel(request.replyGatewayId), this.encodeReply(request, frame, beforeDelivery));
  }

  private encodeReply(request: Dispatch, frame: DesktopExecutionResult, beforeDelivery = false): string {
    return this.encode({
      kind: "reply", binding: request.binding, frame, ...(beforeDelivery && { beforeDelivery: true }),
    }, request.replyGatewayId);
  }

  private encode(envelope: Envelope, gatewayId: string): string {
    // Keep prompts and scoped credentials out of Redis diagnostics, even during a slow publish.
    return JSON.stringify(encryptJson(envelope, this.encryption.masterKey, this.encryption.keyId, channel(gatewayId)));
  }
}

function sameBinding(a: DesktopExecutionBinding, b: DesktopExecutionBinding): boolean {
  return a.connectionId === b.connectionId && a.deviceId === b.deviceId && a.gatewayId === b.gatewayId;
}

function matchesResult(command: DesktopExecutionCommand, frame: DesktopExecutionResult): boolean {
  if (frame.operation !== command.operation) return false;
  if (!frame.ok || frame.operation === "turn.interrupt" || frame.operation === "turn.drain" ||
      frame.operation === "user-input.respond" || frame.operation === "computer.execute" || frame.result === null) return true;
  return frame.result.conversationId === command.conversation_id && frame.result.projectionTurnId === command.turn_id;
}

function failure(
  command: { id: string; operation: CommandOperation },
  error_code: Extract<DesktopExecutionResult, { ok: false }>["error_code"],
): DesktopExecutionResult {
  return { type: "command.result", ok: false, id: command.id, operation: command.operation, error_code };
}

function deliveryFailure(pending: PendingDelivery): DesktopExecutionResult {
  return failure(pending.command, pending.state === "checking" ? "RUNNER_UNAVAILABLE" : "RUNNER_OPERATION_UNCERTAIN");
}
