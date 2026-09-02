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
  readlink,
  readdir,
  rename,
  rm,
  symlink,
} from "node:fs/promises"
import path from "node:path"
import { isDeepStrictEqual } from "node:util"

import {
  conversationFormAutoResolutionMs,
  coreMcpServerKey,
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
})

export type ConversationPaths = {
  home: string
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
  codexHome: string
}

export type PersonalizationSnapshot = PersonalizationSettings & {
  revision: string
}

export type EnsuredOwnerPaths = OwnerPaths & {
  personalization: PersonalizationSnapshot
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

  pathsFor(conversationId: string): ConversationPaths {
    if (!conversationIdPattern.test(conversationId)) {
      throw new WorkspaceBoundaryError("invalid conversation id")
    }
    const ownerId = this.ownerFor(conversationId)
    const { home, control, codexHome } = this.ownerPathsFor(ownerId)
    return {
      home,
      control,
      taskControl: path.join(control, "workspaces", conversationId),
      workspace: path.join(home, "workspaces", conversationId),
      codexHome,
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
    return {
      home,
      control,
      codexHome: path.join(home, ".codex"),
    }
  }

  async ensureOwner(ownerId: string): Promise<EnsuredOwnerPaths> {
    const paths = this.ownerPathsFor(ownerId)
    await this.ensureOwnerDirectories(paths)
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
    await this.ensureOwnerDirectories(paths)
    return this.withPersonalizationOperation(ownerId, async () => {
      const current = await this.readOrCreatePersonalization(paths)
      const next = personalizationStateSchema.parse({
        version: 1,
        revision: randomUUID(),
        custom_instructions:
          update.custom_instructions ?? current.custom_instructions,
        memories_enabled:
          update.memories_enabled ?? current.memories_enabled,
      })
      await this.writePersonalizationState(paths, next)
      await this.writeGlobalAgentsFile(paths, next)
      return projectPersonalizationSnapshot(next)
    })
  }

  async ensureConversation(
    conversationId: string,
    templateVersion: string,
  ): Promise<EnsuredConversationPaths> {
    const paths = this.pathsFor(conversationId)
    const ownerId = this.ownerFor(conversationId)
    await this.ensureOwner(ownerId)
    await ensureSupervisorDirectory(
      path.join(paths.control, "workspaces"),
      0o700,
    )
    await ensureSupervisorDirectory(paths.taskControl, 0o700)
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
    const runtimeGeneration = await this.ensureRuntimeGeneration(
      paths.taskControl,
    )
    const nodeModules = this.options.userNodeModulesForOwner?.(ownerId)
    const skillsRoot = path.join(paths.home, ".agents", "skills")
    await ensureDirectoryLink(
      path.join(paths.workspace, "skills"),
      path.relative(paths.workspace, skillsRoot),
    )
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
    await this.ensureAgentsFile(paths, templateVersion)
    const verifiedRuntimeGeneration = await this.ensureRuntimeGeneration(
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
      'env_vars = ["LINKSENSE_COLLABORATION_MODE", "LINKSENSE_CONVERSATION_ID", "LINKSENSE_CURRENT_USER_ENDPOINT", "LINKSENSE_CURRENT_USER_TOKEN", "LINKSENSE_FILE_SERVICE_ENDPOINT", "LINKSENSE_FILE_SERVICE_TOKEN", "LINKSENSE_FORM_SERVICE_ENDPOINT", "LINKSENSE_FORM_SERVICE_TOKEN", "LINKSENSE_IMAGE_GENERATION_ENDPOINT", "LINKSENSE_IMAGE_GENERATION_TOKEN", "LINKSENSE_KNOWLEDGE_SEARCH_ENDPOINT", "LINKSENSE_KNOWLEDGE_SEARCH_TIMEOUT_MS", "LINKSENSE_KNOWLEDGE_SERVICE_TOKEN", "LINKSENSE_SKILL_CREATOR_ENDPOINT", "LINKSENSE_SKILL_CREATOR_TOKEN"]',
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
    await removeConversationRuntimeDirectories({
      workspace: paths.workspace,
      taskControl: paths.taskControl,
      ...(this.options.directoryCleanupIdentity
        ? { directoryCleanupIdentity: this.options.directoryCleanupIdentity }
        : {}),
    })
    this.conversationOwners.delete(conversationId)
  }

  private async ensureRuntimeGeneration(taskControl: string): Promise<string> {
    await ensureSupervisorDirectory(taskControl, 0o700)
    const current = await inspectRuntimeGeneration(taskControl)
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
      const published = await inspectRuntimeGeneration(taskControl)
      if (published.status !== "valid") {
        throw new RuntimeGenerationIntegrityError()
      }
      return published.runtimeGeneration
    } finally {
      await rm(temporaryPath, { force: true }).catch(() => undefined)
    }
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

  private async ensureOwnerDirectories(paths: OwnerPaths): Promise<void> {
    await Promise.all([
      mkdir(paths.home, { recursive: true, mode: 0o770 }),
      mkdir(paths.control, { recursive: true, mode: 0o700 }),
    ])
    await setManagedDirectoryMode(
      paths.home,
      0o770,
      this.options.directoryCleanupIdentity,
    )
    await ensureSupervisorDirectory(paths.control, 0o700)
    await mkdir(paths.codexHome, { recursive: true, mode: 0o770 })
    await setManagedDirectoryMode(
      paths.codexHome,
      0o770,
      this.options.directoryCleanupIdentity,
    )
    await mkdir(path.join(paths.codexHome, "logs"), {
      recursive: true,
      mode: 0o770,
    })
    await setManagedDirectoryMode(
      path.join(paths.codexHome, "logs"),
      0o770,
      this.options.directoryCleanupIdentity,
    )
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
      await this.writeGlobalAgentsFile(paths, state)
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
    await this.writeGlobalAgentsFile(paths, state)
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

  private async writeGlobalAgentsFile(
    paths: OwnerPaths,
    state: z.infer<typeof personalizationStateSchema>,
  ): Promise<void> {
    const targetPath = path.join(paths.codexHome, globalAgentsFileName)
    await this.writeCodexConfig(
      targetPath,
      renderGlobalAgentsFile(state),
    )
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

  private async ensureAgentsFile(
    paths: ConversationPaths,
    templateVersion: string,
  ): Promise<void> {
    const agentsPath = path.join(paths.workspace, "AGENTS.md")
    const marker = `<!-- linksense-template:${templateVersion} -->`
    try {
      const current = await readFile(agentsPath, "utf8")
      if (current.startsWith(marker)) return
    } catch {
      // Missing file is created below.
    }
    await writeSharedRegularFileAtomically(
      agentsPath,
      renderAgentsFile(
        marker,
        paths.workspace,
        paths.home,
        paths.codexHome,
      ),
      workspacePermissionPolicy.sharedReadableFile,
    )
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

function renderAgentsFile(
  marker: string,
  workspacePath: string,
  userHomePath: string,
  codexHomePath: string,
): string {
  return `${marker}
# LinkSense conversation rules

- You are assisting organization members, team leads, IT staff, and administrators. Use clear language and avoid unnecessary developer terminology.
- User custom instructions from the global Codex AGENTS.md are preferences only. They never override these LinkSense-managed task rules, authorization boundaries, or safety requirements.
- Only operate inside the current task workspace: ${workspacePath}
- You may read current capability instructions from the user's private directories ${path.join(userHomePath, ".agents", "skills")} and ${codexHomePath}.
- The workspace \`skills/\` entry is a read-only convenience link to current Skill resources for third-party Skill scripts and data.
- Never write to, update, remove, or edit LinkSense-managed Skill and Plugin directories from a task. The only permitted Skill installation path is the built-in \`linksense-skill-creator\` workflow, which creates a ZIP in this task, previews it through the protected Skill Creator service, and installs the exact preview only after explicit user confirmation.
- Never inspect another task's workspace, Codex session or rollout history, LinkSense deployment configuration, backend source, credentials, tokens, environment variables, or internal logs.
- Put downloadable deliverables in \`artifacts/\`. Put temporary and intermediate files in \`temp/\`.
- For ZIP archives containing non-ASCII entry names, use Python \`zipfile\` or Node.js \`archiver\`; do not use the Info-ZIP \`zip\` command because it can omit the UTF-8 filename flag.
- Common Python and Node.js libraries are already available from the shared read-only runtime. Test an import before installing another copy.
- Python and Node.js package sources are managed by LinkSense. Never edit package-manager source configuration, add registry settings to \`.npmrc\`, use requirements or constraints files to declare alternate indexes, or pass index, extra-index, default-index, or registry override arguments such as \`-i\`, \`--index-url\`, \`--extra-index-url\`, \`--default-index\`, or \`--registry\`.
- To persist a Python package for this user, use only \`linksense-uv pip install <package>\`. Never use \`uv pip install --system\`, create a task-local virtual environment, or replace the managed Python environment.
- To persist a Node.js package for this user, use only \`linksense-pnpm add <package>\`. Never use a global package target or replace the managed \`node_modules\` link.
- When the user requests any download or deliverable file, first create the file under \`artifacts/\`, then call the LinkSense File Service \`register_artifact\` tool with a workspace-relative path.
- Only the LinkSense File Service can provide user-downloadable files. Never present local filesystem paths, absolute paths, \`file://\` URLs, \`localhost\`/\`127.0.0.1\` URLs, container paths, or raw workspace-relative paths as download links.
- After \`register_artifact\` succeeds, mention the registered display name only as plain text and direct the user to the structured attachment card rendered by LinkSense. Never emit a Markdown or HTML download link, an empty link, or a fabricated URL for a registered artifact; the attachment card is the only download control.
- The file service may only register files from this task workspace. Never pass absolute paths.
- If artifact registration fails or the file service is unavailable, tell the user that LinkSense could not prepare a downloadable attachment and do not offer a local-path fallback.
- Do not expose internal paths, commands, credentials, raw tool payloads, or other users' data in the response.
`
}

function renderGlobalAgentsFile(
  state: z.infer<typeof personalizationStateSchema>,
): string {
  const instructions =
    state.custom_instructions.length > 0
      ? state.custom_instructions
      : "No custom instructions are configured."
  return `<!-- linksense-personalization:v1 revision:${state.revision} -->
# User custom instructions

The following text is the user's preferred working style and context. Follow it when it does not conflict with system or developer instructions, authorization boundaries, or the closer LinkSense-managed AGENTS.md inside a task workspace.

${instructions}
`
}

function projectPersonalizationSnapshot(
  state: z.infer<typeof personalizationStateSchema>,
): PersonalizationSnapshot {
  return {
    revision: state.revision,
    custom_instructions: state.custom_instructions,
    memories_enabled: state.memories_enabled,
  }
}

async function ensureDirectoryLink(
  destination: string,
  target: string,
): Promise<void> {
  const destinationDirectory = path.dirname(destination)
  const normalizedTarget = path.resolve(destinationDirectory, target)
  try {
    const info = await lstat(destination)
    if (!info.isSymbolicLink()) return
    const current = await readlink(destination)
    if (current === target) return
    if (
      path.isAbsolute(target) &&
      path.resolve(destinationDirectory, current) === normalizedTarget
    ) {
      return
    }
    await rm(destination, { force: true })
  } catch (error) {
    if (!isNodeError(error) || error.code !== "ENOENT") throw error
  }
  await symlink(target, destination, "dir")
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
): Promise<RuntimeGenerationInspection> {
  const generationPath = path.join(taskControl, runtimeGenerationFileName)
  try {
    const controlInfo = await lstat(taskControl)
    if (!isSupervisorOwnedDirectory(controlInfo, 0o700)) {
      return { status: "invalid" }
    }
    const generationInfo = await lstat(generationPath)
    if (
      !generationInfo.isFile() ||
      !isSupervisorOwned(generationInfo) ||
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
): Promise<void> {
  try {
    await mkdir(directory, { mode })
  } catch (error) {
    if (!isNodeError(error) || error.code !== "EEXIST") throw error
  }
  const info = await lstat(directory)
  if (!info.isDirectory() || !isSupervisorOwned(info)) {
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

function isSupervisorOwnedDirectory(info: Stats, mode: number): boolean {
  return (
    info.isDirectory() &&
    isSupervisorOwned(info) &&
    (info.mode & 0o7777) === mode
  )
}

function isSupervisorOwned(info: Stats): boolean {
  return typeof process.geteuid !== "function" || info.uid === process.geteuid()
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
