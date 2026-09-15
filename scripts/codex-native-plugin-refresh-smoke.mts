import { execFile } from "node:child_process"
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { promisify } from "node:util"

import { UserHomeCapabilityMaterializer } from "../apps/api/src/modules/capabilities/user-home-materializer.ts"
import { prepareNativeHomeFiles } from "../apps/api/src/operations/native-home-files.ts"
import { CodexJsonRpcClient } from "../apps/runner/src/codex/json-rpc-client.ts"
import {
  NATIVE_PLUGIN_MARKETPLACE_NAME,
  NativePluginManager,
  type NativePluginActivation,
} from "../apps/runner/src/codex/native-plugin-manager.ts"
import { CODEX_SCHEMA_VERSION } from "../apps/runner/src/codex/protocol.ts"
import { CapabilityRuntimeManager } from "../apps/runner/src/workspace/capability-runtime.ts"
import { WorkspaceManager } from "../apps/runner/src/workspace/workspace-manager.ts"

const execFileAsync = promisify(execFile)
const codexCommand = process.env.CODEX_BIN?.trim() || "codex"
const ownerId = "01900000-0000-7000-8000-000000000231"
const conversationId = "01900000-0000-7000-8000-000000000232"
const capabilityId = "01900000-0000-7000-8000-000000000233"
const pluginName = "native-refresh-smoke"
const skillName = "refresh-probe"
const pluginVersion = "1.0.0"
const stableRevision = "same-revision"
const firstMarker = "NATIVE_PLUGIN_REFRESH_FIRST_2C1F66"
const secondMarker = "NATIVE_PLUGIN_REFRESH_SECOND_9B42D1"
const repositoryRoot = path.resolve(import.meta.dirname, "..")

type SmokeRuntimePaths = ReturnType<
  UserHomeCapabilityMaterializer["pathsFor"]
> & {
  homeRoot: string
  codexHome: string
}

let completedPhase = "not-started"
let actualCodexVersion: string | undefined

try {
  await runSmoke()
} catch (error) {
  console.error(
    JSON.stringify({
      status: "failed",
      completedPhase,
      codexBinary: codexCommand,
      expectedCodexVersion: CODEX_SCHEMA_VERSION,
      actualCodexVersion,
      error: error instanceof Error ? error.message : String(error),
    }),
  )
  process.exitCode = 1
}

async function runSmoke(): Promise<void> {
  actualCodexVersion = await readCodexVersion()
  if (actualCodexVersion !== CODEX_SCHEMA_VERSION) {
    throw new Error(
      `Codex version mismatch: expected ${CODEX_SCHEMA_VERSION}, received ${actualCodexVersion}`,
    )
  }
  completedPhase = "version-verified"

  const temporaryRoot = await mkdtemp(
    path.join(tmpdir(), "linksense-native-plugin-refresh-"),
  )
  let client: CodexJsonRpcClient | undefined
  try {
    const userDataRoot = path.join(temporaryRoot, "users")
    const sourceRoot = path.join(
      temporaryRoot,
      "capability-source",
      pluginName,
    )
    const materializer = new UserHomeCapabilityMaterializer({ userDataRoot })
    const workspaceManager = new WorkspaceManager(
      userDataRoot,
      path.join(repositoryRoot, "deploy", "codex-home-template"),
    )
    workspaceManager.bindOwner(conversationId, ownerId)
    const conversationPaths = await workspaceManager.ensureConversation(
      conversationId,
    )
    const paths: SmokeRuntimePaths = {
      ...materializer.pathsFor(ownerId, conversationId),
      homeRoot: conversationPaths.home,
      codexHome: conversationPaths.codexHome,
    }
    const controlRoot = conversationPaths.ownerControl
    const workspace = conversationPaths.workspace
    // Exercise the actual CLI against a converted HOME: unlike app-server,
    // plugin commands receive no process-scoped model provider overrides.
    const legacyNative = path.join(temporaryRoot, "legacy-native")
    await mkdir(legacyNative)
    await writeFile(path.join(legacyNative, "config.toml"), [
      'model_provider="link-sense"',
      '[model_providers.link-sense]',
      'base_url="http://127.0.0.1:43123/expired-gateway"',
      'experimental_bearer_token="expired-process-token"',
    ].join("\n"))
    await prepareNativeHomeFiles(legacyNative, paths.codexHome)
    completedPhase = "legacy-config-converted"
    const localUid = process.getuid?.()
    const localGid = process.getgid?.()
    if (localUid === undefined || localGid === undefined) {
      throw new Error("Native plugin refresh smoke requires POSIX uid/gid support")
    }
    const localIdentity = {
      uid: localUid,
      gid: localGid,
    }
    const capabilityRuntimeManager = new CapabilityRuntimeManager({
      apiIdentity: localIdentity,
      taskIdentity: localIdentity,
    })
    const nativePluginManager = new NativePluginManager()
    const capability = {
      id: capabilityId,
      name: pluginName,
      type: "plugin" as const,
      sourcePath: sourceRoot,
      revision: stableRevision,
    }

    await mkdir(workspace, { recursive: true })
    await chmod(paths.homeRoot, 0o770)
    await writePluginSource(sourceRoot, firstMarker)
    const firstPublication = await materializer.reconcile({
      ownerId,
      conversationId,
      capabilities: [capability],
    })
    await projectManagedAgents(paths)
    completedPhase = "first-source-published"

    await reconcileNativePlugin({
      nativePluginManager,
      capabilityRuntimeManager,
      paths,
      controlRoot,
      workspace,
      capability,
      generation: firstPublication.generation,
      pluginNames: [pluginName],
    })
    completedPhase = "first-native-add-completed"

    client = createClient(paths.homeRoot, paths.codexHome)
    await initializeAndAssertIsolated(client, paths.codexHome)
    const firstActivation = await verifyInstalledPlugin(
      nativePluginManager,
      client,
      paths,
      workspace,
      firstMarker,
    )
    await assertSkillCatalog(
      client,
      workspace,
      firstActivation,
      paths.codexHome,
      firstMarker,
    )
    completedPhase = "first-app-server-verified"

    await client.close()
    client = undefined

    // Keep both the plugin manifest version and API revision unchanged. Only
    // the Skill content changes, so this proves that the materialized content
    // hash and native `plugin add` refresh path do not depend on version bumps.
    await writePluginSource(sourceRoot, secondMarker)
    const secondPublication = await materializer.reconcile({
      ownerId,
      conversationId,
      capabilities: [capability],
    })
    await projectManagedAgents(paths)
    if (secondPublication.generation === firstPublication.generation) {
      throw new Error("Skill content change did not produce a new generation")
    }
    completedPhase = "updated-source-published"

    await reconcileNativePlugin({
      nativePluginManager,
      capabilityRuntimeManager,
      paths,
      controlRoot,
      workspace,
      capability,
      generation: secondPublication.generation,
      pluginNames: [pluginName],
    })
    completedPhase = "native-refresh-completed"

    client = createClient(paths.homeRoot, paths.codexHome)
    await initializeAndAssertIsolated(client, paths.codexHome)
    const secondActivation = await verifyInstalledPlugin(
      nativePluginManager,
      client,
      paths,
      workspace,
      secondMarker,
    )
    await assertSkillCatalog(
      client,
      workspace,
      secondActivation,
      paths.codexHome,
      secondMarker,
    )
    const refreshedContent = await readFile(
      requiredSkillPath(secondActivation),
      "utf8",
    )
    if (refreshedContent.includes(firstMarker)) {
      throw new Error("Refreshed native plugin still contains stale Skill content")
    }
    completedPhase = "updated-app-server-verified"

    await client.close()
    client = undefined

    const removedPublication = await materializer.reconcile({
      ownerId,
      conversationId,
      capabilities: [],
    })
    await projectManagedAgents(paths)
    if (removedPublication.generation === secondPublication.generation) {
      throw new Error("Plugin removal did not produce a new generation")
    }
    await assertMissing(path.join(paths.pluginsRoot, pluginName))
    completedPhase = "source-removed"

    await reconcileNativePlugin({
      nativePluginManager,
      capabilityRuntimeManager,
      paths,
      controlRoot,
      workspace,
      generation: removedPublication.generation,
      pluginNames: [],
    })
    completedPhase = "native-remove-completed"

    client = createClient(paths.homeRoot, paths.codexHome)
    await initializeAndAssertIsolated(client, paths.codexHome)
    await assertPluginNotInstalled(client, workspace)
    completedPhase = "removal-app-server-verified"

    console.log(
      JSON.stringify({
        status: "ok",
        codexBinary: codexCommand,
        expectedCodexVersion: CODEX_SCHEMA_VERSION,
        actualCodexVersion,
        isolatedHome: true,
        modelTurnStarted: false,
        manifestVersionUnchanged: pluginVersion,
        capabilityRevisionUnchanged: stableRevision,
        generations: {
          initial: firstPublication.generation,
          refreshed: secondPublication.generation,
          removed: removedPublication.generation,
        },
        lifecycle: [
          "native-add",
          "new-app-server-read",
          "same-version-native-refresh",
          "new-app-server-read-updated-skill",
          "native-remove",
          "new-app-server-confirms-not-installed",
        ],
      }),
    )
  } finally {
    await client?.close().catch(() => undefined)
    await rm(temporaryRoot, { recursive: true, force: true })
  }
}

async function reconcileNativePlugin(input: {
  nativePluginManager: NativePluginManager
  capabilityRuntimeManager: CapabilityRuntimeManager
  paths: SmokeRuntimePaths
  controlRoot: string
  workspace: string
  capability?: {
    id: string
    name: string
    type: "plugin"
    sourcePath: string
    revision: string
  }
  generation: string
  pluginNames: string[]
}): Promise<void> {
  const runtimeCapabilities = input.capability
    ? [
        {
          id: input.capability.id,
          name: input.capability.name,
          type: input.capability.type,
          revision: input.capability.revision,
        },
      ]
    : []
  const lease = await input.capabilityRuntimeManager.acquireLease({
    controlRoot: input.controlRoot,
    expectedGeneration: input.generation,
  })
  try {
    const runtime = await input.capabilityRuntimeManager.resolvePublished({
      userHome: input.paths.homeRoot,
      controlRoot: input.controlRoot,
      expectedGeneration: input.generation,
      capabilities: runtimeCapabilities,
      lockHeld: true,
    })
    await input.nativePluginManager.reconcileBeforeStart({
      command: codexCommand,
      userHome: input.paths.homeRoot,
      codexHome: input.paths.codexHome,
      workspace: input.workspace,
      capabilityControl: input.paths.controlCapabilitiesRoot,
      expectedGeneration: input.generation,
      pluginContentDigest: runtime.pluginContentDigest,
      pluginNames: input.pluginNames,
      lockHeld: true,
    })
  } finally { await lease.release() }
}

async function projectManagedAgents(
  paths: SmokeRuntimePaths,
): Promise<void> {
  const projectedRoot = path.join(paths.homeRoot, ".agents")
  await rm(projectedRoot, { recursive: true, force: true })
  await symlink(path.join(paths.ownerRoot, "managed", "agents"), projectedRoot, "dir")
}

async function writePluginSource(
  sourceRoot: string,
  marker: string,
): Promise<void> {
  const manifestRoot = path.join(sourceRoot, ".codex-plugin")
  const skillRoot = path.join(sourceRoot, "skills", skillName)
  await rm(sourceRoot, { recursive: true, force: true })
  await Promise.all([
    mkdir(manifestRoot, { recursive: true }),
    mkdir(skillRoot, { recursive: true }),
  ])
  await Promise.all([
    writeFile(
      path.join(manifestRoot, "plugin.json"),
      `${JSON.stringify(
        {
          name: pluginName,
          version: pluginVersion,
          description:
            "Verifies LinkSense native Codex plugin refresh semantics.",
          skills: "./skills/",
        },
        null,
        2,
      )}\n`,
    ),
    writeFile(
      path.join(skillRoot, "SKILL.md"),
      `---
name: ${skillName}
description: Verifies native plugin refresh. Content marker ${marker}.
---

# Native plugin refresh probe

The current immutable content marker is \`${marker}\`.
`,
    ),
  ])
}

function createClient(userHome: string, codexHome: string): CodexJsonRpcClient {
  return new CodexJsonRpcClient({
    command: codexCommand,
    userHome,
    codexHome,
    logger: {
      warn: () => undefined,
      error: () => undefined,
    } as never,
    requestTimeoutMs: 60_000,
  })
}

async function initializeAndAssertIsolated(
  client: CodexJsonRpcClient,
  expectedCodexHome: string,
): Promise<void> {
  const initialized = await client.initialize()
  const [actual, expected] = await Promise.all([
    realpath(initialized.codexHome),
    realpath(expectedCodexHome),
  ])
  if (actual !== expected) {
    throw new Error(
      `App-server escaped the temporary CODEX_HOME: expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`,
    )
  }
}

async function verifyInstalledPlugin(
  nativePluginManager: NativePluginManager,
  client: CodexJsonRpcClient,
  paths: SmokeRuntimePaths,
  workspace: string,
  expectedMarker: string,
): Promise<NativePluginActivation> {
  const activations = await nativePluginManager.verifyAfterStart({
    client,
    workspace,
    userHome: paths.homeRoot,
    codexHome: paths.codexHome,
    pluginNames: [pluginName],
  })
  if (activations.length !== 1 || activations[0]?.name !== pluginName) {
    throw new Error("App-server did not report exactly one expected plugin")
  }
  const activation = activations[0]
  if (activation.version !== pluginVersion) {
    throw new Error(
      `Plugin manifest version changed unexpectedly: ${String(activation.version)}`,
    )
  }
  if (
    activation.skills.length !== 1 ||
    activation.skills[0]?.name !== `${pluginName}:${skillName}`
  ) {
    throw new Error("App-server did not report the expected plugin Skill")
  }
  const skillContent = await readFile(requiredSkillPath(activation), "utf8")
  if (!skillContent.includes(expectedMarker)) {
    throw new Error("Installed plugin Skill content is stale")
  }
  return activation
}

async function assertSkillCatalog(
  client: CodexJsonRpcClient,
  workspace: string,
  activation: NativePluginActivation,
  codexHome: string,
  expectedMarker: string,
): Promise<void> {
  const response = (await client.request("skills/list", {
    cwds: [workspace],
    forceReload: true,
  })) as {
    data?: Array<{
      skills?: Array<{
        name?: unknown
        path?: unknown
        enabled?: unknown
        description?: unknown
      }>
    }>
  }
  const matching = (response.data ?? [])
    .flatMap((entry) => entry.skills ?? [])
    .filter(
      (skill) =>
        skill.name === `${pluginName}:${skillName}` && skill.enabled === true,
    )
  if (matching.length !== 1 || typeof matching[0]?.path !== "string") {
    throw new Error("skills/list did not expose the installed plugin Skill")
  }
  const [catalogPath, activationPath, canonicalCodexHome] = await Promise.all([
    realpath(matching[0].path),
    realpath(requiredSkillPath(activation)),
    realpath(codexHome),
  ])
  for (const reportedPath of [catalogPath, activationPath]) {
    const relativePath = path.relative(canonicalCodexHome, reportedPath)
    if (
      relativePath === "" ||
      relativePath === ".." ||
      relativePath.startsWith(`..${path.sep}`) ||
      path.isAbsolute(relativePath)
    ) {
      throw new Error("App-server reported a Skill outside temporary CODEX_HOME")
    }
  }
  const catalogContent = await readFile(catalogPath, "utf8")
  if (!catalogContent.includes(expectedMarker)) {
    throw new Error(
      "skills/list resolved stale native installation cache content",
    )
  }
  const description = matching[0].description
  if (
    typeof description !== "string" ||
    !description.includes(expectedMarker)
  ) {
    throw new Error("New app-server did not read the current Skill description")
  }
}

async function assertPluginNotInstalled(
  client: CodexJsonRpcClient,
  workspace: string,
): Promise<void> {
  const response = (await client.request("plugin/installed", {
    cwds: [workspace],
    installSuggestionPluginNames: null,
  })) as {
    marketplaceLoadErrors?: unknown[]
    marketplaces?: Array<{
      name?: unknown
      plugins?: Array<{
        id?: unknown
        name?: unknown
        installed?: unknown
      }>
    }>
  }
  if ((response.marketplaceLoadErrors ?? []).length > 0) {
    throw new Error("App-server reported marketplace load errors after removal")
  }
  const managedPlugin = (response.marketplaces ?? [])
    .flatMap((marketplace) => marketplace.plugins ?? [])
    .find(
      (plugin) =>
        (plugin.id ===
          `${pluginName}@${NATIVE_PLUGIN_MARKETPLACE_NAME}` ||
          plugin.name === pluginName) &&
        plugin.installed === true,
    )
  if (managedPlugin) {
    throw new Error("Plugin remained installed after native remove")
  }
}

function requiredSkillPath(activation: NativePluginActivation): string {
  const skill = activation.skills[0]
  if (!skill) throw new Error("Plugin activation has no Skill path")
  return path.join(activation.cacheRoot, skill.relativePath)
}

async function assertMissing(target: string): Promise<void> {
  try {
    await realpath(target)
  } catch (error) {
    if (
      error instanceof Error &&
      "code" in error &&
      (error as NodeJS.ErrnoException).code === "ENOENT"
    ) {
      return
    }
    throw error
  }
  throw new Error("Deleted plugin source is still present")
}

async function readCodexVersion(): Promise<string> {
  let output: string
  try {
    const result = await execFileAsync(codexCommand, ["--version"], {
      env: process.env,
      timeout: 30_000,
    })
    output = `${result.stdout}\n${result.stderr}`
  } catch (error) {
    throw new Error(
      `Unable to execute Codex: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
  const match = output.match(/\bcodex-cli\s+(\d+\.\d+\.\d+)\b/u)
  if (!match?.[1]) {
    throw new Error(`Unable to parse Codex version: ${JSON.stringify(output)}`)
  }
  return match[1]
}
