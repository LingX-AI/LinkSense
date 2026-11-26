import type { CallToolResult, Tool } from "@modelcontextprotocol/sdk/types.js"
import { request } from "undici"

export type CoreMcpCollaborationMode = "default" | "plan"

export type CoreMcpModuleContext = {
  environment: Readonly<NodeJS.ProcessEnv>
  workspaceRoot: string
  fetch?: typeof globalThis.fetch
}

export type CoreMcpToolCall = {
  toolName: string
  argumentsValue: unknown
  signal: AbortSignal
}

export type CoreMcpToolModule = {
  key: string
  tools: readonly Tool[]
  callTool: (input: CoreMcpToolCall) => Promise<CallToolResult>
}

export type CoreMcpModuleDefinition = {
  key: string
  modes: readonly CoreMcpCollaborationMode[]
  toolNames: readonly string[]
  create: (context: CoreMcpModuleContext) => CoreMcpToolModule
}

export function successToolResult(value: unknown): CallToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify(value) }],
    isError: false,
  }
}

export function failureToolResult(failure: {
  code: string
  retryable: boolean
  details?: Array<{ path: string; reason: string }>
}): CallToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify(failure) }],
    isError: true,
  }
}

export function withRequestTimeout(
  signal: AbortSignal,
  timeoutMs: number,
): AbortSignal {
  return AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)])
}

export async function requestBlockingCoreMcpBroker(endpoint: string, options: {
  method: "POST"
  headers: Record<string, string>
  body: string
  signal: AbortSignal
}): Promise<{ ok: boolean; status: number; json: () => Promise<unknown>; discard: () => Promise<void> }> {
  // Human approval uses the turn's cancellation signal.
  const response = await request(endpoint, { ...options, headersTimeout: 0, bodyTimeout: 0 })
  const ok = response.statusCode >= 200 && response.statusCode < 300
  return {
    ok,
    status: response.statusCode,
    json: () => response.body.json(),
    discard: () => response.body.dump(),
  }
}
