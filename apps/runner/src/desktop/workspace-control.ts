import type { DesktopRuntimeControlOutput, DesktopWorkspaceControlRequest } from "@linksense/shared"

import {
  desktopWorkspaceBudgetBytes, desktopWorkspaceRetentionDays,
  type DesktopWorkspacePruneResult, type DesktopWorkspaceUsage,
} from "../controller/desktop-worker-provider.js"

export type DesktopWorkspaceControlHost = {
  /** True while a start, recovery or turn owns a workspace. */
  busy: () => boolean
  /**
   * Take cleanup exclusivity synchronously, before the first await, so no new
   * start or recovery can be admitted while the scan and deletion run.
   */
  beginCleanup: () => boolean
  endCleanup: () => void
  usage: (ownerId: string) => Promise<DesktopWorkspaceUsage>
  cleanup: (ownerId: string) => Promise<DesktopWorkspacePruneResult>
}

/** The settings page gets aggregate sizes only; no path or conversation id crosses the pipe. */
export async function handleDesktopWorkspaceControl(
  input: DesktopWorkspaceControlRequest,
  host: DesktopWorkspaceControlHost,
): Promise<DesktopRuntimeControlOutput> {
  if (input.type === "workspace.usage") {
    // Read-only scans run beside turns and links and never take exclusivity.
    try {
      const usage = await host.usage(input.owner_id)
      return {
        type: "workspace.usage.result", request_id: input.request_id, ok: true,
        usage: {
          bytes: usage.bytes, files: usage.files, sessions: usage.sessions,
          retention_days: desktopWorkspaceRetentionDays, budget_bytes: desktopWorkspaceBudgetBytes,
        },
      }
    } catch {
      return {
        type: "workspace.usage.result", request_id: input.request_id, ok: false,
        error_code: "DESKTOP_WORKSPACE_UNAVAILABLE",
      }
    }
  }
  // These two calls run synchronously in the supervisor loop's tick. A busy
  // turn wins and a conflicting cleanup loses with the existing busy result.
  if (host.busy() || !host.beginCleanup()) {
    return {
      type: "workspace.cleanup.result", request_id: input.request_id, ok: true,
      cleanup: { status: "busy", deleted_sessions: 0, freed_bytes: 0, retained_bytes: 0 },
    }
  }
  try {
    const result = await host.cleanup(input.owner_id)
    return {
      type: "workspace.cleanup.result", request_id: input.request_id, ok: true,
      cleanup: {
        status: "completed", deleted_sessions: result.deleted,
        freed_bytes: result.freedBytes, retained_bytes: result.retainedBytes,
      },
    }
  } catch {
    return {
      type: "workspace.cleanup.result", request_id: input.request_id, ok: false,
      error_code: "DESKTOP_WORKSPACE_CLEANUP_FAILED",
    }
  } finally {
    host.endCleanup()
  }
}
