import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { copyFile, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { z } from "zod";
import { desktopTarget } from "./desktop.mjs";
import { extractDesktopArtifact, parseDesktopResources, verifyDesktopResource } from "./desktop-resources.mjs";

const fixtureTitle = "LinkSense AX Whitebox";
const engineFiles = ["bin/agent-desktop", "bin/agent-desktop-macos-helper"];

const fixtureSource = `
import AppKit

final class Actions: NSObject {
  @objc func apply() {
    guard let output = UserDefaults.standard.string(forKey: "LinkSenseWhiteboxOutput") else { exit(1) }
    do {
      try field.stringValue.write(toFile: output, atomically: true, encoding: .utf8)
      result.stringValue = "Applied: " + field.stringValue
    } catch { exit(1) }
  }
}

final class FixtureWindow: NSWindow {
  override var canBecomeKey: Bool { false }
}

let app = NSApplication.shared
app.setActivationPolicy(.accessory)
let window = FixtureWindow(contentRect: NSRect(x: 100, y: 100, width: 480, height: 180),
  styleMask: [.titled, .closable], backing: .buffered, defer: false)
window.title = "${fixtureTitle}"
let field = NSTextField(frame: NSRect(x: 20, y: 110, width: 440, height: 28))
field.setAccessibilityLabel("Whitebox input")
let actions = Actions()
let button = NSButton(title: "Apply whitebox input", target: actions, action: #selector(Actions.apply))
button.frame = NSRect(x: 20, y: 60, width: 440, height: 32)
let result = NSTextField(labelWithString: "Waiting for whitebox input")
result.frame = NSRect(x: 20, y: 20, width: 440, height: 28)
for view in [field, button, result] { window.contentView!.addSubview(view) }
window.orderFrontRegardless()
Timer.scheduledTimer(withTimeInterval: 90, repeats: false) { _ in app.terminate(nil) }
withExtendedLifetime([window, field, button, result, actions]) { app.run() }
`;

const execFileAsync = promisify(execFile);
const envelope = z.object({ ok: z.literal(true), data: z.unknown() });
const diagnosticCode = z.string().regex(/^[A-Za-z0-9_-]{1,96}$/u);
const failure = z.object({
  ok: z.literal(false),
  error: z.object({ code: diagnosticCode, details: z.object({ kind: diagnosticCode.optional() }).optional() }),
});
const windowList = z.array(z.object({ id: z.string().min(1), pid: z.number().int().positive(), title: z.string() }));
const element = z.lazy(() => z.object({
  role: z.string(), name: z.string().optional(), value: z.unknown().optional(),
  ref_id: z.string().regex(/^@s[a-z0-9]+:e[0-9]+$/u).optional(),
  children: z.array(element).default([]),
}));
const snapshot = z.object({
  complete: z.literal(true), window: z.object({ id: z.string(), title: z.literal(fixtureTitle) }), tree: element,
});

function decodeJSON(text) {
  try { return JSON.parse(text); }
  catch { return undefined; }
}

function nodes(tree) {
  return [tree, ...tree.children.flatMap(nodes)];
}

async function main() {
  if (process.platform !== "darwin") throw new Error("The native AX whitebox requires macOS");
  const root = path.resolve(import.meta.dirname, "..");
  const target = desktopTarget();
  const runtime = path.join(root, "apps/desktop/resources", target.replace("/", "-"), "runtime");
  const release = parseDesktopResources(JSON.parse(await readFile(path.join(root, "apps/desktop/desktop-resources.json"), "utf8")));
  const manifest = z.object({
    schema_version: z.literal(1),
    application: z.literal("org.linksense.desktop"),
    target: z.literal(target),
    versions: z.object({ agent_desktop: z.literal(release.versions.agent_desktop) }),
    files: z.array(z.object({ path: z.string(), sha256: z.string().regex(/^[a-f0-9]{64}$/u) })),
  }).parse(JSON.parse(await readFile(path.join(runtime, "manifest.json"), "utf8")));
  const artifact = release.platforms[target].artifacts.find(item => item.key === "agent-desktop");
  assert.ok(artifact, "The release must pin an agent-desktop archive");
  const directory = await mkdtemp(path.join(tmpdir(), "linksense-ax-whitebox-"));
  const engine = path.join(directory, engineFiles[0]);
  const identifier = `org.linksense.desktop.ax-whitebox.${randomUUID()}`;
  const appName = `LinkSense AX ${randomUUID().slice(0, 8)}`;
  const interruption = new AbortController();
  const interrupt = () => interruption.abort(new Error("Native AX whitebox interrupted"));
  const deadline = setTimeout(() => interruption.abort(new Error("Native AX whitebox exceeded 90 seconds")), 90_000);
  for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, interrupt);
  const environment = { PATH: "/usr/bin:/bin:/usr/sbin:/sbin", TMPDIR: directory };
  const commandOptions = { signal: interruption.signal, killSignal: "SIGKILL", env: environment };
  const engineOptions = {
    ...commandOptions,
    env: {
      ...environment,
      AGENT_DESKTOP_HOME: path.join(directory, "engine"),
      AGENT_DESKTOP_MACOS_HELPER_PATH: path.join(directory, engineFiles[1]),
    },
  };
  const call = async args => {
    let output;
    try {
      output = await execFileAsync(engine, args, {
        ...engineOptions, timeout: 15_000, maxBuffer: 1_048_576,
      });
    } catch (error) {
      interruption.signal.throwIfAborted();
      const result = failure.safeParse(decodeJSON(error.stdout));
      if (!error.killed && Number.isInteger(error.code) && result.success) {
        const { code, details } = result.data.error;
        throw new Error(`agent-desktop ${args[0]}: ${code}${details?.kind ? ` / ${details.kind}` : ""}`);
      }
      throw new Error(`agent-desktop ${args[0]} failed (${error.signal ?? error.code ?? "unknown error"})`);
    }
    const result = envelope.safeParse(decodeJSON(output.stdout));
    if (!result.success) throw new Error(`agent-desktop ${args[0]} returned an invalid response`);
    return result.data.data;
  };
  let app;
  let appOutcome;
  let failed = false;
  try {
    const session = await execFileAsync("xcrun", ["swift", "-e", `
      import ApplicationServices
      guard let session = CGSessionCopyCurrentDictionary() as? [String: Any],
        session[kCGSessionOnConsoleKey as String] as? Bool == true,
        session[kCGSessionUserIDKey as String] as? Int == Int(geteuid())
        else { print("unavailable"); exit(0) }
      print(session["CGSSessionScreenIsLocked"] as? Bool == true ? "locked" : "unlocked")
    `], { ...commandOptions, timeout: 10_000 });
    const sessionState = z.enum(["locked", "unlocked", "unavailable"]).parse(session.stdout.trim());
    if (sessionState === "locked") {
      throw new Error("NATIVE_GUI_SESSION_LOCKED: Unlock this Mac, then rerun desktop:whitebox:engine");
    }
    if (sessionState === "unavailable") {
      throw new Error("NATIVE_GUI_SESSION_UNAVAILABLE: Run desktop:whitebox:engine in an interactive macOS session");
    }
    const archive = path.join(directory, "agent-desktop.tar.gz");
    await copyFile(path.join(root, ".data/desktop/downloads", artifact.sha256), archive);
    const extracted = await extractDesktopArtifact(artifact, archive, directory);
    for (const name of engineFiles) {
      const expected = extracted.find(item => item.path === name);
      assert.ok(expected, `Pinned ${name} is missing`);
      const prepared = manifest.files.filter(item => item.path === name);
      assert.deepEqual(prepared, [expected], `Prepared ${name} does not match the pinned release`);
      await verifyDesktopResource(path.join(runtime, name), expected.sha256);
    }
    const { stdout: processes } = await execFileAsync("/bin/ps", [
      "-ww", "-x", "-u", String(process.geteuid()), "-o", "comm=",
    ], { ...commandOptions, timeout: 5_000 });
    if (processes.split("\n").some(line => /^agent[-_]desktop(?:$|[-_])/u.test(path.basename(line.trim())))) {
      throw new Error("NATIVE_AX_ENGINE_BUSY: Run this test in an isolated macOS login without other agent-desktop processes");
    }
    const version = await execFileAsync(engine, ["--version"], { ...engineOptions, timeout: 10_000 });
    assert.equal(version.stdout.trim(), `agent-desktop ${release.versions.agent_desktop}`);
    const permissions = z.object({
      accessibility: z.object({ state: z.literal("granted") }),
    }).parse(await call(["permissions"]));
    assert.equal(permissions.accessibility.state, "granted");
    const bundle = path.join(directory, `${appName}.app`);
    const contents = path.join(bundle, "Contents");
    const executable = path.join(contents, "MacOS", "LinkSenseAXWhitebox");
    const source = path.join(directory, "fixture.swift");
    const state = path.join(directory, "applied.txt");
    await mkdir(path.dirname(executable), { recursive: true });
    await writeFile(path.join(contents, "Info.plist"), `<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0"><dict>
<key>CFBundleIdentifier</key><string>${identifier}</string>
<key>CFBundleExecutable</key><string>LinkSenseAXWhitebox</string>
<key>CFBundleName</key><string>${appName}</string>
<key>CFBundleDisplayName</key><string>${appName}</string>
<key>CFBundleVersion</key><string>1</string>
<key>CFBundlePackageType</key><string>APPL</string>
</dict></plist>`);
    await writeFile(source, fixtureSource);
    await execFileAsync("xcrun", [
      "swiftc", "-target", `${process.arch === "arm64" ? "arm64" : "x86_64"}-apple-macos13.0`,
      source, "-o", executable,
    ], { ...commandOptions, timeout: 30_000 });
    await execFileAsync("codesign", ["--force", "--sign", "-", bundle], { ...commandOptions, timeout: 10_000 });
    app = execFileAsync(executable, ["-LinkSenseWhiteboxOutput", state],
      { ...commandOptions, timeout: 90_000 });
    appOutcome = app.then(() => null, error => error);
    await call(["wait", "--app", appName, "--window", fixtureTitle, "--timeout", "10000"]);
    const windows = windowList.parse(await call(["list-windows", "--app", appName]));
    const owned = windows.filter(window => window.pid === app.child.pid && window.title === fixtureTitle);
    assert.equal(owned.length, 1, "Exactly one window must belong to the spawned fixture");
    const windowId = owned[0].id;
    const observe = async () => {
      const result = snapshot.parse(await call(["snapshot", "--app", appName, "--window-id", windowId]));
      assert.equal(result.window.id, windowId, "The snapshot must belong to the spawned fixture");
      return result;
    };
    let observed = await observe();
    const fields = nodes(observed.tree).filter(node => node.role === "textfield" && node.name === "Whitebox input");
    assert.equal(fields.length, 1, "The isolated fixture must expose exactly one input");
    assert.ok(fields[0].ref_id);
    const text = "LinkSense AX 白盒 123";
    await call(["type", fields[0].ref_id, text]);
    observed = await observe();
    const buttons = nodes(observed.tree).filter(node => node.role === "button" && node.name === "Apply whitebox input");
    assert.equal(buttons.length, 1, "The isolated fixture must expose exactly one apply action");
    assert.ok(buttons[0].ref_id);
    await call(["click", buttons[0].ref_id]);
    assert.ok(await readFile(state, "utf8") === text, "AX type and click must reach the actual application");
    observed = await observe();
    assert.ok(nodes(observed.tree).some(node => node.name === `Applied: ${text}` || node.value === `Applied: ${text}`),
      "A fresh AX snapshot must confirm the action's visible result");
    assert.equal(app.child.exitCode, null, "The fixture exited before the test completed");
    assert.equal(app.child.signalCode, null, "The fixture was terminated before the test completed");
    interruption.signal.throwIfAborted();
  } catch (error) {
    failed = true;
    if (app && (app.child.exitCode !== null || app.child.signalCode !== null)) {
      console.error(`Fixture exited unexpectedly (${app.child.signalCode ?? app.child.exitCode})`);
    }
    interruption.signal.throwIfAborted();
    throw error;
  } finally {
    if (app?.child.exitCode === null && app.child.signalCode === null) app.child.kill("SIGKILL");
    if (appOutcome) await appOutcome;
    try {
      await rm(directory, { recursive: true, force: true });
    } catch (error) {
      if (!failed) throw error;
      console.error(`Native AX whitebox could not remove its temporary directory (${error.code ?? "unknown error"})`);
    } finally {
      clearTimeout(deadline);
      for (const signal of ["SIGINT", "SIGTERM"]) process.off(signal, interrupt);
    }
  }
  interruption.signal.throwIfAborted();
  console.log(`PASS: staged macOS ${target.split("/")[1]} agent-desktop ${release.versions.agent_desktop}: snapshot, Unicode type, semantic click and observed effect`);
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : "Native AX whitebox failed");
  if (error.signal) console.error(`Process terminated with ${error.signal}`);
  process.exitCode = 1;
});
