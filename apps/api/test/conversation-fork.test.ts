import { describe, expect, it } from "vitest";

import {
  forkBaseTitle,
  forkedConversationTitle,
  isValidForkedThreadHistory,
  remapForkedJson,
} from "../src/modules/conversations/fork.js";

describe("conversation fork helpers", () => {
  it("uses ASCII parentheses and preserves the original base title", () => {
    expect(forkedConversationTitle("任务", 2)).toBe("任务(2)");
    expect(forkedConversationTitle("任务", 3)).toBe("任务(3)");
    expect(forkBaseTitle("任务(2)", 2)).toBe("任务");
  });

  it("keeps the suffix when truncating a long Unicode title", () => {
    const title = forkedConversationTitle("🙂".repeat(240), 12);
    expect(Array.from(title)).toHaveLength(240);
    expect(title).toMatch(/…\(12\)$/u);
  });

  it("recursively remaps copied identifiers without replacing substrings", () => {
    const sourceId = "10000000-0000-4000-8000-000000000001";
    const targetId = "20000000-0000-4000-8000-000000000001";
    expect(
      remapForkedJson(
        {
          id: sourceId,
          nested: [sourceId, `prefix:${sourceId}`],
        },
        new Map([[sourceId, targetId]]),
      ),
    ).toEqual({
      id: targetId,
      nested: [targetId, `prefix:${sourceId}`],
    });
  });

  it("accepts internal native turns while preserving every visible turn through the target", () => {
    expect(
      isValidForkedThreadHistory(
        ["visible-1", "internal-resume", "visible-2"],
        ["visible-1", "visible-2"],
      ),
    ).toBe(true);
  });

  it.each([
    {
      native: ["visible-1", "visible-2"],
      persisted: ["visible-1", "missing", "visible-2"],
    },
    {
      native: ["visible-2", "visible-1"],
      persisted: ["visible-1", "visible-2"],
    },
    {
      native: ["visible-1", "visible-2", "later-internal"],
      persisted: ["visible-1", "visible-2"],
    },
    { native: [], persisted: [] },
  ])("rejects an invalid forked native history %#", ({ native, persisted }) => {
    expect(isValidForkedThreadHistory(native, persisted)).toBe(false);
  });
});
