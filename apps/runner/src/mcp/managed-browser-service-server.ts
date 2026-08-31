import { createInterface } from "node:readline"
import path from "node:path"

import { z } from "zod"

import { BrowserSessionLimitError } from "../browser/cli-wrapper.js"
import {
  ManagedBrowserCommandCancelledError,
  ManagedBrowserCommandQueue,
  ManagedBrowserCommandValidationError,
  managedBrowserCommandArgumentsSchema,
  runManagedBrowserCommand,
} from "./managed-browser-service.js"

const conversationId = z.uuid().parse(process.env.LINKSENSE_CONVERSATION_ID)
const userHome = z.string().min(1).parse(process.env.HOME)
const codexHome = z.string().min(1).parse(process.env.CODEX_HOME)
const workspace = path.join(userHome, "workspaces", conversationId)
const environment: NodeJS.ProcessEnv = {
  ...process.env,
  HOME: userHome,
  CODEX_HOME: codexHome,
  LINKSENSE_CONVERSATION_ID: conversationId,
}

const callToolParamsSchema = z.object({
  name: z.literal("run_browser_command"),
  arguments: z.unknown(),
})
const cancelledParamsSchema = z.object({
  requestId: z.union([z.string(), z.number()]),
})

type RpcId = string | number
type RpcRequest = {
  id?: RpcId
  method?: string
  params?: unknown
}

const activeRequests = new Map<string, AbortController>()
// All tool calls share one task-scoped Playwright session and config file.
// Queue only command execution so cancellation notifications stay responsive.
const commandQueue = new ManagedBrowserCommandQueue()
const lines = createInterface({ input: process.stdin })
lines.on("line", (line) => void handleLine(line))

async function handleLine(line: string): Promise<void> {
  let request: RpcRequest
  try {
    request = JSON.parse(line) as RpcRequest
  } catch {
    return
  }
  if (typeof request.method !== "string") return
  if (request.method === "notifications/cancelled") {
    const cancelled = cancelledParamsSchema.safeParse(request.params)
    if (cancelled.success) {
      activeRequests.get(requestKey(cancelled.data.requestId))?.abort()
    }
    return
  }
  if (request.id === undefined) return

  try {
    if (request.method === "initialize") {
      respond(request.id, {
        protocolVersion: "2025-06-18",
        capabilities: { tools: {} },
        serverInfo: {
          name: "linksense-managed-browser",
          version: "0.1.0",
        },
        instructions:
          "Use run_browser_command for read-only rendered-web investigation in LinkSense Plan mode. The tool is bound to the current task's managed browser session and workspace.",
      })
      return
    }
    if (request.method === "ping") {
      respond(request.id, {})
      return
    }
    if (request.method === "tools/list") {
      respond(request.id, { tools: [managedBrowserTool] })
      return
    }
    if (request.method !== "tools/call") {
      fail(request.id, -32_601, "Method not found")
      return
    }

    const call = callToolParamsSchema.parse(request.params)
    const input = managedBrowserCommandArgumentsSchema.parse(call.arguments)
    const key = requestKey(request.id)
    if (activeRequests.has(key)) {
      fail(request.id, -32_600, "Invalid Request")
      return
    }
    const controller = new AbortController()
    activeRequests.set(key, controller)
    try {
      const result = await commandQueue.run(() =>
        runManagedBrowserCommand(input, {
          environment,
          workspace,
          signal: controller.signal,
        }),
      )
      respond(request.id, {
        content: [{ type: "text", text: JSON.stringify(result) }],
        isError: result.exit_code !== 0,
      })
    } catch (error) {
      if (
        controller.signal.aborted ||
        error instanceof ManagedBrowserCommandCancelledError
      ) {
        fail(request.id, -32_800, "Request cancelled")
        return
      }
      respond(request.id, browserFailureResult(error))
    } finally {
      if (activeRequests.get(key) === controller) activeRequests.delete(key)
    }
  } catch (error) {
    respond(request.id, browserFailureResult(error))
  }
}

function browserFailureResult(error: unknown) {
  const code =
    error instanceof z.ZodError ||
    error instanceof ManagedBrowserCommandValidationError
      ? "BROWSER_COMMAND_INVALID"
      : error instanceof BrowserSessionLimitError
        ? "BROWSER_SESSION_LIMIT_REACHED"
        : "BROWSER_COMMAND_FAILED"
  return {
    content: [{ type: "text", text: JSON.stringify({ code }) }],
    isError: true,
  }
}

function requestKey(id: RpcId): string {
  return `${typeof id}:${String(id)}`
}

function respond(id: RpcId, result: unknown): void {
  process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id, result })}\n`)
}

function fail(id: RpcId, code: number, message: string): void {
  process.stdout.write(
    `${JSON.stringify({ jsonrpc: "2.0", id, error: { code, message } })}\n`,
  )
}

const managedBrowserTool = {
  name: "run_browser_command",
  description:
    "Run one allowlisted navigation or inspection command through the current task's LinkSense managed browser for read-only web investigation. Start with open, then use snapshot, find, requests, console, screenshot, or another listed read-only command. Interactive input, arbitrary code, upload, storage mutation, routing, installation, and session-management commands are rejected. Shell network access is unavailable in Plan mode.",
  inputSchema: {
    type: "object",
    properties: {
      command: { type: "string", minLength: 1, maxLength: 128 },
      arguments: {
        type: "array",
        items: { type: "string", maxLength: 4_096 },
        maxItems: 128,
      },
      timeout_ms: {
        type: "integer",
        minimum: 1_000,
        maximum: 120_000,
        default: 120_000,
      },
    },
    required: ["command"],
    additionalProperties: false,
  },
  annotations: {
    title: "Run managed browser command",
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: true,
  },
} as const
