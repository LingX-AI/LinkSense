import { describe, expect, it } from "vitest";

import { prepareCodexAdditionalContext } from "../src/codex/additional-context.js";

describe("native additional context transport", () => {
  it.each(["application", "untrusted"] as const)(
    "preserves every Unicode character and the %s trust boundary",
    (kind) => {
      const value = "应用🙂e\u0301\n".repeat(2_000);
      const output = prepareCodexAdditionalContext({ source: { kind, value } });
      const parts = Object.entries(output)
        .filter(([key]) => key.startsWith("source.part."))
        .sort(([a], [b]) => a.localeCompare(b));
      expect(parts.length).toBeGreaterThan(1);
      expect(parts.map(([, entry]) => entry.value.split("\n").slice(1).join("\n")).join("")).toBe(value);
      for (const [, entry] of parts) {
        expect(entry.kind).toBe(kind);
        expect(Buffer.byteLength(entry.value)).toBeLessThanOrEqual(4_000);
        expect(entry.value).not.toContain("\ufffd");
      }
      expect(output.source?.kind).toBe(kind);
      expect(output.source?.value).toContain("supersedes");
    },
  );

  it("leaves short fragments unchanged and never mutates its input", () => {
    const input = { short: { kind: "untrusted" as const, value: "name only" } };
    expect(prepareCodexAdditionalContext(input)).toEqual(input);
    expect(input).toEqual({ short: { kind: "untrusted", value: "name only" } });
  });

  it("binds changed multipart content to a new digest and emits no obsolete parts", () => {
    const before = prepareCodexAdditionalContext({ app: { kind: "application", value: "a".repeat(20_000) } });
    const after = prepareCodexAdditionalContext({ app: { kind: "application", value: "b".repeat(5_000) } });
    expect(after.app?.value).not.toBe(before.app?.value);
    expect(Object.keys(after).length).toBeLessThan(Object.keys(before).length);
    const short = prepareCodexAdditionalContext({ app: { kind: "application", value: "replacement" } });
    expect(Object.keys(short)).toEqual(["app"]);
    expect(prepareCodexAdditionalContext({})).toEqual({});
  });

  it("rejects a source key collision instead of overwriting trusted context", () => {
    expect(() => prepareCodexAdditionalContext({
      source: { kind: "untrusted", value: "x".repeat(5_000) },
      "source.part.0001": { kind: "application", value: "policy" },
    })).toThrow("context fragment key collision");
  });
});
