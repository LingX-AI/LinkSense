import assert from "node:assert/strict";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { desktopCommandInvocation, desktopTarget, desktopTestArguments, stageDesktopNotice, validateDesktopTarget } from "./desktop.mjs";

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
