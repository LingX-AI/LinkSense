import { createHash, randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { createReadStream } from "node:fs";
import { chmod, copyFile, lstat, mkdir, mkdtemp, readFile, readdir, realpath, rename, rm, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { z } from "zod";
import { desktopTarget, run, validateDesktopTarget } from "./desktop.mjs";

const root = path.resolve(import.meta.dirname, "..");
const desktop = path.join(root, "apps/desktop");
const downloadCachePath = ".data/desktop/downloads";
const archiveDigest = /^[0-9a-f]{64}$/u;
const maximumBinaryBytes = 512 * 1024 * 1024;
const relativeFile = z.string().min(1).max(240).regex(/^[A-Za-z0-9][A-Za-z0-9._/-]*$/u).refine(value =>
  !value.startsWith("/") &&
  value.split("/").every(part => part !== "" && part !== "." && part !== ".."), "unsafe_resource_path");
const artifactSchema = z.strictObject({
  key: z.literal("agent-desktop"),
  format: z.enum(["file", "tar.gz"]),
  url: z.url().refine(value => {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password &&
      !url.search && !url.hash && url.hostname === "github.com";
  }, "untrusted_resource_origin"),
  sha256: z.string().regex(archiveDigest),
  files: z.array(z.strictObject({ source: relativeFile.nullable(), destination: relativeFile })).min(1).max(2),
}).refine(artifact => artifact.format === "file"
  ? artifact.files.length === 1 && artifact.files[0].source === null
  : artifact.files.every(file => file.source !== null), "resource_archive_mismatch");
const platformSchema = z.strictObject({
  runtime_arch: z.enum(["amd64", "arm64"]),
  artifacts: z.array(artifactSchema).length(1),
});
const manifestSchema = z.strictObject({
  schema_version: z.literal(1),
  versions: z.strictObject({
    agent_desktop: z.string().regex(/^\d+\.\d+\.\d+$/u),
  }),
  platforms: z.strictObject({
    "darwin/amd64": platformSchema,
    "darwin/arm64": platformSchema,
    "windows/amd64": platformSchema,
    "windows/arm64": platformSchema,
  }),
});

export function parseDesktopResources(input) {
  const manifest = manifestSchema.parse(input);
  for (const [target, platform] of Object.entries(manifest.platforms)) {
    const artifacts = platform.artifacts;
    const expectedArchitecture = target.split("/")[1];
    if (platform.runtime_arch !== expectedArchitecture) throw new Error("Desktop runtime architecture is unsupported");
    const keys = artifacts.map(artifact => artifact.key).sort();
    if (JSON.stringify(keys) !== JSON.stringify(["agent-desktop"])) {
      throw new Error("Desktop runtime resources are incomplete or duplicated");
    }
    const destinations = artifacts.flatMap(artifact => artifact.files.map(file => file.destination));
    if (new Set(destinations).size !== destinations.length) throw new Error("Desktop runtime destinations overlap");
    for (const artifact of artifacts) {
      const suffix = target.startsWith("windows") ? ".exe" : "";
      const expected = artifact.key === "agent-desktop" && !suffix
        ? ["bin/agent-desktop", "bin/agent-desktop-macos-helper"]
        : [`bin/${artifact.key}${suffix}`];
      if (JSON.stringify(artifact.files.map(file => file.destination)) !== JSON.stringify(expected)) {
        throw new Error("Desktop runtime executable names do not match the platform");
      }
      const origin = `https://github.com/vercel-labs/agent-desktop/releases/download/v${manifest.versions.agent_desktop}/`;
      if (!artifact.url.startsWith(origin)) throw new Error("Desktop runtime release does not match its pinned version");
    }
  }
  return manifest;
}

export async function desktopResourceDigest(filename) {
  const info = await lstat(filename);
  if (!info.isFile() || info.isSymbolicLink() || info.size <= 0 || info.size > maximumBinaryBytes) {
    throw new Error("Desktop resource is not a bounded regular file");
  }
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(filename)) hash.update(chunk);
  return hash.digest("hex");
}

export async function verifyDesktopResource(filename, expected) {
  if (await desktopResourceDigest(filename) !== expected) throw new Error("Desktop resource checksum mismatch");
}

export async function verifyDesktopRuntimeFiles(runtime, files) {
  for (const file of files) {
    await verifyDesktopResource(path.join(runtime, file.path), file.sha256);
  }
}

export async function verifyDesktopPackageManifest(runtime, expected) {
  const packaged = await readFile(path.join(runtime, "manifest.json"));
  if (!packaged.equals(expected)) throw new Error("Packaged runtime manifest differs from the verified staged manifest");
}

export async function verifyMacosBundlePermissions(app) {
  const { stdout } = await promisify(execFile)("/usr/bin/find", [app, "(",
    "-type", "d", "!", "-perm", "-055", "-o",
    "-type", "f", "!", "-perm", "-044", "-o",
    "-type", "f", "-perm", "-100", "!", "-perm", "-011",
    ")", "-print", "-quit"], { timeout: 30_000 });
  if (stdout) throw new Error(`Packaged app is not usable by another macOS account: ${stdout.trim()}`);
}

async function downloadArtifact(artifact, cache) {
  const filename = path.join(cache, artifact.sha256);
  try {
    await verifyDesktopResource(filename, artifact.sha256);
    return filename;
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  const temporary = path.join(cache, `${artifact.sha256}.${randomUUID()}.tmp`);
  try {
    await run("curl", ["--fail", "--location", "--silent", "--show-error",
      "--proto", "=https", "--proto-redir", "=https", "--max-time", "120",
      "--retry", "2", "--retry-max-time", "180", "--max-filesize", String(maximumBinaryBytes),
      "--output", temporary, artifact.url], { cwd: root });
    await verifyDesktopResource(temporary, artifact.sha256);
    await rename(temporary, filename);
    return filename;
  } finally { await rm(temporary, { force: true }); }
}

export async function extractDesktopArtifact(input, archive, destination) {
  const artifact = artifactSchema.parse(input);
  await verifyDesktopResource(archive, artifact.sha256);
  const temporary = await mkdtemp(path.join(path.dirname(archive), "extract-"));
  try {
    if (artifact.format === "tar.gz") {
      // Extract only the named files from a checksum-pinned upstream archive.
      await run("tar", ["-xzf", archive, "-C", temporary, "--", ...artifact.files.map(file => file.source)], { cwd: root });
    }
    const files = [];
    for (const file of artifact.files) {
      const source = artifact.format === "file" ? archive : path.join(temporary, file.source);
      const sha256 = await desktopResourceDigest(source);
      const target = path.join(destination, file.destination);
      await mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
      await copyFile(source, target);
      await chmod(target, 0o700);
      files.push({ path: file.destination, sha256 });
    }
    return files;
  } finally { await rm(temporary, { recursive: true, force: true }); }
}

function verificationEnvironment(home) {
  const environment = Object.fromEntries(["PATH", "SystemRoot", "WINDIR", "TMP", "TEMP", "TMPDIR"]
    .flatMap(key => process.env[key] === undefined ? [] : [[key, process.env[key]]]));
  return { ...environment, HOME: home, USERPROFILE: home };
}

export function desktopRuntimeVersionChecks(target, versions) {
  // agent-desktop stops same-UID legacy command hosts before parsing
  // arguments, so even --version mutates a Mac login. The pinned archive
  // checksum, exact file hashes and the release signature prove its identity
  // without launching it; keep the CLI smoke only on Windows.
  return target.startsWith("windows") ? [["agent-desktop", versions.agent_desktop]] : [];
}

export async function verifyPackagedDesktopRuntime(runtime, target, versions) {
  if (!["darwin", "win32"].includes(process.platform) || target !== desktopTarget()) return;
  const checks = desktopRuntimeVersionChecks(target, versions);
  if (checks.length === 0) return;
  const home = await mkdtemp(path.join(root, ".data/desktop/staging/verify-"));
  const suffix = target.startsWith("windows") ? ".exe" : "";
  try {
    for (const [name, expected] of checks) {
      const { stdout } = await promisify(execFile)(path.join(runtime, "bin", `${name}${suffix}`), ["--version"], {
        timeout: 10_000, maxBuffer: 16_384, env: verificationEnvironment(home),
      });
      if (!stdout.trim().endsWith(expected)) throw new Error(`Bundled ${name} version differs from the pinned release`);
    }
  } finally { await rm(home, { recursive: true, force: true }); }
}

export async function pruneDesktopDownloadCache(projectRoot, validatedManifest) {
  const cache = path.join(projectRoot, downloadCachePath);
  try {
    // shortcut: path checks assume a stable checkout during serialized packaging; concurrent moves would need descriptor-relative deletion.
    if (await realpath(cache) !== cache) return;
    const pinned = new Set(Object.values(validatedManifest.platforms).flatMap(platform =>
      platform.artifacts.map(artifact => artifact.sha256)));
    for (const name of await readdir(cache)) {
      if (!archiveDigest.test(name) || pinned.has(name)) continue;
      if (await realpath(cache) !== cache) return;
      const file = path.join(cache, name);
      if (!(await lstat(file)).isFile()) continue;
      if (await realpath(cache) !== cache) return;
      await unlink(file);
    }
  } catch {
    console.warn(`Warning: could not finish pruning ${downloadCachePath}; the prepared desktop runtime is unchanged.`);
  }
}

export async function prepareDesktopResources(target) {
  validateDesktopTarget(target);
  const manifest = parseDesktopResources(JSON.parse(await readFile(path.join(desktop, "desktop-resources.json"), "utf8")));
  const cache = path.join(root, downloadCachePath);
  await mkdir(cache, { recursive: true, mode: 0o700 });
  const stagingParent = path.join(root, ".data/desktop/staging");
  await mkdir(stagingParent, { recursive: true, mode: 0o700 });
  const staging = await mkdtemp(path.join(stagingParent, "runtime-"));
  let prepared;
  try {
    const files = [];
    const platform = manifest.platforms[target];
    for (const artifact of platform.artifacts) {
      const archive = await downloadArtifact(artifact, cache);
      files.push(...await extractDesktopArtifact(artifact, archive, staging));
    }
    await mkdir(path.join(staging, "legal"));
    await copyFile(path.join(desktop, "legal/agent-desktop-LICENSE"), path.join(staging, "legal/agent-desktop-LICENSE"));
    const runtime = {
      schema_version: 1, application: "org.linksense.desktop", target, runtime_arch: platform.runtime_arch, versions: manifest.versions, files,
    };
    const manifestBytes = Buffer.from(`${JSON.stringify(runtime, null, 2)}\n`);
    await verifyDesktopRuntimeFiles(staging, files);
    await verifyPackagedDesktopRuntime(staging, target, runtime.versions);
    await writeFile(path.join(staging, "manifest.json"), manifestBytes, { mode: 0o600 });
    if (target.startsWith("darwin/") && process.platform === "darwin") {
      // This is the distributable tree, not a user's private capability or workspace data.
      await run("/usr/bin/find", [staging, "(", "-type", "d", "-o", "-type", "f", ")",
        "-exec", "/bin/chmod", "a+rX,go-w", "{}", "+"], { cwd: root });
    }
    const destination = path.join(desktop, "resources", target.replace("/", "-"), "runtime");
    try {
      const previous = JSON.parse(await readFile(path.join(destination, "manifest.json"), "utf8"));
      if (previous.application !== "org.linksense.desktop" || previous.target !== target) throw new Error("Desktop runtime directory is unmanaged");
      await rm(destination, { recursive: true });
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
      try {
        await lstat(destination);
        throw new Error("Desktop runtime directory is unmanaged");
      } catch (missing) { if (missing?.code !== "ENOENT") throw missing; }
    }
    await mkdir(path.dirname(destination), { recursive: true });
    await rename(staging, destination);
    prepared = { runtime, manifestBytes };
  } finally { await rm(staging, { recursive: true, force: true }); }
  await pruneDesktopDownloadCache(root, manifest);
  console.log(`Prepared checksum-verified desktop runtime for ${target}`);
  return prepared;
}
