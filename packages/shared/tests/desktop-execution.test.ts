import { describe, expect, it } from "vitest";
import {
  desktopExecutionCommandSchema, desktopExecutionResultSchema,
  desktopRuntimeOutputSchema, desktopToolCancelSchema, desktopToolRequestSchema, desktopToolResultSchema,
} from "../src/desktop-execution.js";
import { desktopArtifactMaxParts, desktopArtifactReceiptSchema, desktopArtifactUploadGrantSchema, webBundleArchiveMaxBytes } from "../src/desktop-artifacts.js";

const id = "10000000-0000-4000-8000-000000000001";
const turnId = "10000000-0000-4000-8000-000000000002";
const expiresAt = "2026-11-18T10:00:00.000Z";
const start = {
  type: "command",
  operation: "turn.start",
  id,
  owner_id: id,
  conversation_id: id,
  runtime_generation: id,
  turn_id: turnId,
  expires_at: expiresAt,
  body: {
    native_thread_id: null,
    input: "Summarize the sample.",
    reasoning_effort: "low",
    credentials: {
      turn_id: turnId,
      expires_at: expiresAt,
      run_token: `lsdr_${"a".repeat(43)}`,
      primary: { purpose: "primary", model: "sample", revision: 1, protocol_mode: "native_responses", token: `lsdm_${"b".repeat(43)}` },
    },
  },
};

describe("desktop execution wire contract", () => {
  it("uses a scoped start body and rejects internal credentials, paths and cross-turn grants", () => {
    expect(desktopExecutionCommandSchema.parse(start)).toEqual(start);
    for (const bad of [
      { ...start, path: "/internal/runner/events" },
      { ...start, headers: {} },
      { ...start, operation: "run.command" },
      { ...start, body: { ...start.body, environment: {} } },
      { ...start, body: { ...start.body, credentials: { ...start.body.credentials, turn_id: id } } },
      { ...start, body: { ...start.body, credentials: { ...start.body.credentials, primary: { ...start.body.credentials.primary, apiKey: "test-only" } } } },
    ]) expect(desktopExecutionCommandSchema.safeParse(bad).success).toBe(false);
  });

  it("accepts an attachment-only start with signed metadata, never paths or bytes", () => {
    const attachment = {
      id, filename: "Résumé 进度.txt", size_bytes: 24, sha256: "a".repeat(64),
      download_grant: `1794996000000.${start.id}.${"b".repeat(64)}`,
    };
    const frame = (attachments: unknown[]) => ({ ...start, body: { ...start.body, input: "", attachments } });
    expect(desktopExecutionCommandSchema.parse(frame([attachment]))).toEqual(frame([attachment]));
    for (const attachments of [
      [], [attachment, attachment], [{ ...attachment, filename: "../private.txt" }],
      [{ ...attachment, filename: "folder\\private.txt" }], [{ ...attachment, size_bytes: -1 }],
      [{ ...attachment, url: "https://untrusted.example.test/file" }],
      [{ ...attachment, data: "dGVzdA==" }], [{ ...attachment, download_grant: "unsigned" }],
    ]) expect(desktopExecutionCommandSchema.safeParse(frame(attachments)).success).toBe(false);
  });

  it("distinguishes a missing operation, a confirmed start, and an unknown result without accepting raw errors", () => {
    const inspection = { type: "command.result", id, operation: "turn.inspect", ok: true, result: null };
    expect(desktopExecutionResultSchema.parse(inspection)).toEqual(inspection);
    expect(desktopExecutionResultSchema.safeParse({ ...inspection, operation: "turn.start" }).success).toBe(false);
    const unknown = { type: "command.result", id, operation: "turn.start", ok: false, error_code: "RUNNER_OPERATION_UNCERTAIN" };
    expect(desktopExecutionResultSchema.parse(unknown)).toEqual(unknown);
    expect(desktopExecutionResultSchema.safeParse({ ...unknown, message: "test-only diagnostics" }).success).toBe(false);
  });

  it("accepts only the typed search request and a scoped cancellation", () => {
    const request = {
      type: "tool.request", id, operation: "web.search",
      conversation_id: id, runtime_generation: id, turn_id: turnId,
      expires_at: expiresAt,
      run_token: start.body.credentials.run_token,
      body: { query: "Sample question", max_results: 2 },
    };
    expect(desktopToolRequestSchema.parse(request)).toEqual(request);
    for (const invalid of [
      { ...request, operation: "internal.request" },
      { ...request, endpoint: "/internal/web-search/search" },
      { ...request, owner_id: id },
      { ...request, expires_at: undefined },
      { ...request, run_token: start.body.credentials.primary.token },
      { ...request, body: { ...request.body, provider: "brave" } },
    ]) expect(desktopToolRequestSchema.safeParse(invalid).success).toBe(false);
    const cancel = { type: "tool.cancel", id, operation: "web.search", conversation_id: id, runtime_generation: id, turn_id: turnId };
    expect(desktopRuntimeOutputSchema.parse({ type: "link.frame", link_id: id, frame: cancel }).frame).toEqual(cancel);
    expect(desktopToolCancelSchema.safeParse({ ...cancel, turn_id: null }).success).toBe(false);
  });

  it("rejects provider internals and untyped result data", () => {
    const data = { success: true, provider: "brave", query: "Sample question", results: [] };
    const response = { type: "tool.result", operation: "web.search", id, ok: true, data };
    expect(desktopToolResultSchema.parse(response)).toEqual(response);
    expect(desktopToolResultSchema.safeParse({ ...response, data: { ...data, headers: {} } }).success).toBe(false);
    expect(desktopToolResultSchema.safeParse({ ...response, ok: false, error_code: "UNKNOWN_PROVIDER_FAILURE", data: undefined }).success).toBe(false);
  });

  it("negotiates only file metadata and a scoped upload grant, without paths or file bytes", () => {
    const request = {
      type: "tool.request", id, operation: "artifact.prepare", conversation_id: id, runtime_generation: id,
      turn_id: turnId, expires_at: expiresAt, run_token: start.body.credentials.run_token,
      body: { filename: "notes.md", display_name: "Notes.md", size_bytes: 12, sha256: "a".repeat(64) },
    };
    expect(desktopToolRequestSchema.parse(request)).toEqual(request);
    for (const body of [
      { ...request.body, filename: "../notes.md" }, { ...request.body, display_name: "reports\\notes.md" },
      { ...request.body, data: "sample" }, { ...request.body, size_bytes: 0 },
      { ...request.body, workspace_relative_path: "notes.md" },
    ]) expect(desktopToolRequestSchema.safeParse({ ...request, body }).success).toBe(false);
    const grant = {
      artifact_id: id, expires_at: expiresAt,
      destination: { kind: "presigned_post", url: "https://storage.example.test/bucket", fields: { key: "fixture" } },
    };
    expect(desktopToolResultSchema.parse({
      type: "tool.result", id, operation: "artifact.prepare", ok: true, data: grant,
    })).toMatchObject({ data: grant });
    for (const destination of [
      { kind: "presigned_post", url: "https://storage.example.test/bucket#redirect", fields: { key: "fixture" } },
      { kind: "presigned_post", url: "https://storage.example.test/bucket", fields: { "bad\r\nname": "fixture" } },
      { kind: "api", url: "https://storage.example.test/bucket" },
    ]) expect(desktopArtifactUploadGrantSchema.safeParse({ ...grant, destination }).success).toBe(false);
    expect(desktopArtifactReceiptSchema.safeParse({
      success: true, artifact_id: id, file_id: id, display_name: "Notes.md", download_card_event_id: id,
      workspace_path: "/fixture/notes.md",
    }).success).toBe(false);
  });

  it("offers bounded presigned parts only for the new artifact operation", () => {
    const part = { url: "https://objects.example.test/bucket", fields: { key: "stage/1" } };
    const result = {
      type: "tool.result", operation: "artifact.multipart", id, ok: true,
      data: { artifact_id: id, expires_at: expiresAt, destination: { kind: "presigned_parts", parts: [part] } },
    };
    expect(desktopToolResultSchema.parse(result)).toEqual(result);
    expect(desktopToolResultSchema.safeParse({ ...result, operation: "artifact.prepare" }).success).toBe(false);
    for (const parts of [[], Array.from({ length: desktopArtifactMaxParts + 1 }, () => part),
      [{ ...part, url: "https://user:password@objects.example.test/bucket" }]]) {
      expect(desktopArtifactUploadGrantSchema.safeParse({
        ...result.data, destination: { kind: "presigned_parts", parts },
      }).success).toBe(false);
    }
  });

  it("accepts an archive-relative HTML entry only for negotiated website artifacts", () => {
    const frame = {
      type: "tool.request", id, operation: "artifact.website", conversation_id: id, turn_id: turnId,
      runtime_generation: id, run_token: `lsdr_${"a".repeat(43)}`, expires_at: expiresAt,
      body: { filename: "index.html", display_name: "Site", entry_path: "pages/index.html", size_bytes: 256, sha256: "b".repeat(64) },
    };
    expect(desktopToolRequestSchema.parse(frame)).toEqual(frame);
    expect(desktopToolRequestSchema.safeParse({ ...frame, operation: "artifact.prepare" }).success).toBe(false);
    for (const invalid of [{ entry_path: "theme.css" }, { entry_path: "/index.html" }, { size_bytes: webBundleArchiveMaxBytes + 1 }]) {
      expect(desktopToolRequestSchema.safeParse({ ...frame, body: { ...frame.body, ...invalid } }).success).toBe(false);
    }
  });
});
