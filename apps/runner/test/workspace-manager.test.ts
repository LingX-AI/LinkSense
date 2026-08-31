import { createHash } from "node:crypto"
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readlink,
  readdir,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises"
import os from "node:os"
import path from "node:path"

import { afterEach, describe, expect, it, vi } from "vitest"

import {
  CapabilityRuntimeError,
  CapabilityRuntimeManager,
} from "../src/workspace/capability-runtime.js"
import {
  RuntimeGenerationIntegrityError,
  setManagedDirectoryMode,
  WorkspaceBoundaryError,
  WorkspaceManager,
} from "../src/workspace/workspace-manager.js"
import {
  chmodWithFallbackIdentity,
  canWidenDirectoryAsIdentity,
  hasSharedGroupRemovalAccess,
  isolatedIdentityCommandEnvironment,
  writeFileOwnedByIdentity,
  widenDirectoryForSharedGroup,
} from "../src/workspace/filesystem.js"

const roots: string[] = []
const ownerA = "019f45dd-a318-7d02-b03b-eaece8887865"
const ownerB = "019f45dd-a318-7d02-b03b-eaece8887866"
const taskA = "019f45dd-a318-7d02-b03b-eaece8887871"
const taskB = "019f45dd-a318-7d02-b03b-eaece8887872"
const generation = "a".repeat(64)

afterEach(async () => {
  vi.restoreAllMocks()
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  )
})

async function tempRoot(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "linksense-runner-test-"))
  roots.push(root)
  return root
}

describe("workspace filesystem helpers", () => {
  it("only tolerates chmod denial for a shared-group writable directory", () => {
    expect(
      hasSharedGroupRemovalAccess({ gid: 1000, mode: 0o40770 }, 1000),
    ).toBe(true)
    expect(
      hasSharedGroupRemovalAccess({ gid: 1001, mode: 0o40770 }, 1000),
    ).toBe(false)
    expect(
      hasSharedGroupRemovalAccess({ gid: 1000, mode: 0o40750 }, 1000),
    ).toBe(false)
  })

  it("only delegates chmod to the configured owner and shared group", () => {
    expect(
      canWidenDirectoryAsIdentity(
        { uid: 1001, gid: 1000 },
        { uid: 1001, gid: 1000 },
      ),
    ).toBe(true)
    expect(
      canWidenDirectoryAsIdentity(
        { uid: 1002, gid: 1000 },
        { uid: 1001, gid: 1000 },
      ),
    ).toBe(false)
  })

  it.runIf(process.platform === "linux")(
    "widens a task-owned directory through the isolated identity helper",
    async () => {
      const root = await tempRoot()
      const directory = path.join(root, "task-owned")
      await mkdir(directory, { mode: 0o700 })
      const info = await lstat(directory)

      await widenDirectoryForSharedGroup(directory, info.mode, {
        uid: info.uid,
        gid: info.gid,
      })

      expect((await lstat(directory)).mode & 0o777).toBe(0o770)
    },
  )

  it("delegates chmod after EPERM only to the matching isolated identity", async () => {
    const permissionError = Object.assign(new Error("denied"), {
      code: "EPERM",
    })
    const chmodPath = vi.fn().mockRejectedValue(permissionError)
    const chmodAsIdentityPath = vi.fn().mockResolvedValue(undefined)
    const identity = { uid: 1001, gid: 1000 }

    await chmodWithFallbackIdentity(
      "/task-owned/plugin-cache",
      0o550,
      identity,
      identity,
      { chmodPath, chmodAsIdentityPath },
    )

    expect(chmodAsIdentityPath).toHaveBeenCalledWith(
      "/task-owned/plugin-cache",
      0o550,
      identity,
    )
    await expect(
      chmodWithFallbackIdentity(
        "/foreign/plugin-cache",
        0o550,
        { uid: 1002, gid: 1000 },
        identity,
        { chmodPath, chmodAsIdentityPath },
      ),
    ).rejects.toBe(permissionError)
  })

  it("applies worker HOME modes through the configured task identity", async () => {
    const identity = { uid: 1001, gid: 1000 }
    const info = {
      uid: identity.uid,
      gid: identity.gid,
      mode: 0o40700,
      isDirectory: () => true,
      isSymbolicLink: () => false,
    }
    const chmodWithFallbackIdentityPath = vi.fn().mockResolvedValue(undefined)

    await setManagedDirectoryMode("/home/linksense", 0o770, identity, {
      lstatPath: vi.fn().mockResolvedValue(info),
      chmodWithFallbackIdentityPath,
    })

    expect(chmodWithFallbackIdentityPath).toHaveBeenCalledWith(
      "/home/linksense",
      0o770,
      info,
      identity,
    )
  })

  it("does not spawn the fallback identity when a managed directory is already correct", async () => {
    const chmodWithFallbackIdentityPath = vi.fn().mockResolvedValue(undefined)

    await setManagedDirectoryMode(
      "/home/linksense/workspaces",
      0o2770,
      { uid: 1001, gid: 1000 },
      {
        lstatPath: vi.fn().mockResolvedValue({
          uid: 1001,
          gid: 1000,
          mode: 0o42770,
          isDirectory: () => true,
          isSymbolicLink: () => false,
        }),
        chmodWithFallbackIdentityPath,
      },
    )

    expect(chmodWithFallbackIdentityPath).not.toHaveBeenCalled()
  })

  it("rejects a symlink before changing a managed directory mode", async () => {
    const chmodWithFallbackIdentityPath = vi.fn().mockResolvedValue(undefined)

    await expect(
      setManagedDirectoryMode("/home/linksense", 0o770, undefined, {
        lstatPath: vi.fn().mockResolvedValue({
          uid: 1001,
          gid: 1000,
          mode: 0o40770,
          isDirectory: () => false,
          isSymbolicLink: () => true,
        }),
        chmodWithFallbackIdentityPath,
      }),
    ).rejects.toThrow(WorkspaceBoundaryError)
    expect(chmodWithFallbackIdentityPath).not.toHaveBeenCalled()
  })

  it("does not expose supervisor secrets to the isolated helper", () => {
    expect(isolatedIdentityCommandEnvironment()).toEqual({})
    expect(
      isolatedIdentityCommandEnvironment(),
    ).not.toHaveProperty("LINKSENSE_RUNNER_SHARED_SECRET")
  })

  it("hands a supervisor-owned config file to the isolated identity", async () => {
    const removePath = vi.fn().mockResolvedValue(undefined)
    const writeAsIdentityPath = vi.fn().mockResolvedValue(undefined)
    const identity = { uid: 1001, gid: 1000 }

    await writeFileOwnedByIdentity(
      "/task-home/config.toml",
      "model = \"test\"\n",
      0o640,
      identity,
      {
        effectiveUid: 0,
        lstatPath: vi.fn().mockResolvedValue({
          uid: 0,
          gid: 1000,
          isFile: () => true,
          isSymbolicLink: () => false,
        }),
        removePath,
        writeAsIdentityPath,
      },
    )

    expect(removePath).toHaveBeenCalledWith("/task-home/config.toml")
    expect(writeAsIdentityPath).toHaveBeenCalledWith(
      "/task-home/config.toml",
      "model = \"test\"\n",
      0o640,
      identity,
      "create",
    )
  })
})

describe("WorkspaceManager", () => {
  it("shares one user HOME and CODEX_HOME while keeping task workspaces isolated", async () => {
    const root = await tempRoot()
    const manager = new WorkspaceManager(root)
    manager.bindOwner(taskA, ownerA)
    manager.bindOwner(taskB, ownerA)
    const otherTask = "019f45dd-a318-7d02-b03b-eaece8887873"
    manager.bindOwner(otherTask, ownerB)

    const [first, second, other] = await Promise.all([
      manager.ensureConversation(taskA, "current"),
      manager.ensureConversation(taskB, "current"),
      manager.ensureConversation(otherTask, "current"),
    ])

    expect(first.home).toBe(path.join(root, ownerA, "home"))
    expect(first.codexHome).toBe(path.join(first.home, ".codex"))
    expect(second.home).toBe(first.home)
    expect(second.codexHome).toBe(first.codexHome)
    expect(second.workspace).not.toBe(first.workspace)
    expect(second.taskControl).not.toBe(first.taskControl)
    expect(first.workspace).toBe(path.join(first.home, "workspaces", taskA))
    expect(first.taskControl).toBe(
      path.join(root, ownerA, "control", "workspaces", taskA),
    )
    expect(other.home).not.toBe(first.home)
    const taskAgentsFile = await readFile(
      path.join(first.workspace, "AGENTS.md"),
      "utf8",
    )
    expect(taskAgentsFile).toContain(
      "Only operate inside the current task workspace",
    )
    expect(taskAgentsFile).toContain(
      "built-in `linksense-skill-creator` workflow",
    )
    expect(taskAgentsFile).toContain(
      "Only the LinkSense File Service can provide user-downloadable files",
    )
    expect(taskAgentsFile).toContain(
      "mention the registered display name only as plain text",
    )
    expect(taskAgentsFile).toContain(
      "the attachment card is the only download control",
    )
    expect(taskAgentsFile).toContain(
      "Never emit a Markdown or HTML download link",
    )
    expect(taskAgentsFile).toContain("localhost`/`127.0.0.1")
    expect(taskAgentsFile).toContain("do not offer a local-path fallback")
    expect(
      (await lstat(path.join(first.workspace, "AGENTS.md"))).mode & 0o777,
    ).toBe(0o640)
    expect(await readFile(path.join(first.codexHome, "AGENTS.md"), "utf8"))
      .toContain("No custom instructions are configured.")
  })

  it("exposes user Skill resources through a workspace skills link", async () => {
    const root = await tempRoot()
    const manager = new WorkspaceManager(root)
    manager.bindOwner(taskA, ownerA)

    const paths = await manager.ensureConversation(taskA, "current")
    const skillsLink = path.join(paths.workspace, "skills")
    const skillsRoot = path.join(paths.home, ".agents", "skills")
    const skillsTarget = path.relative(paths.workspace, skillsRoot)

    expect((await lstat(skillsLink)).isSymbolicLink()).toBe(true)
    expect(await readlink(skillsLink)).toBe(skillsTarget)
    expect(path.resolve(paths.workspace, skillsTarget)).toBe(skillsRoot)

    const scriptPath = path.join(
      skillsRoot,
      "ui-ux-pro-max",
      "scripts",
      "search.py",
    )
    await mkdir(path.dirname(scriptPath), { recursive: true })
    await writeFile(scriptPath, "print('ok')\n")

    await expect(
      readFile(
        path.join(
          paths.workspace,
          "skills",
          "ui-ux-pro-max",
          "scripts",
          "search.py",
        ),
        "utf8",
      ),
    ).resolves.toBe("print('ok')\n")
  })

  it("replaces an absolute workspace skills symlink with a relative link", async () => {
    const root = await tempRoot()
    const manager = new WorkspaceManager(root)
    manager.bindOwner(taskA, ownerA)
    const paths = manager.pathsFor(taskA)
    const skillsLink = path.join(paths.workspace, "skills")
    const skillsRoot = path.join(paths.home, ".agents", "skills")
    const skillsTarget = path.relative(paths.workspace, skillsRoot)
    await mkdir(paths.workspace, { recursive: true })
    await mkdir(skillsRoot, { recursive: true })
    await symlink(skillsRoot, skillsLink, "dir")

    await manager.ensureConversation(taskA, "current")

    expect((await lstat(skillsLink)).isSymbolicLink()).toBe(true)
    expect(await readlink(skillsLink)).toBe(skillsTarget)
  })

  it("does not replace a pre-existing workspace skills directory", async () => {
    const root = await tempRoot()
    const manager = new WorkspaceManager(root)
    manager.bindOwner(taskA, ownerA)
    const paths = manager.pathsFor(taskA)
    const skillsDirectory = path.join(paths.workspace, "skills")
    await mkdir(skillsDirectory, { recursive: true })
    await writeFile(path.join(skillsDirectory, "README.md"), "local notes")

    await manager.ensureConversation(taskA, "current")

    const info = await lstat(skillsDirectory)
    expect(info.isDirectory()).toBe(true)
    expect(info.isSymbolicLink()).toBe(false)
    await expect(
      readFile(path.join(skillsDirectory, "README.md"), "utf8"),
    ).resolves.toBe("local notes")
  })

  it("persists isolated personalization and materializes native global instructions", async () => {
    const root = await tempRoot()
    const manager = new WorkspaceManager(root)

    const initial = await manager.getPersonalization(ownerA)
    expect(initial).toMatchObject({
      custom_instructions: "",
      memories_enabled: true,
    })

    const updated = await manager.updatePersonalization(ownerA, {
      custom_instructions: "请优先使用中文，并运行相关测试。",
      memories_enabled: false,
    })
    expect(updated.revision).not.toBe(initial.revision)
    expect(updated).toMatchObject({
      custom_instructions: "请优先使用中文，并运行相关测试。",
      memories_enabled: false,
    })
    const ownerAPaths = manager.ownerPathsFor(ownerA)
    const globalInstructions = await readFile(
      path.join(ownerAPaths.codexHome, "AGENTS.md"),
      "utf8",
    )
    expect(globalInstructions).toContain("请优先使用中文，并运行相关测试。")
    expect(globalInstructions).toContain(
      "closer LinkSense-managed AGENTS.md",
    )
    expect(
      (await lstat(
        path.join(ownerAPaths.control, "personalization.json"),
      )).mode & 0o777,
    ).toBe(0o600)

    const other = await manager.getPersonalization(ownerB)
    expect(other).toMatchObject({
      custom_instructions: "",
      memories_enabled: true,
    })
    expect(
      await readFile(
        path.join(manager.ownerPathsFor(ownerB).codexHome, "AGENTS.md"),
        "utf8",
      ),
    ).not.toContain("请优先使用中文")

    const restarted = new WorkspaceManager(root)
    await expect(restarted.getPersonalization(ownerA)).resolves.toEqual(
      updated,
    )
  })

  it("does not widen API-managed Skill and Plugin source directories", async () => {
    const root = await tempRoot()
    const fixedHome = path.join(root, "mounted-home")
    const fixedControl = path.join(root, "mounted-control")
    const agentsRoot = path.join(fixedHome, ".agents")
    const skillsRoot = path.join(agentsRoot, "skills")
    const codexHome = path.join(fixedHome, ".codex")
    const pluginsRoot = path.join(codexHome, "plugins")
    await Promise.all([
      mkdir(skillsRoot, { recursive: true }),
      mkdir(pluginsRoot, { recursive: true }),
      mkdir(fixedControl, { recursive: true }),
    ])
    await Promise.all([
      chmod(fixedHome, 0o770),
      chmod(agentsRoot, 0o750),
      chmod(skillsRoot, 0o750),
      chmod(codexHome, 0o770),
      chmod(pluginsRoot, 0o1770),
    ])
    const manager = new WorkspaceManager(root, undefined, {
      fixedOwnerId: ownerA,
      fixedHomeRoot: fixedHome,
      fixedControlRoot: fixedControl,
    })
    manager.bindOwner(taskA, ownerA)

    await manager.ensureConversation(taskA, "current")

    expect((await lstat(agentsRoot)).mode & 0o7777).toBe(0o750)
    expect((await lstat(skillsRoot)).mode & 0o7777).toBe(0o750)
    expect((await lstat(pluginsRoot)).mode & 0o7777).toBe(0o1770)
  })

  it("persists an independent supervisor generation for each task", async () => {
    const root = await tempRoot()
    const manager = new WorkspaceManager(root)
    manager.bindOwner(taskA, ownerA)
    manager.bindOwner(taskB, ownerA)
    const [first, second] = await Promise.all([
      manager.ensureConversation(taskA, "current"),
      manager.ensureConversation(taskB, "current"),
    ])
    const restarted = new WorkspaceManager(root)
    restarted.bindOwner(taskA, ownerA)
    const afterRestart = await restarted.ensureConversation(taskA, "current")

    expect(first.runtimeGeneration).not.toBe(second.runtimeGeneration)
    expect(afterRestart.runtimeGeneration).toBe(first.runtimeGeneration)
    expect(await restarted.readRuntimeGeneration(taskA)).toBe(
      first.runtimeGeneration,
    )
    expect(
      (await lstat(path.join(first.taskControl, "runtime-generation"))).mode &
        0o777,
    ).toBe(0o600)

    await writeFile(
      path.join(first.taskControl, "runtime-generation"),
      "invalid\n",
    )
    expect(await restarted.readRuntimeGeneration(taskA)).toBeNull()
    await expect(
      restarted.ensureConversation(taskA, "current"),
    ).rejects.toBeInstanceOf(RuntimeGenerationIntegrityError)
  })

  it("deletes only one task workspace and control state", async () => {
    const root = await tempRoot()
    const manager = new WorkspaceManager(root)
    manager.bindOwner(taskA, ownerA)
    manager.bindOwner(taskB, ownerA)
    const [first, second] = await Promise.all([
      manager.ensureConversation(taskA, "current"),
      manager.ensureConversation(taskB, "current"),
    ])
    const persistentPlugin = path.join(
      first.codexHome,
      "plugins",
      "documents",
      "marker",
    )
    await mkdir(path.dirname(persistentPlugin), { recursive: true })
    await writeFile(persistentPlugin, "keep")

    await manager.removeConversation(taskA)

    await expect(lstat(first.workspace)).rejects.toMatchObject({ code: "ENOENT" })
    await expect(lstat(first.taskControl)).rejects.toMatchObject({
      code: "ENOENT",
    })
    expect((await lstat(second.workspace)).isDirectory()).toBe(true)
    expect(await readFile(persistentPlugin, "utf8")).toBe("keep")
    expect((await lstat(first.home)).isDirectory()).toBe(true)
    expect((await lstat(first.codexHome)).isDirectory()).toBe(true)
  })

  it("initializes the Codex template once and preserves Codex-owned user state", async () => {
    const root = await tempRoot()
    const template = path.join(root, "template")
    await mkdir(template)
    await Promise.all([
      writeFile(
        path.join(template, "config.toml"),
        'model = "template"\nmodel_provider = "provider-a"\n',
      ),
      writeFile(path.join(template, "auth.json"), '{"token":"template"}\n'),
    ])
    const manager = new WorkspaceManager(root, template, {
      codexModel: "configured-model",
    })
    manager.bindOwner(taskA, ownerA)
    manager.bindOwner(taskB, ownerA)
    const first = await manager.ensureConversation(taskA, "current")
    const configPath = path.join(first.codexHome, "config.toml")
    const authPath = path.join(first.codexHome, "auth.json")
    expect(await readFile(configPath, "utf8")).toContain(
      'model = "configured-model"',
    )

    await manager.configureBuiltInMcp(taskA, {
      command: "node",
      args: ["core-service.js"],
      managedBrowserArgs: ["managed-browser-service.js"],
      knowledgeSearchTimeoutMs: 181_234,
    })
    const managedServiceConfig = await readFile(configPath, "utf8")
    expect(managedServiceConfig).toContain(
      "[mcp_servers.linksense_core]",
    )
    expect(managedServiceConfig).toContain('args = ["core-service.js"]')
    expect(managedServiceConfig).toContain(
      'env_vars = ["LINKSENSE_COLLABORATION_MODE", "LINKSENSE_CONVERSATION_ID", "LINKSENSE_CURRENT_USER_ENDPOINT", "LINKSENSE_CURRENT_USER_TOKEN", "LINKSENSE_FILE_SERVICE_ENDPOINT", "LINKSENSE_FILE_SERVICE_TOKEN", "LINKSENSE_FORM_SERVICE_ENDPOINT", "LINKSENSE_FORM_SERVICE_TOKEN", "LINKSENSE_IMAGE_GENERATION_ENDPOINT", "LINKSENSE_IMAGE_GENERATION_TOKEN", "LINKSENSE_KNOWLEDGE_SEARCH_ENDPOINT", "LINKSENSE_KNOWLEDGE_SEARCH_TIMEOUT_MS", "LINKSENSE_KNOWLEDGE_SERVICE_TOKEN", "LINKSENSE_SKILL_CREATOR_ENDPOINT", "LINKSENSE_SKILL_CREATOR_TOKEN"]',
    )
    expect(managedServiceConfig).toContain("required = true")
    expect(managedServiceConfig).toContain("tool_timeout_sec = 630")
    expect(managedServiceConfig).not.toContain(
      "[mcp_servers.linksense_file_service]",
    )
    expect(managedServiceConfig).not.toContain(
      "[mcp_servers.linksense_image_generation]",
    )
    expect(managedServiceConfig).not.toContain(
      "[mcp_servers.linksense_knowledge_service]",
    )
    expect(managedServiceConfig).not.toContain(
      "[mcp_servers.linksense_skill_creator]",
    )
    expect(managedServiceConfig).toContain(
      "[mcp_servers.linksense_managed_browser]",
    )
    expect(managedServiceConfig).toContain(
      'args = ["managed-browser-service.js"]',
    )
    expect(managedServiceConfig).toContain("enabled = false")
    expect(managedServiceConfig).toContain(
      'env_vars = ["HOME", "CODEX_HOME", "LINKSENSE_CONVERSATION_ID", "LINKSENSE_BROWSER_READ_ONLY"]',
    )
    expect(managedServiceConfig).toContain(
      "tool_timeout_sec = 630 # linksense-core-service:end",
    )
    expect(managedServiceConfig).toContain(
      "tool_timeout_sec = 130 # linksense-managed-browser-service:end",
    )
    expect(managedServiceConfig).not.toMatch(
      /^# linksense-(?:core|managed-browser)-service:end$/gmu,
    )

    const nativePluginConfig = [
      managedServiceConfig.trimEnd(),
      "",
      '[plugins."managebac-connector@linksense-personal"]',
      "enabled = true",
      "",
    ].join("\n")
    await writeFile(configPath, nativePluginConfig)

    await manager.configureBuiltInMcp(taskA, {
      command: "node",
      args: ["core-service.js"],
      managedBrowserArgs: ["managed-browser-service.js"],
      knowledgeSearchTimeoutMs: 181_234,
    })

    const refreshedManagedServiceConfig = await readFile(configPath, "utf8")
    expect(refreshedManagedServiceConfig).toContain(
      '[plugins."managebac-connector@linksense-personal"]',
    )
    expect(refreshedManagedServiceConfig).toContain("enabled = true")

    const codexManagedConfig = `${refreshedManagedServiceConfig}\n[plugins.documents]\nenabled = true\n`
    await Promise.all([
      writeFile(configPath, codexManagedConfig),
      writeFile(authPath, '{"token":"codex-updated"}\n'),
      writeFile(
        path.join(template, "config.toml"),
        'model_provider = "provider-b"\n',
      ),
      writeFile(path.join(template, "auth.json"), '{"token":"new-template"}\n'),
    ])

    await manager.ensureConversation(taskB, "replacement")

    expect(await readFile(configPath, "utf8")).toBe(codexManagedConfig)
    expect(await readFile(authPath, "utf8")).toBe(
      '{"token":"codex-updated"}\n',
    )
  })

  it("migrates a legacy unmarked model provider without creating duplicate TOML tables", async () => {
    const root = await tempRoot()
    const template = path.join(root, "template")
    await mkdir(template)
    await writeFile(
      path.join(template, "config.toml"),
      [
        'model_provider = "link-sense"',
        "",
        "[model_providers.link-sense]",
        'name = "OpenAI"',
        'base_url = "http://legacy-provider.example.test"',
        'wire_api = "responses"',
        "",
        "# linksense-file-service:start",
        "[mcp_servers.linksense_file_service]",
        'command = "node"',
        "# linksense-file-service:end",
        "",
      ].join("\n"),
    )
    const manager = new WorkspaceManager(root, template)
    manager.bindOwner(taskA, ownerA)
    const paths = await manager.ensureConversation(taskA, "current")

    await manager.configureModelProvider(taskA, {
      revision: 8,
      baseUrl: "https://provider.example.test/v1",
      protocolMode: "native_responses",
    })
    const configPath = path.join(paths.codexHome, "config.toml")
    await writeFile(
      configPath,
      [
        (await readFile(configPath, "utf8")).trimEnd(),
        "",
        '[plugins."managebac-connector@linksense-personal"]',
        "enabled = true",
        "",
      ].join("\n"),
    )
    await manager.configureModelProvider(taskA, {
      revision: 9,
      baseUrl: "https://provider.example.test/v2",
      protocolMode: "responses_tool_compat",
    })

    const config = await readFile(configPath, "utf8")
    expect(config.match(/^\[model_providers\.link-sense\]$/gmu)).toHaveLength(1)
    expect(config).toContain("# revision = 9")
    expect(config).toContain('base_url = "https://provider.example.test/v2"')
    expect(config).toContain(
      'env_key = "LINKSENSE_MODEL_GATEWAY_TOKEN"',
    )
    expect(config).toContain("supports_websockets = true")
    expect(config).toContain("stream_max_retries = 2")
    expect(config).toContain("websocket_connect_timeout_ms = 12000")
    expect(config).toContain(
      "requires_openai_auth = false # linksense-model-provider:end",
    )
    expect(config).not.toMatch(/^# linksense-model-provider:end$/gmu)
    expect(config).not.toContain("env_http_headers")
    expect(config).not.toContain("legacy-provider.example.test")
    expect(config).toContain(
      '[plugins."managebac-connector@linksense-personal"]',
    )
    expect(config).toContain("enabled = true")
    expect(config).toContain("# linksense-file-service:start")
    expect(config).toContain("[mcp_servers.linksense_file_service]")
    expect(config).toContain("# linksense-file-service:end")
  })

  it("writes Codex context-window based automatic compaction settings", async () => {
    const root = await tempRoot()
    const manager = new WorkspaceManager(root)
    manager.bindOwner(taskA, ownerA)
    const paths = await manager.ensureConversation(taskA, "current")

    await manager.configureModelProvider(taskA, {
      revision: 11,
      baseUrl: "https://provider.example.test/v1",
      protocolMode: "native_responses",
      modelContextWindow: 150_000,
    })

    const configPath = path.join(paths.codexHome, "config.toml")
    const configured = await readFile(configPath, "utf8")
    expect(configured).toContain("model_context_window = 150000")
    expect(configured).toContain("model_auto_compact_token_limit = 127500")
    expect(configured).toContain(
      'model_auto_compact_token_limit_scope = "total"',
    )

    await manager.configureModelProvider(taskA, {
      revision: 12,
      baseUrl: "https://provider.example.test/v1",
      protocolMode: "native_responses",
    })

    const unknownContextConfig = await readFile(configPath, "utf8")
    expect(unknownContextConfig).not.toContain("model_context_window")
    expect(unknownContextConfig).not.toContain("model_auto_compact_token_limit")

    await manager.configureModelProvider(taskA, {
      revision: 13,
      baseUrl: "https://provider.example.test/v1",
      protocolMode: "native_responses",
      modelAutoCompactTokenLimit: 219_640,
    })

    const observedContextConfig = await readFile(configPath, "utf8")
    expect(observedContextConfig).not.toContain("model_context_window")
    expect(observedContextConfig).toContain(
      "model_auto_compact_token_limit = 219640",
    )
    expect(observedContextConfig).toContain(
      'model_auto_compact_token_limit_scope = "total"',
    )
  })

  it("disables native Responses WebSockets during a cross-provider transition", async () => {
    const root = await tempRoot()
    const manager = new WorkspaceManager(root)
    manager.bindOwner(taskA, ownerA)
    const paths = await manager.ensureConversation(taskA, "current")

    await manager.configureModelProvider(taskA, {
      revision: 14,
      baseUrl: "https://provider.example.test/v1",
      protocolMode: "native_responses",
      allowWebSockets: false,
    })

    const config = await readFile(
      path.join(paths.codexHome, "config.toml"),
      "utf8",
    )
    expect(config).toContain("supports_websockets = false")
  })

  it("atomically restores shared config access after Codex tightens the file mode", async () => {
    const root = await tempRoot()
    const template = path.join(root, "template")
    await mkdir(template)
    await writeFile(
      path.join(template, "config.toml"),
      'model_provider = "link-sense"\n',
    )
    const manager = new WorkspaceManager(root, template)
    manager.bindOwner(taskA, ownerA)
    const paths = await manager.ensureConversation(taskA, "current")
    const configPath = path.join(paths.codexHome, "config.toml")
    await chmod(configPath, 0o600)

    await manager.configureModelProvider(taskA, {
      revision: 10,
      baseUrl: "https://provider.example.test/v1",
      protocolMode: "chat_completions_bridge",
    })

    expect((await lstat(configPath)).mode & 0o777).toBe(0o660)
    const config = await readFile(configPath, "utf8")
    expect(config).toContain("# revision = 10")
    expect(config).toContain("supports_websockets = false")
  })

  it("normalizes private Codex config files when a worker prepares the next conversation", async () => {
    const root = await tempRoot()
    const template = path.join(root, "template")
    await mkdir(template)
    await Promise.all([
      writeFile(path.join(template, "config.toml"), 'model = "test"\n'),
      writeFile(path.join(template, "auth.json"), '{"token":"test"}\n'),
    ])
    const manager = new WorkspaceManager(root, template, {
      managedCodexFileIdentity: {
        uid: process.getuid!(),
        gid: process.getgid!(),
      },
    })
    manager.bindOwner(taskA, ownerA)
    manager.bindOwner(taskB, ownerA)
    const first = await manager.ensureConversation(taskA, "current")
    const configPath = path.join(first.codexHome, "config.toml")
    const authPath = path.join(first.codexHome, "auth.json")
    await Promise.all([chmod(configPath, 0o000), chmod(authPath, 0o600)])

    await manager.ensureConversation(taskB, "replacement")

    expect((await lstat(configPath)).mode & 0o777).toBe(0o660)
    expect((await lstat(authPath)).mode & 0o777).toBe(0o660)
    expect(await readFile(configPath, "utf8")).toBe('model = "test"\n')
    expect(await readFile(authPath, "utf8")).toBe('{"token":"test"}\n')
  })

  it("rejects a symbolic link in place of a managed Codex config file", async () => {
    const root = await tempRoot()
    const template = path.join(root, "template")
    const externalConfig = path.join(root, "external-config.toml")
    await mkdir(template)
    await Promise.all([
      writeFile(path.join(template, "config.toml"), 'model = "test"\n'),
      writeFile(externalConfig, 'model = "external"\n'),
    ])
    const manager = new WorkspaceManager(root, template, {
      managedCodexFileIdentity: {
        uid: process.getuid!(),
        gid: process.getgid!(),
      },
    })
    manager.bindOwner(taskA, ownerA)
    manager.bindOwner(taskB, ownerA)
    const first = await manager.ensureConversation(taskA, "current")
    const configPath = path.join(first.codexHome, "config.toml")
    await rm(configPath)
    await symlink(externalConfig, configPath)

    await expect(
      manager.ensureConversation(taskB, "replacement"),
    ).rejects.toThrow(WorkspaceBoundaryError)
    expect(await readFile(externalConfig, "utf8")).toBe(
      'model = "external"\n',
    )
  })

  it("uses fixed worker mount roots and rejects cross-owner binding", async () => {
    const root = await tempRoot()
    const fixedHome = path.join(root, "mounted-home")
    const fixedControl = path.join(root, "mounted-control")
    const manager = new WorkspaceManager(root, undefined, {
      fixedOwnerId: ownerA,
      fixedHomeRoot: fixedHome,
      fixedControlRoot: fixedControl,
    })
    manager.bindOwner(taskA, ownerA)

    expect(await manager.ensureConversation(taskA, "current")).toMatchObject({
      home: fixedHome,
      control: fixedControl,
      workspace: path.join(fixedHome, "workspaces", taskA),
      codexHome: path.join(fixedHome, ".codex"),
      taskControl: path.join(fixedControl, "workspaces", taskA),
    })
    expect(() => manager.bindOwner(taskB, ownerB)).toThrow(
      WorkspaceBoundaryError,
    )
  })

  it("discovers task control directories across UUID owners only", async () => {
    const root = await tempRoot()
    const manager = new WorkspaceManager(root)
    manager.bindOwner(taskA, ownerA)
    manager.bindOwner(taskB, ownerB)
    await Promise.all([
      manager.ensureConversation(taskA, "current"),
      manager.ensureConversation(taskB, "current"),
      mkdir(path.join(root, ".runner-health", "control", "workspaces"), {
        recursive: true,
      }),
    ])
    const restarted = new WorkspaceManager(root)

    expect((await restarted.listConversationIds()).sort()).toEqual(
      [taskA, taskB].sort(),
    )
    expect(restarted.ownerFor(taskA)).toBe(ownerA)
    expect(restarted.ownerFor(taskB)).toBe(ownerB)
  })

  it("rejects invalid ids, owner changes, and workspace traversal", () => {
    const manager = new WorkspaceManager("/tmp/linksense-user-data")
    manager.bindOwner(taskA, ownerA)
    expect(() => manager.pathsFor("../other")).toThrow(WorkspaceBoundaryError)
    expect(() => manager.bindOwner(taskA, ownerB)).toThrow(
      WorkspaceBoundaryError,
    )
    expect(() => manager.resolveWorkspacePath(taskA, "../other")).toThrow(
      WorkspaceBoundaryError,
    )
  })
})

describe("CapabilityRuntimeManager", () => {
  it("validates the API-published user HOME without copying source or cache", async () => {
    const fixture = await publishedRuntimeFixture()
    const manager = localCapabilityRuntimeManager()

    await expect(
      manager.resolvePublished({
        userHome: fixture.userHome,
        controlRoot: fixture.controlRoot,
        expectedGeneration: generation,
        capabilities: [
          {
            id: "019f45dd-a318-7d02-b03b-eaece8887881",
            name: "documents",
            type: "plugin",
            revision: "2026-07-24T00:00:00.000Z",
          },
          {
            id: "019f45dd-a318-7d02-b03b-eaece8887882",
            name: "reports",
            type: "skill",
            revision: "2026-07-24T00:00:00.000Z",
          },
        ],
      }),
    ).resolves.toMatchObject({
      skillsRoot: path.join(fixture.userHome, ".agents", "skills"),
      pluginSourceRoot: path.join(
        fixture.userHome,
        ".agents",
        "plugin-sources",
      ),
      marketplacePath: fixture.marketplacePath,
      generation,
    })
  })

  it("fails closed for a stale generation or mismatched marketplace", async () => {
    const fixture = await publishedRuntimeFixture()
    const manager = localCapabilityRuntimeManager()
    const capability = {
      id: "019f45dd-a318-7d02-b03b-eaece8887881",
      name: "documents",
      type: "plugin" as const,
      revision: "2026-07-24T00:00:00.000Z",
    }

    await expect(
      manager.resolvePublished({
        userHome: fixture.userHome,
        controlRoot: fixture.controlRoot,
        expectedGeneration: "b".repeat(64),
        capabilities: [capability],
      }),
    ).rejects.toBeInstanceOf(CapabilityRuntimeError)

    await writeFile(
      fixture.marketplacePath,
      `${JSON.stringify({
        name: "linksense-personal",
        plugins: [],
      })}\n`,
    )
    await expect(
      manager.resolvePublished({
        userHome: fixture.userHome,
        controlRoot: fixture.controlRoot,
        expectedGeneration: generation,
        capabilities: [capability],
      }),
    ).rejects.toBeInstanceOf(CapabilityRuntimeError)
  })

  it("rehashes published content and rejects same-generation tampering", async () => {
    const fixture = await publishedRuntimeFixture()
    const manager = localCapabilityRuntimeManager()
    await writeFile(
      path.join(fixture.skillsRoot, "reports", "SKILL.md"),
      "tampered",
    )

    await expect(
      manager.resolvePublished({
        userHome: fixture.userHome,
        controlRoot: fixture.controlRoot,
        expectedGeneration: generation,
        capabilities: [
          {
            id: "019f45dd-a318-7d02-b03b-eaece8887881",
            name: "documents",
            type: "plugin",
            revision: "current",
          },
          {
            id: "019f45dd-a318-7d02-b03b-eaece8887882",
            name: "reports",
            type: "skill",
            revision: "current",
          },
        ],
      }),
    ).rejects.toBeInstanceOf(CapabilityRuntimeError)
  })

  it("rejects hidden rogue entries in the API-owned plugin source domain", async () => {
    const fixture = await publishedRuntimeFixture()
    const manager = localCapabilityRuntimeManager()
    await mkdir(path.join(fixture.pluginsRoot, ".rogue"))

    await expect(
      manager.resolvePublished({
        userHome: fixture.userHome,
        controlRoot: fixture.controlRoot,
        expectedGeneration: generation,
        capabilities: [
          {
            id: "019f45dd-a318-7d02-b03b-eaece8887881",
            name: "documents",
            type: "plugin",
            revision: "current",
          },
          {
            id: "019f45dd-a318-7d02-b03b-eaece8887882",
            name: "reports",
            type: "skill",
            revision: "current",
          },
        ],
      }),
    ).rejects.toBeInstanceOf(CapabilityRuntimeError)
  })

  it("rejects writable API-managed capability sources", async () => {
    const fixture = await publishedRuntimeFixture()
    const manager = localCapabilityRuntimeManager()
    await chmod(path.join(fixture.skillsRoot, "reports"), 0o770)

    await expect(
      manager.resolvePublished({
        userHome: fixture.userHome,
        controlRoot: fixture.controlRoot,
        expectedGeneration: generation,
        capabilities: [
          {
            id: "019f45dd-a318-7d02-b03b-eaece8887881",
            name: "documents",
            type: "plugin",
            revision: "current",
          },
          {
            id: "019f45dd-a318-7d02-b03b-eaece8887882",
            name: "reports",
            type: "skill",
            revision: "current",
          },
        ],
      }),
    ).rejects.toBeInstanceOf(CapabilityRuntimeError)
  })

  it("returns null until API publication is complete", async () => {
    const root = await tempRoot()
    await expect(
      new CapabilityRuntimeManager().existing(
        path.join(root, "home"),
        path.join(root, "control"),
      ),
    ).resolves.toBeNull()
  })
})

async function publishedRuntimeFixture() {
  const root = await tempRoot()
  const userHome = path.join(root, "home")
  const controlRoot = path.join(root, "control")
  const skillsRoot = path.join(userHome, ".agents", "skills")
  const pluginsRoot = path.join(userHome, ".agents", "plugin-sources")
  const pluginRoot = path.join(pluginsRoot, "documents")
  const marketplacePath = path.join(
    userHome,
    ".agents",
    "plugins",
    "marketplace.json",
  )
  const capabilityControl = path.join(controlRoot, "capabilities")
  await Promise.all([
    mkdir(path.join(skillsRoot, "reports"), { recursive: true }),
    mkdir(path.join(skillsRoot, "linksense-browser"), { recursive: true }),
    mkdir(path.join(skillsRoot, "linksense-document-reader"), {
      recursive: true,
    }),
    mkdir(path.join(skillsRoot, "linksense-docs"), { recursive: true }),
    mkdir(path.join(skillsRoot, "linksense-file-service"), {
      recursive: true,
    }),
    mkdir(path.join(skillsRoot, "linksense-image-generation"), {
      recursive: true,
    }),
    mkdir(path.join(skillsRoot, "linksense-knowledge-base"), {
      recursive: true,
    }),
    mkdir(path.join(skillsRoot, "linksense-skill-creator"), {
      recursive: true,
    }),
    mkdir(pluginRoot, { recursive: true }),
    mkdir(path.join(userHome, ".codex", "plugins"), { recursive: true }),
    mkdir(path.dirname(marketplacePath), { recursive: true }),
    mkdir(capabilityControl, { recursive: true }),
  ])
  const marketplace = `${JSON.stringify({
    name: "linksense-personal",
    plugins: [
      {
        name: "documents",
        source: {
          source: "local",
          path: "./.agents/plugin-sources/documents",
        },
      },
    ],
  })}\n`
  await Promise.all([
    writeFile(path.join(skillsRoot, "reports", "SKILL.md"), "reports"),
    writeFile(
      path.join(skillsRoot, "linksense-browser", "SKILL.md"),
      "browser",
    ),
    writeFile(
      path.join(skillsRoot, "linksense-document-reader", "SKILL.md"),
      "document reader",
    ),
    writeFile(
      path.join(skillsRoot, "linksense-docs", "SKILL.md"),
      "docs",
    ),
    writeFile(
      path.join(skillsRoot, "linksense-file-service", "SKILL.md"),
      "files",
    ),
    writeFile(
      path.join(skillsRoot, "linksense-image-generation", "SKILL.md"),
      "image generation",
    ),
    writeFile(
      path.join(skillsRoot, "linksense-knowledge-base", "SKILL.md"),
      "knowledge",
    ),
    writeFile(
      path.join(skillsRoot, "linksense-skill-creator", "SKILL.md"),
      "creator",
    ),
    writeFile(path.join(pluginRoot, "plugin.json"), "documents"),
    writeFile(marketplacePath, marketplace),
  ])
  const directoryModes = [
    [userHome, 0o770],
    [path.join(userHome, ".agents"), 0o750],
    [skillsRoot, 0o750],
    [path.join(skillsRoot, "reports"), 0o750],
    [path.join(skillsRoot, "linksense-browser"), 0o750],
    [path.join(skillsRoot, "linksense-document-reader"), 0o750],
    [path.join(skillsRoot, "linksense-docs"), 0o750],
    [path.join(skillsRoot, "linksense-file-service"), 0o750],
    [path.join(skillsRoot, "linksense-image-generation"), 0o750],
    [path.join(skillsRoot, "linksense-knowledge-base"), 0o750],
    [path.join(skillsRoot, "linksense-skill-creator"), 0o750],
    [path.join(userHome, ".agents", "plugins"), 0o750],
    [path.join(userHome, ".codex"), 0o770],
    [pluginsRoot, 0o750],
    [pluginRoot, 0o750],
    [capabilityControl, 0o700],
  ] as const
  await Promise.all(
    directoryModes.map(([directory, mode]) => chmod(directory, mode)),
  )
  const sourceFiles = [
    path.join(skillsRoot, "reports", "SKILL.md"),
    path.join(skillsRoot, "linksense-browser", "SKILL.md"),
    path.join(skillsRoot, "linksense-document-reader", "SKILL.md"),
    path.join(skillsRoot, "linksense-docs", "SKILL.md"),
    path.join(skillsRoot, "linksense-file-service", "SKILL.md"),
    path.join(skillsRoot, "linksense-image-generation", "SKILL.md"),
    path.join(skillsRoot, "linksense-knowledge-base", "SKILL.md"),
    path.join(skillsRoot, "linksense-skill-creator", "SKILL.md"),
    path.join(pluginRoot, "plugin.json"),
    marketplacePath,
  ]
  await Promise.all(sourceFiles.map((file) => chmod(file, 0o640)))
  const contentDigest = await testCapabilityContentDigest({
    skillsRoot,
    pluginsRoot,
    marketplacePath,
    pluginNames: ["documents"],
  })
  await Promise.all([
    writeFile(
      path.join(capabilityControl, "capability-generation"),
      `${generation}\n`,
      { mode: 0o600 },
    ),
    writeFile(
      path.join(capabilityControl, "capability-content-sha256"),
      `${contentDigest}\n`,
      { mode: 0o600 },
    ),
  ])
  await Promise.all([
    chmod(path.join(capabilityControl, "capability-generation"), 0o600),
    chmod(path.join(capabilityControl, "capability-content-sha256"), 0o600),
  ])
  return {
    userHome,
    controlRoot,
    marketplacePath,
    skillsRoot,
    pluginsRoot,
    capabilityControl,
    contentDigest,
  }
}

function localCapabilityRuntimeManager(): CapabilityRuntimeManager {
  const identity = {
    uid: process.getuid?.() ?? 1000,
    gid: process.getgid?.() ?? 1000,
  }
  return new CapabilityRuntimeManager({
    apiIdentity: identity,
    taskIdentity: identity,
  })
}

async function testCapabilityContentDigest(input: {
  skillsRoot: string
  pluginsRoot: string
  marketplacePath: string
  pluginNames: string[]
}): Promise<string> {
  const hash = createHash("sha256")
  hash.update("linksense-capability-content\n")
  await testHashTree(input.skillsRoot, "skills", hash)
  hash.update("directory\0plugins\0")
  for (const name of [...input.pluginNames].sort()) {
    await testHashTree(
      path.join(input.pluginsRoot, name),
      `plugins/${name}`,
      hash,
    )
  }
  await testHashTree(input.marketplacePath, "marketplace.json", hash)
  return hash.digest("hex")
}

async function testHashTree(
  currentPath: string,
  relativePath: string,
  hash: ReturnType<typeof createHash>,
): Promise<void> {
  const info = await lstat(currentPath)
  if (info.isFile()) {
    hash.update(`file\0${relativePath}\0${info.mode & 0o111 ? "x" : "-"}\0`)
    hash.update(await readFile(currentPath))
    hash.update("\0")
    return
  }
  hash.update(`directory\0${relativePath}\0`)
  for (const entry of (await readdir(currentPath)).sort()) {
    await testHashTree(
      path.join(currentPath, entry),
      `${relativePath}/${entry}`,
      hash,
    )
  }
}
