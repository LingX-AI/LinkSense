import { describe, expect, it } from "vitest"

import {
  desktopDeviceSettingsHref,
  desktopExecutionTargetPolicy,
} from "./desktop-execution-target"

describe("desktop execution rollout policy", () => {
  it("keeps the cloud entry open when the bootstrap has no policy", () => {
    expect(desktopExecutionTargetPolicy(undefined)).toEqual({
      cloudTarget: true,
    })
    expect(desktopExecutionTargetPolicy({})).toEqual({ cloudTarget: true })
    expect(desktopExecutionTargetPolicy({ desktop: {} })).toEqual({
      cloudTarget: true,
    })
  })

  it("applies an explicitly closed cloud rollout", () => {
    expect(
      desktopExecutionTargetPolicy({ desktop: { cloud_target: false } })
    ).toEqual({ cloudTarget: false })
    expect(
      desktopExecutionTargetPolicy({ desktop: { cloud_target: true } })
    ).toEqual({ cloudTarget: true })
  })
})

describe("desktop device settings link", () => {
  it("points at the local tools settings section", () => {
    expect(desktopDeviceSettingsHref).toBe(
      "/settings/general#desktop-devices-heading"
    )
  })
})
