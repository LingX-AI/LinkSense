import { createServer } from "node:http";
import { fileURLToPath } from "node:url";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { CallToolResultSchema } from "@modelcontextprotocol/sdk/types.js";
import { describe, expect, it } from "vitest";

function resultData(raw: unknown): unknown {
  const result = CallToolResultSchema.parse(raw);
  expect(result.isError).toBe(false);
  expect(result.content).toHaveLength(1);
  const content = result.content[0];
  if (content?.type !== "text") throw new Error("missing tool result text");
  return JSON.parse(content.text);
}

describe("Core automation MCP protocol", () => {
  it("discovers and calls automation tools over the actual stdio server", async () => {
    const id = "10000000-0000-4000-8000-000000000001";
    const token = "automation-protocol-token-".repeat(3);
    let receivedBody: unknown;
    let receivedToken: string | undefined;
    const result = {
      operation: "list",
      current_task: { id, title: "Current", pinned: false, automation_ids: [] },
      items: [],
      pinned_tasks: [],
    };
    let responseBody: unknown = result;
    const server = createServer((request, response) => {
      const chunks: Buffer[] = [];
      request.on("data", (chunk: Buffer) => chunks.push(chunk));
      request.on("end", () => {
        receivedToken = request.headers.authorization;
        receivedBody = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify(responseBody));
      });
    });
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const address = server.address();
    if (!address || typeof address === "string")
      throw new Error("missing test listener");
    const endpoint = `http://127.0.0.1:${address.port}/execute`;
    const client = new Client({
      name: "automation-protocol-test",
      version: "1",
    });
    try {
      const environment: Record<string, string> = {
        LINKSENSE_COLLABORATION_MODE: "default",
        LINKSENSE_CONVERSATION_ID: id,
        LINKSENSE_KNOWLEDGE_SEARCH_TIMEOUT_MS: "200000",
      };
      for (const prefix of [
        "FILE_SERVICE",
        "FORM_SERVICE",
        "CURRENT_USER",
        "IMAGE_GENERATION",
        "KNOWLEDGE_SERVICE",
        "SKILL_CREATOR",
        "AUTOMATION",
      ]) {
        environment[`LINKSENSE_${prefix}_ENDPOINT`] = endpoint;
        environment[`LINKSENSE_${prefix}_TOKEN`] = token;
      }
      environment.LINKSENSE_KNOWLEDGE_SEARCH_ENDPOINT = endpoint;
      await client.connect(
        new StdioClientTransport({
          command: process.execPath,
          args: [
            fileURLToPath(import.meta.resolve("tsx/cli")),
            fileURLToPath(
              new URL("../src/mcp/core-service-server.ts", import.meta.url),
            ),
          ],
          env: environment,
        }),
      );
      const tools = await client.listTools();
      expect(tools.tools.map((tool) => tool.name)).toContain(
        "create_automation",
      );
      expect(
        await client.callTool({ name: "list_automations", arguments: {} }),
      ).toEqual({
        content: [{ type: "text", text: JSON.stringify(result) }],
        isError: false,
      });
      expect(receivedBody).toEqual({ operation: "list" });
      expect(receivedToken).toBe(`Bearer ${token}`);

      const automation = {
        id,
        title: "Daily news",
        instruction: "Summarize the latest news with source links.",
        status: "active",
        conversation: {
          id: "10000000-0000-4000-8000-000000000002",
          title: "Daily news",
          pinned_at: "2026-10-26T01:00:00.000Z",
        },
        schedule: {
          frequency: "daily",
          interval: 1,
          time: "17:00",
          time_zone: "Asia/Shanghai",
        },
        next_run_at: "2026-10-26T09:00:00.000Z",
        expires_on: null,
        last_run_at: null,
        last_run_status: null,
        last_error_code: null,
        model_preference: null,
        notification_target: null,
        created_at: "2026-10-26T01:00:00.000Z",
        updated_at: "2026-10-26T01:00:00.000Z",
      };
      responseBody = { operation: "create", automation };
      const created = await client.callTool({
        name: "create_automation",
        arguments: {
          request_id: id,
          title: automation.title,
          instruction: automation.instruction,
          schedule: automation.schedule,
        },
      });
      expect(receivedBody).toMatchObject({
        operation: "create",
        request_id: id,
        target: { mode: "new_task" },
      });
      expect(resultData(created)).toEqual(responseBody);

      const schedule = { ...automation.schedule, time: "19:00" };
      responseBody = {
        operation: "update",
        automation: {
          ...automation,
          schedule,
          next_run_at: "2026-10-26T11:00:00.000Z",
        },
      };
      const updated = await client.callTool({
        name: "update_automation",
        arguments: { automation_id: id, changes: { schedule } },
      });
      expect(receivedBody).toEqual({
        operation: "update",
        automation_id: id,
        changes: { schedule },
      });
      expect(resultData(updated)).toEqual(responseBody);
    } finally {
      await client.close();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
