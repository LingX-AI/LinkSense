import { createHash, randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { createReadStream } from "node:fs";
import { chmod, copyFile, lstat, mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { z } from "zod";
import { desktopTarget, run, validateDesktopTarget } from "./desktop.mjs";

const root = path.resolve(import.meta.dirname, "..");
const desktop = path.join(root, "apps/desktop");
const maximumBinaryBytes = 512 * 1024 * 1024;
const relativeFile = z.string().min(1).max(240).regex(/^[A-Za-z0-9][A-Za-z0-9._/-]*$/u).refine(value =>
  !value.startsWith("/") &&
  value.split("/").every(part => part !== "" && part !== "." && part !== ".."), "unsafe_resource_path");
const artifactSchema = z.strictObject({
  key: z.enum(["node", "codex", "codex-command-runner", "codex-windows-sandbox-setup", "agent-desktop"]),
  format: z.enum(["file", "tar.gz"]),
  url: z.url().refine(value => {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password &&
      !url.search && !url.hash && ["github.com", "nodejs.org"].includes(url.hostname);
  }, "untrusted_resource_origin"),
  sha256: z.string().regex(/^[0-9a-f]{64}$/u),
  files: z.array(z.strictObject({ source: relativeFile.nullable(), destination: relativeFile })).min(1).max(4),
}).refine(artifact => artifact.format === "file"
  ? artifact.files.length === 1 && artifact.files[0].source === null
  : artifact.files.every(file => file.source !== null), "resource_archive_mismatch");
const platformSchema = z.strictObject({
  runtime_arch: z.enum(["amd64", "arm64"]),
  artifacts: z.array(artifactSchema).min(3).max(5),
});
const manifestSchema = z.strictObject({
  schema_version: z.literal(1),
  versions: z.strictObject({
    node: z.string().regex(/^24\.\d+\.\d+$/u),
    codex: z.string().regex(/^\d+\.\d+\.\d+$/u),
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
    // shortcut: Windows ARM64 uses x64 Node/Codex until anydoc provides an ARM64 native binding.
    const expectedArchitecture = target === "windows/arm64" ? "amd64" : target.split("/")[1];
    if (platform.runtime_arch !== expectedArchitecture) throw new Error("Desktop runtime architecture is unsupported");
    const keys = artifacts.map(artifact => artifact.key).sort();
    const required = target.startsWith("windows")
      ? ["agent-desktop", "codex", "codex-command-runner", "codex-windows-sandbox-setup", "node"]
      : ["agent-desktop", "codex", "node"];
    if (JSON.stringify(keys) !== JSON.stringify(required)) throw new Error("Desktop runtime resources are incomplete or duplicated");
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
      const origin = artifact.key === "node" ? `https://nodejs.org/dist/v${manifest.versions.node}/`
        : artifact.key === "agent-desktop" ? `https://github.com/vercel-labs/agent-desktop/releases/download/v${manifest.versions.agent_desktop}/`
        : `https://github.com/openai/codex/releases/download/rust-v${manifest.versions.codex}/`;
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

async function stageDesktopRunner(destination, target, runtimeArchitecture) {
  // mygo excludes dot-prefixed resource directories, including pnpm's isolated store.
  await run("pnpm", ["--filter", "@linksense/runner", "deploy", "--prod", "--frozen-lockfile",
    "--ignore-scripts", "--node-linker=hoisted", "--config.inject-workspace-packages=true",
    "--os", target.startsWith("windows") ? "win32" : "darwin",
    "--cpu", runtimeArchitecture === "amd64" ? "x64" : "arm64", destination], { cwd: root });
  // Deployment metadata contains build-machine file URLs; the installed runtime never reinstalls dependencies.
  await copyFile(path.join(root, "apps/runner/package.json"), path.join(destination, "package.json"));
  await rm(path.join(destination, "pnpm-lock.yaml"), { force: true });
}

function verificationEnvironment(home) {
  const environment = Object.fromEntries(["PATH", "SystemRoot", "WINDIR", "TMP", "TEMP", "TMPDIR"]
    .flatMap(key => process.env[key] === undefined ? [] : [[key, process.env[key]]]));
  return { ...environment, HOME: home, USERPROFILE: home, CODEX_HOME: path.join(home, ".codex") };
}

export async function verifyPackagedDesktopRuntime(runtime, target, versions) {
  if (!["darwin", "win32"].includes(process.platform) || target !== desktopTarget()) return;
  const home = await mkdtemp(path.join(root, ".data/desktop/staging/verify-"));
  const suffix = target.startsWith("windows") ? ".exe" : "";
  try {
    const environment = verificationEnvironment(home);
    for (const [name, expected] of [["node", versions.node], ["codex", versions.codex], ["agent-desktop", versions.agent_desktop]]) {
      const { stdout } = await promisify(execFile)(path.join(runtime, "bin", `${name}${suffix}`), ["--version"], {
        timeout: 10_000, maxBuffer: 16_384, env: environment,
      });
      if (!stdout.trim().endsWith(expected)) throw new Error(`Bundled ${name} version differs from the pinned release`);
    }
    const probe = `import {realpathSync} from "node:fs"; import path from "node:path"; import {fileURLToPath} from "node:url";
      const root = realpathSync(process.argv[1]);
      for (const name of ["zod", "fastify", "@linksense/shared", "sharp", "@firecrawl/anydoc"]) {
        const relative = path.relative(root, realpathSync(fileURLToPath(import.meta.resolve(name))));
        if (path.isAbsolute(relative) || relative === ".." || relative.startsWith(".." + path.sep)) throw new Error("Dependency escaped the packaged runtime");
        await import(name);
      } process.stdout.write("DESKTOP_RUNTIME_IMPORTS_OK");`;
    const { stdout } = await promisify(execFile)(path.join(runtime, "bin", `node${suffix}`), ["--input-type=module", "--eval", probe, runtime], {
      cwd: path.join(runtime, "runner"), timeout: 30_000, maxBuffer: 16_384, env: environment,
    });
    if (stdout !== "DESKTOP_RUNTIME_IMPORTS_OK") throw new Error("Packaged desktop runner dependency probe failed");
  } finally { await rm(home, { recursive: true, force: true }); }
}

export async function prepareDesktopResources(target) {
  validateDesktopTarget(target);
  const manifest = parseDesktopResources(JSON.parse(await readFile(path.join(desktop, "desktop-resources.json"), "utf8")));
  const pinnedCodex = JSON.parse(await readFile(path.join(root, "apps/runner/src/codex/runtime-version.json"), "utf8"));
  if (manifest.versions.codex !== pinnedCodex.version) throw new Error("Desktop and cloud Codex versions differ");
  const cache = path.join(root, ".data/desktop/downloads");
  await mkdir(cache, { recursive: true, mode: 0o700 });
  const stagingParent = path.join(root, ".data/desktop/staging");
  await mkdir(stagingParent, { recursive: true, mode: 0o700 });
  const staging = await mkdtemp(path.join(stagingParent, "runtime-"));
  try {
    const files = [];
    const platform = manifest.platforms[target];
    for (const artifact of platform.artifacts) {
      const archive = await downloadArtifact(artifact, cache);
      files.push(...await extractDesktopArtifact(artifact, archive, staging));
    }
    await run("pnpm", ["--filter", "@linksense/shared", "build"], { cwd: root });
    await run("pnpm", ["--filter", "@linksense/runner", "build"], { cwd: root });
    if (target.startsWith("darwin")) {
      await run("pnpm", ["--filter", "@linksense/api", "exec", "tsx", "src/commands/bundle-desktop-capabilities.ts",
        path.join(staging, "capabilities")], { cwd: root });
    }
    await stageDesktopRunner(path.join(staging, "runner"), target, platform.runtime_arch);
    await mkdir(path.join(staging, "template"));
    await copyFile(path.join(root, "deploy/codex-home-template/config.toml"), path.join(staging, "template/config.toml"));
    await mkdir(path.join(staging, "legal"));
    for (const name of ["node", "codex", "agent-desktop"]) {
      await copyFile(path.join(desktop, "legal", `${name}-LICENSE`), path.join(staging, "legal", `${name}-LICENSE`));
    }
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
    console.log(`Prepared checksum-verified desktop runtime for ${target}`);
    return { runtime, manifestBytes };
  } finally { await rm(staging, { recursive: true, force: true }); }
}
