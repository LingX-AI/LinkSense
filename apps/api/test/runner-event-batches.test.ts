import { randomUUID } from "node:crypto";
import Fastify, { type FastifyReply } from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppError } from "../src/lib/errors.js";
import { RUNNER_EVENT_BATCH_MAX_COUNT } from "@linksense/shared";
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
  const ingestTextDeltaBatch = vi.fn<(...args: unknown[]) => Promise<{ accepted: boolean }>>().mockResolvedValue({ accepted: true });
  const assertOwner = vi.fn<(...args: unknown[]) => Promise<void>>().mockResolvedValue(undefined);
  const settleStartOperation = vi.fn().mockResolvedValue(true);
  const app = Fastify();
  apps.push(app);
  app.addHook("onRequest", async (_request, reply) => { onRequest?.(reply); });
  await app.register(internalRunnerRoutes, { services: {
    config: { runnerSharedSecret: secret }, conversations: { assertOwner, settleStartOperation }, events: { ingest, ingestTextDeltaBatch },
  } as unknown as AppServices });
  const send = (payload: Record<string, unknown>, headers: Record<string, string> = {}) => app.inject({
    method: "POST", url: "/runner/events", payload,
    headers: { authorization: `Bearer ${secret}`, "x-linksense-owner-id": ownerId, ...headers },
  });
  return { app, ingest, ingestTextDeltaBatch, assertOwner, settleStartOperation, send };
}

describe("ordered runner event batches", () => {
  it("authenticates and scopes startup notifications independently of blocked event ingestion", async () => {
    const { app, assertOwner, settleStartOperation, ingest } = await fixture();
    const payload = { conversationId, projectionTurnId: randomUUID(), runtimeGeneration: randomUUID() };
    const request = { method: "POST" as const, url: "/runner/start-settled", payload };
    expect((await app.inject(request)).statusCode).toBe(401);
    expect(settleStartOperation).not.toHaveBeenCalled();
    const response = await app.inject({ ...request, headers: { authorization: `Bearer ${secret}`, "x-linksense-owner-id": ownerId } });
    expect(response.json().data).toEqual({ settled: true });
    expect(assertOwner).toHaveBeenCalledWith(ownerId, conversationId);
    expect(settleStartOperation).toHaveBeenCalledWith(ownerId, payload);
    expect(ingest).not.toHaveBeenCalled();
  });
  it("waits for a text group commit before ingesting completion and keeps every original delivery id", async () => {
    const { ingest, ingestTextDeltaBatch, send } = await fixture();
    const input = textBatch();
    let release: () => void = () => undefined;
    const durable = new Promise<void>(resolve => { release = resolve; });
    ingestTextDeltaBatch.mockImplementationOnce(async () => { await durable; return { accepted: true }; });
    const response = send(input);
    try {
      await vi.waitFor(() => expect(ingestTextDeltaBatch).toHaveBeenCalledOnce());
      expect(ingest).toHaveBeenCalledTimes(1);
      expect(ingestTextDeltaBatch).toHaveBeenCalledWith(conversationId, input.events.slice(1, 3));
      release();
      expect((await response).json().data.accepted_delivery_ids).toEqual(input.events.map(entry => entry.deliveryId));
      expect(ingest.mock.calls).toEqual([input.events[0], input.events[3]].map(entry => [conversationId, entry?.event, entry?.deliveryId]));
    } finally { release(); await response; }
  });

  it.each(["pending", "failure"])("does not acknowledge a %s text group or execute its following completion", async scenario => {
    const { ingest, ingestTextDeltaBatch, send } = await fixture();
    const input = textBatch();
    if (scenario === "pending") ingestTextDeltaBatch.mockResolvedValueOnce({ accepted: false });
    else ingestTextDeltaBatch.mockRejectedValueOnce(new Error("commit failed"));
    const response = await send(input);
    expect(response.json().data.accepted_delivery_ids).toEqual([input.events[0]?.deliveryId]);
    expect(ingest).toHaveBeenCalledTimes(1);
  });

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

  it.each([0, RUNNER_EVENT_BATCH_MAX_COUNT + 1])("rejects a batch with %s entries before ingestion", async (count) => {
    const { ingest, send } = await fixture();
    const input = batch();
    input.events = Array.from({ length: count }, () => ({ ...input.events[0]!, deliveryId: randomUUID() }));
    expect((await send(input)).statusCode).not.toBe(200);
    expect(ingest).not.toHaveBeenCalled();
  });

  it("accepts a full bounded text batch in one transaction request", async () => {
    const { ingest, ingestTextDeltaBatch, send } = await fixture();
    const input = textBatch();
    const entry = input.events[1];
    if (!entry) throw new Error("missing text fixture");
    input.events = Array.from({ length: RUNNER_EVENT_BATCH_MAX_COUNT }, () => ({ ...entry, deliveryId: randomUUID() }));
    expect((await send(input)).json().data.accepted_delivery_ids).toEqual(input.events.map(item => item.deliveryId));
    expect(ingestTextDeltaBatch).toHaveBeenCalledExactlyOnceWith(conversationId, input.events);
    expect(ingest).not.toHaveBeenCalled();
  });
});

function textBatch() {
  const input = batch();
  const delta = input.events[1];
  if (!delta) throw new Error("missing text fixture");
  input.events.splice(2, 0, { ...delta, deliveryId: randomUUID() });
  return input;
}
