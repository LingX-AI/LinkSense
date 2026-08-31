import { coreMcpServerKey } from "@linksense/shared"
import { Server } from "@modelcontextprotocol/sdk/server/index.js"
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
} from "@modelcontextprotocol/sdk/types.js"

import {
  CoreMcpToolUnavailableError,
  createCoreMcpRegistry,
} from "./core-service-registry.js"

const registry = createCoreMcpRegistry()
const server = new Server(
  { name: coreMcpServerKey, version: "0.1.0" },
  {
    capabilities: { tools: {} },
    ...(registry.instructions ? { instructions: registry.instructions } : {}),
  },
)

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [...registry.tools],
}))

server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
  try {
    return await registry.callTool({
      toolName: request.params.name,
      argumentsValue: request.params.arguments,
      signal: extra.signal,
    })
  } catch (error) {
    if (error instanceof CoreMcpToolUnavailableError) {
      throw new McpError(
        ErrorCode.InvalidParams,
        `Core MCP tool is unavailable: ${error.toolName}`,
      )
    }
    throw error
  }
})

await server.connect(new StdioServerTransport())
