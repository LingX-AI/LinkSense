import { describe, expect, it } from "vitest"

import {
  launcherOwnerEnv,
  parseLauncherOwnerPid,
  shouldReclaimOwnedGroup,
  type OwnedGroupInput,
} from "../src/desktop/owned-group.js"

const eligible: OwnedGroupInput = {
  platform: "darwin",
  frameAccepted: true,
  pipeLost: true,
  launcherOwnerPid: 100,
  currentPpid: 1,
  groupId: 101,
  groupExists: true,
}

function decide(override: Partial<OwnedGroupInput> = {}) {
  return shouldReclaimOwnedGroup({ ...eligible, ...override })
}

describe("desktop launcher owner marker", () => {
  it("uses the env name supplied by the Go launcher", () => {
    expect(launcherOwnerEnv).toBe("LINKSENSE_DESKTOP_OWNER_PID")
  })

  it.each([
    ["1234", 1234],
    ["99999", 99999],
    [undefined, undefined],
    ["", undefined],
    ["0", undefined],
    ["1", undefined],
    ["01", undefined],
    ["+12", undefined],
    [" 12", undefined],
    ["12 ", undefined],
    ["9999999999", undefined],
  ])("parses only one canonical positive PID from %p", (value, expected) => {
    expect(parseLauncherOwnerPid(value)).toBe(expected)
  })
})

describe("desktop owned group reclaim", () => {
  it("covers the original race where the Go owner is already gone at startup", () => {
    expect(decide({ currentPpid: 1, launcherOwnerPid: 100 })).toBe(true)
  })

  it("keeps the group when the Go owner is still alive", () => {
    expect(decide({ currentPpid: 100 })).toBe(false)
    expect(decide({ currentPpid: 2 })).toBe(false)
  })

  it("requires the private pipe to be closed", () => {
    expect(decide({ pipeLost: false })).toBe(false)
  })

  it("requires the marker, a proven own group, and a parsed frame", () => {
    expect(decide({ launcherOwnerPid: undefined })).toBe(false)
    expect(decide({ groupExists: false })).toBe(false)
    expect(decide({ frameAccepted: false })).toBe(false)
  })

  it("never treats the launcher PID as the group or applies outside macOS", () => {
    expect(decide({ launcherOwnerPid: eligible.groupId })).toBe(false)
    expect(decide({ platform: "linux" })).toBe(false)
  })
})
