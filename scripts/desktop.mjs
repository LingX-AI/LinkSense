import { spawn } from "node:child_process";
import { chmod, copyFile, mkdir, mkdtemp, readFile, readdir, rename, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import {
  desktopBuildLdflags,
  desktopUpdateChildEnvironment,
  desktopUpdateConfiguration,
  desktopUpdateKeyFile,
  requireDesktopReleaseUpdateSigning,
  signDesktopUpdateManifest,
  stageDesktopUpdatePrivateKey,
  verifyDesktopUpdateArtifacts,
} from "./desktop-update.mjs";

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
  if (url.username || url.password || url.pathname !== "/" || url.search || url.hash ||
    !(url.protocol === "https:" || url.protocol === "http:")) {
    throw new Error("Desktop server URL must be an HTTP(S) origin without credentials, path, query or fragment");
  }
  const explicitDefaultPort = (url.protocol === "https:" && /:443\/?$/u.test(raw)) ? ":443"
    : (url.protocol === "http:" && /:80\/?$/u.test(raw)) ? ":80" : "";
  return `${url.origin}${explicitDefaultPort}`;
}

export function desktopMygoBuildArguments(target, signing = {}) {
  validateDesktopTarget(target);
  if (!signing.identity) {
    return ["tool", "mygo", "build", "-platform", target, "-sign", "-", "-skip-notarize"];
  }
  if (!signing.outputRoot) throw new Error("A signed desktop build needs an output directory");
  return ["tool", "mygo", "build", "-platform", target, "-sign", signing.identity, "-o", signing.outputRoot];
}

export function desktopChildEnvironment(environment) {
  const child = { ...environment };
  delete child.MYGO_UPDATER_PRIVATE_KEY;
  return child;
}

export function desktopMacosReleaseTeam(target, server, identity, platform = process.platform, arch = process.arch) {
  if (platform !== "darwin" || arch !== "arm64" || target !== "darwin/arm64") {
    throw new Error("--macos-release requires a native Apple silicon Mac and the darwin/arm64 target");
  }
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

export function desktopMacosSignerToken(team, application) {
  if (!/^[A-Z0-9]{10}$/u.test(team ?? "")) {
    throw new Error("A macOS release signer token needs the Developer ID team");
  }
  if (typeof application !== "string" || !/^[A-Za-z0-9][A-Za-z0-9.-]{0,239}$/u.test(application)) {
    throw new Error("A macOS release signer token needs the bundled application identifier");
  }
  // The release build compiles this token into the signed app; the runtime
  // primitive in apps/desktop/macos_signing_proof_darwin.go consumes it.
  // Both requirements are the exact strings the release gate already
  // verifies; the token adds no second signing chain or key.
  return {
    schema_version: 1,
    app_requirement: desktopMacosSigningRequirement(team, application),
    runtime_requirement: desktopMacosSigningRequirement(team),
  };
}

export function desktopMacosSignerTokenFlag(team, application) {
  const token = desktopMacosSignerToken(team, application);
  return `-X main.desktopMacosSignerToken=${Buffer.from(JSON.stringify(token), "utf8").toString("base64url")}`;
}

export function desktopSigningLdflags(server, update, signing, existing = "") {
  if (/(?:^|\s)-X(?:\s+|=)main\.desktopMacosSignerToken=/u.test(existing)) {
    throw new Error("MYGO_LDFLAGS must not set the LinkSense macOS signing token");
  }
  const flags = desktopBuildLdflags(server, update, existing);
  return signing
    ? `${flags} ${desktopMacosSignerTokenFlag(signing.team, signing.application)}`.trim()
    : flags;
}

async function verifySignedDesktopRuntime(app, runtimePath, runtime, team) {
  const signer = desktopMacosSignerToken(team, runtime.application);
  await run("/usr/bin/codesign", ["--verify", "--deep", "--strict", app]);
  await run("/usr/bin/codesign", ["--verify", "--strict", "-R",
    `=${signer.app_requirement}`, app]);
  for (const file of runtime.files) {
    await run("/usr/bin/codesign", ["--verify", "--strict", "-R",
      `=${signer.runtime_requirement}`, path.join(runtimePath, file.path)]);
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
      env: desktopChildEnvironment({ ...process.env, GOTOOLCHAIN: goToolchain, ...options.env }),
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
  let mygoDirectory;
  for (const entry of new Set(modules.split(/\r?\n/u).filter(Boolean))) {
    const [name, directory] = entry.split("|");
    if (!directory) throw new Error(`Missing source directory for desktop dependency: ${name}`);
    const licensePath = path.join(directory, name === "github.com/coder/websocket" ? "LICENSE.txt" : "LICENSE");
    if (!(await readFile(licensePath, "utf8")).trim()) throw new Error(`Empty dependency license: ${name}`);
    const output = path.join(destination, name);
    await mkdir(output, { recursive: true });
    await stageDesktopNotice(licensePath, path.join(output, "LICENSE"));
    if (name === "github.com/egoist/mygo") mygoDirectory = directory;
  }
  if (mygoDirectory) {
    // MyGo's permissionflow plugin carries the PermissionFlow attribution in
    // its own NOTICE.md. Keep it next to the module license when that plugin
    // is linked into the desktop binary.
    const notice = path.join(mygoDirectory, "plugins", "permissionflow", "NOTICE.md");
    const output = path.join(destination, "github.com/egoist/mygo", "plugins", "permissionflow", "NOTICE.md");
    await mkdir(path.dirname(output), { recursive: true });
    await stageDesktopNotice(notice, output);
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
  // Keep the signing key out of every child process. The build writes it to a
  // private 0600 file and passes only that path to MyGo.
  const environment = { ...process.env };
  delete process.env.MYGO_UPDATER_PRIVATE_KEY;
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
        "src/adapters/desktop", "src/features/browser-notifications", "src/features/desktop-login", "src/features/desktop-update", "src/features/desktop-devices", "src/features/desktop-execution", "src/features/desktop-computer-permissions", "src/features/local-workspace", "src/api/session.test.ts", "src/api/client.test.ts", "src/api/client-build-contract.test.ts", "src/api/sse.test.ts",
        "src/features/applications/application-annotation-bridge.test.ts",
        "src/features/applications/application-annotation-native-runtime.test.ts",
        "src/features/applications/application-annotation-preload-install.test.ts",
        "src/features/applications/application-annotation-preview.desktop.test.tsx",
        "src/components/media/html-preview/html-preview-selection.test.ts",
        "src/components/media/html-preview/html-preview-annotations.test.ts",
        "src/app/auth-context.test.tsx", "src/app/route-guards.account-switch.test.tsx",
        "src/pages/conversation-execution-target.test.tsx",
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
    await run("go", ["test", "-tags", "desktop_whitebox", "-count=1", "-timeout", "4m", "./..."], {
      env: {
        LINKSENSE_DESKTOP_WEB_DIST: path.join(root, "apps/web/dist"),
        // desktop:build-web stages the Mac preload under the platform
        // resources; the whitebox TestMain reads this root unless overridden.
        ...(process.platform === "darwin" ? {
          LINKSENSE_DESKTOP_ANNOTATION_RESOURCES:
            process.env.LINKSENSE_DESKTOP_ANNOTATION_RESOURCES ?? path.join(desktop, "resources"),
        } : {}),
      },
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
    const target = validateDesktopTarget(values.platform ?? desktopTarget());
    const update = desktopUpdateConfiguration(environment, target);
    const identity = process.env.LINKSENSE_DESKTOP_MACOS_SIGNING_IDENTITY;
    const team = values["macos-release"] ? desktopMacosReleaseTeam(target, server, identity) : undefined;
    if (!team && identity) throw new Error("LINKSENSE_DESKTOP_MACOS_SIGNING_IDENTITY requires --macos-release");
    const stagedKey = update.signedArtifacts
      ? await stageDesktopUpdatePrivateKey(update.privateKey) : undefined;
    const privateKeyFile = stagedKey?.file ?? (update.signedArtifacts ? update.privateKeyFile : undefined);
    try {
      if (privateKeyFile) await desktopUpdateKeyFile(privateKeyFile);
      requireDesktopReleaseUpdateSigning(update, privateKeyFile, Boolean(team));
      // The signed manifest may only exist after the real packaged runtime
      // smoke; a cross-target build cannot run it.
      const nativeSmoke = ["darwin", "win32"].includes(process.platform) && target === desktopTarget();
      if (update.signedArtifacts && privateKeyFile && !nativeSmoke) {
        throw new Error("Signing desktop update artifacts requires the packaged runtime smoke on the target platform");
      }
      await stageNotices(target);
      const { prepareDesktopResources, verifyDesktopPackageManifest, verifyDesktopRuntimeFiles,
        verifyMacosBundlePermissions, verifyPackagedDesktopRuntime } =
        await import("./desktop-resources.mjs");
      const { runtime, manifestBytes } = await prepareDesktopResources(target);
      // Only a Developer ID release compiles the trusted signer token. Every
      // other build leaves it empty, so the runtime verifier fails closed.
      const ldflags = `${desktopSigningLdflags(server, update,
        team ? { team, application: runtime.application } : undefined, process.env.MYGO_LDFLAGS)}${
        !team && target.startsWith("darwin/") ? " -X main.desktopInternalComputerProof=true" : ""
      }`.trim();
      const build = path.join(desktop, "build");
      await mkdir(build, { recursive: true });
      const updateEnvironment = desktopUpdateChildEnvironment(update, privateKeyFile);
      const buildAndVerify = async (outputRoot) => {
        await run("go", desktopMygoBuildArguments(target, team ? { identity, outputRoot } : {}), {
          env: {
            LINKSENSE_DESKTOP_BUILD_TARGET: target,
            LINKSENSE_DESKTOP_MACOS_RELEASE: team ? "1" : "0",
            ...updateEnvironment,
            MYGO_LDFLAGS: ldflags,
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
        // MyGo signs the archive and manifest inside the verified stage. Check
        // them, and the archive's bundle plist, before the stage is exposed.
        const verifiedUpdate = update.signedArtifacts && privateKeyFile
          ? await verifyDesktopUpdateArtifacts(output, update, app) : undefined;
        if (!nativeSmoke && target.startsWith("darwin/")) {
          console.warn(`Built ${target} without native packaging verification.`);
        }
        // Publish the verified envelope only after that smoke. The raw MyGo
        // manifest and artifacts are already in place for future delta builds.
        if (verifiedUpdate) {
          await signDesktopUpdateManifest(output, update, verifiedUpdate.manifestBytes, privateKeyFile);
        }
      };
      if (team) console.log(`Verified release output: ${await stageDesktopMacosRelease(build, buildAndVerify)}`);
      else await buildAndVerify(build);
    } finally {
      await stagedKey?.cleanup();
    }
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
