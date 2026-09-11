import { describe, expect, it } from "vitest";

import { runnerTextDeltaBatchKey } from "./events.js";

const notification = { method: "item/agentMessage/delta", params: { threadId: "thread", turnId: "turn", itemId: "item", delta: "原文" } };

describe("text delta batch eligibility", () => {
  it.each(["item/agentMessage/delta", "item/plan/delta", "item/reasoning/summaryTextDelta"])("recognizes %s without incorporating or changing its text", method => {
    const input = { ...notification, method, params: { ...notification.params, summaryIndex: 0 } };
    expect(runnerTextDeltaBatchKey(input)).not.toBeNull();
    expect(runnerTextDeltaBatchKey(input)).toBe(runnerTextDeltaBatchKey({ ...input, params: { ...input.params, delta: "下一段" } }));
    expect(input.params.delta).toBe("原文");
  });

  it.each(["item/completed", "turn/completed", "error", "item/tool/requestUserInput", "serverRequest/resolved", "thread/started", "item/reasoning/summaryPartAdded", "a/new/future/event"])("treats %s as a boundary by default", method => {
    expect(runnerTextDeltaBatchKey({ ...notification, method })).toBeNull();
  });

  it("separates methods, threads, turns, items and summary sections", () => {
    const key = runnerTextDeltaBatchKey(notification);
    for (const field of ["threadId", "turnId", "itemId"] as const) {
      expect(runnerTextDeltaBatchKey({ ...notification, params: { ...notification.params, [field]: "changed" } })).not.toBe(key);
    }
    const reasoning = { ...notification, method: "item/reasoning/summaryTextDelta", params: { ...notification.params, summaryIndex: 0 } };
    expect(runnerTextDeltaBatchKey(reasoning)).not.toBe(key);
    expect(runnerTextDeltaBatchKey({ ...reasoning, params: { ...reasoning.params, summaryIndex: 1 } })).not.toBe(runnerTextDeltaBatchKey(reasoning));
  });

  it.each([null, {}, { ...notification, preparation: { turnId: "local-turn" } }, { ...notification, params: {} }, { ...notification, params: { ...notification.params, delta: 7 } }, { ...notification, method: "item/reasoning/summaryTextDelta" }])("rejects invalid or preparation input %# from batching", input => {
    expect(runnerTextDeltaBatchKey(input)).toBeNull();
  });
});
