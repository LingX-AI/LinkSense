import { execFile } from "node:child_process"
import { promisify } from "node:util"
import {
  mkdtemp,
  mkdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { afterEach, describe, expect, it } from "vitest"

import { writeBuiltInSkillCreator } from "../src/modules/capabilities/built-in-skill-creator.js"
import { CapabilityPackageImporter } from "../src/modules/capabilities/importer.js"

const runFile = promisify(execFile)
const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  )
})

describe("linksense-skill-creator built-in Skill", () => {
  it("initializes, validates, packages, and imports a complete Skill ZIP", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "linksense-skill-creator-"))
    temporaryDirectories.push(workspace)
    const skillsRoot = join(workspace, "built-ins")
    const stagingRoot = join(workspace, "staging")
    await Promise.all([
      mkdir(skillsRoot),
      mkdir(join(workspace, "temp")),
      mkdir(join(workspace, "artifacts")),
    ])
    await writeBuiltInSkillCreator(skillsRoot)
    const creatorRoot = join(skillsRoot, "linksense-skill-creator")
    const scriptsRoot = join(creatorRoot, "scripts")
    const creatorMetadata = await readFile(
      join(creatorRoot, "agents", "openai.yaml"),
      "utf8",
    )
    expect(creatorMetadata).toContain('type: "mcp"')
    expect(creatorMetadata).toContain('value: "linksense_core"')
    expect(creatorMetadata.match(/type: "mcp"/gu)).toHaveLength(1)
    const creatorInstructions = await readFile(join(creatorRoot, "SKILL.md"), "utf8")
    expect(creatorInstructions).toContain("no risk is present")
    expect(creatorInstructions).toContain("request_user_form")

    const initialized = await runPython(
      join(scriptsRoot, "init_skill.py"),
      [
        "meeting-follow-up",
        "--path",
        "temp/skill-build",
        "--description",
        "Create a structured follow-up when the user asks to summarize a meeting and assign actions.",
        "--display-name",
        "Meeting Follow-up",
        "--short-description",
        "Create structured meeting follow-ups",
        "--default-prompt",
        "Use $meeting-follow-up to summarize this meeting and assign actions.",
        "--resources",
        "scripts,references,assets",
      ],
      workspace,
    )
    expect(JSON.parse(initialized.stdout)).toMatchObject({
      success: true,
      skill_directory: "temp/skill-build/meeting-follow-up",
    })

    const generatedRoot = join(
      workspace,
      "temp",
      "skill-build",
      "meeting-follow-up",
    )
    const skillPath = join(generatedRoot, "SKILL.md")
    await writeFile(
      skillPath,
      (await readFile(skillPath, "utf8")).replace(
        "TODO: Replace this line with concise, actionable workflow instructions.",
        "Summarize decisions, assign each action to an owner, and include due dates when provided.",
      ),
    )
    await writeFile(
      join(generatedRoot, "scripts", "format_actions.py"),
      "def format_action(owner: str, action: str) -> str:\n    return f\"{owner}: {action}\"\n",
    )
    await writeFile(
      join(generatedRoot, "references", "output-format.md"),
      "# Output format\n\nUse decisions, actions, owners, and dates.\n",
    )
    await writeFile(
      join(generatedRoot, "assets", "follow-up-template.md"),
      "# Follow-up\n",
    )

    const validated = await runPython(
      join(scriptsRoot, "quick_validate.py"),
      ["temp/skill-build/meeting-follow-up"],
      workspace,
    )
    expect(JSON.parse(validated.stdout)).toEqual({
      success: true,
      name: "meeting-follow-up",
    })

    const packaged = await runPython(
      join(scriptsRoot, "package_skill.py"),
      [
        "temp/skill-build/meeting-follow-up",
        "--output",
        "artifacts/meeting-follow-up.zip",
      ],
      workspace,
    )
    expect(JSON.parse(packaged.stdout)).toEqual({
      success: true,
      name: "meeting-follow-up",
      archive: "artifacts/meeting-follow-up.zip",
    })

    const importer = new CapabilityPackageImporter({ stagingRoot })
    const prepared = await importer.prepare({
      kind: "zip",
      filename: "meeting-follow-up.zip",
      bytes: await readFile(join(workspace, "artifacts", "meeting-follow-up.zip")),
    })
    try {
      expect(prepared).toMatchObject({
        type: "skill",
        name: "meeting-follow-up",
        description:
          "Create a structured follow-up when the user asks to summarize a meeting and assign actions.",
        riskSummary: { contains_scripts: true },
      })
      await expect(
        readFile(join(prepared.packageRoot, "agents", "openai.yaml"), "utf8"),
      ).resolves.toContain("$meeting-follow-up")
      await expect(
        readFile(
          join(prepared.packageRoot, "references", "output-format.md"),
          "utf8",
        ),
      ).resolves.toContain("decisions")
    } finally {
      await importer.cleanup(prepared)
    }
  })

  it("rejects unfinished Skills and archives outside artifacts", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "linksense-skill-creator-"))
    temporaryDirectories.push(workspace)
    const skillsRoot = join(workspace, "built-ins")
    await Promise.all([
      mkdir(skillsRoot),
      mkdir(join(workspace, "temp")),
      mkdir(join(workspace, "artifacts")),
    ])
    await writeBuiltInSkillCreator(skillsRoot)
    const scriptsRoot = join(skillsRoot, "linksense-skill-creator", "scripts")
    await runPython(
      join(scriptsRoot, "init_skill.py"),
      [
        "unfinished-skill",
        "--path",
        "temp",
        "--description",
        "Use this Skill when a user explicitly requests the unfinished example workflow.",
        "--display-name",
        "Unfinished Skill",
        "--short-description",
        "Demonstrate validation failures",
        "--default-prompt",
        "Use $unfinished-skill to demonstrate validation.",
      ],
      workspace,
    )

    await expect(
      runPython(
        join(scriptsRoot, "quick_validate.py"),
        ["temp/unfinished-skill"],
        workspace,
      ),
    ).rejects.toMatchObject({ stderr: expect.stringContaining("unfinished") })
    const skillPath = join(workspace, "temp", "unfinished-skill", "SKILL.md")
    await writeFile(
      skillPath,
      (await readFile(skillPath, "utf8")).replace(
        "TODO: Replace this line with concise, actionable workflow instructions.",
        "Return the validated demonstration output requested by the user.",
      ),
    )
    await expect(
      runPython(
        join(scriptsRoot, "package_skill.py"),
        ["temp/unfinished-skill", "--output", "temp/skill.zip"],
        workspace,
      ),
    ).rejects.toMatchObject({
      stderr: expect.stringContaining("under artifacts"),
    })
  })
})

function runPython(script: string, args: string[], cwd: string) {
  return runFile(process.env.PYTHON ?? "python3", [script, ...args], {
    cwd,
    encoding: "utf8",
  })
}
