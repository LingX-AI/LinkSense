import { spawn } from "node:child_process";
import { chmod, copyFile, mkdir, readFile } from "node:fs/promises";
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

async function stageNotices() {
  const destination = path.join(desktop, "resources/legal");
  await mkdir(destination, { recursive: true });
  for (const file of ["LICENSE", "LICENSE-EXCEPTIONS.md", "NOTICE", "ATTRIBUTION.md", "TRADEMARK.md", "THIRD-PARTY-NOTICES.md"]) {
    await stageDesktopNotice(path.join(root, file), path.join(destination, file));
  }
  const modules = await run("go", ["list", "-m", "-f", "{{if .Dir}}{{.Path}}|{{.Dir}}{{end}}", "all"], { capture: true });
  for (const entry of modules.split("\n").filter(Boolean)) {
    const [name, directory] = entry.split("|");
    if (name === "github.com/LingX-AI/linksense/apps/desktop") continue;
    const licensePath = path.join(directory, name === "github.com/coder/websocket" ? "LICENSE.txt" : "LICENSE");
    const license = await readFile(licensePath);
    const output = path.join(destination, "dependencies", name);
    await mkdir(output, { recursive: true });
    await stageDesktopNotice(licensePath, path.join(output, "LICENSE"));
    if (license.length === 0) throw new Error(`Empty dependency license: ${name}`);
  }
}

async function main() {
  const mode = process.argv[2] ?? "dev";
  const { values } = parseArgs({
    args: process.argv.slice(3).filter(value => value !== "--"),
    options: { platform: { type: "string" }, "server-url": { type: "string" } },
  });
  if (!["dev", "build", "prepare", "generate", "test", "whitebox", "web"].includes(mode)) {
    throw new Error("Use desktop:dev, desktop:build, desktop:generate, desktop:test or desktop:whitebox");
  }
  if (mode === "web") {
    const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
    await run(pnpm, ["--filter", "@linksense/shared", "build"], { cwd: root });
    await run(pnpm, ["--filter", "@linksense/web", "build"], {
      cwd: root, env: { LINKSENSE_DESKTOP_BUILD: "1" },
    });
    return;
  }
  if (mode === "test") {
    await run(process.platform === "win32" ? "pnpm.cmd" : "pnpm",
      ["--filter", "@linksense/shared", "build"], { cwd: root });
    await run("go", desktopTestArguments());
    await run(process.platform === "win32" ? "pnpm.cmd" : "pnpm",
      ["--filter", "@linksense/web", "exec", "vitest", "run", "--project", "components", "--project", "shared-components", "--project", "node",
        "src/adapters/desktop", "src/features/desktop-login", "src/api/session.test.ts", "src/api/client.test.ts", "src/api/client-build-contract.test.ts", "src/api/sse.test.ts",
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
  await stageNotices();
  if (mode === "build") {
    const target = validateDesktopTarget(values.platform ?? desktopTarget());
    const { prepareDesktopResources } = await import("./desktop-resources.mjs");
    await prepareDesktopResources(target);
    await run("go", ["tool", "mygo", "build", "-platform", target], {
      env: { MYGO_LDFLAGS: `${process.env.MYGO_LDFLAGS ?? ""} -X main.desktopServerURL=${server}`.trim() },
    });
    const { verifyPackagedDesktopRuntime } = await import("./desktop-resources.mjs");
    const runtime = target.startsWith("darwin")
      ? path.join(desktop, "build", target.replace("/", "-"), "LinkSense.app/Contents/Resources/runtime")
      : path.join(desktop, "build", target.replace("/", "-"), "runtime");
    const manifest = JSON.parse(await readFile(path.join(runtime, "manifest.json"), "utf8"));
    await verifyPackagedDesktopRuntime(runtime, target, manifest.versions);
    if (["darwin", "win32"].includes(process.platform) && target === desktopTarget()) {
      await run("pnpm", ["--filter", "@linksense/runner", "exec", "tsx", "test/functional/desktop-package.ts", runtime], { cwd: root });
      await run("go", ["test", "-tags", "desktop_runtime_package", "-run", "^TestPackagedRuntimeSupervisor$", "-count=1", "-timeout=50s", "./..."], {
        env: { LINKSENSE_DESKTOP_RUNTIME_DIST: runtime },
      });
    }
    return;
  }
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
