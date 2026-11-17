import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { run } from "./desktop.mjs";

// Target a running test bundle explicitly without registering a default URL handler.
const dispatcher = `
import AppKit

guard CommandLine.arguments.count == 3,
      let pid = Int32(CommandLine.arguments[2]),
      let runningApp = NSRunningApplication(processIdentifier: pid),
      let runningBundle = runningApp.bundleURL,
      let input = readLine(), let callback = URL(string: input),
      callback.scheme == "linksense-desktop", callback.host == "auth",
      callback.path == "/callback" else { exit(1) }
let bundle = URL(fileURLWithPath: CommandLine.arguments[1], isDirectory: true)
guard runningBundle.resolvingSymlinksInPath().path == bundle.resolvingSymlinksInPath().path
  else { exit(1) }
let configuration = NSWorkspace.OpenConfiguration()
configuration.activates = true
NSWorkspace.shared.open([callback], withApplicationAt: bundle, configuration: configuration) { app, error in
  exit(error == nil && app?.processIdentifier == pid ? 0 : 1)
}
RunLoop.main.run()
`;

const root = path.resolve(import.meta.dirname, "..");
const execFileAsync = promisify(execFile);

async function main() {
  if (process.platform !== "darwin") throw new Error("The system-browser whitebox requires macOS");
  const fixture = await mkdtemp(path.join(tmpdir(), "linksense-browser-os-"));
  const identifier = `org.linksense.desktop.browser-whitebox.${randomUUID()}`;
  const service = `${identifier}.credentials`;
  const helper = path.join(fixture, "dispatch");
  const keychain = async operation => {
    try {
      await execFileAsync("/usr/bin/security", [
        operation === "cleanup" ? "delete-generic-password" : "find-generic-password", "-s", service,
      ], { timeout: 5_000, killSignal: "SIGKILL" });
    } catch (error) {
      if (error.code === 44 && operation !== "present") return;
      throw error;
    }
    if (operation === "absent") throw new Error(`Isolated Keychain credential remains: ${service}`);
  };
  try {
    const bundle = path.join(fixture, "LinkSense Browser Whitebox.app");
    const contents = path.join(bundle, "Contents");
    const executable = path.join(contents, "MacOS", "LinkSenseBrowserWhitebox");
    const swift = path.join(fixture, "dispatch.swift");
    await mkdir(path.dirname(executable), { recursive: true });
    await writeFile(path.join(contents, "Info.plist"), `<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0"><dict>
<key>CFBundleIdentifier</key><string>${identifier}</string>
<key>CFBundleExecutable</key><string>LinkSenseBrowserWhitebox</string>
<key>CFBundleName</key><string>LinkSense Browser Whitebox</string>
<key>CFBundlePackageType</key><string>APPL</string>
</dict></plist>`);
    await writeFile(swift, dispatcher);
    await run("xcrun", ["swiftc", swift, "-o", helper]);
    await run("pnpm", ["desktop:build-web"], { cwd: root });
    await run("go", [
      "test", "-c", "-tags", "desktop_whitebox,desktop_browser_whitebox",
      "-ldflags", `-X github.com/egoist/mygo.packageIdentifier=${identifier} -X github.com/egoist/mygo.packageURLSchemes=linksense-desktop`,
      "-o", executable,
    ]);
    await run("codesign", ["--sign", "-", bundle]);
    const env = {
      LINKSENSE_DESKTOP_BROWSER_OS_DRIVER: helper,
      LINKSENSE_DESKTOP_BROWSER_KEYCHAIN_SERVICE: service,
      LINKSENSE_DESKTOP_WEB_DIST: path.join(root, "apps/web/dist"),
      TMPDIR: fixture,
    };
    const args = ["-test.v", "-test.run", "^TestNativeBrowserSignInRoundTrip$", "-test.timeout", "90s"];
    let crashed = false;
    try {
      await run(executable, args, { env: { ...env, LINKSENSE_DESKTOP_BROWSER_FORCE_EXIT_AFTER_STORE: "1" } });
    } catch (error) {
      if (!(error instanceof Error) || !error.message.endsWith("exited with 23")) throw error;
      crashed = true;
    }
    if (!crashed) throw new Error("The credential cleanup fixture did not exit at its crash point");
    await keychain("present");
    await keychain("cleanup");
    await keychain("absent");
    console.log("Verified isolated Keychain cleanup after forced child exit");
    await run(executable, args, { env: { ...env, LINKSENSE_DESKTOP_BROWSER_FORCE_EXIT_AFTER_STORE: "" } });
    await keychain("absent");
  } finally {
    try {
      await keychain("cleanup");
    } finally {
      await rm(fixture, { recursive: true, force: true });
    }
  }
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : "System-browser whitebox failed");
  process.exitCode = 1;
});
