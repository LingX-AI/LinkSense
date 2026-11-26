import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

import { DesktopCloudToolError, DesktopCloudToolGateway } from "../src/modules/desktop-devices/cloud-tools.js";
import type {
  CloudToolPresence,
  CloudToolRemoteCandidate,
  CloudToolRemoteReply,
  CloudToolRemoteRequest,
  DesktopCloudToolRelay,
} from "../src/modules/desktop-devices/cloud-tool-relay.js";

const owner = "10000000-0000-4000-8000-000000000001";
const other = "10000000-0000-4000-8000-000000000002";
const device = "20000000-0000-4000-8000-000000000001";
const operation = "local_tools.ping" as const;
const result = { type: "cloud_tool.result", operation, ok: true as const,
  data: { message: "hello", platform: "darwin" as const, app_version: "1.2.3" } };

async function fixture(options: { ownerId?: string; verify?: boolean } = {}) {
  const gateway = new DesktopCloudToolGateway();
  const sent: Array<Record<string, unknown>> = [];
  const connectionId = randomUUID();
  const detach = await gateway.register({
    ownerId: options.ownerId ?? owner, deviceId: device, connectionId,
    operations: new Set([operation]),
    verifyCredential: async () => options.verify ?? true,
    send: frame => { sent.push(JSON.parse(frame)); return true; },
  });
  return { gateway, sent, connectionId, detach };
}

describe("desktop cloud tool gateway", () => {
  it("sends one ping and resolves only its exact result", async () => {
    const { gateway, sent, connectionId } = await fixture();
    const pending = gateway.execute(owner, { operation, input: { message: "hello" } }, new AbortController().signal);
    await vi.waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]).toMatchObject({
      type: "cloud_tool.request", operation, input: { message: "hello" },
    });
    expect(gateway.receive(connectionId, { ...result, id: sent[0]!.id })).toBe(true);
    await expect(pending).resolves.toEqual({ deviceId: device, data: result.data });
    gateway.close();
  });

  it("fails closed when no matching online connection exists", async () => {
    const gateway = new DesktopCloudToolGateway();
    await expect(gateway.execute(owner, { operation, input: { message: "hello" } }, new AbortController().signal))
      .rejects.toMatchObject({ code: "DESKTOP_TOOL_UNAVAILABLE" });
    const { gateway: otherGateway } = await fixture({ ownerId: other });
    await expect(otherGateway.execute(owner, { operation, input: { message: "hello" } }, new AbortController().signal))
      .rejects.toMatchObject({ code: "DESKTOP_TOOL_UNAVAILABLE" });
  });

  it("rechecks the device credential before dispatch", async () => {
    const { gateway } = await fixture({ verify: false });
    await expect(gateway.execute(owner, { operation, input: { message: "hello" } }, new AbortController().signal))
      .rejects.toMatchObject({ code: "DESKTOP_TOOL_UNAVAILABLE" });
  });

  it("cancels on abort and rejects a late result without leaking it", async () => {
    const { gateway, sent, connectionId } = await fixture();
    const controller = new AbortController();
    const pending = gateway.execute(owner, { operation, input: { message: "hello" } }, controller.signal);
    await vi.waitFor(() => expect(sent).toHaveLength(1));
    controller.abort();
    await expect(pending).rejects.toMatchObject({ code: "CANCELLED" });
    expect(sent[1]).toMatchObject({ type: "cloud_tool.cancel", id: sent[0]!.id, operation });
    expect(gateway.receive(connectionId, { ...result, id: sent[0]!.id })).toBe(true);
  });

  it("rejects pending work when the connection closes or the gateway shuts down", async () => {
    const first = await fixture();
    const pending = first.gateway.execute(owner, { operation, input: { message: "hello" } }, new AbortController().signal);
    await vi.waitFor(() => expect(first.sent).toHaveLength(1));
    first.detach();
    await expect(pending).rejects.toMatchObject({ code: "DESKTOP_TOOL_UNAVAILABLE" });

    const second = await fixture();
    const pendingSecond = second.gateway.execute(owner, { operation, input: { message: "hello" } }, new AbortController().signal);
    await vi.waitFor(() => expect(second.sent).toHaveLength(1));
    second.gateway.close();
    await expect(pendingSecond).rejects.toBeInstanceOf(DesktopCloudToolError);
  });

  it("dispatches a cloud computer status invocation", async () => {
    const gateway = new DesktopCloudToolGateway();
    const sent: Array<Record<string, unknown>> = [];
    const connectionId = randomUUID();
    await gateway.register({
      ownerId: owner, deviceId: device, connectionId,
      operations: new Set(["local_computer.status"]),
      verifyCredential: async () => true,
      send: frame => { sent.push(JSON.parse(frame)); return true; },
    });
    const pending = gateway.execute(owner, {
      operation: "local_computer.status", input: {},
    }, new AbortController().signal);
    await vi.waitFor(() => expect(sent).toHaveLength(1));
    gateway.receive(connectionId, {
      type: "cloud_tool.result", id: sent[0]!.id, operation: "local_computer.status",
      ok: true, data: { state: "idle", available: true, permissions: { accessibility: "granted" } },
    });
    await expect(pending).resolves.toMatchObject({ deviceId: device });
    gateway.close();
  });

  it("dispatches only to the device that owns the granted root", async () => {
    const gateway = new DesktopCloudToolGateway();
    const otherDevice = "20000000-0000-4000-8000-000000000002";
    const first: Array<Record<string, unknown>> = [];
    const second: Array<Record<string, unknown>> = [];
    const firstConnection = randomUUID();
    const secondConnection = randomUUID();
    await gateway.register({
      ownerId: owner, deviceId: device, connectionId: firstConnection,
      operations: new Set([operation]), verifyCredential: async () => true,
      send: frame => { first.push(JSON.parse(frame)); return true; },
    });
    await gateway.register({
      ownerId: owner, deviceId: otherDevice, connectionId: secondConnection,
      operations: new Set([operation]), verifyCredential: async () => true,
      send: frame => { second.push(JSON.parse(frame)); return true; },
    });
    const pending = gateway.execute(
      owner, { operation, input: { message: "hello" } },
      new AbortController().signal, { deviceId: otherDevice },
    );
    await vi.waitFor(() => expect(second).toHaveLength(1));
    expect(first).toHaveLength(0);
    gateway.receive(secondConnection, { ...result, id: second[0]!.id });
    await expect(pending).resolves.toMatchObject({ deviceId: otherDevice });
    gateway.close();
  });

  it("reaches a Mac owned by another API replica through the relay", async () => {
    const relay = new MemoryRelay();
    const owning = new DesktopCloudToolGateway();
    const requesting = new DesktopCloudToolGateway();
    await owning.start(relay);
    await requesting.start(relay);
    const sent: Array<Record<string, unknown>> = [];
    const connectionId = randomUUID();
    await owning.register({
      ownerId: owner, deviceId: device, connectionId,
      operations: new Set([operation]),
      verifyCredential: async () => true,
      send: frame => { sent.push(JSON.parse(frame)); return true; },
    });
    const pending = requesting.execute(owner, { operation, input: { message: "hello" } }, new AbortController().signal);
    await vi.waitFor(() => expect(sent).toHaveLength(1));
    owning.receive(connectionId, { ...result, id: sent[0]!.id });
    await expect(pending).resolves.toEqual({ deviceId: device, data: result.data });
    owning.close();
    requesting.close();
  });

  it("relays cancellation to the replica that owns the Mac", async () => {
    const relay = new MemoryRelay();
    const owning = new DesktopCloudToolGateway();
    const requesting = new DesktopCloudToolGateway();
    await owning.start(relay);
    await requesting.start(relay);
    const sent: Array<Record<string, unknown>> = [];
    const connectionId = randomUUID();
    await owning.register({
      ownerId: owner, deviceId: device, connectionId,
      operations: new Set([operation]),
      verifyCredential: async () => true,
      send: frame => { sent.push(JSON.parse(frame)); return true; },
    });
    const controller = new AbortController();
    const pending = requesting.execute(owner, { operation, input: { message: "hello" } }, controller.signal);
    await vi.waitFor(() => expect(sent).toHaveLength(1));
    controller.abort();
    await expect(pending).rejects.toMatchObject({ code: "CANCELLED" });
    await vi.waitFor(() => expect(sent[1]).toMatchObject({ type: "cloud_tool.cancel", operation }));
    owning.close();
    requesting.close();
  });
});

class MemoryRelay implements DesktopCloudToolRelay {
  private readonly presence = new Map<string, CloudToolPresence>();
  private readonly requests = new Map<string, Set<(request: CloudToolRemoteRequest) => void>>();
  private readonly replies = new Set<(reply: CloudToolRemoteReply) => void>();

  async announce(presence: CloudToolPresence): Promise<void> {
    this.presence.set(presence.connectionId, presence);
  }

  async withdraw(connectionId: string): Promise<void> {
    this.presence.delete(connectionId);
  }

  async candidates(ownerId: string, operation: string, excludeInstanceId: string): Promise<CloudToolRemoteCandidate[]> {
    return [...this.presence.values()]
      .filter(presence => presence.ownerId === ownerId &&
        presence.instanceId !== excludeInstanceId && presence.operations.includes(operation))
      .map(presence => ({
        connectionId: presence.connectionId, instanceId: presence.instanceId,
        ownerId: presence.ownerId, deviceId: presence.deviceId,
      }));
  }

  async publishRequest(instanceId: string, request: CloudToolRemoteRequest): Promise<number> {
    const listeners = this.requests.get(instanceId);
    if (!listeners?.size) return 0;
    for (const listener of [...listeners]) queueMicrotask(() => listener(request));
    return listeners.size;
  }

  async subscribeRequests(
    instanceId: string,
    listener: (request: CloudToolRemoteRequest) => void,
  ): Promise<() => void> {
    const listeners = this.requests.get(instanceId) ?? new Set();
    listeners.add(listener);
    this.requests.set(instanceId, listeners);
    return () => { listeners.delete(listener); };
  }

  async publishReply(reply: CloudToolRemoteReply): Promise<number> {
    for (const listener of [...this.replies]) queueMicrotask(() => listener(reply));
    return this.replies.size;
  }

  async subscribeReplies(listener: (reply: CloudToolRemoteReply) => void): Promise<() => void> {
    this.replies.add(listener);
    return () => { this.replies.delete(listener); };
  }
}
