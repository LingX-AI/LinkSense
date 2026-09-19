import { describe, expect, it, vi } from "vitest";
import Fastify from "fastify";
import { bindTaskLatency, finishTaskRequest, measureTaskStage, withTaskLatencyContext } from "../src/lib/task-latency.js";

describe("task latency", () => {
  it.each(["application_runtime_resolution", "application_home_prepare", "conversation_storage_prepare", "application_development_open"] as const)("measures %s without recording application content", async stage => {
    let now = 10;
    const log = { info: vi.fn() };
    const result = await withTaskLatencyContext(log, () => measureTaskStage(stage, async () => {
      now += 25;
      return { privateSource: "application source" };
    }), () => now);
    expect(result.privateSource).toBe("application source");
    expect(log.info).toHaveBeenCalledExactlyOnceWith({ stage, outcome: "ok", durationMs: 25, elapsedMs: 25 }, "task admission latency");
    expect(JSON.stringify(log.info.mock.calls)).not.toContain("application source");
  });

  it("keeps the trace through the Fastify request, service and response hooks", async () => {
    const app = Fastify();
    const log = { info: vi.fn() };
    app.addHook("onRequest", (_request, _reply, done) => { withTaskLatencyContext(log, done); });
    app.addHook("onResponse", async () => { finishTaskRequest(); });
    app.get("/task", async () => {
      bindTaskLatency({ conversationId: "task" });
      return measureTaskStage("runner_accept", async () => ({ accepted: true }));
    });
    try {
      expect((await app.inject({ url: "/task" })).statusCode).toBe(200);
      expect(log.info.mock.calls.map(([fields]) => [fields.conversationId, fields.stage])).toEqual([["task", "runner_accept"], ["task", "http_response"]]);
    } finally { await app.close(); }
  });
  it("keeps parallel request identities separate and logs only bounded metadata", async () => {
    let time = 10;
    const log = { info: vi.fn() };
    await Promise.all(["one", "two"].map(conversationId => withTaskLatencyContext(log, async () => {
      bindTaskLatency({ conversationId });
      await measureTaskStage("runner_accept", async () => { await Promise.resolve(); time += 5; return "secret response"; });
      finishTaskRequest();
    }, () => time)));
    expect(log.info.mock.calls.map(([fields]) => fields.conversationId).sort()).toEqual(["one", "one", "two", "two"]);
    expect(JSON.stringify(log.info.mock.calls)).not.toContain("secret");
    expect(log.info.mock.calls.every(([fields]) => Number(fields.elapsedMs) >= 0)).toBe(true);
  });

  it("preserves failures without recording their sensitive messages", async () => {
    const log = { info: vi.fn() };
    const failure = new Error("secret token");
    await expect(withTaskLatencyContext(log, () => measureTaskStage("start_admission", async () => { throw failure; }))).rejects.toBe(failure);
    expect(log.info).toHaveBeenCalledWith(expect.objectContaining({ outcome: "error" }), "task admission latency");
    expect(JSON.stringify(log.info.mock.calls)).not.toContain("secret");
  });
});
