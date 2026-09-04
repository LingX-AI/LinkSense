import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { afterEach, describe, expect, it, vi } from "vitest"
import { lock } from "proper-lockfile"
import {
  managedProjectionProbeContents,
  managedProjectionProbeFileName,
} from "@linksense/shared"

import {
  BUILT_IN_CAPABILITY_RUNTIME_REVISION,
  CAPABILITY_RECONCILE_LOCK_FILE,
  CAPABILITY_SOURCE_DIGEST_FILE,
  PERSONAL_PLUGIN_MARKETPLACE_NAME,
  PLUGIN_STDIO_LAUNCHER_COMMAND,
  UserHomeCapabilityMaterializer,
  type UserHomeCapabilityInput,
} from "../src/modules/capabilities/user-home-materializer.js"

const OWNER_ID = "11111111-1111-4111-8111-111111111111"
const PLUGIN_ID = "22222222-2222-4222-8222-222222222222"
const SKILL_ID = "33333333-3333-4333-8333-333333333333"
const CREDENTIAL_SOURCE =
  "LINKSENSE_CREDENTIAL_0123456789ABCDEF0123456789ABCDEF"
const SECOND_CREDENTIAL_SOURCE =
  "LINKSENSE_CREDENTIAL_FEDCBA9876543210FEDCBA9876543210"
const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  )
})

describe("UserHomeCapabilityMaterializer", () => {
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
    await writeFile(join(codexHome, "config.toml"), "model = \"test\"\n")
    await Promise.all([
      chmod(homeRoot, 0o710),
      chmod(codexHome, 0o700),
    ])

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
      pathMode(
        join(result.managedAgentsRoot, managedProjectionProbeFileName),
      ),
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
    expect(imageGenerationSkill).toContain(
      "linksense_core.generate_image",
    )
    expect(imageGenerationSkill).toContain("IMAGE_GENERATION_NOT_CONFIGURED")
    expect(imageGenerationSkill).toContain('background: "transparent"')
    expect(imageGenerationSkill).toContain('transparency_mode` from the subject')
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
    const creatorRoot = join(
      result.skillsRoot,
      "linksense-skill-creator",
    )
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
      readFile(
        join(result.pluginsRoot, "calendar-tools", "README.md"),
        "utf8",
      ),
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
      environmentVariables: [
        { name: "API_KEY", source: CREDENTIAL_SOURCE },
      ],
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
    ).resolves.toBe("model = \"test\"\n")

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
      readFile(
        join(cleared.skillsRoot, "report-writer", "SKILL.md"),
        "utf8",
      ),
    ).rejects.toMatchObject({ code: "ENOENT" })
    await expect(
      readFile(join(codexHome, "config.toml"), "utf8"),
    ).resolves.toBe("model = \"test\"\n")
  })

  it("injects each mapped credential only into MCP servers that declare it", async () => {
    const root = await temporaryDirectory()
    const pluginRoot = join(root, "sources", "calendar-tools")
    await mkdir(join(pluginRoot, ".codex-plugin"), { recursive: true })
    await writeFile(
      join(pluginRoot, ".codex-plugin", "plugin.json"),
      JSON.stringify({
        name: "calendar-tools",
        mcpServers: "./.mcp.json",
      }),
    )
    await writeFile(
      join(pluginRoot, ".mcp.json"),
      JSON.stringify({
        mcpServers: {
          alpha: {
            command: "node",
            args: ["alpha.mjs"],
            env_vars: ["SHARED_TOKEN", "ALPHA_ONLY"],
          },
          beta: {
            command: "node",
            args: ["beta.mjs"],
            env_vars: ["SHARED_TOKEN"],
          },
          web: {
            url: "https://mcp.example.test",
            bearer_token_env_var: "SHARED_TOKEN",
            env_http_headers: { "X-Workspace-Key": "WEB_KEY" },
          },
          untouched: {
            command: "node",
            args: ["untouched.mjs"],
            env_vars: ["UNBOUND_TOKEN"],
          },
        },
      }),
    )
    const materializer = new UserHomeCapabilityMaterializer({
      userDataRoot: join(root, "users"),
    })

    const result = await materializer.reconcile({
      ownerId: OWNER_ID,
      capabilities: [
        pluginCapability(pluginRoot, {
          SHARED_TOKEN: CREDENTIAL_SOURCE,
          WEB_KEY: SECOND_CREDENTIAL_SOURCE,
        }),
      ],
    })
    const config = JSON.parse(
      await readFile(
        join(result.pluginsRoot, "calendar-tools", ".mcp.json"),
        "utf8",
      ),
    ) as {
      mcpServers: Record<string, Record<string, unknown>>
    }

    expect(config.mcpServers.alpha).toMatchObject({
      command: PLUGIN_STDIO_LAUNCHER_COMMAND,
      env_vars: [CREDENTIAL_SOURCE, "ALPHA_ONLY"],
    })
    expect(config.mcpServers.beta).toMatchObject({
      command: PLUGIN_STDIO_LAUNCHER_COMMAND,
      env_vars: [CREDENTIAL_SOURCE],
    })
    expect(config.mcpServers.web).toMatchObject({
      bearer_token_env_var: CREDENTIAL_SOURCE,
      env_http_headers: {
        "X-Workspace-Key": SECOND_CREDENTIAL_SOURCE,
      },
    })
    expect(config.mcpServers.untouched).toEqual({
      command: "node",
      args: ["untouched.mjs"],
      env_vars: ["UNBOUND_TOKEN"],
    })
    for (const name of ["alpha", "beta"]) {
      const encoded = config.mcpServers[name]?.args
      expect(Array.isArray(encoded)).toBe(true)
      const descriptor = JSON.parse(
        Buffer.from((encoded as string[])[0] ?? "", "base64url").toString(
          "utf8",
        ),
      ) as { environmentVariables: Array<{ name: string; source: string }> }
      expect(descriptor.environmentVariables).toEqual([
        { name: "SHARED_TOKEN", source: CREDENTIAL_SOURCE },
      ])
    }
  })

  it("keeps the built-in runtime revision pinned to the generated empty runtime", async () => {
    const root = await temporaryDirectory()
    const materializer = new UserHomeCapabilityMaterializer({
      userDataRoot: join(root, "users"),
    })

    const published = await materializer.reconcile({
      ownerId: OWNER_ID,
      capabilities: [],
    })

    await expect(readFile(published.contentDigestPath, "utf8")).resolves.toBe(
      `${BUILT_IN_CAPABILITY_RUNTIME_REVISION}\n`,
    )
    await expect(readFile(published.sourceDigestPath, "utf8")).resolves.toBe(
      `${published.verification.sourceDigest}\n`,
    )
    expect(published.sourceDigestPath).toBe(
      join(
        published.controlCapabilitiesRoot,
        CAPABILITY_SOURCE_DIGEST_FILE,
      ),
    )
  })

  it("changes generation and refreshes source when content changes without a revision change", async () => {
    const root = await temporaryDirectory()
    const sourceRoot = join(root, "sources")
    const pluginSource = await createPluginSource(
      sourceRoot,
      "calendar-tools",
      "before",
    )
    const materializer = new UserHomeCapabilityMaterializer({
      userDataRoot: join(root, "users"),
    })
    const capability = pluginCapability(pluginSource)

    const before = await materializer.reconcile({
      ownerId: OWNER_ID,
      capabilities: [capability],
    })
    await writeFile(join(pluginSource, "README.md"), "after")
    const after = await materializer.reconcile({
      ownerId: OWNER_ID,
      capabilities: [capability],
    })

    expect(after.generation).not.toBe(before.generation)
    await expect(
      readFile(
        join(after.pluginsRoot, "calendar-tools", "README.md"),
        "utf8",
      ),
    ).resolves.toBe("after")
    await expect(readFile(after.generationPath, "utf8")).resolves.toBe(
      `${after.generation}\n`,
    )
  })

  it("repairs tampered published content even when the committed generation is unchanged", async () => {
    const root = await temporaryDirectory()
    const sourceRoot = join(root, "sources")
    const pluginSource = await createPluginSource(
      sourceRoot,
      "calendar-tools",
      "trusted plugin",
    )
    const skillSource = await createSkillSource(
      sourceRoot,
      "report-writer",
      "Trusted skill.",
    )
    const materializer = new UserHomeCapabilityMaterializer({
      userDataRoot: join(root, "users"),
    })
    const capabilities = [
      pluginCapability(pluginSource),
      skillCapability(skillSource),
    ]
    const initial = await materializer.reconcile({
      ownerId: OWNER_ID,
      capabilities,
    })
    await writeFile(
      join(initial.pluginsRoot, "calendar-tools", "README.md"),
      "tampered plugin",
    )
    await writeFile(
      join(initial.skillsRoot, "report-writer", "SKILL.md"),
      "---\nname: report-writer\n---\n\ntampered skill\n",
    )

    const repaired = await materializer.reconcile({
      ownerId: OWNER_ID,
      capabilities,
    })

    expect(repaired.generation).toBe(initial.generation)
    await expect(
      readFile(
        join(repaired.pluginsRoot, "calendar-tools", "README.md"),
        "utf8",
      ),
    ).resolves.toBe("trusted plugin")
    await expect(
      readFile(
        join(repaired.skillsRoot, "report-writer", "SKILL.md"),
        "utf8",
      ),
    ).resolves.toContain("Trusted skill.")
  })

  it("returns an exactly matching publication without invoking the active-turn guard", async () => {
    const root = await temporaryDirectory()
    const pluginSource = await createPluginSource(
      join(root, "sources"),
      "calendar-tools",
      "trusted plugin",
    )
    const publicationGuard = vi.fn(async () => true)
    const materializer = new UserHomeCapabilityMaterializer({
      userDataRoot: join(root, "users"),
      publicationGuard,
    })
    const input = {
      ownerId: OWNER_ID,
      capabilities: [pluginCapability(pluginSource)],
    }
    const initial = await materializer.reconcile(input)
    publicationGuard.mockClear()
    publicationGuard.mockResolvedValue(false)

    await expect(materializer.reconcile(input)).resolves.toMatchObject({
      generation: initial.generation,
    })
    expect(publicationGuard).not.toHaveBeenCalled()
  })

  it("uses the read-only verification fast path and syncs only when publication changes", async () => {
    const root = await temporaryDirectory()
    const pluginSource = await createPluginSource(
      join(root, "sources"),
      "calendar-tools",
      "before",
    )
    const lifecycle: string[] = []
    const materializer = new UserHomeCapabilityMaterializer({
      userDataRoot: join(root, "users"),
      instrumentation: {
        onStage: () => lifecycle.push("stage"),
        onDurabilitySync: () => lifecycle.push("sync"),
      },
    })
    const input = {
      ownerId: OWNER_ID,
      capabilities: [pluginCapability(pluginSource)],
    }

    const initial = await materializer.reconcile(input)
    expect(lifecycle).toEqual(["stage", "sync"])
    lifecycle.length = 0

    const unchanged = await materializer.reconcile(input)
    expect(unchanged.verification).toEqual(initial.verification)
    expect(lifecycle).toEqual([])

    await expect(
      materializer.withVerifiedRuntime(
        {
          ...input,
          verification: unchanged.verification,
        },
        async () => "intent-created",
      ),
    ).resolves.toBe("intent-created")
    expect(lifecycle).toEqual([])

    await writeFile(join(pluginSource, "README.md"), "after")
    const changed = await materializer.reconcile(input)
    expect(changed.generation).not.toBe(initial.generation)
    expect(lifecycle).toEqual(["stage", "sync"])
  })

  it("uses durable publication markers on the conversation hot path and fully republishes stale descriptors", async () => {
    const root = await temporaryDirectory()
    const pluginSource = await createPluginSource(
      join(root, "sources"),
      "calendar-tools",
      "trusted plugin",
    )
    const lifecycle: string[] = []
    const materializer = new UserHomeCapabilityMaterializer({
      userDataRoot: join(root, "users"),
      instrumentation: {
        onStage: () => lifecycle.push("stage"),
        onDurabilitySync: () => lifecycle.push("sync"),
      },
    })
    const capability = pluginCapability(pluginSource)
    const initial = await materializer.reconcile({
      ownerId: OWNER_ID,
      capabilities: [capability],
    })
    lifecycle.length = 0

    await expect(
      materializer.withPublicationStartFence(OWNER_ID, () =>
        materializer.resolvePublishedRuntimeWithinPublicationStartFence({
          ownerId: OWNER_ID,
          capabilities: [capability],
        }),
      ),
    ).resolves.toMatchObject({ verification: initial.verification })
    expect(lifecycle).toEqual([])

    const republished = await materializer.withPublicationStartFence(
      OWNER_ID,
      () =>
        materializer.resolvePublishedRuntimeWithinPublicationStartFence({
          ownerId: OWNER_ID,
          capabilities: [{ ...capability, revision: "revision-2" }],
        }),
    )
    expect(republished.generation).not.toBe(initial.generation)
    expect(lifecycle).toEqual(["stage", "sync"])
  })

  it("admits a hot-path start only while the durable publication markers match", async () => {
    const root = await temporaryDirectory()
    const pluginSource = await createPluginSource(
      join(root, "sources"),
      "calendar-tools",
      "trusted plugin",
    )
    const materializer = new UserHomeCapabilityMaterializer({
      userDataRoot: join(root, "users"),
    })
    const input = {
      ownerId: OWNER_ID,
      capabilities: [pluginCapability(pluginSource)],
    }
    const published = await materializer.reconcile(input)

    await expect(
      materializer.withPublishedRuntime(
        { ...input, verification: published.verification },
        async () => "intent-created",
      ),
    ).resolves.toBe("intent-created")

    await writeFile(published.generationPath, `${"f".repeat(64)}\n`)
    await expect(
      materializer.withPublishedRuntime(
        { ...input, verification: published.verification },
        async () => "should-not-run",
      ),
    ).rejects.toMatchObject({
      name: "UserHomeCapabilityMaterializationError",
    })
  })

  it("keeps the prior HOME generation and content when an active turn blocks a different publication", async () => {
    const root = await temporaryDirectory()
    const pluginSource = await createPluginSource(
      join(root, "sources"),
      "calendar-tools",
      "before",
    )
    const publicationGuard = vi.fn(async () => true)
    const materializer = new UserHomeCapabilityMaterializer({
      userDataRoot: join(root, "users"),
      publicationGuard,
    })
    const capability = pluginCapability(pluginSource)
    const initial = await materializer.reconcile({
      ownerId: OWNER_ID,
      capabilities: [capability],
    })
    publicationGuard.mockClear()
    publicationGuard.mockResolvedValue(false)
    await writeFile(join(pluginSource, "README.md"), "after")

    await expect(
      materializer.reconcile({
        ownerId: OWNER_ID,
        capabilities: [capability],
      }),
    ).rejects.toMatchObject({
      name: "UserHomeCapabilityPublicationDeferredError",
    })
    expect(publicationGuard).toHaveBeenCalledWith({
      ownerId: OWNER_ID,
      currentGeneration: initial.generation,
      nextGeneration: expect.not.stringMatching(
        new RegExp(`^${initial.generation}$`, "u"),
      ),
    })
    await expect(readFile(initial.generationPath, "utf8")).resolves.toBe(
      `${initial.generation}\n`,
    )
    await expect(
      readFile(
        join(initial.pluginsRoot, "calendar-tools", "README.md"),
        "utf8",
      ),
    ).resolves.toBe("before")
  })

  it("does not repair tampered HOME content while an active turn requires the persisted generation", async () => {
    const root = await temporaryDirectory()
    const pluginSource = await createPluginSource(
      join(root, "sources"),
      "calendar-tools",
      "trusted plugin",
    )
    const publicationGuard = vi.fn(async () => true)
    const materializer = new UserHomeCapabilityMaterializer({
      userDataRoot: join(root, "users"),
      publicationGuard,
    })
    const input = {
      ownerId: OWNER_ID,
      capabilities: [pluginCapability(pluginSource)],
    }
    const initial = await materializer.reconcile(input)
    const publishedReadme = join(
      initial.pluginsRoot,
      "calendar-tools",
      "README.md",
    )
    await writeFile(publishedReadme, "tampered while running")
    publicationGuard.mockClear()
    publicationGuard.mockResolvedValue(false)

    const release = await lock(initial.controlCapabilitiesRoot, {
      realpath: false,
      lockfilePath: join(
        initial.controlCapabilitiesRoot,
        CAPABILITY_RECONCILE_LOCK_FILE,
      ),
      stale: 120_000,
      update: 10_000,
    })
    const reconciliation = materializer.reconcile(input)
    await expect(reconciliation).rejects.toMatchObject({
      name: "UserHomeCapabilityPublicationDeferredError",
    })
    await release()
    expect(publicationGuard).toHaveBeenCalledWith({
      ownerId: OWNER_ID,
      currentGeneration: initial.generation,
      nextGeneration: initial.generation,
    })
    await expect(readFile(initial.generationPath, "utf8")).resolves.toBe(
      `${initial.generation}\n`,
    )
    await expect(readFile(publishedReadme, "utf8")).resolves.toBe(
      "tampered while running",
    )
  })

  it("publishes a changed HOME when the active-turn guard allows it", async () => {
    const root = await temporaryDirectory()
    const pluginSource = await createPluginSource(
      join(root, "sources"),
      "calendar-tools",
      "before",
    )
    const publicationGuard = vi.fn(async () => true)
    const materializer = new UserHomeCapabilityMaterializer({
      userDataRoot: join(root, "users"),
      publicationGuard,
    })
    const capability = pluginCapability(pluginSource)
    const initial = await materializer.reconcile({
      ownerId: OWNER_ID,
      capabilities: [capability],
    })
    publicationGuard.mockClear()
    await writeFile(join(pluginSource, "README.md"), "after")

    const published = await materializer.reconcile({
      ownerId: OWNER_ID,
      capabilities: [capability],
    })

    expect(publicationGuard).toHaveBeenCalledTimes(2)
    expect(published.generation).not.toBe(initial.generation)
    await expect(
      readFile(
        join(published.pluginsRoot, "calendar-tools", "README.md"),
        "utf8",
      ),
    ).resolves.toBe("after")
  })

  it("removes every non-capability entry from the API-owned plugin source domain", async () => {
    const root = await temporaryDirectory()
    const pluginSource = await createPluginSource(
      join(root, "sources"),
      "calendar-tools",
      "trusted plugin",
    )
    const materializer = new UserHomeCapabilityMaterializer({
      userDataRoot: join(root, "users"),
    })
    const capability = pluginCapability(pluginSource)
    const initial = await materializer.reconcile({
      ownerId: OWNER_ID,
      capabilities: [capability],
    })
    await mkdir(join(initial.pluginsRoot, "cache"), { recursive: true })
    await writeFile(
      join(initial.pluginsRoot, "cache", "sentinel"),
      "native cache",
    )
    await mkdir(join(initial.pluginsRoot, ".plugin-appserver"))
    await mkdir(join(initial.pluginsRoot, ".remote-plugin-install-staging"))
    await mkdir(join(initial.pluginsRoot, ".rogue"))
    await writeFile(join(initial.pluginsRoot, ".rogue", "sentinel"), "rogue")
    await mkdir(join(initial.pluginsRoot, "unlisted-plugin"))
    await writeFile(
      join(initial.pluginsRoot, "unlisted-plugin", "sentinel"),
      "must be removed",
    )

    const reconciled = await materializer.reconcile({
      ownerId: OWNER_ID,
      capabilities: [capability],
    })

    expect(reconciled.generation).toBe(initial.generation)
    expect((await readdir(reconciled.pluginsRoot)).sort()).toEqual([
      "calendar-tools",
    ])
    await expect(
      readFile(join(reconciled.pluginsRoot, ".rogue", "sentinel"), "utf8"),
    ).rejects.toMatchObject({ code: "ENOENT" })
    await expect(
      readFile(
        join(reconciled.pluginsRoot, "unlisted-plugin", "sentinel"),
        "utf8",
      ),
    ).rejects.toMatchObject({ code: "ENOENT" })
    await expect(
      readFile(join(reconciled.pluginsRoot, "cache", "sentinel"), "utf8"),
    ).rejects.toMatchObject({ code: "ENOENT" })
  })

  it("restores removed unlisted plugin sources when a later publication step fails", async () => {
    const root = await temporaryDirectory()
    const pluginSource = await createPluginSource(
      join(root, "sources"),
      "calendar-tools",
      "trusted plugin",
    )
    const materializer = new UserHomeCapabilityMaterializer({
      userDataRoot: join(root, "users"),
    })
    const capability = pluginCapability(pluginSource)
    const initial = await materializer.reconcile({
      ownerId: OWNER_ID,
      capabilities: [capability],
    })
    await mkdir(join(initial.pluginsRoot, "unlisted-plugin"))
    await writeFile(
      join(initial.pluginsRoot, "unlisted-plugin", "sentinel"),
      "restore me",
    )
    await rm(initial.marketplacePath)
    await mkdir(initial.marketplacePath)

    await expect(
      materializer.reconcile({
        ownerId: OWNER_ID,
        capabilities: [capability],
      }),
    ).rejects.toThrow(/invalid type/u)

    await expect(
      readFile(
        join(initial.pluginsRoot, "unlisted-plugin", "sentinel"),
        "utf8",
      ),
    ).resolves.toBe("restore me")
    await expect(readFile(initial.generationPath, "utf8")).resolves.toBe(
      `${initial.generation}\n`,
    )
    expect(
      (await readdir(initial.managedRoot)).filter((name) =>
        name.startsWith(".capabilities-"),
      ),
    ).toEqual([])
  })

  it("rejects symbolic links and non-directory entries in the plugin source root", async () => {
    const root = await temporaryDirectory()
    const materializer = new UserHomeCapabilityMaterializer({
      userDataRoot: join(root, "users"),
    })
    const initial = await materializer.reconcile({
      ownerId: OWNER_ID,
      capabilities: [],
    })
    const outside = join(root, "outside-cache")
    await mkdir(outside)
    await symlink(outside, join(initial.pluginsRoot, "cache"))

    await expect(
      materializer.reconcile({
        ownerId: OWNER_ID,
        capabilities: [],
      }),
    ).rejects.toThrow(/real director(?:y|ies)/u)

    await rm(join(initial.pluginsRoot, "cache"))
    await writeFile(join(initial.pluginsRoot, "unlisted-plugin"), "invalid")
    await expect(
      materializer.reconcile({
        ownerId: OWNER_ID,
        capabilities: [],
      }),
    ).rejects.toThrow(/plugin root entries must be real directories/u)
    await expect(readFile(initial.generationPath, "utf8")).resolves.toBe(
      `${initial.generation}\n`,
    )
  })

  it("changes generation when the credential fingerprint changes without persisting it", async () => {
    const root = await temporaryDirectory()
    const pluginSource = await createPluginSource(
      join(root, "sources"),
      "calendar-tools",
      "plugin",
    )
    const materializer = new UserHomeCapabilityMaterializer({
      userDataRoot: join(root, "users"),
    })
    const capability = pluginCapability(pluginSource, {
      API_KEY: CREDENTIAL_SOURCE,
    })

    const before = await materializer.reconcile({
      ownerId: OWNER_ID,
      capabilities: [
        {
          ...capability,
          credentialFingerprint: "1".repeat(64),
        },
      ],
    })
    const after = await materializer.reconcile({
      ownerId: OWNER_ID,
      capabilities: [
        {
          ...capability,
          credentialFingerprint: "2".repeat(64),
        },
      ],
    })

    expect(after.generation).not.toBe(before.generation)
    const published = await readFile(
      join(
        after.pluginsRoot,
        "calendar-tools",
        ".codex-plugin",
        "plugin.json",
      ),
      "utf8",
    )
    expect(published).not.toContain("1".repeat(64))
    expect(published).not.toContain("2".repeat(64))
  })

  it("does not advance generation or replace prior content when staging fails", async () => {
    const root = await temporaryDirectory()
    const sourceRoot = join(root, "sources")
    const pluginSource = await createPluginSource(
      sourceRoot,
      "calendar-tools",
      "stable",
    )
    const materializer = new UserHomeCapabilityMaterializer({
      userDataRoot: join(root, "users"),
    })
    const initial = await materializer.reconcile({
      ownerId: OWNER_ID,
      capabilities: [pluginCapability(pluginSource)],
    })

    await writeFile(join(pluginSource, "README.md"), "must-not-publish")
    await symlink(
      join(pluginSource, "README.md"),
      join(pluginSource, "unsafe-link"),
    )

    await expect(
      materializer.reconcile({
        ownerId: OWNER_ID,
        capabilities: [pluginCapability(pluginSource)],
      }),
    ).rejects.toThrow(/symbolic links/u)
    await expect(readFile(initial.generationPath, "utf8")).resolves.toBe(
      `${initial.generation}\n`,
    )
    await expect(
      readFile(
        join(initial.pluginsRoot, "calendar-tools", "README.md"),
        "utf8",
      ),
    ).resolves.toBe("stable")
  })

  it("rejects an invalid plugin source entry before replacing published content", async () => {
    const root = await temporaryDirectory()
    const sourceRoot = join(root, "sources")
    const pluginSource = await createPluginSource(
      sourceRoot,
      "calendar-tools",
      "plugin",
    )
    const skillSource = await createSkillSource(
      sourceRoot,
      "report-writer",
      "old skill",
    )
    const materializer = new UserHomeCapabilityMaterializer({
      userDataRoot: join(root, "users"),
    })
    const initial = await materializer.reconcile({
      ownerId: OWNER_ID,
      capabilities: [
        pluginCapability(pluginSource),
        skillCapability(skillSource),
      ],
    })

    await writeFile(
      join(skillSource, "SKILL.md"),
      "---\nname: report-writer\n---\n\nnew skill\n",
    )
    await rm(join(initial.pluginsRoot, "calendar-tools"), {
      recursive: true,
      force: true,
    })
    await writeFile(join(initial.pluginsRoot, "calendar-tools"), "invalid")

    await expect(
      materializer.reconcile({
        ownerId: OWNER_ID,
        capabilities: [
          pluginCapability(pluginSource),
          skillCapability(skillSource),
        ],
      }),
    ).rejects.toThrow(/plugin root entries must be real directories/u)
    await expect(readFile(initial.generationPath, "utf8")).resolves.toBe(
      `${initial.generation}\n`,
    )
    await expect(
      readFile(
        join(initial.skillsRoot, "report-writer", "SKILL.md"),
        "utf8",
      ),
    ).resolves.toContain("old skill")
    expect(
      (await readdir(initial.managedRoot)).filter((name) =>
        name.startsWith(".capabilities-"),
      ),
    ).toEqual([])
  })

  it("rejects invalid Skill frontmatter before replacing published content", async () => {
    const root = await temporaryDirectory()
    const sourceRoot = join(root, "sources")
    const pluginSource = await createPluginSource(
      sourceRoot,
      "calendar-tools",
      "stable plugin",
    )
    const skillSource = await createSkillSource(
      sourceRoot,
      "report-writer",
      "stable skill",
    )
    const materializer = new UserHomeCapabilityMaterializer({
      userDataRoot: join(root, "users"),
    })
    const capabilities = [
      pluginCapability(pluginSource),
      skillCapability(skillSource),
    ]
    const initial = await materializer.reconcile({
      ownerId: OWNER_ID,
      capabilities,
    })

    await writeFile(
      join(skillSource, "SKILL.md"),
      [
        "---",
        "name: report-writer",
        'metadata: {"openclaw": {"id": "broken"}',
        "---",
        "",
        "new skill",
      ].join("\n"),
    )

    await expect(
      materializer.reconcile({ ownerId: OWNER_ID, capabilities }),
    ).rejects.toThrow(/skill manifest is invalid/u)
    await expect(readFile(initial.generationPath, "utf8")).resolves.toBe(
      `${initial.generation}\n`,
    )
    await expect(
      readFile(
        join(initial.skillsRoot, "report-writer", "SKILL.md"),
        "utf8",
      ),
    ).resolves.toContain("stable skill")
    expect(
      (await readdir(initial.managedRoot)).filter((name) =>
        name.startsWith(".capabilities-"),
      ),
    ).toEqual([])
  })

  it("rejects owner traversal and refuses an owner-root symbolic link", async () => {
    const root = await temporaryDirectory()
    const userDataRoot = join(root, "users")
    const materializer = new UserHomeCapabilityMaterializer({ userDataRoot })

    expect(() => materializer.pathsFor("../outside")).toThrow(/owner id/u)

    const outside = join(root, "outside")
    await mkdir(userDataRoot)
    await mkdir(outside)
    await symlink(outside, join(userDataRoot, OWNER_ID))
    await expect(
      materializer.reconcile({ ownerId: OWNER_ID, capabilities: [] }),
    ).rejects.toThrow(/real directory/u)
    expect(await readdir(outside)).toEqual([])
  })

  it("serializes concurrent publications and leaves one coherent final generation", async () => {
    const root = await temporaryDirectory()
    const sourceRoot = join(root, "sources")
    const firstSource = await createPluginSource(
      join(sourceRoot, "first"),
      "calendar-tools",
      "first",
    )
    const secondSource = await createPluginSource(
      join(sourceRoot, "second"),
      "calendar-tools",
      "second",
    )
    const materializerA = new UserHomeCapabilityMaterializer({
      userDataRoot: join(root, "users"),
    })
    const materializerB = new UserHomeCapabilityMaterializer({
      userDataRoot: join(root, "users"),
    })
    const completions: Array<{ generation: string; content: string }> = []

    const first = materializerA
      .reconcile({
        ownerId: OWNER_ID,
        capabilities: [pluginCapability(firstSource)],
      })
      .then((result) => {
        completions.push({ generation: result.generation, content: "first" })
        return result
      })
    const second = materializerB
      .reconcile({
        ownerId: OWNER_ID,
        capabilities: [pluginCapability(secondSource)],
      })
      .then((result) => {
        completions.push({ generation: result.generation, content: "second" })
        return result
      })

    const [firstResult, secondResult] = await Promise.all([first, second])
    expect(firstResult.generation).not.toBe(secondResult.generation)
    expect(completions).toHaveLength(2)
    const last = completions.at(-1)
    expect(last).toBeDefined()
    const paths = materializerA.pathsFor(OWNER_ID)
    await expect(readFile(paths.generationPath, "utf8")).resolves.toBe(
      `${last?.generation}\n`,
    )
    await expect(
      readFile(
        join(paths.pluginsRoot, "calendar-tools", "README.md"),
        "utf8",
      ),
    ).resolves.toBe(last?.content)
    expect(
      (await readdir(paths.managedRoot)).filter((name) =>
        name.startsWith(".capabilities-"),
      ),
    ).toEqual([])
  })

  it("uses the strict read-only fast path while a running turn holds the publication lock", async () => {
    const root = await temporaryDirectory()
    const pluginSource = await createPluginSource(
      join(root, "sources"),
      "calendar-tools",
      "trusted plugin",
    )
    const publicationGuard = vi.fn(async () => true)
    const materializer = new UserHomeCapabilityMaterializer({
      userDataRoot: join(root, "users"),
      publicationGuard,
    })
    const input = {
      ownerId: OWNER_ID,
      capabilities: [pluginCapability(pluginSource)],
    }
    const initial = await materializer.reconcile(input)
    publicationGuard.mockClear()
    publicationGuard.mockResolvedValue(false)
    const release = await lock(initial.controlCapabilitiesRoot, {
      realpath: false,
      lockfilePath: join(
        initial.controlCapabilitiesRoot,
        CAPABILITY_RECONCILE_LOCK_FILE,
      ),
      stale: 120_000,
      update: 10_000,
    })

    try {
      await expect(
        Promise.race([
          materializer.reconcile(input),
          new Promise((_, reject) =>
            setTimeout(
              () => reject(new Error("strict read-only fast path timed out")),
              500,
            ),
          ),
        ]),
      ).resolves.toMatchObject({ generation: initial.generation })
    } finally {
      await release()
    }
    expect(publicationGuard).not.toHaveBeenCalled()
  })

  it("does not replace canonical sources until a running-turn lease is released", async () => {
    const root = await temporaryDirectory()
    const sourceRoot = join(root, "sources")
    const pluginSource = await createPluginSource(
      sourceRoot,
      "calendar-tools",
      "before",
    )
    const materializer = new UserHomeCapabilityMaterializer({
      userDataRoot: join(root, "users"),
    })
    const initial = await materializer.reconcile({
      ownerId: OWNER_ID,
      capabilities: [pluginCapability(pluginSource)],
    })
    await writeFile(join(pluginSource, "README.md"), "after")
    const release = await lock(initial.controlCapabilitiesRoot, {
      realpath: false,
      lockfilePath: join(
        initial.controlCapabilitiesRoot,
        CAPABILITY_RECONCILE_LOCK_FILE,
      ),
      stale: 120_000,
      update: 10_000,
    })
    let settled = false
    const publication = materializer.reconcile({
      ownerId: OWNER_ID,
      capabilities: [pluginCapability(pluginSource)],
    })
    void publication.then(
      () => {
        settled = true
      },
      () => {
        settled = true
      },
    )

    await new Promise((resolve) => setTimeout(resolve, 75))
    expect(settled).toBe(false)
    await expect(
      readFile(
        join(initial.pluginsRoot, "calendar-tools", "README.md"),
        "utf8",
      ),
    ).resolves.toBe("before")

    await release()
    const published = await publication
    expect(published.generation).not.toBe(initial.generation)
    await expect(
      readFile(
        join(published.pluginsRoot, "calendar-tools", "README.md"),
        "utf8",
      ),
    ).resolves.toBe("after")
  })

  it("verifies and admits an exact same-generation start while a running turn holds reconcile.lock", async () => {
    const root = await temporaryDirectory()
    const pluginSource = await createPluginSource(
      join(root, "sources"),
      "calendar-tools",
      "trusted plugin",
    )
    const materializer = new UserHomeCapabilityMaterializer({
      userDataRoot: join(root, "users"),
    })
    const input = {
      ownerId: OWNER_ID,
      capabilities: [pluginCapability(pluginSource)],
    }
    const initial = await materializer.reconcile(input)
    const release = await lock(initial.controlCapabilitiesRoot, {
      realpath: false,
      lockfilePath: join(
        initial.controlCapabilitiesRoot,
        CAPABILITY_RECONCILE_LOCK_FILE,
      ),
      stale: 120_000,
      update: 10_000,
    })

    try {
      await expect(
        Promise.race([
          materializer.withVerifiedRuntime(
            {
              ...input,
              verification: initial.verification,
            },
            async () => "intent-created",
          ),
          new Promise((_, reject) =>
            setTimeout(
              () => reject(new Error("start fence timed out")),
              500,
            ),
          ),
        ]),
      ).resolves.toBe("intent-created")
    } finally {
      await release()
    }
  })

  it("rejects an old start snapshot after a newer publication wins or the published runtime is tampered", async () => {
    const root = await temporaryDirectory()
    const oldSource = await createPluginSource(
      join(root, "sources-old"),
      "calendar-tools",
      "old",
    )
    const newSource = await createPluginSource(
      join(root, "sources-new"),
      "calendar-tools",
      "new",
    )
    const materializer = new UserHomeCapabilityMaterializer({
      userDataRoot: join(root, "users"),
    })
    const oldInput = {
      ownerId: OWNER_ID,
      capabilities: [pluginCapability(oldSource)],
    }
    const oldPublication = await materializer.reconcile(oldInput)
    const current = await materializer.reconcile({
      ownerId: OWNER_ID,
      capabilities: [pluginCapability(newSource)],
    })
    const action = vi.fn(async () => undefined)

    await expect(
      materializer.withVerifiedRuntime(
        {
          ...oldInput,
          verification: oldPublication.verification,
        },
        action,
      ),
    ).rejects.toMatchObject({
      name: "UserHomeCapabilityMaterializationError",
    })
    expect(action).not.toHaveBeenCalled()

    await writeFile(current.generationPath, `${"f".repeat(64)}\n`)
    await expect(
      materializer.withVerifiedRuntime(
        {
          ownerId: OWNER_ID,
          capabilities: [pluginCapability(newSource)],
          verification: current.verification,
        },
        action,
      ),
    ).rejects.toMatchObject({
      name: "UserHomeCapabilityMaterializationError",
    })
    expect(action).not.toHaveBeenCalled()

    await writeFile(
      current.generationPath,
      `${current.verification.generation}\n`,
    )
    await writeFile(
      join(current.pluginsRoot, "calendar-tools", "README.md"),
      "tampered",
    )
    await expect(
      materializer.withVerifiedRuntime(
        {
          ownerId: OWNER_ID,
          capabilities: [pluginCapability(newSource)],
          verification: current.verification,
        },
        action,
      ),
    ).rejects.toMatchObject({
      name: "UserHomeCapabilityMaterializationError",
    })
    expect(action).not.toHaveBeenCalled()
  })

  it("lets start-intent creation win the short fence and then defers a changed publication", async () => {
    const root = await temporaryDirectory()
    const oldSource = await createPluginSource(
      join(root, "sources-old"),
      "calendar-tools",
      "old",
    )
    const newSource = await createPluginSource(
      join(root, "sources-new"),
      "calendar-tools",
      "new",
    )
    let activeIntent = false
    const publicationGuard = vi.fn(async () => !activeIntent)
    const materializer = new UserHomeCapabilityMaterializer({
      userDataRoot: join(root, "users"),
      publicationGuard,
    })
    const oldInput = {
      ownerId: OWNER_ID,
      capabilities: [pluginCapability(oldSource)],
    }
    const initial = await materializer.reconcile(oldInput)
    let changedPublication: Promise<unknown> | undefined

    await materializer.withVerifiedRuntime(
      {
        ...oldInput,
        verification: initial.verification,
      },
      async () => {
        activeIntent = true
        changedPublication = materializer.reconcile({
          ownerId: OWNER_ID,
          capabilities: [pluginCapability(newSource)],
        })
      },
    )

    await expect(changedPublication).rejects.toMatchObject({
      name: "UserHomeCapabilityPublicationDeferredError",
    })
    await expect(
      readFile(
        join(initial.pluginsRoot, "calendar-tools", "README.md"),
        "utf8",
      ),
    ).resolves.toBe("old")
  })
})

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(
    join(tmpdir(), "linksense-user-capabilities-"),
  )
  temporaryDirectories.push(directory)
  return directory
}

async function createPluginSource(
  parent: string,
  name: string,
  body: string,
): Promise<string> {
  const root = join(parent, name)
  await mkdir(join(root, ".codex-plugin"), { recursive: true })
  await writeFile(
    join(root, ".codex-plugin", "plugin.json"),
    JSON.stringify({
      name,
      version: "1.0.0",
      mcpServers: {
        calendar: {
          command: "node",
          args: ["server.js"],
          env_vars: ["API_KEY"],
          env: {
            API_KEY: "static-default",
            UNRELATED: "kept",
          },
        },
      },
    }),
  )
  await writeFile(join(root, "README.md"), body)
  return root
}

async function createSkillSource(
  parent: string,
  name: string,
  body: string,
): Promise<string> {
  const root = join(parent, name)
  await mkdir(root, { recursive: true })
  await writeFile(
    join(root, "SKILL.md"),
    `---\nname: ${name}\n---\n\n${body}\n`,
  )
  return root
}

function pluginCapability(
  sourcePath: string,
  credentialEnvironment?: Record<string, string>,
): UserHomeCapabilityInput {
  return {
    id: PLUGIN_ID,
    name: "calendar-tools",
    type: "plugin",
    sourcePath,
    revision: "same-revision",
    ...(credentialEnvironment ? { credentialEnvironment } : {}),
  }
}

function skillCapability(sourcePath: string): UserHomeCapabilityInput {
  return {
    id: SKILL_ID,
    name: "report-writer",
    type: "skill",
    sourcePath,
    revision: "skill-revision",
  }
}

async function pathMode(target: string): Promise<number> {
  return (await lstat(target)).mode & 0o7777
}
