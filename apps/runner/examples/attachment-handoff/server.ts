import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { handoffConfigurationSchema, transferAttachments } from "./transfer.js";

// Configure these outside model-visible arguments, scoped to one conversation.
const configuration = handoffConfigurationSchema.parse({
  attachmentRoot: process.env.HANDOFF_ATTACHMENT_ROOT ?? "",
  conversationId: process.env.LINKSENSE_CONVERSATION_ID ?? "",
  authorizationUrl: process.env.HANDOFF_AUTHORIZATION_URL ?? "",
  uploadUrl: process.env.HANDOFF_UPLOAD_URL ?? "",
  bearerToken: process.env.HANDOFF_BEARER_TOKEN ?? "",
});
const server = new McpServer({ name: "attachment-handoff-example", version: "1.0.0" });
server.registerTool("handoff_selected_attachments", {
  description: "Transfer only files already confirmed in the destination's authenticated review UI. The destination must authorize this non-secret handoff ID for the current conversation. Never use this tool as a substitute for human confirmation.",
  inputSchema: { handoff_id: z.uuid() },
}, async ({ handoff_id }, extra) => {
  try {
    const result = await transferAttachments(configuration, handoff_id, extra.signal);
    return { content: [{ type: "text", text: JSON.stringify(result) }] };
  } catch {
    // The destination owns localized error UI; do not return paths, tokens or raw remote errors.
    return { isError: true, content: [{ type: "text", text: JSON.stringify({ error_code: "ATTACHMENT_HANDOFF_FAILED" }) }] };
  }
});
await server.connect(new StdioServerTransport());
