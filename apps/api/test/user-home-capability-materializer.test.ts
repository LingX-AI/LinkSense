import {
  mkdir,
  readFile,
  readdir,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises"
import { join } from "node:path"
import { lock } from "proper-lockfile"
import { describe, expect, it, vi } from "vitest"
import {
  BUILT_IN_CAPABILITY_RUNTIME_REVISION,
  CAPABILITY_RECONCILE_LOCK_FILE,
  CAPABILITY_SOURCE_DIGEST_FILE,
  PLUGIN_STDIO_LAUNCHER_COMMAND,
  UserHomeCapabilityMaterializer,
} from "../src/modules/capabilities/user-home-materializer.js"
import {
  CREDENTIAL_SOURCE,
  OWNER_ID,
  SECOND_CREDENTIAL_SOURCE,
  createPluginSource,
  createSkillSource,
  pluginCapability,
  skillCapability,
  useCapabilityFilesystem,
} from "./user-home-capability-fixture.js"
const TASK_ID = "01900000-0000-7000-8000-000000000011"
const { temporaryDirectory } = useCapabilityFilesystem()

const { syncFileHandle } = vi.hoisted(() => ({
  syncFileHandle: vi.fn(async () => undefined),
}))

// Publication rules exercise real files and atomic renames. Physical flushes
// are covered separately by user-home-capability-durability.test.ts.
vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>()
  return {
    ...actual,
    open: async (...args: Parameters<typeof actual.open>) => {
      const handle = await actual.open(...args)
      handle.sync = syncFileHandle
      return handle
    },
  }
})

describe.concurrent("UserHomeCapabilityMaterializer", () => {
  it("publishes native display metadata while keeping the original Skill directory and name", async () => {
    const root = await temporaryDirectory()
    const source = await createSkillSource(
      join(root, "sources"),
      "report-writer",
      "# Reports",
    )
    const metadata =
      'interface:\n  display_name: "报告助手"\n  default_prompt: "Use $report-writer"\n'
    await mkdir(join(source, "agents"))
    await writeFile(join(source, "agents", "openai.yaml"), metadata)
    const materializer = new UserHomeCapabilityMaterializer({
      userDataRoot: join(root, "users"),
    })
    const published = await materializer.reconcile({
      ownerId: OWNER_ID,
      conversationId: TASK_ID,
      capabilities: [skillCapability(source)],
    })
    expect(
      await readFile(
        join(published.skillsRoot, "report-writer", "agents", "openai.yaml"),
        "utf8",
      ),
    ).toBe(metadata)
    expect(
      await readFile(
        join(published.skillsRoot, "report-writer", "SKILL.md"),
        "utf8",
      ),
    ).toContain("name: report-writer")
    expect(await readdir(published.skillsRoot)).not.toContain("报告助手")
  })

  it.sequential(
    "rolls back publication when flushing the new content fails",
    async () => {
      const root = await temporaryDirectory()
      const source = await createPluginSource(
        join(root, "sources"),
        "calendar-tools",
        "before",
      )
      const materializer = new UserHomeCapabilityMaterializer({
        userDataRoot: join(root, "users"),
      })
      const input = {
        ownerId: OWNER_ID, conversationId: TASK_ID,
        capabilities: [pluginCapability(source)],
      }
      const initial = await materializer.reconcile(input)
      await writeFile(join(source, "README.md"), "after")
      syncFileHandle.mockRejectedValueOnce(new Error("disk flush failed"))

      await expect(materializer.reconcile(input)).rejects.toMatchObject({
        name: "UserHomeCapabilityMaterializationError",
        cause: expect.objectContaining({ message: "disk flush failed" }),
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
      const retried = await materializer.reconcile(input)
      expect(retried.generation).not.toBe(initial.generation)
      await expect(
        readFile(
          join(retried.pluginsRoot, "calendar-tools", "README.md"),
          "utf8",
        ),
      ).resolves.toBe("after")
    },
  )

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
      ownerId: OWNER_ID, conversationId: TASK_ID,
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
      ownerId: OWNER_ID, conversationId: TASK_ID,
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
      ownerId: OWNER_ID, conversationId: TASK_ID,
      capabilities: [capability],
    })
    await writeFile(join(pluginSource, "README.md"), "after")
    const after = await materializer.reconcile({
      ownerId: OWNER_ID, conversationId: TASK_ID,
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
      ownerId: OWNER_ID, conversationId: TASK_ID,
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
      ownerId: OWNER_ID, conversationId: TASK_ID,
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
      ownerId: OWNER_ID, conversationId: TASK_ID,
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
      ownerId: OWNER_ID, conversationId: TASK_ID,
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
      ownerId: OWNER_ID, conversationId: TASK_ID,
      capabilities: [capability],
    })
    lifecycle.length = 0

    await expect(
      materializer.withPublicationStartFence({ ownerId: OWNER_ID, conversationId: TASK_ID }, () =>
        materializer.resolvePublishedRuntimeWithinPublicationStartFence({
          ownerId: OWNER_ID, conversationId: TASK_ID,
          capabilities: [capability],
        }),
      ),
    ).resolves.toMatchObject({ verification: initial.verification })
    expect(lifecycle).toEqual([])

    const republished = await materializer.withPublicationStartFence(
      { ownerId: OWNER_ID, conversationId: TASK_ID },
      () =>
        materializer.resolvePublishedRuntimeWithinPublicationStartFence({
          ownerId: OWNER_ID, conversationId: TASK_ID,
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
      ownerId: OWNER_ID, conversationId: TASK_ID,
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
      ownerId: OWNER_ID, conversationId: TASK_ID,
      capabilities: [capability],
    })
    publicationGuard.mockClear()
    publicationGuard.mockResolvedValue(false)
    await writeFile(join(pluginSource, "README.md"), "after")

    await expect(
      materializer.reconcile({
        ownerId: OWNER_ID, conversationId: TASK_ID,
        capabilities: [capability],
      }),
    ).rejects.toMatchObject({
      name: "UserHomeCapabilityPublicationDeferredError",
    })
    expect(publicationGuard).toHaveBeenCalledWith({
      ownerId: OWNER_ID, conversationId: TASK_ID,
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
      ownerId: OWNER_ID, conversationId: TASK_ID,
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
      ownerId: OWNER_ID, conversationId: TASK_ID,
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
      ownerId: OWNER_ID, conversationId: TASK_ID,
      capabilities: [capability],
    })
    publicationGuard.mockClear()
    await writeFile(join(pluginSource, "README.md"), "after")

    const published = await materializer.reconcile({
      ownerId: OWNER_ID, conversationId: TASK_ID,
      capabilities: [capability],
    })

    expect(publicationGuard).toHaveBeenCalledTimes(1)
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
      ownerId: OWNER_ID, conversationId: TASK_ID,
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
      ownerId: OWNER_ID, conversationId: TASK_ID,
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
      ownerId: OWNER_ID, conversationId: TASK_ID,
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
        ownerId: OWNER_ID, conversationId: TASK_ID,
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
      ownerId: OWNER_ID, conversationId: TASK_ID,
      capabilities: [],
    })
    const outside = join(root, "outside-cache")
    await mkdir(outside)
    await symlink(outside, join(initial.pluginsRoot, "cache"))

    await expect(
      materializer.reconcile({
        ownerId: OWNER_ID, conversationId: TASK_ID,
        capabilities: [],
      }),
    ).rejects.toThrow(/real director(?:y|ies)/u)

    await rm(join(initial.pluginsRoot, "cache"))
    await writeFile(join(initial.pluginsRoot, "unlisted-plugin"), "invalid")
    await expect(
      materializer.reconcile({
        ownerId: OWNER_ID, conversationId: TASK_ID,
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
      ownerId: OWNER_ID, conversationId: TASK_ID,
      capabilities: [
        {
          ...capability,
          credentialFingerprint: "1".repeat(64),
        },
      ],
    })
    const after = await materializer.reconcile({
      ownerId: OWNER_ID, conversationId: TASK_ID,
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
      ownerId: OWNER_ID, conversationId: TASK_ID,
      capabilities: [pluginCapability(pluginSource)],
    })

    await writeFile(join(pluginSource, "README.md"), "must-not-publish")
    await symlink(
      join(pluginSource, "README.md"),
      join(pluginSource, "unsafe-link"),
    )

    await expect(
      materializer.reconcile({
        ownerId: OWNER_ID, conversationId: TASK_ID,
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
      ownerId: OWNER_ID, conversationId: TASK_ID,
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
        ownerId: OWNER_ID, conversationId: TASK_ID,
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
      ownerId: OWNER_ID, conversationId: TASK_ID,
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
      materializer.reconcile({ ownerId: OWNER_ID, conversationId: TASK_ID, capabilities }),
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

    expect(() => materializer.pathsFor("../outside", TASK_ID)).toThrow(/owner id/u)

    const outside = join(root, "outside")
    await mkdir(userDataRoot)
    await mkdir(outside)
    await symlink(outside, join(userDataRoot, OWNER_ID))
    await expect(
      materializer.reconcile({ ownerId: OWNER_ID, conversationId: TASK_ID, capabilities: [] }),
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
        ownerId: OWNER_ID, conversationId: TASK_ID,
        capabilities: [pluginCapability(firstSource)],
      })
      .then((result) => {
        completions.push({ generation: result.generation, content: "first" })
        return result
      })
    const second = materializerB
      .reconcile({
        ownerId: OWNER_ID, conversationId: TASK_ID,
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
    const paths = materializerA.pathsFor(OWNER_ID, TASK_ID)
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

  it.sequential(
    "uses the strict read-only fast path while a running turn holds the publication lock",
    async () => {
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
        ownerId: OWNER_ID, conversationId: TASK_ID,
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
    },
  )

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
      ownerId: OWNER_ID, conversationId: TASK_ID,
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
      ownerId: OWNER_ID, conversationId: TASK_ID,
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
      ownerId: OWNER_ID, conversationId: TASK_ID,
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
        materializer.withVerifiedRuntime(
          { ...input, verification: initial.verification },
          async () => "intent-created",
        ),
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
      ownerId: OWNER_ID, conversationId: TASK_ID,
      capabilities: [pluginCapability(oldSource)],
    }
    const oldPublication = await materializer.reconcile(oldInput)
    const current = await materializer.reconcile({
      ownerId: OWNER_ID, conversationId: TASK_ID,
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
          ownerId: OWNER_ID, conversationId: TASK_ID,
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
          ownerId: OWNER_ID, conversationId: TASK_ID,
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
      ownerId: OWNER_ID, conversationId: TASK_ID,
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
          ownerId: OWNER_ID, conversationId: TASK_ID,
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
