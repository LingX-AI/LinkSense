import { mkdtemp, mkdir, writeFile, readFile, readdir, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { readApplicationSource } from "../src/modules/applications/development-source.js";
import { inspectInteractiveApplicationArchive } from "../src/modules/applications/interactive-package.js";
import { withApplicationSourceLock, writeApplicationDependencies } from "../src/modules/applications/development-source-write.js";
import { interactiveDependenciesSchema } from "@linksense/shared";

const roots: string[] = [];
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "app-development-")); roots.push(root);
  await mkdir(join(root, "app"));
  await writeFile(join(root, "app/manifest.json"), JSON.stringify({ schema_version: 1, id: "example", name: "Example", version: "1.0.0", sdk_version: 1 }));
  await writeFile(join(root, "app/index.html"), '<html><script src="./app.js"></script></html>');
  await writeFile(join(root, "app/app.js"), 'document.title = "Original"');
  return root;
}
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });
describe("application development source", () => {
  it("writes only dependency declarations and keeps locks and temporary files outside the package", async () => {
    const root = await fixture(); const initial = await readApplicationSource(root, "app");
    const original = JSON.parse(await readFile(join(root, "app/manifest.json"), "utf8"));
    const dependencies = interactiveDependenciesSchema.parse({ skills: [{ id: "10000000-0000-4000-8000-000000000001", name: "Skill" }] });
    await withApplicationSourceLock(root, "app", () => writeApplicationDependencies(root, "app", initial.hash, dependencies));
    expect(JSON.parse(await readFile(join(root, "app/manifest.json"), "utf8"))).toEqual({ ...original, dependencies });
    const next = await readApplicationSource(root, "app");
    expect(next.files.get("app.js")).toEqual(initial.files.get("app.js"));
    expect([...next.files.keys()]).toEqual([...initial.files.keys()]);
    expect(await readdir(join(root, ".linksense-application-development"))).toEqual([]);
    await expect(withApplicationSourceLock(root, "app", () => writeApplicationDependencies(root, "app", initial.hash, dependencies))).rejects.toMatchObject({ code: "APPLICATION_DEVELOPMENT_SOURCE_CHANGED" });
    expect(await readdir(join(root, ".linksense-application-development"))).toEqual([]);
  });
  it("rejects replaced manifests and directories without writing through symlinks", async () => {
    const root = await fixture(); const initial = await readApplicationSource(root, "app");
    const outside = join(root, "other.json"); await writeFile(outside, "private");
    await rm(join(root, "app/manifest.json")); await symlink(outside, join(root, "app/manifest.json"));
    await expect(withApplicationSourceLock(root, "app", () => writeApplicationDependencies(root, "app", initial.hash, interactiveDependenciesSchema.parse({})))).rejects.toMatchObject({ code: "APPLICATION_PACKAGE_INVALID" });
    expect(await readFile(outside, "utf8")).toBe("private");
    await expect(withApplicationSourceLock(root, "../other", async () => undefined)).rejects.toMatchObject({ code: "APPLICATION_PACKAGE_INVALID" });
  });
  it("captures a reproducible installable snapshot and detects source edits", async () => {
    const root = await fixture();
    const initial = await readApplicationSource(root, "app");
    const repeated = await readApplicationSource(root, "app");
    expect(repeated.hash).toBe(initial.hash);
    expect(await repeated.archive()).toEqual(await initial.archive());
    expect((await inspectInteractiveApplicationArchive(await initial.archive("dev.2"))).manifest.version).toBe("dev.2");
    expect(initial.manifest.version).toBe("1.0.0");
    await writeFile(join(root, "app/app.js"), 'document.title = "Changed"');
    expect((await readApplicationSource(root, "app")).hash).not.toBe(initial.hash);
  });
  it.each(["../app", "/app", "app/../app", "app\\file", ".env"])("rejects an invalid source directory %s", async directory => {
    await expect(readApplicationSource(await fixture(), directory)).rejects.toMatchObject({ code: "APPLICATION_PACKAGE_INVALID" });
  });
  it.each([".env", "server.ts", "node_modules/package.json"])("rejects non-deployable or private files: %s", async file => {
    const root = await fixture();
    if (file.includes("/")) await mkdir(join(root, "app/node_modules"));
    await writeFile(join(root, "app", file), "private");
    await expect(readApplicationSource(root, "app")).rejects.toMatchObject({ code: "APPLICATION_PACKAGE_INVALID" });
  });
  it("rejects symlinks even when they point to another owned file", async () => {
    const root = await fixture();
    await symlink(join(root, "app/app.js"), join(root, "app/alias.js"));
    await expect(readApplicationSource(root, "app")).rejects.toMatchObject({ code: "APPLICATION_PACKAGE_INVALID" });
  });
  it("rejects incomplete application manifests", async () => {
    const root = await fixture();
    await writeFile(join(root, "app/manifest.json"), "{}");
    await expect(readApplicationSource(root, "app")).rejects.toMatchObject({ code: "APPLICATION_PACKAGE_INVALID" });
  });
});
