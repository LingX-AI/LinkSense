import { describe, expect, it, vi } from "vitest"

import { desktopRuntimeControlOutputSchema } from "@linksense/shared"

import { handleDesktopWorkspaceControl, type DesktopWorkspaceControlHost } from "../src/desktop/workspace-control.js"
import { deferred } from "./deferred.js"

const ownerId = "10000000-0000-4000-8000-000000000001"
const requestId = "10000000-0000-4000-8000-000000000002"
const usageInput = { type: "workspace.usage", request_id: requestId, owner_id: ownerId } as const
const cleanupInput = { type: "workspace.cleanup", request_id: requestId, owner_id: ownerId } as const

function host(overrides: Partial<DesktopWorkspaceControlHost> = {}): DesktopWorkspaceControlHost {
  return {
    busy: () => false,
    beginCleanup: vi.fn(() => true),
    endCleanup: vi.fn(),
    usage: vi.fn(async () => ({ bytes: 2048, files: 4, sessions: 1 })),
    cleanup: vi.fn(async () => ({ deleted: 2, freedBytes: 4096, retainedBytes: 1024 })),
    ...overrides,
  }
}

describe("desktop workspace control", () => {
  it("reports scoped usage with the existing retention policy", async () => {
    const result = await handleDesktopWorkspaceControl(usageInput, host())
    expect(desktopRuntimeControlOutputSchema.parse(result)).toEqual({
      type: "workspace.usage.result", request_id: requestId, ok: true,
      usage: { bytes: 2048, files: 4, sessions: 1, retention_days: 14, budget_bytes: 10 * 1024 * 1024 * 1024 },
    })
  })

  it("does not take cleanup exclusivity for a usage read", async () => {
    const control = host()
    await handleDesktopWorkspaceControl(usageInput, control)
    expect(control.beginCleanup).not.toHaveBeenCalled()
  })

  it("never cleans while a start, recovery or turn owns a workspace", async () => {
    const control = host({ busy: () => true })
    const result = await handleDesktopWorkspaceControl(cleanupInput, control)
    expect(result).toEqual({
      type: "workspace.cleanup.result", request_id: requestId, ok: true,
      cleanup: { status: "busy", deleted_sessions: 0, freed_bytes: 0, retained_bytes: 0 },
    })
    expect(control.cleanup).not.toHaveBeenCalled()
    expect(control.beginCleanup).not.toHaveBeenCalled()
  })

  it("returns busy when another cleanup already holds exclusivity", async () => {
    const control = host({ beginCleanup: () => false })
    const result = await handleDesktopWorkspaceControl(cleanupInput, control)
    expect(result).toMatchObject({ type: "workspace.cleanup.result", ok: true, cleanup: { status: "busy" } })
    expect(control.cleanup).not.toHaveBeenCalled()
  })

  it("takes exclusivity before scanning and releases it when the scan ends", async () => {
    const finished = deferred<{ deleted: number; freedBytes: number; retainedBytes: number }>()
    const events: string[] = []
    const control = host({
      beginCleanup: vi.fn(() => { events.push("begin"); return true }),
      endCleanup: vi.fn(() => { events.push("end") }),
      cleanup: vi.fn(() => { events.push("scan"); return finished.promise }),
    })
    const result = handleDesktopWorkspaceControl(cleanupInput, control)
    // The handler synchronously acquired exclusivity before starting the scan.
    expect(events).toEqual(["begin", "scan"])
    finished.resolve({ deleted: 1, freedBytes: 512, retainedBytes: 0 })
    expect(await result).toMatchObject({
      type: "workspace.cleanup.result", ok: true,
      cleanup: { status: "completed", deleted_sessions: 1, freed_bytes: 512 },
    })
    expect(events).toEqual(["begin", "scan", "end"])
  })

  it("reports a completed scoped cleanup", async () => {
    const result = await handleDesktopWorkspaceControl(cleanupInput, host())
    expect(result).toEqual({
      type: "workspace.cleanup.result", request_id: requestId, ok: true,
      cleanup: { status: "completed", deleted_sessions: 2, freed_bytes: 4096, retained_bytes: 1024 },
    })
  })

  it("maps usage and cleanup failures to stable bridge errors", async () => {
    expect(await handleDesktopWorkspaceControl(usageInput, host({
      usage: vi.fn(async () => { throw new Error("runtime stopped") }),
    }))).toEqual({
      type: "workspace.usage.result", request_id: requestId, ok: false,
      error_code: "DESKTOP_WORKSPACE_UNAVAILABLE",
    })
    const control = host({ cleanup: vi.fn(async () => { throw new Error("permission denied") }) })
    expect(await handleDesktopWorkspaceControl(cleanupInput, control)).toEqual({
      type: "workspace.cleanup.result", request_id: requestId, ok: false,
      error_code: "DESKTOP_WORKSPACE_CLEANUP_FAILED",
    })
    expect(control.endCleanup).toHaveBeenCalledOnce()
  })
})
