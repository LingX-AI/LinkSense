import { randomUUID } from "node:crypto"
import { execFile } from "node:child_process"
import {
  lstat,
  readFile,
  realpath,
  rename,
  rm,
  writeFile,
} from "node:fs/promises"
import path from "node:path"
import { promisify } from "node:util"

import lockfile from "proper-lockfile"
import { parse } from "smol-toml"
import { z } from "zod"

import {
  isolatedChildInvocation,
  type ProcessIdentity,
} from "../child-process-isolation.js"

import { CodexProtocolError } from "./json-rpc-client.js"

export const NATIVE_PLUGIN_MARKETPLACE_NAME = "linksense-personal"
const capabilityGenerationPattern = /^[0-9a-f]{64}$/u
const pluginNamePattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u
const MAX_CLI_JSON_BYTES = 4 * 1024 * 1024
const MAX_CODEX_CONFIG_BYTES = 4 * 1024 * 1024
const MAX_NATIVE_PLUGIN_STATE_BYTES = 64 * 1024
const NATIVE_PLUGIN_STATE_FILE = ".linksense-native-plugins.json"
const execFileAsync = promisify(execFile)

export type NativePluginClient = {
  request(method: string, params: unknown): Promise<unknown>
}

export type NativePluginCommandInput = {
  command: string
  args: string[]
  cwd: string
  environment: NodeJS.ProcessEnv
  processIdentity?: ProcessIdentity
}

export type NativePluginCommand = (
  input: NativePluginCommandInput,
) => Promise<{ stdout: string }>

const cliPluginSchema = z
  .object({
    pluginId: z.string().min(1).max(256),
    name: z.string().min(1).max(64),
    marketplaceName: z.string().min(1).max(160),
    version: z.string().min(1).max(120).nullable().optional(),
    installed: z.boolean(),
    enabled: z.boolean(),
    source: z.unknown().optional(),
    installPolicy: z.string().optional(),
    authPolicy: z.string().optional(),
  })
  .passthrough()

const cliPluginListSchema = z.strictObject({
  installed: z.array(cliPluginSchema).max(512),
  available: z.array(cliPluginSchema).max(512),
})

const pluginSummarySchema = z
  .object({
    id: z.string().min(1).max(256),
    localVersion: z.string().min(1).max(120).nullable(),
    name: z.string().min(1).max(64),
    source: z.discriminatedUnion("type", [
      z.object({
        type: z.literal("local"),
        path: z.string().min(1).max(4_096),
      }),
      z.object({ type: z.literal("git") }).passthrough(),
      z.object({ type: z.literal("remote") }).passthrough(),
    ]),
    installed: z.boolean(),
    enabled: z.boolean(),
  })
  .passthrough()

const marketplaceEntrySchema = z
  .object({
    name: z.string().min(1).max(160),
    path: z.string().min(1).max(4_096).nullable(),
    plugins: z.array(pluginSummarySchema).max(512),
  })
  .passthrough()

const pluginCatalogResponseSchema = z
  .object({
    marketplaces: z.array(marketplaceEntrySchema).max(64),
    marketplaceLoadErrors: z.array(z.unknown()).max(64),
  })
  .passthrough()

const pluginDetailResponseSchema = z
  .object({
    plugin: z
      .object({
        marketplaceName: z.string().min(1).max(160),
        marketplacePath: z.string().min(1).max(4_096).nullable(),
        summary: pluginSummarySchema,
        skills: z
          .array(
            z
              .object({
                name: z.string().min(1).max(128),
                path: z.string().min(1).max(4_096).nullable(),
                enabled: z.boolean(),
              })
              .passthrough(),
          )
          .max(256),
        hooks: z.array(z.unknown()).max(128),
        apps: z.array(z.unknown()).max(128),
        appTemplates: z.array(z.unknown()).max(128),
        mcpServers: z.array(z.string().min(1).max(256)).max(128),
      })
      .passthrough(),
  })
  .passthrough()

const nativePluginStateSchema = z.strictObject({
  version: z.literal(1),
  pluginContentDigest: z.string().regex(capabilityGenerationPattern),
  pluginNames: z.array(z.string().regex(pluginNamePattern)).max(512),
})

export type NativePluginSkillActivation = {
  name: string
  sourcePath: string
  relativePath: string
}

export type NativePluginActivation = {
  name: string
  pluginId: string
  version: string | null
  mentionPath: string
  cacheRoot: string
  skills: NativePluginSkillActivation[]
  mcpServers: string[]
}

export type NativePluginRefreshStage =
  | "input"
  | "lock"
  | "generation-before"
  | "inspect-current"
  | "read-state"
  | "remove-stale"
  | "install-desired"
  | "verify-current"
  | "generation-after"
  | "write-state"
  | "app-server-verification"

export class NativePluginRefreshError extends CodexProtocolError {
  constructor(
    readonly stage: NativePluginRefreshStage = "app-server-verification",
    cause?: unknown,
  ) {
    super("native plugin refresh failed")
    this.name = "NativePluginRefreshError"
    if (cause !== undefined) {
      Object.defineProperty(this, "cause", {
        configurable: true,
        value: cause,
      })
    }
  }
}

export class NativePluginManager {
  constructor(
    private readonly runCommand: NativePluginCommand =
      defaultNativePluginCommand,
  ) {}

  async reconcileBeforeStart(input: {
    command: string
    userHome: string
    codexHome: string
    workspace: string
    capabilityControl: string
    expectedGeneration: string
    pluginContentDigest: string
    pluginNames: string[]
    processIdentity?: ProcessIdentity
    lockHeld?: boolean
  }): Promise<void> {
    let stage: NativePluginRefreshStage = "input"
    let release: (() => Promise<void>) | undefined
    try {
      const desiredNames = normalizePluginNames(input.pluginNames)
      if (
        !capabilityGenerationPattern.test(input.expectedGeneration) ||
        !capabilityGenerationPattern.test(input.pluginContentDigest)
      ) {
        throw new NativePluginRefreshError()
      }

      if (!input.lockHeld) {
        stage = "lock"
        release = await lockfile.lock(input.capabilityControl, {
          realpath: false,
          lockfilePath: path.join(
            input.capabilityControl,
            "reconcile.lock",
          ),
          stale: 120_000,
          update: 10_000,
          retries: {
            retries: 120,
            factor: 1,
            minTimeout: 500,
            maxTimeout: 500,
            randomize: true,
          },
        })
      }
      stage = "generation-before"
      const publishedGeneration = (
        await readFile(
          path.join(input.capabilityControl, "capability-generation"),
          "utf8",
        )
      ).trim()
      if (publishedGeneration !== input.expectedGeneration) {
        throw new NativePluginRefreshError()
      }

      stage = "inspect-current"
      const before = await this.listManagedPlugins(input)
      const configuredPluginIds = await configuredManagedPluginIds(
        input.codexHome,
      )
      const desiredSet = new Set(desiredNames)
      const installedBefore = installedManagedPluginNames(before)
      const currentStateIsExact =
        sameStrings(installedBefore, desiredNames) &&
        containsOnlyDesiredManagedPlugins(configuredPluginIds, desiredSet)

      stage = "read-state"
      const appliedState = await readNativePluginState(
        input.capabilityControl,
      )
      const contentIsAlreadyApplied =
        appliedState !== null &&
        appliedState.pluginContentDigest === input.pluginContentDigest &&
        sameStrings(appliedState.pluginNames, desiredNames)

      if (
        currentStateIsExact &&
        (contentIsAlreadyApplied || desiredNames.length === 0)
      ) {
        stage = "generation-after"
        await assertPublishedGeneration(input)
        if (!contentIsAlreadyApplied) {
          stage = "write-state"
          await writeNativePluginState({
            capabilityControl: input.capabilityControl,
            pluginContentDigest: input.pluginContentDigest,
            pluginNames: desiredNames,
          })
        }
        return
      }

      const stalePluginIds = [
        ...new Set([
          ...before.installed
            .filter(
              (plugin) =>
                plugin.marketplaceName === NATIVE_PLUGIN_MARKETPLACE_NAME &&
                plugin.installed &&
                !desiredSet.has(plugin.name),
            )
            .map((plugin) => plugin.pluginId),
          ...configuredPluginIds.filter((pluginId) => {
            const pluginName = managedPluginName(pluginId)
            return pluginName !== null && !desiredSet.has(pluginName)
          }),
        ]),
      ].sort()
      for (const pluginId of stalePluginIds) {
        if (!isManagedPluginId(pluginId)) throw new NativePluginRefreshError()
        stage = "remove-stale"
        await this.runJsonCommand(input, [
          "plugin",
          "remove",
          pluginId,
          "--json",
        ])
      }
      // Codex has no separate refresh command. Re-running native `add` is the
      // supported refresh path and also covers source changes that keep the
      // same plugin manifest version.
      for (const pluginName of desiredNames) {
        stage = "install-desired"
        await this.runJsonCommand(input, [
          "plugin",
          "add",
          `${pluginName}@${NATIVE_PLUGIN_MARKETPLACE_NAME}`,
          "--json",
        ])
      }

      stage = "verify-current"
      const after = await this.listManagedPlugins(input)
      const installedManaged = installedManagedPluginNames(after)
      if (!sameStrings(installedManaged, desiredNames)) {
        throw new NativePluginRefreshError()
      }
      const configuredAfterRefresh = await configuredManagedPluginIds(
        input.codexHome,
      )
      if (
        !containsOnlyDesiredManagedPlugins(
          configuredAfterRefresh,
          desiredSet,
        )
      ) {
        throw new NativePluginRefreshError()
      }
      stage = "generation-after"
      await assertPublishedGeneration(input)
      stage = "write-state"
      await writeNativePluginState({
        capabilityControl: input.capabilityControl,
        pluginContentDigest: input.pluginContentDigest,
        pluginNames: desiredNames,
      })
    } catch (error) {
      if (
        error instanceof NativePluginRefreshError &&
        error.stage !== "app-server-verification"
      ) {
        throw error
      }
      throw new NativePluginRefreshError(stage, error)
    } finally {
      await release?.().catch(() => undefined)
    }
  }

  async verifyAfterStart(input: {
    client: NativePluginClient
    workspace: string
    userHome: string
    codexHome: string
    pluginNames: string[]
  }): Promise<NativePluginActivation[]> {
    const desiredNames = normalizePluginNames(input.pluginNames)
    try {
      const installed = pluginCatalogResponseSchema.parse(
        await input.client.request("plugin/installed", {
          cwds: [input.workspace],
          installSuggestionPluginNames: null,
        }),
      )
      if (installed.marketplaceLoadErrors.length > 0) {
        throw new NativePluginRefreshError()
      }
      const desiredSet = new Set(desiredNames)
      const activePluginIds = installed.marketplaces
        .flatMap((entry) =>
          entry.plugins
            .filter((plugin) => plugin.installed && plugin.enabled)
            .map((plugin) => {
              if (
                entry.name !== NATIVE_PLUGIN_MARKETPLACE_NAME ||
                !desiredSet.has(plugin.name) ||
                plugin.id !==
                  `${plugin.name}@${NATIVE_PLUGIN_MARKETPLACE_NAME}`
              ) {
                throw new NativePluginRefreshError()
              }
              return plugin.id
            }),
        )
        .sort()
      const desiredPluginIds = desiredNames.map(
        (name) => `${name}@${NATIVE_PLUGIN_MARKETPLACE_NAME}`,
      )
      if (!sameStrings(activePluginIds, desiredPluginIds)) {
        throw new NativePluginRefreshError()
      }
      if (desiredNames.length === 0) return []

      const marketplace = installed.marketplaces.find(
        (entry) => entry.name === NATIVE_PLUGIN_MARKETPLACE_NAME,
      )
      const expectedMarketplacePath = path.join(
        input.userHome,
        ".agents",
        "plugins",
        "marketplace.json",
      )
      if (
        !marketplace ||
        !marketplace.path ||
        !(await isSamePath(marketplace.path, expectedMarketplacePath))
      ) {
        throw new NativePluginRefreshError()
      }

      const activations: NativePluginActivation[] = []
      for (const pluginName of desiredNames) {
        const detail = pluginDetailResponseSchema.parse(
          await input.client.request("plugin/read", {
            pluginName,
            marketplacePath: marketplace.path,
            remoteMarketplaceName: null,
          }),
        )
        const plugin = detail.plugin
        const expectedPluginId =
          `${pluginName}@${NATIVE_PLUGIN_MARKETPLACE_NAME}`
        if (
          plugin.marketplaceName !== NATIVE_PLUGIN_MARKETPLACE_NAME ||
          plugin.summary.name !== pluginName ||
          plugin.summary.id !== expectedPluginId ||
          !plugin.summary.localVersion ||
          !isSafePathSegment(plugin.summary.localVersion) ||
          !plugin.summary.installed ||
          !plugin.summary.enabled ||
          plugin.summary.source.type !== "local" ||
          !(await isPathInside(
            path.join(
              input.userHome,
              ".agents",
              "plugin-sources",
              pluginName,
            ),
            plugin.summary.source.path,
            true,
          )) ||
          plugin.hooks.length > 0 ||
          plugin.apps.length > 0 ||
          plugin.appTemplates.length > 0
        ) {
          throw new NativePluginRefreshError()
        }
        const pluginSourcePath = plugin.summary.source.path
        const cacheRoot = path.join(
          input.codexHome,
          "plugins",
          "cache",
          NATIVE_PLUGIN_MARKETPLACE_NAME,
          pluginName,
          plugin.summary.localVersion,
        )
        if (
          !(await isPathInside(
            path.join(input.codexHome, "plugins", "cache"),
            cacheRoot,
          ))
        ) {
          throw new NativePluginRefreshError()
        }
        const skills: NativePluginSkillActivation[] = []
        const skillNames = new Set<string>()
        const skillRelativePaths = new Set<string>()
        for (const skill of plugin.skills) {
          const relativePath = skill.path
            ? await relativePathInside(pluginSourcePath, skill.path)
            : null
          if (
            !skill.name.startsWith(`${pluginName}:`) ||
            skill.name === `${pluginName}:` ||
            !skill.enabled ||
            !skill.path ||
            relativePath === null ||
            skillNames.has(skill.name) ||
            skillRelativePaths.has(relativePath)
          ) {
            throw new NativePluginRefreshError()
          }
          skillNames.add(skill.name)
          skillRelativePaths.add(relativePath)
          skills.push({
            name: skill.name,
            sourcePath: skill.path,
            relativePath,
          })
        }
        activations.push({
          name: pluginName,
          pluginId: expectedPluginId,
          version: plugin.summary.localVersion,
          mentionPath: `plugin://${expectedPluginId}`,
          cacheRoot,
          skills: skills.sort(
            (left, right) =>
              left.name.localeCompare(right.name, "en-US") ||
              left.relativePath.localeCompare(right.relativePath, "en-US"),
          ),
          mcpServers: [...plugin.mcpServers].sort(),
        })
      }
      return activations
    } catch (error) {
      if (error instanceof NativePluginRefreshError) throw error
      throw new NativePluginRefreshError()
    }
  }

  private async listManagedPlugins(input: {
    command: string
    userHome: string
    codexHome: string
    workspace: string
    processIdentity?: ProcessIdentity
  }): Promise<z.infer<typeof cliPluginListSchema>> {
    const value = await this.runJsonCommand(input, [
      "plugin",
      "list",
      "--marketplace",
      NATIVE_PLUGIN_MARKETPLACE_NAME,
      "--available",
      "--json",
    ])
    const parsed = cliPluginListSchema.safeParse(value)
    if (!parsed.success) throw new NativePluginRefreshError()
    return parsed.data
  }

  private async runJsonCommand(
    input: {
      command: string
      userHome: string
      codexHome: string
      workspace: string
      processIdentity?: ProcessIdentity
    },
    args: string[],
  ): Promise<unknown> {
    const result = await this.runCommand({
      command: input.command,
      args,
      cwd: input.workspace,
      environment: {
        HOME: input.userHome,
        CODEX_HOME: input.codexHome,
        PATH: process.env.PATH ?? "/usr/bin:/bin",
        LANG: process.env.LANG ?? "C.UTF-8",
      },
      ...(input.processIdentity
        ? { processIdentity: input.processIdentity }
        : {}),
    })
    if (Buffer.byteLength(result.stdout, "utf8") > MAX_CLI_JSON_BYTES) {
      throw new NativePluginRefreshError()
    }
    try {
      return JSON.parse(result.stdout)
    } catch {
      throw new NativePluginRefreshError()
    }
  }
}

async function defaultNativePluginCommand(
  input: NativePluginCommandInput,
): Promise<{ stdout: string }> {
  const invocation = isolatedChildInvocation(
    input.command,
    input.args,
    input.processIdentity,
  )
  const result = await execFileAsync(invocation.command, invocation.args, {
    cwd: input.cwd,
    env: input.environment,
    timeout: 60_000,
    killSignal: "SIGKILL",
    maxBuffer: MAX_CLI_JSON_BYTES,
  })
  return { stdout: result.stdout }
}

function normalizePluginNames(pluginNames: string[]): string[] {
  const names = [...pluginNames].sort()
  if (
    new Set(names).size !== names.length ||
    names.some((name) => !pluginNamePattern.test(name))
  ) {
    throw new NativePluginRefreshError()
  }
  return names
}

function installedManagedPluginNames(
  plugins: z.infer<typeof cliPluginListSchema>,
): string[] {
  return plugins.installed
    .filter(
      (plugin) =>
        plugin.marketplaceName === NATIVE_PLUGIN_MARKETPLACE_NAME &&
        plugin.installed &&
        plugin.enabled,
    )
    .map((plugin) => plugin.name)
    .sort()
}

function containsOnlyDesiredManagedPlugins(
  configuredPluginIds: string[],
  desiredNames: ReadonlySet<string>,
): boolean {
  return configuredPluginIds.every((pluginId) => {
    const pluginName = managedPluginName(pluginId)
    return pluginName !== null && desiredNames.has(pluginName)
  })
}

async function assertPublishedGeneration(input: {
  capabilityControl: string
  expectedGeneration: string
}): Promise<void> {
  const generation = (
    await readFile(
      path.join(input.capabilityControl, "capability-generation"),
      "utf8",
    )
  ).trim()
  if (generation !== input.expectedGeneration) {
    throw new NativePluginRefreshError()
  }
}

async function readNativePluginState(
  capabilityControl: string,
): Promise<z.infer<typeof nativePluginStateSchema> | null> {
  const statePath = path.join(
    capabilityControl,
    NATIVE_PLUGIN_STATE_FILE,
  )
  let source: string
  try {
    const info = await lstat(statePath)
    if (
      !info.isFile() ||
      info.isSymbolicLink() ||
      info.size > MAX_NATIVE_PLUGIN_STATE_BYTES ||
      (info.mode & 0o7777) !== 0o600
    ) {
      return null
    }
    source = await readFile(statePath, "utf8")
  } catch (error) {
    if (errorCode(error) === "ENOENT") return null
    throw error
  }
  try {
    const state = nativePluginStateSchema.safeParse(JSON.parse(source))
    if (!state.success) return null
    const pluginNames = [...state.data.pluginNames].sort()
    if (new Set(pluginNames).size !== pluginNames.length) return null
    return { ...state.data, pluginNames }
  } catch (error) {
    if (error instanceof SyntaxError) return null
    throw error
  }
}

async function writeNativePluginState(input: {
  capabilityControl: string
  pluginContentDigest: string
  pluginNames: string[]
}): Promise<void> {
  const statePath = path.join(
    input.capabilityControl,
    NATIVE_PLUGIN_STATE_FILE,
  )
  const temporaryPath = `${statePath}.${randomUUID()}.tmp`
  try {
    await writeFile(
      temporaryPath,
      `${JSON.stringify({
        version: 1,
        pluginContentDigest: input.pluginContentDigest,
        pluginNames: input.pluginNames,
      })}\n`,
      { encoding: "utf8", flag: "wx", mode: 0o600 },
    )
    await rename(temporaryPath, statePath)
  } finally {
    await rm(temporaryPath, { force: true }).catch(() => undefined)
  }
}

function isManagedPluginId(pluginId: string): boolean {
  return managedPluginName(pluginId) !== null
}

function managedPluginName(pluginId: string): string | null {
  const suffix = `@${NATIVE_PLUGIN_MARKETPLACE_NAME}`
  if (!pluginId.endsWith(suffix)) return null
  const pluginName = pluginId.slice(0, -suffix.length)
  return pluginNamePattern.test(pluginName) ? pluginName : null
}

async function configuredManagedPluginIds(
  codexHome: string,
): Promise<string[]> {
  let source: string
  try {
    source = await readFile(path.join(codexHome, "config.toml"), "utf8")
  } catch (error) {
    if (errorCode(error) === "ENOENT") return []
    throw new NativePluginRefreshError()
  }
  if (Buffer.byteLength(source, "utf8") > MAX_CODEX_CONFIG_BYTES) {
    throw new NativePluginRefreshError()
  }

  let config: unknown
  try {
    config = parse(source)
  } catch {
    throw new NativePluginRefreshError()
  }
  if (!isTable(config)) throw new NativePluginRefreshError()
  const plugins = config.plugins
  if (plugins === undefined) return []
  if (!isTable(plugins)) throw new NativePluginRefreshError()

  const managedMarketplaceSuffix = `@${NATIVE_PLUGIN_MARKETPLACE_NAME}`
  return Object.keys(plugins)
    .filter((pluginId) => {
      if (!pluginId.endsWith(managedMarketplaceSuffix)) return false
      if (!isManagedPluginId(pluginId)) throw new NativePluginRefreshError()
      return true
    })
    .sort()
}

function isTable(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    !(value instanceof Date)
  )
}

function errorCode(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null || !("code" in error)) {
    return undefined
  }
  return typeof error.code === "string" ? error.code : undefined
}

function isSafePathSegment(value: string): boolean {
  return (
    /^[0-9A-Za-z][0-9A-Za-z._+-]{0,119}$/u.test(value) &&
    value !== "." &&
    value !== ".."
  )
}

function sameStrings(left: string[], right: string[]): boolean {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  )
}

async function isSamePath(left: string, right: string): Promise<boolean> {
  try {
    const [canonicalLeft, canonicalRight] = await Promise.all([
      realpath(left),
      realpath(right),
    ])
    return canonicalLeft === canonicalRight
  } catch {
    return false
  }
}

async function isPathInside(
  root: string,
  candidate: string,
  allowSame = false,
): Promise<boolean> {
  return (await relativePathInside(root, candidate, allowSame)) !== null
}

async function relativePathInside(
  root: string,
  candidate: string,
  allowSame = false,
): Promise<string | null> {
  try {
    const [canonicalRoot, canonicalCandidate] = await Promise.all([
      realpath(root),
      realpath(candidate),
    ])
    const relativePath = path.relative(canonicalRoot, canonicalCandidate)
    return (
      (allowSame && relativePath === "") ||
      (relativePath !== "" &&
        relativePath !== ".." &&
        !relativePath.startsWith(`..${path.sep}`) &&
        !path.isAbsolute(relativePath))
    )
      ? relativePath
      : null
  } catch {
    return null
  }
}
