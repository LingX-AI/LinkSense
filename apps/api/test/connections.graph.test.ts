import { afterEach, describe, it, expect, vi } from "vitest";
import { MICROSOFT_FILE_MAX_BYTES } from "@linksense/shared";
import {
  MicrosoftFilesGraph,
  assertGraphNextLink,
  type DelegatedGraphClient,
} from "../src/modules/connections/graph.js";
import type { fetchPublicHttpResource } from "../src/lib/safe-http-fetch.js";

afterEach(() => vi.unstubAllGlobals());

function fixture(value: unknown) {
  const get = vi.fn(async (): Promise<unknown> => value);
  const request = {
    get,
    select: vi.fn(() => request),
    top: vi.fn(() => request),
    query: vi.fn(() => request),
    option: vi.fn(() => request),
  };
  const client: DelegatedGraphClient = { api: vi.fn(() => request) };
  const download = vi.fn<typeof fetchPublicHttpResource>().mockResolvedValue({
    bytes: Buffer.from("Hello"),
    contentType: "text/plain",
    finalUrl: new URL("https://example.test/file"),
  });
  const factory = vi.fn(() => client);
  return {
    graph: new MicrosoftFilesGraph({ createClient: factory, download }),
    get,
    client,
    request,
    download,
    factory,
  };
}
describe("delegated Microsoft Graph files", () => {
  it("reads personal OneDrive files when a field projection omits the download annotation", async () => {
    const requests: URL[] = [];
    vi.stubGlobal("fetch", vi.fn<typeof fetch>(async (input) => {
      const url = new URL(input instanceof Request ? input.url : input.toString());
      requests.push(url);
      return Response.json({
        id: "file", name: "report.txt", file: { mimeType: "text/plain" }, size: 5,
        ...(!url.searchParams.has("$select") ? {
          "@microsoft.graph.downloadUrl": "https://my.microsoftpersonalcontent.com/download?temporary=secret",
        } : {}),
      });
    }));
    const download = vi.fn<typeof fetchPublicHttpResource>().mockResolvedValue({
      bytes: Buffer.from("Hello"), contentType: "text/plain", finalUrl: new URL("https://my.microsoftpersonalcontent.com/download"),
    });
    const result = await new MicrosoftFilesGraph({ download }).execute("graph-token", {
      operation: "read_file", provider: "onedrive", drive_id: "drive", item_id: "file",
    });
    expect(result.result).toMatchObject({ kind: "file", content_base64: "SGVsbG8=" });
    expect(requests).toHaveLength(1);
    expect(download).toHaveBeenCalledOnce();
    expect(JSON.stringify(result)).not.toContain("temporary");
    expect(JSON.stringify(download.mock.calls)).not.toContain("graph-token");
  });

  it("keeps special characters inside the site search value when using the real Graph SDK", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(Response.json({ value: [] }));
    vi.stubGlobal("fetch", fetch);
    const query = "R&D #季度 + 计划";
    await new MicrosoftFilesGraph().execute("test-only-token", {
      operation: "search_sites",
      provider: "sharepoint",
      query,
    });
    const request = fetch.mock.calls[0]?.[0];
    if (!request) throw new Error("missing Graph request");
    const url = new URL(request instanceof Request ? request.url : request.toString());
    expect(url.origin).toBe("https://graph.microsoft.com");
    expect(url.searchParams.get("search")).toBe(query);
    expect(url.hash).toBe("");
    expect([...url.searchParams.keys()].sort()).toEqual(["$select", "$top", "search"]);
  });
  it("lists SharePoint sites and libraries through delegated Graph endpoints", async () => {
    const f = fixture({
      value: [
        { id: "site", displayName: "Team", webUrl: "https://example.sharepoint.com/sites/team" },
      ],
    });
    const result = await f.graph.execute("private-token", {
      operation: "search_sites",
      provider: "sharepoint",
      query: "Team",
    });
    expect(f.client.api).toHaveBeenCalledWith("/sites");
    expect(f.request.query).toHaveBeenCalledWith({ search: "Team" });
    expect(result.result).toMatchObject({ kind: "page", items: [{ name: "Team", kind: "site" }] });
    await f.graph.execute("private-token", {
      operation: "list_drives",
      provider: "sharepoint",
      site_id: "example.sharepoint.com,site,web",
    });
    expect(f.client.api).toHaveBeenLastCalledWith(
      "/sites/example.sharepoint.com%2Csite%2Cweb/drives",
    );
    expect(f.request.option).toHaveBeenCalledWith("redirect", "error");
  });
  it("escapes apostrophes and reserved characters in drive searches", async () => {
    const f = fixture({ value: [] });
    await f.graph.execute("token", {
      operation: "search_files",
      provider: "onedrive",
      drive_id: "drive",
      query: "O'Reilly & report",
    });
    expect(f.client.api).toHaveBeenCalledWith(
      "/drives/drive/root/search(q='O%27%27Reilly%20%26%20report')",
    );
  });
  it("rejects foreign origins, credentials and paths in Graph continuations", () => {
    for (const url of [
      "https://evil.test/v1.0/me/drives",
      "https://graph.microsoft.com.evil.test/v1.0/me/drives",
      "https://user:pass@graph.microsoft.com/v1.0/me/drives",
      "https://graph.microsoft.com/v1.0/users",
      "http://graph.microsoft.com/v1.0/me/drives",
    ])
      expect(() => assertGraphNextLink(url, "/me/drives")).toThrow();
    expect(
      assertGraphNextLink(
        "https://graph.microsoft.com/v1.0/me/drives?$skiptoken=next",
        "/me/drives",
      ),
    ).toContain("$skiptoken=next");
  });
  it("downloads bounded file bytes without passing Microsoft credentials or returning preauthenticated URLs", async () => {
    const f = fixture({
      id: "item",
      name: "report.txt",
      webUrl: "https://example.sharepoint.com/report.txt",
      file: { mimeType: "text/plain" },
      size: 5,
      "@microsoft.graph.downloadUrl": "https://download.example.test/file?secret=temporary",
    });
    const result = await f.graph.execute("microsoft-secret", {
      operation: "read_file",
      provider: "sharepoint",
      drive_id: "drive",
      item_id: "item",
    });
    expect(result.result).toMatchObject({
      kind: "file",
      content_base64: Buffer.from("Hello").toString("base64"),
    });
    expect(JSON.stringify(result)).not.toContain("temporary");
    expect(JSON.stringify(f.download.mock.calls)).not.toContain("microsoft-secret");
    expect(f.download.mock.calls[0]?.[1]).toMatchObject({
      byteLimit: MICROSOFT_FILE_MAX_BYTES,
      allowedProtocols: ["https:"],
      allowBenchmarkProxyAddresses: false,
    });
  });
  it("rejects oversized files before downloading and sanitizes upstream failures", async () => {
    const f = fixture({
      id: "item",
      name: "large.pdf",
      file: {},
      size: MICROSOFT_FILE_MAX_BYTES + 1,
      "@microsoft.graph.downloadUrl": "https://example.test/file",
    });
    const request = {
      operation: "read_file",
      provider: "onedrive",
      drive_id: "drive",
      item_id: "item",
    } as const;
    await expect(f.graph.execute("token", request)).rejects.toMatchObject({
      code: "CONNECTION_FILE_TOO_LARGE",
    });
    expect(f.download).not.toHaveBeenCalled();
    f.get.mockRejectedValueOnce({ statusCode: 403, message: "provider-token-secret" });
    await expect(f.graph.execute("token", request)).rejects.toMatchObject({
      message: "CONNECTION_ACCESS_DENIED",
    });
  });
});
