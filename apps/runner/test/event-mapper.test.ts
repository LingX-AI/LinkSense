import {
  runnerCodexEventSchema,
  runnerCodexPreviewLimits,
} from "@linksense/shared";
import { describe, expect, it } from "vitest";

import {
  deriveSubAgentThreadLabel,
  filterChildOwnedCodexTurns,
  mapCodexNotification,
  mapCodexServerRequest,
  opaqueAgentKey,
  projectCodexSubAgentThread,
} from "../src/codex/event-mapper.js";

const previewContext = {
  workspace: "/srv/link-sense/workspaces/conversation-1",
  codexHome: "/srv/link-sense/codex-homes/conversation-1",
};

describe("mapCodexNotification", () => {
  it("preserves asynchronous questions, including empty message text and free-text questions", () => {
    const item = {
      id: "async-question", type: "agentMessage", text: "", phase: "final_answer",
      delivery: "async", questions: [
        { title: "Which scope?", options: ["Complete", "Minimal"] },
        { title: "Any constraints?", options: null },
      ],
    };
    const events = mapCodexNotification({ method: "item/completed", params: {
      threadId: "thr_1", turnId: "turn_1", completedAtMs: 1, item,
    } });
    expect(events).toMatchObject([{ params: { item } }]);
    expect(runnerCodexEventSchema.safeParse(events[0]).success).toBe(true);
  });

  it.each([true, false])("preserves native rateLimitExceeded with willRetry=%s", (willRetry) => {
    expect(mapCodexNotification({
      method: "error",
      params: {
        threadId: "thr_1", turnId: "turn_1", willRetry,
        error: { message: "Rate limited", codexErrorInfo: "rateLimitExceeded", additionalDetails: null },
      },
    })).toMatchObject([{
      method: "error",
      params: { willRetry, error: { codexErrorInfo: "rateLimitExceeded" } },
    }]);
  });

  it("filters inherited parent turns by id and id-insensitive item prefix", () => {
    const parentTurn = {
      id: "parent-turn",
      status: "completed" as const,
      error: null,
      items: [
        {
          type: "userMessage",
          id: "parent-user",
          content: [{ type: "text", text: "parent prompt", text_elements: [] }],
        },
        {
          type: "agentMessage",
          id: "parent-answer",
          text: "parent answer",
          phase: "final_answer" as const,
        },
      ],
    };
    const inheritedPrefix = {
      id: "copied-parent-turn",
      status: "interrupted" as const,
      error: null,
      items: [
        {
          type: "userMessage",
          id: "copied-user-id",
          content: [{ type: "text", text: "parent prompt", text_elements: [] }],
        },
      ],
    };
    const childTurn = {
      id: "child-owned-turn",
      status: "inProgress" as const,
      error: null,
      items: [],
    };

    expect(
      filterChildOwnedCodexTurns(
        [parentTurn],
        [{ ...parentTurn }, inheritedPrefix, childTurn],
      ).map((turn) => turn.id),
    ).toEqual(["child-owned-turn"]);
  });

  it("keeps the native method and normalizes a thread name", () => {
    const events = mapCodexNotification({
      method: "thread/name/updated",
      params: {
        threadId: "thr_1",
        threadName: "  查看   LinkSense\n模型  ",
      },
    });

    expect(events).toEqual([
      {
        method: "thread/name/updated",
        visibility: "user_visible",
        params: {
          threadId: "thr_1",
          threadName: "查看 LinkSense 模型",
        },
      },
    ]);
    expect(runnerCodexEventSchema.safeParse(events[0]).success).toBe(true);
  });

  it("ignores missing or blank native thread names", () => {
    expect(
      mapCodexNotification({
        method: "thread/name/updated",
        params: { threadId: "thr_1", threadName: null },
      }),
    ).toEqual([]);
    expect(
      mapCodexNotification({
        method: "thread/name/updated",
        params: { threadId: "thr_1", threadName: " \n " },
      }),
    ).toEqual([]);
  });

  it("forwards validated native Goal updates and clears without changing status semantics", () => {
    const goal = {
      threadId: "thr_1",
      objective: "完整实现目标功能",
      status: "active",
      tokenBudget: 12_000,
      tokensUsed: 800,
      timeUsedSeconds: 38,
      createdAt: 1_785_996_000,
      updatedAt: 1_785_996_038,
    };

    expect(
      mapCodexNotification({
        method: "thread/goal/updated",
        params: { threadId: "thr_1", turnId: null, goal },
      }),
    ).toEqual([
      {
        method: "thread/goal/updated",
        visibility: "user_visible",
        params: { threadId: "thr_1", turnId: null, goal },
      },
    ]);
    expect(
      mapCodexNotification({
        method: "thread/goal/cleared",
        params: { threadId: "thr_1" },
      }),
    ).toEqual([
      {
        method: "thread/goal/cleared",
        visibility: "user_visible",
        params: { threadId: "thr_1" },
      },
    ]);
    expect(
      mapCodexNotification({
        method: "thread/goal/updated",
        params: {
          threadId: "thr_1",
          turnId: null,
          goal: { ...goal, threadId: "different-thread" },
        },
      }),
    ).toEqual([]);
  });

  it("forwards only validated native token usage as an internal event", () => {
    const events = mapCodexNotification({
      method: "thread/tokenUsage/updated",
      params: {
        threadId: "thr_1",
        turnId: "turn_1",
        tokenUsage: {
          total: {
            totalTokens: 180,
            inputTokens: 120,
            cachedInputTokens: 40,
            cacheWriteInputTokens: 5,
            outputTokens: 60,
            reasoningOutputTokens: 20,
          },
          last: {
            totalTokens: 80,
            inputTokens: 50,
            cachedInputTokens: 10,
            cacheWriteInputTokens: 2,
            outputTokens: 30,
            reasoningOutputTokens: 8,
          },
          modelContextWindow: 200_000,
        },
      },
    });

    expect(events).toEqual([
      {
        method: "thread/tokenUsage/updated",
        visibility: "internal_sanitized",
        params: {
          threadId: "thr_1",
          turnId: "turn_1",
          tokenUsage: {
            total: {
              totalTokens: 180,
              inputTokens: 120,
              cachedInputTokens: 40,
              outputTokens: 60,
              reasoningOutputTokens: 20,
            },
            last: {
              totalTokens: 80,
              inputTokens: 50,
              cachedInputTokens: 10,
              outputTokens: 30,
              reasoningOutputTokens: 8,
            },
            modelContextWindow: 200_000,
          },
        },
      },
    ]);
    expect(runnerCodexEventSchema.safeParse(events[0]).success).toBe(true);
    expect(
      mapCodexNotification({
        method: "thread/tokenUsage/updated",
        params: {
          threadId: "thr_1",
          turnId: "turn_1",
          tokenUsage: {
            total: {
              totalTokens: -1,
              inputTokens: 0,
              cachedInputTokens: 0,
              outputTokens: 0,
              reasoningOutputTokens: 0,
            },
            last: {},
            modelContextWindow: null,
          },
        },
      }),
    ).toEqual([]);
  });

  it("forwards retryable and terminal errors with sanitized failure messages", () => {
    const retryable = mapCodexNotification({
      method: "error",
      params: {
        threadId: "thr_1",
        turnId: "turn_1",
        willRetry: true,
        error: {
          message: "Provider connection failed at /internal/provider/path",
          codexErrorInfo: {
            responseStreamDisconnected: { httpStatusCode: 502 },
          },
          additionalDetails: "provider-secret-response",
        },
      },
    });
    const terminal = mapCodexNotification({
      method: "error",
      params: {
        threadId: "thr_1",
        turnId: "turn_1",
        willRetry: false,
        error: {
          message: "Unauthorized: api_key=api-key-secret",
          codexErrorInfo: "unauthorized",
          additionalDetails: null,
        },
      },
    });
    const sessionBudget = mapCodexNotification({
      method: "error",
      params: {
        threadId: "thr_1",
        turnId: "turn_1",
        willRetry: false,
        error: {
          message: "The session budget is exhausted.",
          codexErrorInfo: "sessionBudgetExceeded",
          additionalDetails: null,
        },
      },
    });

    expect(retryable).toEqual([
      {
        method: "error",
        visibility: "user_collapsed",
        params: {
          threadId: "thr_1",
          turnId: "turn_1",
          willRetry: true,
          error: {
            message: "Provider connection failed at $ABSOLUTE/path",
            codexErrorInfo: {
              responseStreamDisconnected: { httpStatusCode: 502 },
            },
          },
        },
      },
    ]);
    expect(terminal[0]).toMatchObject({
      method: "error",
      visibility: "user_visible",
      params: {
        willRetry: false,
        error: {
          message: "Unauthorized: api_key=[REDACTED]",
          codexErrorInfo: "unauthorized",
        },
      },
    });
    expect(sessionBudget[0]).toMatchObject({
      method: "error",
      params: {
        error: { codexErrorInfo: "sessionBudgetExceeded" },
      },
    });
    expect(
      JSON.stringify([...retryable, ...terminal, ...sessionBudget]),
    ).not.toMatch(
      /internal\/provider|provider-secret-response|api-key-secret/u,
    );
  });

  it("emits one native terminal event and sanitizes its turn snapshot", () => {
    const events = mapCodexNotification({
      method: "turn/completed",
      params: {
        threadId: "thr_1",
        turn: {
          id: "turn_1",
          status: "failed",
          itemsView: "full",
          items: [
            {
              type: "agentMessage",
              id: "message-1",
              text: "可以向用户展示的回复",
              phase: "final_answer",
            },
            {
              type: "commandExecution",
              id: "command-1",
              status: "failed",
              command: "cat /private/token",
              cwd: "/private/workspace",
              aggregatedOutput: "token=secret",
              commandActions: [
                {
                  type: "read",
                  command: "cat /private/token",
                  name: "token",
                  path: "/private/token",
                },
              ],
            },
          ],
          error: {
            message: "The model provider quota is exhausted.",
            codexErrorInfo: "usageLimitExceeded",
            additionalDetails: "provider response",
          },
          durationMs: 42,
        },
      },
    });

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      method: "turn/completed",
      params: {
        threadId: "thr_1",
        turn: {
          id: "turn_1",
          status: "failed",
          itemsView: "full",
          error: {
            message: "The model provider quota is exhausted.",
            codexErrorInfo: "usageLimitExceeded",
          },
        },
      },
    });
    expect(events[0]?.method).toBe("turn/completed");
    if (events[0]?.method !== "turn/completed") {
      throw new Error("expected one native turn/completed event");
    }
    expect(events[0].params.turn).not.toHaveProperty("items");
    expect(JSON.stringify(events)).not.toMatch(
      /可以向用户展示|cat \/private|private\/workspace|token=secret|provider response/u,
    );
    expect(runnerCodexEventSchema.safeParse(events[0]).success).toBe(true);
  });

  it("projects hook lifecycle metadata without exposing hook sources or output", () => {
    const rawRun = {
      id: "stop:0:/opt/linksense/runtime/node/plan-stop-hook.mjs",
      eventName: "stop",
      handlerType: "command",
      executionMode: "sync",
      scope: "turn",
      sourcePath: "/opt/linksense/runtime/node/plan-stop-hook.mjs",
      source: "system",
      displayOrder: 0,
      status: "blocked",
      statusMessage: "private hook status",
      startedAt: 1_752_192_000_000,
      completedAt: 1_752_192_000_025,
      durationMs: 25,
      entries: [
        { kind: "feedback", text: "private hook feedback and prompt" },
      ],
    };

    const started = mapCodexNotification({
      method: "hook/started",
      params: {
        threadId: "thr_1",
        turnId: null,
        run: { ...rawRun, status: "running" },
      },
    });
    const completed = mapCodexNotification({
      method: "hook/completed",
      params: { threadId: "thr_1", turnId: "turn_1", run: rawRun },
    });
    const correlated = mapCodexNotification(
      {
        method: "hook/completed",
        params: { threadId: "thr_1", turnId: "turn_1", run: rawRun },
      },
      {},
      { supersededItemId: "final-message-1" },
    );
    const interrupted = mapCodexNotification({
      method: "hook/completed",
      params: {
        threadId: "thr_1",
        turnId: "turn_1",
        run: { ...rawRun, eventName: "interrupt", status: "completed" },
      },
    });

    expect(started).toEqual([
      {
        method: "hook/started",
        visibility: "user_collapsed",
        params: {
          threadId: "thr_1",
          turnId: null,
          run: { eventName: "stop", status: "running" },
        },
      },
    ]);
    expect(completed).toEqual([
      {
        method: "hook/completed",
        visibility: "user_collapsed",
        params: {
          threadId: "thr_1",
          turnId: "turn_1",
          run: { eventName: "stop", status: "blocked" },
        },
      },
    ]);
    expect(correlated).toEqual([
      {
        method: "hook/completed",
        visibility: "user_collapsed",
        params: {
          threadId: "thr_1",
          turnId: "turn_1",
          run: { eventName: "stop", status: "blocked" },
          supersededItemId: "final-message-1",
        },
      },
    ]);
    expect(interrupted).toEqual([
      {
        method: "hook/completed",
        visibility: "user_collapsed",
        params: {
          threadId: "thr_1",
          turnId: "turn_1",
          run: { eventName: "interrupt", status: "completed" },
        },
      },
    ]);
    expect(
      [...started, ...completed, ...correlated].every(
        (event) => runnerCodexEventSchema.safeParse(event).success,
      ),
    ).toBe(true);
    expect(JSON.stringify([...started, ...completed, ...correlated])).not.toMatch(
      /sourcePath|stop:0:|plan-stop-hook|entries|private hook|\/opt\/linksense/u,
    );

    for (const params of [
      { threadId: "thr_1", run: rawRun },
      {
        threadId: "thr_1",
        turnId: "turn_1",
        run: { ...rawRun, eventName: "Stop" },
      },
      {
        threadId: "thr_1",
        turnId: "turn_1",
        run: { ...rawRun, status: "unknown" },
      },
    ]) {
      expect(
        mapCodexNotification({ method: "hook/completed", params }),
      ).toEqual([]);
    }
  });

  it("retains final and commentary message phases on native item completion", () => {
    for (const phase of ["commentary", "final_answer", null] as const) {
      const events = mapCodexNotification({
        method: "item/completed",
        params: {
          threadId: "thr_1",
          turnId: "turn_1",
          completedAtMs: 1_752_192_000_000,
          item: {
            type: "agentMessage",
            id: `message-${phase ?? "unknown"}`,
            text: "authorized assistant response",
            phase,
            memoryCitation: {
              path: "/private/memory",
              note: "private citation",
            },
          },
        },
      });

      expect(events).toEqual([
        {
          method: "item/completed",
          visibility: "user_visible",
          params: {
            threadId: "thr_1",
            turnId: "turn_1",
            completedAtMs: 1_752_192_000_000,
            item: {
              type: "agentMessage",
              id: `message-${phase ?? "unknown"}`,
              text: "authorized assistant response",
              phase,
            },
          },
        },
      ]);
      expect(JSON.stringify(events)).not.toContain("private/memory");
    }
  });

  it("keeps redacted command previews while dropping cwd, output, and tool payloads", () => {
    const command = mapCodexNotification(
      {
        method: "item/completed",
        params: {
          threadId: "thr_1",
          turnId: "turn_1",
          item: {
            type: "commandExecution",
            id: "command-1",
            source: "agent",
            status: "completed",
            command:
              "\u001b[31mAWS_SECRET_ACCESS_KEY=raw-aws CLIENT_SECRET='raw client secret' pnpm test\n--config /srv/link-sense/workspaces/conversation-1/package.json --cache /srv/link-sense/codex-homes/conversation-1/cache --input /private/secret.txt >/private/export.txt --token raw-token API key: raw-api Authorization: Bearer raw-bearer",
            cwd: "/private/path",
            aggregatedOutput: "credential=raw-output",
            stdout: "private stdout",
            stderr: "private stderr",
            exitCode: 0,
            durationMs: 25,
            commandActions: [
              {
                type: "read",
                command:
                  "cat /srv/link-sense/workspaces/conversation-1/README.md --password=raw-password",
                name: "README --token raw-name-token",
                path: "/srv/link-sense/workspaces/conversation-1/README.md",
              },
              {
                type: "listFiles",
                command: "find /srv/link-sense/workspaces/conversation-1/src",
                path: null,
              },
              {
                type: "search",
                command:
                  "rg report /srv/link-sense/workspaces/conversation-1/src",
                query: "report --token raw-query-token",
                path: "/srv/link-sense/workspaces/conversation-1/src",
              },
            ],
          },
        },
      },
      previewContext,
    );
    const mcp = mapCodexNotification({
      method: "item/started",
      params: {
        threadId: "thr_1",
        turnId: "turn_1",
        item: {
          type: "mcpToolCall",
          id: "mcp-1",
          server: "documents-server",
          tool: "create",
          pluginId: "documents-plugin",
          status: "inProgress",
          arguments: { token: "secret-field" },
          result: { content: ["private result"] },
          error: { message: "private error" },
        },
      },
    });
    const dynamic = mapCodexNotification({
      method: "item/completed",
      params: {
        threadId: "thr_1",
        turnId: "turn_1",
        item: {
          type: "dynamicToolCall",
          id: "dynamic-1",
          namespace: "visuals",
          tool: "render",
          status: "completed",
          success: true,
          contentItems: [{ type: "text", text: "private dynamic output" }],
        },
      },
    });

    expect(command).toHaveLength(1);
    expect(command[0]).toMatchObject({
      method: "item/completed",
      visibility: "user_collapsed",
      params: {
        threadId: "thr_1",
        turnId: "turn_1",
        item: {
          type: "commandExecution",
          id: "command-1",
          source: "agent",
          status: "completed",
          commandActions: [
            {
              type: "read",
              command: "cat $WORKSPACE/README.md --password=[REDACTED]",
              name: "README --token [REDACTED]",
              path: "$WORKSPACE/README.md",
            },
            {
              type: "listFiles",
              command: "find $WORKSPACE/src",
              path: null,
            },
            {
              type: "search",
              command: "rg report $WORKSPACE/src",
              query: "report --token [REDACTED]",
              path: "$WORKSPACE/src",
            },
          ],
          exitCode: 0,
          durationMs: 25,
        },
      },
    });
    const commandText = JSON.stringify(command);
    expect(commandText).toContain("$WORKSPACE/package.json");
    expect(commandText).toContain("$CODEX_HOME/cache");
    expect(commandText).toContain(">$ABSOLUTE/export.txt");
    expect(commandText).toContain("AWS_SECRET_ACCESS_KEY=[REDACTED]");
    expect(commandText).toContain("CLIENT_SECRET=[REDACTED]");
    expect(commandText).not.toContain("--token raw-token");
    expect(commandText).not.toContain("raw-name-token");
    expect(commandText).not.toContain("raw-query-token");
    expect(commandText).toContain("[REDACTED]");
    expect(commandText).not.toContain("\u001b");
    expect(mcp[0]).toMatchObject({
      method: "item/started",
      params: {
        item: {
          type: "mcpToolCall",
          id: "mcp-1",
          server: "documents-server",
          tool: "create",
          pluginId: "documents-plugin",
          status: "inProgress",
        },
      },
    });
    expect(dynamic[0]).toMatchObject({
      params: {
        item: {
          type: "dynamicToolCall",
          namespace: "visuals",
          tool: "render",
          status: "completed",
          success: true,
        },
      },
    });
    expect(JSON.stringify([...command, ...mcp, ...dynamic])).not.toMatch(
      /srv\/link-sense|private\/path|raw-output|private stdout|private stderr|raw-aws|raw client secret|raw-token|raw-api|raw-bearer|raw-password|secret-field|private result|private error|private dynamic output/u,
    );
    expect(
      [...command, ...mcp, ...dynamic].every(
        (event) => runnerCodexEventSchema.safeParse(event).success,
      ),
    ).toBe(true);
  });

  it("projects only the no-available-bases outcome from knowledge search results", () => {
    const noAvailableBases = mapCodexNotification({
      method: "item/completed",
      params: {
        threadId: "thr_1",
        turnId: "turn_1",
        item: {
          type: "mcpToolCall",
          id: "knowledge-search-no-bases",
          server: "linksense_core",
          tool: "search_knowledge_base",
          status: "completed",
          arguments: { query: "private knowledge query" },
          result: {
            content: [
              {
                type: "text",
                text: JSON.stringify({
                  code: "KNOWLEDGE_NO_AVAILABLE_BASES",
                  retryable: false,
                }),
              },
              { type: "text", text: "private secondary result" },
            ],
          },
          error: null,
        },
      },
    });
    const genericFailure = mapCodexNotification({
      method: "item/completed",
      params: {
        threadId: "thr_1",
        turnId: "turn_1",
        item: {
          type: "mcpToolCall",
          id: "knowledge-search-unavailable",
          server: "linksense_core",
          tool: "search_knowledge_base",
          status: "failed",
          result: {
            content: [
              {
                type: "text",
                text: JSON.stringify({
                  code: "KNOWLEDGE_SEARCH_UNAVAILABLE",
                  retryable: true,
                }),
              },
            ],
          },
        },
      },
    });
    const unrelatedServer = mapCodexNotification({
      method: "item/completed",
      params: {
        threadId: "thr_1",
        turnId: "turn_1",
        item: {
          type: "mcpToolCall",
          id: "other-search-no-bases",
          server: "other_service",
          tool: "search_knowledge_base",
          status: "completed",
          result: {
            content: [
              {
                type: "text",
                text: JSON.stringify({
                  code: "KNOWLEDGE_NO_AVAILABLE_BASES",
                  retryable: false,
                }),
              },
            ],
          },
        },
      },
    });

    expect(completedItem(noAvailableBases)).toEqual({
      type: "mcpToolCall",
      id: "knowledge-search-no-bases",
      server: "linksense_core",
      tool: "search_knowledge_base",
      status: "completed",
      failureCode: "KNOWLEDGE_NO_AVAILABLE_BASES",
    });
    expect(completedItem(genericFailure)).not.toHaveProperty("failureCode");
    expect(completedItem(unrelatedServer)).not.toHaveProperty("failureCode");

    const serialized = JSON.stringify([
      ...noAvailableBases,
      ...genericFailure,
      ...unrelatedServer,
    ]);
    expect(serialized).not.toMatch(
      /private knowledge query|private secondary result|retryable|arguments|result|error/u,
    );
  });

  it("sanitizes tool identity and status fields before exposing them", () => {
    const mcp = mapCodexNotification({
      method: "item/completed",
      params: {
        threadId: "thr_1",
        turnId: "turn_1",
        item: {
          type: "mcpToolCall",
          id: "mcp-sensitive-identity",
          server: "token=raw-server-secret",
          tool: "/Users/one/private/tool",
          pluginId: "\u001b[31mplugin",
          status: "completed",
        },
      },
    });
    const dynamic = mapCodexNotification({
      method: "item/completed",
      params: {
        threadId: "thr_1",
        turnId: "turn_1",
        item: {
          type: "dynamicToolCall",
          id: "dynamic-sensitive-identity",
          namespace: "Authorization: Bearer raw-namespace-secret",
          tool: "file:///Users/one/private/tool",
          status: "completed",
          success: true,
        },
      },
    });
    const imageGeneration = mapCodexNotification({
      method: "item/completed",
      params: {
        threadId: "thr_1",
        turnId: "turn_1",
        item: {
          type: "imageGeneration",
          id: "image-generation-sensitive-status",
          status: "ｔｏｋｅｎ＝raw-status-secret",
        },
      },
    });

    expect(completedItem(mcp)).toMatchObject({
      type: "mcpToolCall",
      server: "token=[REDACTED]",
      tool: "$ABSOLUTE/tool",
      pluginId: "plugin",
    });
    expect(completedItem(dynamic)).toMatchObject({
      type: "dynamicToolCall",
      namespace: "Authorization: [REDACTED]",
      tool: "$ABSOLUTE/tool",
    });
    expect(completedItem(imageGeneration)).toMatchObject({
      type: "imageGeneration",
      status: "token=[REDACTED]",
    });
    const serialized = JSON.stringify([...mcp, ...dynamic, ...imageGeneration]);
    expect(serialized).not.toMatch(
      /raw-server-secret|Users\/one\/private|raw-namespace-secret|raw-status-secret/u,
    );
    expect(serialized).not.toContain("\u001b");
    expect(
      [...mcp, ...dynamic, ...imageGeneration].every(
        (event) => runnerCodexEventSchema.safeParse(event).success,
      ),
    ).toBe(true);
  });

  it("canonicalizes Unicode and invisible characters before secret and path detection", () => {
    const command = mapCodexNotification({
      method: "item/completed",
      params: {
        threadId: "thr_1",
        turnId: "turn_1",
        item: {
          type: "commandExecution",
          id: "command-unicode-security",
          status: "completed",
          command:
            "tool --ｔｏｋｅｎ＝raw-fullwidth --to\u200bken=raw-zero-width --to\u0000ken raw-c0 --to\u0080ken raw-c1 open \u200b/Users/one/private/zero-width.txt open file：///Users/one/private/fullwidth-colon.txt open ⁄Users⁄one⁄private⁄fraction-slash.txt",
          commandActions: [],
        },
      },
    });

    const item = completedItem(command);
    if (item.type !== "commandExecution") {
      throw new Error("expected commandExecution");
    }
    expect(item.command).toContain("--token=[REDACTED]");
    expect(item.command).toContain("--token [REDACTED]");
    expect(item.command).toContain("$ABSOLUTE/zero-width.txt");
    expect(item.command).toContain("$ABSOLUTE/fullwidth-colon.txt");
    expect(item.command).toContain("$ABSOLUTE/fraction-slash.txt");
    expect(item.command).not.toMatch(
      /raw-fullwidth|raw-zero-width|raw-c0|raw-c1|Users/u,
    );
    expect(hasControlCharacter(item.command ?? "")).toBe(false);
    expect(item.command).not.toContain("\u200b");
    expect(runnerCodexEventSchema.safeParse(command[0]).success).toBe(true);
  });

  it("redacts nested, shell-joined, and malformed-percent sensitive assignments", () => {
    const leakedValues = Array.from(
      { length: 17 },
      (_, index) => `leak-value-${index + 1}`,
    );
    const command = mapCodexNotification({
      method: "item/completed",
      params: {
        threadId: "thr_1",
        turnId: "turn_1",
        item: {
          type: "commandExecution",
          id: "command-sensitive-key-grammars",
          status: "completed",
          command: [
            `access_token[]=${leakedValues[0]}`,
            `token[value]=${leakedValues[1]}`,
            `credentials[password]=${leakedValues[2]}`,
            `api.key=${leakedValues[3]}`,
            `X-Amz-Signature=${leakedValues[4]}`,
            `sig=${leakedValues[5]}`,
            `signature=${leakedValues[6]}`,
            `session_id=${leakedValues[7]}`,
            `jwt=${leakedValues[8]}`,
            `passwd=${leakedValues[9]}`,
            `pwd=${leakedValues[10]}`,
            `--to\\ken=${leakedValues[11]}`,
            `--to''ken=${leakedValues[12]}`,
            `--to""ken=${leakedValues[13]}`,
            `--to$''ken=${leakedValues[14]}`,
            `--to%ZZken=${leakedValues[15]}`,
            `https://example.test/?access_token[]=${leakedValues[16]}`,
          ].join(" "),
          commandActions: [],
        },
      },
    });

    const item = completedItem(command);
    if (item.type !== "commandExecution") {
      throw new Error("expected commandExecution");
    }
    expect(item.command).toContain("access_token[]=[REDACTED]");
    expect(item.command).toContain("credentials[password]=[REDACTED]");
    expect(item.command).toContain("X-Amz-Signature=[REDACTED]");
    expect(item.command).toContain("--token=[REDACTED]");
    expect(item.command).toContain("--to%ZZken=[REDACTED]");
    for (const leakedValue of leakedValues) {
      expect(item.command).not.toContain(leakedValue);
    }
    expect(runnerCodexEventSchema.safeParse(command[0]).success).toBe(true);
  });

  it("redacts high-confidence bare credential formats", () => {
    const credentials = [
      ["ghp_", "abcdefghijklmnopqrstuvwxyz1234567890"].join(""),
      ["github_pat_", "11AA22BB33CC44DD55EE66FF77GG88HH"].join(""),
      ["xoxb-", "123456789012-abcdefghijklmnopqrstuv"].join(""),
      [
        "eyJhbGciOiJIUzI1NiJ9.",
        "eyJzdWIiOiJ1c2VyMTIzIn0.abcdEFGHijklMNOP1234",
      ].join(""),
      ["AKIA", "1234567890ABCDEF"].join(""),
      ["ASIA", "1234567890ABCDEF"].join(""),
      ["AIza", "abcdefghijklmnopqrstuvwxyz1234567890"].join(""),
      ["npm_", "abcdefghijklmnopqrstuvwxyz1234567890"].join(""),
      ["glpat-", "abcdefghijklmnopqrstuvwxyz1234567890"].join(""),
      ["sk_live_", "abcdefghijklmnopqrstuvwxyz"].join(""),
    ];
    const command = mapCodexNotification({
      method: "item/completed",
      params: {
        threadId: "thr_1",
        turnId: "turn_1",
        item: {
          type: "commandExecution",
          id: "command-bare-credentials",
          status: "completed",
          command: `tool ${credentials.join(" ")}`,
          commandActions: [],
        },
      },
    });

    const item = completedItem(command);
    if (item.type !== "commandExecution") {
      throw new Error("expected commandExecution");
    }
    for (const credential of credentials) {
      expect(item.command).not.toContain(credential);
    }
    expect(item.command?.match(/\[REDACTED\]/gu)).toHaveLength(
      credentials.length,
    );
    expect(runnerCodexEventSchema.safeParse(command[0]).success).toBe(true);
  });

  it("redacts shell-expanded home paths in command and path previews", () => {
    const command = mapCodexNotification({
      method: "item/completed",
      params: {
        threadId: "thr_1",
        turnId: "turn_1",
        item: {
          type: "commandExecution",
          id: "command-home-paths",
          status: "completed",
          command:
            "open ~/PRIVATE_DIR/report-a.txt ~one/private/report-b.txt $HOME/private/report-c.txt ${HOME}/private/report-d.txt $USERPROFILE\\private\\report-e.txt ${USERPROFILE}\\private\\report-f.txt $home/private/report-g.txt ${home}/private/report-h.txt $userprofile\\private\\report-i.txt ${userprofile}\\private\\report-j.txt",
          commandActions: [],
        },
      },
    });
    const image = mapCodexNotification({
      method: "item/completed",
      params: {
        threadId: "thr_1",
        turnId: "turn_1",
        item: {
          type: "imageView",
          id: "image-home-path",
          path: "${home}/private/preview.png",
        },
      },
    });
    const file = mapCodexNotification({
      method: "item/completed",
      params: {
        threadId: "thr_1",
        turnId: "turn_1",
        item: {
          type: "fileChange",
          id: "file-home-paths",
          status: "completed",
          changes: [
            { kind: { type: "update" }, path: "${HOME}/private/change-a.ts" },
            {
              kind: { type: "add" },
              path: "$USERPROFILE\\private\\change-b.ts",
            },
          ],
        },
      },
    });

    const commandItem = completedItem(command);
    if (commandItem.type !== "commandExecution") {
      throw new Error("expected commandExecution");
    }
    for (const basename of [
      "report-a.txt",
      "report-b.txt",
      "report-c.txt",
      "report-d.txt",
      "report-e.txt",
      "report-f.txt",
      "report-g.txt",
      "report-h.txt",
      "report-i.txt",
      "report-j.txt",
    ]) {
      expect(commandItem.command).toContain(`$ABSOLUTE/${basename}`);
    }
    expect(completedItem(image)).toMatchObject({
      type: "imageView",
      path: "$ABSOLUTE/preview.png",
    });
    expect(completedItem(file)).toMatchObject({
      type: "fileChange",
      changes: [
        { path: "$ABSOLUTE/change-a.ts" },
        { path: "$ABSOLUTE/change-b.ts" },
      ],
    });
    expect(JSON.stringify([command, image, file])).not.toMatch(
      /PRIVATE_DIR|~one|\$\{?HOME\}?|USERPROFILE|\\private/iu,
    );
  });

  it("does not let malformed ANSI controls consume absolute path evidence", () => {
    const command = mapCodexNotification({
      method: "item/completed",
      params: {
        threadId: "thr_1",
        turnId: "turn_1",
        item: {
          type: "commandExecution",
          id: "command-malformed-ansi-paths",
          status: "completed",
          command:
            "open \u001b[31/Users/one/private/report-a.txt open \u009b31/Users/one/private/report-b.txt open \u001b]title=/Users/one/private/report-c.txt open \u001b[31C:\\Users\\one\\private\\report-d.txt",
          commandActions: [],
        },
      },
    });
    const image = mapCodexNotification({
      method: "item/completed",
      params: {
        threadId: "thr_1",
        turnId: "turn_1",
        item: {
          type: "imageView",
          id: "image-malformed-ansi-path",
          path: "\u001b[31/Users/one/private/preview.png",
        },
      },
    });

    const commandItem = completedItem(command);
    if (commandItem.type !== "commandExecution") {
      throw new Error("expected commandExecution");
    }
    for (const basename of [
      "report-a.txt",
      "report-b.txt",
      "report-c.txt",
      "report-d.txt",
    ]) {
      expect(commandItem.command).toContain(`$ABSOLUTE/${basename}`);
    }
    expect(commandItem.command).not.toMatch(/Users|private/u);
    expect(commandItem.command).not.toContain("\u001b");
    expect(commandItem.command).not.toContain("\u009b");
    expect(hasControlCharacter(commandItem.command ?? "")).toBe(false);
    expect(completedItem(image)).toMatchObject({
      type: "imageView",
      path: "$ABSOLUTE/preview.png",
    });
    expect(runnerCodexEventSchema.safeParse(command[0]).success).toBe(true);
    expect(runnerCodexEventSchema.safeParse(image[0]).success).toBe(true);
  });

  it("redacts common secret flags and local file URIs without dropping lifecycle events", () => {
    const command = mapCodexNotification({
      method: "item/completed",
      params: {
        threadId: "thr_1",
        turnId: "turn_1",
        item: {
          type: "commandExecution",
          id: "command-sensitive-flags",
          status: "completed",
          command:
            "tool --client-secret raw-client --secret-access-key raw-access --private-key raw-private file:///Users/one/private/report.txt file:\\Users\\one\\private\\raw-backslash.txt file:///%2FUsers%2Fone%2Fprivate%2Fencoded-report.txt file:///%252FUsers%252Fone%252Fprivate%252Fdouble-encoded-report.txt file:///%2525252525252FUsers%2525252525252Fone%2525252525252Fprivate%2525252525252Fdeep-report.txt file:///%E0%A4%A",
          commandActions: [],
        },
      },
    });

    const item = completedItem(command);
    if (item.type !== "commandExecution") {
      throw new Error("expected commandExecution");
    }
    expect(item.command).toContain("--client-secret [REDACTED]");
    expect(item.command).toContain("--secret-access-key [REDACTED]");
    expect(item.command).toContain("--private-key [REDACTED]");
    expect(item.command).toContain("$ABSOLUTE/report.txt");
    expect(item.command).toContain("$ABSOLUTE/raw-backslash.txt");
    expect(item.command).toContain("$ABSOLUTE/encoded-report.txt");
    expect(item.command).toContain("$ABSOLUTE/double-encoded-report.txt");
    expect(item.command).toContain("$ABSOLUTE/[REDACTED]");
    expect(item.command).not.toContain("Users");
    expect(JSON.stringify(command)).not.toMatch(
      /raw-client|raw-access|raw-private|Users(?:\/|%2F|%252F)one(?:\/|%2F|%252F)private/iu,
    );
  });

  it("redacts absolute paths when the URI scheme or separators are percent encoded", () => {
    const command = mapCodexNotification({
      method: "item/completed",
      params: {
        threadId: "thr_1",
        turnId: "turn_1",
        item: {
          type: "commandExecution",
          id: "command-encoded-paths",
          status: "completed",
          command:
            "open file:%2F%2F%2FUsers%2Fone%2Fprivate%2Freport-a.txt file%3A%2F%2F%2FUsers%2Fone%2Fprivate%2Freport-b.txt %2FUsers%2Fone%2Fprivate%2Freport-c.txt $ABSOLUTE%2FUsers%2Fone%2Fprivate%2Freport-d.txt %43%3A%5CUsers%5Cone%5Cprivate%5Creport-e.txt %1B%2FUsers%2Fone%2Fprivate%2Freport-f.txt %00%2FUsers%2Fone%2Fprivate%2Freport-g.txt %7F%2FUsers%2Fone%2Fprivate%2Freport-h.txt %1B%5B31m%2FUsers%2Fone%2Fprivate%2Freport-i.txt file:%1B%2F%2F%2FUsers%2Fone%2Fprivate%2Freport-j.txt file:%5CUsers%5Cone%5Cprivate%5Creport-k.txt %E0%A4%A%1B%2FUsers%2Fone%2Fprivate%2Freport-l.txt %E0%A4%A%1B%5B31m%2FUsers%2Fone%2Fprivate%2Freport-m.txt %E0%A4%A%1B%43%3A%5CUsers%5Cone%5Cprivate%5Creport-n.txt %E0%A4%A%1B%5C%5Cserver%5Cshare%5Creport-o.txt %E0%A4%A%C2%9B31m%2FUsers%2Fone%2Fprivate%2Freport-p.txt %E0%A4%A%2FUsers%2Fone%2Fprivate%2Freport-q.txt %E0%2FUsers%2Fone%2Fprivate%2Freport-r.txt %ZZ%2FUsers%2Fone%2Fprivate%2Freport-s.txt %ZZ%43%3A%5CUsers%5Cone%5Cprivate%5Creport-t.txt %ZZ%5C%5Cserver%5Cshare%5Creport-u.txt %ZZ/Users/one/private/report-v.txt",
          commandActions: [],
        },
      },
    });

    const item = completedItem(command);
    if (item.type !== "commandExecution") {
      throw new Error("expected commandExecution");
    }
    expect(item.command).not.toMatch(/Users|%2FUsers|%5CUsers/iu);
    expect(item.command).toContain("$ABSOLUTE/report-a.txt");
    expect(item.command).toContain("$ABSOLUTE/report-b.txt");
    expect(item.command).toContain("$ABSOLUTE/report-c.txt");
    expect(item.command).toContain("$ABSOLUTE/report-d.txt");
    expect(item.command).toContain("$ABSOLUTE/report-e.txt");
    expect(item.command).toContain("$ABSOLUTE/report-f.txt");
    expect(item.command).toContain("$ABSOLUTE/report-g.txt");
    expect(item.command).toContain("$ABSOLUTE/report-h.txt");
    expect(item.command).toContain("$ABSOLUTE/report-i.txt");
    expect(item.command).toContain("$ABSOLUTE/report-j.txt");
    expect(item.command).toContain("$ABSOLUTE/report-k.txt");
    expect(item.command).toContain("$ABSOLUTE/report-l.txt");
    expect(item.command).toContain("$ABSOLUTE/report-m.txt");
    expect(item.command).toContain("$ABSOLUTE/report-n.txt");
    expect(item.command).toContain("$ABSOLUTE/report-o.txt");
    expect(item.command).toContain("$ABSOLUTE/report-p.txt");
    expect(item.command).toContain("$ABSOLUTE/report-q.txt");
    expect(item.command).toContain("$ABSOLUTE/report-r.txt");
    expect(item.command).toContain("$ABSOLUTE/report-s.txt");
    expect(item.command).toContain("$ABSOLUTE/report-t.txt");
    expect(item.command).toContain("$ABSOLUTE/report-u.txt");
    expect(item.command).toContain("$ABSOLUTE/report-v.txt");
    expect(hasControlCharacter(item.command ?? "")).toBe(false);
    expect(runnerCodexEventSchema.safeParse(command[0]).success).toBe(true);
  });

  it("normalizes encoded safe placeholders and fails closed on malformed bytes", () => {
    const command = mapCodexNotification({
      method: "item/completed",
      params: {
        threadId: "thr_1",
        turnId: "turn_1",
        item: {
          type: "commandExecution",
          id: "command-encoded-placeholders",
          status: "completed",
          command:
            "open $ABSOLUTE%2Freport.txt $WORKSPACE%2Fsrc%2Fsafe.ts $ABSOLUTE%2Freport%E0.txt",
          commandActions: [],
        },
      },
    });

    const item = completedItem(command);
    if (item.type !== "commandExecution") {
      throw new Error("expected commandExecution");
    }
    expect(item.command).toContain("$ABSOLUTE/report.txt");
    expect(item.command).toContain("$WORKSPACE/src/safe.ts");
    expect(item.command).toContain("$ABSOLUTE/[REDACTED]");
    expect(runnerCodexEventSchema.safeParse(command[0]).success).toBe(true);
  });

  it("redacts root-relative, escaped, backtick, and URL query paths", () => {
    const command = mapCodexNotification({
      method: "item/completed",
      params: {
        threadId: "thr_1",
        turnId: "turn_1",
        item: {
          type: "commandExecution",
          id: "command-path-syntaxes",
          status: "completed",
          command:
            "open \\Users\\one\\private\\root-relative.txt open \\/Users/one/private/escaped-slash.txt open `/Users/one/private/backtick.txt` open \\\\server\\share\\unc.txt",
          commandActions: [],
        },
      },
    });
    const image = mapCodexNotification({
      method: "item/completed",
      params: {
        threadId: "thr_1",
        turnId: "turn_1",
        item: {
          type: "imageView",
          id: "image-root-relative",
          path: "\\Users\\one\\private\\preview.png",
        },
      },
    });
    const rawQuery = mapCodexNotification({
      method: "item/completed",
      params: {
        threadId: "thr_1",
        turnId: "turn_1",
        item: {
          type: "webSearch",
          id: "search-url-local-query",
          action: {
            type: "openPage",
            url: "https://example.test/view?file=/Users/one/private/report.txt#summary",
          },
        },
      },
    });
    const encodedQuery = mapCodexNotification({
      method: "item/completed",
      params: {
        threadId: "thr_1",
        turnId: "turn_1",
        item: {
          type: "webSearch",
          id: "search-url-encoded-query",
          action: {
            type: "findInPage",
            url: "https://example.test/view?file=%2FUsers%2Fone%2Fprivate%2Fencoded.txt",
            pattern: "report",
          },
        },
      },
    });
    const fragment = mapCodexNotification({
      method: "item/completed",
      params: {
        threadId: "thr_1",
        turnId: "turn_1",
        item: {
          type: "webSearch",
          id: "search-url-local-fragment",
          action: {
            type: "openPage",
            url: "https://example.test/view#/Users/one/private/fragment.txt",
          },
        },
      },
    });

    const commandItem = completedItem(command);
    if (commandItem.type !== "commandExecution") {
      throw new Error("expected commandExecution");
    }
    expect(commandItem.command).toContain("$ABSOLUTE/root-relative.txt");
    expect(commandItem.command).toContain("$ABSOLUTE/escaped-slash.txt");
    expect(commandItem.command).toContain("$ABSOLUTE/backtick.txt");
    expect(commandItem.command).toContain("$ABSOLUTE/unc.txt");
    expect(completedItem(image)).toMatchObject({
      type: "imageView",
      path: "$ABSOLUTE/preview.png",
    });
    expect(completedItem(rawQuery)).toMatchObject({
      type: "webSearch",
      action: {
        type: "openPage",
        url: "https://example.test/view?file=$ABSOLUTE/report.txt#summary",
      },
    });
    expect(completedItem(encodedQuery)).toMatchObject({
      type: "webSearch",
      action: {
        type: "findInPage",
        url: "https://example.test/view?file=$ABSOLUTE/encoded.txt",
      },
    });
    expect(completedItem(fragment)).toMatchObject({
      type: "webSearch",
      action: {
        type: "openPage",
        url: "https://example.test/view#$ABSOLUTE/fragment.txt",
      },
    });
    expect(
      JSON.stringify([command, image, rawQuery, encodedQuery, fragment]),
    ).not.toMatch(/Users|server\\share|%2FUsers/iu);
  });

  it("preserves safe percent escapes while using decoding only as a security probe", () => {
    const file = mapCodexNotification({
      method: "item/completed",
      params: {
        threadId: "thr_1",
        turnId: "turn_1",
        item: {
          type: "fileChange",
          id: "file-safe-percent",
          status: "completed",
          changes: [
            { kind: { type: "update" }, path: "src/report%20final.ts" },
            { kind: { type: "add" }, path: "src/100%25-ready.ts" },
            { kind: { type: "add" }, path: "资料/报告%20终稿.md" },
            {
              kind: { type: "add" },
              path: "$WORKSPACE/资料/报告%20终稿.pdf",
            },
          ],
        },
      },
    });
    const safeUrl = mapCodexNotification({
      method: "item/completed",
      params: {
        threadId: "thr_1",
        turnId: "turn_1",
        item: {
          type: "webSearch",
          id: "search-safe-percent-url",
          action: {
            type: "openPage",
            url: "https://example.test/a%2Fb?q=100%25",
          },
        },
      },
    });
    const encodedUrl = mapCodexNotification({
      method: "item/completed",
      params: {
        threadId: "thr_1",
        turnId: "turn_1",
        item: {
          type: "commandExecution",
          id: "command-safe-encoded-url",
          status: "completed",
          command: "open https%3A%2F%2Fexample.test%2Fdocs",
          commandActions: [],
        },
      },
    });

    expect(completedItem(file)).toMatchObject({
      type: "fileChange",
      changes: [
        { path: "src/report%20final.ts" },
        { path: "src/100%25-ready.ts" },
        { path: "资料/报告%20终稿.md" },
        { path: "$WORKSPACE/资料/报告%20终稿.pdf" },
      ],
    });
    expect(completedItem(safeUrl)).toMatchObject({
      type: "webSearch",
      action: {
        type: "openPage",
        url: "https://example.test/a%2Fb?q=100%25",
      },
    });
    expect(completedItem(encodedUrl)).toMatchObject({
      type: "commandExecution",
      command: "open https%3A%2F%2Fexample.test%2Fdocs",
    });
    expect(
      [file[0], safeUrl[0], encodedUrl[0]].every(
        (event) => runnerCodexEventSchema.safeParse(event).success,
      ),
    ).toBe(true);
  });

  it("redacts percent-encoded secrets before creating a command preview", () => {
    const command = mapCodexNotification({
      method: "item/completed",
      params: {
        threadId: "thr_1",
        turnId: "turn_1",
        item: {
          type: "commandExecution",
          id: "command-encoded-secrets",
          status: "completed",
          command:
            "tool token%3Draw-encoded-secret https%3A%2F%2Fuser%3Apassword%40example.test",
          commandActions: [],
        },
      },
    });

    const item = completedItem(command);
    if (item.type !== "commandExecution") {
      throw new Error("expected commandExecution");
    }
    expect(item.command).toContain("token=[REDACTED]");
    expect(item.command).toContain("[REDACTED]");
    expect(item.command).not.toMatch(/raw-encoded-secret|user:password/iu);
    expect(runnerCodexEventSchema.safeParse(command[0]).success).toBe(true);
  });

  it("keeps redaction markers atomic when a preview reaches its length limit", () => {
    const command = mapCodexNotification({
      method: "item/completed",
      params: {
        threadId: "thr_1",
        turnId: "turn_1",
        item: {
          type: "commandExecution",
          id: "command-redaction-boundary",
          status: "completed",
          command: `${"x".repeat(
            runnerCodexPreviewLimits.commandCharacters - 14,
          )} --token raw-secret`,
          commandActions: [],
        },
      },
    });

    expect(command).toHaveLength(1);
    const item = completedItem(command);
    if (item.type !== "commandExecution") {
      throw new Error("expected commandExecution");
    }
    expect(item.command).toMatch(/…$/u);
    expect(item.command).not.toMatch(/\[RED(?:A(?:C(?:T(?:E(?:D)?)?)?)?)?…/u);
  });

  it("keeps safe native previews and reasoning summaries while dropping raw content", () => {
    const file = mapCodexNotification(
      {
        method: "item/completed",
        params: {
          threadId: "thr_1",
          turnId: "turn_1",
          item: {
            type: "fileChange",
            id: "file-1",
            status: "completed",
            changes: [
              {
                path: "/srv/link-sense/workspaces/conversation-1/src/report.ts",
                kind: {
                  type: "update",
                  move_path: "/private/new-report.ts",
                },
                diff: "+ secret content",
              },
              {
                path: "/private/new-report.ts",
                kind: { type: "add" },
              },
              {
                path: "$WORKSPACE/../token.txt",
                kind: { type: "delete" },
              },
            ],
          },
        },
      },
      previewContext,
    );
    const search = mapCodexNotification(
      {
        method: "item/started",
        params: {
          threadId: "thr_1",
          turnId: "turn_1",
          item: {
            type: "webSearch",
            id: "search-1",
            query: "find /private/report.pdf with token=raw-search-token\nnext",
            action: {
              type: "search",
              query: "API key: raw-search-key",
              queries: [
                "quarterly results",
                "Authorization: Bearer raw-search-bearer",
              ],
            },
          },
        },
      },
      previewContext,
    );
    const openPage = mapCodexNotification({
      method: "item/completed",
      params: {
        threadId: "thr_1",
        turnId: "turn_1",
        item: {
          type: "webSearch",
          id: "search-2",
          action: {
            type: "openPage",
            url: "https://user:password@example.test/report?token=raw-url-token",
          },
        },
      },
    });
    const image = mapCodexNotification(
      {
        method: "item/completed",
        params: {
          threadId: "thr_1",
          turnId: "turn_1",
          item: {
            type: "imageView",
            id: "image-1",
            path: "/srv/link-sense/codex-homes/conversation-1/artifacts/preview.png",
          },
        },
      },
      previewContext,
    );
    const reasoning = mapCodexNotification({
      method: "item/completed",
      params: {
        threadId: "thr_1",
        turnId: "turn_1",
        item: {
          type: "reasoning",
          id: "reasoning-1",
          summary: [
            "Planning /private/report.pdf with token=raw-reasoning-token",
          ],
          content: ["private chain of thought"],
        },
      },
    });

    expect(file[0]).toMatchObject({
      params: {
        item: {
          changes: [
            {
              kind: { type: "update" },
              path: "$WORKSPACE/src/report.ts",
            },
            {
              kind: { type: "add" },
              path: "$ABSOLUTE/new-report.ts",
            },
            {
              kind: { type: "delete" },
              path: "$ABSOLUTE/[REDACTED]",
            },
          ],
        },
      },
    });
    expect(search[0]).toMatchObject({
      params: {
        item: {
          query: "find $ABSOLUTE/report.pdf with token=[REDACTED] next",
          action: {
            type: "search",
            query: "API key: [REDACTED]",
            queries: ["quarterly results", "Authorization: [REDACTED]"],
          },
        },
      },
    });
    expect(openPage[0]).toMatchObject({
      params: {
        item: {
          action: {
            type: "openPage",
            url: "https://[REDACTED]@example.test/report?token=[REDACTED]",
          },
        },
      },
    });
    expect(image[0]).toMatchObject({
      params: {
        item: {
          type: "imageView",
          path: "$CODEX_HOME/artifacts/preview.png",
        },
      },
    });
    expect(reasoning[0]).toMatchObject({
      params: {
        item: {
          type: "reasoning",
          id: "reasoning-1",
          summary: ["Planning $ABSOLUTE/report.pdf with token=[REDACTED]"],
        },
      },
    });
    expect(
      JSON.stringify([...file, ...search, ...openPage, ...image, ...reasoning]),
    ).not.toMatch(
      /srv\/link-sense|private\/report|secret content|raw-search|user:password|raw-url-token|raw-reasoning-token|chain of thought|move_path/u,
    );
  });

  it("keeps Codex image-generation and review text as bounded safe previews", () => {
    const imageGeneration = mapCodexNotification(
      {
        method: "item/completed",
        params: {
          threadId: "thr_1",
          turnId: "turn_1",
          item: {
            type: "imageGeneration",
            id: "image-generation-1",
            status: "completed",
            revisedPrompt:
              "Create /srv/link-sense/workspaces/conversation-1/circle.png with token=raw-image-token",
            savedPath:
              "/srv/link-sense/workspaces/conversation-1/artifacts/circle.png",
            result: "private-base64-image",
          },
        },
      },
      previewContext,
    );
    const review = mapCodexNotification(
      {
        method: "item/completed",
        params: {
          threadId: "thr_1",
          turnId: "turn_1",
          item: {
            type: "enteredReviewMode",
            id: "review-1",
            review: "Review /private/changes.md with API key raw-review-key",
          },
        },
      },
      previewContext,
    );

    expect(imageGeneration[0]).toMatchObject({
      params: {
        item: {
          type: "imageGeneration",
          status: "completed",
          revisedPrompt: "Create $WORKSPACE/circle.png with token=[REDACTED]",
          savedPath: "$WORKSPACE/artifacts/circle.png",
        },
      },
    });
    expect(review[0]).toMatchObject({
      params: {
        item: {
          type: "enteredReviewMode",
          review: "Review $ABSOLUTE/changes.md with API key [REDACTED]",
        },
      },
    });
    expect(JSON.stringify([imageGeneration, review])).not.toMatch(
      /private-base64-image|raw-image-token|raw-review-key|\/private\/changes/u,
    );
  });

  it("bounds preview lengths and collection sizes", () => {
    const command = mapCodexNotification({
      method: "item/completed",
      params: {
        threadId: "thr_1",
        turnId: "turn_1",
        item: {
          type: "commandExecution",
          id: "command-limit",
          status: "completed",
          command: "x".repeat(runnerCodexPreviewLimits.commandCharacters + 50),
          commandActions: Array.from(
            { length: runnerCodexPreviewLimits.commandActions + 10 },
            () => ({ type: "read", command: "pwd" }),
          ),
        },
      },
    });
    const file = mapCodexNotification({
      method: "item/completed",
      params: {
        threadId: "thr_1",
        turnId: "turn_1",
        item: {
          type: "fileChange",
          id: "file-limit",
          status: "completed",
          changes: Array.from(
            { length: runnerCodexPreviewLimits.fileChanges + 10 },
            (_, index) => ({
              kind: { type: "update" },
              path:
                index === 0
                  ? `artifacts/${"x".repeat(runnerCodexPreviewLimits.pathCharacters + 50)}`
                  : `artifacts/${index}.txt`,
            }),
          ),
        },
      },
    });
    const search = mapCodexNotification({
      method: "item/completed",
      params: {
        threadId: "thr_1",
        turnId: "turn_1",
        item: {
          type: "webSearch",
          id: "search-limit",
          query: "q".repeat(runnerCodexPreviewLimits.queryCharacters + 50),
          action: {
            type: "search",
            queries: Array.from(
              { length: runnerCodexPreviewLimits.searchQueries + 10 },
              (_, index) => `query-${index}`,
            ),
          },
        },
      },
    });

    const commandItem = completedItem(command);
    const fileItem = completedItem(file);
    const searchItem = completedItem(search);
    if (commandItem.type !== "commandExecution") {
      throw new Error("expected commandExecution");
    }
    if (fileItem.type !== "fileChange") throw new Error("expected fileChange");
    if (searchItem.type !== "webSearch") throw new Error("expected webSearch");

    expect(commandItem.command).toHaveLength(
      runnerCodexPreviewLimits.commandCharacters,
    );
    expect(commandItem.command?.endsWith("…")).toBe(true);
    expect(commandItem.commandActions).toHaveLength(
      runnerCodexPreviewLimits.commandActions,
    );
    expect(fileItem.changes).toHaveLength(runnerCodexPreviewLimits.fileChanges);
    expect(fileItem.changes[0]?.path).toHaveLength(
      runnerCodexPreviewLimits.pathCharacters,
    );
    expect(searchItem.query).toHaveLength(
      runnerCodexPreviewLimits.queryCharacters,
    );
    expect(searchItem.action?.type).toBe("search");
    if (searchItem.action?.type !== "search") {
      throw new Error("expected search action");
    }
    expect(searchItem.action.queries).toHaveLength(
      runnerCodexPreviewLimits.searchQueries,
    );
    expect(
      [command[0], file[0], search[0]].every(
        (event) => runnerCodexEventSchema.safeParse(event).success,
      ),
    ).toBe(true);
  });

  it("forwards sanitized reasoning summary deltas without exposing raw reasoning text", () => {
    const summary = mapCodexNotification(
      {
        method: "item/reasoning/summaryTextDelta",
        params: {
          threadId: "thr_1",
          turnId: "turn_1",
          itemId: "reasoning-1",
          summaryIndex: 0,
          delta:
            " Evaluating /private/report.txt with api_key=raw-summary-token ",
        },
      },
      previewContext,
    );
    const whitespace = mapCodexNotification({
      method: "item/reasoning/summaryTextDelta",
      params: {
        threadId: "thr_1",
        turnId: "turn_1",
        itemId: "reasoning-1",
        summaryIndex: 0,
        delta: "\n",
      },
    });

    expect(summary).toEqual([
      {
        method: "item/reasoning/summaryTextDelta",
        visibility: "user_collapsed",
        params: {
          threadId: "thr_1",
          turnId: "turn_1",
          itemId: "reasoning-1",
          summaryIndex: 0,
          delta: " Evaluating $ABSOLUTE/report.txt with api_key=[REDACTED] ",
        },
      },
    ]);
    expect(whitespace[0]).toMatchObject({ params: { delta: " " } });
    expect(runnerCodexEventSchema.safeParse(summary[0]).success).toBe(true);
    expect(
      mapCodexNotification({
        method: "item/reasoning/textDelta",
        params: {
          threadId: "thr_1",
          turnId: "turn_1",
          itemId: "reasoning-1",
          contentIndex: 0,
          delta: "private chain of thought",
        },
      }),
    ).toEqual([]);
  });

  it("preserves streamed assistant message deltas byte-for-byte", () => {
    const delta = [
      "```html\n",
      "<title>待办事项</title>\n",
      "<p>全部</p>\n",
      "```\n",
      "本地引用 /srv/link-sense/private/report.txt",
    ].join("");
    const events = mapCodexNotification(
      {
        method: "item/agentMessage/delta",
        params: {
          threadId: "thr_1",
          turnId: "turn_1",
          itemId: "message-1",
          delta,
        },
      },
      previewContext,
    );

    expect(events).toEqual([
      {
        method: "item/agentMessage/delta",
        visibility: "user_visible",
        params: {
          threadId: "thr_1",
          turnId: "turn_1",
          itemId: "message-1",
          delta,
        },
      },
    ]);
    expect(JSON.stringify(events)).not.toContain("$ABSOLUTE");
  });

  it("preserves HTML closing tags split across streamed deltas", () => {
    const itemId = "message-external-image";
    const deltas = [
      "```html\n<head><title>待办事项<",
      "/title><",
      "/head>\n<body><div><p>全部</",
      "p></",
      "div></body>\n```",
    ];

    const streamedText = deltas
      .flatMap((delta) =>
        mapCodexNotification(
          {
            method: "item/agentMessage/delta",
            params: {
              threadId: "thr_1",
              turnId: "turn_1",
              itemId,
              delta,
            },
          },
          previewContext,
        ),
      )
      .map((event) =>
        event.method === "item/agentMessage/delta" ? event.params.delta : "",
      )
      .join("");

    expect(streamedText).toBe(deltas.join(""));
    expect(streamedText).not.toContain("$ABSOLUTE");
  });

  it("preserves external and knowledge image URLs split across deltas", () => {
    const assetId = "50000000-0000-5000-8000-000000000001";
    const knowledgeUrl = `kb-asset://${assetId}`;
    const externalUrl =
      "https://upload.wikimedia.org/wikipedia/commons/example.jpg";
    const stream = (deltas: string[], itemId: string) => {
      return deltas
        .flatMap((delta) =>
          mapCodexNotification(
            {
              method: "item/agentMessage/delta",
              params: {
                threadId: "thr_1",
                turnId: "turn_1",
                itemId,
                delta,
              },
            },
            previewContext,
          ),
        )
        .map((event) =>
          event.method === "item/agentMessage/delta" ? event.params.delta : "",
        )
        .join("");
    };

    expect(
      stream(
        [
          "![外部图片](https",
          "://upload.wikimedia.org/",
          "wikipedia/commons/example.jpg)",
        ],
        "message-external-image",
      ),
    ).toBe(`![外部图片](${externalUrl})`);
    expect(
      stream(
        ["![知识图片](kb", "-asset://", assetId, ")"],
        "message-knowledge-image",
      ),
    ).toBe(`![知识图片](${knowledgeUrl})`);
  });

  it("leaves security sanitization enabled for non-message internal events", () => {
    const events = mapCodexNotification(
      {
        method: "item/reasoning/summaryTextDelta",
        params: {
          threadId: "thr_1",
          turnId: "turn_1",
          itemId: "reasoning-1",
          summaryIndex: 0,
          delta: "Inspect /srv/private/report.txt with api_key=raw-secret",
        },
      },
      previewContext,
    );

    expect(events[0]).toMatchObject({
      params: {
        delta: "Inspect $ABSOLUTE/report.txt with api_key=[REDACTED]",
      },
    });
  });

  it("projects collaboration state through opaque keys and safe agent labels only", () => {
    const firstAgentThreadId = "native-subagent-alpha";
    const secondAgentThreadId = "native-subagent-beta";
    const statusOnlyAgentThreadId = "native-subagent-status-only";
    const prompt = "private collaboration prompt";
    const firstStateMessage = "private alpha state message";
    const secondStateMessage = "private beta state message";
    const collab = completedItem(
      mapCodexNotification(
        {
          method: "item/completed",
          params: {
            threadId: "thr_1",
            turnId: "turn_1",
            item: {
              type: "collabAgentToolCall",
              id: "collab-1",
              tool: "spawnAgent",
              status: "completed",
              senderThreadId: "parent-thread",
              receiverThreadIds: [
                firstAgentThreadId,
                secondAgentThreadId,
                firstAgentThreadId,
              ],
              prompt,
              model: "gpt-5.6-terra",
              reasoningEffort: "max",
              agentsStates: {
                [firstAgentThreadId]: {
                  status: "running",
                  message: firstStateMessage,
                },
                [secondAgentThreadId]: {
                  status: "completed",
                  message: secondStateMessage,
                },
                [statusOnlyAgentThreadId]: {
                  status: "notFound",
                  message: "private status-only state message",
                },
              },
            },
          },
        },
        previewContext,
        {
          subAgentLabelsByThreadId: new Map([
            [firstAgentThreadId, "Feishu requirements"],
          ]),
        },
      ),
    );
    const activity = completedItem(
      mapCodexNotification({
        method: "item/completed",
        params: {
          threadId: "thr_1",
          turnId: "turn_1",
          item: {
            type: "subAgentActivity",
            id: "subagent-activity-1",
            kind: "started",
            agentThreadId: firstAgentThreadId,
            agentPath: "/root/backend_site_icon_tests",
          },
        },
      }),
    );
    const unsafeActivity = completedItem(
      mapCodexNotification(
        {
          method: "item/completed",
          params: {
            threadId: "thr_1",
            turnId: "turn_1",
            item: {
              type: "subAgentActivity",
              id: "subagent-activity-unsafe",
              kind: "interacted",
              agentThreadId: secondAgentThreadId,
              agentPath:
                "/srv/link-sense/workspaces/conversation-1/private-agent-path",
            },
          },
        },
        previewContext,
      ),
    );
    const followup = completedItem(
      mapCodexNotification({
        method: "item/completed",
        params: {
          threadId: "thr_1",
          turnId: "turn_1",
          item: {
            type: "collabAgentToolCall",
            id: "collab-followup-1",
            tool: "followupTask",
            status: "interrupted",
            senderThreadId: "parent-thread",
            receiverThreadIds: [firstAgentThreadId],
            prompt: null,
            model: null,
            reasoningEffort: null,
            agentsStates: {},
          },
        },
      }),
    );
    const completedActivity = completedItem(
      mapCodexNotification({
        method: "item/completed",
        params: {
          threadId: "thr_1",
          turnId: "turn_1",
          item: {
            type: "subAgentActivity",
            id: "subagent-activity-completed",
            kind: "completed",
            agentThreadId: firstAgentThreadId,
            agentPath: "/root/backend_site_icon_tests",
          },
        },
      }),
    );

    if (
      collab.type !== "collabAgentToolCall" ||
      followup.type !== "collabAgentToolCall" ||
      activity.type !== "subAgentActivity" ||
      unsafeActivity.type !== "subAgentActivity" ||
      completedActivity.type !== "subAgentActivity"
    ) {
      throw new Error("expected collaboration item projections");
    }
    expect(collab.agents).toEqual([
      {
        agentKey: expect.stringMatching(/^agent_[A-Za-z0-9_-]{24}$/u),
        agentLabel: "Feishu requirements",
        status: "running",
      },
      {
        agentKey: expect.stringMatching(/^agent_[A-Za-z0-9_-]{24}$/u),
        status: "completed",
      },
      {
        agentKey: expect.stringMatching(/^agent_[A-Za-z0-9_-]{24}$/u),
        status: "notFound",
      },
    ]);
    expect(activity.agentKey).toBe(collab.agents?.[0]?.agentKey);
    expect(activity.agentLabel).toBe("Backend site icon tests");
    expect(unsafeActivity.agentLabel).toBeUndefined();
    expect(followup).toMatchObject({
      tool: "followupTask",
      status: "interrupted",
    });
    expect(completedActivity).toMatchObject({ kind: "completed" });

    const serialized = JSON.stringify([collab, activity, unsafeActivity]);
    for (const secret of [
      firstAgentThreadId,
      secondAgentThreadId,
      statusOnlyAgentThreadId,
      prompt,
      firstStateMessage,
      secondStateMessage,
      "/root/backend_site_icon_tests",
      "/srv/link-sense/workspaces/conversation-1/private-agent-path",
    ]) {
      expect(serialized).not.toContain(secret);
    }
    expect(
      runnerCodexEventSchema.safeParse({
        method: "item/completed",
        visibility: "user_collapsed",
        params: { threadId: "thr_1", turnId: "turn_1", item: collab },
      }).success,
    ).toBe(true);
  });

  it("derives a safe child-thread label from native subagent metadata", () => {
    expect(
      deriveSubAgentThreadLabel(
        {
          source: {
            subAgent: {
              thread_spawn: {
                agent_path: "/root/feishu_data_ui_docs",
              },
            },
          },
          name: "fallback name",
          agentNickname: "fallback nickname",
          agentRole: "fallback role",
        },
        previewContext,
      ),
    ).toBe("Feishu data ui docs");
    expect(
      deriveSubAgentThreadLabel(
        {
          source: {
            subAgent: {
              thread_spawn: {
                agent_path:
                  "/srv/link-sense/workspaces/conversation-1/private-agent",
                agent_nickname: "Database review",
              },
            },
          },
          agentNickname: "fallback nickname",
        },
        previewContext,
      ),
    ).toBe("Database review");
  });

  it("projects a child thread without exposing native ids, prompts, user messages, secrets, or local paths", () => {
    const nativeAgentThreadId = "native-child-thread-secret";
    const agentKey = opaqueAgentKey(nativeAgentThreadId);
    if (!agentKey) throw new Error("missing opaque agent key");

    const detail = projectCodexSubAgentThread({
      agentKey,
      status: "completed",
      previewContext,
      thread: {
        id: nativeAgentThreadId,
        modelProvider: "link-sense",
        parentThreadId: "parent-thread",
        turns: [
          {
            id: "native-child-turn",
            status: "completed",
            error: null,
            items: [
              {
                type: "userMessage",
                id: "native-user-message",
                content: [
                  {
                    type: "text",
                    text: "private child prompt",
                    text_elements: [],
                  },
                ],
              },
              {
                type: "agentMessage",
                id: "native-agent-message",
                phase: "commentary",
                text: "检查 /srv/link-sense/workspaces/conversation-1/src/index.ts token=very-secret-value",
              },
              {
                type: "commandExecution",
                id: "native-command",
                status: "completed",
                commandActions: [
                  {
                    type: "read",
                    command:
                      "cat /srv/link-sense/workspaces/conversation-1/src/index.ts",
                    name: "read",
                    path: "/srv/link-sense/workspaces/conversation-1/src/index.ts",
                  },
                ],
              },
            ],
          },
        ],
      },
    });

    expect(detail).toMatchObject({
      agentKey,
      status: "completed",
      turns: [
        {
          status: "completed",
          items: [
            {
              type: "agentMessage",
              id: "detail-2",
              text: expect.stringContaining("$WORKSPACE/src/index.ts"),
            },
            {
              type: "commandExecution",
              id: "detail-3",
            },
          ],
        },
      ],
    });
    const serialized = JSON.stringify(detail);
    for (const privateValue of [
      nativeAgentThreadId,
      "native-child-turn",
      "native-user-message",
      "private child prompt",
      "very-secret-value",
      "/srv/link-sense/workspaces",
    ]) {
      expect(serialized).not.toContain(privateValue);
    }
    expect(serialized).toContain("[REDACTED]");
  });

  it("drops user inputs, raw reasoning text deltas, unknown items, and unknown methods", () => {
    expect(
      mapCodexNotification({
        method: "item/started",
        params: {
          threadId: "thr_1",
          turnId: "turn_1",
          item: {
            type: "userMessage",
            id: "user-1",
            content: [{ type: "text", text: "private user input" }],
          },
        },
      }),
    ).toEqual([]);
    expect(
      mapCodexNotification({
        method: "item/reasoning/textDelta",
        params: {
          threadId: "thr_1",
          turnId: "turn_1",
          itemId: "reasoning-1",
          contentIndex: 0,
          delta: "private reasoning",
        },
      }),
    ).toEqual([]);
    expect(
      mapCodexNotification({
        method: "item/completed",
        params: {
          threadId: "thr_1",
          turnId: "turn_1",
          item: { type: "futureSecretTool", id: "future-1", secret: "value" },
        },
      }),
    ).toEqual([]);
    expect(
      mapCodexNotification({
        method: "future/notification",
        params: { threadId: "thr_1", token: "secret" },
      }),
    ).toEqual([]);
  });

  it("never expands one native notification into multiple events", () => {
    const notifications = [
      {
        method: "turn/started",
        params: {
          threadId: "thr_1",
          turn: { id: "turn_1", status: "inProgress", items: [], error: null },
        },
      },
      {
        method: "item/agentMessage/delta",
        params: {
          threadId: "thr_1",
          turnId: "turn_1",
          itemId: "message-1",
          delta: "hello",
        },
      },
      {
        method: "turn/plan/updated",
        params: {
          threadId: "thr_1",
          turnId: "turn_1",
          explanation: "not persisted",
          plan: [{ step: "检查问题", status: "inProgress" }],
        },
      },
    ];

    for (const notification of notifications) {
      const events = mapCodexNotification(notification);
      expect(events.length).toBeLessThanOrEqual(1);
      expect(events[0]?.method).toBe(notification.method);
    }
  });

  it("keeps native Plan output visible and authoritative", () => {
    expect(
      mapCodexNotification({
        method: "item/plan/delta",
        params: {
          threadId: "thr_1",
          turnId: "turn_1",
          itemId: "plan-1",
          delta: "先检查现有实现",
        },
      }),
    ).toEqual([
      {
        method: "item/plan/delta",
        visibility: "user_visible",
        params: {
          threadId: "thr_1",
          turnId: "turn_1",
          itemId: "plan-1",
          delta: "先检查现有实现",
        },
      },
    ]);
    expect(
      mapCodexNotification({
        method: "item/completed",
        params: {
          threadId: "thr_1",
          turnId: "turn_1",
          item: { type: "plan", id: "plan-1", text: "完整计划" },
        },
      })[0],
    ).toMatchObject({
      method: "item/completed",
      visibility: "user_visible",
      params: { item: { type: "plan", id: "plan-1", text: "完整计划" } },
    });
  });

  it("maps native requestUserInput requests and their resolution without answers", () => {
    expect(
      mapCodexServerRequest({
        id: 17,
        method: "item/tool/requestUserInput",
        params: {
          threadId: "thr_1",
          turnId: "turn_1",
          itemId: "question-1",
          questions: [
            {
              id: "scope",
              header: "范围",
              question: "选择实现范围",
              isOther: true,
              isSecret: false,
              options: [
                { label: "完整实现", description: "完成全部链路" },
              ],
            },
          ],
          isBlocking: false,
          autoResolutionMs: 60_000,
        },
      }),
    ).toEqual([
      {
        method: "item/tool/requestUserInput",
        visibility: "user_visible",
        params: {
          threadId: "thr_1",
          turnId: "turn_1",
          itemId: "question-1",
          requestId: 17,
          questions: [
            {
              id: "scope",
              header: "范围",
              question: "选择实现范围",
              isOther: true,
              isSecret: false,
              options: [
                { label: "完整实现", description: "完成全部链路" },
              ],
            },
          ],
          isBlocking: false,
          autoResolutionMs: 60_000,
        },
      },
    ]);
    expect(
      mapCodexNotification({
        method: "serverRequest/resolved",
        params: { threadId: "thr_1", requestId: 17 },
      }),
    ).toEqual([
      {
        method: "serverRequest/resolved",
        visibility: "user_visible",
        params: { threadId: "thr_1", requestId: 17 },
      },
    ]);
    expect(
      mapCodexServerRequest({
        id: 18,
        method: "item/tool/requestUserInput",
        params: {
          threadId: "thr_1",
          turnId: "turn_1",
          itemId: "question-without-blocking-flag",
          questions: [
            {
              id: "scope",
              header: "范围",
              question: "选择实现范围",
              isOther: true,
              isSecret: false,
              options: null,
            },
          ],
          autoResolutionMs: 60_000,
        },
      }),
    ).toEqual([]);
  });

  it("does not project MCP elicitations into LinkSense business forms", () => {
    expect(
      mapCodexServerRequest({
        id: 18,
        method: "mcpServer/elicitation/request",
        params: {
          threadId: "thr_1",
          turnId: "turn_1",
          serverName: "linksense_core",
          mode: "form",
          message: "请确认发布信息",
          requestedSchema: {
            type: "object",
            properties: {
              summary: {
                type: "string",
                title: "摘要",
                maxLength: 1_000,
              },
              channel: {
                type: "string",
                title: "渠道",
                oneOf: [
                  { const: "email", title: "邮件" },
                  { const: "teams", title: "Teams" },
                ],
              },
            },
            required: ["summary", "channel"],
          },
          _meta: {
            "linksense/form": {
              uiHints: {
                summary: {
                  control: "textarea",
                  placeholder: "请输入摘要",
                },
              },
              ignored: "not projected",
            },
            secret: "not projected",
          },
        },
      }),
    ).toEqual([]);

    expect(
      mapCodexServerRequest({
        id: 19,
        method: "mcpServer/elicitation/request",
        params: {
          threadId: "thr_1",
          turnId: "turn_1",
          serverName: "linksense_core",
          mode: "openai/form",
          message: "unsupported",
          requestedSchema: {},
          _meta: null,
        },
      }),
    ).toEqual([]);

    expect(
      mapCodexServerRequest({
        id: 21,
        method: "mcpServer/elicitation/request",
        params: {
          threadId: "thr_1",
          turnId: "turn_1",
          serverName: "third_party",
          mode: "form",
          message: "Choose a channel",
          requestedSchema: {
            type: "object",
            properties: {
              channel: { type: "string", enum: ["email", "teams"] },
            },
            required: ["channel"],
          },
        },
      }),
    ).toEqual([]);

    expect(
      mapCodexServerRequest({
        id: 20,
        method: "mcpServer/elicitation/request",
        params: {
          threadId: "thr_1",
          turnId: "turn_1",
          serverName: "third_party",
          mode: "form",
          message: "Enter your API key",
          requestedSchema: {
            type: "object",
            properties: {
              api_key: { type: "string", title: "API Key" },
            },
            required: ["api_key"],
          },
        },
      }),
    ).toEqual([]);
  });

  it("does not recover a native MCP elicitation through the active turn", () => {
    const request = {
      id: 22,
      method: "mcpServer/elicitation/request",
      params: {
        threadId: "thr_1",
        turnId: null,
        serverName: "linksense_core",
        mode: "form",
        message: "请确认会议信息",
        requestedSchema: {
          type: "object",
          properties: {
            title: { type: "string", title: "会议主题" },
          },
          required: ["title"],
        },
        _meta: null,
      },
    };

    expect(mapCodexServerRequest(request)).toEqual([]);
  });
});

function completedItem(events: ReturnType<typeof mapCodexNotification>) {
  const event = events[0];
  if (event?.method !== "item/completed") {
    throw new Error("expected one item/completed event");
  }
  return event.params.item;
}

function hasControlCharacter(value: string): boolean {
  return Array.from(value).some((character) => {
    const code = character.charCodeAt(0);
    return code < 0x20 || (code >= 0x7f && code <= 0x9f);
  });
}
