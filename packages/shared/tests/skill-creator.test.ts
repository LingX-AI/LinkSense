import { describe, expect, it } from "vitest"

import {
  builtInSkillNames,
  skillCreatorArchivePathSchema,
  skillCreatorConfirmRequestSchema,
} from "../src/index.js"

describe("Skill creator contracts", () => {
  it("reserves all built-in Skill names", () => {
    expect(builtInSkillNames).toContain("linksense-document-reader")
    expect(builtInSkillNames).toContain("linksense-docs")
    expect(builtInSkillNames).toContain("linksense-skill-creator")
  })

  it("accepts only canonical ZIP paths below artifacts", () => {
    expect(
      skillCreatorArchivePathSchema.parse("artifacts/my-skill.zip"),
    ).toBe("artifacts/my-skill.zip")
    for (const invalid of [
      "temp/my-skill.zip",
      "artifacts/../my-skill.zip",
      "artifacts\\my-skill.zip",
      "artifacts/my-skill.tar.gz",
    ]) {
      expect(skillCreatorArchivePathSchema.safeParse(invalid).success).toBe(
        false,
      )
    }
  })

  it("requires an opaque bounded install token", () => {
    expect(
      skillCreatorConfirmRequestSchema.safeParse({
        conversationId: "10000000-0000-4000-8000-000000000001",
        turnId: "codex-turn-1",
        installToken: "short",
      }).success,
    ).toBe(false)
  })
})
