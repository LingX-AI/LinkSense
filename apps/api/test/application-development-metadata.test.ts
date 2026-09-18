import { readFile, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "../src/generated/prisma/client.js";
import { ApplicationDevelopmentRepository } from "../src/modules/applications/development-repository.js";
import { AppError } from "../src/lib/errors.js";
import { inspectInteractiveApplicationArchive } from "../src/modules/applications/interactive-package.js";
import { actor, developmentFixture, TASK, OWNER } from "./application-development.fixture.js";

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });
async function setup() {
  const f = await developmentFixture(); roots.push(f.root);
  const project = await f.service.open(actor, TASK, { name: "Original" }, "en-US");
  return { ...f, project, manifestPath: join(f.workspace, project.directory, "manifest.json") };
}

describe("application development metadata and publication", () => {
  it("uses an uploaded workspace image through the scoped tool, keeps its original and updates only requested metadata", async () => {
    const f = await setup();
    const image = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=", "base64");
    await writeFile(join(f.workspace, "用户图标.png"), image);
    const next = await f.service.tool(actor, TASK, OWNER, { operation: "metadata", source_hash: f.project.source_hash!, name: "My app", icon: { type: "file", path: "用户图标.png" } }, "en-US");
    expect(next).toMatchObject({ name: "My app", manifest: { icon: expect.stringMatching(/\.png$/u), description: f.project.manifest?.description } });
    expect(f.store.assertActiveTurn).toHaveBeenCalledWith(OWNER, TASK, OWNER);
    expect(await readFile(join(f.workspace, "用户图标.png"))).toEqual(image);
    expect(f.installed.size).toBe(0);
  });

  it("rejects traversal, absolute, linked, oversized and non-image files without changing the draft", async () => {
    const f = await setup();
    await writeFile(join(f.root, "outside.png"), "private");
    await symlink(join(f.root, "outside.png"), join(f.workspace, "link.png"));
    await writeFile(join(f.workspace, "invalid.png"), "not an image");
    await writeFile(join(f.workspace, "large.png"), Buffer.alloc(512 * 1024 + 1));
    for (const path of ["../outside.png", join(f.root, "outside.png"), "link.png", "invalid.png", "large.png", "missing.png", ".private/token.png"]) {
      await expect(f.service.tool(actor, TASK, OWNER, { operation: "metadata", source_hash: f.project.source_hash!, icon: { type: "file", path } }, "en-US")).rejects.toMatchObject({ code: "APPLICATION_ICON_UPLOAD_INVALID" });
    }
    f.store.assertActiveTurn.mockRejectedValueOnce(new AppError("FORBIDDEN"));
    await expect(f.service.tool(actor, TASK, OWNER, { operation: "metadata", source_hash: f.project.source_hash!, name: "Denied" }, "en-US")).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect((await f.service.sync(actor, f.project.id)).source_hash).toBe(f.project.source_hash);
  });
  it("stores an uploaded icon in the source package and publishes it, then replaces it with a preset", async () => {
    const f = await setup();
    const bytes = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=", "base64");
    const uploaded = await f.service.updateMetadata(actor, f.project.id, {
      source_hash: f.project.source_hash!, icon: { type: "upload", filename: "logo.png", mime_type: "image/png", data_base64: bytes.toString("base64") },
    });
    expect(uploaded.name).toBe(f.project.name);
    expect(uploaded.manifest?.icon).toMatch(/\.png$/u);
    expect(await readFile(join(f.workspace, f.project.directory, uploaded.manifest!.icon!))).toEqual(bytes);
    const installed = await f.service.install(actor, uploaded.id, uploaded.source_hash!, { version_number: "1.0.0", usage_instructions: "" });
    expect((await inspectInteractiveApplicationArchive(f.installed.get(installed.application_id!)!)).icon?.bytes).toEqual(bytes);
    const preset = await f.service.updateMetadata(actor, uploaded.id, { source_hash: uploaded.source_hash!, icon: { type: "preset", preset: "book-open" } });
    expect(preset.manifest).toMatchObject({ icon: null, icon_preset: "book-open" });
  });

  it("rejects invalid icon bytes without changing the source", async () => {
    const f = await setup();
    await expect(f.service.updateMetadata(actor, f.project.id, { source_hash: f.project.source_hash!, icon: { type: "upload", filename: "logo.png", mime_type: "image/png", data_base64: Buffer.from("not an image").toString("base64") } })).rejects.toMatchObject({ code: "APPLICATION_ICON_UPLOAD_INVALID" });
    expect((await f.service.sync(actor, f.project.id)).source_hash).toBe(f.project.source_hash);
  });

  it("saves name and description to the source package and preview, then publishes and enables the reviewed version", async () => {
    const f = await setup();
    const installed = await f.service.install(actor, f.project.id, f.project.source_hash!, { version_number: "1.0.0", usage_instructions: "" });
    const previousPackage = f.installed.get(installed.application_id!)!;
    const original = JSON.parse(await readFile(f.manifestPath, "utf8"));
    const code = await readFile(join(f.workspace, f.project.directory, "app.js"));
    const next = await f.service.updateMetadata(actor, f.project.id, { source_hash: f.project.source_hash!, name: " Renamed ", description: " New description " });
    expect(next).toMatchObject({ name: "Renamed", manifest: { name: "Renamed", description: "New description" }, preview_current: true });
    expect(next.source_hash).not.toBe(f.project.source_hash);
    expect(next.installed_source_hash).toBe(f.project.source_hash);
    expect(JSON.parse(await readFile(f.manifestPath, "utf8"))).toEqual({ ...original, name: "Renamed", description: "New description" });
    expect(await readFile(join(f.workspace, f.project.directory, "app.js"))).toEqual(code);
    expect(f.installed.get(installed.application_id!)).toBe(previousPackage);
    expect(f.conversations.patch).toHaveBeenLastCalledWith(OWNER, TASK, { title: "开发 Renamed" });
    const published = await f.service.install(actor, next.id, next.source_hash!, { version_number: "1.0.0", usage_instructions: "" });
    expect(published.application_id).toBe(installed.application_id);
    expect((await inspectInteractiveApplicationArchive(f.installed.get(published.application_id!)!)).manifest).toMatchObject({ name: "Renamed", description: "New description" });
    expect(f.store.activateInstalledApplication).toHaveBeenLastCalledWith(OWNER, published.application_id, expect.any(Object));
    f.applications.updateInteractivePackage.mockClear();
    await f.service.install(actor, next.id, next.source_hash!, { version_number: "1.0.0", usage_instructions: "" });
    expect(f.store.activateInstalledApplication).toHaveBeenLastCalledWith(OWNER, published.application_id, expect.any(Object));
    expect(f.applications.updateInteractivePackage).toHaveBeenCalledOnce();
  });

  it("handles old manifests without descriptions and supports explicitly clearing a description", async () => {
    const f = await setup();
    const original = JSON.parse(await readFile(f.manifestPath, "utf8")); delete original.description;
    await writeFile(f.manifestPath, JSON.stringify(original));
    const old = await f.service.sync(actor, f.project.id);
    expect(old.manifest?.description).toBeNull();
    const next = await f.service.updateMetadata(actor, old.id, { source_hash: old.source_hash!, name: "Renamed", description: "Added" });
    const cleared = await f.service.updateMetadata(actor, next.id, { source_hash: next.source_hash!, name: next.name, description: null });
    expect(cleared.manifest?.description).toBeNull();
    expect(JSON.parse(await readFile(f.manifestPath, "utf8")).description).toBeNull();
  });

  it("rejects invalid actors, stale sources and invalid fields without changing files", async () => {
    const f = await setup(); const original = await readFile(f.manifestPath, "utf8");
    const input = { source_hash: f.project.source_hash!, name: "Changed", description: null };
    await expect(f.service.updateMetadata({ ...actor, id: TASK }, f.project.id, input)).rejects.toMatchObject({ code: "APPLICATION_DEVELOPMENT_NOT_FOUND" });
    await expect(f.service.updateMetadata({ ...actor, status: "disabled" }, f.project.id, input)).rejects.toMatchObject({ code: "USER_DISABLED" });
    await expect(f.service.updateMetadata(actor, f.project.id, { ...input, name: " " })).rejects.toThrow();
    await writeFile(join(f.workspace, f.project.directory, "app.js"), "// assistant edit");
    await expect(f.service.updateMetadata(actor, f.project.id, input)).rejects.toMatchObject({ code: "APPLICATION_DEVELOPMENT_SOURCE_CHANGED" });
    expect(await readFile(f.manifestPath, "utf8")).toBe(original);
  });

  it("serializes simultaneous edits and rejects the stale edit", async () => {
    const f = await setup();
    const results = await Promise.allSettled(["First", "Second"].map(name => f.service.updateMetadata(actor, f.project.id, { source_hash: f.project.source_hash!, name, description: null })));
    expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
    expect(results.find(result => result.status === "rejected")).toMatchObject({ reason: { code: "APPLICATION_DEVELOPMENT_SOURCE_CHANGED" } });
  });

  it("only enables owned installed interactive applications and never revives deleted apps or activates previews", async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const db = { application: { updateMany } } as unknown as PrismaClient;
    const repository = new ApplicationDevelopmentRepository(db);
    await repository.activateInstalledApplication(OWNER, TASK);
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: TASK, ownerId: OWNER, kind: "interactive", developmentOnly: false, status: { in: ["active", "disabled"] } },
      data: { status: "active" },
    });
    updateMany.mockResolvedValueOnce({ count: 0 });
    await expect(repository.activateInstalledApplication(OWNER, TASK)).rejects.toMatchObject({ code: "APPLICATION_NOT_FOUND" });
  });
});
