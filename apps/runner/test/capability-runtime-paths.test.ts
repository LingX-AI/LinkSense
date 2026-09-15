import { describe, expect, it } from "vitest"

import { CapabilityRuntimeManager } from "../src/workspace/capability-runtime.js"

describe("CapabilityRuntimeManager user projection", () => {
  it("derives capability paths from the shared user home", () => {
    const manager = new CapabilityRuntimeManager()

    expect(
      manager.pathsFor(
        "/srv/linksense/users/owner/home",
        "/srv/linksense/users/owner/control",
      ),
    ).toEqual({
      skillsRoot:
        "/srv/linksense/users/owner/home/.agents/current/skills",
      pluginSourceRoot:
        "/srv/linksense/users/owner/home/.agents/current/plugin-sources",
      marketplacePath:
        "/srv/linksense/users/owner/home/.agents/current/plugins/marketplace.json",
      capabilityControl:
        "/srv/linksense/users/owner/control/capabilities",
    })
  })
})
