import { readFile, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { lock } from "proper-lockfile"
import { describe, expect, it } from "vitest"

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
