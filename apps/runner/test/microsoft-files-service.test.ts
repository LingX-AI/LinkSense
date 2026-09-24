import { describe, it, expect, vi } from "vitest";
import { createMicrosoftFilesModule } from "../src/mcp/connection-services/microsoft-files.js";
import { connectionErrorFromApi } from "../src/connection-error.js";
import { mkdtemp, rm, writeFile, symlink, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
const environment = {
  LINKSENSE_CONNECTION_ENDPOINT: "http://127.0.0.1:4000/execute",
  LINKSENSE_CONNECTION_TOKEN: "test-only-connection-token-00000000",
};
const item = {
  id: "file",
  name: "note.txt",
  web_url: "https://example.sharepoint.com/note.txt",
  kind: "file",
  drive_id: "drive",
  mime_type: "text/plain",
  size_bytes: 6000,
  etag: '"file-v1"',
};
const request = {
  operation: "read_file",
  provider: "onedrive",
  drive_id: "drive",
  item_id: "file",
  max_bytes: 1024,
};
function resultValue(
  result: Awaited<ReturnType<ReturnType<typeof createMicrosoftFilesModule>["callTool"]>>,
) {
  const content = result.content?.[0];
  if (!content || content.type !== "text") throw new Error("expected text");
  return JSON.parse(content.text);
}
describe("Microsoft file MCP tool", () => {
  it("never marks an uncertain write as safe to retry, including unstructured gateway failures", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(Response.json({ error: "gateway failed" }, { status: 503 }));
    const module = createMicrosoftFilesModule({ environment, workspaceRoot: "/tmp", fetch });
    const result = await module.callTool({ toolName: "write_files", argumentsValue: { operation: "create_folder", provider: "onedrive", drive_id: "drive", name: "Reports" }, signal: new AbortController().signal });
    expect(resultValue(result)).toEqual({ code: "CONNECTION_UNAVAILABLE", retryable: false });
    expect(fetch).toHaveBeenCalledOnce();
  });
  it("allows only read operations in Plan, even when a caller directly invokes the write tool", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>();
    const module = createMicrosoftFilesModule({ environment: { ...environment, LINKSENSE_COLLABORATION_MODE: "plan" }, workspaceRoot: "/tmp", fetch });
    expect(module.tools.map((tool) => tool.name)).toEqual(["read_files"]);
    for (const call of [
      { toolName: "write_files", argumentsValue: { operation: "create_folder", provider: "onedrive", drive_id: "drive", name: "Reports" } },
      { toolName: "read_files", argumentsValue: { ...request, download: true } },
    ]) {
      expect(resultValue(await module.callTool({ ...call, signal: new AbortController().signal }))).toMatchObject({ code: "CONNECTION_ACCESS_DENIED" });
    }
    expect(fetch).not.toHaveBeenCalled();
  });

  it("uploads local binary files, downloads originals and refuses paths or symlinks outside the task", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "linksense-connection-test-"));
    try {
      const bytes = Buffer.from([1, 2, 3, 4, 0]);
      await writeFile(path.join(root, "report.docx"), bytes);
      await symlink(path.join(root, "report.docx"), path.join(root, "linked.docx"));
      const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(Response.json({ kind: "item", item }));
      const module = createMicrosoftFilesModule({ environment, workspaceRoot: root, fetch });
      const argumentsValue = { operation: "create_file", provider: "onedrive", drive_id: "drive", name: "report.docx", workspace_relative_path: "report.docx" };
      const call = (args: unknown) => module.callTool({ toolName: "write_files", argumentsValue: args, signal: new AbortController().signal });
      expect((await call(argumentsValue)).isError).toBe(false);
      expect(JSON.parse(String(fetch.mock.calls[0]?.[1]?.body))).toMatchObject({ content_base64: bytes.toString("base64") });
      for (const workspace_relative_path of ["../outside.docx", "/etc/passwd", "linked.docx"]) {
        expect((await call({ ...argumentsValue, workspace_relative_path })).isError).toBe(true);
      }
      expect(fetch).toHaveBeenCalledOnce();
      fetch.mockResolvedValue(Response.json({ kind: "file", item, content_base64: bytes.toString("base64") }));
      const download = resultValue(await module.callTool({ toolName: "read_files", argumentsValue: { ...request, download: true }, signal: new AbortController().signal }));
      expect(download.kind).toBe("download");
      expect(await readFile(path.join(root, download.workspace_relative_path))).toEqual(bytes);
      expect(download).not.toHaveProperty("content_base64");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
  it("converts paginated document content, pins later pages and never exposes base64 or service tokens", async () => {
    const text = "Hello, 世界。\n".repeat(500);
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockImplementation(async () =>
        Response.json({ kind: "file", item, content_base64: Buffer.from(text).toString("base64") }),
      );
    const module = createMicrosoftFilesModule({
      environment,
      workspaceRoot: "/tmp",
      fetch,
    });
    const call = (argumentsValue: unknown) =>
      module.callTool({
        toolName: "read_files",
        argumentsValue,
        signal: new AbortController().signal,
      });
    const first = resultValue(await call(request));
    expect(first).toMatchObject({
      kind: "document",
      complete: false,
      item: { web_url: item.web_url },
    });
    expect(first.markdown).toContain("世界");
    expect(first).not.toHaveProperty("content_base64");
    const next = resultValue(
      await call({
        ...request,
        byte_offset: first.next_byte_offset,
        expected_markdown_sha256: first.markdown_sha256,
      }),
    );
    expect(next.byte_start).toBe(first.byte_end);
    expect(resultValue(await call({ ...request, byte_offset: 1024 }))).toMatchObject({
      code: "DOCUMENT_CONVERSION_INVALID",
    });
    expect(
      resultValue(await call({ ...request, expected_markdown_sha256: "a".repeat(64) })),
    ).toMatchObject({ code: "DOCUMENT_CHANGED" });
    expect(JSON.parse(String(fetch.mock.calls[0]?.[1]?.body))).toEqual({
      operation: "read_file",
      provider: "onedrive",
      drive_id: "drive",
      item_id: "file",
    });
  });
  it("refuses unknown operations and returns safe actionable authorization errors", async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(
        Response.json({ code: "CONNECTION_REQUIRED", retryable: false }, { status: 409 }),
      );
    const module = createMicrosoftFilesModule({
      environment,
      workspaceRoot: "/tmp",
      fetch,
    });
    const call = (argumentsValue: unknown) =>
      module.callTool({
        toolName: "read_files",
        argumentsValue,
        signal: new AbortController().signal,
      });
    expect((await call({ operation: "delete_file" })).isError).toBe(true);
    expect(fetch).not.toHaveBeenCalled();
    expect(resultValue(await call({ operation: "list_connections" }))).toEqual({
      code: "CONNECTION_REQUIRED",
      retryable: false,
    });
    expect(
      connectionErrorFromApi(403, { error_code: "FORBIDDEN", message: "secret" }),
    ).toMatchObject({ code: "CONNECTION_ACCESS_DENIED", retryable: false });
  });
});
