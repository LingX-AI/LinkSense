import { describe, expect, it } from "vitest";

import {
  chatProviderUsage,
  responseProviderUsage,
} from "../src/modules/model-proxy/usage.js";

const usage = {
  input_tokens: 20,
  output_tokens: 10,
  total_tokens: 30,
  input_tokens_details: { cached_tokens: 5 },
  output_tokens_details: { reasoning_tokens: 3 },
};

describe("desktop provider usage parsing", () => {
  it("reads exact usage from a native response.completed terminal frame", () => {
    expect(responseProviderUsage({
      type: "response.completed",
      response: { status: "completed", usage },
    })).toEqual({
      status: "valid",
      usage: {
        totalTokens: 30,
        inputTokens: 20,
        cachedInputTokens: 5,
        outputTokens: 10,
        reasoningOutputTokens: 3,
      },
    });
  });

  it("reads exact usage from a native response.incomplete terminal frame", () => {
    expect(responseProviderUsage({
      type: "response.incomplete",
      response: { status: "incomplete", usage },
    })).toEqual({
      status: "valid",
      usage: {
        totalTokens: 30,
        inputTokens: 20,
        cachedInputTokens: 5,
        outputTokens: 10,
        reasoningOutputTokens: 3,
      },
    });
  });

  it("reads exact usage from a non-stream native response body", () => {
    expect(responseProviderUsage({ object: "response", status: "completed", usage })).toEqual({
      status: "valid",
      usage: {
        totalTokens: 30,
        inputTokens: 20,
        cachedInputTokens: 5,
        outputTokens: 10,
        reasoningOutputTokens: 3,
      },
    });
  });

  it("reads exact usage from a chat completion chunk", () => {
    expect(chatProviderUsage({
      choices: [],
      usage: {
        prompt_tokens: 12,
        completion_tokens: 4,
        total_tokens: 16,
        prompt_tokens_details: { cached_tokens: 2 },
        completion_tokens_details: { reasoning_tokens: 1 },
      },
    })).toEqual({
      status: "valid",
      usage: {
        totalTokens: 16,
        inputTokens: 12,
        cachedInputTokens: 2,
        outputTokens: 4,
        reasoningOutputTokens: 1,
      },
    });
  });

  it("distinguishes missing from invalid terminal usage", () => {
    expect(responseProviderUsage({
      type: "response.completed", response: { status: "completed" },
    })).toBeNull();
    expect(responseProviderUsage({
      type: "response.completed",
      response: { status: "completed", usage: null },
    })).toBeNull();
    expect(chatProviderUsage({ choices: [], usage: null })).toBeNull();
    expect(responseProviderUsage({
      type: "response.completed",
      response: { status: "completed", usage: { input_tokens: -1, output_tokens: 1 } },
    })).toEqual({ status: "invalid" });
    expect(responseProviderUsage({
      type: "response.completed",
      response: { status: "completed", usage: { input_tokens: 2, output_tokens: 1, total_tokens: 3, input_tokens_details: { cached_tokens: 3 } } },
    })).toEqual({ status: "invalid" });
  });

  it("ignores non-terminal native frames and derives a missing total", () => {
    expect(responseProviderUsage({
      type: "response.output_item.done", item: { type: "message" }, usage,
    })).toBeNull();
    expect(responseProviderUsage({
      type: "response.completed",
      response: { status: "completed", usage: { input_tokens: 2, output_tokens: 3 } },
    })).toEqual({
      status: "valid",
      usage: {
        totalTokens: 5,
        inputTokens: 2,
        cachedInputTokens: 0,
        outputTokens: 3,
        reasoningOutputTokens: 0,
      },
    });
  });
});
