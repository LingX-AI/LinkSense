import { randomUUID } from "node:crypto"
import { constants, type Stats } from "node:fs"
import {
  access,
  chown,
  chmod,
  link,
  lstat,
  mkdir,
  open,
  readFile,
  readdir,
  rename,
  rm,
  symlink,
} from "node:fs/promises"
import path from "node:path"
import { isDeepStrictEqual } from "node:util"

import {
  conversationFormAutoResolutionMs,
  userWorkspacePathSchema,
  coreMcpServerKey,
  DEFAULT_TASK_AUTO_NAMING,
  managedBrowserMcpServerKey,
  personalizationSettingsSchema,
  updatePersonalizationSettingsSchema,
  workspacePermissionPolicy,
  modelAutoCompactTokenLimitFor,
  type ModelProviderProtocolMode,
  type PersonalizationSettings,
  type UpdatePersonalizationSettings,
} from "@linksense/shared"
import { parse } from "smol-toml"
import { z } from "zod"
import { coreMcpEnvironmentVariables } from "../codex/runtime-config-overrides.js"

import {
  DEFAULT_KNOWLEDGE_SEARCH_TIMEOUT_MS,
  deriveKnowledgeSearchTimeouts,
} from "../knowledge-search-timeout.js"
import {
  modelGatewayEnvironmentKey,
  modelGatewaySupportsWebSockets,
} from "../model-gateway/model-gateway.js"

import {
  chmodWithFallbackIdentity,
  writeSharedRegularFileAtomically,
  type DirectoryCleanupIdentity,
} from "./filesystem.js"
import { removeConversationRuntimeDirectories } from "../runtime-cleanup.js"

const conversationIdPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const managedMcpServerNames = [
  "linksense_core",
  "linksense_file_service",
  "linksense_image_generation",
  "linksense_knowledge_service",
  "linksense_skill_creator",
  "linksense_managed_browser",
] as const
const managedMarkerNames = [
  "file-service",
  "image-generation-service",
  "knowledge-service",
  "skill-creator-service",
  "core-service",
  "managed-browser-service",
  "model-provider",
] as const
const managedModelTopLevelKeys = [
  "model_context_window",
  "model_auto_compact_token_limit",
  "model_auto_compact_token_limit_scope",
] as const
const runtimeGenerationFileName = "runtime-generation"
const personalizationFileName = "personalization.json"
const globalAgentsFileName = "AGENTS.md"
const managedCodexFileNames = ["config.toml", "auth.json", globalAgentsFileName]
const coreMcpInteractiveFormToolTimeoutSeconds =
  Math.ceil(conversationFormAutoResolutionMs / 1_000) + 30
const personalizationStateSchema = z.strictObject({
  version: z.literal(1),
  revision: z.uuid(),
  ...personalizationSettingsSchema.shape,
  task_auto_naming: personalizationSettingsSchema.shape.task_auto_naming.default(
    DEFAULT_TASK_AUTO_NAMING,
  ),
})

export type ConversationPaths = {
  /** Persistent HOME shared by this execution user's tools. */
  home: string
  ownerControl: string
  control: string
  taskControl: string
  workspace: string
  codexHome: string
}

export type EnsuredConversationPaths = ConversationPaths & {
  runtimeGeneration: string
}

export type OwnerPaths = {
  home: string
  control: string
}

export type PersonalizationSnapshot = PersonalizationSettings & {
  revision: string
}

export type EnsuredOwnerPaths = OwnerPaths & {
  personalization: PersonalizationSnapshot
}

/** Persist only task control state. Execution tools and Codex initialize on first use. */
export async function prepareConversationControl(
  owner: OwnerPaths,
  conversationId: string,
  workspacePath: string,
  supervisor: { uid: number; gid: number },
): Promise<{ runtimeGeneration: string }> {
  if (!conversationIdPattern.test(conversationId)) throw new WorkspaceBoundaryError("invalid conversation id")
  const relativeWorkspace = userWorkspacePathSchema.parse(workspacePath)
  const taskControl = path.join(owner.control, "workspaces", conversationId)
  await assertTaskDirectoryParents(owner.home, path.join(owner.home, relativeWorkspace, ".boundary"))
  await assertTaskDirectoryParents(owner.control, taskControl)
  await ensureSupervisorDirectory(owner.control, 0o700, supervisor)
  await ensureSupervisorDirectory(path.dirname(taskControl), 0o700, supervisor)
  await ensureSupervisorDirectory(taskControl, 0o700, supervisor)
  const binding = path.join(taskControl, "workspace.json")
  await writeSharedRegularFileAtomically(binding, JSON.stringify(relativeWorkspace), 0o600, supervisor)
  return { runtimeGeneration: await ensureRuntimeGeneration(taskControl, supervisor) }
}

export type WorkspaceManagerOptions = {
  fixedOwnerId?: string
  fixedHomeRoot?: string
  fixedControlRoot?: string
  codexModel?: string
  userNodeModulesForOwner?: (ownerId: string) => string | undefined
  directoryCleanupIdentity?: DirectoryCleanupIdentity
  managedCodexFileIdentity?: DirectoryCleanupIdentity
}

type ManagedDirectoryInfo = Pick<
  Stats,
  "gid" | "isDirectory" | "isSymbolicLink" | "mode" | "uid"
>

type ManagedDirectoryModeDependencies = {
  lstatPath?: (target: string) => Promise<ManagedDirectoryInfo>
  chmodWithFallbackIdentityPath?: typeof chmodWithFallbackIdentity
}

export class WorkspaceBoundaryError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "WorkspaceBoundaryError"
  }
}

export class RuntimeGenerationIntegrityError extends Error {
  constructor() {
    super("runtime generation state is invalid")
    this.name = "RuntimeGenerationIntegrityError"
  }
}

export class WorkspaceManager {
  private readonly conversationOwners = new Map<string, string>()
  private readonly conversationWorkspaces = new Map<string, string>()
  private readonly codexConfigWrites = new Map<string, Promise<void>>()
  private readonly personalizationOperations = new Map<
    string,
    Promise<unknown>
  >()

  constructor(
    private readonly userDataRoot: string,
    private readonly codexHomeTemplate?: string,
    private readonly options: WorkspaceManagerOptions = {},
  ) {
    if (
      Boolean(options.fixedHomeRoot) !== Boolean(options.fixedControlRoot)
    ) {
      throw new WorkspaceBoundaryError(
        "fixed home and control roots must be configured together",
      )
    }
  }

  bindOwner(conversationId: string, ownerId: string): void {
    if (!conversationIdPattern.test(conversationId)) {
      throw new WorkspaceBoundaryError("invalid conversation id")
    }
    if (!conversationIdPattern.test(ownerId)) {
      throw new WorkspaceBoundaryError("invalid owner id")
    }
    if (
      this.options.fixedOwnerId &&
      ownerId !== this.options.fixedOwnerId
    ) {
      throw new WorkspaceBoundaryError("conversation owner mismatch")
    }
    const current = this.conversationOwners.get(conversationId)
    if (current && current !== ownerId) {
      throw new WorkspaceBoundaryError("conversation owner mismatch")
    }
    this.conversationOwners.set(conversationId, ownerId)
  }

  ownerFor(conversationId: string): string {
    const ownerId = this.conversationOwners.get(conversationId)
    if (ownerId) return ownerId
    if (this.options.fixedOwnerId) return this.options.fixedOwnerId
    throw new WorkspaceBoundaryError("conversation owner is not bound")
  }

  bindWorkspace(conversationId: string, workspacePath: string): void {
    this.ownerFor(conversationId)
    this.conversationWorkspaces.set(conversationId, userWorkspacePathSchema.parse(workspacePath))
  }

  private async restoreWorkspace(conversationId: string): Promise<void> {
    const { taskControl } = this.pathsFor(conversationId)
    const value = await readFile(path.join(taskControl, "workspace.json"), "utf8").catch((error: unknown) => {
      if (isNodeError(error) && error.code === "ENOENT") return null
      throw error
    })
    if (value !== null) this.bindWorkspace(conversationId, userWorkspacePathSchema.parse(JSON.parse(value)))
  }

  pathsFor(conversationId: string): ConversationPaths {
    if (!conversationIdPattern.test(conversationId)) {
      throw new WorkspaceBoundaryError("invalid conversation id")
    }
    const ownerId = this.ownerFor(conversationId)
    const owner = this.ownerPathsFor(ownerId)
    const workspace = path.join(owner.home, this.conversationWorkspaces.get(conversationId) ?? "workspace")
    const control = path.join(owner.control, "workspaces", conversationId)
    return {
      home: owner.home,
      ownerControl: owner.control,
      control,
      taskControl: control,
      workspace,
      codexHome: path.join(owner.home, ".codex"),
    }
  }

  ownerPathsFor(ownerId: string): OwnerPaths {
    this.assertOwnerId(ownerId)
    const home =
      this.options.fixedHomeRoot ??
      path.join(this.userDataRoot, ownerId, "home")
    const control =
      this.options.fixedControlRoot ??
      path.join(this.userDataRoot, ownerId, "control")
    return { home, control }
  }

  async ensureOwner(ownerId: string): Promise<EnsuredOwnerPaths> {
    const paths = this.ownerPathsFor(ownerId)
    await this.ensureOwnerStorage(paths)
    const personalization = await this.withPersonalizationOperation(
      ownerId,
      async () => this.readOrCreatePersonalization(paths),
    )
    return { ...paths, personalization }
  }

  async getPersonalization(
    ownerId: string,
  ): Promise<PersonalizationSnapshot> {
    return (await this.ensureOwner(ownerId)).personalization
  }

  async updatePersonalization(
    ownerId: string,
    input: UpdatePersonalizationSettings,
  ): Promise<PersonalizationSnapshot> {
    const update = updatePersonalizationSettingsSchema.parse(input)
    const paths = this.ownerPathsFor(ownerId)
    await this.ensureOwnerStorage(paths)
    return this.withPersonalizationOperation(ownerId, async () => {
      const current = await this.readOrCreatePersonalization(paths)
      const next = personalizationStateSchema.parse({
        version: 1,
        revision: randomUUID(),
        custom_instructions:
          update.custom_instructions ?? current.custom_instructions,
        memories_enabled:
          update.memories_enabled ?? current.memories_enabled,
        task_auto_naming: update.task_auto_naming ?? current.task_auto_naming,
      })
      await this.writePersonalizationState(paths, next)
      return projectPersonalizationSnapshot(next)
    })
  }

  async ensureConversation(
    conversationId: string,
  ): Promise<EnsuredConversationPaths> {
    const paths = this.pathsFor(conversationId)
    const ownerId = this.ownerFor(conversationId)
    const owner = await this.ensureOwner(ownerId)
    await assertTaskDirectoryParents(owner.home, paths.workspace)
    await assertTaskDirectoryParents(owner.control, paths.taskControl)
    await ensureSupervisorDirectory(
      path.dirname(paths.taskControl),
      0o700,
    )
    await ensureSupervisorDirectory(paths.taskControl, 0o700)
    await writeSharedRegularFileAtomically(
      path.join(paths.taskControl, "workspace.json"),
      JSON.stringify(this.conversationWorkspaces.get(conversationId) ?? "workspace"),
      0o600,
    )
    await this.ensureNativeDirectories(paths)
    await Promise.all([
      mkdir(path.join(paths.workspace, "attachments"), {
        recursive: true,
        mode: workspacePermissionPolicy.sharedDirectory,
      }),
      mkdir(path.join(paths.workspace, "artifacts"), {
        recursive: true,
        mode: workspacePermissionPolicy.sharedDirectory,
      }),
      mkdir(path.join(paths.workspace, "temp"), {
        recursive: true,
        mode: workspacePermissionPolicy.sharedDirectory,
      }),
      mkdir(path.join(paths.codexHome, "logs"), { recursive: true }),
    ])
    await setManagedDirectoryMode(
      path.join(paths.codexHome, "logs"),
      0o770,
      this.options.directoryCleanupIdentity,
    )
    await Promise.all(
      [
        paths.workspace,
        path.join(paths.workspace, "attachments"),
        path.join(paths.workspace, "artifacts"),
        path.join(paths.workspace, "temp"),
      ].map((directory) =>
        setManagedDirectoryMode(
          directory,
          workspacePermissionPolicy.sharedDirectory,
          this.options.directoryCleanupIdentity,
        ),
      ),
    )
    const runtimeGeneration = await ensureRuntimeGeneration(
      paths.taskControl,
    )
    const nodeModules = this.options.userNodeModulesForOwner?.(ownerId)
    if (nodeModules) {
      await Promise.all([
        ensureDirectoryLink(
          path.join(paths.workspace, "node_modules"),
          nodeModules,
        ),
        ensureDirectoryLink(
          path.join(paths.home, "node_modules"),
          nodeModules,
        ),
      ])
    }
    const verifiedRuntimeGeneration = await ensureRuntimeGeneration(
      paths.taskControl,
    )
    if (verifiedRuntimeGeneration !== runtimeGeneration) {
      throw new RuntimeGenerationIntegrityError()
    }
    return { ...paths, runtimeGeneration: verifiedRuntimeGeneration }
  }

  async readRuntimeGeneration(conversationId: string): Promise<string | null> {
    const { taskControl } = this.pathsFor(conversationId)
    const state = await inspectRuntimeGeneration(taskControl)
    return state.status === "valid" ? state.runtimeGeneration : null
  }

  resolveWorkspacePath(conversationId: string, relativePath: string): string {
    const { workspace } = this.pathsFor(conversationId)
    if (path.isAbsolute(relativePath) || relativePath.includes("\0")) {
      throw new WorkspaceBoundaryError("path must be workspace relative")
    }
    const resolved = path.resolve(workspace, relativePath)
    const relative = path.relative(workspace, resolved)
    if (relative.startsWith("..") || path.isAbsolute(relative)) {
      throw new WorkspaceBoundaryError("path escapes task workspace")
    }
    return resolved
  }

  async assertHealthy(): Promise<void> {
    const roots =
      this.options.fixedHomeRoot && this.options.fixedControlRoot
        ? [this.options.fixedHomeRoot, this.options.fixedControlRoot]
        : [this.userDataRoot]
    await Promise.all(
      roots.map((root) => mkdir(root, { recursive: true })),
    )
    await Promise.all(
      roots.map((root) => access(root, constants.R_OK | constants.W_OK)),
    )
  }

  async listConversationIds(): Promise<string[]> {
    if (this.options.fixedControlRoot) {
      const workspacesRoot = path.join(
        this.options.fixedControlRoot,
        "workspaces",
      )
      await mkdir(workspacesRoot, { recursive: true })
      const entries = await readdir(workspacesRoot, { withFileTypes: true })
      const ids = entries
        .filter(
          (entry) =>
            entry.isDirectory() && conversationIdPattern.test(entry.name),
        )
        .map((entry) => entry.name)
      for (const id of ids) {
        this.bindOwner(id, this.options.fixedOwnerId!)
        await this.restoreWorkspace(id)
      }
      return ids
    }

    await mkdir(this.userDataRoot, { recursive: true })
    const owners = await readdir(this.userDataRoot, { withFileTypes: true })
      const ids: string[] = []
      for (const owner of owners) {
        if (!owner.isDirectory() || !conversationIdPattern.test(owner.name))
          continue
      const workspacesRoot = path.join(
        this.userDataRoot,
        owner.name,
        "control",
        "workspaces",
      )
      const conversations = await readdir(workspacesRoot, {
        withFileTypes: true,
      }).catch((error: unknown) => {
        if (isNodeError(error) && error.code === "ENOENT") return []
        throw error
      })
        for (const conversation of conversations) {
          if (
            !conversation.isDirectory() ||
            !conversationIdPattern.test(conversation.name)
          ) {
            continue
          }
        this.bindOwner(conversation.name, owner.name)
        await this.restoreWorkspace(conversation.name)
        ids.push(conversation.name)
      }
    }
    return ids
  }

  async listOwnerIds(): Promise<string[]> {
    if (this.options.fixedOwnerId) {
      return [this.options.fixedOwnerId]
    }
    await mkdir(this.userDataRoot, { recursive: true })
    const entries = await readdir(this.userDataRoot, { withFileTypes: true })
    return entries
      .filter(
        (entry) =>
          entry.isDirectory() && conversationIdPattern.test(entry.name),
      )
      .map((entry) => entry.name)
  }

  async configureBuiltInMcp(
    conversationId: string,
    input: {
      command: string
      args: string[]
      managedBrowserArgs?: string[]
      knowledgeSearchTimeoutMs?: number
    },
  ): Promise<void> {
    const { codexHome } = this.pathsFor(conversationId)
    const configPath = path.join(codexHome, "config.toml")
    const knowledgeSearchTimeouts = deriveKnowledgeSearchTimeouts(
      input.knowledgeSearchTimeoutMs ?? DEFAULT_KNOWLEDGE_SEARCH_TIMEOUT_MS,
    )
    const coreToolTimeoutSeconds = Math.max(
      coreMcpInteractiveFormToolTimeoutSeconds,
      knowledgeSearchTimeouts.codexToolSeconds,
    )
    const block = [
      `[mcp_servers.${coreMcpServerKey}]`,
      `command = ${tomlString(input.command)}`,
      `args = [${input.args.map(tomlString).join(", ")}]`,
      `env_vars = [${coreMcpEnvironmentVariables.map(tomlString).join(", ")}]`,
      "enabled = true",
      "required = true",
      "startup_timeout_sec = 10",
      `tool_timeout_sec = ${coreToolTimeoutSeconds}`,
      "",
      ...(input.managedBrowserArgs
        ? [
            `[mcp_servers.${managedBrowserMcpServerKey}]`,
            `command = ${tomlString(input.command)}`,
            `args = [${input.managedBrowserArgs.map(tomlString).join(", ")}]`,
            'env_vars = ["HOME", "CODEX_HOME", "LINKSENSE_CONVERSATION_ID", "LINKSENSE_BROWSER_READ_ONLY"]',
            "enabled = false",
            "required = false",
            "startup_timeout_sec = 10",
            "tool_timeout_sec = 130",
            "",
          ]
        : []),
    ].join("\n")
    await this.updateCodexConfig(
      configPath,
      (existing) =>
        rewriteManagedToml(existing, {
          removeTables: managedMcpServerNames.map(
            (serverName) => `mcp_servers.${serverName}`,
          ),
          appendBlocks: [block],
        }),
    )
  }

  async configureModelProvider(
    conversationId: string,
    input: {
      revision: number
      baseUrl: string
      protocolMode: ModelProviderProtocolMode
      allowWebSockets?: boolean
      modelContextWindow?: number
      modelAutoCompactTokenLimit?: number
    },
  ): Promise<void> {
    const { codexHome } = this.pathsFor(conversationId)
    const configPath = path.join(codexHome, "config.toml")
    const topLevelBlock = [
      `# linksense-model-provider-revision = ${input.revision}`,
      ...modelContextWindowConfig(
        input.modelContextWindow,
        input.modelAutoCompactTokenLimit,
      ),
    ].join("\n")
    const providerBlock = [
      "[model_providers.link-sense]",
      'name = "LinkSense"',
      `base_url = ${tomlString(input.baseUrl)}`,
      'wire_api = "responses"',
      `env_key = ${tomlString(modelGatewayEnvironmentKey)}`,
      `supports_websockets = ${
        input.allowWebSockets !== false &&
        modelGatewaySupportsWebSockets(input.protocolMode)
      }`,
      "stream_max_retries = 2",
      "websocket_connect_timeout_ms = 12000",
      "requires_openai_auth = false",
      "",
    ].join("\n")
    await this.updateCodexConfig(
      configPath,
      (existing) =>
        rewriteManagedToml(existing, {
          removeTables: ["model_providers.link-sense"],
          removeAssignments: managedModelTopLevelKeys,
          removeCommentPatterns: [
            /^\s*#\s*(?:revision|linksense-model-provider-revision)\s*=.*$/u,
          ],
          topLevelBlock,
          appendBlocks: [providerBlock],
        }),
    )
  }

  async removeConversation(conversationId: string): Promise<void> {
    const paths = this.pathsFor(conversationId)
    const owner = this.ownerPathsFor(this.ownerFor(conversationId))
    await assertTaskDirectoryParents(owner.home, paths.workspace)
    await assertTaskDirectoryParents(owner.control, paths.taskControl)
    await removeConversationRuntimeDirectories({
      taskControl: paths.taskControl,
      ...(this.options.directoryCleanupIdentity
        ? { directoryCleanupIdentity: this.options.directoryCleanupIdentity }
        : {}),
    })
    this.conversationOwners.delete(conversationId)
    this.conversationWorkspaces.delete(conversationId)
  }

  private assertOwnerId(ownerId: string): void {
    if (!conversationIdPattern.test(ownerId)) {
      throw new WorkspaceBoundaryError("invalid owner id")
    }
    if (
      this.options.fixedOwnerId &&
      ownerId !== this.options.fixedOwnerId
    ) {
      throw new WorkspaceBoundaryError("conversation owner mismatch")
    }
  }

  private async ensureOwnerStorage(paths: OwnerPaths): Promise<void> {
    await mkdir(paths.home, { recursive: true, mode: 0o770 })
    await setManagedDirectoryMode(paths.home, 0o770, this.options.directoryCleanupIdentity)
    await this.ensureTaskDirectoryOwner(paths.home)
    await ensureSupervisorDirectory(paths.control, 0o700)

  }

  private async ensureNativeDirectories(paths: ConversationPaths): Promise<void> {
    await Promise.all([
      mkdir(paths.home, { recursive: true, mode: 0o770 }),
      mkdir(paths.control, { recursive: true, mode: 0o700 }),
    ])
    await setManagedDirectoryMode(
      paths.home,
      0o770,
      this.options.directoryCleanupIdentity,
    )
    await this.ensureTaskDirectoryOwner(paths.home)
    await ensureSupervisorDirectory(paths.control, 0o700)
    await assertTaskDirectoryParents(paths.home, path.join(paths.codexHome, "config.toml"))
    await mkdir(paths.codexHome, { recursive: true, mode: 0o770 })
    await setManagedDirectoryMode(
      paths.codexHome,
      0o770,
      this.options.directoryCleanupIdentity,
    )
    await this.ensureTaskDirectoryOwner(paths.codexHome)
    await mkdir(path.join(paths.codexHome, "logs"), {
      recursive: true,
      mode: 0o770,
    })
    await setManagedDirectoryMode(
      path.join(paths.codexHome, "logs"),
      0o770,
      this.options.directoryCleanupIdentity,
    )
    await this.ensureTaskDirectoryOwner(path.join(paths.codexHome, "logs"))
    const managedCodexFileIdentity =
      this.options.managedCodexFileIdentity
    if (managedCodexFileIdentity) {
      await Promise.all(
        managedCodexFileNames.map((fileName) =>
          normalizeManagedCodexFile(
            path.join(paths.codexHome, fileName),
            managedCodexFileIdentity,
          ),
        ),
      )
    }
    if (this.codexHomeTemplate) {
      await Promise.all([
        this.initializeTemplateConfig(paths.codexHome),
        this.initializeTemplateAuth(paths.codexHome),
      ])
    }
  }

  private async readOrCreatePersonalization(
    paths: OwnerPaths,
  ): Promise<PersonalizationSnapshot> {
    const statePath = path.join(paths.control, personalizationFileName)
    try {
      const info = await lstat(statePath)
      if (
        !info.isFile() ||
        info.isSymbolicLink() ||
        !isSupervisorOwned(info) ||
        (info.mode & 0o777) !== 0o600 ||
        info.size > 128_000
      ) {
        throw new WorkspaceBoundaryError(
          "personalization state boundary is invalid",
        )
      }
      const state = personalizationStateSchema.parse(
        JSON.parse(await readFile(statePath, "utf8")),
      )
      return projectPersonalizationSnapshot(state)
    } catch (error) {
      if (!isNodeError(error) || error.code !== "ENOENT") throw error
    }

    const state = personalizationStateSchema.parse({
      version: 1,
      revision: randomUUID(),
      custom_instructions: "",
      memories_enabled: true,
    })
    await this.writePersonalizationState(paths, state)
    return projectPersonalizationSnapshot(state)
  }

  private async writePersonalizationState(
    paths: OwnerPaths,
    state: z.infer<typeof personalizationStateSchema>,
  ): Promise<void> {
    const targetPath = path.join(paths.control, personalizationFileName)
    const temporaryPath = path.join(
      paths.control,
      `.${personalizationFileName}.${randomUUID()}.tmp`,
    )
    const handle = await open(temporaryPath, "wx", 0o600)
    try {
      await handle.writeFile(`${JSON.stringify(state)}\n`, "utf8")
      await handle.sync()
    } finally {
      await handle.close()
    }
    try {
      await setRegularFileModeIfExists(targetPath, 0o600)
      await rename(temporaryPath, targetPath)
      await syncDirectory(paths.control)
    } finally {
      await rm(temporaryPath, { force: true }).catch(() => undefined)
    }
  }

  private async ensureTaskDirectoryOwner(directory: string): Promise<void> {
    const identity = this.options.managedCodexFileIdentity
    if (!identity) return
    const info = await lstat(directory)
    if (!info.isDirectory() || info.isSymbolicLink()) {
      throw new WorkspaceBoundaryError("task runtime directory boundary is invalid")
    }
    if (info.uid === identity.uid && info.gid === identity.gid) return
    if (!isSupervisorOwned(info)) {
      throw new WorkspaceBoundaryError("task runtime directory owner is invalid")
    }
    await chown(directory, identity.uid, identity.gid)
  }

  private async withPersonalizationOperation<T>(
    ownerId: string,
    operation: () => Promise<T>,
  ): Promise<T> {
    const previous =
      this.personalizationOperations.get(ownerId) ?? Promise.resolve()
    const current = previous.catch(() => undefined).then(operation)
    this.personalizationOperations.set(ownerId, current)
    try {
      return await current
    } finally {
      if (this.personalizationOperations.get(ownerId) === current) {
        this.personalizationOperations.delete(ownerId)
      }
    }
  }

  private async initializeTemplateConfig(codexHome: string): Promise<void> {
    const sourcePath = path.join(this.codexHomeTemplate!, "config.toml")
    const targetPath = path.join(codexHome, "config.toml")
    const existing = await readFileIfExists(targetPath)
    if (existing !== undefined) return
    const template = await readFile(sourcePath, "utf8")
    const configuredTemplate = this.options.codexModel
      ? applyTopLevelCodexModel(template, this.options.codexModel)
      : template
    await this.writeCodexConfig(
      targetPath,
      `${configuredTemplate.trimEnd()}\n`,
    )
  }

  private async initializeTemplateAuth(codexHome: string): Promise<void> {
    const sourcePath = path.join(this.codexHomeTemplate!, "auth.json")
    const targetPath = path.join(codexHome, "auth.json")
    const existing = await readFileIfExists(targetPath)
    if (existing !== undefined) {
      await this.writeCodexConfig(targetPath, existing)
      return
    }
    try {
      const template = await readFile(sourcePath, "utf8")
      await this.writeCodexConfig(targetPath, template)
    } catch (error) {
      if (!isNodeError(error) || error.code !== "ENOENT") throw error
    }
  }

  private async writeCodexConfig(
    targetPath: string,
    contents: string,
  ): Promise<void> {
    await writeSharedRegularFileAtomically(
      targetPath,
      contents,
      workspacePermissionPolicy.sharedWritableFile,
    )
  }

  private async updateCodexConfig(
    targetPath: string,
    update: (current: string) => string,
  ): Promise<void> {
    const previous = this.codexConfigWrites.get(targetPath) ?? Promise.resolve()
    const current = previous
      .catch(() => undefined)
      .then(async () => {
        // Replace the file through the shared parent directory. This remains
        // valid even if Codex tightened the previous inode to 0600, and avoids
        // starting a per-write identity helper.
        const existing = (await readFileIfExists(targetPath)) ?? ""
        await this.writeCodexConfig(targetPath, update(existing))
      })
    this.codexConfigWrites.set(targetPath, current)
    try {
      await current
    } finally {
      if (this.codexConfigWrites.get(targetPath) === current) {
        this.codexConfigWrites.delete(targetPath)
      }
    }
  }
}

function projectPersonalizationSnapshot(
  state: z.infer<typeof personalizationStateSchema>,
): PersonalizationSnapshot {
  return {
    revision: state.revision,
    custom_instructions: state.custom_instructions,
    memories_enabled: state.memories_enabled,
    task_auto_naming: state.task_auto_naming,
  }
}

async function assertTaskDirectoryParents(root: string, target: string): Promise<void> {
  const relative = path.relative(root, target)
  if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new WorkspaceBoundaryError("task runtime escapes its owner root")
  }
  let current = root
  for (const segment of ["", ...relative.split(path.sep).slice(0, -1)]) {
    current = path.join(current, segment)
    try {
      const info = await lstat(current)
      if (!info.isDirectory() || info.isSymbolicLink()) {
        throw new WorkspaceBoundaryError("task runtime parent boundary is invalid")
      }
    } catch (error) {
      if (isNodeError(error) && error.code === "ENOENT") return
      throw error
    }
  }
}

async function ensureDirectoryLink(
  destination: string,
  target: string,
): Promise<void> {
  try {
    await symlink(target, destination, "dir")
  } catch (error) {
    if (!isNodeError(error) || error.code !== "EEXIST") throw error
  }
}

async function setRegularFileMode(
  target: string,
  mode: number,
  fallbackIdentity?: DirectoryCleanupIdentity,
): Promise<void> {
  const info = await lstat(target)
  if (!info.isFile() || info.isSymbolicLink()) {
    throw new WorkspaceBoundaryError("managed file boundary is invalid")
  }
  await chmodWithFallbackIdentity(target, mode, info, fallbackIdentity)
}

async function setRegularFileModeIfExists(
  target: string,
  mode: number,
  fallbackIdentity?: DirectoryCleanupIdentity,
): Promise<void> {
  try {
    await setRegularFileMode(target, mode, fallbackIdentity)
  } catch (error) {
    if (!isNodeError(error) || error.code !== "ENOENT") throw error
  }
}

type RuntimeGenerationInspection =
  | { status: "valid"; runtimeGeneration: string }
  | { status: "missing" | "invalid" }

async function inspectRuntimeGeneration(
  taskControl: string,
  supervisorUid = process.geteuid?.(),
): Promise<RuntimeGenerationInspection> {
  const generationPath = path.join(taskControl, runtimeGenerationFileName)
  try {
    const controlInfo = await lstat(taskControl)
    if (!isSupervisorOwnedDirectory(controlInfo, 0o700, supervisorUid)) {
      return { status: "invalid" }
    }
    const generationInfo = await lstat(generationPath)
    if (
      !generationInfo.isFile() ||
      !isSupervisorOwned(generationInfo, supervisorUid) ||
      (generationInfo.mode & 0o777) !== 0o600 ||
      generationInfo.size > 128
    ) {
      return { status: "invalid" }
    }
    const runtimeGeneration = (await readFile(generationPath, "utf8")).trim()
    return conversationIdPattern.test(runtimeGeneration)
      ? { status: "valid", runtimeGeneration }
      : { status: "invalid" }
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return { status: "missing" }
    }
    if (isNodeError(error) && error.code === "EACCES") {
      return { status: "invalid" }
    }
    throw error
  }
}

async function ensureSupervisorDirectory(
  directory: string,
  mode: number,
  identity?: { uid: number; gid: number },
): Promise<void> {
  try {
    await mkdir(directory, { mode })
    if (identity) await chown(directory, identity.uid, identity.gid)
  } catch (error) {
    if (!isNodeError(error) || error.code !== "EEXIST") throw error
  }
  const info = await lstat(directory)
  if (!info.isDirectory() || !isSupervisorOwned(info, identity?.uid)) {
    throw new WorkspaceBoundaryError("supervisor directory boundary is invalid")
  }
  await chmod(directory, mode)
}

export async function setManagedDirectoryMode(
  directory: string,
  mode: number,
  fallbackIdentity?: DirectoryCleanupIdentity,
  dependencies: ManagedDirectoryModeDependencies = {},
): Promise<void> {
  const info = await (dependencies.lstatPath ?? lstat)(directory)
  if (!info.isDirectory() || info.isSymbolicLink()) {
    throw new WorkspaceBoundaryError("managed directory boundary is invalid")
  }
  if ((info.mode & 0o7777) === mode) return
  await (
    dependencies.chmodWithFallbackIdentityPath ?? chmodWithFallbackIdentity
  )(directory, mode, info, fallbackIdentity)
}

function isSupervisorOwnedDirectory(info: Stats, mode: number, supervisorUid = process.geteuid?.()): boolean {
  return (
    info.isDirectory() &&
    isSupervisorOwned(info, supervisorUid) &&
    (info.mode & 0o7777) === mode
  )
}

function isSupervisorOwned(info: Stats, supervisorUid = process.geteuid?.()): boolean {
  return supervisorUid === undefined || info.uid === supervisorUid
}

async function syncDirectory(directory: string): Promise<void> {
  const handle = await open(directory, "r")
  try {
    await handle.sync()
  } finally {
    await handle.close()
  }
}

function tomlString(value: string): string {
  return JSON.stringify(value)
}

type ManagedTomlRewrite = {
  removeTables: readonly string[]
  appendBlocks: readonly string[]
  removeAssignments?: readonly string[]
  removeCommentPatterns?: readonly RegExp[]
  topLevelBlock?: string
}

/**
 * Rewrites only LinkSense-owned TOML keys and tables. Codex's native TOML
 * editor is free to reorder plugin tables, so paired text markers must never
 * define a range that can accidentally absorb a native `[plugins.*]` table.
 */
function rewriteManagedToml(
  source: string,
  input: ManagedTomlRewrite,
): string {
  const before = parseCodexToml(source)
  const pluginStateBefore = before.plugins
  const removableAssignments = new Set(input.removeAssignments ?? [])
  let insideTable = false
  const lines = stripManagedTomlTables(source, input.removeTables)
    .split("\n")
    .filter((line) => {
      const withoutCarriageReturn = line.endsWith("\r")
        ? line.slice(0, -1)
        : line
      if (isTomlTableHeader(withoutCarriageReturn)) {
        insideTable = true
      }
      if (
        input.removeCommentPatterns?.some((pattern) =>
          pattern.test(withoutCarriageReturn),
        )
      ) {
        return false
      }
      const assignment = /^\s*([A-Za-z0-9_-]+)\s*=/u.exec(
        withoutCarriageReturn,
      )
      return (
        insideTable ||
        !assignment ||
        !removableAssignments.has(assignment[1]!)
      )
    })
    .join("\n")
    .replace(managedMarkerCommentPattern(), "")

  const lineValues = lines.split("\n")
  const firstTableIndex = lineValues.findIndex(isTomlTableHeader)
  const preamble =
    firstTableIndex === -1
      ? lines
      : lineValues.slice(0, firstTableIndex).join("\n")
  const tables =
    firstTableIndex === -1
      ? ""
      : lineValues.slice(firstTableIndex).join("\n")
  const rewritten = joinTomlFragments([
    preamble,
    input.topLevelBlock ?? "",
    tables,
    ...input.appendBlocks,
  ])
  const after = parseCodexToml(rewritten)
  if (!isDeepStrictEqual(pluginStateBefore, after.plugins)) {
    throw new WorkspaceBoundaryError(
      "managed Codex configuration update changed native plugin state",
    )
  }
  return rewritten
}

function stripManagedTomlTables(
  source: string,
  tablePaths: readonly string[],
): string {
  let removing = false
  return source
    .split("\n")
    .filter((line) => {
      if (isTomlTableHeader(line)) {
        removing = tablePaths.some((tablePath) =>
          isTomlTableAtOrBelow(line, tablePath),
        )
      }
      return !removing
    })
    .join("\n")
}

function isTomlTableHeader(line: string): boolean {
  return /^\s*\[\[?.+?\]\]?\s*(?:#.*)?\r?$/u.test(line)
}

function isTomlTableAtOrBelow(line: string, tablePath: string): boolean {
  const components = tablePath.split(".").map(escapeRegularExpression)
  const pathPattern = components
    .map((component) => `(?:${component}|"${component}"|'${component}')`)
    .join("\\s*\\.\\s*")
  return new RegExp(
    `^\\s*\\[\\s*${pathPattern}(?:\\s*\\..+)?\\s*\\]\\s*(?:#.*)?\\r?$`,
    "u",
  ).test(line)
}

function escapeRegularExpression(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")
}

function managedMarkerCommentPattern(): RegExp {
  const names = managedMarkerNames.map(escapeRegularExpression).join("|")
  return new RegExp(
    `[ \\t]*#\\s*linksense-(?:${names}):(?:start|end)[^\\r\\n]*`,
    "gu",
  )
}

function joinTomlFragments(fragments: readonly string[]): string {
  const contents = fragments
    .map((fragment) => fragment.trim())
    .filter((fragment) => fragment.length > 0)
    .join("\n\n")
  return contents.length === 0 ? "" : `${contents}\n`
}

function parseCodexToml(source: string): Record<string, unknown> {
  const parsed = parse(source)
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    Array.isArray(parsed)
  ) {
    throw new WorkspaceBoundaryError("Codex configuration is invalid")
  }
  return parsed
}

function modelContextWindowConfig(
  modelContextWindow?: number,
  modelAutoCompactTokenLimit?: number,
): string[] {
  const autoCompactTokenLimit =
    modelAutoCompactTokenLimit ??
    (modelContextWindow === undefined
      ? undefined
      : modelAutoCompactTokenLimitFor(modelContextWindow))
  return [
    ...(modelContextWindow === undefined
      ? []
      : [`model_context_window = ${modelContextWindow}`]),
    ...(autoCompactTokenLimit === undefined
      ? []
      : [
          `model_auto_compact_token_limit = ${autoCompactTokenLimit}`,
          'model_auto_compact_token_limit_scope = "total"',
        ]),
  ]
}

function applyTopLevelCodexModel(config: string, model: string): string {
  const firstTableIndex = config.search(/^\s*\[/mu)
  const preamble = firstTableIndex === -1 ? config : config.slice(0, firstTableIndex)
  const tables = firstTableIndex === -1 ? "" : config.slice(firstTableIndex)
  const modelAssignment = `model = ${tomlString(model)}`
  const existingModelPattern = /^model\s*=.*$/mu
  if (existingModelPattern.test(preamble)) {
    return `${preamble.replace(existingModelPattern, modelAssignment)}${tables}`
  }
  const separator = preamble.length === 0 || preamble.endsWith("\n") ? "" : "\n"
  return `${preamble}${separator}${modelAssignment}\n${tables}`
}

async function readFileIfExists(filePath: string): Promise<string | undefined> {
  try {
    return await readFile(filePath, "utf8")
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") return undefined
    throw error
  }
}

async function normalizeManagedCodexFile(
  filePath: string,
  identity: DirectoryCleanupIdentity,
): Promise<void> {
  let info: Stats
  try {
    info = await lstat(filePath)
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") return
    throw error
  }
  if (!info.isFile() || info.isSymbolicLink()) {
    throw new WorkspaceBoundaryError("managed Codex file boundary is invalid")
  }
  if (info.uid !== identity.uid || info.gid !== identity.gid) {
    await chown(filePath, identity.uid, identity.gid)
  }
  if ((info.mode & 0o777) !== workspacePermissionPolicy.sharedWritableFile) {
    await chmod(filePath, workspacePermissionPolicy.sharedWritableFile)
  }
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error
}

async function ensureRuntimeGeneration(
  taskControl: string,
  identity?: { uid: number; gid: number },
): Promise<string> {
  await ensureSupervisorDirectory(taskControl, 0o700, identity)
  const current = await inspectRuntimeGeneration(taskControl, identity?.uid)
  if (current.status === "valid") return current.runtimeGeneration
  if (current.status === "invalid") {
    throw new RuntimeGenerationIntegrityError()
  }

  const runtimeGeneration = randomUUID()
  const temporaryPath = path.join(
    taskControl,
    `.${runtimeGeneration}.tmp`,
  )
  const generationPath = path.join(
    taskControl,
    runtimeGenerationFileName,
  )
  const handle = await open(temporaryPath, "wx", 0o600)
  try {
    await handle.writeFile(`${runtimeGeneration}\n`, "utf8")
    if (identity) await chown(temporaryPath, identity.uid, identity.gid)
    await handle.sync()
  } finally {
    await handle.close()
  }
  try {
    try {
      await link(temporaryPath, generationPath)
      await syncDirectory(taskControl)
    } catch (error) {
      if (!isNodeError(error) || error.code !== "EEXIST") throw error
    }
    const published = await inspectRuntimeGeneration(taskControl, identity?.uid)
    if (published.status !== "valid") {
      throw new RuntimeGenerationIntegrityError()
    }
    return published.runtimeGeneration
  } finally {
    await rm(temporaryPath, { force: true }).catch(() => undefined)
  }
}
