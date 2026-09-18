import { readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { interactiveDependenciesSchema } from "@linksense/shared";
import { AppError } from "../src/lib/errors.js";
import { inspectInteractiveApplicationArchive } from "../src/modules/applications/interactive-package.js";
import { actor, developmentFixture, TASK } from "./application-development.fixture.js";

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });
async function setup() {
  const f = await developmentFixture(); roots.push(f.root);
  const project = await f.service.open(actor, TASK, { name: "Capabilities" }, "en-US");
  return { ...f, project, manifestPath: join(f.workspace, project.directory, "manifest.json") };
}
const selections = interactiveDependenciesSchema.parse({
  plugins: [{ id: "30000000-0000-4000-8000-000000000001", name: "Untrusted plugin name" }],
  skills: [{ id: "30000000-0000-4000-8000-000000000002", name: "Skill" }],
  knowledge_bases: [{ id: "30000000-0000-4000-8000-000000000003", name: "Knowledge" }],
  mcp_servers: [{ id: "30000000-0000-4000-8000-000000000004", name: "MCP" }],
});
describe("development capability configuration", () => {
  it("adds all four types to an empty source manifest, refreshes preview and includes them in the installed package", async () => {
    const f = await setup();
    const before = await f.service.capabilities(actor, f.project.id);
    expect(before.dependencies.items).toEqual([]);
    const original = JSON.parse(await readFile(f.manifestPath, "utf8"));
    const next = await f.service.updateCapabilities(actor, f.project.id, { source_hash: before.source_hash, dependencies: selections });
    const manifest = JSON.parse(await readFile(f.manifestPath, "utf8"));
    expect(manifest).toEqual({ ...original, dependencies: { ...selections, plugins: [{ ...selections.plugins[0], name: "Plugin" }] } });
    expect(next.manifest?.dependencies).toEqual(manifest.dependencies);
    expect(next.source_hash).not.toBe(before.source_hash);
    expect(next.preview_current).toBe(true);
    const installed = await f.service.install(actor, next.id, next.source_hash!, { version_number: "1.0.0", usage_instructions: "" });
    const archive = f.installed.get(installed.application_id!);
    expect((await inspectInteractiveApplicationArchive(archive!)).manifest.dependencies).toEqual(manifest.dependencies);
    const reopened = await f.service.capabilities(actor, next.id);
    expect(reopened.dependencies.items.map(item => item.resource_name)).toEqual(["Plugin", "Skill", "MCP", "Knowledge"]);
  });
  it("removes all capabilities and replaces even previously unresolved preview bindings", async () => {
    const f = await setup();
    const configured = await f.service.updateCapabilities(actor, f.project.id, { source_hash: f.project.source_hash!, dependencies: selections });
    await f.service.install(actor, configured.id, configured.source_hash!, { version_number: "1.0.0", usage_instructions: "" });
    const next = await f.service.updateCapabilities(actor, configured.id, { source_hash: configured.source_hash!, dependencies: interactiveDependenciesSchema.parse({}) });
    expect(next.manifest?.dependencies).toEqual(interactiveDependenciesSchema.parse({}));
    expect(next.installed_source_hash).toBeNull();
    expect(f.applications.updateInteractivePackage).toHaveBeenLastCalledWith(actor, next.preview_application_id, expect.any(Buffer), {}, [], expect.any(Object));
  });
  it("keeps code and manifest changes made while the editor was open", async () => {
    const f = await setup();
    const before = await readFile(f.manifestPath, "utf8");
    await writeFile(join(f.workspace, f.project.directory, "index.html"), "<h1>Newer edit</h1>");
    await expect(f.service.updateCapabilities(actor, f.project.id, { source_hash: f.project.source_hash!, dependencies: selections })).rejects.toMatchObject({ code: "APPLICATION_DEVELOPMENT_SOURCE_CHANGED" });
    expect(await readFile(f.manifestPath, "utf8")).toBe(before);
  });
  it("rejects another owner's app and unavailable selections before modifying any source", async () => {
    const f = await setup(); const before = await readFile(f.manifestPath, "utf8");
    await expect(f.service.capabilities({ ...actor, id: TASK }, f.project.id)).rejects.toMatchObject({ code: "APPLICATION_DEVELOPMENT_NOT_FOUND" });
    await expect(f.service.updateCapabilities({ ...actor, id: TASK }, f.project.id, { source_hash: f.project.source_hash!, dependencies: selections })).rejects.toMatchObject({ code: "APPLICATION_DEVELOPMENT_NOT_FOUND" });
    f.store.resolveDependencies.mockRejectedValueOnce(new AppError("APPLICATION_DEPENDENCY_UNAVAILABLE"));
    await expect(f.service.updateCapabilities(actor, f.project.id, { source_hash: f.project.source_hash!, dependencies: selections })).rejects.toMatchObject({ code: "APPLICATION_DEPENDENCY_UNAVAILABLE" });
    expect(await readFile(f.manifestPath, "utf8")).toBe(before);
    await expect(f.service.capabilities({ ...actor, status: "disabled" }, f.project.id)).rejects.toMatchObject({ code: "USER_DISABLED" });
  });
  it("serializes simultaneous saves and rejects the stale save without losing the winning selection", async () => {
    const f = await setup();
    const results = await Promise.allSettled([
      f.service.updateCapabilities(actor, f.project.id, { source_hash: f.project.source_hash!, dependencies: selections }),
      f.service.updateCapabilities(actor, f.project.id, { source_hash: f.project.source_hash!, dependencies: interactiveDependenciesSchema.parse({ skills: selections.skills }) }),
    ]);
    expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
    expect(results.find(result => result.status === "rejected")).toMatchObject({ reason: { code: "APPLICATION_DEVELOPMENT_SOURCE_CHANGED" } });
  });
  it("displays existing mapped resources and keeps unavailable declarations visible for removal", async () => {
    const f = await setup();
    f.store.resolveDependencies.mockResolvedValueOnce({ items: [
      { type: "plugin", id: TASK, name: "Imported plugin", resource_id: selections.plugins[0]!.id, resource_name: "Plugin", available: true },
      { type: "skill", id: TASK, name: "Removed skill", resource_id: null, resource_name: null, available: false },
    ] });
    expect((await f.service.capabilities(actor, f.project.id)).dependencies.items).toEqual([
      expect.objectContaining({ resource_name: "Plugin", available: true }),
      expect.objectContaining({ name: "Removed skill", available: false }),
    ]);
  });
  it("keeps a running preview on its old configuration until it finishes", async () => {
    const f = await setup(); f.store.isRunning.mockResolvedValue(true);
    const next = await f.service.updateCapabilities(actor, f.project.id, { source_hash: f.project.source_hash!, dependencies: selections });
    expect(next.preview_conversation_id).toBe(f.project.preview_conversation_id);
    expect(next.preview_current).toBe(false);
    f.store.isRunning.mockResolvedValue(false);
    expect((await f.service.sync(actor, next.id)).preview_current).toBe(true);
  });
});
