import { describe, expect, it, vi } from "vitest";

import { automationToolNames } from "@linksense/shared";
import { automationCoreMcpModule } from "../src/mcp/core-services/automation-service.js";
import { coreMcpToolNamesFor } from "../src/mcp/core-service-registry.js";

const id = "10000000-0000-4000-8000-000000000001";
const token = "automation-test-token-".repeat(3);

function fixture(response: unknown, status = 200) {
  const fetch = vi
    .fn<typeof globalThis.fetch>()
    .mockResolvedValue(new Response(JSON.stringify(response), { status }));
  const module = automationCoreMcpModule.create({
    workspaceRoot: "/unused",
    environment: {
      LINKSENSE_AUTOMATION_ENDPOINT: "https://runner.example.test/automations",
      LINKSENSE_AUTOMATION_TOKEN: token,
    },
    fetch,
  });
  const call = (toolName: string, argumentsValue: unknown) =>
    module.callTool({
      toolName,
      argumentsValue,
      signal: new AbortController().signal,
    });
  return { module, fetch, call };
}

describe("Core automation tools", () => {
  it("registers all eight tools with schemas and excludes them from Plan mode", () => {
    const { module } = fixture(null);
    expect(module.tools.map((tool) => tool.name)).toEqual(automationToolNames);
    for (const name of automationToolNames) {
      expect(coreMcpToolNamesFor("default")).toContain(name);
      expect(coreMcpToolNamesFor("plan")).not.toContain(name);
    }
    expect(
      module.tools.find((tool) => tool.name === "list_automations")?.annotations
        ?.readOnlyHint,
    ).toBe(true);
    expect(
      module.tools.find((tool) => tool.name === "delete_automation")
        ?.annotations?.destructiveHint,
    ).toBe(true);
    expect(
      module.tools.find((tool) => tool.name === "create_automation")
        ?.inputSchema.required,
    ).toContain("request_id");
  });

  it("sends the original creation request id and selects a new execution task by default", async () => {
    const f = fixture(
      { code: "AUTOMATION_LIMIT_REACHED", retryable: false },
      409,
    );
    const input = {
      request_id: id,
      title: "Brief",
      instruction: "Summarize news.",
      schedule: {
        frequency: "daily",
        interval: 1,
        time: "09:00",
        time_zone: "Asia/Shanghai",
      },
    };
    for (let attempt = 0; attempt < 2; attempt += 1)
      await f.call("create_automation", input);
    expect(f.fetch).toHaveBeenCalledTimes(2);
    for (const [, options] of f.fetch.mock.calls) {
      expect(options?.headers).toMatchObject({
        authorization: `Bearer ${token}`,
      });
      expect(JSON.parse(String(options?.body))).toMatchObject({
        ...input,
        operation: "create",
        target: { mode: "new_task" },
      });
    }
  });

  it.each([
    ["get_automation", { automation_id: id }, "get"],
    [
      "update_automation",
      { automation_id: id, changes: { title: "Changed" } },
      "update",
    ],
    ["pause_automation", { automation_id: id }, "pause"],
    ["resume_automation", { automation_id: id }, "resume"],
  ])(
    "maps %s to its explicit service operation",
    async (name, input, operation) => {
      const f = fixture(
        { code: "AUTOMATION_NOT_FOUND", retryable: false },
        404,
      );
      const result = await f.call(String(name), input);
      expect(result.isError).toBe(true);
      expect(JSON.parse(String(f.fetch.mock.calls[0]?.[1]?.body))).toEqual({
        ...(input as object),
        operation,
      });
    },
  );

  it("returns deletion and immediate-run results without claiming completion", async () => {
    const deletion = fixture({ operation: "delete", automation_id: id });
    expect(
      await deletion.call("delete_automation", { automation_id: id }),
    ).toMatchObject({ isError: false });
    const run = fixture({
      operation: "run_now",
      result: { status: "queued", pending_request_id: id },
    });
    expect(
      await run.call("run_automation_now", {
        automation_id: id,
        request_id: id,
      }),
    ).toMatchObject({ isError: false });
    expect(JSON.parse(String(run.fetch.mock.calls[0]?.[1]?.body))).toEqual({
      operation: "run_now",
      automation_id: id,
      request_id: id,
    });
  });

  it("returns a validated list with current task metadata", async () => {
    const result = {
      operation: "list",
      current_task: { id, title: "Current", pinned: false, automation_ids: [] },
      items: [],
      pinned_tasks: [],
    };
    const f = fixture(result);
    expect(await f.call("list_automations", {})).toEqual({
      content: [{ type: "text", text: JSON.stringify(result) }],
      isError: false,
    });
  });

  it.each([{ owner_id: id }, { operation: "delete" }])(
    "rejects unexpected list inputs before network access",
    async (input) => {
      const f = fixture(null);
      expect(await f.call("list_automations", input)).toMatchObject({
        isError: true,
      });
      expect(f.fetch).not.toHaveBeenCalled();
    },
  );

  it("redacts malformed responses and rejects results for another operation", async () => {
    for (const response of [
      { secret: "private-upstream-value" },
      { operation: "delete", automation_id: id },
    ]) {
      const f = fixture(response);
      const result = await f.call("list_automations", {});
      expect(result.isError).toBe(true);
      expect(JSON.stringify(result)).not.toContain("private-upstream-value");
    }
  });
});
