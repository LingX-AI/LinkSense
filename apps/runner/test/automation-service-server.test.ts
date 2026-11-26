import { createServer } from "node:http";
import { fileURLToPath } from "node:url";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { CallToolResultSchema } from "@modelcontextprotocol/sdk/types.js";
import { describe, expect, it } from "vitest";

function resultData(raw: unknown, expectedLink?: string): unknown {
  const result = CallToolResultSchema.parse(raw);
  expect(result.isError).toBe(false);
  expect(result.content.slice(1)).toEqual(
    expectedLink === undefined ? [] : [{ type: "text", text: expectedLink }],
  );
  const content = result.content[0];
  if (content?.type !== "text") throw new Error("missing tool result text");
  return JSON.parse(content.text);
}

describe("Core automation MCP protocol", () => {
  it("discovers and calls automation and site tools over the actual stdio server", async () => {
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
        "WEB_SEARCH",
        "IMAGE_GENERATION",
        "KNOWLEDGE_SERVICE",
        "SKILL_CREATOR",
        "AUTOMATION",
        "WEB_SITE",
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
      expect(tools.tools.map((tool) => tool.name)).toContain("search_web");
      responseBody = { success: true, provider: "deepseek", query: "test", results: [] };
      expect(resultData(await client.callTool({ name: "search_web", arguments: { query: "test" } }))).toEqual(responseBody);
      expect(receivedBody).toEqual({ query: "test" });
      expect(receivedToken).toBe(`Bearer ${token}`);
      responseBody = result;
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

      expect(tools.tools.map((tool) => tool.name)).toEqual(expect.arrayContaining([
        "list_sites", "publish_site", "update_site", "unpublish_site", "delete_site",
      ]));
      responseBody = { tool: "list_sites", items: [], next_cursor: null };
      expect(resultData(await client.callTool({ name: "list_sites", arguments: { search: "demo" } }))).toEqual(responseBody);
      expect(receivedBody).toEqual({ tool: "list_sites", search: "demo", limit: 30 });
      responseBody = { tool: "publish_site", outcome: "cancelled" };
      const draft = { file_id: id, name: "Demo site", slug: "DEMO" };
      expect(resultData(await client.callTool({ name: "publish_site", arguments: { site: draft } }))).toEqual(responseBody);
      expect(receivedBody).toEqual({ tool: "publish_site", site: { ...draft, slug: "demo", description: "" } });
      expect(receivedToken).toBe("Bearer " + token);
      const fabricatedConfirmation = await client.callTool({
        name: "publish_site", arguments: { site: draft, confirmation: true },
      });
      expect(fabricatedConfirmation.isError).toBe(true);
      expect(receivedBody).toEqual({ tool: "publish_site", site: { ...draft, slug: "demo", description: "" } });

      const timestamp = "2026-11-26T08:00:00.000Z";
      const site = {
        id, name: "Demo site", description: "", slug: "demo", status: "published",
        url: "https://example.test:18173/web/demo",
        conversation_id: id, source_task_title: "Current", source_file_id: id,
        release_id: id, file_count: 6, size_bytes: 200,
        published_at: timestamp, created_at: timestamp, updated_at: timestamp,
      };
      for (const { name, args, result } of [
        { name: "publish_site", args: { site: draft }, result: { tool: "publish_site", outcome: "published", site } },
        {
          name: "update_site", args: { site_id: id, changes: { slug: "new-demo" } },
          result: { tool: "update_site", site: { ...site, slug: "new-demo", url: "https://example.test:18173/web/new-demo" } },
        },
      ]) {
        expect(tools.tools.find(tool => tool.name === name)?.description)
          .toContain("Use the exact URL as both the link text and target");
        const path = new URL(result.site.url).pathname;
        responseBody = { ...result, site: { ...result.site, url_path: path } };
        expect(resultData(await client.callTool({ name, arguments: args }), `<${result.site.url}>`)).toEqual(result);

        responseBody = { ...result, site: { ...result.site, url: path } };
        expect((await client.callTool({ name, arguments: args })).isError).toBe(true);
      }

      responseBody = { tool: "update_site", site: { ...site, status: "disabled" } };
      expect(resultData(await client.callTool({
        name: "update_site",
        arguments: { site_id: id, changes: { name: "Updated unpublished site" } },
      }))).toEqual(responseBody);

      expect(tools.tools.find(tool => tool.name === "delete_site")?.description).toContain("request_user_form approval card");
      responseBody = { tool: "delete_site", outcome: "cancelled" };
      expect(resultData(await client.callTool({ name: "delete_site", arguments: { site_id: id } }))).toEqual(responseBody);
      expect(receivedBody).toEqual({ tool: "delete_site", site_id: id });
      expect((await client.callTool({ name: "delete_site", arguments: { site_id: id, confirmed: true } })).isError).toBe(true);
    } finally {
      await client.close();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
