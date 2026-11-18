import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { desktopBuildServerUrl, desktopCommandInvocation, desktopTarget, desktopTestArguments, desktopUpdateBuildFlags, stageDesktopDependencyNotices, stageDesktopNotice, validateDesktopTarget } from "./desktop.mjs";

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
