import { cp, mkdir, mkdtemp, realpath, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { randomUUID } from "node:crypto"

import { UserHomeCapabilityMaterializer } from "../modules/capabilities/user-home-materializer.js"

const destination = process.argv[2]
if (!destination || !path.isAbsolute(destination)) throw new Error("desktop capability bundle path is required")
const root = await mkdtemp(path.join(tmpdir(), "linksense-desktop-capabilities-"))
try {
  const publication = await new UserHomeCapabilityMaterializer({
    userDataRoot: root, managedBrowserEnabled: false,
  }).reconcile({ ownerId: randomUUID(), conversationId: randomUUID(), capabilities: [] })
  const snapshot = await realpath(publication.managedAgentsRoot)
  await mkdir(destination)
  await cp(snapshot, destination, { recursive: true })
} finally {
  await rm(root, { recursive: true, force: true })
}
