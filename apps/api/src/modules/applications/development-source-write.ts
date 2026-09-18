import { createHash, randomUUID } from "node:crypto";
import { chmod, realpath, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { lock } from "proper-lockfile";
import { z } from "zod";
import { applicationSourceDirectorySchema, applicationDevelopmentMetadataSchema, interactiveDependenciesSchema, workspacePermissionPolicy, type ApplicationDevelopmentMetadata, type InteractiveDependencies } from "@linksense/shared";
import { AppError } from "../../lib/errors.js";
import { ensureSharedWorkspaceDirectory } from "../../lib/shared-workspace-directory.js";
import { buildApplicationSourceArchive, readApplicationSource } from "./development-source.js";
import { inspectInteractiveApplicationArchive } from "./interactive-package.js";
import { decodeApplicationIcon } from "./icon-input.js";

async function sourceControlDirectory(workspace: string): Promise<string> {
  const control = join(workspace, ".linksense-application-development");
  await ensureSharedWorkspaceDirectory(workspace, control);
  return control;
}

/** Serialize API publication and configuration writes across processes, outside deployable files. */
export async function withApplicationSourceLock<T>(workspaceRoot: string, directory: string, action: () => Promise<T>): Promise<T> {
  const workspace = await realpath(workspaceRoot);
  const parsed = applicationSourceDirectorySchema.safeParse(directory);
  if (!parsed.success) throw new AppError("APPLICATION_PACKAGE_INVALID");
  const control = await sourceControlDirectory(workspace);
  const key = createHash("sha256").update(parsed.data).digest("hex");
  const release = await lock(join(control, key), {
    realpath: false, stale: 120_000, update: 10_000,
    retries: { retries: 40, factor: 1, minTimeout: 100, maxTimeout: 100 },
  }).catch((error: unknown) => {
    if (error instanceof Error && "code" in error && error.code === "ELOCKED") throw new AppError("CONFLICT");
    throw error;
  });
  try { return await action(); }
  finally { await release(); }
}

/** Caller holds the source lock. Replace only the manifest, never source code or credentials. */
export async function writeApplicationDependencies(
  workspaceRoot: string, directory: string, expectedHash: string, dependencies: InteractiveDependencies,
): Promise<void> {
  await writeApplicationManifest(workspaceRoot, directory, expectedHash, { dependencies: interactiveDependenciesSchema.parse(dependencies) });
}

export async function writeApplicationMetadata(
  workspaceRoot: string, directory: string, expectedHash: string, metadata: ApplicationDevelopmentMetadata,
): Promise<void> {
  const { icon, ...fields } = applicationDevelopmentMetadataSchema.parse(metadata);
  if (!icon) return writeApplicationManifest(workspaceRoot, directory, expectedHash, fields);
  if (icon.type === "preset") return writeApplicationManifest(workspaceRoot, directory, expectedHash, { ...fields, icon: null, icon_preset: icon.preset });
  const image = decodeApplicationIcon(icon);
  const path = `app-icon-${randomUUID()}.${image.extension}`;
  await writeApplicationManifest(workspaceRoot, directory, expectedHash, { ...fields, icon: path }, { path, bytes: image.bytes });
}

async function writeApplicationManifest(
  workspaceRoot: string, directory: string, expectedHash: string,
  patch: Record<string, unknown>, asset?: { path: string; bytes: Buffer },
): Promise<void> {
  const workspace = await realpath(workspaceRoot);
  const source = await readApplicationSource(workspace, directory);
  if (source.hash !== expectedHash) throw new AppError("APPLICATION_DEVELOPMENT_SOURCE_CHANGED");
  const originalBytes = source.files.get("manifest.json");
  if (!originalBytes) throw new AppError("APPLICATION_PACKAGE_INVALID");
  const original = z.record(z.string(), z.json()).parse(JSON.parse(originalBytes.toString("utf8")));
  const manifest = { ...original, ...patch };
  const contents = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`);
  const candidate = new Map(source.files);
  candidate.set("manifest.json", contents);
  if (asset) candidate.set(asset.path, asset.bytes);
  // Configuration changes must satisfy the same size and package constraints as code edits.
  await inspectInteractiveApplicationArchive(await buildApplicationSourceArchive(candidate));
  const temporary = join(await sourceControlDirectory(workspace), `${randomUUID()}.json`);
  let assetWritten = false;
  let committed = false;
  try {
    await writeFile(temporary, contents, { flag: "wx", mode: workspacePermissionPolicy.sharedWritableFile });
    await chmod(temporary, workspacePermissionPolicy.sharedWritableFile);
    // The assistant may edit outside the API lock. Recheck immediately before atomic replacement.
    if ((await readApplicationSource(workspace, directory)).hash !== expectedHash) throw new AppError("APPLICATION_DEVELOPMENT_SOURCE_CHANGED");
    if (asset) {
      const target = join(workspace, directory, asset.path);
      await writeFile(target, asset.bytes, { flag: "wx", mode: workspacePermissionPolicy.sharedWritableFile });
      assetWritten = true;
      await chmod(target, workspacePermissionPolicy.sharedWritableFile);
    }
    await rename(temporary, join(workspace, directory, "manifest.json"));
    committed = true;
  } finally {
    await rm(temporary, { force: true });
    if (asset && assetWritten && !committed) await rm(join(workspace, directory, asset.path), { force: true });
  }
}
