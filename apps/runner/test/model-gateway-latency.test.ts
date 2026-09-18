import { describe, expect, it, vi } from "vitest";
import { UpstreamLatency } from "../src/model-gateway/latency.js";

describe("upstream latency", () => {
  it("distinguishes headers, protocol traffic, whitespace and the first real text", () => {
    let time = 100;
    const emit = vi.fn();
    const latency = new UpstreamLatency(emit, () => time);
    time = 130;
    latency.mark("upstream_headers");
    time = 150;
    latency.event({ type: "response.created" });
    latency.event({ type: "response.output_text.delta", delta: "  " });
    time = 400;
    latency.event({ type: "response.output_text.delta", delta: "private text" });
    latency.event({ type: "response.output_text.delta", delta: "later" });
    expect(emit.mock.calls.map(call => call[0])).toEqual([
      { stage: "upstream_headers", elapsedMs: 30 },
      { stage: "upstream_first_byte", elapsedMs: 50 },
      { stage: "upstream_first_text", elapsedMs: 300 },
    ]);
    expect(JSON.stringify(emit.mock.calls)).not.toContain("private text");
  });

  it.each(["responses", "chat"])("passes fragmented %s bytes unchanged and records text only once", async protocol => {
    const emit = vi.fn();
    const latency = new UpstreamLatency(emit);
    const payload = protocol === "responses"
      ? { type: "response.output_text.delta", delta: "中文" }
      : { choices: [{ delta: { content: "中文" } }] };
    const bytes = new TextEncoder().encode(`data: invalid\n\ndata: ${JSON.stringify(payload)}\n\ndata: [DONE]\n\n`);
    const source = new ReadableStream<Uint8Array>({ start(controller) {
      for (const byte of bytes) controller.enqueue(Uint8Array.of(byte));
      controller.close();
    } });
    const result = await new Response(latency.stream(source, true)).arrayBuffer();
    expect(new Uint8Array(result)).toEqual(bytes);
    expect(emit.mock.calls.filter(([sample]) => sample.stage === "upstream_first_text")).toHaveLength(1);
    expect(emit.mock.lastCall?.[0].stage).toBe("upstream_end");
  });

  it("propagates cancellation upstream without marking an incomplete stream ended", async () => {
    const cancel = vi.fn();
    const emit = vi.fn();
    const source = new ReadableStream<Uint8Array>({ cancel });
    await new UpstreamLatency(emit).stream(source, true).cancel();
    await vi.waitFor(() => expect(cancel).toHaveBeenCalledOnce());
    expect(emit).not.toHaveBeenCalled();
  });
});
