import { afterEach, describe, expect, it, vi } from "vitest";
import { MICROSOFT_FILE_MAX_BYTES } from "@linksense/shared";
import { MicrosoftFilesGraph } from "../src/modules/connections/graph.js";

afterEach(() => vi.unstubAllGlobals());
const target = { provider: "onedrive", drive_id: "drive", item_id: "file", expected_etag: '"version-1"' } as const;
const item = { id: "file", name: "report.docx", file: { mimeType: "application/octet-stream" }, eTag: '"version-2"' };
function responses(values: Array<Response>) {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  vi.stubGlobal("fetch", vi.fn<typeof fetch>(async (input, init) => {
    calls.push({ url: input instanceof Request ? input.url : input.toString(), ...(init ? { init } : {}) });
    const response = values.shift();
    if (!response) throw new Error("unexpected request");
    return response;
  }));
  return calls;
}

describe("Microsoft SDK file writes", () => {
  it.each(["onedrive", "sharepoint"] as const)("uploads original bytes to %s through the Graph content endpoint with atomic conflict protection", async (provider) => {
    const calls = responses([Response.json(item, { status: 201 })]);
    const bytes = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00, 0xff, 0x80, 0x42]);
    const value = await new MicrosoftFilesGraph().execute("graph-token", {
      operation: "create_file", provider, drive_id: "drive", folder_id: "folder", name: "R&D #季度.docx",
      content_base64: bytes.toString("base64"),
    });
    expect(calls).toHaveLength(1);
    const url = new URL(calls[0]!.url);
    expect(url.origin).toBe("https://graph.microsoft.com");
    expect(url.pathname).toBe("/v1.0/drives/drive/items/folder:/R%26D%20%23%E5%AD%A3%E5%BA%A6.docx:/content");
    expect([...url.searchParams.entries()]).toEqual([["@microsoft.graph.conflictBehavior", "fail"]]);
    expect(calls[0]!.init?.method).toBe("PUT");
    expect(calls[0]!.init?.body).toEqual(bytes);
    expect(new Headers(calls[0]!.init?.headers).get("authorization")).toBe("Bearer graph-token");
    expect(new Headers(calls[0]!.init?.headers).get("content-type")).toBe("application/octet-stream");
    expect(calls[0]!.init?.signal).toBeInstanceOf(AbortSignal);
    expect(value.result).toMatchObject({ kind: "item", item: { etag: '"version-2"' } });
  });

  it("uploads to the drive root when no folder was selected", async () => {
    const calls = responses([Response.json(item, { status: 201 })]);
    await new MicrosoftFilesGraph().execute("token", {
      operation: "create_file", provider: "onedrive", drive_id: "drive", name: "report.txt", content_base64: "dGVzdA==",
    });
    expect(new URL(calls[0]!.url).pathname).toBe("/v1.0/drives/drive/root:/report.txt:/content");
    expect(calls).toHaveLength(1);
  });

  it("updates an existing file by ID and checks its version on the actual content write", async () => {
    const calls = responses([Response.json(item), Response.json(item)]);
    await expect(new MicrosoftFilesGraph().execute("token", {
      ...target, operation: "update_file", content_base64: "dGVzdA==",
    })).resolves.toMatchObject({ result: { kind: "item", item: { id: "file" } } });
    expect(calls).toHaveLength(2);
    expect(new URL(calls[1]!.url).pathname).toBe("/v1.0/drives/drive/items/file/content");
    expect(new Headers(calls[1]!.init?.headers).get("if-match")).toBe(target.expected_etag);
    expect(calls[1]!.init?.method).toBe("PUT");
    expect(calls[1]!.init?.body).toEqual(Buffer.from("test"));
  });

  it("refuses to overwrite remote shortcuts", async () => {
    const calls = responses([Response.json({ ...item, remoteItem: { id: "remote" } })]);
    await expect(new MicrosoftFilesGraph().execute("token", {
      ...target, operation: "update_file", content_base64: "dGVzdA==",
    })).rejects.toMatchObject({ code: "CONNECTION_ACCESS_DENIED" });
    expect(calls).toHaveLength(1);
  });

  it.each([409, 412])("surfaces a file conflict (%s) without retrying or exposing upstream details", async (status) => {
    const calls = responses([Response.json({ error: { code: "conflict", message: "private upstream details" } }, { status })]);
    await expect(new MicrosoftFilesGraph().execute("token", {
      operation: "create_file", provider: "onedrive", drive_id: "drive", name: "report.docx", content_base64: "dGVzdA==",
    })).rejects.toMatchObject({ code: "CONNECTION_FILE_CONFLICT", message: "CONNECTION_FILE_CONFLICT" });
    expect(calls).toHaveLength(1);
  });

  it("rejects updates if the file changed after it was read", async () => {
    const calls = responses([
      Response.json(item),
      Response.json({ error: { code: "notAllowed", message: "private upstream details" } }, { status: 412 }),
    ]);
    await expect(new MicrosoftFilesGraph().execute("token", {
      ...target, operation: "update_file", content_base64: "dGVzdA==",
    })).rejects.toMatchObject({ code: "CONNECTION_FILE_CONFLICT" });
    expect(calls).toHaveLength(2);
    expect(new Headers(calls[1]!.init?.headers).get("if-match")).toBe(target.expected_etag);
  });

  it.each(["rename_file", "move_file", "delete_file"] as const)("protects %s with an etag", async (operation) => {
    const calls = responses([operation === "delete_file" ? new Response(null, { status: 204 }) : Response.json(item)]);
    const input = operation === "rename_file" ? { ...target, operation, name: "renamed.docx" }
      : operation === "move_file" ? { ...target, operation, folder_id: "folder" } : { ...target, operation };
    const value = await new MicrosoftFilesGraph().execute("token", input);
    expect(new Headers(calls[0]!.init?.headers).get("if-match")).toBe(target.expected_etag);
    expect(calls[0]!.init?.method).toBe(operation === "delete_file" ? "DELETE" : "PATCH");
    expect(value.result.kind).toBe(operation === "delete_file" ? "deleted" : "item");
  });

  it("creates SharePoint folders with fail-on-conflict semantics", async () => {
    const calls = responses([Response.json({ id: "folder", name: "Planning", folder: {} })]);
    await new MicrosoftFilesGraph().execute("token", {
      operation: "create_folder", provider: "sharepoint", drive_id: "library", name: "Planning",
    });
    expect(new URL(calls[0]!.url).pathname).toBe("/v1.0/drives/library/root/children");
    expect(JSON.parse(String(calls[0]!.init?.body))).toEqual({ name: "Planning", folder: {}, "@microsoft.graph.conflictBehavior": "fail" });
  });

  it.each(["", "not-base64!", "dGVzdA", "dGVzdA==\n"])("rejects invalid or empty file bytes before calling Microsoft (%j)", async (content_base64) => {
    const calls = responses([]);
    await expect(new MicrosoftFilesGraph().execute("token", {
      operation: "create_file", provider: "onedrive", drive_id: "drive", name: "report.txt", content_base64,
    })).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    expect(calls).toHaveLength(0);
  });

  it("rejects files over the transfer limit before calling Microsoft", async () => {
    const calls = responses([]);
    await expect(new MicrosoftFilesGraph().execute("token", {
      operation: "create_file", provider: "onedrive", drive_id: "drive", name: "report.bin",
      content_base64: Buffer.alloc(MICROSOFT_FILE_MAX_BYTES + 1).toString("base64"),
    })).rejects.toMatchObject({ code: "CONNECTION_FILE_TOO_LARGE" });
    expect(calls).toHaveLength(0);
  });

  it.each([301, 302, 303, 307, 308])("never redirects file bytes or authorization to another endpoint (%s)", async (status) => {
    const calls = responses([new Response(null, { status, headers: { location: "https://attacker.test/upload" } })]);
    await expect(new MicrosoftFilesGraph().execute("token", {
      operation: "create_file", provider: "onedrive", drive_id: "drive", name: "report.txt", content_base64: "dGVzdA==",
    })).rejects.toMatchObject({ code: "CONNECTION_UNAVAILABLE" });
    expect(calls).toHaveLength(1);
    expect(new URL(calls[0]!.url).origin).toBe("https://graph.microsoft.com");
    expect(["error", "manual"]).toContain(calls[0]!.init?.redirect);
  });

  it("does not replay an uncertain write after a service failure", async () => {
    const calls = responses([Response.json({ error: { code: "serviceNotAvailable", message: "private details" } }, { status: 503 })]);
    await expect(new MicrosoftFilesGraph().execute("token", {
      operation: "create_file", provider: "onedrive", drive_id: "drive", name: "report.txt", content_base64: "dGVzdA==",
    })).rejects.toMatchObject({ code: "CONNECTION_UNAVAILABLE" });
    expect(calls).toHaveLength(1);
  });
});
