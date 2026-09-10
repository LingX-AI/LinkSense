import type { CallToolResult, Tool } from "@modelcontextprotocol/sdk/types.js"

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
