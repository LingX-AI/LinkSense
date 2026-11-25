import { describe, expect, it } from "vitest";
import {
  desktopConversationReferenceReadOperation,
  desktopExecutionDeviceReadySchema,
  desktopExecutionMaxFrameBytes,
  desktopExecutionProtocolVersion,
  desktopNegotiatedOperationSchema,
  desktopToolLifetimeFor,
  desktopToolOperationSchema,
  desktopToolProtocolVersion,
  desktopToolRequestSchema,
  desktopToolResultSchema,
  type DesktopToolRequestOperation,
} from "./desktop-execution.js";
import { readConversationReferenceInputSchema, type ReadConversationReferenceResult } from "./conversation-references.js";

const owner = "10000000-0000-4000-8000-000000000001";
const conversation = "10000000-0000-4000-8000-000000000002";
const generation = "10000000-0000-4000-8000-000000000003";
const turn = "10000000-0000-4000-8000-000000000004";
const request = "10000000-0000-4000-8000-000000000005";
const source = "10000000-0000-4000-8000-000000000006";
const message = "10000000-0000-4000-8000-000000000007";
const expiresAt = "2026-01-01T00:00:30.000Z";
const runToken = `lsdr_${"a".repeat(43)}`;

function toolRequest(body: unknown) {
  return {
    type: "tool.request", id: request, conversation_id: conversation, runtime_generation: generation,
    turn_id: turn, expires_at: expiresAt, run_token: runToken,
    operation: desktopConversationReferenceReadOperation, body,
  };
}

describe("desktop conversation reference read contract", () => {
  it("adds one negotiated read operation without widening any command operation", () => {
    expect(desktopConversationReferenceReadOperation).toBe("conversation_reference.read");
    expect(desktopNegotiatedOperationSchema.options).toContain(desktopConversationReferenceReadOperation);
    expect(desktopToolOperationSchema.options).toContain(desktopConversationReferenceReadOperation);
    const parsed = desktopToolRequestSchema.parse(toolRequest({ conversation_id: source }));
    expect(parsed).toMatchObject({
      operation: "conversation_reference.read",
      body: { conversation_id: source, cursor: "0", offset: 0 },
    });
  });

  it("gives only the reference read a 15 second deadline", () => {
    const lifetimes: Array<[DesktopToolRequestOperation, number]> = [
      [desktopConversationReferenceReadOperation, 15_000],
      ["web.search", 62_000],
      ["knowledge.search", 202_000],
      ["knowledge.documents", 202_000],
      ["knowledge.markdown", 202_000],
      ["connection.execute", 58_000],
      ["browser.execute", 34_000],
      ["artifact.prepare", 10_000],
      ["artifact.multipart", 10_000],
      ["artifact.website", 10_000],
      ["computer.execute", 25_000],
    ];
    for (const [operation, expected] of lifetimes) {
      expect(desktopToolLifetimeFor(operation), operation).toBe(expected);
    }
  });

  it("rejects model-supplied identity, path, and receiving-turn overrides", () => {
    for (const body of [
      { conversation_id: source, owner_id: owner },
      { conversation_id: source, turn_id: turn },
      { conversation_id: source, path: "/tmp/foreign-history" },
      { conversation_id: source, conversation_ids: [source] },
    ]) expect(desktopToolRequestSchema.safeParse(toolRequest(body)).success).toBe(false);
    expect(readConversationReferenceInputSchema.safeParse({
      conversation_id: source, owner_id: owner,
    }).success).toBe(false);
  });

  it("keeps the bounded established result page inside one escaped desktop frame", () => {
    // readTaskReference enforces 16,000 UTF-16 code units across the page.
    // Control characters, quotes, and backslashes are the worst JSON escapes.
    const text = "\u0000\"\\".repeat(6_000).slice(0, 16_000);
    const title = "\u0001\"\\".repeat(80).slice(0, 240);
    const result: ReadConversationReferenceResult = {
      conversation_id: source, title,
      messages: [{ id: message, role: "assistant", text }],
      next_cursor: null, next_offset: 0,
    };
    const frame = desktopToolResultSchema.parse({
      type: "tool.result", id: request, operation: desktopConversationReferenceReadOperation, ok: true, data: result,
    });
    expect(Buffer.byteLength(JSON.stringify(frame), "utf8")).toBeLessThan(desktopExecutionMaxFrameBytes);
  });

  it("keeps old ready frames valid while advertising the optional operation only when offered", () => {
    const ready = {
      type: "ready", device_id: owner, connection_id: conversation,
      protocol_version: 1, heartbeat_interval_ms: 15_000,
      execution_protocol_version: desktopExecutionProtocolVersion,
    };
    expect(desktopExecutionDeviceReadySchema.safeParse(ready).success).toBe(true);
    expect(desktopExecutionDeviceReadySchema.parse({
      ...ready, tool_protocol_version: desktopToolProtocolVersion,
      tool_operations: [desktopConversationReferenceReadOperation],
    }).tool_operations).toEqual([desktopConversationReferenceReadOperation]);
  });
});
