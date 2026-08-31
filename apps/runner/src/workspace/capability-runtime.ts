import { createHash } from "node:crypto"
import type { Stats } from "node:fs"
import { lstat, readFile, readdir } from "node:fs/promises"
import path from "node:path"

import lockfile from "proper-lockfile"
import { z } from "zod"

import {
  builtInSkillNames,
  linksenseRuntimeIdentity,
} from "@linksense/shared"

import { NATIVE_PLUGIN_MARKETPLACE_NAME } from "../codex/native-plugin-manager.js"

export type CapabilityRuntimeInput = {
  id: string
  name: string
  type: "plugin" | "skill"
  revision: string
  credentialEnvironment?: Record<string, string>
}

export type PreparedCapabilityRuntime = {
  skillsRoot: string
  pluginSourceRoot: string
  marketplacePath: string
  capabilityControl: string
  contentDigest: string
  generation: string
}

export type CapabilityRuntimeLease = {
  capabilityControl: string
  generation: string
  release: () => Promise<void>
}

type RuntimeIdentity = {
  uid: number
  gid: number
}

const capabilityGenerationPattern = /^[0-9a-f]{64}$/u
const capabilityNamePattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u
const marketplaceSchema = z.strictObject({
  name: z.literal(NATIVE_PLUGIN_MARKETPLACE_NAME),
  interface: z.unknown().optional(),
  plugins: z.array(
    z
      .object({
        name: z.string().min(1).max(64),
        source: z.object({
          source: z.literal("local"),
          path: z.string().min(1).max(4_096),
        }),
      })
      .passthrough(),
  ),
})

export class CapabilityRuntimeError extends Error {
  constructor(message = "published capability runtime is invalid") {
    super(message)
    this.name = "CapabilityRuntimeError"
  }
}

/**
 * The API owns capability source materialization. The runner only validates
 * the atomically published read-only $HOME/.agents projection and never
 * copies source files, edits Codex configuration, or manages Codex's
 * task-owned installation cache under CODEX_HOME.
 */
export class CapabilityRuntimeManager {
  readonly #apiIdentity: RuntimeIdentity
  readonly #taskIdentity: RuntimeIdentity

  constructor(options?: {
    apiIdentity?: RuntimeIdentity
    taskIdentity?: RuntimeIdentity
  }) {
    this.#apiIdentity = options?.apiIdentity ?? {
      uid: linksenseRuntimeIdentity.apiUid,
      gid: linksenseRuntimeIdentity.sharedGid,
    }
    this.#taskIdentity = options?.taskIdentity ?? {
      uid: linksenseRuntimeIdentity.taskUid,
      gid: linksenseRuntimeIdentity.sharedGid,
    }
  }

  pathsFor(
    userHome: string,
    controlRoot: string,
  ): Omit<PreparedCapabilityRuntime, "contentDigest" | "generation"> {
    return {
      skillsRoot: path.join(userHome, ".agents", "skills"),
      pluginSourceRoot: path.join(
        userHome,
        ".agents",
        "plugin-sources",
      ),
      marketplacePath: path.join(
        userHome,
        ".agents",
        "plugins",
        "marketplace.json",
      ),
      capabilityControl: path.join(controlRoot, "capabilities"),
    }
  }

  async acquireLease(input: {
    controlRoot: string
    expectedGeneration: string
  }): Promise<CapabilityRuntimeLease> {
    if (!capabilityGenerationPattern.test(input.expectedGeneration)) {
      throw new CapabilityRuntimeError()
    }
    const capabilityControl = path.join(input.controlRoot, "capabilities")
    await this.assertDirectory(
      capabilityControl,
      0o700,
      this.#apiIdentity,
    )

    let releaseLock: (() => Promise<void>) | undefined
    try {
      releaseLock = await lockfile.lock(capabilityControl, {
        realpath: false,
        lockfilePath: path.join(capabilityControl, "reconcile.lock"),
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
      const generation = await this.readControlDigest(
        path.join(capabilityControl, "capability-generation"),
      )
      if (generation !== input.expectedGeneration) {
        throw new CapabilityRuntimeError()
      }
      let released = false
      return {
        capabilityControl,
        generation,
        release: async () => {
          if (released) return
          released = true
          await releaseLock?.()
        },
      }
    } catch (error) {
      await releaseLock?.().catch(() => undefined)
      if (error instanceof CapabilityRuntimeError) throw error
      throw new CapabilityRuntimeError()
    }
  }

  async existing(
    userHome: string,
    controlRoot: string,
  ): Promise<PreparedCapabilityRuntime | null> {
    const paths = this.pathsFor(userHome, controlRoot)
    try {
      const generation = await this.readControlDigest(
        path.join(paths.capabilityControl, "capability-generation"),
      )
      const contentDigest = await this.readControlDigest(
        path.join(paths.capabilityControl, "capability-content-sha256"),
      )
      await this.assertDirectory(paths.skillsRoot, 0o750, this.#apiIdentity)
      await this.assertDirectory(
        paths.pluginSourceRoot,
        0o750,
        this.#apiIdentity,
      )
      await this.assertRegularFile(
        paths.marketplacePath,
        0o640,
        this.#apiIdentity,
      )
      return { ...paths, contentDigest, generation }
    } catch (error) {
      if (isMissing(error)) return null
      throw error
    }
  }

  async resolvePublished(input: {
    userHome: string
    controlRoot: string
    expectedGeneration: string
    capabilities: CapabilityRuntimeInput[]
    lockHeld?: boolean
  }): Promise<PreparedCapabilityRuntime> {
    if (!capabilityGenerationPattern.test(input.expectedGeneration)) {
      throw new CapabilityRuntimeError()
    }
    let lease: CapabilityRuntimeLease | undefined
    try {
      if (!input.lockHeld) {
        lease = await this.acquireLease({
          controlRoot: input.controlRoot,
          expectedGeneration: input.expectedGeneration,
        })
      }
      return await this.resolveLocked(input)
    } catch (error) {
      if (error instanceof CapabilityRuntimeError) throw error
      throw new CapabilityRuntimeError()
    } finally {
      await lease?.release().catch(() => undefined)
    }
  }

  private async resolveLocked(input: {
    userHome: string
    controlRoot: string
    expectedGeneration: string
    capabilities: CapabilityRuntimeInput[]
  }): Promise<PreparedCapabilityRuntime> {
    const paths = this.pathsFor(input.userHome, input.controlRoot)
    await Promise.all([
      this.assertDirectory(
        paths.capabilityControl,
        0o700,
        this.#apiIdentity,
      ),
      this.assertDirectory(input.userHome, 0o770, this.#taskIdentity),
      this.assertDirectory(
        path.join(input.userHome, ".agents"),
        0o750,
        this.#apiIdentity,
      ),
      this.assertDirectory(
        path.join(input.userHome, ".agents", "plugins"),
        0o750,
        this.#apiIdentity,
      ),
      this.assertDirectory(
        path.join(input.userHome, ".codex"),
        0o770,
        this.#taskIdentity,
      ),
      this.assertDirectory(paths.skillsRoot, 0o750, this.#apiIdentity),
      this.assertDirectory(
        paths.pluginSourceRoot,
        0o750,
        this.#apiIdentity,
      ),
      this.assertRegularFile(
        paths.marketplacePath,
        0o640,
        this.#apiIdentity,
      ),
      this.assertRegularFile(
        path.join(paths.capabilityControl, "capability-generation"),
        0o600,
        this.#apiIdentity,
      ),
      this.assertRegularFile(
        path.join(paths.capabilityControl, "capability-content-sha256"),
        0o600,
        this.#apiIdentity,
      ),
    ])

    const [generation, trustedContentDigest] = await Promise.all([
      this.readControlDigest(
        path.join(paths.capabilityControl, "capability-generation"),
      ),
      this.readControlDigest(
        path.join(paths.capabilityControl, "capability-content-sha256"),
      ),
    ])
    if (generation !== input.expectedGeneration) {
      throw new CapabilityRuntimeError()
    }

    const pluginNames = new Set<string>()
    const skillNames = new Set<string>()
    const capabilityIds = new Set<string>()
    for (const capability of input.capabilities) {
      const names = capability.type === "plugin" ? pluginNames : skillNames
      if (
        !z.uuid().safeParse(capability.id).success ||
        !capabilityNamePattern.test(capability.name) ||
        capabilityIds.has(capability.id) ||
        names.has(capability.name)
      ) {
        throw new CapabilityRuntimeError()
      }
      capabilityIds.add(capability.id)
      names.add(capability.name)
    }

    await this.assertExactSkillSources(paths.skillsRoot, skillNames)
    await this.assertExactPluginSources(paths.pluginSourceRoot, pluginNames)
    await this.assertCapabilityTree(paths.skillsRoot)
    for (const pluginName of [...pluginNames].sort()) {
      await this.assertCapabilityTree(
        path.join(paths.pluginSourceRoot, pluginName),
      )
    }

    const marketplace = marketplaceSchema.safeParse(
      JSON.parse(await readFile(paths.marketplacePath, "utf8")),
    )
    if (!marketplace.success) throw new CapabilityRuntimeError()
    const publishedPluginNames = marketplace.data.plugins
      .map((plugin) => plugin.name)
      .sort()
    const expectedPluginNames = [...pluginNames].sort()
    if (
      publishedPluginNames.length !== expectedPluginNames.length ||
      !publishedPluginNames.every(
        (name, index) =>
          name === expectedPluginNames[index] &&
          marketplace.data.plugins.find((plugin) => plugin.name === name)
            ?.source.path === `./.agents/plugin-sources/${name}`,
      )
    ) {
      throw new CapabilityRuntimeError()
    }

    const actualContentDigest = await calculateContentDigest({
      skillsRoot: paths.skillsRoot,
      pluginSourceRoot: paths.pluginSourceRoot,
      marketplacePath: paths.marketplacePath,
      pluginNames: expectedPluginNames,
    })
    if (actualContentDigest !== trustedContentDigest) {
      throw new CapabilityRuntimeError()
    }
    return {
      ...paths,
      contentDigest: trustedContentDigest,
      generation,
    }
  }

  private async assertExactSkillSources(
    skillsRoot: string,
    authorizedSkillNames: ReadonlySet<string>,
  ): Promise<void> {
    const expected = [...builtInSkillNames, ...authorizedSkillNames].sort()
    const published = (await readdir(skillsRoot)).sort()
    if (!sameStrings(published, expected)) throw new CapabilityRuntimeError()
    for (const name of published) {
      await this.assertDirectory(
        path.join(skillsRoot, name),
        0o750,
        this.#apiIdentity,
      )
    }
  }

  private async assertExactPluginSources(
    pluginSourceRoot: string,
    authorizedPluginNames: ReadonlySet<string>,
  ): Promise<void> {
    const published: string[] = []
    for (const name of (await readdir(pluginSourceRoot)).sort()) {
      const target = path.join(pluginSourceRoot, name)
      const info = await lstat(target)
      if (!info.isDirectory() || info.isSymbolicLink()) {
        throw new CapabilityRuntimeError()
      }
      published.push(name)
      await this.assertDirectory(target, 0o750, this.#apiIdentity)
    }
    if (!sameStrings(published, [...authorizedPluginNames].sort())) {
      throw new CapabilityRuntimeError()
    }
  }

  private async assertCapabilityTree(target: string): Promise<void> {
    const info = await lstat(target)
    if (info.isSymbolicLink()) throw new CapabilityRuntimeError()
    if (info.isDirectory()) {
      this.assertIdentityAndMode(info, 0o750, this.#apiIdentity)
      for (const entry of (await readdir(target)).sort()) {
        await this.assertCapabilityTree(path.join(target, entry))
      }
      return
    }
    if (!info.isFile()) throw new CapabilityRuntimeError()
    this.assertIdentityAndMode(
      info,
      info.mode & 0o111 ? 0o750 : 0o640,
      this.#apiIdentity,
    )
  }

  private async assertDirectory(
    target: string,
    mode: number,
    identity: RuntimeIdentity,
  ): Promise<void> {
    const info = await lstat(target)
    if (!info.isDirectory() || info.isSymbolicLink()) {
      throw new CapabilityRuntimeError()
    }
    this.assertIdentityAndMode(info, mode, identity)
  }

  private async assertRegularFile(
    target: string,
    mode: number,
    identity: RuntimeIdentity,
  ): Promise<void> {
    const info = await lstat(target)
    if (!info.isFile() || info.isSymbolicLink()) {
      throw new CapabilityRuntimeError()
    }
    this.assertIdentityAndMode(info, mode, identity)
  }

  private assertIdentityAndMode(
    info: Stats,
    mode: number,
    identity: RuntimeIdentity,
  ): void {
    if (
      info.uid !== identity.uid ||
      info.gid !== identity.gid ||
      (info.mode & 0o7777) !== mode
    ) {
      throw new CapabilityRuntimeError()
    }
  }

  private async readControlDigest(target: string): Promise<string> {
    const value = (await readFile(target, "utf8")).trim()
    if (!capabilityGenerationPattern.test(value)) {
      throw new CapabilityRuntimeError()
    }
    return value
  }
}

async function calculateContentDigest(input: {
  skillsRoot: string
  pluginSourceRoot: string
  marketplacePath: string
  pluginNames: string[]
}): Promise<string> {
  const hash = createHash("sha256")
  hash.update("linksense-capability-content\n")
  await hashTree(input.skillsRoot, "skills", hash)
  const pluginRoot = await lstat(input.pluginSourceRoot)
  if (!pluginRoot.isDirectory() || pluginRoot.isSymbolicLink()) {
    throw new CapabilityRuntimeError()
  }
  hash.update("directory\0plugins\0")
  for (const pluginName of [...input.pluginNames].sort()) {
    await hashTree(
      path.join(input.pluginSourceRoot, pluginName),
      `plugins/${pluginName}`,
      hash,
    )
  }
  await hashTree(input.marketplacePath, "marketplace.json", hash)
  return hash.digest("hex")
}

async function hashTree(
  currentPath: string,
  relativePath: string,
  hash: ReturnType<typeof createHash>,
): Promise<void> {
  const info = await lstat(currentPath)
  if (info.isSymbolicLink()) throw new CapabilityRuntimeError()
  if (info.isFile()) {
    hash.update(`file\0${relativePath}\0${info.mode & 0o111 ? "x" : "-"}\0`)
    hash.update(await readFile(currentPath))
    hash.update("\0")
    return
  }
  if (!info.isDirectory()) throw new CapabilityRuntimeError()
  hash.update(`directory\0${relativePath}\0`)
  for (const entry of (await readdir(currentPath)).sort()) {
    await hashTree(
      path.join(currentPath, entry),
      `${relativePath}/${entry}`,
      hash,
    )
  }
}

function sameStrings(left: string[], right: string[]): boolean {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  )
}

function isMissing(error: unknown): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    (error as NodeJS.ErrnoException).code === "ENOENT"
  )
}
