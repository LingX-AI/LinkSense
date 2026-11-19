import { createHash } from "node:crypto"
import { lstat } from "node:fs/promises"
import path from "node:path"
import { setTimeout as delay } from "node:timers/promises"
import type { Logger } from "pino"
import {
  desktopExecutionMaxInFlight,
  desktopExecutionStartReceiptSchema, runnerTurnInterruptResultSchema,
  RUNNER_TURN_INTERRUPT_NOT_ACTIVE, RUNNER_TURN_INTERRUPT_REQUESTED,
  RUNNER_EVENT_BATCH_MAX_COUNT, RUNNER_EVENT_BATCH_TARGET_BYTES,
  type DesktopExecutionAck, type DesktopExecutionCommand, type DesktopExecutionRecovery, type DesktopExecutionResult,
} from "@linksense/shared"
import { z } from "zod"
import type { DesktopWorkerProvider } from "../controller/desktop-worker-provider.js"
import type { WorkerInstance } from "../controller/worker-provider.js"
import { acknowledgedEventCount } from "../event-sink.js"
import type { StartTurnInput } from "../process-pool.js"
import { StartOperationStore, type StartOperationState } from "../start-operation.js"
import { RunnerEventOutboxStore } from "../workspace/event-outbox.js"
import { prepareConversationControl, RuntimeGenerationIntegrityError, WorkspaceManager } from "../workspace/workspace-manager.js"
import { initializeDesktopCapabilities } from "./capabilities.js"
import { desktopModelProviders } from "./model-providers.js"
import { recoverDesktopStart, recoverDesktopTerminal } from "./turn-history.js"

type StartCommand = Extract<DesktopExecutionCommand, { operation: "turn.start" }>
type Scope = Pick<DesktopExecutionCommand, "owner_id" | "conversation_id" | "runtime_generation" | "turn_id">
type Session = { scope: Scope; interrupted: boolean; worker?: WorkerInstance; run?: DesktopRuntimeRun; release?: Promise<void> }
type StartReceipt = ReturnType<typeof desktopExecutionStartReceiptSchema.parse>
type DrainDelivery = (body: DesktopExecutionRecovery["body"]) => Promise<DesktopExecutionAck>
export type DesktopRuntimeRun = { scope: Scope; token: string; expiresAt: number; timer: NodeJS.Timeout }
const emptyMcpGeneration = createHash("sha256").update("").digest("hex")
const healthSchema = z.object({ status: z.literal("available") })

/** Adapt only the negotiated desktop operations to the existing supervised worker. */
export class DesktopTurns {
  private readonly sessions = new Map<string, Session>()
  private readonly seals = new Map<string, Promise<StartReceipt>>()
  private readonly recovering = new Set<string>()
  private closing = false

  constructor(
    private readonly provider: Pick<DesktopWorkerProvider, "pathsFor" | "prepareOwnerFilesystem" | "acquire" | "inspect" | "request" | "release" | "stopWorkers">,
    private readonly runtimeRoot: string,
    private readonly origin: string,
    private readonly workerLost: () => void,
    private readonly logger: Logger,
    private readonly connectionsEnabled = false,
  ) {}

  scopedRun(conversationId: string) {
    const run = this.sessions.get(conversationId)?.run
    return run && run.expiresAt > Date.now() ? run : undefined
  }

  inspectRun(run: DesktopRuntimeRun) {
    return this.readJournal(run.scope, this.scopedRun(run.scope.conversation_id) === run)
  }

  async execute(command: DesktopExecutionCommand, signal: AbortSignal, deliver?: DrainDelivery): Promise<DesktopExecutionResult> {
    const envelope = { type: "command.result", id: command.id, operation: command.operation } as const
    let uncertain = false
    const session = this.sessions.get(command.conversation_id)
    try {
      signal.throwIfAborted()
      if (this.closing) throw new Error("desktop runner is closing")
      if (session && (session.scope.owner_id !== command.owner_id || session.scope.runtime_generation !== command.runtime_generation)) {
        throw new RuntimeGenerationIntegrityError()
      }
      const sameTurn = session?.scope.turn_id === command.turn_id ? session : undefined
      if (command.operation === "turn.start") {
        if (this.recovering.has(command.conversation_id)) throw new Error("desktop recovery is in progress")
        if (session) {
          uncertain = sameTurn !== undefined
          const prior = await this.readJournal(command, sameTurn?.run !== undefined)
          if (prior) return { ...envelope, operation: command.operation, ok: true, result: prior }
          throw new Error("desktop conversation already has an active delivery")
        }
        const result = await this.start(command, signal, () => { uncertain = true })
        return { ...envelope, operation: command.operation, ok: true, result }
      }
      if (command.operation === "turn.inspect") {
        const result = session || this.recovering.has(command.conversation_id)
          ? await this.readJournal(command, sameTurn?.run !== undefined)
          : await this.withRecovery(command.conversation_id, () => this.readJournal(command, false, signal))
        return { ...envelope, operation: command.operation, ok: true, result }
      }
      if (command.operation === "turn.seal") {
        uncertain = true
        // Never interrupt a native start that won the race against recovery.
        if (session || this.recovering.has(command.conversation_id)) throw new Error("desktop start is not yet sealable")
        const result = await this.sealUnstarted(command)
        return { ...envelope, operation: command.operation, ok: true, result }
      }
      if (command.operation === "turn.drain") {
        if (!deliver || session || this.seals.has(command.conversation_id)) throw new Error("desktop outbox is not available")
        uncertain = true
        const terminal = await this.withRecovery(command.conversation_id, () => this.drain(command, signal, deliver))
        return { ...envelope, operation: command.operation, ok: true, result: { drained: true, ...(terminal && { terminal }) } }
      }
      if (!sameTurn?.worker || !sameTurn.run) {
        if (sameTurn) sameTurn.interrupted = true
        if (!sameTurn && session) {
          throw new Error("desktop conversation already has an active delivery")
        }
        uncertain = true
        const result = await this.sealUnstarted(command)
        return {
          ...envelope, operation: command.operation, ok: true,
          result: { code: result.status === "failed" && result.errorCode === "RUNNER_TURN_START_SEALED"
            ? RUNNER_TURN_INTERRUPT_REQUESTED : RUNNER_TURN_INTERRUPT_NOT_ACTIVE },
        }
      }
      uncertain = true
      const result = runnerTurnInterruptResultSchema.parse(await this.request(sameTurn.worker, command,
        `/turns/start/${command.turn_id}/interrupt`, signal, {
          ownerId: command.owner_id, expectedRuntimeGeneration: command.runtime_generation,
        }))
      return { ...envelope, operation: command.operation, ok: true, result }
    } catch {
      return { ...envelope, ok: false, error_code: uncertain || command.operation === "turn.inspect"
        ? "RUNNER_OPERATION_UNCERTAIN" : "RUNNER_UNAVAILABLE" }
    }
  }

  private async drain(scope: Scope, signal: AbortSignal, deliver: DrainDelivery) {
    const { conversation_id: conversationId, runtime_generation: generation, turn_id: turnId } = scope
    const start = await this.readJournal(scope, false, signal)
    if (start?.status !== "succeeded") throw new Error("desktop start is not settled")
    const manager = await this.readGeneration(scope)
    if (!manager) throw new RuntimeGenerationIntegrityError()
    const outbox = new RunnerEventOutboxStore(manager, { generation, turnId })
    let terminalDelivered = false
    let recovered: Awaited<ReturnType<typeof recoverDesktopTerminal>> = null
    for (;;) {
      signal.throwIfAborted()
      const batch = await outbox.peekBatch(conversationId, RUNNER_EVENT_BATCH_MAX_COUNT, RUNNER_EVENT_BATCH_TARGET_BYTES)
      if (!batch.length) {
        if (terminalDelivered) return null
        if (recovered) return recovered.terminal
        recovered = await recoverDesktopTerminal(this.runtimeRoot, manager.pathsFor(conversationId), start.result, signal, this.logger)
        if (!recovered) throw new Error("desktop native terminal outcome is unavailable")
        signal.throwIfAborted()
        if (!recovered.answer) return recovered.terminal
        await outbox.append(conversationId, recovered.answer)
        continue
      }
      const ack = await deliver({ conversationId, events: batch.map(({ deliveryId, event }) => ({ deliveryId, event })) })
      if (!ack.ok || ack.operation !== "events") throw new Error("desktop recovery was not acknowledged")
      const accepted = acknowledgedEventCount(batch, ack.data.accepted_delivery_ids)
      await outbox.removeBatch(batch.slice(0, accepted))
      if (accepted < batch.length) throw new Error("desktop recovery is pending")
      terminalDelivered ||= batch.some(({ event }) => "method" in event &&
        event.method === "turn/completed" && event.params.turn.status !== "inProgress" &&
        event.params.threadId === start.result.codexThreadId && event.params.turn.id === start.result.codexTurnId)
    }
  }

  private async withRecovery<T>(conversationId: string, recover: () => Promise<T>): Promise<T> {
    if (this.recovering.has(conversationId)) throw new Error("desktop recovery is in progress")
    this.recovering.add(conversationId)
    try {
      return await recover()
    } finally {
      this.recovering.delete(conversationId)
    }
  }

  /** Normal completion releases the worker only after its ordered terminal batch was acknowledged. */
  async finish(run: DesktopRuntimeRun): Promise<void> {
    const session = this.sessions.get(run.scope.conversation_id)
    if (session?.run === run) await this.release(session)
  }

  finishAfterAcknowledgement(run: DesktopRuntimeRun, afterExit?: () => Promise<void>): void {
    void this.finish(run).then(afterExit).catch(this.workerLost)
  }

  private release(session: Session): Promise<void> {
    session.release ??= this.releaseOnce(session)
    return session.release
  }

  private async releaseOnce(session: Session): Promise<void> {
    clearTimeout(session.run?.timer)
    const { owner_id, conversation_id, runtime_generation, turn_id } = session.scope
    if (session.worker) await this.provider.release(session.worker)
    if (session.run) {
      const manager = await this.readGeneration(session.scope)
      if (!manager) throw new RuntimeGenerationIntegrityError()
      const store = new StartOperationStore(manager)
      if (!await store.read(conversation_id, turn_id)) {
        await store.createSealed(conversation_id, turn_id, owner_id, runtime_generation)
      }
    }
    if (this.sessions.get(conversation_id) === session) this.sessions.delete(conversation_id)
  }

  async shutdown(): Promise<void> {
    this.closing = true
    for (const session of this.sessions.values()) clearTimeout(session.run?.timer)
    await this.provider.stopWorkers()
    this.sessions.clear()
  }

  private async start(command: StartCommand, signal: AbortSignal, submitted: () => void) {
    const { owner_id, conversation_id, runtime_generation, turn_id } = command
    const expiresAt = Date.parse(command.body.credentials.expires_at)
    if (expiresAt <= Date.now() || this.sessions.size >= desktopExecutionMaxInFlight) {
      throw new Error("desktop run admission unavailable")
    }
    const scope = { owner_id, conversation_id, runtime_generation, turn_id }
    const session: Session = { scope, interrupted: false }
    // Reserve synchronously so stop sees this turn even during the first disk read.
    this.sessions.set(conversation_id, session)
    try {
      await this.seals.get(conversation_id)
      const prior = await this.readJournal(scope, false)
      if (prior) return prior
      signal.throwIfAborted()
      if (session.interrupted) return await this.sealUnstarted(scope)
      if (command.body.native_thread_id && !await this.readGeneration(scope)) throw new RuntimeGenerationIntegrityError()
      const paths = await this.prepareControl(scope)
      if (session.interrupted) return await this.sealUnstarted(scope)
      const capabilityGeneration = await initializeDesktopCapabilities(this.runtimeRoot, paths)
      if (session.interrupted) return await this.sealUnstarted(scope)
      signal.throwIfAborted()
      const startBody = this.startBody(command, capabilityGeneration)
      const worker = await this.startWorker(scope, signal)
      session.worker = worker
      if (session.interrupted) return await this.sealUnstarted(scope)
      signal.throwIfAborted()
      if (expiresAt <= Date.now() || this.closing) throw new Error("desktop run expired before submission")
      const run: DesktopRuntimeRun = {
        scope, token: command.body.credentials.run_token, expiresAt,
        timer: setTimeout(() => { void this.finish(run).catch(this.workerLost) }, expiresAt - Date.now()),
      }
      session.run = run
      submitted()
      let result: StartReceipt
      try {
        result = desktopExecutionStartReceiptSchema.parse(await this.request(worker, command, "/turns/start", signal, startBody))
      } catch (error) {
        try {
          const manager = await this.readGeneration(scope)
          if (!manager) throw new RuntimeGenerationIntegrityError()
          await new StartOperationStore(manager).requestInterrupt(conversation_id, turn_id)
          await this.release(session)
        } catch {
          this.workerLost()
        }
        throw error
      }
      if (result.status === "failed") this.finishAfterAcknowledgement(run)
      return result
    } finally {
      if (!session.run) await this.release(session)
    }
  }

  private async startWorker(scope: Scope, signal: AbortSignal): Promise<WorkerInstance> {
    const { owner_id: ownerId, conversation_id: id, runtime_generation: runtimeGeneration, turn_id: turnId } = scope
    const worker = await this.provider.acquire({
      ownerId, serviceSessionId: id, storageKey: id, name: "desktop", probe: false,
      run: { turnId, runtimeGeneration, ...(this.connectionsEnabled ? { connectionsEnabled: true } : {}) },
    })
    try {
      while (!signal.aborted) {
        const response = await this.request(worker, scope, "/health/ready", signal).catch(() => undefined)
        if (healthSchema.safeParse(response).success) return worker
        if (await this.provider.inspect(worker) !== "running") break
        await delay(100, undefined, { signal })
      }
      throw new Error("desktop worker did not become ready")
    } catch (error) {
      await this.provider.release(worker)
      throw error
    }
  }

  private async readGeneration(command: Scope) {
    const paths = this.provider.pathsFor(command.owner_id, command.conversation_id)
    // The parent can survive workspace eviction; absence is not evidence of an unrun command.
    for (const directory of [paths.root, path.dirname(path.dirname(paths.owner)), path.dirname(paths.owner), paths.owner,
      paths.control, path.join(paths.control, "workspaces"), path.join(paths.control, "workspaces", command.conversation_id)]) {
      const info = await lstat(directory).catch((error: unknown) => {
        if (error instanceof Error && "code" in error && error.code === "ENOENT") return null
        throw error
      })
      if (!info) return null
      if (!info.isDirectory() || info.isSymbolicLink()) throw new RuntimeGenerationIntegrityError()
    }
    const manager = new WorkspaceManager(paths.root, undefined, {
      fixedOwnerId: command.owner_id, fixedHomeRoot: paths.home, fixedControlRoot: paths.control,
    })
    const generation = await manager.readRuntimeGeneration(command.conversation_id, command.runtime_generation)
    return generation === null ? null : manager
  }

  private async readJournal(command: Scope, supervised: boolean, signal?: AbortSignal) {
    const manager = await this.readGeneration(command)
    if (!manager) return null
    const store = new StartOperationStore(manager)
    const state = await store.read(command.conversation_id, command.turn_id)
    if (!state) return null
    if (state.ownerId !== command.owner_id ||
      (state.runtimeGeneration !== undefined && state.runtimeGeneration !== command.runtime_generation)) {
      throw new RuntimeGenerationIntegrityError()
    }
    if (signal && (state.status === "starting" || state.status === "uncertain")) {
      signal.throwIfAborted()
      if (!state.correlation && state.ownerId && state.requestFingerprint) {
        // The durable correlation is written before turn/start can reach app-server.
        return startReceipt(await store.update(state, { status: "failed", errorCode: "RUNNER_TURN_START_FAILED" }), false)
      }
      if (state.correlation) {
        const result = await recoverDesktopStart(this.runtimeRoot, manager.pathsFor(command.conversation_id), state, signal, this.logger)
        signal.throwIfAborted()
        if (result) return startReceipt(await store.update(state, { status: "succeeded", result }), false)
      }
    }
    return startReceipt(state, supervised)
  }

  private async prepareControl(scope: Scope) {
    const paths = this.provider.pathsFor(scope.owner_id, scope.conversation_id)
    await this.provider.prepareOwnerFilesystem(paths)
    await prepareConversationControl(paths, scope.conversation_id, "workspace", undefined, scope.runtime_generation)
    return paths
  }

  private async sealUnstarted(scope: Scope): Promise<StartReceipt> {
    const { owner_id, conversation_id, runtime_generation, turn_id } = scope
    const prior = this.seals.get(conversation_id)
    const pending = (async () => {
      await prior
      let manager = await this.readGeneration(scope)
      if (!manager) {
        await this.prepareControl(scope)
        manager = await this.readGeneration(scope)
        if (!manager) throw new RuntimeGenerationIntegrityError()
      }
      const state = await new StartOperationStore(manager).createSealed(conversation_id, turn_id, owner_id, runtime_generation)
      return state ? startReceipt(state, false) : desktopExecutionStartReceiptSchema.parse(await this.readJournal(scope, false))
    })()
    this.seals.set(conversation_id, pending)
    try {
      return await pending
    } finally {
      if (this.seals.get(conversation_id) === pending) this.seals.delete(conversation_id)
    }
  }

  private startBody(command: StartCommand, capabilityGeneration: string): Omit<StartTurnInput, "conversationId"> {
    return {
      ownerId: command.owner_id, projectionTurnId: command.turn_id, expectedRuntimeGeneration: command.runtime_generation,
      codexThreadId: command.body.native_thread_id, appServerProcessLimit: 1,
      capabilityGeneration, mcpGeneration: emptyMcpGeneration, mcpServers: [],
      collaborationMode: "default", capabilities: [], environment: {},
      context: {
        userInput: command.body.input, attachments: [], priorityPlugins: [], prioritySkills: [],
        ...(command.body.selected_knowledge_bases ? { selectedKnowledgeBases: command.body.selected_knowledge_bases } : {}),
      },
      reasoningEffort: command.body.reasoning_effort,
      ...desktopModelProviders(this.origin, command.body.credentials),
    }
  }

  private async request(worker: WorkerInstance, command: Scope, suffix: string, signal: AbortSignal, body?: unknown): Promise<unknown> {
    if (worker.ownerId !== command.owner_id || worker.serviceSessionId !== command.conversation_id) {
      throw new Error("desktop worker scope mismatch")
    }
    const route = suffix === "/health/ready" ? suffix : `/conversations/${command.conversation_id}${suffix}`
    const response = await this.provider.request(worker, route, signal, body)
    if (!response.ok) {
      await response.body?.cancel()
      throw new Error("desktop worker request failed")
    }
    return response.json()
  }
}

function startReceipt(state: StartOperationState, supervised: boolean) {
  const { conversationId, projectionTurnId, status, createdAt, updatedAt, result, errorCode } = state
  return desktopExecutionStartReceiptSchema.parse({
    conversationId, projectionTurnId, createdAt, updatedAt,
    ...(status === "starting" && !supervised
      ? { status: "uncertain", errorCode: "RUNNER_TURN_START_RESULT_UNCERTAIN" }
      : { status, ...(result && { result }), ...(errorCode && { errorCode }) }),
  })
}
