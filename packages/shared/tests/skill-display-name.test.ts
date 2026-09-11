import { describe, expect, it } from "vitest";
import {
  capabilityDisplayName,
  formatSkillName,
  skillDisplayName,
  skillDisplayNameSchema,
} from "../src/skill-display-name.js";

describe("skill display names", () => {
  it("keeps generated titles within the display limit when word boundaries expand a valid identifier", () => {
    const formatted = formatSkillName("a1".repeat(32));
    expect(formatted).toMatch(/^A 1 A 1/);
    expect(formatted.length).toBeLessThanOrEqual(64);
    expect(skillDisplayNameSchema.parse(formatted)).toBe(formatted);
  });

  it.each([
    ["frontend-design", "Frontend Design"],
    ["guizang-ppt-skill", "Guizang Ppt Skill"],
    ["meeting_notes", "Meeting Notes"],
    ["plugin:meeting-notes", "Plugin: Meeting Notes"],
    ["会议纪要", "会议纪要"],
    ["", ""],
  ])("formats %s as %s", (name, expected) => {
    expect(formatSkillName(name)).toBe(expected);
  });

  it("uses a custom name and formats names when unset or blank", () => {
    expect(skillDisplayName("meeting-notes", "  会议纪要助手  ")).toBe(
      "会议纪要助手",
    );
    for (const displayName of [undefined, null, "", "  "]) {
      expect(skillDisplayName("meeting-notes", displayName)).toBe(
        "Meeting Notes",
      );
      expect(skillDisplayNameSchema.parse(displayName)).toBeNull();
    }
  });

  it("validates optional names without accepting nonstrings or control characters", () => {
    expect(skillDisplayNameSchema.parse("  我的 Skill  ")).toBe("我的 Skill");
    expect(skillDisplayNameSchema.parse("a".repeat(64))).toHaveLength(64);
    for (const invalid of [
      123,
      {},
      "a".repeat(65),
      "line\nbreak",
      "a\u0000b",
    ]) {
      expect(skillDisplayNameSchema.safeParse(invalid).success).toBe(false);
    }
  });

  it("formats skills while preserving plugin naming", () => {
    expect(
      capabilityDisplayName({ type: "skill", name: "meeting-notes" }),
    ).toBe("Meeting Notes");
    expect(capabilityDisplayName({ type: "plugin", name: "my-plugin" })).toBe(
      "my-plugin",
    );
  });
});
