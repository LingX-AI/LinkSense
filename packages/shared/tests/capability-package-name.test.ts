import { describe, expect, it } from "vitest";
import {
  builtInSkillNames,
  capabilityPackageNameSchema,
} from "../src/capabilities.js";

describe("capability package names", () => {
  it.each(["a", "123", "ppt-se", "skill-2", "a".repeat(64)])(
    "accepts the valid identifier %s",
    (name) => {
      expect(capabilityPackageNameSchema.parse(name)).toBe(name);
    },
  );

  it.each([
    "",
    "ppt-se你好",
    "ppt se",
    "Ppt",
    "ppt_se",
    "-ppt",
    "ppt-",
    "ppt--se",
    "ppt/se",
    "ppt.se",
    "a".repeat(65),
    ...builtInSkillNames,
  ])("rejects the invalid or reserved identifier %s", (name) => {
    expect(capabilityPackageNameSchema.safeParse(name).success).toBe(false);
  });
});
