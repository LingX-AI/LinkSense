import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, readdir, realpath, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { desktopBuildServerUrl, desktopCommandInvocation, desktopMacosReleaseTeam, desktopMacosSigningRequirement, desktopTarget, desktopTestArguments, desktopUpdateBuildFlags, stageDesktopDependencyNotices, stageDesktopMacosRelease, stageDesktopNotice, validateDesktopTarget } from "./desktop.mjs";
import { buildDesktopAnnotationPreload, desktopAnnotationPreloadOutput } from "./desktop-preload.mjs";

test("release builds require an explicit, safe server origin", () => {
  assert.equal(desktopBuildServerUrl("https://example.com/"), "https://example.com");
  assert.equal(desktopBuildServerUrl("https://example.com:443/"), "https://example.com:443");
  assert.equal(desktopBuildServerUrl("http://localhost:80"), "http://localhost:80");
  assert.equal(desktopBuildServerUrl("http://127.0.0.1:4000"), "http://127.0.0.1:4000");
  for (const raw of [undefined, "", "http://example.com", "https://user:pass@example.com",
    "https://example.com/path", "https://example.com?token=secret", "https://example.com#",
    "https://example.com -X main.other=value", "https://exa'mple.com"]) {
    assert.throws(() => desktopBuildServerUrl(raw));
  }
});

test("update checks require a packaged HTTPS feed paired with an Ed25519 public key", () => {
  const key = Buffer.alloc(32, 1).toString("base64");
  const feed = "https://updates.example.test/update-darwin-arm64.json";
  assert.equal(desktopUpdateBuildFlags(undefined, undefined), "");
  assert.match(desktopUpdateBuildFlags(feed, key), /packageUpdateFeed=https:\/\/updates\.example\.test/u);
  for (const [url, publicKey] of [[feed, undefined], [undefined, key], [feed, "invalid"],
    ["https://user@updates.example.test/update.json", key], ["http://updates.example.test", key],
    [feed + " -X main.host=other", key]]) {
    assert.throws(() => desktopUpdateBuildFlags(url, publicKey));
  }
});

test("macOS release requires native ARM64, HTTPS and an explicit Developer ID team", () => {
  const server = "https://example.test";
  const identity = "Developer ID Application: Fixture (ABCDE12345)";
  assert.equal(desktopMacosReleaseTeam("darwin/arm64", server, identity, "darwin", "arm64"), "ABCDE12345");
  for (const [target, platform, arch] of [
    ["darwin/amd64", "darwin", "arm64"], ["darwin/amd64", "darwin", "x64"],
    ["darwin/arm64", "darwin", "x64"], ["darwin/arm64", "win32", "arm64"],
  ]) assert.throws(() => desktopMacosReleaseTeam(target, server, identity, platform, arch), /native Apple silicon/u);
  for (const invalid of [undefined, "-", "Apple Development: Fixture (ABCDE12345)", identity + "\n",
    "Developer ID Application: Fixture (abcde12345)"]) {
    assert.throws(() => desktopMacosReleaseTeam("darwin/arm64", server, invalid, "darwin", "arm64"), /Developer ID Application/u);
  }
  assert.throws(() => desktopMacosReleaseTeam("darwin/arm64", "http://localhost", identity, "darwin", "arm64"), /HTTPS/u);
});

test("MyGo scopes notarization and Node's entitlement override to release builds", () => {
  const configFile = new URL("../apps/desktop/mygo.config.ts", import.meta.url).href;
  const inspect = (release, command) => JSON.parse(execFileSync(process.execPath, ["--input-type=module", "-e",
    `import config from ${JSON.stringify(configFile)}; console.log(JSON.stringify(config({ command: ${JSON.stringify(command)} })));`],
    { env: { ...process.env, LINKSENSE_DESKTOP_MACOS_RELEASE: release }, encoding: "utf8" }));
  const development = inspect("0", "build");
  assert.deepEqual(inspect("1", "dev"), development);
  assert.equal(development.identifier, "org.linksense.desktop");
  assert.deepEqual(development.urlSchemes, ["linksense-desktop"]);
  assert.deepEqual(development.macos, { icon: "AppIcon.icns", signingIdentity: "-" });
  const release = inspect("1", "build");
  assert.deepEqual(release.macos, {
    icon: "AppIcon.icns",
    signingIdentity: "-",
    notarize: { keychainProfile: "linksense-desktop-notary" },
    helperEntitlements: { "runtime/bin/node": "node-release.entitlements.plist" },
  });
});

test("a failed release gate preserves prior artifacts and does not expose a failed release", async () => {
  const build = await mkdtemp(path.join(tmpdir(), "linksense-release-output-"));
  try {
    await mkdir(path.join(build, "darwin-arm64"));
    const old = await stageDesktopMacosRelease(build, stage => writeFile(path.join(stage, "fixture"), "previous"));
    await assert.rejects(stageDesktopMacosRelease(build, async stage => {
      await writeFile(path.join(stage, "fixture"), "failed");
      throw new Error("smoke failed");
    }), /smoke failed/u);
    const current = await stageDesktopMacosRelease(build, stage => writeFile(path.join(stage, "fixture"), "verified"));
    assert.deepEqual((await readdir(build)).sort(), ["darwin-arm64", path.basename(old), path.basename(current)].sort());
    assert.equal(await readFile(path.join(old, "fixture"), "utf8"), "previous");
    assert.equal(await readFile(path.join(current, "fixture"), "utf8"), "verified");
  } finally {
    await rm(build, { recursive: true, force: true });
  }
});

if (process.platform === "darwin") {
  test("Apple compiles the Developer ID requirement with bundle identity, team and no debugger entitlement", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "linksense-desktop-requirement-"));
    try {
      const output = path.join(directory, "release.req");
      const requirement = desktopMacosSigningRequirement("ABCDE12345", "org.linksense.desktop");
      execFileSync("/usr/bin/csreq", ["-r", `=${requirement}`, "-b", output]);
      const canonical = execFileSync("/usr/bin/csreq", ["-r", output, "-t"], { encoding: "utf8" });
      assert.match(canonical, /identifier "org\.linksense\.desktop"/u);
      assert.match(canonical, /certificate leaf\[subject\.OU\] = ABCDE12345/u);
      assert.match(canonical, /! entitlement\["com\.apple\.security\.get-task-allow"\]/u);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
}

test("desktop targets cover both supported platforms and architectures", () => {
  assert.equal(desktopTarget("darwin", "arm64"), "darwin/arm64");
  assert.equal(desktopTarget("darwin", "x64"), "darwin/amd64");
  assert.equal(desktopTarget("win32", "x64"), "windows/amd64");
  assert.equal(desktopTarget("win32", "arm64"), "windows/arm64");
  assert.throws(() => desktopTarget("linux", "x64"));
  assert.throws(() => desktopTarget("darwin", "unknown"));
  assert.throws(() => validateDesktopTarget("linux/amd64"));
  assert.throws(() => validateDesktopTarget("../../other"));
});

test("the annotation preload is a Mac-only platform resource", () => {
  assert.equal(
    desktopAnnotationPreloadOutput("/repo"),
    path.join("/repo", "apps/desktop/resources/darwin/application-annotation-preload.js"),
  );
});

if (process.platform !== "win32") {
  test("a restrictive umask cannot ship an unreadable annotation preload", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "linksense-desktop-preload-"));
    const fixture = path.join(directory, "repo");
    const web = path.join(fixture, "apps/web");
    try {
      const vite = await realpath(path.join(import.meta.dirname, "../apps/web/node_modules/vite"));
      await mkdir(path.join(web, "src/features/applications"), { recursive: true });
      await writeFile(path.join(web, "package.json"), "{}\n");
      await mkdir(path.join(web, "node_modules"));
      await symlink(vite, path.join(web, "node_modules/vite"), "dir");
      await writeFile(path.join(web, "src/features/applications/application-annotation-preload.ts"),
        'document.documentElement.dataset.annotationPreload = "ready";\n');
      const output = desktopAnnotationPreloadOutput(fixture);
      await mkdir(path.dirname(output), { recursive: true });
      // A prior restrictive build leaves the generated bundle unreadable; Vite
      // keeps its mode when it overwrites the file.
      await writeFile(output, "stale preload\n", { mode: 0o600 });
      const umask = process.umask(0o077);
      try {
        await buildDesktopAnnotationPreload(fixture);
      } finally {
        process.umask(umask);
      }
      assert.equal((await stat(output)).mode & 0o777, 0o644);
      assert.match(await readFile(output, "utf8"), /annotationPreload/u);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
}

test("Windows ARM64 uses supported test flags without weakening other targets", () => {
  assert.deepEqual(desktopTestArguments("win32", "arm64"), ["test", "-count=1", "./..."]);
  assert.ok(desktopTestArguments("darwin", "arm64").includes("-race"));
  assert.ok(desktopTestArguments("win32", "x64").includes("-race"));
});

test("Windows invokes the pnpm JavaScript launcher without a command shell", () => {
  const launcher = "C:\\Program Files\\pnpm\\pnpm.cjs";
  assert.deepEqual(desktopCommandInvocation("pnpm.cmd", ["build", "path & spaces"], "win32", { npm_execpath: launcher }), {
    command: process.execPath, args: [launcher, "build", "path & spaces"],
  });
  assert.throws(() => desktopCommandInvocation("pnpm.cmd", [], "win32", {}), /through pnpm/u);
});

test("pnpm's native distribution executes directly instead of being parsed as JavaScript", () => {
  for (const launcher of ["/tools/pnpm", "C:\\tools\\pnpm.exe"]) {
    assert.deepEqual(desktopCommandInvocation("pnpm", ["build"], "darwin", { npm_execpath: launcher }), {
      command: launcher, args: ["build"],
    });
  }
});

test("repeated builds refresh notices copied from read-only Go module files", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "linksense-desktop-notice-"));
  try {
    const source = path.join(directory, "module-LICENSE");
    const destination = path.join(directory, "bundled-LICENSE");
    await writeFile(source, "upstream license\n", { mode: 0o444 });
    await stageDesktopNotice(source, destination);
    await chmod(destination, 0o444);
    await stageDesktopNotice(source, destination);
    assert.equal(await readFile(destination, "utf8"), "upstream license\n");
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("macOS packaging includes notices for linked dependencies, not unused tools or stale modules", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "linksense-desktop-notice-graph-"));
  const output = path.join(directory, "notices");
  try {
    await writeFile(path.join(directory, "go.mod"), `module fixture.test/desktop
go 1.27.3
require (
  fixture.test/runtime v0.0.0
  fixture.test/tooling v0.0.0
)
replace fixture.test/runtime => ./runtime
replace fixture.test/tooling => ./tooling
`);
    await writeFile(path.join(directory, "main.go"), `package main
import _ "fixture.test/runtime"
func main() {}
`);
    for (const name of ["runtime", "tooling"]) {
      const module = path.join(directory, name);
      await mkdir(module);
      await writeFile(path.join(module, "go.mod"), `module fixture.test/${name}\ngo 1.27.3\n`);
      await writeFile(path.join(module, "module.go"), `package ${name}\n`);
      await writeFile(path.join(module, "LICENSE"), `${name} license\n`);
    }
    await mkdir(path.join(output, "fixture.test", "stale"), { recursive: true });
    await stageDesktopDependencyNotices("darwin/arm64", output, directory);
    assert.deepEqual(await readdir(path.join(output, "fixture.test")), ["runtime"]);
    assert.equal(await readFile(path.join(output, "fixture.test/runtime/LICENSE"), "utf8"), "runtime license\n");
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("desktop native locales have matching nonempty keys", async () => {
  const directory = path.resolve(import.meta.dirname, "../apps/desktop/locales");
  const locales = ["zh-CN", "en-US", "es-ES", "pt-BR", "fr-FR", "ja-JP"];
  const catalogs = await Promise.all(locales.map(async locale =>
    JSON.parse(await readFile(path.join(directory, `${locale}.json`), "utf8"))));
  const keys = Object.keys(catalogs[0]).sort();
  for (const catalog of catalogs) {
    assert.deepEqual(Object.keys(catalog).sort(), keys);
    for (const value of Object.values(catalog)) assert.ok(typeof value === "string" && value.trim());
  }
});
