import { createHash } from "node:crypto"
import type { Stats } from "node:fs"
import { lstat, readFile, readdir, readlink } from "node:fs/promises"
import path from "node:path"

import lockfile from "proper-lockfile"
import { z } from "zod"

import {
  builtInSkillNames,
  type BuiltInSkillName,
  capabilitySnapshotDirectory,
  capabilitySnapshotManifest,
  capabilitySnapshotIdSchema,
  capabilitySnapshotSchema,
  type CapabilitySnapshot,
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
  pluginContentDigest: string
  generation: string
}

export type CapabilityRuntimeLease = {
  capabilityControl: string
  generation: string
  /** Publication is fenced only until native startup has consumed the configuration. */
  releasePublicationLock: () => Promise<void>
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
 * the atomically published read-only task .agents projection and never
 * copies source files, edits Codex configuration, or manages Codex's
 * task-owned installation cache under CODEX_HOME.
 */
export class CapabilityRuntimeManager {
  readonly #apiIdentity: RuntimeIdentity
  readonly #taskIdentity: RuntimeIdentity
  readonly #onFullVerification: (() => void) | undefined
  readonly #enabledBuiltInSkillNames: readonly BuiltInSkillName[]
  readonly #verifiedSnapshots = new Map<string, {
    capabilityFingerprint: string
    contentDigest: string
    pluginContentDigest: string
  }>()
  readonly #verifiedPublications = new Map<
    string,
    {
      capabilityFingerprint: string
      runtime: PreparedCapabilityRuntime
    }
  >()

  constructor(options?: {
    apiIdentity?: RuntimeIdentity
    taskIdentity?: RuntimeIdentity
    onFullVerification?: () => void
    managedBrowserEnabled?: boolean
  }) {
    this.#onFullVerification = options?.onFullVerification
    this.#apiIdentity = options?.apiIdentity ?? {
      uid: linksenseRuntimeIdentity.apiUid,
      gid: linksenseRuntimeIdentity.sharedGid,
    }
    this.#taskIdentity = options?.taskIdentity ?? {
      uid: linksenseRuntimeIdentity.taskUid,
      gid: linksenseRuntimeIdentity.sharedGid,
    }
    this.#enabledBuiltInSkillNames =
      options?.managedBrowserEnabled === false
        ? builtInSkillNames.filter((name) => name !== "linksense-browser")
        : builtInSkillNames
  }

  pathsFor(
    userHome: string,
    controlRoot: string,
  ): Omit<
    PreparedCapabilityRuntime,
    "contentDigest" | "pluginContentDigest" | "generation"
  > {
    return {
      skillsRoot: path.join(userHome, ".agents", "current", "skills"),
      pluginSourceRoot: path.join(
        userHome,
        ".agents",
        "current",
        "plugin-sources",
      ),
      marketplacePath: path.join(
        userHome,
        ".agents",
        "current",
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
      const releasePublicationLock = async (): Promise<void> => {
        if (released) return
        released = true
        await releaseLock?.()
      }
      return {
        capabilityControl,
        generation,
        releasePublicationLock,
        release: releasePublicationLock,
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
      const marketplace = marketplaceSchema.safeParse(
        JSON.parse(await readFile(paths.marketplacePath, "utf8")),
      )
      if (!marketplace.success) throw new CapabilityRuntimeError()
      const pluginNames = marketplace.data.plugins
        .map((plugin) => plugin.name)
        .sort()
      const pluginContentDigest = await calculatePluginContentDigest({
        pluginSourceRoot: paths.pluginSourceRoot,
        marketplacePath: paths.marketplacePath,
        pluginNames,
      })
      return { ...paths, contentDigest, pluginContentDigest, generation }
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
    reuseVerified?: boolean
    reuseImmutableSnapshot?: boolean
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
      const cacheKey = verifiedPublicationKey(input)
      const capabilityFingerprint = capabilityRuntimeFingerprint(
        input.capabilities,
      )
      // Snapshot IDs are never reused, including after repair. Validate the
      // task binding on every lookup; only immutable file bytes are cached.
      const snapshot = await this.assertAgentsProjection(input.userHome)
      if (snapshot) {
        const paths = this.pathsFor(input.userHome, input.controlRoot)
        await Promise.all([
          this.assertDirectory(input.userHome, 0o770, this.#taskIdentity),
          this.assertDirectory(path.join(input.userHome, ".codex"), 0o770, this.#taskIdentity),
          this.assertDirectory(paths.capabilityControl, 0o700, this.#apiIdentity),
        ])
        const markers = await Promise.all([
          "capability-generation", "capability-content-sha256", "capability-source-sha256",
        ].map(async (name) => {
          const target = path.join(paths.capabilityControl, name)
          await this.assertRegularFile(target, 0o600, this.#apiIdentity)
          return this.readControlDigest(target)
        }))
        if (snapshot.manifest.generation !== input.expectedGeneration ||
          markers[0] !== snapshot.manifest.generation || markers[1] !== snapshot.manifest.contentDigest ||
          markers[2] !== snapshot.manifest.sourceDigest) throw new CapabilityRuntimeError()
        const cached = input.reuseImmutableSnapshot ? this.#verifiedSnapshots.get(snapshot.root) : undefined
        if (cached?.capabilityFingerprint === capabilityFingerprint && cached.contentDigest === snapshot.manifest.contentDigest) {
          return { ...paths, contentDigest: cached.contentDigest, pluginContentDigest: cached.pluginContentDigest, generation: input.expectedGeneration }
        }
      }
      const verified = input.reuseVerified
        && !snapshot
        ? this.#verifiedPublications.get(cacheKey)
        : undefined
      if (
        verified?.capabilityFingerprint === capabilityFingerprint &&
        verified.runtime.generation === input.expectedGeneration
      ) {
        return verified.runtime
      }
      const runtime = await this.resolveLocked(input)
      if (snapshot) {
        if (this.#verifiedSnapshots.size >= 256 && !this.#verifiedSnapshots.has(snapshot.root)) {
          const oldest = this.#verifiedSnapshots.keys().next().value
          if (oldest !== undefined) this.#verifiedSnapshots.delete(oldest)
        }
        this.#verifiedSnapshots.set(snapshot.root, { capabilityFingerprint, contentDigest: runtime.contentDigest, pluginContentDigest: runtime.pluginContentDigest })
      }
      // Verification is an optional speed cache. Bound it independently of
      // how many historical tasks this worker has served.
      if (this.#verifiedPublications.size >= 256 && !this.#verifiedPublications.has(cacheKey)) {
        const oldest = this.#verifiedPublications.keys().next().value
        if (oldest !== undefined) this.#verifiedPublications.delete(oldest)
      }
      this.#verifiedPublications.set(cacheKey, {
        capabilityFingerprint,
        runtime,
      })
      return runtime
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
    this.#onFullVerification?.()
    const paths = this.pathsFor(input.userHome, input.controlRoot)
    await Promise.all([
      this.assertDirectory(
        paths.capabilityControl,
        0o700,
        this.#apiIdentity,
      ),
      this.assertDirectory(input.userHome, 0o770, this.#taskIdentity),
      this.assertAgentsProjection(input.userHome),
      this.assertDirectory(
        path.join(input.userHome, ".agents", "current", "plugins"),
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

    const { contentDigest: actualContentDigest, pluginContentDigest } =
      await calculateContentDigests({
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
      pluginContentDigest,
      generation,
    }
  }

  private async assertExactSkillSources(
    skillsRoot: string,
    authorizedSkillNames: ReadonlySet<string>,
  ): Promise<void> {
    const expected = [
      ...this.#enabledBuiltInSkillNames,
      ...authorizedSkillNames,
    ].sort()
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
      this.assertAccessDomain(info, 0o750, this.#apiIdentity)
      for (const entry of (await readdir(target)).sort()) {
        await this.assertCapabilityTree(path.join(target, entry))
      }
      return
    }
    if (!info.isFile()) throw new CapabilityRuntimeError()
    this.assertAccessDomain(
      info,
      info.mode & 0o111 ? 0o750 : 0o640,
      this.#apiIdentity,
    )
  }

  private async assertAgentsProjection(userHome: string): Promise<{ root: string; manifest: CapabilitySnapshot } | null> {
    const agents = path.join(userHome, ".agents")
    const agentsInfo = await lstat(agents)
    if (agentsInfo.isSymbolicLink()) {
      const expected = path.join(path.dirname(userHome), "managed", "agents")
      if (path.resolve(userHome, await readlink(agents)) !== expected) throw new CapabilityRuntimeError()
      await this.assertDirectory(expected, 0o750, this.#apiIdentity)
    } else await this.assertDirectory(agents, 0o750, this.#apiIdentity)
    const projection = path.join(agents, "current")
    const current = await lstat(projection)
    if (!current.isSymbolicLink()) throw new CapabilityRuntimeError()
    const target = await readlink(projection)
    const id = path.basename(target)
    if (!capabilitySnapshotIdSchema.safeParse(id).success || target !== `${capabilitySnapshotDirectory}/${id}`) throw new CapabilityRuntimeError()
    const snapshotParent = path.join(agents, capabilitySnapshotDirectory)
    const root = path.join(snapshotParent, id)
    await Promise.all([
      this.assertDirectory(snapshotParent, 0o750, this.#apiIdentity),
      this.assertDirectory(root, 0o750, this.#apiIdentity),
      this.assertRegularFile(path.join(root, capabilitySnapshotManifest), 0o640, this.#apiIdentity),
    ])
    if ((await lstat(path.join(root, capabilitySnapshotManifest))).size > 64 * 1024) throw new CapabilityRuntimeError()
    const manifest = capabilitySnapshotSchema.parse(JSON.parse(await readFile(path.join(root, capabilitySnapshotManifest), "utf8")))
    if (manifest.id !== id) throw new CapabilityRuntimeError()
    return { root, manifest }
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
    this.assertAccessDomain(info, mode, identity)
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
    this.assertAccessDomain(info, mode, identity)
  }

  private assertAccessDomain(
    info: Stats,
    mode: number,
    identity: RuntimeIdentity,
  ): void {
    // Numeric UIDs are not portable across Linux bind mounts and Docker
    // Desktop's virtual filesystem. The shared GID and exact modes define
    // the access domain; symlink, path and content checks above preserve the
    // trust boundary without rejecting a valid host-side UID projection.
    if (info.gid !== identity.gid || (info.mode & 0o7777) !== mode) {
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

function verifiedPublicationKey(input: {
  userHome: string
  controlRoot: string
}): string {
  return [input.userHome, input.controlRoot].join("\u0000")
}

function capabilityRuntimeFingerprint(
  capabilities: CapabilityRuntimeInput[],
): string {
  return JSON.stringify(
    capabilities
      .map((capability) => ({
        id: capability.id,
        name: capability.name,
        type: capability.type,
        revision: capability.revision,
        credentialEnvironment: Object.fromEntries(
          Object.entries(capability.credentialEnvironment ?? {}).sort(
            ([left], [right]) => left.localeCompare(right, "en-US"),
          ),
        ),
      }))
      .sort(
        (left, right) =>
          left.type.localeCompare(right.type, "en-US") ||
          left.id.localeCompare(right.id, "en-US") ||
          left.name.localeCompare(right.name, "en-US"),
      ),
  )
}

async function calculateContentDigests(input: {
  skillsRoot: string
  pluginSourceRoot: string
  marketplacePath: string
  pluginNames: string[]
}): Promise<{ contentDigest: string; pluginContentDigest: string }> {
  const contentHash = createHash("sha256")
  const pluginHash = createHash("sha256")
  contentHash.update("linksense-capability-content\n")
  pluginHash.update("linksense-native-plugin-content\n")
  await hashTree(input.skillsRoot, "skills", [contentHash])
  const pluginRoot = await lstat(input.pluginSourceRoot)
  if (!pluginRoot.isDirectory() || pluginRoot.isSymbolicLink()) {
    throw new CapabilityRuntimeError()
  }
  for (const hash of [contentHash, pluginHash]) {
    hash.update("directory\0plugins\0")
  }
  for (const pluginName of [...input.pluginNames].sort()) {
    await hashTree(
      path.join(input.pluginSourceRoot, pluginName),
      `plugins/${pluginName}`,
      [contentHash, pluginHash],
    )
  }
  await hashTree(input.marketplacePath, "marketplace.json", [
    contentHash,
    pluginHash,
  ])
  return {
    contentDigest: contentHash.digest("hex"),
    pluginContentDigest: pluginHash.digest("hex"),
  }
}

async function calculatePluginContentDigest(input: {
  pluginSourceRoot: string
  marketplacePath: string
  pluginNames: string[]
}): Promise<string> {
  const hash = createHash("sha256")
  hash.update("linksense-native-plugin-content\n")
  const pluginRoot = await lstat(input.pluginSourceRoot)
  if (!pluginRoot.isDirectory() || pluginRoot.isSymbolicLink()) {
    throw new CapabilityRuntimeError()
  }
  hash.update("directory\0plugins\0")
  for (const pluginName of [...input.pluginNames].sort()) {
    await hashTree(
      path.join(input.pluginSourceRoot, pluginName),
      `plugins/${pluginName}`,
      [hash],
    )
  }
  await hashTree(input.marketplacePath, "marketplace.json", [hash])
  return hash.digest("hex")
}

async function hashTree(
  currentPath: string,
  relativePath: string,
  hashes: ReturnType<typeof createHash>[],
): Promise<void> {
  const info = await lstat(currentPath)
  if (info.isSymbolicLink()) throw new CapabilityRuntimeError()
  if (info.isFile()) {
    const header = `file\0${relativePath}\0${info.mode & 0o111 ? "x" : "-"}\0`
    const content = await readFile(currentPath)
    for (const hash of hashes) {
      hash.update(header)
      hash.update(content)
      hash.update("\0")
    }
    return
  }
  if (!info.isDirectory()) throw new CapabilityRuntimeError()
  for (const hash of hashes) {
    hash.update(`directory\0${relativePath}\0`)
  }
  for (const entry of (await readdir(currentPath)).sort()) {
    await hashTree(
      path.join(currentPath, entry),
      `${relativePath}/${entry}`,
      hashes,
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
