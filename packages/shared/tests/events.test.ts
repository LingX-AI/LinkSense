import { describe, expect, it } from "vitest";

import {
  conversationEventSchema,
  conversationEventTypeSchema,
  referencedRunnerCodexSubAgentKeys,
  runnerCodexAgentKeysSchema,
  runnerCodexErrorInfoSchema,
  runnerCodexEventSchema,
  runnerCodexPreviewLimits,
  runnerConversationEventSchema,
  runnerEventBatchSchema,
  runnerEventBatchReceiptSchema,
  RUNNER_EVENT_BATCH_MAX_COUNT,
} from "../src/index.js";
import type { RunnerCodexItem } from "../src/index.js";

const conversationId = "20000000-0000-4000-8000-000000000001";
const turnId = "30000000-0000-4000-8000-000000000001";
const entityId = "40000000-0000-4000-8000-000000000001";
const createdAt = "2026-07-11T00:00:00.000Z";

describe("runner event delivery batches", () => {
  const entry = {
    deliveryId: entityId,
    event: {
      method: "item/agentMessage/delta", visibility: "user_visible",
      params: { threadId: "thread", turnId: "turn", itemId: "item", delta: "正文" },
    },
  };
  it("preserves each event and delivery id without coalescing its text", () => {
    const body = { conversationId, events: [entry, { ...entry, deliveryId: turnId }] };
    expect(runnerEventBatchSchema.parse(body)).toEqual(body);
    expect(runnerEventBatchSchema.safeParse({ conversationId, ...entry }).success).toBe(false);
  });
  it("rejects invalid entries even when earlier entries are valid", () => {
    expect(runnerEventBatchSchema.safeParse({ conversationId, events: [entry, { ...entry, deliveryId: "invalid" }] }).success).toBe(false);
    expect(runnerEventBatchSchema.safeParse({ conversationId, events: [{ ...entry, event: { ...entry.event, raw_notification: "private" } }] }).success).toBe(false);
  });
  it("accepts an empty acknowledgement and rejects unbounded or malformed receipts", () => {
    expect(runnerEventBatchReceiptSchema.parse({ accepted_delivery_ids: [] })).toEqual({ accepted_delivery_ids: [] });
    expect(runnerEventBatchReceiptSchema.safeParse({ accepted_delivery_ids: ["invalid"] }).success).toBe(false);
    expect(runnerEventBatchReceiptSchema.safeParse({ accepted_delivery_ids: Array(RUNNER_EVENT_BATCH_MAX_COUNT).fill(entityId) }).success).toBe(true);
    expect(runnerEventBatchReceiptSchema.safeParse({ accepted_delivery_ids: Array(RUNNER_EVENT_BATCH_MAX_COUNT + 1).fill(entityId) }).success).toBe(false);
  });
});

describe("native preparation compaction correlation", () => {
  it.each(["item/started", "item/completed"])("accepts %s with a local preparation turn", (method) => {
    const event = {
      method,
      visibility: "user_visible",
      preparation: { turnId },
      params: {
        threadId: "source-thread",
        turnId: "native-compact-turn",
        item: { id: "compact-item", type: "contextCompaction" },
      },
    };
    expect(runnerCodexEventSchema.parse(event)).toEqual(event);
    expect(runnerCodexEventSchema.safeParse({
      ...event,
      params: { ...event.params, item: { id: "message", type: "agentMessage", text: "hello" } },
    }).success).toBe(false);
    expect(runnerCodexEventSchema.safeParse({
      ...event, preparation: { turnId: "invalid" },
    }).success).toBe(false);
  });
});

const payloads: Record<string, Record<string, unknown>> = {
  "conversation.status.changed": {
    schema_version: 1,
    turn_id: turnId,
    turn_status: "running",
    conversation_execution_status: "running",
  },
  "conversation.pending_request.updated": {
    schema_version: 1,
    pending_request_id: entityId,
    status: "waiting_previous_turn",
    block_code: null,
    queue_no: 1,
  },
  "conversation.pending_request.cancelled": {
    schema_version: 1,
    pending_request_id: entityId,
  },
  "conversation.user_input_request.updated": {
    schema_version: 1,
    user_input_request_id: entityId,
    status: "answered",
  },
  "conversation.plan_review.updated": {
    schema_version: 1,
    plan_review_id: entityId,
    source_turn_id: turnId,
    status: "resolved",
    decision: "implement",
    follow_up_turn_id: entityId,
  },
  "conversation.message.delta": {
    schema_version: 1,
    message_id: entityId,
    role: "assistant",
    delta: "safe delta",
  },
  "conversation.message.completed": {
    schema_version: 1,
    message_id: entityId,
    role: "assistant",
    item_id: "native-item-1",
  },
  "conversation.title.updated": {
    schema_version: 1,
    title: "自动生成的任务名称",
  },
  "conversation.step.started": progressPayload(),
  "conversation.step.completed": progressPayload(),
  "conversation.tool.started": progressPayload(),
  "conversation.tool.completed": progressPayload(),
  "conversation.capability.attached": {
    schema_version: 1,
    capability_id: entityId,
    capability_type: "skill",
    usage_type: "auto_skill",
    priority_requested: false,
    name: "Documents",
    source_type: "local",
    status: "active",
  },
  "conversation.capability.used": {
    schema_version: 1,
    capability_id: entityId,
    capability_type: "skill",
    usage_type: "auto_skill",
    name: "Documents",
    safe_summary: "skill_invoked",
  },
  "conversation.system_capability.used": {
    schema_version: 1,
    system_capability_key: "linksense_file_service",
    usage_type: "system_file_service",
    name: "LinkSense File Service",
    safe_summary: "registered_downloadable_artifact",
  },
  "conversation.file.created": filePayload(),
  "conversation.file.updated": {
    schema_version: 1,
    file_id: entityId,
    status: "removed",
  },
  "conversation.artifact.created": filePayload(),
  "conversation.reconnect": {
    schema_version: 1,
    codex_turn_id: "native-turn-1",
    reason_code: "transport_interrupted",
    will_retry: true,
    message_key: "conversation.codexReconnecting",
  },
  "conversation.error": {
    schema_version: 1,
    error_code: "CODEX_TURN_FAILED",
    message_key: "errors.codexTurnFailed",
  },
  "conversation.interrupted": {
    schema_version: 1,
    turn_id: turnId,
    codex_turn_id: "native-turn-1",
    status: "interrupted",
  },
  "conversation.completed": {
    schema_version: 1,
    turn_id: turnId,
    codex_turn_id: "native-turn-1",
    status: "completed",
  },
};

describe("conversation event discriminated union", () => {
  it("accepts a selected built-in Skill attachment event", () => {
    expect(
      conversationEventSchema.safeParse({
        id: entityId,
        conversation_id: conversationId,
        turn_id: turnId,
        sequence_no: 1,
        event_type: "conversation.capability.attached",
        visibility: "user_collapsed",
        payload: {
          schema_version: 1,
          capability_id: "builtin:capability:linksense-browser",
          capability_type: "skill",
          usage_type: "auto_skill",
          priority_requested: true,
          name: "linksense-browser",
          source_type: "builtin",
          status: "active",
        },
        sse_event_id: `${conversationId}:1`,
        created_at: createdAt,
      }).success,
    ).toBe(true);
  });

  it("has one valid versioned payload for every legacy event type", () => {
    const types = conversationEventTypeSchema.options.filter((eventType) =>
      eventType.startsWith("conversation."),
    );
    expect(Object.keys(payloads).sort()).toEqual([...types].sort());

    for (const [index, eventType] of types.entries()) {
      expect(
        conversationEventSchema.safeParse({
          id: `60000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
          conversation_id: conversationId,
          turn_id: eventType.startsWith("conversation.pending_request")
            ? null
            : turnId,
          sequence_no: index + 1,
          event_type: eventType,
          visibility: eventType.includes("capability")
            ? "user_collapsed"
            : "user_visible",
          payload: payloads[eventType],
          sse_event_id: `${conversationId}:${index + 1}`,
          created_at: createdAt,
        }).success,
        eventType,
      ).toBe(true);
    }
  });

  it("accepts a strict native v2 public envelope with matching methods", () => {
    const event = {
      id: "60000000-0000-4000-8000-000000000099",
      conversation_id: conversationId,
      turn_id: turnId,
      sequence_no: 99,
      event_type: "item/completed",
      visibility: "user_visible",
      payload: {
        schema_version: 2,
        source: "codex_app_server",
        method: "item/completed",
        params: {
          threadId: "thread-1",
          turnId: "turn-1",
          item: {
            type: "agentMessage",
            id: "message-1",
            text: "最终回复",
            phase: "final_answer",
          },
        },
        local: { message_id: entityId },
      },
      sse_event_id: `${conversationId}:99`,
      created_at: createdAt,
    };

    expect(conversationEventSchema.safeParse(event).success).toBe(true);
    expect(
      conversationEventSchema.safeParse({
        ...event,
        payload: {
          ...event.payload,
          params: {
            ...event.payload.params,
            item: {
              type: "plan",
              id: "plan-1",
              text: "## Proposed plan",
            },
          },
          local: { message_id: entityId, plan_review_id: entityId },
        },
      }).success,
    ).toBe(true);
    expect(
      conversationEventSchema.safeParse({
        ...event,
        payload: { ...event.payload, method: "item/started" },
      }).success,
    ).toBe(false);
    expect(
      conversationEventSchema.safeParse({
        ...event,
        payload: {
          ...event.payload,
          local: { ...event.payload.local, workspace_path: "/private/path" },
        },
      }).success,
    ).toBe(false);
  });
});

describe("runner Codex event contract", () => {
  it("accepts native rate limiting while rejecting unknown classifications", () => {
    expect(runnerCodexErrorInfoSchema.safeParse("rateLimitExceeded").success).toBe(true);
    expect(runnerCodexErrorInfoSchema.safeParse("inventedRetryState").success).toBe(false);
  });

  it("accepts the Codex 0.150.1 misalignment policy error", () => {
    expect(
      runnerCodexErrorInfoSchema.safeParse("misalignmentPolicyViolation")
        .success,
    ).toBe(true);
  });

  it("accepts native agent messages while keeping legacy v1 events readable", () => {
    const native = {
      method: "item/completed",
      visibility: "user_visible",
      params: {
        threadId: "thread-1",
        turnId: "turn-1",
        completedAtMs: 1_752_192_000_000,
        item: {
          type: "agentMessage",
          id: "item-1",
          text: "最终回复",
          phase: "final_answer",
        },
      },
    };
    const legacy = {
      eventType: "conversation.message.completed",
      visibility: "user_visible",
      threadId: "thread-1",
      turnId: "turn-1",
      payload: {
        schema_version: 1,
        item_id: "item-1",
        text: "legacy response",
      },
    };

    expect(runnerCodexEventSchema.safeParse(native).success).toBe(true);
    expect(runnerConversationEventSchema.safeParse(native).success).toBe(true);
    expect(runnerConversationEventSchema.safeParse(legacy).success).toBe(true);
  });

  it("accepts only the sanitized native hook lifecycle projection", () => {
    const event = {
      method: "hook/completed",
      visibility: "user_collapsed",
      params: {
        threadId: "thread-1",
        turnId: "turn-1",
        run: {
          eventName: "stop",
          status: "blocked",
        },
        supersededItemId: "final-message-1",
      },
    };

    expect(conversationEventTypeSchema.safeParse("hook/completed").success).toBe(
      true,
    );
    expect(runnerCodexEventSchema.safeParse(event).success).toBe(true);
    expect(
      runnerCodexEventSchema.safeParse({
        ...event,
        params: {
          ...event.params,
          supersededItemId: undefined,
          run: { eventName: "interrupt", status: "completed" },
        },
      }).success,
    ).toBe(true);
    expect(runnerConversationEventSchema.safeParse(event).success).toBe(true);
    expect(
      runnerCodexEventSchema.safeParse({
        ...event,
        method: "hook/started",
        params: {
          ...event.params,
          run: { ...event.params.run, status: "running" },
        },
      }).success,
    ).toBe(false);
    expect(
      runnerCodexEventSchema.safeParse({
        ...event,
        params: {
          ...event.params,
          run: { ...event.params.run, status: "completed" },
        },
      }).success,
    ).toBe(false);
    expect(
      conversationEventSchema.safeParse({
        id: "60000000-0000-4000-8000-000000000100",
        conversation_id: conversationId,
        turn_id: turnId,
        sequence_no: 100,
        event_type: "hook/completed",
        visibility: "user_collapsed",
        payload: {
          schema_version: 2,
          source: "codex_app_server",
          method: "hook/completed",
          params: event.params,
        },
        sse_event_id: `${conversationId}:100`,
        created_at: createdAt,
      }).success,
    ).toBe(true);

    for (const unsafeRun of [
      {
        ...event.params.run,
        id: "stop:0:/opt/linksense/runtime/node/plan-stop-hook.mjs",
      },
      {
        ...event.params.run,
        sourcePath: "/private/hooks/stop.sh",
      },
      {
        ...event.params.run,
        entries: [{ kind: "feedback", text: "private prompt" }],
      },
      { ...event.params.run, eventName: "Stop" },
      { ...event.params.run, status: "unknown" },
    ]) {
      expect(
        runnerCodexEventSchema.safeParse({
          ...event,
          params: { ...event.params, run: unsafeRun },
        }).success,
      ).toBe(false);
    }
  });

  it("accepts bounded reasoning summary deltas and rejects unsafe previews", () => {
    const summaryDelta = {
      method: "item/reasoning/summaryTextDelta",
      visibility: "user_collapsed",
      params: {
        threadId: "thread-1",
        turnId: "turn-1",
        itemId: "reasoning-1",
        summaryIndex: 0,
        delta: "Evaluating $WORKSPACE/tests with token=[REDACTED]",
      },
    };

    expect(runnerCodexEventSchema.safeParse(summaryDelta).success).toBe(true);
    expect(
      runnerCodexEventSchema.safeParse({
        ...summaryDelta,
        params: {
          ...summaryDelta.params,
          delta: "Evaluating /private/tests with token=raw-token",
        },
      }).success,
    ).toBe(false);
    expect(
      runnerCodexEventSchema.safeParse({
        ...summaryDelta,
        params: {
          ...summaryDelta.params,
          delta: "x".repeat(
            runnerCodexPreviewLimits.activityTextCharacters + 1,
          ),
        },
      }).success,
    ).toBe(false);
  });

  it("accepts bounded redacted previews while keeping legacy preview-less items readable", () => {
    const commandEvent = {
      method: "item/completed",
      visibility: "user_collapsed",
      params: {
        threadId: "thread-1",
        turnId: "turn-1",
        item: {
          type: "commandExecution",
          id: "item-1",
          source: "agent",
          status: "completed",
          command:
            "pnpm test --config $WORKSPACE/package.json --token=[REDACTED]",
          commandActions: [
            {
              type: "read",
              command: "cat $WORKSPACE/README.md",
              name: "README.md",
              path: "$WORKSPACE/README.md",
            },
            {
              type: "listFiles",
              command: "find $WORKSPACE/src",
              path: null,
            },
            {
              type: "search",
              command: "rg TODO $WORKSPACE/src",
              query: "TODO",
              path: "$WORKSPACE/src",
            },
          ],
          exitCode: 0,
          durationMs: 25,
        },
      },
    };
    expect(runnerCodexEventSchema.safeParse(commandEvent).success).toBe(true);
    expect(
      runnerCodexEventSchema.safeParse({
        ...commandEvent,
        params: {
          ...commandEvent.params,
          item: {
            ...commandEvent.params.item,
            command: undefined,
            commandActions: [{ type: "read" }],
          },
        },
      }).success,
    ).toBe(true);

    for (const item of [
      {
        type: "fileChange",
        id: "file-1",
        status: "completed",
        changes: [
          { kind: { type: "update" }, path: "$WORKSPACE/src/report.ts" },
          { kind: { type: "add" }, path: "artifacts/report.pdf" },
        ],
      },
      {
        type: "webSearch",
        id: "search-1",
        query: "weather api-key=[REDACTED]",
        action: {
          type: "search",
          query: "weather in Shanghai",
          queries: ["weather today", "weather tomorrow"],
        },
      },
      {
        type: "webSearch",
        id: "search-2",
        action: {
          type: "findInPage",
          url: "https://[REDACTED]@example.test/report?token=[REDACTED]",
          pattern: "quarterly revenue",
        },
      },
      {
        type: "imageView",
        id: "image-1",
        path: "$ABSOLUTE/report.png",
        fileId: "30000000-0000-4000-8000-000000000001",
      },
    ]) {
      expect(
        runnerCodexEventSchema.safeParse(nativeItemEvent(item)).success,
        item.type,
      ).toBe(true);
    }
  });

  it("rejects an invalid projected image-view artifact id", () => {
    expect(
      runnerCodexEventSchema.safeParse(
        nativeItemEvent({
          type: "imageView",
          id: "image-invalid",
          path: "$WORKSPACE/report.png",
          fileId: "not-a-file-id",
        }),
      ).success,
    ).toBe(false);
  });

  it("accepts only opaque subagent projections and rejects native collaboration fields", () => {
    const collabItem = {
      type: "collabAgentToolCall",
      id: "collab-1",
      tool: "spawnAgent",
      status: "completed",
      agents: [
        {
          agentKey: "agent_abcdefghijklmnopqrstuvwx",
          agentLabel: "Feishu requirements",
          status: "running",
        },
      ],
    };
    const activityItem = {
      type: "subAgentActivity",
      id: "subagent-activity-1",
      kind: "started",
      agentKey: "agent_abcdefghijklmnopqrstuvwx",
      agentLabel: "Backend site icon tests",
    };

    expect(
      runnerCodexEventSchema.safeParse(nativeItemEvent(collabItem)).success,
    ).toBe(true);
    expect(
      runnerCodexEventSchema.safeParse(nativeItemEvent(activityItem)).success,
    ).toBe(true);
    expect(
      runnerCodexEventSchema.safeParse(
        nativeItemEvent({
          ...collabItem,
          id: "collab-followup-interrupted",
          tool: "followupTask",
          status: "interrupted",
        }),
      ).success,
    ).toBe(true);
    expect(
      runnerCodexEventSchema.safeParse(
        nativeItemEvent({
          ...activityItem,
          id: "subagent-activity-completed",
          kind: "completed",
        }),
      ).success,
    ).toBe(true);

    for (const [field, value] of [
      ["receiverThreadIds", ["native-subagent-alpha"]],
      ["agentsStates", { "native-subagent-alpha": { status: "running" } }],
      ["prompt", "private collaboration prompt"],
      ["senderThreadId", "native-parent-thread"],
    ] as const) {
      expect(
        runnerCodexEventSchema.safeParse(
          nativeItemEvent({ ...collabItem, [field]: value }),
        ).success,
        field,
      ).toBe(false);
    }

    for (const [field, value] of [
      ["agentThreadId", "native-subagent-alpha"],
      ["agentPath", "/root/backend_site_icon_tests"],
    ] as const) {
      expect(
        runnerCodexEventSchema.safeParse(
          nativeItemEvent({ ...activityItem, [field]: value }),
        ).success,
        field,
      ).toBe(false);
    }

    expect(
      runnerCodexEventSchema.safeParse(
        nativeItemEvent({
          ...collabItem,
          agents: [
            { agentKey: "agent_abcdefghijklmnopqrstuvwx", status: "running" },
            { agentKey: "agent_abcdefghijklmnopqrstuvwx", status: "completed" },
          ],
        }),
      ).success,
    ).toBe(false);
    expect(
      runnerCodexEventSchema.safeParse(
        nativeItemEvent({
          ...activityItem,
          agentLabel: "/private/agent-path",
        }),
      ).success,
    ).toBe(false);
    expect(
      runnerCodexEventSchema.safeParse(
        nativeItemEvent({
          ...collabItem,
          agents: [
            {
              agentKey: "agent_abcdefghijklmnopqrstuvwx",
              agentLabel: "/private/agent-path",
              status: "running",
            },
          ],
        }),
      ).success,
    ).toBe(false);
  });

  it("extracts only the opaque subagent keys referenced by a projected item", () => {
    const collabItem: RunnerCodexItem = {
      type: "collabAgentToolCall",
      id: "collab-keys",
      tool: "spawnAgent",
      status: "completed",
      agents: [
        {
          agentKey: "agent_abcdefghijklmnopqrstuvwx",
          status: "running",
        },
        {
          agentKey: "agent_zyxwvutsrqponmlkjihgfedc",
          status: "completed",
        },
      ],
    };
    const activityItem: RunnerCodexItem = {
      type: "subAgentActivity",
      id: "subagent-activity-keys",
      kind: "completed",
      agentKey: "agent_zyxwvutsrqponmlkjihgfedc",
    };

    expect(referencedRunnerCodexSubAgentKeys(collabItem)).toEqual([
      "agent_abcdefghijklmnopqrstuvwx",
      "agent_zyxwvutsrqponmlkjihgfedc",
    ]);
    expect(referencedRunnerCodexSubAgentKeys(activityItem)).toEqual([
      "agent_zyxwvutsrqponmlkjihgfedc",
    ]);
    expect(
      referencedRunnerCodexSubAgentKeys({
        type: "agentMessage",
        id: "message-without-subagent",
        text: "Safe projected message",
      }),
    ).toEqual([]);
  });

  it("rejects duplicate or invalid authorized subagent key lists", () => {
    const agentKey = "agent_abcdefghijklmnopqrstuvwx";

    expect(runnerCodexAgentKeysSchema.safeParse([agentKey]).success).toBe(true);
    expect(
      runnerCodexAgentKeysSchema.safeParse([agentKey, agentKey]).success,
    ).toBe(false);
    expect(runnerCodexAgentKeysSchema.safeParse([]).success).toBe(false);
    expect(runnerCodexAgentKeysSchema.safeParse(["native-thread-id"]).success).toBe(
      false,
    );
  });

  it("rejects unsafe command and web previews supplied directly to the wire schema", () => {
    const commandEvent = nativeItemEvent({
      type: "commandExecution",
      id: "command-1",
      status: "completed",
      commandActions: [],
    });

    for (const command of [
      "cat /private/secret",
      "cat</private/secret",
      "cat C:\\private\\secret",
      "printf '\u001b[31msecret'",
      "printf '\u009b31msecret'",
      "curl --token=raw-secret",
      "client API key: raw-secret",
      "Authorization: Bearer raw-secret",
      "curl https://user:password@example.test",
      "token%3Draw-encoded-secret",
      "https%3A%2F%2Fuser%3Apassword%40example.test",
      "export KEY=sk-12345678",
      "AWS_SECRET_ACCESS_KEY=raw-aws pnpm test",
      "export CLIENT_SECRET='raw client secret'",
      "tool --client-secret raw-client-secret",
      "tool --secret-access-key raw-secret-access-key",
      "tool --private-key raw-private-key",
      "tool --to\\ken=raw-shell-secret",
      "tool --to''ken=raw-shell-secret",
      'tool --to""ken=raw-shell-secret',
      "tool --to$''ken=raw-shell-secret",
      "tool --to%ZZken=raw-malformed-secret",
      "curl '?access_token[]=raw-access-token'",
      "curl '?token[value]=raw-token-value'",
      "curl '?credentials[password]=raw-password'",
      "curl '?api.key=raw-api-key'",
      "curl '?X-Amz-Signature=raw-signature'",
      "curl '?sig=raw-signature'",
      "curl '?signature=raw-signature'",
      "curl '?session_id=raw-session'",
      "curl '?jwt=raw-jwt'",
      "curl '?jwt_value=raw-jwt'",
      "curl '?passwd=raw-password'",
      "curl '?pwd=raw-password'",
      "curl '?db_pwd=raw-password'",
      ["tool ghp_", "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghij"].join(""),
      ["tool github_pat_", "11AA0_ABCDEFGHIJKLMNOPQRSTUVWXYZ123456"].join(
        ""
      ),
      ["tool glpat-", "ABCDEFGHIJKLMNOPQRSTUVWXYZ123456"].join(""),
      [
        "tool xoxb-",
        "123456789012-123456789012-abcdefghijklmnopqrstuvwx",
      ].join(""),
      "tool eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.c2lnbmF0dXJlMTIzNDU2",
      ["tool AKIA", "IOSFODNN7EXAMPLE"].join(""),
      ["tool AIza", "ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890"].join(""),
      "tool npm_ABCDEFGHIJKLMNOPQRSTUVWXYZ123456",
      ["tool sk_live_", "ABCDEFGHIJKLMNOPQRSTUVWXYZ"].join(""),
      ["tool -----BEGIN PRIVATE", " KEY-----"].join(""),
      "open file:///Users/one/private/report.txt",
      "open file:\\Users\\one\\private\\report.txt",
      "open file:%2F%2F%2FUsers%2Fone%2Fprivate%2Freport.txt",
      "open file:%5CUsers%5Cone%5Cprivate%5Creport.txt",
      "open file%3A%2F%2F%2FUsers%2Fone%2Fprivate%2Freport.txt",
      "open %2FUsers%2Fone%2Fprivate%2Freport.txt",
      "open %43%3A%5CUsers%5Cone%5Cprivate%5Creport.txt",
      "open %1B%2FUsers%2Fone%2Fprivate%2Freport.txt",
      "open %00%2FUsers%2Fone%2Fprivate%2Freport.txt",
      "open %7F%2FUsers%2Fone%2Fprivate%2Freport.txt",
      "open %1B%5B31m%2FUsers%2Fone%2Fprivate%2Freport.txt",
      "open file:%1B%2F%2F%2FUsers%2Fone%2Fprivate%2Freport.txt",
      "open %E0%A4%A%1B%2FUsers%2Fone%2Fprivate%2Freport.txt",
      "open %E0%A4%A%1B%5B31m%2FUsers%2Fone%2Fprivate%2Freport.txt",
      "open %E0%A4%A%1B%43%3A%5CUsers%5Cone%5Cprivate%5Creport.txt",
      "open %E0%A4%A%1B%5C%5Cserver%5Cshare%5Creport.txt",
      "open %E0%A4%A%C2%9B31m%2FUsers%2Fone%2Fprivate%2Freport.txt",
      "open %E0%A4%A%2FUsers%2Fone%2Fprivate%2Freport.txt",
      "open %E0%2FUsers%2Fone%2Fprivate%2Freport.txt",
      "open %ZZ%2FUsers%2Fone%2Fprivate%2Freport.txt",
      "open %ZZ%43%3A%5CUsers%5Cone%5Cprivate%5Creport.txt",
      "open %ZZ%5C%5Cserver%5Cshare%5Creport.txt",
      "open %ZZ/Users/one/private/report.txt",
      "open \\Users\\one\\private\\report.txt",
      "open \\/Users/one/private/report.txt",
      "open `/Users/one/private/report.txt`",
      "open ∕Users/one/private/report.txt",
      "open file：///Users/one/private/report.txt",
      "open \u200B/Users/one/private/report.txt",
      "open \u009b/Users/one/private/report.txt",
      "open \u001b[/Users/one/private/report.txt",
      "open %1B%5B%2FUsers%2Fone%2Fprivate%2Freport.txt",
      "open ~/private/report.txt",
      "open ~one/private/report.txt",
      "open $HOME/private/report.txt",
      "open ${HOME}/private/report.txt",
      "open $USERPROFILE/private/report.txt",
      "open ${USERPROFILE}/private/report.txt",
      "tool --ｔｏｋｅｎ＝raw-secret",
      "tool --to\u200bken=raw-secret",
      "tool --to\u0000ken raw-secret",
      "https://example.test/view?file=/Users/one/private/report.txt",
      "https://example.test/view?file=%2FUsers%2Fone%2Fprivate%2Freport.txt",
      "https://example.test/view?file=%E2%88%95Users%2Fone%2Fprivate%2Freport.txt",
      "https://example.test/view#file=/Users/one/private/report.txt",
      "https%3A%2F%2Fexample.test%2Fview%3Ffile%3D%2FUsers%2Fone%2Fprivate%2Freport.txt",
      "echo %00",
      "open $ABSOLUTE/%2FUsers%2Fone%2Fprivate%2Freport.txt",
      "open $ABSOLUTE%2FUsers%2Fone%2Fprivate%2Freport.txt",
      "open $WORKSPACE/%252FUsers%252Fone%252Fprivate%252Freport.txt",
      "open $ABSOLUTE/private/report.txt",
      "x".repeat(runnerCodexPreviewLimits.commandCharacters + 1),
    ]) {
      expect(
        runnerCodexEventSchema.safeParse({
          ...commandEvent,
          params: {
            ...commandEvent.params,
            item: { ...commandEvent.params.item, command },
          },
        }).success,
        JSON.stringify(command),
      ).toBe(false);
    }

    expect(
      runnerCodexEventSchema.safeParse({
        ...commandEvent,
        params: {
          ...commandEvent.params,
          item: {
            ...commandEvent.params.item,
            commandActions: Array.from(
              { length: runnerCodexPreviewLimits.commandActions + 1 },
              () => ({ type: "read" }),
            ),
          },
        },
      }).success,
    ).toBe(false);

    for (const action of [
      { type: "read", name: "README.md", path: "/private/secret" },
      { type: "listFiles", path: "/private/secret" },
      { type: "search", query: "token=raw-secret", path: null },
      { type: "search", query: null, path: "/private/secret" },
    ]) {
      expect(
        runnerCodexEventSchema.safeParse({
          ...commandEvent,
          params: {
            ...commandEvent.params,
            item: {
              ...commandEvent.params.item,
              commandActions: [action],
            },
          },
        }).success,
        JSON.stringify(action),
      ).toBe(false);
    }

    const webEvent = nativeItemEvent({
      type: "webSearch",
      id: "search-1",
      query: "Authorization: raw-secret",
      action: { type: "openPage", url: "https://example.test" },
    });
    expect(runnerCodexEventSchema.safeParse(webEvent).success).toBe(false);
  });

  it("accepts safe percent-encoded relative paths and remote URLs", () => {
    for (const path of [
      "src/report%20final.ts",
      "src/100%25-ready.ts",
      "src/100%-ready.ts",
      "$WORKSPACE/资料/报告%20终稿.pdf",
      "资料/报告 终稿.pdf",
    ]) {
      expect(
        runnerCodexEventSchema.safeParse(
          nativeItemEvent({ type: "imageView", id: "image-safe", path }),
        ).success,
        JSON.stringify(path),
      ).toBe(true);
    }

    for (const command of [
      "open src/report%20final.ts",
      "open src/100%25-ready.ts",
      "curl https%3A%2F%2Fexample.test%2Fdocs",
      "curl 'https://example.test?design=opaque-value'",
    ]) {
      expect(
        runnerCodexEventSchema.safeParse(
          nativeItemEvent({
            type: "commandExecution",
            id: "command-safe",
            status: "completed",
            command,
            commandActions: [],
          }),
        ).success,
        command,
      ).toBe(true);
    }

    for (const url of [
      "https://example.test/docs/guide",
      "https://example.test/~docs/guide",
      "https://example.test/a%2Fb?q=100%25",
      "https%3A%2F%2Fexample.test%2Fdocs",
      "https://example.test/view?next=https%3A%2F%2Fother.test%2Fdocs",
    ]) {
      expect(
        runnerCodexEventSchema.safeParse(
          nativeItemEvent({
            type: "webSearch",
            id: "search-safe",
            action: { type: "openPage", url },
          }),
        ).success,
        url,
      ).toBe(true);
    }
  });

  it("rejects unsafe MCP, dynamic-tool, and image-generation identity previews", () => {
    const unsafeItems = [
      {
        type: "mcpToolCall",
        id: "mcp-secret-server",
        server: "ｔｏｋｅｎ＝raw-secret",
        tool: "create",
        status: "completed",
      },
      {
        type: "mcpToolCall",
        id: "mcp-path-tool",
        server: "documents",
        tool: "/Users/one/private/tool",
        status: "completed",
      },
      {
        type: "mcpToolCall",
        id: "mcp-control-plugin",
        server: "documents",
        tool: "create",
        pluginId: "plug\u200bin",
        status: "completed",
      },
      {
        type: "dynamicToolCall",
        id: "dynamic-secret-namespace",
        namespace: "Authorization: Bearer raw-secret",
        tool: "render",
        status: "completed",
      },
      {
        type: "dynamicToolCall",
        id: "dynamic-path-tool",
        namespace: "images",
        tool: "file:///Users/one/private/tool",
        status: "completed",
      },
      {
        type: "imageGeneration",
        id: "image-secret-status",
        status: "token=raw-secret",
      },
    ];

    for (const item of unsafeItems) {
      expect(
        runnerCodexEventSchema.safeParse(nativeItemEvent(item)).success,
        item.id,
      ).toBe(false);
    }

    for (const item of [
      {
        type: "mcpToolCall",
        id: "mcp-safe",
        server: "documents",
        tool: "create_document",
        pluginId: "office-tools",
        status: "completed",
      },
      {
        type: "dynamicToolCall",
        id: "dynamic-safe",
        namespace: "images",
        tool: "render_preview",
        status: "completed",
      },
      {
        type: "imageGeneration",
        id: "image-safe-status",
        status: "completed",
      },
    ]) {
      expect(
        runnerCodexEventSchema.safeParse(nativeItemEvent(item)).success,
        item.id,
      ).toBe(true);
    }
  });

  it("allows only the terminal no-available-bases outcome on knowledge search items", () => {
    expect(
      runnerCodexEventSchema.safeParse(
        nativeItemEvent({
          type: "mcpToolCall",
          id: "knowledge-search-no-bases",
          server: "linksense_core",
          tool: "search_knowledge_base",
          status: "completed",
          failureCode: "KNOWLEDGE_NO_AVAILABLE_BASES",
        }),
      ).success,
    ).toBe(true);

    for (const item of [
      {
        server: "other_service",
        tool: "search_knowledge_base",
        status: "completed",
        failureCode: "KNOWLEDGE_NO_AVAILABLE_BASES",
      },
      {
        server: "linksense_core",
        tool: "other_tool",
        status: "failed",
        failureCode: "KNOWLEDGE_NO_AVAILABLE_BASES",
      },
      {
        server: "linksense_core",
        tool: "search_knowledge_base",
        status: "inProgress",
        failureCode: "KNOWLEDGE_NO_AVAILABLE_BASES",
      },
      {
        server: "linksense_core",
        tool: "search_knowledge_base",
        status: "failed",
        failureCode: "KNOWLEDGE_SEARCH_UNAVAILABLE",
      },
    ]) {
      expect(
        runnerCodexEventSchema.safeParse(
          nativeItemEvent({
            type: "mcpToolCall",
            id: "knowledge-search-invalid-outcome",
            ...item,
          }),
        ).success,
        JSON.stringify(item),
      ).toBe(false);
    }
  });

  it("rejects unsafe path previews and enforces file preview count limits", () => {
    for (const path of [
      "/private/report.ts",
      "C:\\private\\report.ts",
      "../report.ts",
      "$WORKSPACE/../report.ts",
      "$WORKSPACE\\src\\report.ts",
      "$ABSOLUTE/private/report.ts",
      "$ABSOLUTE/%2FUsers%2Fone%2Fprivate%2Freport.txt",
      "$ABSOLUTE/%252FUsers%252Fone%252Fprivate%252Freport.txt",
      "$ABSOLUTE%2FUsers%2Fone%2Fprivate%2Freport.txt",
      "%ZZ/Users/one/private/report.txt",
      "%ZZ/C:/Users/one/private/report.txt",
      "file:%ZZ/Users/one/private/report.txt",
      "\\Users\\one\\private\\report.txt",
      "\\/Users/one/private/report.txt",
      "`/Users/one/private/report.txt`",
      "∕Users/one/private/report.txt",
      "file：///Users/one/private/report.txt",
      "\u200B/Users/one/private/report.txt",
      "\u009b/Users/one/private/report.txt",
      "\u001b[/Users/one/private/report.txt",
      "~/private/report.txt",
      "~one/private/report.txt",
      "$HOME/private/report.txt",
      "${HOME}/private/report.txt",
      "$USERPROFILE/private/report.txt",
      "${USERPROFILE}/private/report.txt",
      "src/foo%ZZ/report.txt",
      "src%2Fprivate%2Freport.txt",
      "src%E2%88%95private.txt",
      "src%EF%BC%8Fprivate.txt",
      "src/%2E%2E/report.txt",
      "src/\u001breport.ts",
      "token=raw-secret",
      "x".repeat(runnerCodexPreviewLimits.pathCharacters + 1),
    ]) {
      expect(
        runnerCodexEventSchema.safeParse(
          nativeItemEvent({ type: "imageView", id: "image-1", path }),
        ).success,
        JSON.stringify(path),
      ).toBe(false);
    }

    expect(
      runnerCodexEventSchema.safeParse(
        nativeItemEvent({
          type: "fileChange",
          id: "file-1",
          status: "completed",
          changes: Array.from(
            { length: runnerCodexPreviewLimits.fileChanges + 1 },
            () => ({ kind: { type: "update" } }),
          ),
        }),
      ).success,
    ).toBe(false);

    expect(
      runnerCodexEventSchema.safeParse(
        nativeItemEvent({
          type: "fileChange",
          id: "file-malformed-path",
          status: "completed",
          changes: [
            {
              path: "%ZZ/Users/one/private/report.txt",
              kind: { type: "update" },
            },
          ],
        }),
      ).success,
    ).toBe(false);
  });

  it("strictly rejects raw outputs, diffs, tool payloads, and dynamic content", () => {
    const commandEvent = nativeItemEvent({
      type: "commandExecution",
      id: "command-1",
      source: "agent",
      status: "completed",
      commandActions: [{ type: "read" }],
      exitCode: 0,
      durationMs: 25,
    });

    for (const [field, value] of [
      ["cwd", "/private/workspace"],
      ["aggregatedOutput", "token=secret"],
      ["stdout", "private stdout"],
      ["stderr", "private stderr"],
    ] as const) {
      expect(
        runnerCodexEventSchema.safeParse({
          ...commandEvent,
          params: {
            ...commandEvent.params,
            item: { ...commandEvent.params.item, [field]: value },
          },
        }).success,
        field,
      ).toBe(false);
    }

    expect(
      runnerCodexEventSchema.safeParse(
        nativeItemEvent({
          type: "fileChange",
          id: "file-1",
          status: "completed",
          changes: [
            {
              path: "$WORKSPACE/report.ts",
              kind: { type: "update", move_path: "/private/new-report.ts" },
              diff: "+ private content",
            },
          ],
        }),
      ).success,
    ).toBe(false);

    for (const item of [
      {
        type: "mcpToolCall",
        id: "mcp-1",
        server: "documents",
        tool: "create",
        status: "completed",
        arguments: { token: "secret" },
      },
      {
        type: "mcpToolCall",
        id: "mcp-1",
        server: "documents",
        tool: "create",
        status: "completed",
        result: { output: "secret" },
      },
      {
        type: "mcpToolCall",
        id: "mcp-1",
        server: "documents",
        tool: "create",
        status: "failed",
        error: { message: "secret" },
      },
      {
        type: "dynamicToolCall",
        id: "dynamic-1",
        tool: "render",
        status: "completed",
        contentItems: [{ type: "text", text: "private" }],
      },
    ]) {
      expect(
        runnerCodexEventSchema.safeParse(nativeItemEvent(item)).success,
        item.type,
      ).toBe(false);
    }
  });

  it("accepts safe Codex failure messages but rejects unsafe error details", () => {
    const errorEvent = {
      method: "error",
      visibility: "user_visible",
      params: {
        threadId: "thread-1",
        turnId: "turn-1",
        willRetry: false,
        error: {
          message: "The model provider quota is exhausted.",
          codexErrorInfo: "usageLimitExceeded",
        },
      },
    };
    expect(runnerCodexEventSchema.safeParse(errorEvent).success).toBe(true);
    expect(
      runnerCodexEventSchema.safeParse({
        ...errorEvent,
        params: {
          ...errorEvent.params,
          error: {
            ...errorEvent.params.error,
            codexErrorInfo: "sessionBudgetExceeded",
          },
        },
      }).success,
    ).toBe(true);
    expect(
      runnerCodexEventSchema.safeParse({
        ...errorEvent,
        params: {
          ...errorEvent.params,
          error: {
            ...errorEvent.params.error,
            message: "api_key=unredacted-secret",
          },
        },
      }).success,
    ).toBe(false);
    expect(
      runnerCodexEventSchema.safeParse({
        ...errorEvent,
        params: {
          ...errorEvent.params,
          error: {
            ...errorEvent.params.error,
            additionalDetails: "/private/provider-response",
          },
        },
      }).success,
    ).toBe(false);
  });

  it("retains safe reasoning summaries but rejects raw reasoning content", () => {
    const reasoningEvent = {
      method: "item/completed",
      visibility: "user_collapsed",
      params: {
        threadId: "thread-1",
        turnId: "turn-1",
        item: { type: "reasoning", id: "item-2" },
      },
    };
    expect(runnerCodexEventSchema.safeParse(reasoningEvent).success).toBe(true);
    expect(
      runnerCodexEventSchema.safeParse({
        ...reasoningEvent,
        params: {
          ...reasoningEvent.params,
          item: {
            ...reasoningEvent.params.item,
            summary: ["Planning the implementation"],
          },
        },
      }).success,
    ).toBe(true);
    expect(
      runnerCodexEventSchema.safeParse({
        ...reasoningEvent,
        params: {
          ...reasoningEvent.params,
          item: {
            ...reasoningEvent.params.item,
            content: ["private chain of thought"],
          },
        },
      }).success,
    ).toBe(false);
  });

  it("accepts the pinned token usage notification only as a strict runner event", () => {
    const event = {
      method: "thread/tokenUsage/updated",
      visibility: "internal_sanitized",
      params: {
        threadId: "thread-1",
        turnId: "turn-1",
        tokenUsage: {
          total: {
            totalTokens: 30,
            inputTokens: 20,
            cachedInputTokens: 5,
            outputTokens: 10,
            reasoningOutputTokens: 3,
          },
          last: {
            totalTokens: 30,
            inputTokens: 20,
            cachedInputTokens: 5,
            outputTokens: 10,
            reasoningOutputTokens: 3,
          },
          modelContextWindow: null,
        },
      },
    };

    expect(runnerCodexEventSchema.safeParse(event).success).toBe(true);
    expect(runnerConversationEventSchema.safeParse(event).success).toBe(true);
    expect(
      runnerCodexEventSchema.safeParse({
        ...event,
        params: {
          ...event.params,
          tokenUsage: {
            ...event.params.tokenUsage,
            providerResponse: "must not cross the runner boundary",
          },
        },
      }).success,
    ).toBe(false);
  });
});

function progressPayload() {
  return {
    schema_version: 1,
    item_id: "native-item-1",
    action: "working_in_workspace",
    safe_summary: "working_in_workspace",
  };
}

function nativeItemEvent(item: Record<string, unknown>) {
  return {
    method: "item/completed",
    visibility: "user_collapsed",
    params: {
      threadId: "thread-1",
      turnId: "turn-1",
      item,
    },
  };
}

function filePayload() {
  return {
    schema_version: 1,
    file_id: entityId,
    display_name: "report.pdf",
    mime_type: "application/pdf",
    size_bytes: 123,
  };
}
