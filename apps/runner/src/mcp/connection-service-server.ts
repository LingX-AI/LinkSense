import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { createMicrosoftFilesModule } from "./connection-services/microsoft-files.js";

import { createWorkspaceModule } from "./connection-services/workspace.js";
const provider = process.argv.at(-1) ?? "";
const context = { environment: process.env, workspaceRoot: process.cwd() };
const module =
  provider === "microsoft-files"
    ? createMicrosoftFilesModule(context)
    : createWorkspaceModule(provider, context);
const server = new Server(
  { name: `linksense-${provider}`, version: "1.0.0" },
  { capabilities: { tools: {} } },
);
server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: module.tools,
}));
server.setRequestHandler(CallToolRequestSchema, async (request, extra) =>
  module.callTool({
    toolName: request.params.name,
    argumentsValue: request.params.arguments,
    signal: extra.signal,
  }),
);
await server.connect(new StdioServerTransport());
