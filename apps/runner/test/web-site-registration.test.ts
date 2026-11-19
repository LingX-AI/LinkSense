import { lstat, mkdir, mkdtemp, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fileServiceCoreMcpModule } from "../src/mcp/core-services/file-service.js";
import { fileServiceErrorFromApi } from "../src/file-service-error.js";

const roots: string[] = [];
afterEach(async () => { vi.unstubAllGlobals(); await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });
async function fixture() {
  const root = await realpath(await mkdtemp(join(tmpdir(), "linksense-site-registration-")));
  roots.push(root);
  await mkdir(join(root, "site/assets"), { recursive: true, mode: 0o700 });
  await writeFile(join(root, "site/index.html"), '<script src="assets/main.js"></script>', { mode: 0o600 });
  await writeFile(join(root, "site/assets/main.js"), "document.title='Ready'", { mode: 0o600 });
  const module = fileServiceCoreMcpModule.create({ workspaceRoot: root, environment: { LINKSENSE_FILE_SERVICE_ENDPOINT: "https://runner.example.test/register", LINKSENSE_FILE_SERVICE_TOKEN: "test-registration-token-0000000000000000", LINKSENSE_CONVERSATION_ID: "10000000-0000-4000-8000-000000000001" } });
  const fetch = vi.fn(async () => Response.json({ success: true, artifact_id: "20000000-0000-4000-8000-000000000001", file_id: "20000000-0000-4000-8000-000000000001", display_name: "index.html", download_card_event_id: "30000000-0000-4000-8000-000000000001" }));
  vi.stubGlobal("fetch", fetch);
  const call = () => module.callTool({ toolName: "register_artifact", argumentsValue: { workspace_relative_path: "site/index.html", display_name: "index.html", web_root_relative_path: "site" }, signal: new AbortController().signal });
  return { root, fetch, call };
}
describe("desktop website artifact MCP contract", () => {
  it("offers and forwards web_root_relative_path only with the trusted website marker", async () => {
    const root = await realpath(await mkdtemp(join(tmpdir(), "linksense-desktop-site-registration-")));
    roots.push(root);
    const fetch = vi.fn(async () => Response.json({ success: true, artifact_id: "20000000-0000-4000-8000-000000000001", file_id: "20000000-0000-4000-8000-000000000001", display_name: "index.html", download_card_event_id: "30000000-0000-4000-8000-000000000001" }));
    vi.stubGlobal("fetch", fetch);
    const module = fileServiceCoreMcpModule.create({ workspaceRoot: root, environment: {
      LINKSENSE_FILE_SERVICE_ENDPOINT: "https://runner.example.test/register?desktop=1&website=1",
      LINKSENSE_FILE_SERVICE_TOKEN: "test-registration-token-0000000000000000",
      LINKSENSE_CONVERSATION_ID: "10000000-0000-4000-8000-000000000001",
    } });
    expect(module.tools[0]?.inputSchema.properties?.web_root_relative_path).toBeDefined();
    const result = await module.callTool({
      toolName: "register_artifact",
      argumentsValue: { workspace_relative_path: "site/index.html", display_name: "index.html", web_root_relative_path: "site" },
      signal: new AbortController().signal,
    });
    expect(result.isError).toBe(false);
    expect(fetch).toHaveBeenCalledWith("https://runner.example.test/register?desktop=1&website=1", expect.objectContaining({
      body: JSON.stringify({ workspaceRelativePath: "site/index.html", displayName: "index.html", webRootRelativePath: "site" }),
    }));
  });

  it("keeps the single-file desktop tool when the website marker is absent", async () => {
    const root = await realpath(await mkdtemp(join(tmpdir(), "linksense-desktop-site-old-")));
    roots.push(root);
    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", fetchMock);
    const module = fileServiceCoreMcpModule.create({ workspaceRoot: root, environment: {
      LINKSENSE_FILE_SERVICE_ENDPOINT: "https://runner.example.test/register?desktop=1",
      LINKSENSE_FILE_SERVICE_TOKEN: "test-registration-token-0000000000000000",
      LINKSENSE_CONVERSATION_ID: "10000000-0000-4000-8000-000000000001",
    } });
    expect(module.tools[0]?.inputSchema.properties?.web_root_relative_path).toBeUndefined();
    const result = await module.callTool({
      toolName: "register_artifact",
      argumentsValue: { workspace_relative_path: "site/index.html", display_name: "index.html", web_root_relative_path: "site" },
      signal: new AbortController().signal,
    });
    expect(result.isError).toBe(true);
    expect(JSON.parse(String((result.content[0] as { text: string }).text))).toEqual({
      code: "ARTIFACT_REGISTRATION_INVALID",
      retryable: false,
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("website registration MCP contract", () => {
  it("forwards the explicit public directory and makes nested resources readable to the API", async () => {
    const { root, fetch, call } = await fixture();
    expect((await call()).isError).toBe(false);
    expect(fetch).toHaveBeenCalledWith("https://runner.example.test/register", expect.objectContaining({ body: JSON.stringify({ workspaceRelativePath: "site/index.html", displayName: "index.html", webRootRelativePath: "site" }) }));
    expect((await lstat(join(root, "site/assets/main.js"))).mode & 0o040).toBe(0o040);
  });
  it("rejects symlinked resources before HTTP registration", async () => {
    const { root, fetch, call } = await fixture();
    await symlink(join(root, "site/index.html"), join(root, "site/leak.html"));
    expect((await call()).isError).toBe(true);
    expect(fetch).not.toHaveBeenCalled();
  });
  it.each(["WEB_SITE_BUNDLE_INVALID", "WEB_SITE_RESOURCES_MISSING"])("preserves non-retryable publishing failure %s", code => {
    expect(fileServiceErrorFromApi(422, { error_code: code, message: "private path" })).toMatchObject({ code, retryable: false, statusCode: 422 });
    expect(fileServiceErrorFromApi(422, { error_code: code }).message).toBe(code);
  });
});
