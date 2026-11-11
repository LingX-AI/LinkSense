import { describe, expect, it } from "vitest";
import { applicationKindSchema } from "../src/application-kind.js";
import { publicKnowledgeRunnerProgressSchema } from "../src/events.js";
import {
  limitPublicKnowledgeOutput,
  publicKnowledgeOutputLimit,
} from "../src/public-knowledge-output.js";
import {
  publicKnowledgeQuestionSchema,
  publicKnowledgeSettingsSchema,
  publicKnowledgeSaveInputSchema,
  publicKnowledgeSkillsSchema,
  publicKnowledgeStatusInputSchema,
  publicKnowledgeUsageQuerySchema,
} from "../src/public-knowledge.js";

describe("public knowledge contracts", () => {
  it("accepts an optional preset or upload separately from bounded persistent settings", () => {
    const settings = publicKnowledgeSettingsSchema.parse({
      name: "Website",
      instructions: "Answer from evidence",
      model: "model",
      reasoning_effort: "medium",
      knowledge_base_ids: ["00000000-0000-4000-8000-000000000001"],
      allowed_origins: ["https://example.test"],
    });
    expect(publicKnowledgeSaveInputSchema.parse(settings)).toEqual(settings);
    for (const icon of [
      { type: "preset", preset: "book-open" },
      { type: "upload", filename: "website.png", mime_type: "image/png", data_base64: "AAAA".repeat(25_000) },
    ]) {
      expect(publicKnowledgeSaveInputSchema.parse({ ...settings, icon }).icon).toEqual(icon);
      expect(publicKnowledgeSettingsSchema.safeParse({ ...settings, icon }).success).toBe(false);
    }
    for (const icon of [
      { type: "preset", preset: "unknown" },
      { type: "custom", url: "https://example.test/foreign.png", fallback_preset: "bot" },
      { type: "upload", filename: "website.svg", mime_type: "image/svg+xml", data_base64: "AAAA" },
      { type: "upload", filename: "website.png", mime_type: "image/png", data_base64: "AAAA".repeat(180_000) },
    ]) expect(publicKnowledgeSaveInputSchema.safeParse({ ...settings, icon }).success).toBe(false);
    expect(publicKnowledgeSaveInputSchema.safeParse({
      ...settings,
      instructions: "中".repeat(20_000),
      description: "中".repeat(4_000),
      icon: { type: "preset", preset: "bot" },
    }).success).toBe(false);
  });

  it("shares the output budget between chunks and saved text without splitting Unicode characters", () => {
    expect(limitPublicKnowledgeOutput("small")).toBe("small");
    expect(limitPublicKnowledgeOutput("abc", 0)).toBe("");
    expect(limitPublicKnowledgeOutput("a🦄", 2)).toBe("a");
    expect(
      limitPublicKnowledgeOutput("中".repeat(publicKnowledgeOutputLimit + 1)),
    ).toHaveLength(publicKnowledgeOutputLimit);
    for (const budget of [-1, 0.1, Number.NaN, publicKnowledgeOutputLimit + 1])
      expect(() => limitPublicKnowledgeOutput("text", budget)).toThrow(
        RangeError,
      );
  });
  it("binds public progress to its conversation and operation while rejecting raw reasoning and tool calls", () => {
    const threadId = "00000000-0000-4000-8000-000000000001",
      turnId = "00000000-0000-4000-8000-000000000002";
    const wrapper = (notification: unknown) => ({
      method: "linksense/publicKnowledge/progress",
      visibility: "user_visible",
      params: { threadId, turnId, notification },
    });
    const delta = {
      method: "item/agentMessage/delta",
      visibility: "user_visible",
      params: {
        threadId,
        turnId,
        itemId: "public-message",
        delta: "Live answer",
      },
    };
    expect(
      publicKnowledgeRunnerProgressSchema.safeParse(wrapper(delta)).success,
    ).toBe(true);
    for (const forbidden of [
      {
        ...delta,
        params: {
          ...delta.params,
          threadId: "00000000-0000-4000-8000-000000000003",
        },
      },
      {
        method: "item/reasoning/textDelta",
        visibility: "user_collapsed",
        params: {
          threadId,
          turnId,
          itemId: "reason",
          delta: "private",
          contentIndex: 0,
        },
      },
      {
        method: "item/started",
        visibility: "user_collapsed",
        params: {
          threadId,
          turnId,
          item: {
            type: "reasoning",
            id: "reason",
            summary: [],
            content: ["private"],
          },
        },
      },
      {
        method: "item/started",
        visibility: "user_collapsed",
        params: {
          threadId,
          turnId,
          item: {
            type: "userMessage",
            id: "input",
            content: [{ type: "text", text: "private" }],
          },
        },
      },
      {
        method: "item/started",
        visibility: "user_collapsed",
        params: {
          threadId,
          turnId,
          item: {
            type: "mcpToolCall",
            id: "tool",
            server: "private",
            tool: "secret",
            status: "inProgress",
          },
        },
      },
    ])
      expect(
        publicKnowledgeRunnerProgressSchema.safeParse(wrapper(forbidden))
          .success,
      ).toBe(false);
  });
  it("accepts only explicit access status and compares usage timestamps by instant", () => {
    expect(publicKnowledgeStatusInputSchema.parse({ enabled: false })).toEqual({
      enabled: false,
    });
    expect(
      publicKnowledgeStatusInputSchema.safeParse({ enabled: "false" }).success,
    ).toBe(false);
    expect(
      publicKnowledgeUsageQuerySchema.safeParse({
        from: "2026-11-05T00:00:00Z",
        to: "2026-11-05T00:00:00.999Z",
      }).success,
    ).toBe(true);
    expect(
      publicKnowledgeUsageQuerySchema.safeParse({
        from: "2026-11-06T00:00:00Z",
        to: "2026-11-05T00:00:00Z",
      }).success,
    ).toBe(false);
  });
  it("preserves existing kinds and recognizes the dedicated public kind", () => {
    for (const kind of ["standard", "interactive", "public_knowledge"])
      expect(applicationKindSchema.parse(kind)).toBe(kind);
  });
  it("requires knowledge, an explicit model and exact website origins", () => {
    const input = {
      name: "Website",
      instructions: "Answer from knowledge.",
      model: "model",
      reasoning_effort: "medium",
      knowledge_base_ids: ["00000000-0000-4000-8000-000000000001"],
      allowed_origins: ["https://example.com"],
    };
    expect(
      publicKnowledgeSettingsSchema.parse(input).max_concurrent_turns,
    ).toBe(20);
    expect(publicKnowledgeSettingsSchema.parse(input).skill_ids).toEqual([]);
    const skill = "00000000-0000-4000-8000-000000000002";
    expect(
      publicKnowledgeSettingsSchema.parse({ ...input, skill_ids: [skill] })
        .skill_ids,
    ).toEqual([skill]);
    for (const invalid of [
      { knowledge_base_ids: [] },
      { allowed_origins: ["*"] },
      { model: null },
      { max_concurrent_turns: 21 },
      { retention_days: 0 },
      { mcp_server_ids: [] },
      { skill_ids: [skill, skill] },
      { skill_ids: ["invalid"] },
    ]) {
      expect(
        publicKnowledgeSettingsSchema.safeParse({ ...input, ...invalid })
          .success,
      ).toBe(false);
    }
  });
  it("bounds selected Skill guidance and rejects duplicated identities", () => {
    const skill = {
      id: crypto.randomUUID(),
      name: "guide",
      markdown: "instructions",
    };
    expect(publicKnowledgeSkillsSchema.parse([skill])).toEqual([skill]);
    expect(publicKnowledgeSkillsSchema.safeParse([skill, skill]).success).toBe(
      false,
    );
    expect(
      publicKnowledgeSkillsSchema.safeParse([
        { ...skill, markdown: "x".repeat(128_001) },
      ]).success,
    ).toBe(false);
    expect(
      publicKnowledgeSkillsSchema.safeParse(
        Array.from({ length: 5 }, () => ({
          ...skill,
          id: crypto.randomUUID(),
          markdown: "中".repeat(50_000),
        })),
      ).success,
    ).toBe(false);
  });
  it("bounds anonymous questions and requires an idempotency identity", () => {
    expect(
      publicKnowledgeQuestionSchema.safeParse({
        input_text: " ",
        request_id: crypto.randomUUID(),
      }).success,
    ).toBe(false);
    expect(
      publicKnowledgeQuestionSchema.safeParse({
        input_text: "a".repeat(4001),
        request_id: crypto.randomUUID(),
      }).success,
    ).toBe(false);
    expect(
      publicKnowledgeQuestionSchema.safeParse({
        input_text: "hello",
        request_id: crypto.randomUUID(),
        model: "override",
      }).success,
    ).toBe(false);
  });
  it("keeps pre-display settings usable at the previous encoded-size limit", () => {
    const parsed = publicKnowledgeSettingsSchema.parse({
      name: "Website",
      instructions: "Original instructions",
      model: "model",
      reasoning_effort: "medium",
      knowledge_base_ids: ["00000000-0000-4000-8000-000000000001"],
      allowed_origins: ["https://example.com"],
    });
    const legacy: Record<string, unknown> = Object.fromEntries(
      Object.entries(parsed).filter(([key]) => key !== "show_references"),
    );
    const remaining =
      60_000 -
      new TextEncoder().encode(JSON.stringify({ ...legacy, instructions: "" }))
        .byteLength;
    legacy.instructions =
      "中".repeat(Math.floor(remaining / 3)) + "x".repeat(remaining % 3);
    expect(new TextEncoder().encode(JSON.stringify(legacy)).byteLength).toBe(
      60_000,
    );
    expect(publicKnowledgeSettingsSchema.parse(legacy).show_references).toBe(
      true,
    );
    expect(
      publicKnowledgeSettingsSchema.parse({ ...legacy, show_references: false })
        .show_references,
    ).toBe(false);
  });
  it("bounds encoded settings before multilingual or escaped content can exceed database JSON limits", () => {
    const input = {
      name: "官网问答",
      instructions: "官网产品知识",
      model: "model",
      reasoning_effort: "medium",
      knowledge_base_ids: ["00000000-0000-4000-8000-000000000001"],
      allowed_origins: ["https://example.com"],
    };
    expect(publicKnowledgeSettingsSchema.safeParse(input).success).toBe(true);
    expect(
      publicKnowledgeSettingsSchema.safeParse({
        ...input,
        instructions: "中".repeat(20_000),
        description: "中".repeat(4_000),
      }).success,
    ).toBe(false);
    expect(
      publicKnowledgeSettingsSchema.safeParse({
        ...input,
        instructions: "\u0001".repeat(20_000),
      }).success,
    ).toBe(false);
  });
});
