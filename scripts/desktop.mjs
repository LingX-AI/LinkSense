import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, writeFile, chmod, stat, rm } from "node:fs/promises";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const desktop = path.join(root, "apps/desktop");
const version = "1.0.2";
export const desktopRelease = {
  "darwin-arm64": {
    file: "agent-desktop-v1.0.2-aarch64-apple-darwin.tar.gz",
    sha256: "7bee385196d7b478de80cf05ca4304aaa38f0eba593b3406ad3c247c1773be19",
    entries: ["agent-desktop", "agent-desktop-macos-helper"],
  },
  "darwin-x64": {
    file: "agent-desktop-v1.0.2-x86_64-apple-darwin.tar.gz",
    sha256: "8edda6df17eafc042395502a823dbb8415bc8ac14835a6731e4d8becc9cb4121",
    entries: ["agent-desktop", "agent-desktop-macos-helper"],
  },
  "win32-x64": {
    file: "agent-desktop-v1.0.2-x86_64-pc-windows-msvc.tar.gz",
    sha256: "2186c76e7df197c0e67365e45d36d869f74714c56bb8a73817e2a66f3e18e222",
    entries: ["agent-desktop.exe"],
  },
  "win32-arm64": {
    file: "agent-desktop-v1.0.2-aarch64-pc-windows-msvc.tar.gz",
    sha256: "a0ecd6e17e60a0bcfbb45533a72f2d3a7a73508769588273ef08b0477d2b9687",
    entries: ["agent-desktop.exe"],
  },
};

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: desktop, env: { ...process.env, GOTOOLCHAIN: "go1.27.3", ...options.env },
      stdio: options.capture ? ["ignore", "pipe", "inherit"] : "inherit",
    });
    let output = "";
    child.stdout?.on("data", (chunk) => { output += chunk.toString(); });
    child.on("error", reject);
    child.on("exit", (code, signal) => {
      if (code === 0) resolve(output);
      else reject(new Error(`${command} exited with ${signal ?? code}`));
    });
    for (const signal of ["SIGINT", "SIGTERM"]) {
      const forward = () => child.kill(signal);
      process.once(signal, forward);
      child.once("exit", () => process.off(signal, forward));
    }
  });
}

async function digest(file) {
  return createHash("sha256").update(await readFile(file)).digest("hex");
}

export function validateDesktopArchive(entries, expected = desktopRelease["darwin-arm64"].entries) {
  const actual = entries.trim().split("\n").filter(Boolean).sort();
  return JSON.stringify(actual) === JSON.stringify([...expected].sort());
}

export function desktopReleaseArtifacts(platform, arch) {
  const target = `${platform}-${arch}`;
  const release = desktopRelease[target];
  if (!release) return null;
  const goos = platform === "win32" ? "windows" : platform;
  const goarch = arch === "arm64" ? "arm64" : "amd64";
  const goTarget = `${goos}/${goarch}`;
  const directory = path.join("apps/desktop/build", `${goos}-${goarch}`);
  if (platform === "darwin") return {
    goTarget,
    source: path.join(directory, "LinkSense helper.app"),
    output: "LinkSense-Desktop-macos.zip",
  };
  if (platform === "win32") return {
    goTarget,
    source: path.join(directory, `linksense-helper-setup-0.1.0-${goarch}.exe`),
    output: "LinkSense-Desktop-windows.exe",
  };
  return null;
}

export function desktopTestArguments(platform, arch) {
  // The pinned Go toolchain has no Windows ARM64 race detector.
  return ["test", ...(platform === "win32" && arch === "arm64" ? [] : ["-race"]), "./..."];
}

export async function stageDesktopInstaller(source, output) {
  const info = await stat(source);
  if (!info.isFile() || info.size === 0) throw new Error("Desktop installer is empty or invalid");
  await copyFile(source, output);
}

export async function stageDesktopNotices(destination) {
  await mkdir(destination, { recursive: true });
  for (const file of ["LICENSE", "LICENSE-EXCEPTIONS.md", "NOTICE", "ATTRIBUTION.md", "TRADEMARK.md", "THIRD-PARTY-NOTICES.md"]) {
    await copyFile(path.join(root, file), path.join(destination, file));
  }
  await copyFile(path.join(desktop, "licenses/THIRD-PARTY-NOTICES.txt"), path.join(destination, "DESKTOP-THIRD-PARTY-NOTICES.txt"));
}

async function ensureEngine() {
  const target = `${process.platform}-${process.arch}`;
  const release = desktopRelease[target];
  if (!release) throw new Error(`Computer Use does not support ${target}`);
  const bin = path.join(desktop, "resources/bin");
  const installedName = process.platform === "win32" ? "agent-desktop.exe" : "agent-desktop";
  const manifestPath = path.join(bin, "manifest.json");
  const files = release.entries.map((file) => file === "agent-desktop.exe" ? installedName : file);
  try {
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    if (manifest.version === version && manifest.target === target &&
      (await Promise.all(files.map(async (file) => manifest.files[file] === await digest(path.join(bin, file))))).every(Boolean)) {
      return path.join(bin, installedName);
    }
  } catch { /* Missing or changed local artifacts are replaced from the pinned release. */ }
  const cache = path.join(root, "outputs/desktop/cache");
  await mkdir(cache, { recursive: true });
  await mkdir(bin, { recursive: true });
  const archive = path.join(cache, release.file);
  let verified = false;
  try { verified = await digest(archive) === release.sha256; } catch { /* First download. */ }
  if (!verified) {
    console.log(`Downloading agent-desktop ${version} (${process.arch})`);
    await run("curl", ["--fail", "--location", "--proto", "=https", "--tlsv1.2",
      "--connect-timeout", "15", "--max-time", "120", "--output", archive,
      `https://github.com/vercel-labs/agent-desktop/releases/download/v${version}/${release.file}`]);
    if (await digest(archive) !== release.sha256) throw new Error("Desktop engine checksum mismatch");
  }
  const entries = await run("tar", ["-tzf", archive], { capture: true });
  if (!validateDesktopArchive(entries, release.entries)) throw new Error("Unexpected desktop engine archive entries");
  const staging = path.join(bin, ".extract");
  await mkdir(staging, { recursive: true });
  await run("tar", ["-xzf", archive, "-C", staging, ...release.entries]);
  const checksums = {};
  for (const [index, file] of release.entries.entries()) {
    const installed = files[index];
    await copyFile(path.join(staging, file), path.join(bin, installed));
    if (process.platform !== "win32") await chmod(path.join(bin, installed), 0o755);
    checksums[installed] = await digest(path.join(bin, installed));
  }
  await rm(staging, { recursive: true, force: true });
  await writeFile(manifestPath, JSON.stringify({ version, target, files: checksums }) + "\n");
  return path.join(bin, installedName);
}

async function main() {
  const mode = process.argv[2] ?? "dev";
  if (mode === "test") {
    await run("go", desktopTestArguments(process.platform, process.arch));
    return;
  }
  if (!["dev", "build", "prepare", "doctor"].includes(mode)) throw new Error("Use desktop:dev, desktop:build, desktop:doctor or desktop:test");
  const binary = await ensureEngine();
  if (mode === "prepare") {
    console.log("Desktop engine verified.");
    return;
  }
  if (mode === "dev" || mode === "doctor") {
    await run("go", ["run", ".", ...(mode === "doctor" ? ["-doctor"] : process.argv.slice(3))], {
      env: { LINKSENSE_AGENT_DESKTOP_BIN: binary },
    });
    return;
  }
  await stageDesktopNotices(path.join(desktop, "resources/legal"));
  const artifacts = desktopReleaseArtifacts(process.platform, process.arch);
  if (!artifacts) throw new Error(`Computer Use does not support ${process.platform}`);
  await run("go", ["tool", "mygo", "build", "-platform", artifacts.goTarget]);
  const destination = path.join(root, "outputs/desktop");
  await mkdir(destination, { recursive: true });
  if (process.platform === "darwin") {
    const bundle = path.join(root, artifacts.source);
    if (!(await stat(bundle)).isDirectory()) throw new Error("Desktop application bundle is missing");
    await run("ditto", ["-c", "-k", "--sequesterRsrc", "--keepParent", bundle, path.join(destination, artifacts.output)]);
    console.log(`Built ${path.join(destination, artifacts.output)}`);
  } else if (process.platform === "win32") {
    const output = path.join(destination, artifacts.output);
    await stageDesktopInstaller(path.join(root, artifacts.source), output);
    console.log(`Built ${output}`);
  } else {
    throw new Error(`Computer Use does not support ${process.platform}`);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => { console.error(error.message); process.exitCode = 1; });
}
