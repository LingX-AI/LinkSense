import { readFile, writeFile, realpath, readdir, rm, symlink } from "node:fs/promises"
import { join } from "node:path"
import { lock } from "proper-lockfile"
import { describe, expect, it, vi } from "vitest"

import { UserHomeCapabilityMaterializer, UserHomeCapabilityPublicationDeferredError } from "../src/modules/capabilities/user-home-materializer.js"
import {
  OWNER_ID,
  CREDENTIAL_SOURCE,
  SECOND_CREDENTIAL_SOURCE,
  createPluginSource,
  pluginCapability,
  useCapabilityFilesystem,
} from "./user-home-capability-fixture.js"

const { temporaryDirectory } = useCapabilityFilesystem()
const firstTask = "01900000-0000-7000-8000-000000000011"
const secondTask = "01900000-0000-7000-8000-000000000012"

describe("published service capability storage", () => {
  it("keeps personal credentials and two service sessions in independent publications", async () => {
    const root = await temporaryDirectory()
    const source = await createPluginSource(join(root, "sources"), "calendar-tools", "shared definition")
    const materializer = new UserHomeCapabilityMaterializer({ userDataRoot: join(root, "users") })
    const personal = await materializer.reconcile({ ownerId: OWNER_ID, conversationId: firstTask, capabilities: [pluginCapability(source, { API_KEY: CREDENTIAL_SOURCE })] })
    const service = await materializer.reconcile({ ownerId: OWNER_ID, conversationId: firstTask, serviceSessionId: firstTask, capabilities: [pluginCapability(source, { API_KEY: SECOND_CREDENTIAL_SOURCE })] })
    const visitor = await materializer.reconcile({ ownerId: OWNER_ID, conversationId: secondTask, serviceSessionId: secondTask, capabilities: [] })
    expect(service.ownerRoot).toBe(join(root, "users", OWNER_ID, "services", firstTask))
    expect(new Set([personal.controlCapabilitiesRoot, service.controlCapabilitiesRoot, visitor.controlCapabilitiesRoot]).size).toBe(3)
    expect(personal.generation).not.toBe(service.generation)
    const personalManifest = await readFile(join(personal.pluginsRoot, "calendar-tools", ".codex-plugin", "plugin.json"), "utf8")
    const serviceManifest = await readFile(join(service.pluginsRoot, "calendar-tools", ".codex-plugin", "plugin.json"), "utf8")
    expect(personalManifest).toContain(CREDENTIAL_SOURCE)
    expect(personalManifest).not.toContain(SECOND_CREDENTIAL_SOURCE)
    expect(serviceManifest).toContain(SECOND_CREDENTIAL_SOURCE)
    expect(serviceManifest).not.toContain(CREDENTIAL_SOURCE)
    expect(await realpath(service.managedAgentsRoot)).not.toBe(await realpath(personal.managedAgentsRoot))
    expect(await readdir(visitor.pluginsRoot)).not.toContain("calendar-tools")
  }, 30_000)
})
describe("shared user capability installation", () => {
  it("reuses immutable capability files across cold tasks and API instances without staging them again", async () => {
    const root = await temporaryDirectory()
    const source = await createPluginSource(join(root, "sources"), "calendar-tools", "shared")
    const onStage = vi.fn()
    const options = { userDataRoot: join(root, "users"), instrumentation: { onStage } }
    const first = await new UserHomeCapabilityMaterializer(options).reconcile({ ownerId: OWNER_ID, conversationId: firstTask, capabilities: [pluginCapability(source)] })
    const secondMaterializer = new UserHomeCapabilityMaterializer(options)
    const secondInput = { ownerId: OWNER_ID, conversationId: secondTask, capabilities: [pluginCapability(source)] }
    const second = await secondMaterializer.withPublicationStartFence(secondInput, () => secondMaterializer.resolvePublishedRuntimeWithinPublicationStartFence(secondInput))
    expect(onStage).toHaveBeenCalledTimes(1)
    expect(await realpath(second.managedAgentsRoot)).toBe(await realpath(first.managedAgentsRoot))
    expect(second.controlCapabilitiesRoot).toBe(first.controlCapabilitiesRoot)
    expect(second.managedAgentsRoot).toBe(first.managedAgentsRoot)
    await expect(readFile(join(second.pluginsRoot, "calendar-tools", "README.md"), "utf8")).resolves.toBe("shared")
  })

  it("builds one snapshot for simultaneous cold tasks and bounds unreferenced versions", async () => {
    const root = await temporaryDirectory()
    const source = await createPluginSource(join(root, "sources"), "calendar-tools", "v1")
    const onStage = vi.fn()
    const options = { userDataRoot: join(root, "users"), instrumentation: { onStage } }
    const publish = async (task: string, revision: string) => {
      const materializer = new UserHomeCapabilityMaterializer(options)
      const input = { ownerId: OWNER_ID, conversationId: task, capabilities: [{ ...pluginCapability(source), revision }] }
      return materializer.withPublicationStartFence(input, () => materializer.resolvePublishedRuntimeWithinPublicationStartFence(input))
    }
    const [a, b] = await Promise.all([publish(firstTask, "one"), publish(secondTask, "one")])
    expect(onStage).toHaveBeenCalledTimes(1)
    const original = await realpath(a.managedAgentsRoot)
    expect(await realpath(b.managedAgentsRoot)).toBe(original)
    for (let i = 2; i <= 6; i++) {
      await writeFile(join(source, "README.md"), `v${i}`)
      await publish(secondTask, String(i))
    }
    const versions = await readdir(join(a.ownerRoot, "managed", "agents", "snapshots"))
    expect(versions).toHaveLength(3) // one current + two bounded warm versions
    await expect(readFile(join(a.pluginsRoot, "calendar-tools", "README.md"), "utf8")).resolves.toBe("v6")
    expect(await realpath(a.managedAgentsRoot)).not.toBe(original)
    await expect(readFile(join(b.pluginsRoot, "calendar-tools", "README.md"), "utf8")).resolves.toBe("v6")
  }, 20_000)

  it("rejects an escaped task binding instead of reusing or deleting its target", async () => {
    const root = await temporaryDirectory()
    const materializer = new UserHomeCapabilityMaterializer({ userDataRoot: join(root, "users") })
    const input = { ownerId: OWNER_ID, conversationId: firstTask, capabilities: [] }
    const initial = await materializer.reconcile(input)
    const target = await realpath(initial.managedAgentsRoot)
    await rm(initial.managedAgentsRoot)
    await symlink(target, initial.managedAgentsRoot) // even an absolute in-root link is not the contract
    await expect(materializer.reconcile(input)).rejects.toThrow()
    expect(await readdir(target)).toContain("skills")
  })

  it("defers a shared installation update until another task releases its active runtime lease", async () => {
    const root = await temporaryDirectory()
    const source = await createPluginSource(join(root, "sources"), "calendar-tools", "v1")
    const publicationGuard = vi.fn(async () => true)
    const materializer = new UserHomeCapabilityMaterializer({ userDataRoot: join(root, "users"), publicationGuard })
    const firstInput = { ownerId: OWNER_ID, conversationId: firstTask, capabilities: [pluginCapability(source)] }
    const first = await materializer.reconcile(firstInput)
    const secondInput = { ...firstInput, conversationId: secondTask }
    const second = await materializer.reconcile(secondInput)
    expect(second.pluginsRoot).toBe(first.pluginsRoot)
    expect(second.controlCapabilitiesRoot).toBe(first.controlCapabilitiesRoot)
    const release = await lock(first.controlCapabilitiesRoot, {
      realpath: false,
      lockfilePath: join(first.controlCapabilitiesRoot, "reconcile.lock"),
    })
    try {
      await writeFile(join(source, "README.md"), "v2")
      publicationGuard.mockResolvedValue(false)
      await expect(materializer.reconcile(secondInput)).rejects.toBeInstanceOf(UserHomeCapabilityPublicationDeferredError)
      await expect(readFile(join(first.pluginsRoot, "calendar-tools", "README.md"), "utf8")).resolves.toBe("v1")
    } finally {
      await release()
    }
    publicationGuard.mockResolvedValue(true)
    const continued = await materializer.reconcile(firstInput)
    await expect(readFile(join(continued.pluginsRoot, "calendar-tools", "README.md"), "utf8")).resolves.toBe("v2")
  }, 20_000)

  it("keeps a personal installation separate from an application service execution user", async () => {
    const root = await temporaryDirectory()
    const source = await createPluginSource(join(root, "sources"), "calendar-tools", "personal")
    const materializer = new UserHomeCapabilityMaterializer({ userDataRoot: join(root, "users") })
    const personal = await materializer.reconcile({ ownerId: OWNER_ID, conversationId: firstTask, capabilities: [pluginCapability(source)] })
    const application = await materializer.reconcile({ ownerId: "01900000-0000-7000-8000-000000000022", conversationId: secondTask, capabilities: [] })
    expect(application.generationPath).not.toBe(personal.generationPath)
    await expect(readFile(join(personal.pluginsRoot, "calendar-tools", "README.md"), "utf8")).resolves.toBe("personal")
  })
})
