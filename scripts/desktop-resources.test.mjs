import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { chmod, lstat, mkdtemp, mkdir, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { desktopTarget } from "./desktop.mjs";
import { desktopResourceDigest, desktopRuntimeVersionChecks, extractDesktopArtifact, parseDesktopResources, pruneDesktopDownloadCache, verifyDesktopPackageManifest, verifyDesktopResource, verifyDesktopRuntimeFiles, verifyMacosBundlePermissions, verifyPackagedDesktopRuntime } from "./desktop-resources.mjs";

const downloadCache = ".data/desktop/downloads";
const obsoleteDigest = "0".repeat(64);

async function downloadCacheFixture(t) {
  const directory = await mkdtemp(path.join(await realpath(tmpdir()), "linksense-desktop-cache-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const manifest = parseDesktopResources(JSON.parse(await readFile(new URL("../apps/desktop/desktop-resources.json", import.meta.url), "utf8")));
  return { directory, manifest };
}

test("desktop release manifest pins every platform and its native sandbox helpers", async () => {
  const input = JSON.parse(await readFile(new URL("../apps/desktop/desktop-resources.json", import.meta.url), "utf8"));
  const manifest = parseDesktopResources(input);
  assert.equal(manifest.versions.codex, JSON.parse(await readFile(new URL("../apps/runner/src/codex/runtime-version.json", import.meta.url), "utf8")).version);
  assert.equal(manifest.platforms["windows/arm64"].runtime_arch, "amd64");
  assert.match(manifest.platforms["windows/arm64"].artifacts.find(artifact => artifact.key === "node").url, /win-x64/u);
  for (const mutate of [
    value => { value.platforms["windows/arm64"].artifacts.pop(); },
    value => { value.platforms["darwin/arm64"].artifacts[0].files[0].destination = "../escape"; },
    value => { value.platforms["darwin/arm64"].artifacts[0].files[0].source = "/etc/passwd"; },
    value => { value.platforms["windows/arm64"].artifacts[0].files[0].destination = "bin/node.exe:stream"; },
    value => { value.platforms["darwin/arm64"].artifacts[0].url = "http://nodejs.org/insecure"; },
    value => { value.platforms["darwin/arm64"].artifacts[0].url = "https://evil.example/tool"; },
    value => { value.platforms["darwin/arm64"].artifacts[0].sha256 = "unpinned"; },
    value => { value.platforms["darwin/arm64"].artifacts[0].files[0].destination = "bin/codex"; },
    value => { value.platforms["windows/arm64"].runtime_arch = "arm64"; },
    value => { value.versions.codex = "0.169.0"; },
  ]) {
    const invalid = structuredClone(input);
    mutate(invalid);
    assert.throws(() => parseDesktopResources(invalid));
  }
});

test("desktop download cache prunes only unpinned digest files on repeated runs", async t => {
  const { directory, manifest } = await downloadCacheFixture(t);
  const cache = path.join(directory, downloadCache);
  const { platforms } = manifest;
  const keep = [
    platforms["darwin/arm64"].artifacts[0].sha256,
    platforms["darwin/amd64"].artifacts[0].sha256,
    platforms["windows/arm64"].artifacts.find(artifact => artifact.key === "codex").sha256,
    "unknown.txt", "A".repeat(64), "b".repeat(63), `${obsoleteDigest}.active.tmp`,
  ];
  const nested = path.join(cache, "1".repeat(64), "2".repeat(64));
  await mkdir(path.dirname(nested), { recursive: true });
  await writeFile(nested, "nested fixture");
  for (const name of [...keep, obsoleteDigest]) await writeFile(path.join(cache, name), name);
  const linked = path.join(cache, "3".repeat(64));
  const target = path.join(directory, "outside-cache");
  if (process.platform !== "win32") {
    await writeFile(target, "link target");
    await symlink(target, linked);
  }

  for (let attempt = 0; attempt < 2; attempt++) {
    await pruneDesktopDownloadCache(directory, manifest);
    await assert.rejects(lstat(path.join(cache, obsoleteDigest)), { code: "ENOENT" });
    for (const name of keep) assert.equal(await readFile(path.join(cache, name), "utf8"), name);
    assert.equal(await readFile(nested, "utf8"), "nested fixture");
    if (process.platform !== "win32") {
      assert.ok((await lstat(linked)).isSymbolicLink());
      assert.equal(await readFile(target, "utf8"), "link target");
    }
  }
});

if (process.platform !== "win32") {
  test("desktop download cache skips a redirected cache or ancestor", async t => {
    const { directory, manifest } = await downloadCacheFixture(t);
    for (const component of [".data", ".data/desktop", downloadCache]) {
      const name = path.basename(component);
      const project = path.join(directory, name);
      const link = path.join(project, component);
      const elsewhere = path.join(directory, "elsewhere", name);
      const redirectedCache = path.join(elsewhere, path.relative(component, downloadCache));
      await mkdir(path.dirname(link), { recursive: true });
      await mkdir(redirectedCache, { recursive: true });
      await symlink(elsewhere, link, "dir");
      const archive = path.join(redirectedCache, obsoleteDigest);
      await writeFile(archive, "redirected fixture");

      await pruneDesktopDownloadCache(project, manifest);
      assert.equal(await readFile(archive, "utf8"), "redirected fixture");
      assert.ok((await lstat(link)).isSymbolicLink());
    }
  });
}

test("desktop download cache warns once on a failed prune and can prune on the next run", async t => {
  const { directory, manifest } = await downloadCacheFixture(t);
  const cache = path.join(directory, downloadCache);
  await mkdir(path.dirname(cache), { recursive: true });
  await writeFile(cache, "not a directory");
  const warn = t.mock.method(console, "warn", () => {});

  await pruneDesktopDownloadCache(directory, manifest);
  assert.equal(await readFile(cache, "utf8"), "not a directory");
  assert.deepEqual(warn.mock.calls.map(call => call.arguments), [
    ["Warning: could not finish pruning .data/desktop/downloads; the prepared desktop runtime is unchanged."],
  ]);

  await rm(cache);
  await mkdir(cache);
  const archive = path.join(cache, obsoleteDigest);
  await writeFile(archive, "obsolete fixture");
  await pruneDesktopDownloadCache(directory, manifest);
  await assert.rejects(lstat(archive), { code: "ENOENT" });
  assert.equal(warn.mock.callCount(), 1);
});

test("package verification compares the captured manifest and exact ad hoc executable bytes", async () => {
  const runtime = await mkdtemp(path.join(tmpdir(), "linksense-desktop-manifest-"));
  try {
    const binary = path.join(runtime, "bin", "node");
    await mkdir(path.dirname(binary));
    await writeFile(binary, "original executable");
    const files = [{ path: "bin/node", sha256: await desktopResourceDigest(binary) }];
    const manifest = path.join(runtime, "manifest.json");
    const captured = Buffer.from(JSON.stringify({ files }));
    await writeFile(manifest, captured);
    await verifyDesktopPackageManifest(runtime, captured);
    await verifyDesktopRuntimeFiles(runtime, files);
    await writeFile(binary, "modified executable");
    await assert.rejects(verifyDesktopRuntimeFiles(runtime, files), /checksum mismatch/u);
    await writeFile(manifest, JSON.stringify({ files: [{ ...files[0], sha256: await desktopResourceDigest(binary) }] }));
    await assert.rejects(verifyDesktopPackageManifest(runtime, captured), /verified staged manifest/u);
  } finally {
    await rm(runtime, { recursive: true, force: true });
  }
});

if (process.platform === "darwin") {
  test("a Mac bundle rejects owner-only executables and capability data", async () => {
    const app = await mkdtemp(path.join(tmpdir(), "linksense-desktop-permissions-"));
    try {
      await chmod(app, 0o755);
      const binary = path.join(app, "node"), capability = path.join(app, "capability-snapshot.json");
      await writeFile(binary, "fixture");
      await chmod(binary, 0o744);
      await assert.rejects(verifyMacosBundlePermissions(app), /account: .*\/node$/u);
      await chmod(binary, 0o755);
      await writeFile(capability, "{}");
      await chmod(capability, 0o640);
      await assert.rejects(verifyMacosBundlePermissions(app), /account: .*\/capability-snapshot\.json$/u);
      await chmod(capability, 0o644);
      await verifyMacosBundlePermissions(app);
    } finally {
      await rm(app, { recursive: true, force: true });
    }
  });
}

test("Mac runtime verification queries Node and Codex without launching the pinned engine", async () => {
  const versions = { node: "24.99.9", codex: "9.9.9", agent_desktop: "1.3.1" };
  const names = target => desktopRuntimeVersionChecks(target, versions).map(([name]) => name);
  assert.deepEqual(names("darwin/arm64"), ["node", "codex"]);
  assert.deepEqual(names("windows/arm64"), ["node", "codex", "agent-desktop"]);
  if (process.platform !== "darwin") return;
  const runtime = await mkdtemp(path.join(tmpdir(), "linksense-desktop-runtime-"));
  try {
    await mkdir(path.join(runtime, "bin"));
    await mkdir(path.join(runtime, "runner"));
    const sentinel = path.join(runtime, "agent-desktop-launched");
    const queried = name => path.join(runtime, `${name}-queried`);
    const scripts = {
      node: `#!/bin/sh\n: > '${queried("node")}'\nif [ "$1" = "--version" ]; then echo "v${versions.node}"; else printf %s DESKTOP_RUNTIME_IMPORTS_OK; fi\n`,
      codex: `#!/bin/sh\n: > '${queried("codex")}'\necho "codex-cli ${versions.codex}"\n`,
      "agent-desktop": `#!/bin/sh\n: > '${sentinel}'\necho "agent-desktop ${versions.agent_desktop}"\n`,
    };
    for (const [name, script] of Object.entries(scripts)) {
      const file = path.join(runtime, "bin", name);
      await writeFile(file, script);
      await chmod(file, 0o700);
    }
    await mkdir(path.join(path.resolve(import.meta.dirname, ".."), ".data/desktop/staging"), { recursive: true });
    await verifyPackagedDesktopRuntime(runtime, desktopTarget(), versions);
    await readFile(queried("node"));
    await readFile(queried("codex"));
    await assert.rejects(readFile(sentinel), { code: "ENOENT" });
  } finally {
    await rm(runtime, { recursive: true, force: true });
  }
});

test("resource extraction validates checksums, omits unselected files and rejects linked binaries", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "linksense-desktop-resource-"));
  try {
    const source = path.join(directory, "source");
    const output = path.join(directory, "output");
    await mkdir(source);
    await writeFile(path.join(source, "tool"), "fixture executable\n");
    await writeFile(path.join(source, "not-selected"), "must not ship\n");
    const archive = path.join(directory, "tools.tar.gz");
    await promisify(execFile)("tar", ["-czf", archive, "-C", source, "tool", "not-selected"]);
    const sha256 = await desktopResourceDigest(archive);
    const artifact = { key: "codex", format: "tar.gz", url: "https://github.com/example/release.tar.gz",
      sha256, files: [{ source: "tool", destination: "bin/codex" }] };
    const files = await extractDesktopArtifact(artifact, archive, output);
    assert.equal(files.length, 1);
    assert.equal(await readFile(path.join(output, "bin/codex"), "utf8"), "fixture executable\n");
    await assert.rejects(readFile(path.join(output, "not-selected")), { code: "ENOENT" });
    await assert.rejects(verifyDesktopResource(archive, "0".repeat(64)), /checksum mismatch/u);
    if (process.platform !== "win32") {
      await symlink(path.join(source, "tool"), path.join(source, "linked"));
      await promisify(execFile)("tar", ["-czf", archive, "-C", source, "linked"]);
      artifact.sha256 = await desktopResourceDigest(archive);
      artifact.files = [{ source: "linked", destination: "bin/linked" }];
      await assert.rejects(extractDesktopArtifact(artifact, archive, output), /regular file/u);
    }
  } finally { await rm(directory, { recursive: true, force: true }); }
});
