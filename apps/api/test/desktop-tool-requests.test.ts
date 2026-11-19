import { createHash, randomUUID } from "node:crypto";
import { expect, it, vi } from "vitest";
import { desktopConnectionTextPageBytes, desktopToolRequestSchema, type DesktopToolRequest } from "@linksense/shared";
import { AppError } from "../src/lib/errors.js";
import { executeDesktopTool } from "../src/modules/desktop-devices/tool-requests.js";

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
