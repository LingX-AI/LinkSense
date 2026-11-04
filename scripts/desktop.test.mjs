import { test } from "node:test";
import assert from "node:assert/strict";
import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { desktopRelease, desktopReleaseArtifacts, desktopTestArguments, stageDesktopInstaller, stageDesktopNotices, validateDesktopArchive } from "./desktop.mjs";

test("pins native release digests and accepts only each platform's expected executables", () => {
  for (const release of Object.values(desktopRelease)) {
    assert.match(release.sha256, /^[0-9a-f]{64}$/);
    assert.match(release.file, /^agent-desktop-v1\.0\.2-.*\.tar\.gz$/);
  }
  assert.equal(validateDesktopArchive("agent-desktop\nagent-desktop-macos-helper\n"), true);
  assert.equal(validateDesktopArchive("agent-desktop.exe\n", desktopRelease["win32-x64"].entries), true);
  assert.equal(validateDesktopArchive("agent-desktop\nagent-desktop-macos-helper\n", desktopRelease["win32-x64"].entries), false);
  for (const entries of [
    "../agent-desktop\nagent-desktop-macos-helper", "/agent-desktop\nagent-desktop-macos-helper",
    "agent-desktop\nagent-desktop-macos-helper\nextra", "agent-desktop",
  ]) assert.equal(validateDesktopArchive(entries), false);
});

test("packages product notices and the native runtime licenses with the desktop client", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "linksense-desktop-legal-"));
  try {
    await stageDesktopNotices(directory);
    assert.equal(await readFile(path.join(directory, "LICENSE"), "utf8"), await readFile("LICENSE", "utf8"));
    assert.equal(await readFile(path.join(directory, "NOTICE"), "utf8"), await readFile("NOTICE", "utf8"));
    const notices = await readFile(path.join(directory, "DESKTOP-THIRD-PARTY-NOTICES.txt"), "utf8");
    for (const component of ["agent-desktop", "MyGo", "purego", "typesetting", "golang.org/x/image", "golang.org/x/net", "golang.org/x/text", "Lucide", "Go runtime"]) {
      assert.ok(notices.includes(component), `missing ${component} license`);
    }
    assert.match(notices, /Apache License/);
    assert.match(notices, /Permission is hereby granted/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("ships a square app icon with the native client", async () => {
  const config = JSON.parse(await readFile("apps/desktop/mygo.json", "utf8"));
  assert.equal(config.icon, "assets/app-icon.png");
  await access(path.resolve("apps/desktop", config.icon));
});

test("declares the Windows engine with its installable executable name", () => {
  for (const target of ["win32-x64", "win32-arm64"]) {
    assert.deepEqual(desktopRelease[target].entries, ["agent-desktop.exe"]);
    assert.match(desktopRelease[target].file, /windows-msvc\.tar\.gz$/u);
  }
});

test("runs tests on Windows ARM64 without Go's unsupported race detector", () => {
  assert.deepEqual(desktopTestArguments("win32", "arm64"), ["test", "./..."]);
  for (const [platform, arch] of [["win32", "x64"], ["darwin", "arm64"], ["darwin", "x64"]]) {
    assert.deepEqual(desktopTestArguments(platform, arch), ["test", "-race", "./..."]);
  }
});

test("maps Windows x64 and ARM64 builds to their installer and download name", () => {
  assert.deepEqual(desktopReleaseArtifacts("win32", "x64"), {
    goTarget: "windows/amd64",
    source: path.join("apps", "desktop", "build", "windows-amd64", "linksense-helper-setup-0.1.0-amd64.exe"),
    output: "LinkSense-Desktop-windows.exe",
  });
  assert.deepEqual(desktopReleaseArtifacts("win32", "arm64"), {
    goTarget: "windows/arm64",
    source: path.join("apps", "desktop", "build", "windows-arm64", "linksense-helper-setup-0.1.0-arm64.exe"),
    output: "LinkSense-Desktop-windows.exe",
  });
  assert.equal(desktopReleaseArtifacts("darwin", "arm64")?.goTarget, "darwin/arm64");
  assert.equal(desktopReleaseArtifacts("darwin", "x64")?.goTarget, "darwin/amd64");
  assert.equal(desktopReleaseArtifacts("linux", "x64"), null);
});

test("refuses a missing Windows installer even when the standalone executable exists", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "linksense-desktop-installer-"));
  try {
    await writeFile(path.join(directory, "LinkSense helper.exe"), "standalone client without resources");
    const output = path.join(directory, "LinkSense-Desktop-windows.exe");
    await assert.rejects(stageDesktopInstaller(
      path.join(directory, "linksense-helper-setup-0.1.0-amd64.exe"), output,
    ), { code: "ENOENT" });
    await assert.rejects(access(output), { code: "ENOENT" });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("stages the complete Windows installer and rejects an empty artifact", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "linksense-desktop-installer-"));
  try {
    const source = path.join(directory, "setup.exe");
    const output = path.join(directory, "LinkSense-Desktop-windows.exe");
    await writeFile(source, "installer with bundled resources");
    await stageDesktopInstaller(source, output);
    assert.equal(await readFile(output, "utf8"), "installer with bundled resources");
    await writeFile(source, "");
    await assert.rejects(stageDesktopInstaller(source, output), /installer/i);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
