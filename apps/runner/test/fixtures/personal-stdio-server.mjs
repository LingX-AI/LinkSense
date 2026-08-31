import process from "node:process"

import { Server } from "@modelcontextprotocol/sdk/server/index.js"
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"
import { ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js"

if (process.env.LINKSENSE_TEST_VALUE !== "expected") {
  throw new Error("fixture environment was not projected")
}

const server = new Server(
  { name: "linksense-personal-stdio-fixture", version: "1.0.0" },
  { capabilities: { tools: {} } }
)

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "echo",
      description: "Echo one value",
      inputSchema: {
        type: "object",
        properties: { value: { type: "string" } },
        required: ["value"],
      },
    },
  ],
}))

await server.connect(new StdioServerTransport())
