import { randomUUID } from "node:crypto"
import { link, mkdir, open, readFile, rename, rm } from "node:fs/promises"
import { join } from "node:path"

import { z } from "zod"

import type { ThreadGoal } from "./codex/protocol.js"
import type { WorkspaceManager } from "./workspace/workspace-manager.js"

const uuid = z.uuid()
const persistedThreadGoalSchema = z.strictObject({
  thread_id: z.string().min(1),
  objective: z.string().trim().min(1).max(4_000),
  status: z.enum([
    "active",
    "paused",
    "blocked",
    "usageLimited",
    "budgetLimited",
    "complete",
  ]),
  token_budget: z.number().int().nonnegative().nullable(),
  tokens_used: z.number().int().nonnegative(),
  time_used_seconds: z.number().int().nonnegative(),
  created_at: z.number().int().nonnegative(),
  updated_at: z.number().int().nonnegative(),
})
const persistedStartOperationSchema = z.strictObject({
  conversation_id: uuid,
  projection_turn_id: uuid,
  status: z.enum(["starting", "succeeded", "failed", "uncertain"]),
  created_at: z.iso.datetime(),
  updated_at: z.iso.datetime(),
  result: z
    .strictObject({
      codex_thread_id: z.string().min(1),
      codex_turn_id: z.string().min(1),
      goal: persistedThreadGoalSchema.optional(),
    })
    .optional(),
  error_code: z
    .enum([
      "RUNNER_TURN_START_FAILED",
      "RUNNER_TURN_START_RESULT_UNCERTAIN",
      "RUNNER_TURN_START_SEALED",
    ])
    .optional(),
  owner_id: uuid.optional(),
  runtime_generation: uuid.optional(),
  request_fingerprint: z.string().regex(/^[0-9a-f]{64}$/u).optional(),
  correlation: z
    .strictObject({
      codex_thread_id: z.string().min(1),
      baseline_turn_ids: z.array(z.string().min(1)),
      prepared_at: z.iso.datetime(),
      operation_kind: z.enum(["turn", "goal", "compact"]).optional(),
    })
    .optional(),
})

type PersistedStartOperation = z.infer<typeof persistedStartOperationSchema>

export type StartOperationResult = {
  codexThreadId: string
  codexTurnId: string
  goal?: ThreadGoal
}

export type StartOperationCorrelation = {
  codexThreadId: string
  baselineTurnIds: string[]
  preparedAt: string
  operationKind?: "turn" | "goal" | "compact"
}

export type StartOperationState = {
  conversationId: string
  projectionTurnId: string
  status: "starting" | "succeeded" | "failed" | "uncertain"
  createdAt: string
  updatedAt: string
  ownerId?: string
  runtimeGeneration?: string
  requestFingerprint?: string
  correlation?: StartOperationCorrelation
  result?: StartOperationResult
  errorCode?:
    | "RUNNER_TURN_START_FAILED"
    | "RUNNER_TURN_START_RESULT_UNCERTAIN"
    | "RUNNER_TURN_START_SEALED"
}

export class CorruptStartOperationError extends Error {
  constructor() {
    super("start operation state is corrupt")
    this.name = "CorruptStartOperationError"
  }
}

export class StartOperationInterruptedError extends Error {
  constructor() {
    super("start operation was interrupted")
    this.name = "StartOperationInterruptedError"
  }
}

export class StartOperationStore {
  constructor(private readonly workspaceManager: WorkspaceManager) {}

  async requestInterrupt(
    conversationId: string,
    projectionTurnId: string,
  ): Promise<void> {
    const directory = this.operationDirectory(conversationId)
    await mkdir(directory, { recursive: true, mode: 0o700 })
    // Publish separately from the operation snapshot: completion must never
    // overwrite a cancellation written concurrently with startup.
    await publishExclusiveDurable(
      directory,
      `${this.operationPath(conversationId, projectionTurnId)}.interrupt`,
      "interrupt\n",
    )
  }

  async isInterruptRequested(
    conversationId: string,
    projectionTurnId: string,
  ): Promise<boolean> {
    try {
      const value = await readFile(
        `${this.operationPath(conversationId, projectionTurnId)}.interrupt`,
        "utf8",
      )
      z.literal("interrupt\n").parse(value)
      return true
    } catch (error) {
      if (isNodeError(error) && error.code === "ENOENT") return false
      throw error
    }
  }

  async assertNotInterrupted(
    conversationId: string,
    projectionTurnId: string,
  ): Promise<void> {
    if (await this.isInterruptRequested(conversationId, projectionTurnId)) {
      throw new StartOperationInterruptedError()
    }
  }

  async clearInterruptRequest(
    conversationId: string,
    projectionTurnId: string,
  ): Promise<void> {
    try {
      await rm(`${this.operationPath(conversationId, projectionTurnId)}.interrupt`)
      await syncDirectory(this.operationDirectory(conversationId))
    } catch (error) {
      if (isNodeError(error) && error.code === "ENOENT") return
      throw error
    }
  }

  async read(
    conversationId: string,
    projectionTurnId: string,
  ): Promise<StartOperationState | null> {
    const path = this.operationPath(conversationId, projectionTurnId)
    let raw: string
    try {
      raw = await readFile(path, "utf8")
    } catch (error) {
      if (isNodeError(error) && error.code === "ENOENT") return null
      throw error
    }
    try {
      const parsed = persistedStartOperationSchema.parse(JSON.parse(raw))
      if (
        parsed.conversation_id !== conversationId ||
        parsed.projection_turn_id !== projectionTurnId
      ) {
        throw new CorruptStartOperationError()
      }
      return projectPersistedState(parsed)
    } catch (error) {
      if (error instanceof CorruptStartOperationError) throw error
      throw new CorruptStartOperationError()
    }
  }

  async createStarting(
    conversationId: string,
    projectionTurnId: string,
    ownerId?: string,
    requestFingerprint?: string,
  ): Promise<StartOperationState | null> {
    const directory = this.operationDirectory(conversationId)
    await mkdir(directory, { recursive: true, mode: 0o700 })
    const now = new Date().toISOString()
    const state: StartOperationState = {
      conversationId,
      projectionTurnId,
      status: "starting",
      createdAt: now,
      updatedAt: now,
      ...(ownerId ? { ownerId } : {}),
      ...(requestFingerprint ? { requestFingerprint } : {}),
    }
    const published = await publishExclusiveDurable(
      directory,
      this.operationPath(conversationId, projectionTurnId),
      serializeState(state),
    )
    return published ? state : null
  }

  async createSealed(
    conversationId: string,
    projectionTurnId: string,
    ownerId: string,
    runtimeGeneration: string,
  ): Promise<StartOperationState | null> {
    const directory = this.operationDirectory(conversationId)
    await mkdir(directory, { recursive: true, mode: 0o700 })
    const now = new Date().toISOString()
    const state: StartOperationState = {
      conversationId,
      projectionTurnId,
      status: "failed",
      createdAt: now,
      updatedAt: now,
      ownerId,
      runtimeGeneration,
      errorCode: "RUNNER_TURN_START_SEALED",
    }
    const published = await publishExclusiveDurable(
      directory,
      this.operationPath(conversationId, projectionTurnId),
      serializeState(state),
    )
    return published ? state : null
  }

  async updateCorrelation(
    current: StartOperationState,
    correlation: StartOperationCorrelation,
  ): Promise<StartOperationState> {
    if (current.status !== "starting") return current
    const next: StartOperationState = {
      ...current,
      correlation,
      updatedAt: new Date().toISOString(),
    }
    await this.replace(next)
    return next
  }

  async update(
    current: StartOperationState,
    update:
      | { status: "succeeded"; result: StartOperationResult }
      | {
          status: "failed"
          errorCode: "RUNNER_TURN_START_FAILED" | "RUNNER_TURN_START_SEALED"
        }
      | {
          status: "uncertain"
          errorCode: "RUNNER_TURN_START_RESULT_UNCERTAIN"
        },
  ): Promise<StartOperationState> {
    const next: StartOperationState = {
      conversationId: current.conversationId,
      projectionTurnId: current.projectionTurnId,
      status: update.status,
      createdAt: current.createdAt,
      updatedAt: new Date().toISOString(),
      ...(current.ownerId ? { ownerId: current.ownerId } : {}),
      ...(current.runtimeGeneration
        ? { runtimeGeneration: current.runtimeGeneration }
        : {}),
      ...(current.requestFingerprint
        ? { requestFingerprint: current.requestFingerprint }
        : {}),
      ...(current.correlation ? { correlation: current.correlation } : {}),
      ...(update.status === "succeeded" ? { result: update.result } : {}),
      ...(update.status === "failed" || update.status === "uncertain"
        ? { errorCode: update.errorCode }
        : {}),
    }
    await this.replace(next)
    return next
  }

  async restartFailed(
    current: StartOperationState,
    requestFingerprint: string,
  ): Promise<StartOperationState> {
    if (
      current.status !== "failed" ||
      current.errorCode !== "RUNNER_TURN_START_FAILED" ||
      current.correlation
    ) {
      return current
    }
    const next: StartOperationState = {
      conversationId: current.conversationId,
      projectionTurnId: current.projectionTurnId,
      status: "starting",
      createdAt: current.createdAt,
      updatedAt: new Date().toISOString(),
      ...(current.ownerId ? { ownerId: current.ownerId } : {}),
      requestFingerprint,
    }
    await this.replace(next)
    return next
  }

  async replaceCorruptWithUncertain(
    conversationId: string,
    projectionTurnId: string,
  ): Promise<StartOperationState> {
    const now = new Date().toISOString()
    const state: StartOperationState = {
      conversationId,
      projectionTurnId,
      status: "uncertain",
      createdAt: now,
      updatedAt: now,
      errorCode: "RUNNER_TURN_START_RESULT_UNCERTAIN",
    }
    await this.replace(state)
    return state
  }

  private operationDirectory(conversationId: string): string {
    return join(
      this.workspaceManager.pathsFor(conversationId).taskControl,
      "start-operations",
    )
  }

  private operationPath(
    conversationId: string,
    projectionTurnId: string,
  ): string {
    uuid.parse(projectionTurnId)
    return join(this.operationDirectory(conversationId), `${projectionTurnId}.json`)
  }

  private async replace(state: StartOperationState): Promise<void> {
    const directory = this.operationDirectory(state.conversationId)
    await mkdir(directory, { recursive: true, mode: 0o700 })
    const destination = this.operationPath(
      state.conversationId,
      state.projectionTurnId,
    )
    const temporary = join(
      directory,
      `.${state.projectionTurnId}.${randomUUID()}.tmp`,
    )
    try {
      await writeExclusiveDurable(temporary, serializeState(state))
      await rename(temporary, destination)
      await syncDirectory(directory)
    } finally {
      await rm(temporary, { force: true }).catch(() => undefined)
    }
  }
}

function projectPersistedState(
  persisted: PersistedStartOperation,
): StartOperationState {
  return {
    conversationId: persisted.conversation_id,
    projectionTurnId: persisted.projection_turn_id,
    status: persisted.status,
    createdAt: persisted.created_at,
    updatedAt: persisted.updated_at,
    ...(persisted.result
      ? {
          result: {
            codexThreadId: persisted.result.codex_thread_id,
            codexTurnId: persisted.result.codex_turn_id,
            ...(persisted.result.goal
              ? { goal: projectPersistedGoal(persisted.result.goal) }
              : {}),
          },
        }
      : {}),
    ...(persisted.error_code ? { errorCode: persisted.error_code } : {}),
    ...(persisted.owner_id ? { ownerId: persisted.owner_id } : {}),
    ...(persisted.runtime_generation
      ? { runtimeGeneration: persisted.runtime_generation }
      : {}),
    ...(persisted.request_fingerprint
      ? { requestFingerprint: persisted.request_fingerprint }
      : {}),
    ...(persisted.correlation
      ? {
          correlation: {
            codexThreadId: persisted.correlation.codex_thread_id,
            baselineTurnIds: persisted.correlation.baseline_turn_ids,
            preparedAt: persisted.correlation.prepared_at,
            ...(persisted.correlation.operation_kind
              ? { operationKind: persisted.correlation.operation_kind }
              : {}),
          },
        }
      : {}),
  }
}

function serializeState(state: StartOperationState): string {
  const persisted: PersistedStartOperation = {
    conversation_id: state.conversationId,
    projection_turn_id: state.projectionTurnId,
    status: state.status,
    created_at: state.createdAt,
    updated_at: state.updatedAt,
    ...(state.ownerId ? { owner_id: state.ownerId } : {}),
    ...(state.runtimeGeneration
      ? { runtime_generation: state.runtimeGeneration }
      : {}),
    ...(state.requestFingerprint
      ? { request_fingerprint: state.requestFingerprint }
      : {}),
    ...(state.correlation
      ? {
          correlation: {
            codex_thread_id: state.correlation.codexThreadId,
            baseline_turn_ids: state.correlation.baselineTurnIds,
            prepared_at: state.correlation.preparedAt,
            ...(state.correlation.operationKind
              ? { operation_kind: state.correlation.operationKind }
              : {}),
          },
        }
      : {}),
    ...(state.result
      ? {
          result: {
            codex_thread_id: state.result.codexThreadId,
            codex_turn_id: state.result.codexTurnId,
            ...(state.result.goal
              ? { goal: persistGoal(state.result.goal) }
              : {}),
          },
        }
      : {}),
    ...(state.errorCode ? { error_code: state.errorCode } : {}),
  }
  return `${JSON.stringify(persisted)}\n`
}

function projectPersistedGoal(
  goal: z.infer<typeof persistedThreadGoalSchema>,
): ThreadGoal {
  return {
    threadId: goal.thread_id,
    objective: goal.objective,
    status: goal.status,
    tokenBudget: goal.token_budget,
    tokensUsed: goal.tokens_used,
    timeUsedSeconds: goal.time_used_seconds,
    createdAt: goal.created_at,
    updatedAt: goal.updated_at,
  }
}

function persistGoal(
  goal: ThreadGoal,
): z.infer<typeof persistedThreadGoalSchema> {
  return {
    thread_id: goal.threadId,
    objective: goal.objective,
    status: goal.status,
    token_budget: goal.tokenBudget,
    tokens_used: goal.tokensUsed,
    time_used_seconds: goal.timeUsedSeconds,
    created_at: goal.createdAt,
    updated_at: goal.updatedAt,
  }
}

async function writeExclusiveDurable(path: string, contents: string): Promise<void> {
  const handle = await open(path, "wx", 0o600)
  try {
    await handle.writeFile(contents, "utf8")
    await handle.sync()
  } finally {
    await handle.close()
  }
}

async function publishExclusiveDurable(
  directory: string,
  destination: string,
  contents: string,
): Promise<boolean> {
  const temporary = join(directory, `.${randomUUID()}.publish.tmp`)
  try {
    await writeExclusiveDurable(temporary, contents)
    try {
      await link(temporary, destination)
    } catch (error) {
      if (isNodeError(error) && error.code === "EEXIST") return false
      throw error
    }
    await syncDirectory(directory)
    return true
  } finally {
    await rm(temporary, { force: true }).catch(() => undefined)
  }
}

async function syncDirectory(path: string): Promise<void> {
  const handle = await open(path, "r")
  try {
    await handle.sync()
  } finally {
    await handle.close()
  }
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error
}
