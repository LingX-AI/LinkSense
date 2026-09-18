import { mkdtemp, mkdir, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { afterEach, describe, expect, it } from "vitest";
import { captureWebBundle } from "../src/modules/web-sites/bundle.js";
import { prepareWebResource, readResource, sha256 } from "../src/modules/web-sites/resources.js";
import { fileId, memoryStorage } from "./web-sites.fixture.js";

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });
async function bundleFixture() {
  const workspaceRoot = await realpath(await mkdtemp(join(tmpdir(), "linksense-web-bundle-")));
  roots.push(workspaceRoot);
  await mkdir(join(workspaceRoot, "site/assets"), { recursive: true });
  const entryData = Buffer.from('<!doctype html><link rel="stylesheet" href="/assets/style.css"><script type="module" src="/assets/main.js"></script><img src="/assets/image.svg">');
  await writeFile(join(workspaceRoot, "site/index.html"), entryData);
  await writeFile(join(workspaceRoot, "site/assets/style.css"), 'body{color:rgb(1,2,3);background:url("/assets/image.svg")}');
  await writeFile(join(workspaceRoot, "site/assets/image.svg"), '<svg xmlns="http://www.w3.org/2000/svg"/>');
  await writeFile(join(workspaceRoot, "site/assets/main.js"), 'import { count } from "/assets/counter.js"; document.body.dataset.count=count;');
  await writeFile(join(workspaceRoot, "site/assets/counter.js"), "export const count=42;");
  const storage = memoryStorage();
  return { ...storage, workspaceRoot, directory: "site", entry: join(workspaceRoot, "site/index.html"), entryData, fileId, cleanup: storage.storage.removeObject };
}
describe("web resource packaging", () => {
  it("keeps Chinese text readable when the source HTML omitted its encoding", async () => {
    const result = await prepareWebResource(Buffer.from('<title>关于本期</title><h1>山海集</h1>'), "about.html", new Set(["about.html"]));
    expect(result.toString()).toContain('<meta charset="utf-8">');
    expect(result.toString()).toContain("山海集");
  });
  it("captures an immutable complete directory and preserves relative module/CSS/image references", async () => {
    const input = await bundleFixture();
    const manifest = await captureWebBundle(input);
    expect(manifest.files).toHaveLength(5);
    const html = input.objects.get(`web-artifact-bundles/${fileId}/index.html`)?.toString();
    expect(html).toContain('src="./assets/main.js"');
    expect(input.objects.get(`web-artifact-bundles/${fileId}/assets/main.js`)?.toString()).toContain('from "./counter.js"');
    expect(input.objects.get(`web-artifact-bundles/${fileId}/assets/style.css`)?.toString()).toContain('url("./image.svg")');
    for (const file of manifest.files) expect(sha256(input.objects.get(file.object_key)!)).toBe(file.checksum_sha256);
    await writeFile(input.entry, "changed later");
    expect(input.objects.get(`web-artifact-bundles/${fileId}/index.html`)?.toString()).toBe(html);
  });
  it.each(["secret.env", ".env", "app.ts", "app.js.map", "node_modules/file.js"])("rejects non-public file %s before uploading", async name => {
    const input = await bundleFixture();
    if (name.includes("/")) await mkdir(join(input.workspaceRoot, "site/node_modules"));
    await writeFile(join(input.workspaceRoot, "site", name), "private");
    await expect(captureWebBundle(input)).rejects.toMatchObject({ code: "WEB_SITE_BUNDLE_INVALID" });
    expect(input.storage.putObject).not.toHaveBeenCalled();
  });
  it("rejects symlinks, a workspace-wide root, and a changed entry", async () => {
    const input = await bundleFixture();
    await expect(captureWebBundle({ ...input, directory: "." })).rejects.toMatchObject({ code: "WEB_SITE_BUNDLE_INVALID" });
    await expect(captureWebBundle({ ...input, entryData: Buffer.from("outdated") })).rejects.toMatchObject({ code: "WEB_SITE_BUNDLE_INVALID" });
    await symlink(input.entry, join(input.workspaceRoot, "site/link.html"));
    await expect(captureWebBundle(input)).rejects.toMatchObject({ code: "WEB_SITE_BUNDLE_INVALID" });
  });
  it("rejects missing dependencies before writing and cleans every object after a partial storage failure", async () => {
    const input = await bundleFixture();
    input.storage.putObject.mockImplementationOnce(async (key, data) => { input.objects.set(key, data); throw new Error("storage unavailable"); });
    await expect(captureWebBundle(input)).rejects.toThrow("storage unavailable");
    expect(input.objects.size).toBe(0);
    expect(input.cleanup).toHaveBeenCalledTimes(5);
    input.storage.putObject.mockClear();
    await rm(join(input.workspaceRoot, "site/assets/counter.js"));
    await expect(captureWebBundle(input)).rejects.toMatchObject({ code: "WEB_SITE_RESOURCES_MISSING" });
    expect(input.storage.putObject).not.toHaveBeenCalled();
  });
  it("rewrites responsive images, nested imports, inline styles, import maps, and dynamic string imports", async () => {
    const paths = new Set(["pages/index.html", "assets/a.png", "assets/b.png", "assets/main.js", "assets/next.js"]);
    const html = await prepareWebResource(Buffer.from('<img srcset="/assets/a.png 1x, /assets/b.png 2x" style="background:url(/assets/a.png)"><a href="mailto:test@example.test">Email</a><script type="importmap">{"imports":{"example":"/assets/main.js"}}</script><script type="module">import("/assets/next.js")</script>'), "pages/index.html", paths);
    expect(html.toString()).toContain('srcset="../assets/a.png 1x, ../assets/b.png 2x"');
    expect(html.toString()).toContain('"example":"../assets/main.js"');
    expect(html.toString()).toContain('import("../assets/next.js")');
    expect(html.toString()).toContain('href="mailto:test@example.test"');
  });
  it.each(['<img src="../secret.png">', '<script src="./missing.js"></script>', '<style>@import "missing.css"</style>'])("rejects missing or escaping references: %s", async html => {
    await expect(prepareWebResource(Buffer.from(html), "index.html", new Set(["index.html"]))).rejects.toMatchObject({ code: "WEB_SITE_RESOURCES_MISSING" });
  });
  it("keeps external URLs without fetching them and rejects base overrides and invalid UTF-8", async () => {
    const html = '<script src="https://cdn.example.test/lib.js"></script><img src="data:image/png;base64,aA==">';
    const prepared = (await prepareWebResource(Buffer.from(html), "index.html", new Set(["index.html"]))).toString();
    expect(prepared).toContain('src="https://cdn.example.test/lib.js"');
    expect(prepared).toContain('src="data:image/png;base64,aA=="');
    await expect(prepareWebResource(Buffer.from('<base href="/">'), "index.html", new Set())).rejects.toMatchObject({ code: "WEB_SITE_BUNDLE_INVALID" });
    await expect(prepareWebResource(Buffer.from([255, 254]), "index.html", new Set())).rejects.toMatchObject({ code: "WEB_SITE_BUNDLE_INVALID" });
  });
  it("bounds stream reads and rejects truncated or oversized data", async () => {
    await expect(readResource(Readable.from([Buffer.from("123")]), 3)).resolves.toEqual(Buffer.from("123"));
    await expect(readResource(Readable.from([Buffer.from("1234")]), 3)).rejects.toMatchObject({ code: "WEB_SITE_BUNDLE_INVALID" });
    await expect(readResource(Readable.from([Buffer.from("12")]), 3)).rejects.toMatchObject({ code: "WEB_SITE_BUNDLE_INVALID" });
  });
});
