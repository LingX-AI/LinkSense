import { readFile, writeFile, realpath, readdir, rm, symlink } from "node:fs/promises"
import { join } from "node:path"
import { lock } from "proper-lockfile"
import { describe, expect, it, vi } from "vitest"

import { UserHomeCapabilityMaterializer } from "../src/modules/capabilities/user-home-materializer.js"
import {
  OWNER_ID,
  createPluginSource,
  pluginCapability,
  useCapabilityFilesystem,
} from "./user-home-capability-fixture.js"

const { temporaryDirectory } = useCapabilityFilesystem()
const firstTask = "01900000-0000-7000-8000-000000000011"
const secondTask = "01900000-0000-7000-8000-000000000012"

describe("task capability isolation", () => {
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
    expect(second.controlCapabilitiesRoot).not.toBe(first.controlCapabilitiesRoot)
    await secondMaterializer.removeConversation(OWNER_ID, firstTask)
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
    expect(versions).toHaveLength(4) // two referenced + two warm, unreferenced
    await expect(readFile(join(a.pluginsRoot, "calendar-tools", "README.md"), "utf8")).resolves.toBe("v1")
    expect(await realpath(a.managedAgentsRoot)).toBe(original)
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
    await expect(materializer.removeConversation(OWNER_ID, firstTask)).rejects.toThrow()
    expect(await readdir(target)).toContain("skills")
  })

  it("publishes a new task's updated plugin while another task holds its old runtime lease", async () => {
    const root = await temporaryDirectory()
    const source = await createPluginSource(join(root, "sources"), "calendar-tools", "v1")
    const materializer = new UserHomeCapabilityMaterializer({ userDataRoot: join(root, "users") })
    const firstInput = { ownerId: OWNER_ID, conversationId: firstTask, capabilities: [pluginCapability(source)] }
    const first = await materializer.reconcile(firstInput)
    const secondInput = { ...firstInput, conversationId: secondTask }
    const second = await materializer.reconcile(secondInput)
    expect(second.pluginsRoot).not.toBe(first.pluginsRoot)
    expect(second.controlCapabilitiesRoot).not.toBe(first.controlCapabilitiesRoot)
    const release = await lock(first.controlCapabilitiesRoot, {
      realpath: false,
      lockfilePath: join(first.controlCapabilitiesRoot, "reconcile.lock"),
    })
    try {
      await writeFile(join(source, "README.md"), "v2")
      const updated = await materializer.reconcile(secondInput)
      expect(updated.generation).not.toBe(first.generation)
      await expect(readFile(join(first.pluginsRoot, "calendar-tools", "README.md"), "utf8")).resolves.toBe("v1")
      await expect(readFile(join(updated.pluginsRoot, "calendar-tools", "README.md"), "utf8")).resolves.toBe("v2")
    } finally {
      await release()
    }
    const continued = await materializer.reconcile(firstInput)
    await expect(readFile(join(continued.pluginsRoot, "calendar-tools", "README.md"), "utf8")).resolves.toBe("v2")
  }, 20_000)

  it("keeps an ordinary task's plugins when an application task publishes an empty capability set", async () => {
    const root = await temporaryDirectory()
    const source = await createPluginSource(join(root, "sources"), "calendar-tools", "personal")
    const materializer = new UserHomeCapabilityMaterializer({ userDataRoot: join(root, "users") })
    const personal = await materializer.reconcile({ ownerId: OWNER_ID, conversationId: firstTask, capabilities: [pluginCapability(source)] })
    const application = await materializer.reconcile({ ownerId: OWNER_ID, conversationId: secondTask, capabilities: [] })
    expect(application.generationPath).not.toBe(personal.generationPath)
    await expect(readFile(join(personal.pluginsRoot, "calendar-tools", "README.md"), "utf8")).resolves.toBe("personal")
  })
})
