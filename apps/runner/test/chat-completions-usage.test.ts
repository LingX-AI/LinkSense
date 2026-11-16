import { describe, expect, it } from "vitest";

import { buildChatCompletionRequest, chatCompletionStreamToResponses, type ResponsesStreamEvent } from "../src/model-gateway/chat-completions-bridge.js";

describe("streaming Chat Completions provider usage", () => {
  it("requests the final provider usage chunk for existing streaming channel payloads", () => {
    expect(buildChatCompletionRequest({ model: "test-model", input: "Hello" }, true)).toMatchObject({
      stream: true, stream_options: { include_usage: true },
    });
  });

  it("does not add streaming options to a non-streaming request", () => {
    expect(buildChatCompletionRequest({ model: "test-model", input: "Hello" }, false)).not.toHaveProperty("stream_options");
  });

  it("preserves the conditional final usage chunk without fabricating counts or mutating the source", async () => {
    const source = { model: "test-model", input: "Hello" };
    const request = buildChatCompletionRequest(source, true);
    const options = request.stream_options;
    const includesUsage = typeof options === "object" && options !== null && "include_usage" in options && options.include_usage === true;
    const frames: unknown[] = [{ choices: [{ delta: { content: "Hello." } }] }];
    if (includesUsage) frames.push({ choices: [], usage: {
      prompt_tokens: 80, completion_tokens: 20, total_tokens: 100,
      prompt_tokens_details: { cached_tokens: 30 },
      completion_tokens_details: { reasoning_tokens: 5 },
    } });
    const upstream = new Response(frames.map(frame => `data: ${JSON.stringify(frame)}\n\n`).join("") + "data: [DONE]\n\n");
    const events: ResponsesStreamEvent[] = [];
    for await (const event of chatCompletionStreamToResponses(upstream, "test-model")) events.push(event);
    expect(events.at(-1)).toMatchObject({ event: "response.completed", data: { response: { usage: {
      input_tokens: 80, output_tokens: 20, total_tokens: 100,
      input_tokens_details: { cached_tokens: 30 }, output_tokens_details: { reasoning_tokens: 5 },
    } } } });
    expect(source).toEqual({ model: "test-model", input: "Hello" });
  });
});
