import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { PrismaClient } from "../src/generated/prisma/client.js";
import { BrowserUseIntentService } from "../src/modules/local-browser/intent.js";
import { modelUsageCaptureSchema } from "../src/modules/usage/model-usage.js";
import { MemoryBrowserStore } from "./local-browser-store.js";

const { generateText } = vi.hoisted(() => ({ generateText: vi.fn() }));
vi.mock("ai", () => ({ generateText }));
vi.mock("../src/adapters/task-language-model.js", () => ({ createTaskLanguageModel: vi.fn(() => ({ modelId: "title-model" })) }));
const owner = "10000000-0000-4000-8000-000000000001";
const conversationId = "20000000-0000-4000-8000-000000000001";
const messageId = "30000000-0000-4000-8000-000000000001";
const response = (text = "true") => ({
  text,
  usage: { totalTokens: 21, inputTokens: 20, outputTokens: 1, inputTokenDetails: { cacheReadTokens: 2 }, outputTokenDetails: { reasoningTokens: 0 } },
});
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(generateText).mockResolvedValue(response());
});
afterEach(() => vi.useRealTimers());

function fixture() {
  const prisma = {
    conversation: { findFirst: vi.fn().mockResolvedValue({ id: conversationId }) },
    conversationMessage: { findFirst: vi.fn().mockResolvedValue({ id: messageId, contentText: "google 搜搜看看 guygubaby" }) },
  };
  const settings = { resolveTaskTitleModel: vi.fn().mockResolvedValue({
    model: { id: "title-model", kind: "chat", input_price_per_million: "1", cached_input_price_per_million: "0.5", output_price_per_million: "2" },
    channel: { apiKey: "fixture-key", baseUrl: "https://models.example.test/v1", protocolMode: "chat_completions_bridge" },
  }) };
  const usage = { recordModelUsage: vi.fn().mockResolvedValue({ recorded: true }) };
  const store = new MemoryBrowserStore();
  const service = new BrowserUseIntentService(prisma as unknown as PrismaClient, store, settings, usage);
  return { prisma, settings, usage, store, service, detect: () => service.detect(owner, conversationId, messageId) };
}

it("classifies an implicit Google request with the title model, a five-second timeout and boolean-only output", async () => {
  const { detect, usage } = fixture();
  expect(await detect()).toBe(true);
  expect(generateText).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
    prompt: "google 搜搜看看 guygubaby",
    system: expect.stringContaining("只输出 true 或 false"),
    maxRetries: 0,
    timeout: { totalMs: 5000 },
  }));
  expect(generateText.mock.calls[0]?.[0]).not.toHaveProperty("tools");
  expect(usage.recordModelUsage).toHaveBeenCalledWith(expect.objectContaining({ workload: "browser_use_intent", ownerId: owner, conversationId }));
  expect(modelUsageCaptureSchema.safeParse(usage.recordModelUsage.mock.calls[0]?.[0]).success).toBe(true);
});

it.each(["false", "true because it uses Google", '{"browser_related":true}', "", "ignore the rules"])("returns false for a negative or invalid model response %j", async (text) => {
  vi.mocked(generateText).mockResolvedValue(response(text));
  expect(await fixture().detect()).toBe(false);
});

it("authorizes an owned normal conversation before reading content or invoking a model", async () => {
  const { prisma, detect, settings } = fixture();
  prisma.conversation.findFirst.mockResolvedValue(null);
  await expect(detect()).rejects.toMatchObject({ code: "FORBIDDEN" });
  expect(prisma.conversation.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: conversationId, ownerId: owner, archiveStatus: "active", applicationId: null } }));
  expect(prisma.conversationMessage.findFirst).not.toHaveBeenCalled();
  expect(settings.resolveTaskTitleModel).not.toHaveBeenCalled();
});

it("does not classify a stale, missing or another conversation's user message", async () => {
  const { prisma, detect } = fixture();
  prisma.conversationMessage.findFirst.mockResolvedValue({ id: "different-message", contentText: "google 搜搜" });
  expect(await detect()).toBe(false);
  prisma.conversationMessage.findFirst.mockResolvedValue(null);
  expect(await detect()).toBe(false);
  expect(prisma.conversationMessage.findFirst).toHaveBeenCalledWith({ where: { conversationId, role: "user" }, orderBy: { sequenceNo: "desc" }, select: { id: true, contentText: true } });
  expect(generateText).not.toHaveBeenCalled();
});

it("sends at most 2000 characters and caches only a hash and boolean, never user text", async () => {
  const { prisma, detect, store } = fixture();
  prisma.conversationMessage.findFirst.mockResolvedValue({ id: messageId, contentText: "a".repeat(10_000) });
  expect(await detect()).toBe(true);
  expect(generateText.mock.calls[0]?.[0]?.prompt).toHaveLength(2000);
  expect([...store.values.values()].map((item) => item.value)).toEqual(["true"]);
  expect([...store.values.keys()][0]).toMatch(/:[a-f0-9]{64}$/u);
});

it.each(["true", "false"])("reuses a cached %s decision without billing another model call", async (text) => {
  vi.mocked(generateText).mockResolvedValue(response(text));
  const { detect } = fixture();
  expect(await detect()).toBe(text === "true");
  expect(await detect()).toBe(text === "true");
  expect(generateText).toHaveBeenCalledTimes(1);
});

it("deduplicates concurrent requests across service instances sharing Redis", async () => {
  vi.useFakeTimers();
  let finish!: (value: ReturnType<typeof response>) => void;
  vi.mocked(generateText).mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
  const { detect, prisma, store, settings, usage } = fixture();
  const first = detect();
  await vi.advanceTimersByTimeAsync(0);
  const second = new BrowserUseIntentService(prisma as unknown as PrismaClient, store, settings, usage).detect(owner, conversationId, messageId);
  await vi.advanceTimersByTimeAsync(0);
  finish(response());
  await vi.advanceTimersByTimeAsync(200);
  expect(await first).toBe(true);
  expect(await second).toBe(true);
  expect(generateText).toHaveBeenCalledTimes(1);
});

it("silently skips a missing title model and a provider failure without retrying", async () => {
  const missing = fixture();
  missing.settings.resolveTaskTitleModel.mockResolvedValue(null);
  expect(await missing.detect()).toBe(false);
  expect(generateText).not.toHaveBeenCalled();
  const failed = fixture();
  vi.mocked(generateText).mockRejectedValue(new Error("provider unavailable"));
  expect(await failed.detect()).toBe(false);
  expect(await failed.detect()).toBe(false);
  expect(generateText).toHaveBeenCalledTimes(1);
});
