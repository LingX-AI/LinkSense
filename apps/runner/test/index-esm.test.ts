import path from "node:path"
import { pathToFileURL } from "node:url"

import { describe, expect, it } from "vitest"

import {
  isMainModule,
  resolveOwnerExecutionPaths,
} from "../src/index.js"

const ownerId = "01900000-0000-7000-8000-000000000002"

describe("runner ESM entrypoint", () => {
  it("compares file URLs with the executable path without CommonJS globals", () => {
    const executable = path.resolve("/tmp/linksense runner/index.js")
    expect(isMainModule(pathToFileURL(executable).href, executable)).toBe(true)
    expect(
      isMainModule(pathToFileURL("/tmp/other.js").href, executable),
    ).toBe(false)
    expect(isMainModule(pathToFileURL(executable).href, undefined)).toBe(false)
  })

  it("uses one owner HOME for workspaces, CODEX_HOME, and persistent runtime", () => {
    expect(
      resolveOwnerExecutionPaths(
        {
          LINKSENSE_RUNNER_MODE: "standalone",
          LINKSENSE_USER_DATA_ROOT: "/srv/linksense/users",
        },
        ownerId,
      ),
    ).toEqual({
      home: `/srv/linksense/users/${ownerId}/home`,
      control: `/srv/linksense/users/${ownerId}/control`,
      runtime: `/srv/linksense/users/${ownerId}/home/.local/share/linksense`,
    })

    expect(
      resolveOwnerExecutionPaths(
        {
          LINKSENSE_RUNNER_MODE: "worker",
          LINKSENSE_USER_DATA_ROOT: "/home/linksense",
        },
        ownerId,
      ),
    ).toEqual({
      home: "/home/linksense",
      control: "/run/linksense-control",
      runtime: "/home/linksense/.local/share/linksense",
    })
  })
})
