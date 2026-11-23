import { createHash, randomUUID } from "node:crypto";
import { expect, it, vi } from "vitest";
import {
  desktopConnectionTextPageBytes, desktopToolRequestSchema,
  type ComputerObservation, type DesktopToolRequest,
} from "@linksense/shared";
import { AppError } from "../src/lib/errors.js";
import type { DesktopComputerReadPublication } from "../src/modules/desktop-devices/computer-admission.js";
import {
  executeDesktopTool,
  type DesktopToolResultDelivery,
} from "../src/modules/desktop-devices/tool-requests.js";

function connectionFrame() {
  const scope = {
    ownerId: randomUUID(), deviceId: randomUUID(), connectionId: randomUUID(),
    conversationId: randomUUID(), turnId: randomUUID(), runtimeGeneration: randomUUID(),
  };
  return { scope, raw: {
    type: "tool.request", operation: "connection.execute", id: randomUUID(),
    conversation_id: scope.conversationId, turn_id: scope.turnId, runtime_generation: scope.runtimeGeneration,
    expires_at: new Date(Date.now() + 5_000).toISOString(), run_token: `lsdr_${"a".repeat(43)}`,
    body: { input: { operation: "list_drives", provider: "onedrive" } },
  } };
}

it("relays a connector request under the server's scope and does not replay it", async () => {
  const { scope, raw } = connectionFrame();
  const frame = desktopToolRequestSchema.parse(raw);
  const signal = new AbortController().signal;
  const assertCurrent = vi.fn(async () => {});
  const executeScoped = vi.fn(async () => ({
    data: { kind: "page" as const, items: [], next_cursor: null },
    assertCurrent,
  }));
  const write = vi.fn(async () => {});
  const services = {
    checkPublication: vi.fn(),
    leases: {
      claimToolRequest: vi.fn().mockResolvedValueOnce(true).mockResolvedValue(false),
      verifyRunBinding: vi.fn(async () => {}),
    },
    knowledgeSearch: null, audit: { write }, webSearchSettings: { search: vi.fn() },
    connections: { executeScoped },
  };
  await expect(executeDesktopTool(services, scope, frame, signal)).resolves.toMatchObject({
    operation: "connection.execute", ok: true, data: { kind: "page", items: [], next_cursor: null },
  });
  expect(executeScoped).toHaveBeenCalledWith(
    scope.ownerId, scope.conversationId, scope.turnId, raw.body.input, signal, expect.any(Function),
  );
  expect(assertCurrent).toHaveBeenCalledOnce();
  expect(write).toHaveBeenCalledWith(expect.objectContaining({ targetType: "connection" }));
  await expect(executeDesktopTool(services, scope, frame, signal)).resolves.toMatchObject({
    error_code: "RUNNER_OPERATION_UNCERTAIN",
  });
  expect(executeScoped).toHaveBeenCalledOnce();
});

it("does not accept connector file bytes in the device envelope", () => {
  const { raw } = connectionFrame();
  expect(desktopToolRequestSchema.safeParse({ ...raw, body: {
    input: { operation: "create_file", provider: "onedrive", drive_id: "drive", name: "fixture.txt", content_base64: "dGVzdA==" },
  } }).success).toBe(false);
  expect(desktopToolRequestSchema.safeParse({ ...raw, body: { ...raw.body, owner_id: randomUUID() } }).success).toBe(false);
});

it("withholds buffered connector data when the account is disconnected during final run authorization", async () => {
  const { scope, raw } = connectionFrame();
  let audited = false;
  let connected = true;
  const signal = new AbortController().signal;
  const result = await executeDesktopTool({
    checkPublication: vi.fn(),
    leases: {
      claimToolRequest: async () => true,
      verifyRunBinding: async () => { if (audited) connected = false; },
    },
    audit: { write: async () => { audited = true; } },
    knowledgeSearch: null,
    webSearchSettings: { search: vi.fn() },
    connections: { executeScoped: async () => ({
      data: { kind: "page" as const, items: [], next_cursor: null },
      assertCurrent: async () => { if (!connected) throw new AppError("CONNECTION_REQUIRED"); },
    }) },
  }, scope, desktopToolRequestSchema.parse(raw), signal);
  expect(result).toMatchObject({ ok: false, error_code: "CONNECTION_REQUIRED" });
  expect(result).not.toHaveProperty("data");
});

it.each([
  { loss: "before dispatch", action: "click", expected: "FORBIDDEN" },
  { loss: "after extension success", action: "click", expected: "RUNNER_OPERATION_UNCERTAIN" },
  { loss: "during audit", action: "click", expected: "RUNNER_OPERATION_UNCERTAIN" },
  { loss: "extension replaced during audit", action: "click", expected: "RUNNER_OPERATION_UNCERTAIN" },
  { loss: "extension replaced during audit", action: "snapshot", expected: "FORBIDDEN" },
])("withholds a $action result on authority loss $loss with $expected", async ({ loss, action, expected }) => {
  const { scope, raw } = connectionFrame();
  const frame = desktopToolRequestSchema.parse({
    ...raw, operation: "browser.execute",
    body: action === "click" ? { action, tab_id: 1, ref: "fixture" } : { action, tab_id: 1 },
  });
  let active = true;
  let extensionCurrent = true;
  const execute = vi.fn(async () => {
    if (loss === "before dispatch") throw new AppError("FORBIDDEN");
    if (loss === "after extension success") active = false;
    return {
      data: { result: { ok: true as const, browser: "local" as const, data: { title: "fixture private result" } } },
      assertCurrent: async () => { if (!extensionCurrent) throw new AppError("FORBIDDEN"); },
    };
  });
  const result = await executeDesktopTool({
    checkPublication: vi.fn(),
    leases: {
      claimToolRequest: async () => true,
      verifyRunBinding: async () => { if (!active) throw new AppError("AUTH_REQUIRED"); },
    },
    audit: { write: async () => {
      if (loss === "during audit") active = false;
      if (loss === "extension replaced during audit") extensionCurrent = false;
    } },
    knowledgeSearch: null, webSearchSettings: { search: vi.fn() }, browserUse: { execute },
  }, scope, frame, new AbortController().signal);
  expect(result).toMatchObject({ ok: false, error_code: expected });
  expect(result).not.toHaveProperty("data");
  expect(execute).toHaveBeenCalledOnce();
});

it("pages projected connector text before it crosses the bridge and rejects a changed revision", async () => {
  const { scope, raw } = connectionFrame();
  const text = '白盒🌿 "\\\n'.repeat(100_000);
  const expected = JSON.stringify({ documentId: "doc", text });
  let revision = text;
  const services = {
    checkPublication: vi.fn(),
    leases: { claimToolRequest: async () => true, verifyRunBinding: async () => {} },
    knowledgeSearch: null, audit: { write: async () => {} }, webSearchSettings: { search: vi.fn() },
    connections: { executeScoped: async () => ({
      data: { kind: "workspace_data" as const, data: {
        documentId: "doc",
        contentUri: "https://images.example.test/private-image",
        body: { content: [{ paragraph: { elements: [{ textRun: { content: revision } }] } }] },
      }, next_cursor: null },
      assertCurrent: async () => {},
    }) },
  };
  const signal = new AbortController().signal;
  const read = (page?: { byte_offset: number; expected_sha256: string }) => executeDesktopTool(
    services, scope, desktopToolRequestSchema.parse({ ...raw, id: randomUUID(), body: {
      input: { provider: "google_docs", operation: "read_document", document_id: "doc" }, page,
    } }), signal,
  );
  const first = await read();
  if (!first.ok || first.operation !== "connection.execute" || first.data.kind !== "workspace_text")
    throw new Error("expected a projected workspace page");
  const sha256 = createHash("sha256").update(expected).digest("hex");
  expect(first.data).toMatchObject({ complete: false, sha256, next_cursor: null });
  expect(first.data.next_byte_offset).toBe(Buffer.byteLength(first.data.data));
  let combined = first.data.data;
  let offset = first.data.next_byte_offset;
  while (offset !== null) {
    const page = await read({ byte_offset: offset, expected_sha256: sha256 });
    if (!page.ok || page.operation !== "connection.execute" || page.data.kind !== "workspace_text")
      throw new Error("expected a continuation page");
    expect(Buffer.byteLength(JSON.stringify(page.data))).toBeLessThanOrEqual(desktopConnectionTextPageBytes);
    combined += page.data.data;
    offset = page.data.next_byte_offset;
  }
  expect(combined).toBe(expected);
  expect(combined).not.toContain("private-image");
  const nextOffset = first.data.next_byte_offset;
  if (!nextOffset) throw new Error("missing next offset");
  const midEmoji = Buffer.from(expected).indexOf("🌿") + 1;
  await expect(read({ byte_offset: midEmoji, expected_sha256: sha256 })).resolves.toMatchObject({
    ok: false, error_code: "VALIDATION_ERROR",
  });
  revision = "edited";
  await expect(read({ byte_offset: nextOffset, expected_sha256: sha256 })).resolves.toMatchObject({
    ok: false, error_code: "CONNECTION_FILE_CONFLICT",
  });
});

it("does not return a search result after the turn loses authority during the audit write", async () => {
  const scope = {
    ownerId: randomUUID(), deviceId: randomUUID(), connectionId: randomUUID(),
    conversationId: randomUUID(), turnId: randomUUID(), runtimeGeneration: randomUUID(),
  };
  const frame: DesktopToolRequest = {
    type: "tool.request", operation: "web.search", id: randomUUID(),
    conversation_id: scope.conversationId, turn_id: scope.turnId, runtime_generation: scope.runtimeGeneration,
    expires_at: new Date(Date.now() + 5_000).toISOString(), run_token: `lsdr_${"a".repeat(43)}`,
    body: { query: "sample" },
  };
  let active = true;
  const audit = vi.fn(async () => { active = false; });
  await expect(executeDesktopTool({
    checkPublication: vi.fn(),
    leases: {
      claimToolRequest: async () => true,
      verifyRunBinding: async () => { if (!active) throw new AppError("AUTH_REQUIRED"); },
    },
    knowledgeSearch: null,
    audit: { write: audit },
    webSearchSettings: {
      search: async () => ({ success: true, provider: "brave", query: frame.body.query, results: [] }),
    },
  }, scope, frame, new AbortController().signal)).rejects.toMatchObject({ code: "AUTH_REQUIRED" });
  expect(audit).toHaveBeenCalledOnce();
});

it.each(["grant during audit", "run during document recheck"])("does not return buffered Markdown after losing the %s", async lost => {
  const scope = {
    ownerId: randomUUID(), deviceId: randomUUID(), connectionId: randomUUID(),
    conversationId: randomUUID(), turnId: randomUUID(), runtimeGeneration: randomUUID(),
  };
  const documentRef = "d".repeat(32);
  const frame: DesktopToolRequest = {
    type: "tool.request", operation: "knowledge.markdown", id: randomUUID(),
    conversation_id: scope.conversationId, turn_id: scope.turnId, runtime_generation: scope.runtimeGeneration,
    expires_at: new Date(Date.now() + 5_000).toISOString(), run_token: `lsdr_${"a".repeat(43)}`,
    body: { document_ref: documentRef },
  };
  let granted = true;
  let active = true;
  const signal = new AbortController().signal;
  const assertDocumentReferencesCurrent = vi.fn(async () => {
    if (!granted) throw new AppError("FORBIDDEN");
    if (lost === "run during document recheck") active = false;
  });
  await expect(executeDesktopTool({
    checkPublication: vi.fn(),
    leases: {
      claimToolRequest: async () => true,
      verifyRunBinding: async () => { if (!active) throw new AppError("AUTH_REQUIRED"); },
    },
    audit: { write: async () => { if (lost === "grant during audit") granted = false; } },
    webSearchSettings: { search: vi.fn() },
    knowledgeSearch: {
      search: vi.fn(), listDocuments: vi.fn(), assertDocumentReferencesCurrent,
      getDocumentMarkdown: async () => ({
        success: true, document_ref: documentRef, knowledge_base_name: "Guide", document_name: "Guide.md",
        file_type: "md", markdown: "sample", chunk_index: 0, byte_start: 0, byte_end: 6,
        total_bytes: 6, next_cursor: null, complete: true,
      }),
    },
  }, scope, frame, signal)).rejects.toMatchObject({
    code: lost === "grant during audit" ? "FORBIDDEN" : "AUTH_REQUIRED",
  });
  expect(assertDocumentReferencesCurrent).toHaveBeenCalledWith({ ...scope, signal }, [documentRef]);
});

const privateObservation: ComputerObservation = {
  observation_id: "obs-private", tree_quality: "good", truncated: false,
  nodes: [{ ref: "e-private", role: "text", name: "PRIVATE_AX_TEXT" }],
};

function computerObserveFrame() {
  const scope = {
    ownerId: randomUUID(), deviceId: randomUUID(), connectionId: randomUUID(),
    conversationId: randomUUID(), turnId: randomUUID(), runtimeGeneration: randomUUID(),
  };
  return { scope, raw: {
    type: "tool.request", operation: "computer.execute", id: randomUUID(),
    conversation_id: scope.conversationId, turn_id: scope.turnId, runtime_generation: scope.runtimeGeneration,
    expires_at: new Date(Date.now() + 5_000).toISOString(), run_token: `lsdr_${"a".repeat(43)}`,
    body: { kind: "observe" },
  } };
}

function computerStatusFrame() {
  const { scope, raw } = computerObserveFrame();
  return { scope, raw: { ...raw, body: { kind: "status" } } };
}

function computerActFrame() {
  const { scope, raw } = computerObserveFrame();
  return { scope, raw: { ...raw, body: {
    kind: "act", native_call_id: "native-call-1",
    input: { action: "click", observation_id: "obs-1", ref: "e1" },
  } } };
}

const privateStatus = { available: true, permissions: { accessibility: "granted" as const }, active_grant: true };

it("refuses a product observe success without request-local proof and never sends its AX text", async () => {
  const { scope, raw } = computerObserveFrame();
  const sink = vi.fn<DesktopToolResultDelivery>(async () => true);
  const write = vi.fn(async () => {});
  const result = await executeDesktopTool({
    checkPublication: vi.fn(),
    leases: { claimToolRequest: async () => true, verifyRunBinding: async () => {} },
    knowledgeSearch: null, audit: { write }, webSearchSettings: { search: vi.fn() },
    computerExecute: async () => ({ kind: "observe" as const, result: privateObservation }),
  }, scope, desktopToolRequestSchema.parse(raw), new AbortController().signal, sink);
  expect(result).toMatchObject({ ok: true, data: { kind: "failure", error: "COMPUTER_UNAVAILABLE" } });
  expect(sink).not.toHaveBeenCalled();
  expect(JSON.stringify(result)).not.toContain("PRIVATE_AX_TEXT");
  expect(JSON.stringify(write.mock.lastCall)).not.toContain("PRIVATE_AX_TEXT");
  // The single attempt row is still written, and it never claims a delivery.
  expect(write).toHaveBeenCalledWith(expect.objectContaining({
    result: "success",
    metadata: expect.objectContaining({ computer_request: "observe", delivery: "unconfirmed" }),
  }));
});

it("refuses an observe success whose continuation belongs to the wait kind and never sends", async () => {
  const { scope, raw } = computerObserveFrame();
  const publication: DesktopComputerReadPublication = { kind: "wait", publish: async () => true };
  const sink = vi.fn<DesktopToolResultDelivery>(async () => true);
  const result = await executeDesktopTool({
    checkPublication: vi.fn(),
    leases: { claimToolRequest: async () => true, verifyRunBinding: async () => {} },
    knowledgeSearch: null, audit: { write: async () => {} }, webSearchSettings: { search: vi.fn() },
    computerExecute: async (_input, publishRead) => {
      publishRead?.(publication);
      return { kind: "observe" as const, result: privateObservation };
    },
  }, scope, desktopToolRequestSchema.parse(raw), new AbortController().signal, sink);
  expect(result).toMatchObject({ ok: true, data: { kind: "failure", error: "COMPUTER_UNAVAILABLE" } });
  expect(sink).not.toHaveBeenCalled();
  expect(JSON.stringify(result)).not.toContain("PRIVATE_AX_TEXT");
});

it("refuses an observe request whose returned read kind is wait, even on the trusted fixture seam", async () => {
  const { scope, raw } = computerObserveFrame();
  const sink = vi.fn<DesktopToolResultDelivery>(async () => true);
  const result = await executeDesktopTool({
    checkPublication: vi.fn(),
    leases: { claimToolRequest: async () => true, verifyRunBinding: async () => {} },
    knowledgeSearch: null, audit: { write: async () => {} }, webSearchSettings: { search: vi.fn() },
    allowUnprotectedComputerRead: true,
    computerExecute: async () => ({ kind: "wait" as const, result: { result: "met" as const, waited_ms: 1 } }),
  }, scope, desktopToolRequestSchema.parse(raw), new AbortController().signal, sink);
  expect(result).toMatchObject({ ok: true, data: { kind: "failure", error: "COMPUTER_UNAVAILABLE" } });
  expect(sink).not.toHaveBeenCalled();
});

it("relays one exact-kind observe success through the proof sink exactly once", async () => {
  const { scope, raw } = computerObserveFrame();
  const finalizeCalls = vi.fn(() => true);
  const publication: DesktopComputerReadPublication = {
    kind: "observe", publish: async finalize => finalize(),
  };
  const sink = vi.fn<DesktopToolResultDelivery>(async candidate => candidate.publish(finalizeCalls));
  const result = await executeDesktopTool({
    checkPublication: vi.fn(),
    leases: { claimToolRequest: async () => true, verifyRunBinding: async () => {} },
    knowledgeSearch: null, audit: { write: async () => {} }, webSearchSettings: { search: vi.fn() },
    computerExecute: async (_input, publishRead) => {
      publishRead?.(publication);
      return { kind: "observe" as const, result: privateObservation };
    },
  }, scope, desktopToolRequestSchema.parse(raw), new AbortController().signal, sink);
  expect(result).toMatchObject({ ok: true, data: { kind: "observe", result: privateObservation } });
  expect(sink).toHaveBeenCalledOnce();
  expect(finalizeCalls).toHaveBeenCalledOnce();
});

it.each([
  { loss: "invalidate the run", expected: "COMPUTER_ACCESS_DENIED" },
  { loss: "abort the request", expected: "COMPUTER_TIMEOUT" },
])("refuses a fixture observe with a typed $expected failure and sends no AX text when the audit will $loss", async ({ loss, expected }) => {
  const { scope, raw } = computerObserveFrame();
  const controller = new AbortController();
  let active = true;
  const write = vi.fn(async () => {
    if (loss === "abort the request") controller.abort();
    else active = false;
  });
  const sink = vi.fn<DesktopToolResultDelivery>(async () => true);
  const result = await executeDesktopTool({
    checkPublication: vi.fn(),
    leases: {
      claimToolRequest: async () => true,
      verifyRunBinding: async () => { if (!active) throw new AppError("AUTH_REQUIRED"); },
    },
    knowledgeSearch: null, audit: { write }, webSearchSettings: { search: vi.fn() },
    allowUnprotectedComputerRead: true,
    computerExecute: async () => ({ kind: "observe" as const, result: privateObservation }),
  }, scope, desktopToolRequestSchema.parse(raw), controller.signal, sink);
  expect(result).toMatchObject({ ok: true, data: { kind: "failure", error: expected } });
  expect(JSON.stringify(result)).not.toContain("PRIVATE_AX_TEXT");
  expect(write).toHaveBeenCalledOnce();
  expect(sink).not.toHaveBeenCalled();
});

it("allows the explicit fixture seam to relay a legacy observe success without proof", async () => {
  const { scope, raw } = computerObserveFrame();
  const write = vi.fn(async () => {});
  const sink = vi.fn<DesktopToolResultDelivery>(async () => true);
  const result = await executeDesktopTool({
    checkPublication: vi.fn(),
    leases: { claimToolRequest: async () => true, verifyRunBinding: async () => {} },
    knowledgeSearch: null, audit: { write }, webSearchSettings: { search: vi.fn() },
    allowUnprotectedComputerRead: true,
    computerExecute: async () => ({ kind: "observe" as const, result: privateObservation }),
  }, scope, desktopToolRequestSchema.parse(raw), new AbortController().signal, sink);
  expect(result).toMatchObject({ ok: true, data: { kind: "observe", result: privateObservation } });
  expect(sink).not.toHaveBeenCalled();
  expect(write).toHaveBeenCalledWith(expect.objectContaining({
    metadata: expect.objectContaining({ computer_request: "observe", delivery: "unconfirmed" }),
  }));
});

it("normalizes a status true without exact proof or negotiation and still checks the run after audit", async () => {
  const { scope, raw } = computerStatusFrame();
  const sink = vi.fn<DesktopToolResultDelivery>(async () => true);
  const result = await executeDesktopTool({
    checkPublication: vi.fn(),
    leases: { claimToolRequest: async () => true, verifyRunBinding: async () => {} },
    knowledgeSearch: null, audit: { write: async () => {} }, webSearchSettings: { search: vi.fn() },
    computerStatus: true,
    computerExecute: async () => ({ kind: "status" as const, result: privateStatus }),
  }, scope, desktopToolRequestSchema.parse(raw), new AbortController().signal, sink);
  expect(result).toMatchObject({
    ok: true, data: { kind: "status", result: { available: true, active_grant: false } },
  });
  expect(JSON.stringify(result)).not.toContain('"active_grant":true');
  expect(sink).not.toHaveBeenCalled();
});

it("does not publish status true through a mismatched proof kind", async () => {
  const { scope, raw } = computerStatusFrame();
  const sink = vi.fn<DesktopToolResultDelivery>(async () => true);
  const publication: DesktopComputerReadPublication = { kind: "observe", publish: async () => true };
  const result = await executeDesktopTool({
    checkPublication: vi.fn(),
    leases: { claimToolRequest: async () => true, verifyRunBinding: async () => {} },
    knowledgeSearch: null, audit: { write: async () => {} }, webSearchSettings: { search: vi.fn() },
    computerStatus: true,
    computerExecute: async (_input, publishRead) => {
      publishRead?.(publication);
      return { kind: "status" as const, result: privateStatus };
    },
  }, scope, desktopToolRequestSchema.parse(raw), new AbortController().signal, sink);
  expect(result).toMatchObject({ ok: true, data: { kind: "status", result: { active_grant: false } } });
  expect(sink).not.toHaveBeenCalled();
});

it("fails a status diagnostic closed when the run is lost after the audit", async () => {
  const { scope, raw } = computerStatusFrame();
  let active = true;
  const result = await executeDesktopTool({
    checkPublication: vi.fn(),
    leases: {
      claimToolRequest: async () => true,
      verifyRunBinding: async () => {
        if (!active) throw new AppError("AUTH_REQUIRED");
      },
    },
    knowledgeSearch: null,
    audit: { write: async () => { active = false; } },
    webSearchSettings: { search: vi.fn() },
    computerStatus: true,
    computerExecute: async () => ({ kind: "status" as const, result: privateStatus }),
  }, scope, desktopToolRequestSchema.parse(raw), new AbortController().signal);
  expect(result).toMatchObject({
    ok: true, data: { kind: "failure", error: "COMPUTER_ACCESS_DENIED" },
  });
  expect(JSON.stringify(result)).not.toContain('"active_grant":true');
});

it.each([
  { name: "status returning an observation", request: computerStatusFrame, result: {
    kind: "observe" as const, result: privateObservation,
  }, expected: { ok: true, data: { kind: "failure", error: "COMPUTER_UNAVAILABLE" } } },
  { name: "act returning a status", request: computerActFrame, result: {
    kind: "status" as const, result: privateStatus,
  }, expected: { ok: false, error_code: "RUNNER_OPERATION_UNCERTAIN" } },
])("rejects a $name instead of relaying it through the generic send", async ({ request, result: data, expected }) => {
  const { scope, raw } = request();
  const sink = vi.fn<DesktopToolResultDelivery>(async () => true);
  const returned = await executeDesktopTool({
    checkPublication: vi.fn(),
    leases: { claimToolRequest: async () => true, verifyRunBinding: async () => {} },
    knowledgeSearch: null, audit: { write: async () => {} }, webSearchSettings: { search: vi.fn() },
    computerStatus: true,
    computerExecute: async () => data,
  }, scope, desktopToolRequestSchema.parse(raw), new AbortController().signal, sink);
  expect(returned).toMatchObject(expected);
  expect(JSON.stringify(returned)).not.toContain("PRIVATE_AX_TEXT");
  expect(JSON.stringify(returned)).not.toContain('"active_grant":true');
  expect(sink).not.toHaveBeenCalled();
});

it("never returns a status success when the mandatory audit write fails", async () => {
  const { scope, raw } = computerStatusFrame();
  const sink = vi.fn<DesktopToolResultDelivery>(async () => true);
  const publication: DesktopComputerReadPublication = { kind: "status", publish: async () => true };
  const result = await executeDesktopTool({
    checkPublication: vi.fn(),
    leases: { claimToolRequest: async () => true, verifyRunBinding: async () => {} },
    knowledgeSearch: null,
    audit: { write: async () => { throw new Error("audit unavailable"); } },
    webSearchSettings: { search: vi.fn() },
    computerStatus: true,
    computerExecute: async (_input, publishRead) => {
      publishRead?.(publication);
      return { kind: "status" as const, result: privateStatus };
    },
  }, scope, desktopToolRequestSchema.parse(raw), new AbortController().signal, sink);
  expect(result).toMatchObject({ ok: true, data: { kind: "failure", error: "COMPUTER_UNAVAILABLE" } });
  expect(sink).not.toHaveBeenCalled();
  expect(JSON.stringify(result)).not.toContain('"active_grant":true');
});

it("publishes status true only through the exact negotiated proof and one post-audit send", async () => {
  const { scope, raw } = computerStatusFrame();
  const finalize = vi.fn(() => true);
  const publication: DesktopComputerReadPublication = { kind: "status", publish: async callback => callback() };
  const sink = vi.fn<DesktopToolResultDelivery>(async candidate => candidate.publish(finalize));
  const result = await executeDesktopTool({
    checkPublication: vi.fn(),
    leases: { claimToolRequest: async () => true, verifyRunBinding: async () => {} },
    knowledgeSearch: null, audit: { write: async () => {} }, webSearchSettings: { search: vi.fn() },
    computerStatus: true,
    computerExecute: async (_input, publishRead) => {
      publishRead?.(publication);
      return { kind: "status" as const, result: privateStatus };
    },
  }, scope, desktopToolRequestSchema.parse(raw), new AbortController().signal, sink);
  expect(result).toMatchObject({ ok: true, data: { kind: "status", result: { active_grant: true } } });
  expect(sink).toHaveBeenCalledOnce();
  expect(finalize).toHaveBeenCalledOnce();
});
