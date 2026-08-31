import { randomUUID } from "node:crypto"
import { mkdir, open, readFile, rename, rm } from "node:fs/promises"
import { join } from "node:path"

import { z } from "zod"

import type { WorkspaceManager } from "./workspace/workspace-manager.js"

const uuid = z.uuid()
const fingerprint = z.string().regex(/^[0-9a-f]{64}$/u)

const persistedSteerOperationSchema = z.strictObject({
  operation_id: uuid,
  conversation_id: uuid,
  projection_turn_id: uuid,
  owner_id: uuid,
  codex_thread_id: z.string().min(1),
  expected_codex_turn_id: z.string().min(1),
  input_fingerprint: fingerprint,
  baseline_item_ids: z.array(z.string().min(1)),
  prepared_at: z.iso.datetime(),
  status: z.enum(["starting", "succeeded", "failed", "uncertain"]),
  created_at: z.iso.datetime(),
  updated_at: z.iso.datetime(),
  result: z
    .strictObject({ codex_turn_id: z.string().min(1) })
    .optional(),
  error_code: z
    .enum([
      "RUNNER_TURN_STEER_FAILED",
      "RUNNER_TURN_STEER_RESULT_UNCERTAIN",
    ])
    .optional(),
})

type PersistedSteerOperation = z.infer<typeof persistedSteerOperationSchema>

export type SteerOperationState = {
  operationId: string
  conversationId: string
  projectionTurnId: string
  ownerId: string
  codexThreadId: string
  expectedCodexTurnId: string
  inputFingerprint: string
  baselineItemIds: string[]
  preparedAt: string
  status: "starting" | "succeeded" | "failed" | "uncertain"
  createdAt: string
  updatedAt: string
  result?: { codexTurnId: string }
  errorCode?:
    | "RUNNER_TURN_STEER_FAILED"
    | "RUNNER_TURN_STEER_RESULT_UNCERTAIN"
}

export class CorruptSteerOperationError extends Error {
  constructor() {
    super("steer operation state is corrupt")
    this.name = "CorruptSteerOperationError"
  }
}

export class SteerOperationStore {
  constructor(private readonly workspaceManager: WorkspaceManager) {}

  async read(
    conversationId: string,
    operationId: string,
  ): Promise<SteerOperationState | null> {
    let raw: string
    try {
      raw = await readFile(this.operationPath(conversationId, operationId), "utf8")
    } catch (error) {
      if (isNodeError(error) && error.code === "ENOENT") return null
      throw error
    }
    try {
      const parsed = persistedSteerOperationSchema.parse(JSON.parse(raw))
      if (
        parsed.conversation_id !== conversationId ||
        parsed.operation_id !== operationId
      ) {
        throw new CorruptSteerOperationError()
      }
      return projectState(parsed)
    } catch (error) {
      if (error instanceof CorruptSteerOperationError) throw error
      throw new CorruptSteerOperationError()
    }
  }

  async createStarting(
    input: Omit<SteerOperationState, "status" | "createdAt" | "updatedAt">,
  ): Promise<SteerOperationState | null> {
    const directory = this.operationDirectory(input.conversationId)
    await mkdir(directory, { recursive: true, mode: 0o700 })
    const now = new Date().toISOString()
    const state: SteerOperationState = {
      ...input,
      status: "starting",
      createdAt: now,
      updatedAt: now,
    }
    try {
      await writeExclusiveDurable(
        this.operationPath(input.conversationId, input.operationId),
        serializeState(state),
      )
      await syncDirectory(directory)
      return state
    } catch (error) {
      if (isNodeError(error) && error.code === "EEXIST") return null
      throw error
    }
  }

  async update(
    current: SteerOperationState,
    update:
      | { status: "succeeded"; result: { codexTurnId: string } }
      | { status: "failed"; errorCode: "RUNNER_TURN_STEER_FAILED" }
      | {
          status: "uncertain"
          errorCode: "RUNNER_TURN_STEER_RESULT_UNCERTAIN"
        },
  ): Promise<SteerOperationState> {
    const next: SteerOperationState = {
      operationId: current.operationId,
      conversationId: current.conversationId,
      projectionTurnId: current.projectionTurnId,
      ownerId: current.ownerId,
      codexThreadId: current.codexThreadId,
      expectedCodexTurnId: current.expectedCodexTurnId,
      inputFingerprint: current.inputFingerprint,
      baselineItemIds: current.baselineItemIds,
      preparedAt: current.preparedAt,
      status: update.status,
      createdAt: current.createdAt,
      updatedAt: new Date().toISOString(),
      ...(update.status === "succeeded" ? { result: update.result } : {}),
      ...(update.status === "failed" || update.status === "uncertain"
        ? { errorCode: update.errorCode }
        : {}),
    }
    await this.replace(next)
    return next
  }

  private operationDirectory(conversationId: string): string {
    return join(
      this.workspaceManager.pathsFor(conversationId).taskControl,
      "steer-operations",
    )
  }

  private operationPath(conversationId: string, operationId: string): string {
    uuid.parse(operationId)
    return join(this.operationDirectory(conversationId), `${operationId}.json`)
  }

  private async replace(state: SteerOperationState): Promise<void> {
    const directory = this.operationDirectory(state.conversationId)
    await mkdir(directory, { recursive: true, mode: 0o700 })
    const destination = this.operationPath(
      state.conversationId,
      state.operationId,
    )
    const temporary = join(directory, `.${state.operationId}.${randomUUID()}.tmp`)
    try {
      await writeExclusiveDurable(temporary, serializeState(state))
      await rename(temporary, destination)
      await syncDirectory(directory)
    } finally {
      await rm(temporary, { force: true }).catch(() => undefined)
    }
  }
}

function projectState(persisted: PersistedSteerOperation): SteerOperationState {
  return {
    operationId: persisted.operation_id,
    conversationId: persisted.conversation_id,
    projectionTurnId: persisted.projection_turn_id,
    ownerId: persisted.owner_id,
    codexThreadId: persisted.codex_thread_id,
    expectedCodexTurnId: persisted.expected_codex_turn_id,
    inputFingerprint: persisted.input_fingerprint,
    baselineItemIds: persisted.baseline_item_ids,
    preparedAt: persisted.prepared_at,
    status: persisted.status,
    createdAt: persisted.created_at,
    updatedAt: persisted.updated_at,
    ...(persisted.result
      ? { result: { codexTurnId: persisted.result.codex_turn_id } }
      : {}),
    ...(persisted.error_code ? { errorCode: persisted.error_code } : {}),
  }
}

function serializeState(state: SteerOperationState): string {
  const persisted: PersistedSteerOperation = {
    operation_id: state.operationId,
    conversation_id: state.conversationId,
    projection_turn_id: state.projectionTurnId,
    owner_id: state.ownerId,
    codex_thread_id: state.codexThreadId,
    expected_codex_turn_id: state.expectedCodexTurnId,
    input_fingerprint: state.inputFingerprint,
    baseline_item_ids: state.baselineItemIds,
    prepared_at: state.preparedAt,
    status: state.status,
    created_at: state.createdAt,
    updated_at: state.updatedAt,
    ...(state.result
      ? { result: { codex_turn_id: state.result.codexTurnId } }
      : {}),
    ...(state.errorCode ? { error_code: state.errorCode } : {}),
  }
  return `${JSON.stringify(persisted)}\n`
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
