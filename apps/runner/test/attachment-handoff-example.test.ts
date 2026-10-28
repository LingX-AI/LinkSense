import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { transferAttachments, type HandoffConfiguration } from "../examples/attachment-handoff/transfer.js";

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), "attachment-handoff-"));
  directories.push(root);
  const bytes = Buffer.from("selected evidence\n");
  await writeFile(path.join(root, "evidence.pdf"), bytes);
  const configuration: HandoffConfiguration = {
    attachmentRoot: root, conversationId: randomUUID(),
    authorizationUrl: "https://destination.example.test/handoffs/resolve",
    uploadUrl: "https://destination.example.test/handoffs/upload",
    bearerToken: "test-only-destination-token",
  };
  const grant = {
    id: randomUUID(), conversation_id: configuration.conversationId,
    status: "confirmed", expires_at: "2999-01-01T00:00:00Z",
    files: [{ relative_path: "evidence.pdf", filename: "evidence.pdf", media_type: "application/pdf", size: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") }],
  };
  const fetcher = vi.fn<typeof fetch>(async (_url, options) => {
    if (options?.body instanceof FormData) return Response.json({ record_id: "case-1", accepted_sha256: grant.files.map((file) => file.sha256) });
    return Response.json(grant);
  });
  return { root, bytes, configuration, grant, fetcher, signal: new AbortController().signal };
}

describe("business-owned attachment handoff example", () => {
  it("starts as an actual STDIO MCP server and exposes only a handoff ID as tool input", async () => {
    const f = await fixture();
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: ["--import", "tsx", "examples/attachment-handoff/server.ts"],
      env: {
        HANDOFF_ATTACHMENT_ROOT: f.root,
        LINKSENSE_CONVERSATION_ID: f.configuration.conversationId,
        HANDOFF_AUTHORIZATION_URL: f.configuration.authorizationUrl,
        HANDOFF_UPLOAD_URL: f.configuration.uploadUrl,
        HANDOFF_BEARER_TOKEN: f.configuration.bearerToken,
      },
    });
    const client = new Client({ name: "attachment-handoff-test", version: "1.0.0" });
    try {
      await client.connect(transport);
      const { tools } = await client.listTools();
      expect(tools.map((tool) => tool.name)).toEqual(["handoff_selected_attachments"]);
      expect(tools[0]?.inputSchema.required).toEqual(["handoff_id"]);
      expect(Object.keys(tools[0]?.inputSchema.properties ?? {})).toEqual(["handoff_id"]);
    } finally {
      await client.close();
    }
  });

  it("transfers exact selected bytes, metadata and a stable idempotency key without exposing credentials to the model", async () => {
    const f = await fixture();
    for (let attempt = 0; attempt < 2; attempt++) {
      await expect(transferAttachments(f.configuration, f.grant.id, f.signal, f.fetcher)).resolves.toMatchObject({ status: "completed", record_id: "case-1" });
    }
    const uploads = f.fetcher.mock.calls.filter(([, options]) => options?.body instanceof FormData);
    expect(uploads).toHaveLength(2);
    for (const [, options] of uploads) {
      expect(options?.headers).toMatchObject({ "idempotency-key": f.grant.id });
      expect(options?.redirect).toBe("error");
      if (!(options?.body instanceof FormData)) throw new Error("missing multipart body");
      const file = options.body.get("files");
      if (!(file instanceof File)) throw new Error("missing uploaded file");
      expect(file.name).toBe("evidence.pdf");
      expect(file.type).toBe("application/pdf");
      expect(Buffer.from(await file.arrayBuffer())).toEqual(f.bytes);
      expect([...options.body.keys()]).toEqual(["handoff_id", "files"]);
    }
  });

  it.each(["foreign", "expired", "cancelled", "changed", "deleted", "oversized", "total_size", "traversal", "symlink", "unsupported", "duplicate"] as const)("never uploads %s files", async (failure) => {
    const f = await fixture();
    const file = f.grant.files[0]!;
    if (failure === "foreign") f.grant.conversation_id = randomUUID();
    if (failure === "expired") f.grant.expires_at = "2000-01-01T00:00:00Z";
    if (failure === "cancelled") f.grant.status = "cancelled";
    if (failure === "changed") await writeFile(path.join(f.root, "evidence.pdf"), "different evidence");
    if (failure === "deleted") await rm(path.join(f.root, "evidence.pdf"));
    if (failure === "oversized") file.size = 8 * 1024 * 1024 + 1;
    if (failure === "total_size") f.grant.files = [1, 2, 3].map((index) => ({ ...file, relative_path: `${index}.pdf`, size: 8 * 1024 * 1024 }));
    if (failure === "traversal") file.relative_path = "../evidence.pdf";
    if (failure === "unsupported") file.media_type = "application/x-executable";
    if (failure === "duplicate") f.grant.files.push({ ...file });
    if (failure === "symlink") {
      const outside = await mkdtemp(path.join(tmpdir(), "outside-evidence-"));
      directories.push(outside);
      await writeFile(path.join(outside, "other.pdf"), f.bytes);
      await symlink(path.join(outside, "other.pdf"), path.join(f.root, "link.pdf"));
      file.relative_path = "link.pdf";
    }
    const result = transferAttachments(f.configuration, f.grant.id, f.signal, f.fetcher);
    if (failure === "cancelled") await expect(result).resolves.toEqual({ status: "cancelled" });
    else await expect(result).rejects.toThrow();
    expect(f.fetcher.mock.calls.some(([, options]) => options?.body instanceof FormData)).toBe(false);
  });

  it("reports partial uploads instead of claiming the evidence was attached", async () => {
    const f = await fixture();
    f.fetcher.mockResolvedValueOnce(Response.json(f.grant)).mockResolvedValueOnce(Response.json({ record_id: "case-1", accepted_sha256: [] }));
    await expect(transferAttachments(f.configuration, f.grant.id, f.signal, f.fetcher)).rejects.toThrow("HANDOFF_PARTIAL_UPLOAD");
  });

  it("honors cancellation and fails closed when destination authorization fails", async () => {
    const f = await fixture();
    f.fetcher.mockResolvedValueOnce(new Response(null, { status: 403 }));
    await expect(transferAttachments(f.configuration, f.grant.id, f.signal, f.fetcher)).rejects.toThrow("HANDOFF_NOT_AUTHORIZED");
    expect(f.fetcher).toHaveBeenCalledTimes(1);
    f.fetcher.mockClear();
    const controller = new AbortController();
    controller.abort();
    await expect(transferAttachments(f.configuration, f.grant.id, controller.signal, f.fetcher)).rejects.toThrow();
    expect(f.fetcher.mock.calls.some(([, options]) => options?.body instanceof FormData)).toBe(false);
  });
});
