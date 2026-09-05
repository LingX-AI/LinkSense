import {
  managedProjectionProbeContents,
  managedProjectionProbeFileName,
} from "@linksense/shared"
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import {
  PERSONAL_PLUGIN_MARKETPLACE_NAME,
  PLUGIN_STDIO_LAUNCHER_COMMAND,
  UserHomeCapabilityMaterializer,
} from "../src/modules/capabilities/user-home-materializer.js"
import {
  CREDENTIAL_SOURCE,
  OWNER_ID,
  createPluginSource,
  createSkillSource,
  pathMode,
  pluginCapability,
  skillCapability,
  useCapabilityFilesystem,
} from "./user-home-capability-fixture.js"
const { temporaryDirectory } = useCapabilityFilesystem()

describe("UserHomeCapabilityMaterializer durability", () => {
  it("atomically publishes API-owned capabilities without mutating task-owned HOME", async () => {
    const root = await temporaryDirectory()
    const sourceRoot = join(root, "sources")
    const userDataRoot = join(root, "users")
    const pluginSource = await createPluginSource(
      sourceRoot,
      "calendar-tools",
      "first plugin body",
    )
    const skillSource = await createSkillSource(
      sourceRoot,
      "report-writer",
      "Write a concise report.",
    )
    const materializer = new UserHomeCapabilityMaterializer({ userDataRoot })
    const paths = materializer.pathsFor(OWNER_ID)
    const homeRoot = join(paths.ownerRoot, "home")
    const codexHome = join(homeRoot, ".codex")

    await mkdir(codexHome, { recursive: true })
    await writeFile(join(codexHome, "config.toml"), 'model = "test"\n')
    await Promise.all([chmod(homeRoot, 0o710), chmod(codexHome, 0o700)])

    const result = await materializer.reconcile({
      ownerId: OWNER_ID,
      capabilities: [
        pluginCapability(pluginSource, {
          API_KEY: CREDENTIAL_SOURCE,
        }),
        skillCapability(skillSource),
      ],
    })

    expect(result.generation).toMatch(/^[a-f0-9]{64}$/u)
    await expect(readFile(result.generationPath, "utf8")).resolves.toBe(
      `${result.generation}\n`,
    )
    await expect(readFile(result.contentDigestPath, "utf8")).resolves.toMatch(
      /^[a-f0-9]{64}\n$/u,
    )
    await expect(pathMode(result.managedRoot)).resolves.toBe(0o750)
    await expect(pathMode(result.managedAgentsRoot)).resolves.toBe(0o750)
    await expect(
      readFile(
        join(result.managedAgentsRoot, managedProjectionProbeFileName),
        "utf8",
      ),
    ).resolves.toBe(managedProjectionProbeContents)
    await expect(
      pathMode(join(result.managedAgentsRoot, managedProjectionProbeFileName)),
    ).resolves.toBe(0o640)
    await expect(
      pathMode(join(result.managedAgentsRoot, "plugins")),
    ).resolves.toBe(0o750)
    await expect(pathMode(result.pluginsRoot)).resolves.toBe(0o750)
    await expect(pathMode(result.skillsRoot)).resolves.toBe(0o750)
    await expect(pathMode(homeRoot)).resolves.toBe(0o710)
    await expect(pathMode(codexHome)).resolves.toBe(0o700)
    await expect(
      pathMode(join(result.pluginsRoot, "calendar-tools")),
    ).resolves.toBe(0o750)
    await expect(
      pathMode(join(result.pluginsRoot, "calendar-tools", "README.md")),
    ).resolves.toBe(0o640)
    await expect(pathMode(result.marketplacePath)).resolves.toBe(0o640)
    await expect(pathMode(result.contentDigestPath)).resolves.toBe(0o600)
    await expect(pathMode(result.sourceDigestPath)).resolves.toBe(0o600)
    await expect(pathMode(result.generationPath)).resolves.toBe(0o600)
    await expect(
      readFile(join(result.skillsRoot, "report-writer", "SKILL.md"), "utf8"),
    ).resolves.toContain("Write a concise report.")
    const browserSkill = await readFile(
      join(result.skillsRoot, "linksense-browser", "SKILL.md"),
      "utf8",
    )
    expect(browserSkill).toContain("managed Chromium")
    expect(browserSkill).toContain("command -v linksense-browser")
    expect(browserSkill).toContain("linksense-browser --help")
    expect(browserSkill).toContain("open-workspace-html")
    expect(browserSkill).toContain("does not mean Chromium is missing")
    await expect(
      readFile(
        join(result.skillsRoot, "linksense-file-service", "SKILL.md"),
        "utf8",
      ),
    ).resolves.toContain("register_artifact")
    const documentReaderSkill = await readFile(
      join(result.skillsRoot, "linksense-document-reader", "SKILL.md"),
      "utf8",
    )
    expect(documentReaderSkill).toContain(
      "linksense_core.convert_document_to_markdown",
    )
    expect(documentReaderSkill).toContain("expected_markdown_sha256")
    expect(documentReaderSkill).toContain("Scanned or image-only PDFs")
    const imageGenerationSkill = await readFile(
      join(result.skillsRoot, "linksense-image-generation", "SKILL.md"),
      "utf8",
    )
    expect(imageGenerationSkill).toContain("linksense_core.generate_image")
    expect(imageGenerationSkill).toContain("IMAGE_GENERATION_NOT_CONFIGURED")
    expect(imageGenerationSkill).toContain('background: "transparent"')
    expect(imageGenerationSkill).toContain(
      "transparency_mode` from the subject",
    )
    expect(imageGenerationSkill).toContain(
      "IMAGE_GENERATION_TRANSPARENCY_UNSUPPORTED",
    )
    expect(imageGenerationSkill).toContain(
      "IMAGE_GENERATION_TRANSPARENCY_INVALID",
    )
    expect(imageGenerationSkill).toContain("do not silently switch providers")
    const knowledgeSkill = await readFile(
      join(result.skillsRoot, "linksense-knowledge-base", "SKILL.md"),
      "utf8",
    )
    expect(knowledgeSkill).toContain("search_knowledge_base")
    expect(knowledgeSkill).toContain("list_knowledge_documents")
    expect(knowledgeSkill).toContain("get_knowledge_document_markdown")
    expect(knowledgeSkill).toContain("complete` is true")
    expect(knowledgeSkill).toContain(
      "Do not fetch an entire document for a simple focused question.",
    )
    const docsRoot = join(result.skillsRoot, "linksense-docs")
    await expect(
      readFile(join(docsRoot, "SKILL.md"), "utf8"),
    ).resolves.toContain("references/catalog.md")
    await expect(
      readFile(
        join(
          docsRoot,
          "references",
          "zh-CN",
          "user-guide",
          "tasks",
          "create-and-run.md",
        ),
        "utf8",
      ),
    ).resolves.toContain("# 创建与运行任务")
    await expect(
      readFile(
        join(
          docsRoot,
          "references",
          "en-US",
          "user-guide",
          "tasks",
          "create-and-run.md",
        ),
        "utf8",
      ),
    ).resolves.toContain("# Create and run tasks")
    const creatorRoot = join(result.skillsRoot, "linksense-skill-creator")
    await expect(
      readFile(join(creatorRoot, "SKILL.md"), "utf8"),
    ).resolves.toContain("linksense_core.preview_skill_zip")
    await expect(
      readFile(join(creatorRoot, "agents", "openai.yaml"), "utf8"),
    ).resolves.toContain("$linksense-skill-creator")
    await expect(
      pathMode(join(creatorRoot, "scripts", "package_skill.py")),
    ).resolves.toBe(0o750)
    await expect(
      readFile(join(result.pluginsRoot, "calendar-tools", "README.md"), "utf8"),
    ).resolves.toBe("first plugin body")

    const manifest = JSON.parse(
      await readFile(
        join(
          result.pluginsRoot,
          "calendar-tools",
          ".codex-plugin",
          "plugin.json",
        ),
        "utf8",
      ),
    ) as {
      mcpServers: Record<
        string,
        {
          command?: string
          args?: string[]
          env?: Record<string, string>
          env_vars?: unknown[]
        }
      >
    }
    const calendarServer = manifest.mcpServers.calendar
    expect(calendarServer?.env).toEqual({
      API_KEY: "static-default",
      UNRELATED: "kept",
    })
    expect(calendarServer?.env_vars).toEqual([CREDENTIAL_SOURCE])
    expect(calendarServer?.command).toBe(PLUGIN_STDIO_LAUNCHER_COMMAND)
    const descriptor = JSON.parse(
      Buffer.from(calendarServer?.args?.[0] ?? "", "base64url").toString(
        "utf8",
      ),
    ) as Record<string, unknown>
    expect(descriptor).toEqual({
      version: 1,
      command: "node",
      args: ["server.js"],
      environmentVariables: [{ name: "API_KEY", source: CREDENTIAL_SOURCE }],
    })

    const marketplace = JSON.parse(
      await readFile(result.marketplacePath, "utf8"),
    ) as {
      name: string
      plugins: Array<{
        name: string
        source: { source: string; path: string }
      }>
    }
    expect(marketplace).toMatchObject({
      name: PERSONAL_PLUGIN_MARKETPLACE_NAME,
      plugins: [
        {
          name: "calendar-tools",
          source: {
            source: "local",
            path: "./.agents/plugin-sources/calendar-tools",
          },
        },
      ],
    })
    await expect(
      readFile(join(codexHome, "config.toml"), "utf8"),
    ).resolves.toBe('model = "test"\n')

    const cleared = await materializer.reconcile({
      ownerId: OWNER_ID,
      capabilities: [],
    })
    expect(cleared.generation).not.toBe(result.generation)
    await expect(
      readFile(
        join(cleared.pluginsRoot, "calendar-tools", "README.md"),
        "utf8",
      ),
    ).rejects.toMatchObject({ code: "ENOENT" })
    await expect(
      readFile(join(cleared.skillsRoot, "report-writer", "SKILL.md"), "utf8"),
    ).rejects.toMatchObject({ code: "ENOENT" })
    await expect(
      readFile(join(codexHome, "config.toml"), "utf8"),
    ).resolves.toBe('model = "test"\n')
  })
})
