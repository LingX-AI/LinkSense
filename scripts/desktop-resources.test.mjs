import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { chmod, mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { desktopResourceDigest, extractDesktopArtifact, parseDesktopResources, verifyDesktopPackageManifest, verifyDesktopResource, verifyDesktopRuntimeFiles, verifyMacosBundlePermissions } from "./desktop-resources.mjs";

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
