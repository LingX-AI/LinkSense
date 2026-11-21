import type { Logger } from "pino"
import {
  desktopRuntimeControlInputSchema, desktopRuntimeControlOutputSchema, desktopRuntimeInputSchema,
  desktopRuntimeOutputSchema,
  type DesktopRuntimeControlInput, type DesktopRuntimeControlOutput,
} from "@linksense/shared"

import type { DesktopWorkerProvider } from "../controller/desktop-worker-provider.js"
import { DesktopLink } from "./link.js"
import { DesktopTurns } from "./turns.js"
import { handleDesktopWorkspaceControl } from "./workspace-control.js"

// One settings page may read twice and clean once at a time. The native host
// already bounds its own pending requests; this bound protects the runner.
const maxUsageControls = 2

export type DesktopSupervisorOptions = {
  provider: DesktopWorkerProvider
  runtimeRoot: string
  origin: string | undefined
  logger: Logger
  write: (value: unknown) => Promise<void>
  fail: () => void
}

type Current = { link: DesktopLink; turns: DesktopTurns }

/**
 * Owns the private supervisor pipe. Link frames are handled inline; workspace
 * statistics and cleanup are started without awaiting them, so a slow scan
 * never delays an acknowledgement, cancellation, response, or link close.
 */
export class DesktopSupervisor {
  private current: Current | undefined
  private usageControls = 0
  private cleanupControl: Promise<void> | undefined
  private cleanupRequestId: string | undefined
  private cleanupAbort: AbortController | undefined
  private updateRequestId: string | undefined
  private stopping = false

  constructor(private readonly options: DesktopSupervisorOptions) {}

  /** The live link and turn actors, consumed by the worker callback bridge. */
  currentForCallbacks(): Current | undefined {
    return this.current
  }

  async run(input: AsyncIterable<unknown>): Promise<void> {
    try {
      for await (const value of input) {
        const control = desktopRuntimeControlInputSchema.safeParse(value)
        if (control.success) {
          this.receiveControl(control.data)
          continue
        }
        const message = desktopRuntimeInputSchema.parse(value)
        const origin = this.options.origin
        if (message.type === "link.open") {
          if (this.current || !origin) throw new Error("desktop link is not available")
          const operations = message.tool_operations ??
            (message.tools_version !== undefined ? ["web.search" as const] : [])
          const turns = new DesktopTurns(
            this.options.provider, this.options.runtimeRoot, origin, this.options.fail,
            this.options.logger, operations,
          )
          this.current = {
            turns,
            link: new DesktopLink(
              message.link_id, message.owner_id, turns,
              frame => this.options.write(desktopRuntimeOutputSchema.parse(frame)),
              this.options.fail, operations, message.attachment_version !== undefined,
            ),
          }
        } else if (this.current?.link.id === message.link_id) {
          if (message.type === "link.close") {
            const state = this.current
            this.current = undefined
            await state.link.close()
          } else {
            this.current.link.receive(message.frame)
          }
        }
      }
    } finally {
      await this.stop()
    }
  }

  private receiveControl(input: DesktopRuntimeControlInput): void {
    if (input.type === "workspace.cancel") {
      // Only the cleanup that currently holds exclusivity can be cancelled.
      // A late or mismatched id is ignored so a retry never stops its successor.
      if (this.cleanupAbort !== undefined && this.cleanupRequestId === input.request_id) {
        this.cleanupAbort.abort()
      }
      return
    }
    if (input.type === "update.acquire") {
      this.acquireUpdateAdmission(input.request_id)
      return
    }
    if (input.type === "update.release") {
      this.releaseUpdateAdmission(input.request_id)
      return
    }
    const failure = (): DesktopRuntimeControlOutput => input.type === "workspace.usage"
      ? {
          type: "workspace.usage.result", request_id: input.request_id, ok: false,
          error_code: "DESKTOP_WORKSPACE_UNAVAILABLE",
        }
      : {
          type: "workspace.cleanup.result", request_id: input.request_id, ok: false,
          error_code: "DESKTOP_WORKSPACE_CLEANUP_FAILED",
        }
    const busy = (): DesktopRuntimeControlOutput => ({
      type: "workspace.cleanup.result", request_id: input.request_id, ok: true,
      cleanup: { status: "busy", deleted_sessions: 0, freed_bytes: 0, retained_bytes: 0 },
    })
    if (input.type === "workspace.cleanup" && (this.stopping || this.cleanupControl !== undefined)) {
      // A retry while the first scan is still running must not start a second.
      void this.options.write(busy()).catch(() => {
        if (!this.stopping) this.options.fail()
      })
      return
    }
    if (input.type === "workspace.usage" && (this.stopping || this.usageControls >= maxUsageControls)) {
      void this.options.write(failure()).catch(() => {
        if (!this.stopping) this.options.fail()
      })
      return
    }
    if (input.type === "workspace.usage") this.usageControls++
    const abort = input.type === "workspace.cleanup" ? new AbortController() : undefined
    const host = {
      busy: () => this.current?.turns.isBusy() ?? false,
      beginCleanup: () => this.options.provider.beginMaintenance(),
      endCleanup: () => this.options.provider.endMaintenance(),
      usage: (ownerId: string) => this.options.provider.workspaceUsage(ownerId),
      cleanup: (ownerId: string) => this.options.provider.pruneWorkspaces(Date.now(), {
        ownerId, ...(abort ? { signal: abort.signal } : {}),
      }),
    }
    if (input.type === "workspace.cleanup") {
      // Register the cancel target before the synchronous admission below, so
      // a cancel frame read immediately afterwards stops this exact scan.
      this.cleanupRequestId = input.request_id
      this.cleanupAbort = abort
    }
    // Invoking the handler acquires cleanup exclusivity synchronously, before
    // the first await and before any later link frame is read.
    const task = handleDesktopWorkspaceControl(input, host)
      .then(output => desktopRuntimeControlOutputSchema.parse(output))
      .then(output => this.options.write(output))
      .catch(() => {
        if (!this.stopping) this.options.fail()
      })
      .finally(() => {
        if (input.type === "workspace.usage") this.usageControls--
        else if (this.cleanupControl === task) {
          this.cleanupControl = undefined
          this.cleanupRequestId = undefined
          this.cleanupAbort = undefined
        }
      })
    if (input.type === "workspace.cleanup") this.cleanupControl = task
  }

  /**
   * Take update admission in the same synchronous tick as a link frame. A
   * start, recovery, release or cleanup that already reached this tick wins;
   * once taken, provider maintenance blocks every later admission path before
   * it can create a worker or touch a workspace. Stop and seal keep their
   * existing idempotent journal bookkeeping and cannot start a worker.
   * Ownership is bound to the request id so a stale release cannot open
   * another holder's gate.
   */
  private acquireUpdateAdmission(requestId: string): void {
    if (this.stopping) {
      this.writeControl({
        type: "update.acquire.result", request_id: requestId, ok: false,
        error_code: "DESKTOP_RUNTIME_UNAVAILABLE",
      })
      return
    }
    if (this.updateRequestId !== undefined || (this.current?.turns.isBusy() ?? false) ||
        !this.options.provider.beginMaintenance()) {
      this.writeControl({
        type: "update.acquire.result", request_id: requestId, ok: false, error_code: "DESKTOP_UPDATE_BUSY",
      })
      return
    }
    this.updateRequestId = requestId
    this.writeControl({ type: "update.acquire.result", request_id: requestId, ok: true })
  }

  private releaseUpdateAdmission(requestId: string): void {
    if (this.updateRequestId !== requestId) return
    this.updateRequestId = undefined
    this.options.provider.endMaintenance()
  }

  private writeControl(output: DesktopRuntimeControlOutput): void {
    void this.options.write(desktopRuntimeControlOutputSchema.parse(output)).catch(() => {
      if (!this.stopping) this.options.fail()
    })
  }

  private async stop(): Promise<void> {
    this.stopping = true
    // Mark closing before the link unwinds: an active scan stops between
    // sessions, but workers keep their ordinary link-first shutdown order.
    this.options.provider.beginShutdown()
    // A cleanup that still holds exclusivity must stop deleting before the
    // provider shuts down; its handler releases exclusivity when it settles.
    this.cleanupAbort?.abort()
    await this.current?.link.close().catch(() => undefined)
    this.current = undefined
    await this.options.provider.shutdown().catch(() => undefined)
    await this.cleanupControl?.catch(() => undefined)
    // Read-only usage scans cannot mutate workspace data and are not awaited.
  }
}
