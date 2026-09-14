import { describe, expect, it } from "vitest"

import { CapabilityRuntimeManager } from "../src/workspace/capability-runtime.js"

describe("CapabilityRuntimeManager task projection", () => {
  it("derives capability paths from the isolated task home", () => {
    const manager = new CapabilityRuntimeManager()

    expect(
      manager.pathsFor(
        "/srv/linksense/users/owner/home/task-homes/01900000-0000-7000-8000-000000000001",
        "/srv/linksense/users/owner/control/workspaces/01900000-0000-7000-8000-000000000001",
      ),
    ).toEqual({
      skillsRoot:
        "/srv/linksense/users/owner/home/task-homes/01900000-0000-7000-8000-000000000001/.agents/skills",
      pluginSourceRoot:
        "/srv/linksense/users/owner/home/task-homes/01900000-0000-7000-8000-000000000001/.agents/plugin-sources",
      marketplacePath:
        "/srv/linksense/users/owner/home/task-homes/01900000-0000-7000-8000-000000000001/.agents/plugins/marketplace.json",
      capabilityControl:
        "/srv/linksense/users/owner/control/workspaces/01900000-0000-7000-8000-000000000001/capabilities",
    })
  })
})
