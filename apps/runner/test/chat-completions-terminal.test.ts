import { describe, expect, it } from "vitest";

import {
  chatCompletionStreamToResponses,
  chatCompletionToResponse,
  type ResponsesStreamEvent,
} from "../src/model-gateway/chat-completions-bridge.js";

const textChunk = { choices: [{ delta: { content: "Partial answer." } }] };
const toolCall = {
  index: 0, id: "call-review", type: "function",
  function: { name: "inspect_workspace", arguments: '{"path":"README.md"}' },
};
const toolChunk = { choices: [{ delta: { tool_calls: [toolCall] } }] };
const sse = (value: unknown): string => `data: ${JSON.stringify(value)}\n\n`;

async function collect(source: string): Promise<ResponsesStreamEvent[]> {
  const events: ResponsesStreamEvent[] = [];
  for await (const event of chatCompletionStreamToResponses(new Response(source), "test-model")) {
    events.push(event);
  }
  return events;
}

describe("Chat Completions terminal response semantics", () => {
  it.each([textChunk, toolChunk])("rejects EOF before termination without completing text or tools", async (chunk) => {
    const events: ResponsesStreamEvent[] = [];
    const read = async () => {
      for await (const event of chatCompletionStreamToResponses(new Response(sse(chunk)), "test-model")) {
        events.push(event);
      }
    };
    await expect(read()).rejects.toThrow();
    expect(events.map(event => event.event)).not.toContain("response.completed");
    expect(events.map(event => event.event)).not.toContain("response.output_item.done");
    expect(events.map(event => event.event)).not.toContain("response.function_call_arguments.done");
  });

  it("rejects an empty stream instead of inventing a completed answer", async () => {
    await expect(collect("")).rejects.toThrow();
  });

  it.each(["stop", "tool_calls", "function_call"])("accepts the valid terminal reason %s without requiring a trailing sentinel", async (finishReason) => {
    const events = await collect(sse(textChunk) + sse({ choices: [{ delta: {}, finish_reason: finishReason }] }));
    expect(events.at(-1)).toMatchObject({ event: "response.completed", data: { response: { status: "completed" } } });
  });

  it("preserves existing providers that terminate with DONE and omit finish_reason", async () => {
    const events = await collect(sse(textChunk) + "data: [DONE]\n\n");
    expect(events.at(-1)).toMatchObject({ event: "response.completed", data: { response: { output_text: "Partial answer." } } });
  });

  it.each([
    ["length", "max_output_tokens"],
    ["content_filter", "content_filter"],
  ])("maps %s to the native incomplete response and preserves usage", async (finishReason, reason) => {
    const events = await collect(sse(textChunk) + sse(toolChunk) + sse({ choices: [{ delta: {}, finish_reason: finishReason }] }) + sse({ choices: [], usage: { prompt_tokens: 8, completion_tokens: 2, total_tokens: 10 } }) + "data: [DONE]\n\n");
    expect(events.at(-1)).toMatchObject({ event: "response.incomplete", data: { response: {
      status: "incomplete", incomplete_details: { reason },
      usage: { input_tokens: 8, output_tokens: 2, total_tokens: 10 },
      output: [expect.objectContaining({ status: "incomplete" }), expect.objectContaining({ status: "incomplete" })],
    } } });
    expect(events.map(event => event.event)).not.toContain("response.completed");
    expect(events.map(event => event.event)).not.toContain("response.output_item.done");
    expect(events.map(event => event.event)).not.toContain("response.function_call_arguments.done");
  });

  it("rejects an unknown finish reason instead of promoting it to success", async () => {
    await expect(collect(sse({ choices: [{ delta: {}, finish_reason: "unsupported-reason" }] }) + "data: [DONE]\n\n")).rejects.toThrow();
  });

  it.each([
    ["length", "max_output_tokens"],
    ["content_filter", "content_filter"],
  ])("preserves %s for non-streaming responses as well", (finishReason, reason) => {
    const response = chatCompletionToResponse({ choices: [{
      finish_reason: finishReason,
      message: { content: "Partial answer.", tool_calls: [toolCall] },
    }] }, "test-model");
    expect(response).toMatchObject({ status: "incomplete", incomplete_details: { reason } });
    expect(response.output).toEqual([expect.objectContaining({ status: "incomplete" }), expect.objectContaining({ status: "incomplete" })]);
  });
});
