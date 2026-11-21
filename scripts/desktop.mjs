import { spawn } from "node:child_process";
import { chmod, copyFile, mkdir, mkdtemp, readFile, readdir, rename, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const root = path.resolve(import.meta.dirname, "..");
const desktop = path.join(root, "apps/desktop");
const goToolchain = "go1.27.3";

export function desktopTarget(platform = process.platform, arch = process.arch) {
  const os = { darwin: "darwin", win32: "windows" }[platform];
  const cpu = { arm64: "arm64", x64: "amd64" }[arch];
  if (!os || !cpu) throw new Error(`Unsupported desktop target: ${platform}/${arch}`);
  return `${os}/${cpu}`;
}

export function validateDesktopTarget(target) {
  if (!/^(darwin|windows)\/(arm64|amd64)$/u.test(target)) {
    throw new Error("Desktop builds require a macOS or Windows target");
  }
  return target;
}

export function desktopTestArguments(platform = process.platform, arch = process.arch) {
  return ["test", ...(platform === "win32" && arch === "arm64" ? [] : ["-race"]), "-count=1", "./..."];
}

export function desktopBuildServerUrl(raw) {
  if (!raw || /[\s"'\\?#]/u.test(raw)) throw new Error("Supply --server-url with the LinkSense server origin");
  const url = new URL(raw);
  const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (url.username || url.password || url.pathname !== "/" || url.search || url.hash ||
    !(url.protocol === "https:" || (url.protocol === "http:" && loopback))) {
    throw new Error("Desktop server URL must be an HTTPS origin (loopback HTTP is allowed for development)");
  }
  const explicitDefaultPort = (url.protocol === "https:" && /:443\/?$/u.test(raw)) ? ":443"
    : (url.protocol === "http:" && /:80\/?$/u.test(raw)) ? ":80" : "";
  return `${url.origin}${explicitDefaultPort}`;
}

export function desktopUpdateBuildFlags(feed, publicKey) {
  if (feed === undefined && publicKey === undefined) return "";
  if (!feed || !publicKey || /[\s"'\\?#]/u.test(feed)) throw new Error("Desktop updates require a feed URL and public key");
  const url = new URL(feed);
  const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (url.username || url.password || !(url.protocol === "https:" || (url.protocol === "http:" && loopback))) {
    throw new Error("Desktop update feed must use HTTPS (or loopback HTTP)");
  }
  const key = Buffer.from(publicKey, "base64");
  if (key.length !== 32 || key.toString("base64") !== publicKey) {
    throw new Error("Desktop update public key must be a base64 Ed25519 public key");
  }
  return `-X github.com/egoist/mygo.packageUpdateFeed=${url.href} -X github.com/egoist/mygo.packageUpdateKey=${publicKey}`;
}

export function desktopMacosReleaseTeam(target, server, identity, platform = process.platform, arch = process.arch) {
  if (platform !== "darwin" || arch !== "arm64" || target !== "darwin/arm64") {
    throw new Error("--macos-release requires a native Apple silicon Mac and the darwin/arm64 target");
  }
  if (new URL(server).protocol !== "https:") throw new Error("--macos-release requires an HTTPS server origin");
  const match = /^Developer ID Application: .+ \(([A-Z0-9]{10})\)$/u.exec(identity ?? "");
  if (!match || /[\u0000-\u001f\u007f]/u.test(identity)) {
    throw new Error("--macos-release requires LINKSENSE_DESKTOP_MACOS_SIGNING_IDENTITY with a Developer ID Application certificate and Team ID");
  }
  return match[1];
}

export function desktopMacosSigningRequirement(team, identifier) {
  return [
    ...(identifier ? [`identifier "${identifier}"`] : []),
    "anchor apple generic",
    "certificate 1[field.1.2.840.113635.100.6.2.6] exists",
    "certificate leaf[field.1.2.840.113635.100.6.1.13] exists",
    `certificate leaf[subject.OU] = "${team}"`,
    '! (entitlement["com.apple.security.get-task-allow"] exists)',
  ].join(" and ");
}

async function verifySignedDesktopRuntime(app, runtimePath, runtime, team) {
  await run("/usr/bin/codesign", ["--verify", "--deep", "--strict", app]);
  await run("/usr/bin/codesign", ["--verify", "--strict", "-R",
    `=${desktopMacosSigningRequirement(team, runtime.application)}`, app]);
  for (const file of runtime.files) {
    await run("/usr/bin/codesign", ["--verify", "--strict", "-R",
      `=${desktopMacosSigningRequirement(team)}`, path.join(runtimePath, file.path)]);
  }
}

export async function stageDesktopMacosRelease(build, buildAndVerify) {
  const staging = await mkdtemp(path.join(build, ".macos-release-"));
  try {
    await buildAndVerify(staging);
    const release = path.join(build, path.basename(staging).slice(1));
    await rename(staging, release);
    return release;
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}

export function desktopCommandInvocation(command, args, platform = process.platform, environment = process.env) {
  if (command === "pnpm" || command === "pnpm.cmd") {
    const launcher = environment.npm_execpath;
    if (launcher && /(?:^|[/\\])pnpm(?:\.(?:c?js|exe))?$/iu.test(launcher)) {
      return /\.c?js$/iu.test(launcher)
        ? { command: process.execPath, args: [launcher, ...args] }
        : { command: launcher, args };
    }
    if (platform === "win32") throw new Error("Run desktop commands through pnpm so the Windows launcher is available");
  }
  return { command, args };
}

export function run(command, args, options = {}) {
  const invocation = desktopCommandInvocation(command, args);
  return new Promise((resolve, reject) => {
    const child = spawn(invocation.command, invocation.args, {
      cwd: options.cwd ?? desktop,
      env: { ...process.env, GOTOOLCHAIN: goToolchain, ...options.env },
      stdio: options.capture ? ["ignore", "pipe", "inherit"] : "inherit",
      shell: false,
    });
    let output = "";
    child.stdout?.on("data", chunk => { output += chunk.toString(); });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) resolve(output.trim());
      else reject(new Error(`${command} exited with ${signal ?? code}`));
    });
    for (const signal of ["SIGINT", "SIGTERM"]) {
      const forward = () => child.kill(signal);
      process.once(signal, forward);
      child.once("exit", () => process.off(signal, forward));
    }
  });
}

export async function stageDesktopNotice(source, destination) {
  await chmod(destination, 0o644).catch(error => {
    if (error.code !== "ENOENT") throw error;
  });
  await copyFile(source, destination);
  await chmod(destination, 0o644);
}

export async function stageDesktopDependencyNotices(target, destination, cwd = desktop) {
  const [GOOS, GOARCH] = validateDesktopTarget(target).split("/");
  // A module-only listing omits sources that have not been extracted on a cold builder.
  const modules = await run("go", [
    "list", "-deps", "-f", "{{with .Module}}{{if not .Main}}{{.Path}}|{{.Dir}}{{end}}{{end}}", ".",
  ], { cwd, capture: true, env: { GOOS, GOARCH, CGO_ENABLED: process.env.CGO_ENABLED || "0" } });
  await rm(destination, { recursive: true, force: true });
  for (const entry of new Set(modules.split(/\r?\n/u).filter(Boolean))) {
    const [name, directory] = entry.split("|");
    if (!directory) throw new Error(`Missing source directory for desktop dependency: ${name}`);
    const licensePath = path.join(directory, name === "github.com/coder/websocket" ? "LICENSE.txt" : "LICENSE");
    if (!(await readFile(licensePath, "utf8")).trim()) throw new Error(`Empty dependency license: ${name}`);
    const output = path.join(destination, name);
    await mkdir(output, { recursive: true });
    await stageDesktopNotice(licensePath, path.join(output, "LICENSE"));
  }
}

async function stageNotices(target) {
  const destination = path.join(desktop, "resources/legal");
  await mkdir(destination, { recursive: true });
  for (const file of ["LICENSE", "LICENSE-EXCEPTIONS.md", "NOTICE", "ATTRIBUTION.md", "TRADEMARK.md", "THIRD-PARTY-NOTICES.md"]) {
    await stageDesktopNotice(path.join(root, file), path.join(destination, file));
  }
  await stageDesktopDependencyNotices(target, path.join(destination, "dependencies"));
}

async function main() {
  const mode = process.argv[2] ?? "dev";
  const { values } = parseArgs({
    args: process.argv.slice(3).filter(value => value !== "--"),
    options: { platform: { type: "string" }, "server-url": { type: "string" }, "macos-release": { type: "boolean" } },
  });
  if (!["dev", "build", "prepare", "generate", "test", "whitebox", "web"].includes(mode)) {
    throw new Error("Use desktop:dev, desktop:build, desktop:generate, desktop:test or desktop:whitebox");
  }
  if (values["macos-release"] && mode !== "build") throw new Error("--macos-release requires desktop:build");
  if (mode === "web") {
    const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
    await run(pnpm, ["--filter", "@linksense/shared", "build"], { cwd: root });
    await run(pnpm, ["--filter", "@linksense/web", "build"], {
      cwd: root, env: { LINKSENSE_DESKTOP_BUILD: "1" },
    });
    if ((process.env.LINKSENSE_DESKTOP_BUILD_TARGET ?? `${process.platform}/`).startsWith("darwin/")) {
      const { buildDesktopAnnotationPreload } = await import("./desktop-preload.mjs");
      await buildDesktopAnnotationPreload(root);
    }
    return;
  }
  if (mode === "test") {
    await run(process.platform === "win32" ? "pnpm.cmd" : "pnpm",
      ["--filter", "@linksense/shared", "build"], { cwd: root });
    await run("go", desktopTestArguments());
    await run(process.platform === "win32" ? "pnpm.cmd" : "pnpm",
      ["--filter", "@linksense/web", "exec", "vitest", "run", "--project", "components", "--project", "shared-components", "--project", "node",
        "src/adapters/desktop", "src/features/desktop-login", "src/features/desktop-update", "src/features/local-workspace", "src/api/session.test.ts", "src/api/client.test.ts", "src/api/client-build-contract.test.ts", "src/api/sse.test.ts",
        "src/features/applications/application-annotation-bridge.test.ts",
        "src/features/applications/application-annotation-native-runtime.test.ts",
        "src/features/applications/application-annotation-preload-install.test.ts",
        "src/features/applications/application-annotation-preview.desktop.test.tsx",
        "src/components/media/html-preview/html-preview-selection.test.ts",
        "src/components/media/html-preview/html-preview-annotations.test.ts",
        "src/app/auth-context.test.tsx", "src/app/route-guards.account-switch.test.tsx",
        "src/features/knowledge-bases/knowledge-base-api.test.ts",
        "src/features/knowledge-bases/knowledge-base-events.test.ts",
        "src/features/connections/use-connection-authorization.test.tsx"],
      { cwd: root });
    return;
  }
  if (mode === "generate") {
    await run("go", ["tool", "mygo", "generate"]);
    return;
  }
  if (mode === "whitebox") {
    await run("go", ["tool", "mygo", "generate"]);
    await run(process.platform === "win32" ? "pnpm.cmd" : "pnpm", ["desktop:build-web"], { cwd: root });
    await run("go", ["test", "-tags", "desktop_whitebox", "-count=1", "-timeout", "90s", "./..."], {
      env: { LINKSENSE_DESKTOP_WEB_DIST: path.join(root, "apps/web/dist") },
    });
    return;
  }
  if (mode === "prepare") {
    const { prepareDesktopResources } = await import("./desktop-resources.mjs");
    await prepareDesktopResources(validateDesktopTarget(values.platform ?? desktopTarget()));
    return;
  }
  const server = desktopBuildServerUrl(values["server-url"] ?? process.env.LINKSENSE_DESKTOP_SERVER_URL);
  if (mode === "build") {
    const updateFlags = desktopUpdateBuildFlags(
      process.env.LINKSENSE_DESKTOP_UPDATE_FEED, process.env.LINKSENSE_DESKTOP_UPDATE_PUBLIC_KEY,
    );
    const target = validateDesktopTarget(values.platform ?? desktopTarget());
    const identity = process.env.LINKSENSE_DESKTOP_MACOS_SIGNING_IDENTITY;
    const team = values["macos-release"] ? desktopMacosReleaseTeam(target, server, identity) : undefined;
    if (!team && identity) throw new Error("LINKSENSE_DESKTOP_MACOS_SIGNING_IDENTITY requires --macos-release");
    if (team && updateFlags && new URL(process.env.LINKSENSE_DESKTOP_UPDATE_FEED).protocol !== "https:") {
      throw new Error("--macos-release requires an HTTPS update feed");
    }
    await stageNotices(target);
    const { prepareDesktopResources, verifyDesktopPackageManifest, verifyDesktopRuntimeFiles,
      verifyMacosBundlePermissions, verifyPackagedDesktopRuntime } =
      await import("./desktop-resources.mjs");
    const { runtime, manifestBytes } = await prepareDesktopResources(target);
    const build = path.join(desktop, "build");
    await mkdir(build, { recursive: true });
    const buildAndVerify = async (outputRoot) => {
      const signing = team ? ["-sign", identity, "-o", outputRoot] : ["-sign", "-", "-skip-notarize"];
      await run("go", ["tool", "mygo", "build", "-platform", target, ...signing], {
        env: {
          LINKSENSE_DESKTOP_BUILD_TARGET: target,
          LINKSENSE_DESKTOP_MACOS_RELEASE: team ? "1" : "0",
          MYGO_LDFLAGS: `${process.env.MYGO_LDFLAGS ?? ""} -X main.desktopServerURL=${server} ${updateFlags}`.trim(),
        },
      });
      const output = path.join(outputRoot, target.replace("/", "-"));
      const app = path.join(output, "LinkSense.app");
      const runtimePath = target.startsWith("darwin") ? path.join(app, "Contents", "Resources", "runtime")
        : path.join(output, "runtime");
      if (target.startsWith("darwin/")) {
        const { desktopAnnotationPreloadOutput } = await import("./desktop-preload.mjs");
        const preload = desktopAnnotationPreloadOutput(root);
        const packaged = path.join(path.dirname(runtimePath), path.basename(preload));
        if (!(await readFile(packaged)).equals(await readFile(preload))) {
          throw new Error("Packaged Mac annotation preload does not match the build");
        }
      }
      await verifyDesktopPackageManifest(runtimePath, manifestBytes);
      if (process.platform === "darwin" && target.startsWith("darwin/")) await verifyMacosBundlePermissions(app);
      // Developer ID signing rewrites Mach-O bytes; the sealed bundle and its code signatures replace the pre-sign hashes.
      if (team) {
        await verifySignedDesktopRuntime(app, runtimePath, runtime, team);
        const images = (await readdir(output)).filter(file => file.endsWith(".dmg"));
        if (images.length !== 1) throw new Error("MyGo must produce one release disk image");
        for (const artifact of [app, path.join(output, images[0])]) {
          await run("/usr/bin/xcrun", ["stapler", "validate", artifact]);
        }
      } else {
        await verifyDesktopRuntimeFiles(runtimePath, runtime.files);
      }
      await verifyPackagedDesktopRuntime(runtimePath, target, runtime.versions);
      if (["darwin", "win32"].includes(process.platform) && target === desktopTarget()) {
        await run("pnpm", ["--filter", "@linksense/runner", "exec", "tsx", "test/functional/desktop-package.ts", runtimePath], { cwd: root });
        const tests = target.startsWith("darwin") ? "^TestPackaged(RuntimeSupervisor|DesktopDeviceTurn)$" : "^TestPackagedRuntimeSupervisor$";
        await run("go", ["test", "-tags", "desktop_runtime_package", "-run", tests, "-count=1", "-timeout=100s", "./..."], {
          env: { LINKSENSE_DESKTOP_RUNTIME_DIST: runtimePath },
        });
      } else if (target.startsWith("darwin/")) {
        console.warn(`Built ${target} without native execution verification.`);
      }
    };
    if (team) console.log(`Verified release output: ${await stageDesktopMacosRelease(build, buildAndVerify)}`);
    else await buildAndVerify(build);
    return;
  }
  await stageNotices(desktopTarget());
  await run("go", ["tool", "mygo", "generate"]);
  await run(process.platform === "win32" ? "pnpm.cmd" : "pnpm", ["desktop:build-web"], { cwd: root });
  await run("go", ["tool", "mygo", "dev"], { env: { LINKSENSE_DESKTOP_DEV_SERVER_URL: server } });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    console.error(error instanceof Error ? error.message : "Desktop command failed");
    process.exitCode = 1;
  });
}
