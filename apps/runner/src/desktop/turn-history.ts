import { lstat } from "node:fs/promises"
import path from "node:path"
import { desktopExecutionTerminalSchema, runnerCodexTurnSchema } from "@linksense/shared"
import type { Logger } from "pino"
import { z } from "zod"

import { mapCodexNotification } from "../codex/event-mapper.js"
import { CodexJsonRpcClient } from "../codex/json-rpc-client.js"
import { linkSenseModelProviderId } from "../codex/runtime-config-overrides.js"
import { correlateStartOperation, type StartOperationResult, type StartOperationState } from "../start-operation.js"
import type { ConversationPaths } from "../workspace/workspace-manager.js"

const threadReadSchema = z.object({
  thread: z.object({
    id: z.uuid(),
    modelProvider: z.literal(linkSenseModelProviderId),
  }),
})

const storedTurn = z.object({
  id: z.uuid(),
  status: runnerCodexTurnSchema.shape.status,
  error: z.unknown(),
  startedAt: z.number().finite().nullish(),
  completedAt: z.number().finite().nullish(),
  durationMs: z.number().nonnegative().finite().nullish(),
  items: z.array(z.looseObject({ type: z.string(), clientId: z.string().nullish() })),
})
const historyPageSize = 8
const historyPage = z.object({ data: z.array(storedTurn).max(historyPageSize), nextCursor: z.string().min(1).max(4096).nullable() })

export async function recoverDesktopStart(
  runtimeRoot: string,
  paths: ConversationPaths,
  state: StartOperationState,
  signal: AbortSignal,
  logger: Logger,
) {
  const correlation = state.correlation
  if (!correlation || (correlation.operationKind !== undefined && correlation.operationKind !== "turn")) return null
  const baseline = new Set(correlation.baselineTurnIds)
  const candidates: z.infer<typeof storedTurn>[] = []
  for await (const page of readDesktopHistory(runtimeRoot, paths, correlation.codexThreadId, signal, logger)) {
    candidates.push(...page.filter(turn => !baseline.has(turn.id)))
    if (page.some(turn => baseline.has(turn.id))) break
  }
  const match = correlateStartOperation(correlation, state.projectionTurnId, candidates)
  return match ? { codexThreadId: correlation.codexThreadId, codexTurnId: match.started.id } : null
}

export async function recoverDesktopTerminal(
  runtimeRoot: string,
  paths: ConversationPaths,
  receipt: Pick<StartOperationResult, "codexThreadId" | "codexTurnId">,
  signal: AbortSignal,
  logger: Logger,
) {
  const threadId = receipt.codexThreadId
  for await (const page of readDesktopHistory(runtimeRoot, paths, threadId, signal, logger)) {
    const turn = page.find(candidate => candidate.id === receipt.codexTurnId)
    if (!turn) continue
    if (turn.status === "inProgress") return null
    const context = { workspace: paths.workspace, codexHome: paths.codexHome }
    const [event] = mapCodexNotification({ method: "turn/completed", params: { threadId, turn } }, context)
    if (event?.method !== "turn/completed") return null
    // The summary view carries the stored final agent message; never replay
    // user inputs, tool operations or abandoned interactive requests.
    const answer = turn.items.filter(item => item.type === "agentMessage" && item.delivery !== "async").at(-1)
    const [answerEvent] = answer ? mapCodexNotification({
      method: "item/completed", params: { threadId, turnId: turn.id, item: answer },
    }, context) : []
    return {
      terminal: desktopExecutionTerminalSchema.parse({ codexThreadId: threadId, turn: event.params.turn }),
      answer: answerEvent,
    }
  }
  return null
}

/** Inspect an unloaded thread using only native history, without resuming it. */
async function* readDesktopHistory(
  runtimeRoot: string,
  paths: ConversationPaths,
  codexThreadId: string,
  signal: AbortSignal,
  logger: Logger,
) {
  signal.throwIfAborted()
  for (const directory of [paths.home, paths.codexHome]) {
    const info = await lstat(directory)
    if (!info.isDirectory() || info.uid !== process.geteuid?.()) {
      throw new Error("desktop native history directory is invalid")
    }
  }
  signal.throwIfAborted()
  const client = new CodexJsonRpcClient({
    command: path.join(runtimeRoot, "bin", process.platform === "win32" ? "codex.exe" : "codex"),
    userHome: paths.home, codexHome: paths.codexHome, logger, requestTimeoutMs: 5_000,
    configOverrides: [
      'cli_auth_credentials_store="ephemeral"',
      'forced_login_method="api"',
      "check_for_update_on_startup=false",
      "analytics.enabled=false",
      "features.apps=false",
      "features.plugins=false",
      "features.remote_models=false",
      "features.memories=false",
    ],
  })
  const abort = () => { void client.close().catch(() => undefined) }
  signal.addEventListener("abort", abort, { once: true })
  try {
    await client.initialize()
    signal.throwIfAborted()
    const response = threadReadSchema.parse(await client.request<unknown>("thread/read", { threadId: codexThreadId }))
    signal.throwIfAborted()
    if (response.thread.id !== codexThreadId) throw new Error("desktop native thread scope mismatch")
    let cursor: string | null = null
    // shortcut: bound recovery IO to 128 summary turns, use indexed exact-turn reads when the native protocol exposes them.
    for (let pageIndex = 0; pageIndex < 16; pageIndex++) {
      const page = historyPage.parse(await client.request<unknown>("thread/turns/list", {
        threadId: codexThreadId, cursor, limit: historyPageSize, itemsView: "summary",
      }))
      signal.throwIfAborted()
      yield page.data
      if (!page.nextCursor) return
      if (page.nextCursor === cursor) break
      cursor = page.nextCursor
    }
    throw new Error("desktop native history search did not settle within its bound")
  } finally {
    signal.removeEventListener("abort", abort)
    await client.close()
  }
}
