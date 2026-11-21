import { execFile } from "node:child_process";
import { createHash, createPrivateKey, createPublicKey, randomUUID, sign as signBytes, verify as verifySignature } from "node:crypto";
import { constants, createReadStream } from "node:fs";
import { access, chmod, lstat, mkdtemp, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { desktopSlug, desktopVersion as checkedInVersion } from "../apps/desktop/version.mjs";

const root = path.resolve(import.meta.dirname, "..");
let semver;
function desktopSemver() {
  if (!semver) {
    try {
      semver = createRequire(path.join(root, "packages/shared/package.json"))("semver");
    } catch {
      throw new Error("Desktop update checks need the workspace's pinned semver; run pnpm install");
    }
  }
  return semver;
}

const execFileAsync = promisify(execFile);
const maximumUpdateUrlLength = 2048;
// DesktopDevice.appVersion is VARCHAR(40) and the shared registration schema
// caps it at 40, so a longer release version could never register its device.
const maximumUpdateVersionLength = 40;
const maximumUpdateArchiveBytes = 1 << 30;
const maximumUpdateManifestBytes = 1 << 20;
const desktopUpdateSignedDomain = "LinkSense desktop update manifest v1";

function desktopUpdateTarget(target) {
  if (typeof target !== "string" || !/^(darwin|windows)\/(arm64|amd64)$/u.test(target)) {
    throw new Error("Desktop builds require a macOS or Windows target");
  }
  return target;
}

// The build validates SemVer and never infers a predecessor. The release
// convention (never reuse or lower a published version) and MyGo's own
// ordering keep clients from downgrading.
function desktopUpdateVersion(raw, label = "LINKSENSE_DESKTOP_VERSION") {
  if (typeof raw !== "string" || raw.length === 0 || raw.length > maximumUpdateVersionLength) {
    throw new Error(`${label} must be a SemVer version such as 1.2.3 or 1.2.3-beta.1`);
  }
  let parsed;
  try {
    parsed = desktopSemver().parse(raw);
  } catch {
    parsed = null;
  }
  const normalized = parsed && `${parsed.version}${parsed.build.length ? `+${parsed.build.join(".")}` : ""}`;
  if (!parsed || raw !== normalized) {
    throw new Error(`${label} must be a SemVer version such as 1.2.3 or 1.2.3-beta.1`);
  }
  return parsed;
}

function desktopUpdateUrl(raw, { label, loopback = false, query = false, directory = false }) {
  if (!raw) return undefined;
  if (typeof raw !== "string" || raw.length > maximumUpdateUrlLength ||
    /[\s\u0000-\u001f\u007f"'\\]/u.test(raw)) {
    throw new Error(`${label} must be a bounded URL without whitespace, quotes or control characters`);
  }
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`${label} must be an absolute URL`);
  }
  const loopbackHost = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  const secure = url.protocol === "https:" || (loopback && url.protocol === "http:" && loopbackHost);
  if (!secure || url.username || url.password || url.hash || raw.includes("#") ||
    (!query && (url.search || raw.includes("?")))) {
    throw new Error(`${label} must use HTTPS${loopback ? " (or loopback HTTP)" : ""} without credentials${query ? "" : ", query"} or fragment`);
  }
  if (directory && url.pathname.replace(/\/+$/u, "").endsWith(".json")) {
    throw new Error(`${label} must be the directory that holds the update files, not a manifest URL`);
  }
  return directory ? url.href.replace(/\/+$/u, "") : url.href;
}

function desktopUpdatePublicKey(raw) {
  if (!raw) return undefined;
  if (typeof raw !== "string" || raw.length > 512) {
    throw new Error("Desktop update public key must be a base64 Ed25519 public key");
  }
  const key = Buffer.from(raw, "base64");
  if (key.length !== 32 || key.toString("base64") !== raw) {
    throw new Error("Desktop update public key must be a base64 Ed25519 public key");
  }
  return raw;
}

function desktopUpdatePrivateKeyPath(raw) {
  if (!raw) return undefined;
  if (typeof raw !== "string" || raw.length > 4096 || /[\u0000-\u001f\u007f]/u.test(raw) ||
    (!path.isAbsolute(raw) && !raw.startsWith("~/"))) {
    throw new Error("LINKSENSE_DESKTOP_UPDATE_PRIVATE_KEY_FILE must be an absolute path or start with ~/");
  }
  return raw;
}

export function desktopUpdateConfiguration(environment, target) {
  desktopUpdateTarget(target);
  const darwin = target.startsWith("darwin/");
  const version = desktopUpdateVersion(environment.LINKSENSE_DESKTOP_VERSION || checkedInVersion);
  const channel = version.prerelease.length > 0 ? "beta" : "stable";
  const publicKey = desktopUpdatePublicKey(environment.LINKSENSE_DESKTOP_UPDATE_PUBLIC_KEY);
  const stableRoot = desktopUpdateUrl(environment.LINKSENSE_DESKTOP_UPDATE_URL, {
    label: "LINKSENSE_DESKTOP_UPDATE_URL", directory: true,
  });
  const betaRoot = desktopUpdateUrl(environment.LINKSENSE_DESKTOP_UPDATE_BETA_URL, {
    label: "LINKSENSE_DESKTOP_UPDATE_BETA_URL", directory: true,
  });
  const legacyFeed = desktopUpdateUrl(environment.LINKSENSE_DESKTOP_UPDATE_FEED, {
    label: "LINKSENSE_DESKTOP_UPDATE_FEED", loopback: true,
  });
  const installerUrl = desktopUpdateUrl(environment.LINKSENSE_DESKTOP_UPDATE_INSTALLER_URL, {
    label: "LINKSENSE_DESKTOP_UPDATE_INSTALLER_URL", query: true,
  });
  const privateKey = typeof environment.MYGO_UPDATER_PRIVATE_KEY === "string"
    ? environment.MYGO_UPDATER_PRIVATE_KEY || undefined : undefined;
  const privateKeyFile = desktopUpdatePrivateKeyPath(environment.LINKSENSE_DESKTOP_UPDATE_PRIVATE_KEY_FILE);
  if (!darwin && (stableRoot || betaRoot || installerUrl || privateKeyFile)) {
    throw new Error("Signed desktop update settings are macOS-only; Windows keeps LINKSENSE_DESKTOP_UPDATE_FEED");
  }
  if (stableRoot && legacyFeed) {
    throw new Error("LINKSENSE_DESKTOP_UPDATE_URL and LINKSENSE_DESKTOP_UPDATE_FEED both set the update source; set one");
  }
  if (stableRoot && betaRoot && stableRoot === betaRoot) {
    throw new Error("LINKSENSE_DESKTOP_UPDATE_URL and LINKSENSE_DESKTOP_UPDATE_BETA_URL must be different directories");
  }
  if (betaRoot && !stableRoot) {
    throw new Error("LINKSENSE_DESKTOP_UPDATE_BETA_URL requires LINKSENSE_DESKTOP_UPDATE_URL");
  }
  if (installerUrl && !stableRoot) {
    throw new Error("LINKSENSE_DESKTOP_UPDATE_INSTALLER_URL requires LINKSENSE_DESKTOP_UPDATE_URL");
  }
  if (privateKeyFile && !stableRoot) {
    throw new Error("LINKSENSE_DESKTOP_UPDATE_PRIVATE_KEY_FILE requires LINKSENSE_DESKTOP_UPDATE_URL");
  }
  const configured = Boolean(stableRoot || legacyFeed);
  if (configured && darwin && channel === "beta" && !stableRoot) {
    throw new Error("A prerelease desktop version requires LINKSENSE_DESKTOP_UPDATE_URL");
  }
  if (configured && !publicKey) throw new Error("Desktop updates require LINKSENSE_DESKTOP_UPDATE_PUBLIC_KEY");
  if (publicKey && !configured) {
    throw new Error("LINKSENSE_DESKTOP_UPDATE_PUBLIC_KEY requires LINKSENSE_DESKTOP_UPDATE_URL or LINKSENSE_DESKTOP_UPDATE_FEED");
  }
  if (privateKey && privateKeyFile) {
    throw new Error("Set either MYGO_UPDATER_PRIVATE_KEY or LINKSENSE_DESKTOP_UPDATE_PRIVATE_KEY_FILE, not both");
  }
  const selectedRoot = stableRoot ? (channel === "beta" ? betaRoot : stableRoot) : undefined;
  if (channel === "beta" && stableRoot && !betaRoot) {
    throw new Error("A prerelease desktop version requires LINKSENSE_DESKTOP_UPDATE_BETA_URL");
  }
  const versionText = `${version.version}${version.build.length ? `+${version.build.join(".")}` : ""}`;
  const artifactNames = desktopUpdateArtifactNames(target, versionText);
  return {
    target,
    version: versionText,
    channel,
    publicKey,
    stableRoot,
    betaRoot,
    legacyFeed,
    stableFeed: stableRoot && `${stableRoot}/${artifactNames.manifest}`,
    betaFeed: betaRoot && `${betaRoot}/${artifactNames.manifest}`,
    // The raw MyGo manifest URL this candidate's channel fetches. The signed
    // envelope binds this exact URL to the manifest bytes.
    selectedFeed: selectedRoot && `${selectedRoot}/${artifactNames.manifest}`,
    selectedRoot,
    installerUrl,
    privateKey: stableRoot ? privateKey : undefined,
    privateKeyFile: stableRoot ? privateKeyFile : undefined,
    configured,
    signedArtifacts: Boolean(selectedRoot),
  };
}

export function desktopUpdateLdflags(configuration) {
  const flags = [];
  if (configuration.stableRoot) {
    flags.push(`-X main.desktopUpdateFeed=${configuration.stableFeed}`);
    if (configuration.betaRoot) flags.push(`-X main.desktopUpdateBetaFeed=${configuration.betaFeed}`);
    // The app also pins the same Ed25519 key in MyGo's packageUpdateKey; the
    // native signed-manifest check uses this copy for the `.signed` envelope.
    if (configuration.publicKey) flags.push(`-X main.desktopUpdateManifestKey=${configuration.publicKey}`);
  }
  if (configuration.installerUrl) flags.push(`-X main.desktopUpdateInstallerURL=${configuration.installerUrl}`);
  if (configuration.legacyFeed) {
    flags.push(`-X github.com/egoist/mygo.packageUpdateFeed=${configuration.legacyFeed}`);
    flags.push(`-X github.com/egoist/mygo.packageUpdateKey=${configuration.publicKey}`);
  }
  return flags.join(" ");
}

export function desktopBuildLdflags(server, configuration, existing = "") {
  if (configuration.configured && /main\.desktopUpdate(?:Feed|BetaFeed|InstallerURL|ManifestKey)=/u.test(existing)) {
    throw new Error("MYGO_LDFLAGS must not set LinkSense desktop update variables; use the documented build variables");
  }
  if (configuration.signedArtifacts && /github\.com\/egoist\/mygo\.packageUpdate(?:Feed|Key)=/u.test(existing)) {
    throw new Error("MYGO_LDFLAGS must not set MyGo package update flags when a desktop update directory is configured");
  }
  return `${existing} -X main.desktopServerURL=${server} ${desktopUpdateLdflags(configuration)}`.trim();
}

export function desktopUpdateChildEnvironment(configuration, privateKeyFile) {
  return {
    LINKSENSE_DESKTOP_UPDATE_CONFIG_URL: configuration.selectedRoot ?? "",
    LINKSENSE_DESKTOP_UPDATE_PRIVATE_KEY_FILE:
      configuration.signedArtifacts && privateKeyFile ? privateKeyFile : "",
  };
}

export function desktopUpdateArtifactNames(target, version) {
  const platform = desktopUpdateTarget(target).replace("/", "-");
  desktopUpdateVersion(version, "The desktop version");
  return {
    archive: `${desktopSlug}-${version}-${platform}.tar.gz`,
    manifest: `update-${platform}.json`,
  };
}

async function desktopUpdateFileDigest(filename) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(filename)) hash.update(chunk);
  return hash.digest();
}

function desktopUpdateSignature(value) {
  const signature = typeof value === "string" ? Buffer.from(value, "base64") : undefined;
  if (!signature || signature.length !== 64 || signature.toString("base64") !== value) {
    throw new Error("The update manifest contains an invalid Ed25519 signature");
  }
  return signature;
}

// desktopUpdateArchivePlist reads exactly one archive member to stdout. It
// avoids extracting the whole app a second time while still proving that the
// signed archive holds the bundle whose plist was verified on disk.
async function desktopUpdateArchivePlist(archive, member) {
  try {
    const { stdout } = await execFileAsync("tar", ["-xOzf", archive, member], {
      encoding: "buffer", maxBuffer: maximumUpdateManifestBytes, timeout: 30_000,
    });
    return stdout;
  } catch {
    throw new Error("The update archive does not contain the verified app bundle");
  }
}

function desktopUpdateBundleVersions(plist) {
  const versions = {};
  for (const key of ["CFBundleShortVersionString", "CFBundleVersion"]) {
    const match = new RegExp(`<key>${key}</key>\\s*<string>([^<]*)</string>`, "u").exec(plist);
    if (!match) throw new Error(`The verified app bundle Info.plist has no ${key}`);
    versions[key] = match[1];
  }
  return versions;
}

// verifyDesktopUpdateArtifacts checks the official MyGo outputs after the
// signed runtime and packaged runtime have been verified. It accepts only the
// exact names and URLs that MyGo writes for this slug, target and version.
// manifestBytes is the exact read that later gets signed.
export async function verifyDesktopUpdateArtifacts(directory, configuration, appBundle) {
  if (!configuration.signedArtifacts || !configuration.selectedRoot || !configuration.publicKey) {
    throw new Error("Desktop update artifacts require a configured update directory and public key");
  }
  const names = desktopUpdateArtifactNames(configuration.target, configuration.version);
  const platform = configuration.target.replace("/", "-");
  const archive = path.join(directory, names.archive);
  const archiveInfo = await lstat(archive).catch(() => {
    throw new Error(`MyGo did not write the signed update archive ${names.archive}`);
  });
  if (!archiveInfo.isFile() || archiveInfo.size <= 0 || archiveInfo.size > maximumUpdateArchiveBytes) {
    throw new Error(`The signed update archive ${names.archive} has an invalid size`);
  }
  const manifestInfo = await lstat(path.join(directory, names.manifest)).catch(() => {
    throw new Error(`MyGo did not write the update manifest ${names.manifest}`);
  });
  if (!manifestInfo.isFile() || manifestInfo.size <= 0 || manifestInfo.size > maximumUpdateManifestBytes) {
    throw new Error(`The update manifest ${names.manifest} has an invalid size`);
  }
  const manifestBytes = await readFile(path.join(directory, names.manifest));
  let manifest;
  try {
    manifest = JSON.parse(manifestBytes.toString("utf8"));
  } catch {
    throw new Error(`The update manifest ${names.manifest} is not valid JSON`);
  }
  if (manifest === null || typeof manifest !== "object" || Array.isArray(manifest)) {
    throw new Error(`The update manifest ${names.manifest} is not an object`);
  }
  if (manifest.version !== configuration.version) {
    throw new Error("The update manifest version does not match the candidate version");
  }
  if (manifest.url !== `${configuration.selectedRoot}/${names.archive}`) {
    throw new Error("The update manifest does not name the configured update directory");
  }
  if (manifest.size !== archiveInfo.size) throw new Error("The update manifest size does not match the archive");
  const signature = desktopUpdateSignature(manifest.signature);
  const digest = await desktopUpdateFileDigest(archive);
  const key = createPublicKey({
    key: { kty: "OKP", crv: "Ed25519", x: Buffer.from(configuration.publicKey, "base64").toString("base64url") },
    format: "jwk",
  });
  if (!verifySignature(null, digest, key, signature)) {
    throw new Error("The update archive is not signed with the configured public key");
  }
  // mygo build writes SHA256SUMS into <out>, one level above <out>/<target>.
  const sums = await readFile(path.join(path.dirname(directory), "SHA256SUMS"), "utf8").catch(() => "");
  if (!sums.split(/\r?\n/u).includes(`${digest.toString("hex")}  ${names.archive}`)) {
    throw new Error("SHA256SUMS does not record the update archive");
  }
  for (const field of ["deltas", "previous"]) {
    if (manifest[field] !== undefined && !Array.isArray(manifest[field])) {
      throw new Error("The update manifest has an invalid update file list");
    }
  }
  for (const delta of manifest.deltas ?? []) {
    if (delta === null || typeof delta !== "object" || typeof delta.from !== "string") {
      throw new Error("The update manifest has an invalid delta entry");
    }
    desktopUpdateVersion(delta.from, "The update manifest delta version");
    if (desktopSemver().gte(delta.from, configuration.version)) {
      throw new Error("The update manifest has an invalid delta entry");
    }
    const name = `${desktopSlug}-${delta.from}-to-${configuration.version}-${platform}.delta`;
    if (delta.url !== `${configuration.selectedRoot}/${name}`) {
      throw new Error("The update manifest delta does not match the configured update directory");
    }
    if (!Number.isSafeInteger(delta.size) || delta.size <= 0) {
      throw new Error("The update manifest delta has an invalid size");
    }
    const deltaPath = path.join(directory, name);
    const deltaInfo = await lstat(deltaPath).catch(() => undefined);
    if (!deltaInfo?.isFile() || deltaInfo.size !== delta.size) {
      throw new Error("The update manifest delta is missing or has the wrong size");
    }
    const deltaSignature = desktopUpdateSignature(delta.signature);
    if (!verifySignature(null, await desktopUpdateFileDigest(deltaPath), key, deltaSignature)) {
      throw new Error("The update delta is not signed with the configured public key");
    }
  }
  for (const previous of manifest.previous ?? []) {
    if (previous === null || typeof previous !== "object" || typeof previous.version !== "string") {
      throw new Error("The update manifest has an invalid previous archive");
    }
    desktopUpdateVersion(previous.version, "The update manifest previous version");
    if (desktopSemver().gte(previous.version, configuration.version)) {
      throw new Error("The update manifest has an invalid previous archive");
    }
    const name = `${desktopSlug}-${previous.version}-${platform}.tar.gz`;
    if (previous.url !== `${configuration.selectedRoot}/${name}` ||
      !Number.isSafeInteger(previous.size) || previous.size <= 0) {
      throw new Error("The update manifest previous archive does not match the configured update directory");
    }
    desktopUpdateSignature(previous.signature);
  }
  if (typeof appBundle !== "string" || !appBundle) {
    throw new Error("Verifying signed update artifacts requires the verified app bundle");
  }
  let bundlePlist;
  try {
    bundlePlist = await readFile(path.join(appBundle, "Contents", "Info.plist"));
  } catch {
    throw new Error("The verified app bundle has no readable Info.plist");
  }
  const versions = desktopUpdateBundleVersions(bundlePlist.toString("utf8"));
  if (versions.CFBundleShortVersionString !== configuration.version ||
    versions.CFBundleVersion !== configuration.version) {
    throw new Error("The verified app bundle version does not match the candidate version");
  }
  // MyGo archives the stage after signing it; compare the one plist member
  // instead of extracting the whole bundle again.
  const archivedPlist = await desktopUpdateArchivePlist(archive,
    `${path.basename(appBundle)}/Contents/Info.plist`);
  if (!archivedPlist.equals(bundlePlist)) {
    throw new Error("The update archive does not contain the verified app bundle");
  }
  return { manifest, manifestBytes };
}

// desktopUpdateSigningKey imports MyGo's existing base64 Ed25519 private key
// (seed followed by the public key) and proves it is the pair of the key
// already pinned in the build. The key text stays inside this step.
async function desktopUpdateSigningKey(privateKeyFile, publicKey) {
  const filename = privateKeyFile.startsWith("~/")
    ? path.join(homedir(), privateKeyFile.slice(2)) : privateKeyFile;
  let text;
  try {
    text = (await readFile(filename, "utf8")).trim();
  } catch {
    throw new Error("The update signing key file is not readable");
  }
  const raw = Buffer.from(text, "base64");
  if (text.length > 512 || raw.length !== 64 || raw.toString("base64") !== text) {
    throw new Error("The update signing key is not a base64 Ed25519 private key");
  }
  let key;
  try {
    key = createPrivateKey({
      key: {
        kty: "OKP", crv: "Ed25519",
        d: raw.subarray(0, 32).toString("base64url"),
        x: raw.subarray(32).toString("base64url"),
      },
      format: "jwk",
    });
  } catch {
    raw.fill(0);
    throw new Error("The update signing key is not a valid Ed25519 private key");
  }
  const derived = Buffer.from(createPublicKey(key).export({ format: "jwk" }).x, "base64url");
  const configured = Buffer.from(publicKey, "base64");
  raw.fill(0);
  if (configured.length !== 32 || !derived.equals(configured)) {
    throw new Error("The update signing key does not match the configured update public key");
  }
  return key;
}

// signDesktopUpdateManifest writes the envelope the modern client fetches:
// base64 Ed25519 signature over the domain, configured raw feed URL and exact
// manifest bytes, then LF and those same bytes. It runs only after the
// package, MyGo artifacts and packaged runtime smoke have been verified. The
// unsigned manifest stays in place for MyGo's future delta builds.
export async function signDesktopUpdateManifest(directory, configuration, manifestBytes, privateKeyFile) {
  if (!configuration.signedArtifacts || !configuration.selectedRoot || !configuration.selectedFeed || !configuration.publicKey) {
    throw new Error("Signing an update manifest requires a configured update directory and public key");
  }
  if (!privateKeyFile) throw new Error("Signing an update manifest requires MyGo's update signing key");
  if (!Buffer.isBuffer(manifestBytes) || manifestBytes.length === 0 || manifestBytes.length > maximumUpdateManifestBytes) {
    throw new Error("The verified update manifest bytes are invalid");
  }
  const names = desktopUpdateArtifactNames(configuration.target, configuration.version);
  const manifestPath = path.join(directory, names.manifest);
  const current = await readFile(manifestPath).catch(() => {
    throw new Error(`MyGo's update manifest ${names.manifest} is missing`);
  });
  if (!current.equals(manifestBytes)) {
    throw new Error("The update manifest changed after verification; refusing to sign it");
  }
  const key = await desktopUpdateSigningKey(privateKeyFile, configuration.publicKey);
  const message = Buffer.concat([
    Buffer.from(`${desktopUpdateSignedDomain}\n${configuration.selectedFeed}\n`, "utf8"),
    manifestBytes,
  ]);
  const signature = signBytes(null, message, key);
  const envelope = Buffer.concat([Buffer.from(`${signature.toString("base64")}\n`, "utf8"), manifestBytes]);
  const target = path.join(directory, `${names.manifest}.signed`);
  const temporary = path.join(directory, `.${names.manifest}.${randomUUID()}.tmp`);
  try {
    await writeFile(temporary, envelope, { mode: 0o644, flag: "wx" });
    await chmod(temporary, 0o644);
    await rename(temporary, target);
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
  return target;
}

export async function stageDesktopUpdatePrivateKey(raw) {
  if (!raw) return undefined;
  const text = typeof raw === "string" ? raw.trim() : "";
  const key = Buffer.from(text, "base64");
  if (text.length > 512 || key.length !== 64 || key.toString("base64") !== text) {
    throw new Error("The update signing key is not a base64 Ed25519 private key");
  }
  const directory = await mkdtemp(path.join(tmpdir(), "linksense-update-key-"));
  try {
    await chmod(directory, 0o700);
    const file = path.join(directory, "mygo-update.key");
    await writeFile(file, `${text}\n`, { mode: 0o600, flag: "wx" });
    return { file, cleanup: () => rm(directory, { recursive: true, force: true }) };
  } catch (error) {
    await rm(directory, { recursive: true, force: true });
    throw error;
  }
}

export async function desktopUpdateKeyFile(raw) {
  if (!raw) return undefined;
  const file = raw.startsWith("~/") ? path.join(homedir(), raw.slice(2)) : raw;
  let info;
  try {
    info = await stat(file);
    await access(file, constants.R_OK);
  } catch {
    throw new Error("LINKSENSE_DESKTOP_UPDATE_PRIVATE_KEY_FILE does not name a readable file");
  }
  if (!info.isFile()) {
    throw new Error("LINKSENSE_DESKTOP_UPDATE_PRIVATE_KEY_FILE must name a regular file");
  }
  return raw;
}

// The release boundary also requires the fixed manual installer page:
// read-only installations cannot check or install in place, and a release
// without that page would have no fallback. Development feeds may omit it.
export function requireDesktopReleaseUpdateSigning(configuration, privateKeyFile, release) {
  if (release && configuration.signedArtifacts && !privateKeyFile) {
    throw new Error("A release build with a desktop update directory requires MYGO_UPDATER_PRIVATE_KEY or LINKSENSE_DESKTOP_UPDATE_PRIVATE_KEY_FILE so MyGo can sign the update archive and manifest");
  }
  if (release && configuration.signedArtifacts && !configuration.installerUrl) {
    throw new Error("A release build with a desktop update directory requires LINKSENSE_DESKTOP_UPDATE_INSTALLER_URL as the manual fallback for read-only installations");
  }
}
