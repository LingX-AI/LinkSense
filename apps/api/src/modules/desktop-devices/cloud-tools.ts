import { randomUUID } from "node:crypto";
import {
  desktopCloudToolCancelSchema,
  desktopCloudToolLifetimeMs,
  desktopCloudToolOperationSchema,
  desktopCloudToolPingInputSchema,
  desktopCloudToolRequestSchema,
  desktopCloudToolResultSchema,
  type DesktopCloudToolErrorCode,
  type DesktopCloudToolOperation,
  type DesktopCloudToolPingInput,
  type DesktopCloudToolPingResult,
} from "@linksense/shared";
import { z } from "zod";

import type {
  CloudToolRemoteCandidate,
  CloudToolRemoteReply,
  CloudToolRemoteRequest,
  DesktopCloudToolRelay,
} from "./cloud-tool-relay.js";

const maximumInFlightPerConnection = 4;
const presenceRefreshMilliseconds = 15_000;

export class DesktopCloudToolError extends Error {
  constructor(readonly code: DesktopCloudToolErrorCode) {
    super(code);
    this.name = "DesktopCloudToolError";
  }
}

type CloudToolConnection = {
  ownerId: string;
  deviceId: string;
  connectionId: string;
  operations: ReadonlySet<DesktopCloudToolOperation>;
  send: (frame: string) => boolean;
  verifyCredential: () => Promise<boolean>;
};

type PendingTool = {
  connectionId: string;
  resolve: (result: DesktopCloudToolPingResult) => void;
  reject: (error: DesktopCloudToolError) => void;
  timer: NodeJS.Timeout;
  signal: AbortSignal;
  abort: () => void;
};

type PendingRemote = {
  resolve: (result: DesktopCloudToolPingResult) => void;
  reject: (error: DesktopCloudToolError) => void;
  timer: NodeJS.Timeout;
  signal: AbortSignal;
  abort: () => void;
};

export type DesktopCloudToolLogger = {
  warn: (meta: Record<string, unknown>, message: string) => void;
};

/**
 * The cloud task -> Mac lane. It is separate from the retired local-execution
 * transport: a Mac can advertise these read-only tools without a local runtime.
 * A Redis relay reaches the replica that owns the Mac's WebSocket.
 */
export class DesktopCloudToolGateway {
  private readonly connections = new Map<string, CloudToolConnection>();
  private readonly inFlight = new Map<string, number>();
  private readonly pending = new Map<string, PendingTool>();
  private readonly pendingRemote = new Map<string, PendingRemote>();
  private readonly remoteExecutions = new Map<string, AbortController>();
  private readonly presenceTimers = new Map<string, NodeJS.Timeout>();
  private readonly instanceId = randomUUID();
  private relay: DesktopCloudToolRelay | undefined;
  private relayStops: Array<() => void> = [];
  private relayRestartTimer: NodeJS.Timeout | undefined;
  private relayUnavailable = false;
  private logger: DesktopCloudToolLogger | undefined;
  private closing = false;

  async start(
    relay: DesktopCloudToolRelay,
    logger?: DesktopCloudToolLogger,
  ): Promise<void> {
    if (this.relay || this.closing) return;
    this.relay = relay;
    this.logger = logger;
    try {
      await this.subscribeRelay(relay);
    } catch (error) {
      for (const stop of this.relayStops.splice(0)) stop();
      this.relay = undefined;
      throw error;
    }
  }

  private async subscribeRelay(relay: DesktopCloudToolRelay): Promise<void> {
    const unavailable = () => {
      this.relayUnavailable = true;
      this.settleAllRemote(new DesktopCloudToolError("DESKTOP_TOOL_UNAVAILABLE"));
      this.logger?.warn({ event: "desktop_cloud_tool_relay_unavailable" }, "desktop cloud tool relay unavailable");
      this.scheduleRelayRestart();
    };
    const stopRequests = await relay.subscribeRequests(
      this.instanceId,
      request => {
        void this.handleRemoteRequest(request).catch(error => {
          this.logger?.warn(
            { event: "desktop_cloud_tool_remote_failed", error },
            "desktop cloud tool request could not be handled",
          );
        });
      },
      unavailable,
    );
    this.relayStops.push(stopRequests);
    try {
      const stopReplies = await relay.subscribeReplies(
        reply => this.receiveRemoteReply(reply),
        unavailable,
      );
      this.relayStops.push(stopReplies);
    } catch (error) {
      this.relayStops.pop()?.();
      throw error;
    }
    this.relayUnavailable = false;
  }

  private scheduleRelayRestart(): void {
    if (this.closing || this.relayRestartTimer) return;
    this.relayRestartTimer = setTimeout(() => {
      this.relayRestartTimer = undefined;
      if (this.closing || !this.relay) return;
      for (const stop of this.relayStops.splice(0)) stop();
      this.subscribeRelay(this.relay).catch(error => {
        this.logger?.warn(
          { event: "desktop_cloud_tool_relay_reconnect_failed", error },
          "desktop cloud tool relay could not be resubscribed",
        );
        this.scheduleRelayRestart();
      });
    }, 5_000);
    this.relayRestartTimer.unref();
  }

  async register(connection: CloudToolConnection): Promise<() => void> {
    if (this.closing) return () => undefined;
    this.connections.set(connection.connectionId, connection);
    if (this.relay) {
      const announce = async () => {
        try {
          await this.relay?.announce({
            connectionId: connection.connectionId,
            instanceId: this.instanceId,
            ownerId: connection.ownerId,
            deviceId: connection.deviceId,
            operations: [...connection.operations],
          });
        } catch (error) {
          this.logger?.warn(
            { event: "desktop_cloud_tool_presence_failed", connectionId: connection.connectionId, error },
            "desktop cloud tool presence could not be announced",
          );
        }
      };
      await announce();
      const timer = setInterval(() => { void announce(); }, presenceRefreshMilliseconds);
      timer.unref();
      this.presenceTimers.set(connection.connectionId, timer);
    }
    let detached = false;
    return () => {
      if (detached) return;
      detached = true;
      const timer = this.presenceTimers.get(connection.connectionId);
      if (timer) clearInterval(timer);
      this.presenceTimers.delete(connection.connectionId);
      if (this.connections.get(connection.connectionId) === connection) {
        this.connections.delete(connection.connectionId);
      }
      for (const [id, pending] of this.pending) {
        if (pending.connectionId !== connection.connectionId) continue;
        this.settle(id, new DesktopCloudToolError("DESKTOP_TOOL_UNAVAILABLE"));
      }
      if (this.relay) {
        void this.relay.withdraw(connection.connectionId).catch(error => {
          this.logger?.warn(
            { event: "desktop_cloud_tool_withdraw_failed", connectionId: connection.connectionId, error },
            "desktop cloud tool presence could not be withdrawn",
          );
        });
      }
    };
  }

  /** Returns true for any well-formed cloud-tool frame, consumed or not. */
  receive(connectionId: string, value: unknown): boolean {
    const result = desktopCloudToolResultSchema.safeParse(value);
    if (!result.success) return false;
    const pending = this.pending.get(result.data.id);
    if (!pending || pending.connectionId !== connectionId) return true;
    if (result.data.ok) {
      if (result.data.operation !== "local_tools.ping") {
        this.settle(result.data.id, new DesktopCloudToolError("DESKTOP_TOOL_UNAVAILABLE"));
      } else {
        this.settle(result.data.id, undefined, result.data.data);
      }
    } else {
      this.settle(result.data.id, new DesktopCloudToolError(result.data.error_code));
    }
    return true;
  }

  async execute(
    ownerId: string,
    operation: DesktopCloudToolOperation,
    input: DesktopCloudToolPingInput,
    signal: AbortSignal,
  ): Promise<{ deviceId: string; data: DesktopCloudToolPingResult }> {
    desktopCloudToolOperationSchema.parse(operation);
    const parsedInput = desktopCloudToolPingInputSchema.parse(input);
    if (this.closing || signal.aborted) throw new DesktopCloudToolError("DESKTOP_TOOL_UNAVAILABLE");
    const candidates = [...this.connections.values()].filter(connection =>
      connection.ownerId === ownerId && connection.operations.has(operation) &&
      (this.inFlight.get(connection.connectionId) ?? 0) < maximumInFlightPerConnection);
    for (const connection of candidates) {
      if (!await connection.verifyCredential().catch(() => false)) continue;
      if (this.closing || this.connections.get(connection.connectionId) !== connection) continue;
      return await this.executeOnConnection(connection, operation, parsedInput, signal);
    }
    const remote = await this.remoteCandidate(ownerId, operation);
    if (remote) return await this.executeRemote(remote, operation, parsedInput, signal);
    throw new DesktopCloudToolError("DESKTOP_TOOL_UNAVAILABLE");
  }

  close(): void {
    this.closing = true;
    this.relayUnavailable = true;
    if (this.relayRestartTimer) clearTimeout(this.relayRestartTimer);
    this.relayRestartTimer = undefined;
    for (const stop of this.relayStops.splice(0)) stop();
    for (const timer of this.presenceTimers.values()) clearInterval(timer);
    this.presenceTimers.clear();
    this.settleAllRemote(new DesktopCloudToolError("DESKTOP_TOOL_UNAVAILABLE"));
    for (const id of [...this.pending.keys()]) {
      this.settle(id, new DesktopCloudToolError("DESKTOP_TOOL_UNAVAILABLE"));
    }
    for (const controller of this.remoteExecutions.values()) controller.abort();
    this.remoteExecutions.clear();
    this.connections.clear();
    this.relay = undefined;
  }

  private async executeOnConnection(
    connection: CloudToolConnection,
    operation: DesktopCloudToolOperation,
    input: DesktopCloudToolPingInput,
    signal: AbortSignal,
  ): Promise<{ deviceId: string; data: DesktopCloudToolPingResult }> {
    if (this.closing || signal.aborted) throw new DesktopCloudToolError("DESKTOP_TOOL_UNAVAILABLE");
    if ((this.inFlight.get(connection.connectionId) ?? 0) >= maximumInFlightPerConnection) {
      throw new DesktopCloudToolError("DESKTOP_TOOL_UNAVAILABLE");
    }
    const id = randomUUID();
    const expiresAt = new Date(Date.now() + desktopCloudToolLifetimeMs).toISOString();
    const frame = desktopCloudToolRequestSchema.parse({
      type: "cloud_tool.request", id, operation, input, expires_at: expiresAt,
    });
    if (!connection.send(JSON.stringify(frame))) {
      throw new DesktopCloudToolError("DESKTOP_TOOL_UNAVAILABLE");
    }
    this.inFlight.set(connection.connectionId, (this.inFlight.get(connection.connectionId) ?? 0) + 1);
    const data = await new Promise<DesktopCloudToolPingResult>((resolve, reject) => {
      const settle = (error: DesktopCloudToolError) => this.settle(id, error);
      const timer = setTimeout(() => settle(new DesktopCloudToolError("DESKTOP_TOOL_UNAVAILABLE")), desktopCloudToolLifetimeMs);
      const abort = () => {
        if (connection.send(JSON.stringify(desktopCloudToolCancelSchema.parse({
          type: "cloud_tool.cancel", id, operation,
        })))) {
          settle(new DesktopCloudToolError("CANCELLED"));
        } else {
          settle(new DesktopCloudToolError("DESKTOP_TOOL_UNAVAILABLE"));
        }
      };
      this.pending.set(id, { connectionId: connection.connectionId, resolve, reject, timer, signal, abort });
      if (signal.aborted) abort();
      else signal.addEventListener("abort", abort, { once: true });
    });
    return { deviceId: connection.deviceId, data };
  }

  private async remoteCandidate(
    ownerId: string,
    operation: DesktopCloudToolOperation,
  ): Promise<CloudToolRemoteCandidate | null> {
    if (!this.relay || this.relayUnavailable || this.closing) return null;
    try {
      const candidates = await this.relay.candidates(ownerId, operation, this.instanceId);
      return candidates[0] ?? null;
    } catch (error) {
      this.logger?.warn(
        { event: "desktop_cloud_tool_presence_read_failed", error },
        "desktop cloud tool presence could not be read",
      );
      return null;
    }
  }

  private async executeRemote(
    candidate: CloudToolRemoteCandidate,
    operation: DesktopCloudToolOperation,
    input: DesktopCloudToolPingInput,
    signal: AbortSignal,
  ): Promise<{ deviceId: string; data: DesktopCloudToolPingResult }> {
    const relay = this.relay;
    if (!relay || this.relayUnavailable || this.closing || signal.aborted) {
      throw new DesktopCloudToolError("DESKTOP_TOOL_UNAVAILABLE");
    }
    const requestId = randomUUID();
    const data = await new Promise<DesktopCloudToolPingResult>((resolve, reject) => {
      const timer = setTimeout(
        () => this.settleRemote(requestId, new DesktopCloudToolError("DESKTOP_TOOL_UNAVAILABLE")),
        desktopCloudToolLifetimeMs,
      );
      const abort = () => {
        relay.publishRequest(candidate.instanceId, {
          type: "cancel", request_id: requestId,
          connection_id: candidate.connectionId, operation,
        }).then(
          delivered => this.settleRemote(requestId, new DesktopCloudToolError(
            delivered > 0 ? "CANCELLED" : "DESKTOP_TOOL_UNAVAILABLE",
          )),
          () => this.settleRemote(requestId, new DesktopCloudToolError("DESKTOP_TOOL_UNAVAILABLE")),
        );
      };
      this.pendingRemote.set(requestId, { resolve, reject, timer, signal, abort });
      if (signal.aborted) {
        abort();
        return;
      }
      signal.addEventListener("abort", abort, { once: true });
      relay.publishRequest(candidate.instanceId, {
        type: "execute", request_id: requestId,
        connection_id: candidate.connectionId, owner_id: candidate.ownerId,
        operation, input,
      }).then(
        delivered => {
          if (delivered === 0) {
            this.settleRemote(requestId, new DesktopCloudToolError("DESKTOP_TOOL_UNAVAILABLE"));
          }
        },
        error => {
          this.logger?.warn(
            { event: "desktop_cloud_tool_relay_publish_failed", error },
            "desktop cloud tool request could not be relayed",
          );
          this.settleRemote(requestId, new DesktopCloudToolError("DESKTOP_TOOL_UNAVAILABLE"));
        },
      );
    });
    return { deviceId: candidate.deviceId, data };
  }

  private receiveRemoteReply(reply: CloudToolRemoteReply): void {
    const pending = this.pendingRemote.get(reply.request_id);
    if (!pending) return;
    if (reply.ok) {
      this.settleRemote(reply.request_id, undefined, reply.data);
    } else {
      this.settleRemote(reply.request_id, new DesktopCloudToolError(reply.error_code));
    }
  }

  private async handleRemoteRequest(request: CloudToolRemoteRequest): Promise<void> {
    const relay = this.relay;
    if (!relay || this.closing) return;
    if (request.type === "cancel") {
      this.remoteExecutions.get(request.request_id)?.abort();
      return;
    }
    const connection = this.connections.get(request.connection_id);
    const fail = (code: DesktopCloudToolErrorCode) => this.publishRemoteReply(relay, {
      type: "result", request_id: request.request_id, ok: false, error_code: code,
    });
    if (
      !connection || connection.ownerId !== request.owner_id ||
      !connection.operations.has(request.operation) ||
      this.remoteExecutions.has(request.request_id)
    ) {
      await fail("DESKTOP_TOOL_UNAVAILABLE");
      return;
    }
    if (!await connection.verifyCredential().catch(() => false)) {
      await fail("DESKTOP_TOOL_UNAVAILABLE");
      return;
    }
    if (this.closing || this.connections.get(connection.connectionId) !== connection) {
      await fail("DESKTOP_TOOL_UNAVAILABLE");
      return;
    }
    const controller = new AbortController();
    this.remoteExecutions.set(request.request_id, controller);
    try {
      const { data } = await this.executeOnConnection(
        connection, request.operation, request.input, controller.signal,
      );
      await this.publishRemoteReply(relay, {
        type: "result", request_id: request.request_id, ok: true, data,
      });
    } catch (error) {
      await fail(error instanceof DesktopCloudToolError
        ? error.code
        : "DESKTOP_TOOL_UNAVAILABLE");
    } finally {
      this.remoteExecutions.delete(request.request_id);
    }
  }

  private async publishRemoteReply(
    relay: DesktopCloudToolRelay,
    reply: CloudToolRemoteReply,
  ): Promise<void> {
    try {
      await relay.publishReply(reply);
    } catch (error) {
      this.logger?.warn(
        { event: "desktop_cloud_tool_relay_reply_failed", error },
        "desktop cloud tool result could not be relayed",
      );
    }
  }

  private settle(id: string, error?: DesktopCloudToolError, result?: DesktopCloudToolPingResult): void {
    const pending = this.pending.get(id);
    if (!pending) return;
    this.pending.delete(id);
    clearTimeout(pending.timer);
    pending.signal.removeEventListener("abort", pending.abort);
    const count = this.inFlight.get(pending.connectionId) ?? 0;
    if (count <= 1) this.inFlight.delete(pending.connectionId);
    else this.inFlight.set(pending.connectionId, count - 1);
    if (error) pending.reject(error);
    else if (result) pending.resolve(result);
    else pending.reject(new DesktopCloudToolError("DESKTOP_TOOL_UNAVAILABLE"));
  }

  private settleRemote(
    requestId: string,
    error?: DesktopCloudToolError,
    result?: DesktopCloudToolPingResult,
  ): void {
    const pending = this.pendingRemote.get(requestId);
    if (!pending) return;
    this.pendingRemote.delete(requestId);
    clearTimeout(pending.timer);
    pending.signal.removeEventListener("abort", pending.abort);
    if (error) pending.reject(error);
    else if (result) pending.resolve(result);
    else pending.reject(new DesktopCloudToolError("DESKTOP_TOOL_UNAVAILABLE"));
  }

  private settleAllRemote(error: DesktopCloudToolError): void {
    for (const id of [...this.pendingRemote.keys()]) {
      this.settleRemote(id, error);
    }
  }
}

export const desktopCloudToolExecuteBodySchema = z.strictObject({
  conversationId: z.uuid(),
  turnId: z.uuid(),
  operation: desktopCloudToolOperationSchema,
  input: desktopCloudToolPingInputSchema,
});
export type DesktopCloudToolExecuteBody = z.infer<typeof desktopCloudToolExecuteBodySchema>;
