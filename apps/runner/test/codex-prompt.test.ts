import { describe, expect, it } from "vitest";

import { serializePromptLink } from "../src/codex/prompt.js";

describe("serializePromptLink", () => {
  it.each([
    ["@office", "plugin://office@personal", "[@office](plugin://office@personal)"],
    ["$reports", "/home/user/.agents/skills/reports/SKILL.md", "[$reports](/home/user/.agents/skills/reports/SKILL.md)"],
    ["资料.pdf", "attachments/资料.pdf", "[资料.pdf](attachments/资料.pdf)"],
    ["a](b)\\c", "folder/a(b)\\c", "[a\\]\\(b)\\\\c](folder/a(b\\)\\\\c)"],
  ])("serializes %s using the desktop prompt-link escaping contract", (label, path, expected) => {
    expect(serializePromptLink(label, path)).toBe(expected);
  });

  it.each(["line\nbreak", "line\rbreak", "null\0byte"])(
    "rejects control characters in a reference instead of injecting prompt structure",
    (value) => {
      expect(() => serializePromptLink(value, "/skill/SKILL.md")).toThrow();
      expect(() => serializePromptLink("$skill", value)).toThrow();
    },
  );
});
