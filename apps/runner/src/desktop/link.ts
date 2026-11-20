import { randomUUID } from "node:crypto"
import {
  desktopCommandCapacity,
  desktopExecutionCallbackSchema, desktopExecutionLifetimeFor, desktopExecutionMaxInFlight,
  desktopExecutionResultSchema, desktopRuntimeInputSchema, desktopRuntimeOutputSchema,
  desktopToolMaxInFlight, desktopToolLifetimeFor, desktopToolRequestSchema,
  type DesktopExecutionAck, type DesktopExecutionCallback, type DesktopExecutionCommand,
  type DesktopNegotiatedOperation, type DesktopToolOperation, type DesktopToolRequest, type DesktopToolResult,
} from "@linksense/shared"
import type { z } from "zod"
import type { DesktopRuntimeRun, DesktopTurns } from "./turns.js"

type Input = z.infer<typeof desktopRuntimeInputSchema>
type Output = z.infer<typeof desktopRuntimeOutputSchema>
type Waiting = {
  type: DesktopExecutionAck["type"]
  operation: DesktopExecutionCallback["operation"]
  resolve: (ack: DesktopExecutionAck) => void
}
export type DesktopToolInvocation = {
  [Operation in DesktopToolOperation]: Pick<Extract<DesktopToolRequest, { operation: Operation }>, "operation" | "body">
}[DesktopToolOperation]
const maxRecentCommands = 1024

export class DesktopLink {
  private readonly lifetime = new AbortController()
  private readonly commands = new Map<string, AbortController>()
  private readonly recentCommands = new Map<string, number>()
  private readonly callbacks = new Map<string, Waiting>()
  private readonly work = new Set<Promise<void>>()

  constructor(
    readonly id: string,
    private readonly ownerId: string,
    private readonly turns: DesktopTurns,
    private readonly write: (frame: Output) => Promise<void>,
    private readonly fail: () => void,
    private readonly toolOperations: readonly DesktopNegotiatedOperation[] = [],
    private readonly attachments = false,
  ) {}

  /** Aborted when this device link closes; local transfers must not outlive it. */
  get signal(): AbortSignal {
    return this.lifetime.signal
  }

  receive(frame: Extract<Input, { type: "link.frame" }>["frame"]): void {
    if (this.lifetime.signal.aborted) return
    switch (frame.type) {
      case "command":
        this.receiveCommand(frame)
        return
      case "command.cancel":
        this.commands.get(frame.id)?.abort()
        return
      case "execution.ack":
      case "tool.result": {
        const pending = this.callbacks.get(frame.id)
        if (pending?.type === frame.type && pending.operation === frame.operation) pending.resolve(frame)
      }
    }
  }

  private receiveCommand(command: DesktopExecutionCommand): void {
    const now = Date.now()
    for (const [id, expiry] of this.recentCommands) {
      if (expiry <= now) this.recentCommands.delete(id)
    }
    if (this.recentCommands.has(command.id) || this.commands.has(command.id)) return
    const failure = (error_code: "FORBIDDEN" | "RUNNER_UNAVAILABLE") => desktopExecutionResultSchema.parse({
      type: "command.result", operation: command.operation, id: command.id, ok: false, error_code,
    })
    const expiry = Date.parse(command.expires_at)
    const remaining = expiry - now
    if (remaining <= 0 || remaining > desktopExecutionLifetimeFor(command)) {
      this.track(this.write({ type: "link.frame", link_id: this.id, frame: failure("RUNNER_UNAVAILABLE") }))
      return
    }
    if (this.recentCommands.size >= maxRecentCommands) {
      // Do not evict unexpired IDs to admit more work on this connection.
      this.lifetime.abort()
      this.fail()
      return
    }
    this.recentCommands.set(command.id, expiry)
    if (command.owner_id !== this.ownerId) {
      this.track(this.write({ type: "link.frame", link_id: this.id, frame: failure("FORBIDDEN") }))
      return
    }
    if (this.commands.size >= desktopCommandCapacity(command.operation, this.attachments)) {
      this.track(this.write({ type: "link.frame", link_id: this.id, frame: failure("RUNNER_UNAVAILABLE") }))
      return
    }
    const controller = new AbortController()
    this.commands.set(command.id, controller)
    const signal = AbortSignal.any([this.lifetime.signal, controller.signal, AbortSignal.timeout(remaining)])
    const execution = this.turns.execute(command, signal, {
      ...(command.operation === "turn.drain" && { deliver: body => this.recover(command, body, signal) }),
      ...(this.attachments && { attachmentsReady: async (start, signal) => {
        const { conversation_id, runtime_generation, turn_id } = start
        const frame = desktopExecutionCallbackSchema.parse({
          conversation_id, runtime_generation, turn_id, id: randomUUID(), start_id: start.id,
          type: "execution.callback", operation: "attachments.ready", run_token: start.body.credentials.run_token,
        })
        const result = await this.sendCallback(frame, signal)
        if (!result.ok || result.operation !== "attachments.ready") throw new Error("desktop attachments were not acknowledged")
      } }),
    })
    this.track(execution.then(async frame => {
      if (!signal.aborted) await this.write({ type: "link.frame", link_id: this.id, frame })
    }).finally(() => { this.commands.delete(command.id) }))
  }

  async callback(
    run: DesktopRuntimeRun,
    operation: Extract<DesktopExecutionCallback, { type: "execution.callback" }>["operation"],
    body?: Extract<DesktopExecutionCallback, { type: "execution.callback"; body: unknown }>["body"],
  ): Promise<DesktopExecutionAck> {
    if (run.scope.owner_id !== this.ownerId) throw new Error("desktop callback unavailable")
    const { conversation_id, runtime_generation, turn_id } = run.scope
    const frame = desktopExecutionCallbackSchema.parse({
      type: "execution.callback", id: randomUUID(), conversation_id, runtime_generation, turn_id, run_token: run.token, operation,
      ...(body !== undefined && { body }),
    })
    return this.sendCallback(frame, this.lifetime.signal)
  }

  async requestTool(run: DesktopRuntimeRun, input: DesktopToolInvocation, signal: AbortSignal): Promise<DesktopToolResult> {
    const id = randomUUID()
    const { operation } = input
    const failure = (error_code: "FORBIDDEN" | "RUNNER_UNAVAILABLE" | "RUNNER_OPERATION_UNCERTAIN"): DesktopToolResult =>
      ({ type: "tool.result", id, operation, ok: false, error_code })
    if (run.scope.owner_id !== this.ownerId) return failure("FORBIDDEN")
    if (!this.toolOperations.includes(operation)) return failure("RUNNER_UNAVAILABLE")
    if (this.callbacks.size >= desktopExecutionMaxInFlight ||
      [...this.callbacks.values()].filter(pending => pending.type === "tool.result").length >= desktopToolMaxInFlight) {
      return failure("RUNNER_UNAVAILABLE")
    }
    const { conversation_id, runtime_generation, turn_id } = run.scope
    const frame = desktopToolRequestSchema.parse({
      ...input, type: "tool.request", id, conversation_id, runtime_generation, turn_id,
      expires_at: new Date(Date.now() + desktopToolLifetimeFor(operation)).toISOString(),
      run_token: run.token,
    })
    const lifetime = AbortSignal.any([this.lifetime.signal, signal])
    lifetime.throwIfAborted()
    try {
      const result = await this.sendCallback(frame, lifetime)
      return result.type === "tool.result" ? result : failure("RUNNER_OPERATION_UNCERTAIN")
    } catch {
      if (!this.lifetime.signal.aborted) {
        this.track(this.write({ type: "link.frame", link_id: this.id, frame: {
          type: "tool.cancel", id: frame.id, operation: frame.operation, conversation_id, runtime_generation, turn_id,
        } }))
      }
      return failure("RUNNER_OPERATION_UNCERTAIN")
    }
  }

  async reportTurnExit(run: DesktopRuntimeRun): Promise<void> {
    if (this.lifetime.signal.aborted) return
    try {
      const ack = await this.callback(run, "turn.exited")
      if (!ack.ok || ack.operation !== "turn.exited") throw new Error("desktop turn exit was not acknowledged")
    } catch (error) {
      if (!this.lifetime.signal.aborted) throw error
    }
  }

  private recover(
    command: Extract<DesktopExecutionCommand, { operation: "turn.drain" }>,
    body: Extract<DesktopExecutionCallback, { type: "execution.recovery" }>["body"],
    signal: AbortSignal,
  ): Promise<DesktopExecutionAck> {
    const { conversation_id, runtime_generation, turn_id } = command
    return this.sendCallback(desktopExecutionCallbackSchema.parse({
      type: "execution.recovery", id: randomUUID(), drain_id: command.id,
      conversation_id, runtime_generation, turn_id, operation: "events", body,
    }), signal)
  }

  private async sendCallback(frame: DesktopExecutionCallback, lifetime: AbortSignal): Promise<DesktopExecutionAck> {
    const signal = AbortSignal.any([
      lifetime, AbortSignal.timeout(frame.type === "tool.request" ? desktopToolLifetimeFor(frame.operation) + 1_000 : 4_000),
    ])
    signal.throwIfAborted()
    if (this.callbacks.size >= desktopExecutionMaxInFlight) throw new Error("desktop callback unavailable")
    const { id, operation } = frame
    let abort: (() => void) | undefined
    try {
      return await new Promise<DesktopExecutionAck>((resolve, reject) => {
        abort = () => reject(new Error("desktop callback was not acknowledged"))
        this.callbacks.set(id, { type: frame.type === "tool.request" ? "tool.result" : "execution.ack", operation, resolve })
        signal.addEventListener("abort", abort, { once: true })
        void this.write({ type: "link.frame", link_id: this.id, frame }).catch(reject)
      })
    } finally {
      if (abort) signal.removeEventListener("abort", abort)
      this.callbacks.delete(id)
    }
  }

  async close(): Promise<void> {
    this.lifetime.abort()
    await Promise.allSettled(this.work)
    await this.turns.shutdown()
  }

  private track(work: Promise<void>): void {
    const tracked = work.catch(this.fail).finally(() => { this.work.delete(tracked) })
    this.work.add(tracked)
  }
}
