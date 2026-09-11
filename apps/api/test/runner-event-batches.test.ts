import { randomUUID } from "node:crypto";
import Fastify, { type FastifyReply } from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppError } from "../src/lib/errors.js";
import { internalRunnerRoutes } from "../src/modules/events/routes.js";
import type { AppServices } from "../src/services.js";

const ownerId = "10000000-0000-4000-8000-000000000001";
const conversationId = "20000000-0000-4000-8000-000000000001";
const secret = "runner-batch-test-secret";
const apps: Array<ReturnType<typeof Fastify>> = [];
afterEach(async () => { await Promise.all(apps.splice(0).map(app => app.close())); });

function batch() {
  return {
    conversationId,
    events: [
      { method: "turn/started", visibility: "user_visible", params: { threadId: "thread", turn: { id: "turn", status: "inProgress" } } },
      { method: "item/agentMessage/delta", visibility: "user_visible", params: { threadId: "thread", turnId: "turn", itemId: "item", delta: "完整正文" } },
      { method: "turn/completed", visibility: "user_visible", params: { threadId: "thread", turn: { id: "turn", status: "completed" } } },
    ].map(event => ({ deliveryId: randomUUID(), event })),
  };
}

async function fixture(onRequest?: (reply: FastifyReply) => void) {
  const ingest = vi.fn<(...args: unknown[]) => Promise<{ accepted: boolean }>>().mockResolvedValue({ accepted: true });
  const assertOwner = vi.fn<(...args: unknown[]) => Promise<void>>().mockResolvedValue(undefined);
  const app = Fastify();
  apps.push(app);
  app.addHook("onRequest", async (_request, reply) => { onRequest?.(reply); });
  await app.register(internalRunnerRoutes, { services: {
    config: { runnerSharedSecret: secret }, conversations: { assertOwner }, events: { ingest },
  } as unknown as AppServices });
  const send = (payload: Record<string, unknown>, headers: Record<string, string> = {}) => app.inject({
    method: "POST", url: "/runner/events", payload,
    headers: { authorization: `Bearer ${secret}`, "x-linksense-owner-id": ownerId, ...headers },
  });
  return { app, ingest, assertOwner, send };
}

describe("ordered runner event batches", () => {
  it("awaits each unchanged event before processing the following event", async () => {
    const { ingest, assertOwner, send } = await fixture();
    const input = batch();
    let release: () => void = () => undefined;
    const held = new Promise<void>(resolve => { release = resolve; });
    ingest.mockImplementationOnce(async () => { await held; return { accepted: true }; });
    const response = send(input);
    await vi.waitFor(() => expect(ingest).toHaveBeenCalledTimes(1));
    expect(assertOwner).toHaveBeenCalledWith(ownerId, conversationId);
    release();
    expect((await response).json().data).toEqual({ accepted_delivery_ids: input.events.map(entry => entry.deliveryId) });
    expect(ingest.mock.calls).toEqual(input.events.map(entry => [conversationId, entry.event, entry.deliveryId]));
  });

  it.each([0, 1, 2])("stops at a pending projection at index %s and acknowledges only earlier events", async (blockedIndex) => {
    const { ingest, send } = await fixture();
    const input = batch();
    for (let index = 0; index < blockedIndex; index++) ingest.mockResolvedValueOnce({ accepted: true });
    ingest.mockResolvedValueOnce({ accepted: false });
    const response = await send(input);
    expect(response.statusCode).toBe(200);
    expect(response.json().data.accepted_delivery_ids).toEqual(input.events.slice(0, blockedIndex).map(entry => entry.deliveryId));
    expect(ingest).toHaveBeenCalledTimes(blockedIndex + 1);
  });

  it("returns the committed prefix after an error and never applies the later completion", async () => {
    const { ingest, send } = await fixture();
    const input = batch();
    ingest.mockResolvedValueOnce({ accepted: true }).mockRejectedValueOnce(new Error("database unavailable"));
    const response = await send(input);
    expect(response.json().data.accepted_delivery_ids).toEqual([input.events[0]!.deliveryId]);
    expect(ingest).toHaveBeenCalledTimes(2);
  });

  it("keeps the existing error response when the first event fails", async () => {
    const { ingest, send } = await fixture();
    ingest.mockRejectedValueOnce(new Error("database unavailable"));
    expect((await send(batch())).statusCode).toBe(500);
    expect(ingest).toHaveBeenCalledTimes(1);
  });

  it("stops after the current event when the HTTP caller disconnects", async () => {
    let responseClosed: Promise<void> | undefined;
    const { app, ingest } = await fixture(reply => {
      responseClosed = new Promise(resolve => { reply.raw.once("close", resolve); });
    });
    let release: () => void = () => undefined;
    const held = new Promise<void>(resolve => { release = resolve; });
    ingest.mockImplementationOnce(async () => { await held; return { accepted: true }; });
    const origin = await app.listen({ host: "127.0.0.1", port: 0 });
    const controller = new AbortController();
    const response = fetch(`${origin}/runner/events`, {
      method: "POST", signal: controller.signal,
      headers: { "content-type": "application/json", authorization: `Bearer ${secret}`, "x-linksense-owner-id": ownerId },
      body: JSON.stringify(batch()),
    });
    try {
      await vi.waitFor(() => expect(ingest).toHaveBeenCalledTimes(1));
      controller.abort();
      await expect(response).rejects.toThrow();
      await responseClosed;
    } finally {
      release();
    }
    await new Promise(resolve => setImmediate(resolve));
    expect(ingest).toHaveBeenCalledTimes(1);
  });

  it("rejects an unowned conversation before ingesting any batch entry", async () => {
    const { ingest, assertOwner, send } = await fixture();
    assertOwner.mockRejectedValueOnce(new AppError("CONVERSATION_NOT_FOUND"));
    expect((await send(batch())).statusCode).not.toBe(200);
    expect(ingest).not.toHaveBeenCalled();
  });

  it("rejects a missing worker secret before authorization or ingestion", async () => {
    const { ingest, assertOwner, send } = await fixture();
    expect((await send(batch(), { authorization: "Bearer wrong-secret" })).statusCode).toBe(401);
    expect(assertOwner).not.toHaveBeenCalled();
    expect(ingest).not.toHaveBeenCalled();
  });

  it.each([0, 33])("rejects a batch with %s entries before ingestion", async (count) => {
    const { ingest, send } = await fixture();
    const input = batch();
    input.events = Array.from({ length: count }, () => ({ ...input.events[0]!, deliveryId: randomUUID() }));
    expect((await send(input)).statusCode).not.toBe(200);
    expect(ingest).not.toHaveBeenCalled();
  });
});
