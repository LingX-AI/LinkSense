import { randomUUID } from "node:crypto";
import { expect, it, vi } from "vitest";
import type { DesktopToolRequest } from "@linksense/shared";
import { AppError } from "../src/lib/errors.js";
import { executeDesktopTool } from "../src/modules/desktop-devices/tool-requests.js";

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
