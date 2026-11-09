import { afterEach, describe, expect, it, vi } from "vitest";

import { automationMonitoringCoreMcpModule } from "../src/mcp/core-services/automation-monitoring-service.js";
import { createCoreMcpRegistry } from "../src/mcp/core-service-registry.js";

const endpoint = "http://127.0.0.1:4000/current-task/stop-monitor";
const token = "host-bound-monitoring-token-material";

afterEach(() => vi.restoreAllMocks());

describe("scheduled monitoring Core MCP", () => {
  it("uses only the host-bound task endpoint and token", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(Response.json({ stop_requested: true }));
    const result = await moduleFor(fetcher).callTool({
      toolName: "stop_scheduled_monitor",
      argumentsValue: {},
      signal: new AbortController().signal,
    });

    expect(result).toEqual({
      isError: false,
      content: [
        { type: "text", text: JSON.stringify({ stop_requested: true }) },
      ],
    });
    expect(fetcher).toHaveBeenCalledExactlyOnceWith(
      endpoint,
      expect.objectContaining({
        method: "POST",
        body: "{}",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
        },
        signal: expect.any(AbortSignal),
      }),
    );
  });

  it.each([
    null,
    [],
    { automation_id: "chosen-automation" },
    { owner_id: "chosen-owner" },
    { turn_id: "chosen-turn" },
    { stop_condition: "untrusted override" },
  ])(
    "rejects model-supplied IDs or rules before contacting the host",
    async (argumentsValue) => {
      const fetcher = vi.fn<typeof fetch>();
      const result = await moduleFor(fetcher).callTool({
        toolName: "stop_scheduled_monitor",
        argumentsValue,
        signal: new AbortController().signal,
      });

      expect(result).toMatchObject({ isError: true });
      expect(fetcher).not.toHaveBeenCalled();
    },
  );

  it.each([401, 403, 409, 503])(
    "maps host status %s without leaking internal text or retrying a turn",
    async (status) => {
      const fetcher = vi
        .fn<typeof fetch>()
        .mockResolvedValue(new Response("private host response", { status }));
      const result = await moduleFor(fetcher).callTool({
        toolName: "stop_scheduled_monitor",
        argumentsValue: {},
        signal: new AbortController().signal,
      });

      expect(result).toEqual({
        isError: true,
        content: [
          {
            type: "text",
            text: JSON.stringify({
              code: "AUTOMATION_STOP_UNAVAILABLE",
              retryable: status >= 500,
            }),
          },
        ],
      });
      expect(fetcher).toHaveBeenCalledTimes(1);
      expect(JSON.stringify(result)).not.toContain("private host response");
    },
  );

  it.each([
    { stop_requested: false },
    { stop_requested: true, private_data: "secret" },
  ])("rejects an invalid host acknowledgment", async (payload) => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(Response.json(payload));
    const result = await moduleFor(fetcher).callTool({
      toolName: "stop_scheduled_monitor",
      argumentsValue: {},
      signal: new AbortController().signal,
    });

    expect(result).toMatchObject({ isError: true });
    expect(JSON.stringify(result)).not.toContain("secret");
  });

  it("does not expose a scheduling mutation in Plan mode", async () => {
    const fetcher = vi.fn<typeof fetch>();
    const registry = createCoreMcpRegistry({
      mode: "plan",
      environment: {
        LINKSENSE_CURRENT_USER_ENDPOINT: "http://127.0.0.1:4000/current-user",
        LINKSENSE_CURRENT_USER_TOKEN: token,
        LINKSENSE_KNOWLEDGE_SEARCH_ENDPOINT: "http://127.0.0.1:4000/search",
        LINKSENSE_KNOWLEDGE_SERVICE_TOKEN: token,
        LINKSENSE_FORM_SERVICE_ENDPOINT: "http://127.0.0.1:4000/form",
        LINKSENSE_FORM_SERVICE_TOKEN: token,
      },
      fetch: fetcher,
    });

    expect(registry.tools.map((tool) => tool.name)).not.toContain(
      "stop_scheduled_monitor",
    );
    await expect(
      registry.callTool({
        toolName: "stop_scheduled_monitor",
        argumentsValue: {},
        signal: new AbortController().signal,
      }),
    ).rejects.toThrow("unavailable");
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("propagates MCP cancellation to the in-flight host request", async () => {
    const controller = new AbortController();
    const reason = new Error("MCP call cancelled");
    const fetcher = abortableFetch();
    const result = moduleFor(fetcher).callTool({
      toolName: "stop_scheduled_monitor",
      argumentsValue: {},
      signal: controller.signal,
    });
    const rejected = expect(result).rejects.toBe(reason);
    controller.abort(reason);
    await rejected;
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("bounds a stalled host request without replaying the call", async () => {
    const timeout = new AbortController();
    const timeoutSignal = vi
      .spyOn(AbortSignal, "timeout")
      .mockReturnValue(timeout.signal);
    const fetcher = abortableFetch();
    const result = moduleFor(fetcher).callTool({
      toolName: "stop_scheduled_monitor",
      argumentsValue: {},
      signal: new AbortController().signal,
    });
    expect(timeoutSignal).toHaveBeenCalledWith(15_000);
    timeout.abort(new DOMException("The operation timed out", "TimeoutError"));

    await expect(result).resolves.toMatchObject({ isError: true });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});

function moduleFor(fetcher: typeof fetch) {
  return automationMonitoringCoreMcpModule.create({
    environment: {
      LINKSENSE_AUTOMATION_STOP_ENDPOINT: endpoint,
      LINKSENSE_CURRENT_USER_TOKEN: token,
    },
    workspaceRoot: "/tmp",
    fetch: fetcher,
  });
}

function abortableFetch() {
  return vi.fn<typeof fetch>(
    async (_url, options) =>
      new Promise<Response>((_resolve, reject) => {
        const signal = options?.signal;
        if (!signal) return reject(new Error("missing cancellation signal"));
        if (signal.aborted) return reject(signal.reason);
        signal.addEventListener("abort", () => reject(signal.reason), {
          once: true,
        });
      }),
  );
}
