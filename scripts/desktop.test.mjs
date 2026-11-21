import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash, createPublicKey, generateKeyPairSync, sign, verify } from "node:crypto";
import { chmod, mkdir, mkdtemp, readFile, readdir, realpath, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { desktopBuildServerUrl, desktopChildEnvironment, desktopCommandInvocation, desktopMacosReleaseTeam, desktopMacosSigningRequirement, desktopMygoBuildArguments, desktopTarget, desktopTestArguments, stageDesktopDependencyNotices, stageDesktopMacosRelease, stageDesktopNotice, validateDesktopTarget } from "./desktop.mjs";
import { desktopBuildLdflags, desktopUpdateArtifactNames, desktopUpdateChildEnvironment, desktopUpdateConfiguration, desktopUpdateKeyFile, desktopUpdateLdflags, requireDesktopReleaseUpdateSigning, signDesktopUpdateManifest, stageDesktopUpdatePrivateKey, verifyDesktopUpdateArtifacts } from "./desktop-update.mjs";
import { desktopSlug, desktopVersion } from "../apps/desktop/version.mjs";
import { buildDesktopAnnotationPreload, desktopAnnotationPreloadOutput } from "./desktop-preload.mjs";

function ed25519Keys() {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const jwk = privateKey.export({ format: "jwk" });
  return {
    publicKey: Buffer.from(publicKey.export({ format: "jwk" }).x, "base64url").toString("base64"),
    privateKey: Buffer.concat([Buffer.from(jwk.d, "base64url"), Buffer.from(jwk.x, "base64url")]).toString("base64"),
    nodePrivateKey: privateKey,
  };
}

function inspectDesktopConfig(release, command, extra = {}) {
  const configFile = new URL("../apps/desktop/mygo.config.ts", import.meta.url).href;
  const environment = { ...process.env, LINKSENSE_DESKTOP_MACOS_RELEASE: release, ...extra };
  for (const name of ["MYGO_UPDATER_PRIVATE_KEY", "LINKSENSE_DESKTOP_VERSION", "LINKSENSE_DESKTOP_UPDATE_CONFIG_URL", "LINKSENSE_DESKTOP_UPDATE_PUBLIC_KEY", "LINKSENSE_DESKTOP_UPDATE_PRIVATE_KEY_FILE"]) {
    if (!(name in extra)) delete environment[name];
  }
  return JSON.parse(execFileSync(process.execPath, ["--no-warnings", "--input-type=module", "-e",
    `import config from ${JSON.stringify(configFile)}; console.log(JSON.stringify(config({ command: ${JSON.stringify(command)} })));`],
    { env: environment, encoding: "utf8" }));
}

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

test("legacy update feeds remain check-only and keep the old linker contract", () => {
  const key = Buffer.alloc(32, 1).toString("base64");
  const feed = "https://updates.example.test/update-darwin-arm64.json";
  const legacy = desktopUpdateConfiguration({
    LINKSENSE_DESKTOP_UPDATE_FEED: feed,
    LINKSENSE_DESKTOP_UPDATE_PUBLIC_KEY: key,
  }, "darwin/arm64");
  assert.equal(legacy.configured, true);
  assert.equal(legacy.signedArtifacts, false);
  assert.equal(legacy.selectedRoot, undefined);
  assert.equal(legacy.legacyFeed, feed);
  assert.equal(legacy.stableFeed, undefined);
  const flags = desktopUpdateLdflags(legacy);
  assert.match(flags, /packageUpdateFeed=https:\/\/updates\.example\.test/u);
  assert.doesNotMatch(flags, /main\.desktopUpdateFeed/u);
  assert.doesNotMatch(flags, /main\.desktopUpdateManifestKey/u);
  const local = desktopUpdateConfiguration({
    LINKSENSE_DESKTOP_UPDATE_FEED: "http://127.0.0.1:8080/update-darwin-arm64.json",
    LINKSENSE_DESKTOP_UPDATE_PUBLIC_KEY: key,
  }, "darwin/arm64");
  assert.equal(local.legacyFeed, "http://127.0.0.1:8080/update-darwin-arm64.json");
  for (const invalid of [
    { LINKSENSE_DESKTOP_UPDATE_FEED: feed },
    { LINKSENSE_DESKTOP_UPDATE_FEED: "https://user@updates.example.test/update.json", LINKSENSE_DESKTOP_UPDATE_PUBLIC_KEY: key },
    { LINKSENSE_DESKTOP_UPDATE_FEED: "http://updates.example.test/update.json", LINKSENSE_DESKTOP_UPDATE_PUBLIC_KEY: key },
    { LINKSENSE_DESKTOP_UPDATE_FEED: feed + " -X main.host=other", LINKSENSE_DESKTOP_UPDATE_PUBLIC_KEY: key },
    { LINKSENSE_DESKTOP_UPDATE_PUBLIC_KEY: key },
  ]) {
    assert.throws(() => desktopUpdateConfiguration(invalid, "darwin/arm64"));
  }
  const windows = desktopUpdateConfiguration({
    LINKSENSE_DESKTOP_UPDATE_FEED: feed,
    LINKSENSE_DESKTOP_UPDATE_PUBLIC_KEY: key,
  }, "windows/amd64");
  assert.equal(windows.legacyFeed, feed);
  assert.doesNotMatch(desktopUpdateLdflags(windows), /main\.desktopUpdateFeed/u);
  assert.match(desktopUpdateLdflags(windows), /packageUpdateFeed/u);
  assert.throws(() => desktopUpdateConfiguration({
    LINKSENSE_DESKTOP_UPDATE_URL: "https://updates.example.test/stable",
    LINKSENSE_DESKTOP_UPDATE_PUBLIC_KEY: key,
  }, "windows/amd64"), /macOS-only/u);
  const windowsPrerelease = desktopUpdateConfiguration({
    LINKSENSE_DESKTOP_VERSION: "1.2.3-beta.1",
  }, "windows/amd64");
  assert.equal(windowsPrerelease.version, "1.2.3-beta.1");
  assert.equal(windowsPrerelease.signedArtifacts, false);
});

test("desktop versions are strict SemVer and select the channel", () => {
  assert.equal(desktopUpdateConfiguration({}, "darwin/arm64").version, desktopVersion);
  assert.equal(desktopUpdateConfiguration({}, "darwin/arm64").channel, "stable");
  for (const invalid of ["v1.2.3", "1.2", "1.2.3.4", "01.2.3", "1.02.3", "1.2.03",
    "1.2.3-01", "1.2.3+", "1.2.3 ", "1.2.3\n", "1.2.3 -X main.other=value"]) {
    assert.throws(() => desktopUpdateConfiguration({ LINKSENSE_DESKTOP_VERSION: invalid }, "darwin/arm64"), /SemVer/u);
  }
  // DesktopDevice.appVersion is VARCHAR(40): the limit is inclusive.
  const forty = `1.2.3-${"a".repeat(34)}`;
  assert.equal(forty.length, 40);
  assert.equal(desktopUpdateConfiguration({ LINKSENSE_DESKTOP_VERSION: forty }, "darwin/arm64").version, forty);
  const fortyOne = `1.2.3-${"a".repeat(35)}`;
  assert.equal(fortyOne.length, 41);
  assert.throws(() => desktopUpdateConfiguration({ LINKSENSE_DESKTOP_VERSION: fortyOne }, "darwin/arm64"), /SemVer/u);
  const { publicKey } = ed25519Keys();
  const base = {
    LINKSENSE_DESKTOP_UPDATE_URL: "https://updates.example.test/stable",
    LINKSENSE_DESKTOP_UPDATE_BETA_URL: "https://updates.example.test/beta",
    LINKSENSE_DESKTOP_UPDATE_PUBLIC_KEY: publicKey,
  };
  assert.equal(desktopUpdateConfiguration({ ...base, LINKSENSE_DESKTOP_VERSION: "1.2.3" }, "darwin/arm64").channel, "stable");
  assert.equal(desktopUpdateConfiguration({ ...base, LINKSENSE_DESKTOP_VERSION: "1.2.3-beta.1" }, "darwin/arm64").channel, "beta");
  assert.equal(desktopUpdateConfiguration({ ...base, LINKSENSE_DESKTOP_VERSION: "0.1.0+ci.1" }, "darwin/arm64").version, "0.1.0+ci.1");
  assert.equal(desktopUpdateConfiguration({ ...base, LINKSENSE_DESKTOP_VERSION: "1.2.3+ci.5" }, "darwin/arm64").channel, "stable");
});

test("update roots and installer URLs reject unsafe or ambiguous values", () => {
  const { publicKey } = ed25519Keys();
  const base = { LINKSENSE_DESKTOP_UPDATE_PUBLIC_KEY: publicKey };
  const root = "https://updates.example.test/stable";
  assert.equal(desktopUpdateConfiguration({ ...base, LINKSENSE_DESKTOP_UPDATE_URL: `${root}/` }, "darwin/arm64").stableRoot, root);
  assert.equal(desktopUpdateConfiguration({
    ...base, LINKSENSE_DESKTOP_UPDATE_URL: root,
    LINKSENSE_DESKTOP_UPDATE_INSTALLER_URL: "https://linksense.example.test/download?channel=stable",
  }, "darwin/arm64").installerUrl, "https://linksense.example.test/download?channel=stable");
  for (const invalid of ["http://updates.example.test", "http://localhost:8080/stable",
    "https://user:pass@updates.example.test",
    "https://updates.example.test/stable?x=1", "https://updates.example.test/stable#x",
    "https://updates.example.test/stable -X main.other=value",
    "https://updates.example.test/update-darwin-arm64.json",
    "https://updates.example.test/stable\u0000"]) {
    assert.throws(() => desktopUpdateConfiguration({ ...base, LINKSENSE_DESKTOP_UPDATE_URL: invalid }, "darwin/arm64"));
  }
  for (const invalid of ["http://linksense.example.test/download", "https://user@linksense.example.test/download",
    "https://linksense.example.test/download#fragment", "https://linksense.example.test/download -X main.other=value"]) {
    assert.throws(() => desktopUpdateConfiguration({
      ...base, LINKSENSE_DESKTOP_UPDATE_URL: root, LINKSENSE_DESKTOP_UPDATE_INSTALLER_URL: invalid,
    }, "darwin/arm64"));
  }
  assert.throws(() => desktopUpdateConfiguration({
    ...base, LINKSENSE_DESKTOP_UPDATE_URL: root, LINKSENSE_DESKTOP_UPDATE_BETA_URL: `${root}/`,
  }, "darwin/arm64"));
  assert.throws(() => desktopUpdateConfiguration({
    ...base, LINKSENSE_DESKTOP_UPDATE_URL: root,
    LINKSENSE_DESKTOP_UPDATE_FEED: "https://updates.example.test/update-darwin-arm64.json",
  }, "darwin/arm64"));
  assert.throws(() => desktopUpdateConfiguration({
    ...base, LINKSENSE_DESKTOP_UPDATE_BETA_URL: "https://updates.example.test/beta",
  }, "darwin/arm64"), /requires LINKSENSE_DESKTOP_UPDATE_URL/u);
  assert.throws(() => desktopUpdateConfiguration({
    ...base, LINKSENSE_DESKTOP_UPDATE_INSTALLER_URL: "https://linksense.example.test/download",
  }, "darwin/arm64"), /requires LINKSENSE_DESKTOP_UPDATE_URL/u);
});

test("stable and beta directories drive feeds and signing", () => {
  const { publicKey } = ed25519Keys();
  const base = {
    LINKSENSE_DESKTOP_UPDATE_URL: "https://updates.example.test/stable",
    LINKSENSE_DESKTOP_UPDATE_BETA_URL: "https://updates.example.test/beta",
    LINKSENSE_DESKTOP_UPDATE_PUBLIC_KEY: publicKey,
  };
  const stable = desktopUpdateConfiguration(base, "darwin/arm64");
  assert.equal(stable.channel, "stable");
  assert.equal(stable.selectedRoot, base.LINKSENSE_DESKTOP_UPDATE_URL);
  assert.equal(stable.stableFeed, "https://updates.example.test/stable/update-darwin-arm64.json");
  assert.equal(stable.betaFeed, "https://updates.example.test/beta/update-darwin-arm64.json");
  assert.equal(stable.selectedFeed, stable.stableFeed);
  assert.match(desktopUpdateLdflags(stable), /main\.desktopUpdateFeed=/u);
  assert.match(desktopUpdateLdflags(stable), /main\.desktopUpdateManifestKey=/u);
  assert.doesNotMatch(desktopUpdateLdflags(stable), /packageUpdateFeed/u);
  assert.deepEqual(desktopUpdateChildEnvironment(stable, "/secure/key"),
    { LINKSENSE_DESKTOP_UPDATE_CONFIG_URL: base.LINKSENSE_DESKTOP_UPDATE_URL, LINKSENSE_DESKTOP_UPDATE_PRIVATE_KEY_FILE: "/secure/key" });
  const beta = desktopUpdateConfiguration({ ...base, LINKSENSE_DESKTOP_VERSION: "1.2.3-beta.1" }, "darwin/arm64");
  assert.equal(beta.channel, "beta");
  assert.equal(beta.selectedRoot, base.LINKSENSE_DESKTOP_UPDATE_BETA_URL);
  assert.equal(beta.selectedFeed, beta.betaFeed);
  assert.match(desktopUpdateLdflags(beta), /main\.desktopUpdateBetaFeed=/u);
  assert.match(desktopUpdateLdflags(beta), /main\.desktopUpdateManifestKey=/u);
  assert.throws(() => desktopUpdateConfiguration({
    ...base, LINKSENSE_DESKTOP_VERSION: "1.2.3-beta.1", LINKSENSE_DESKTOP_UPDATE_BETA_URL: undefined,
  }, "darwin/arm64"), /BETA_URL/u);
  assert.throws(() => desktopUpdateConfiguration({
    ...base, LINKSENSE_DESKTOP_UPDATE_URL: undefined,
  }, "darwin/arm64"), /BETA_URL requires/u);
  assert.throws(() => desktopUpdateConfiguration(base, "windows/amd64"), /macOS-only/u);
});

test("the private signing key stays out of child environments and lands in a 0600 file", async () => {
  const { publicKey, privateKey } = ed25519Keys();
  const configuration = desktopUpdateConfiguration({
    LINKSENSE_DESKTOP_UPDATE_URL: "https://updates.example.test/stable",
    LINKSENSE_DESKTOP_UPDATE_PUBLIC_KEY: publicKey,
    MYGO_UPDATER_PRIVATE_KEY: privateKey,
  }, "darwin/arm64");
  const child = desktopUpdateChildEnvironment(configuration, "/secure/key");
  assert.ok(!JSON.stringify(child).includes(privateKey));
  assert.throws(() => desktopUpdateConfiguration({
    LINKSENSE_DESKTOP_UPDATE_URL: "https://updates.example.test/stable",
    LINKSENSE_DESKTOP_UPDATE_PUBLIC_KEY: publicKey,
    MYGO_UPDATER_PRIVATE_KEY: privateKey,
    LINKSENSE_DESKTOP_UPDATE_PRIVATE_KEY_FILE: "/secure/key",
  }, "darwin/arm64"), /not both/u);
  assert.ok(!("MYGO_UPDATER_PRIVATE_KEY" in desktopChildEnvironment({ ...process.env, MYGO_UPDATER_PRIVATE_KEY: privateKey })));
  const staged = await stageDesktopUpdatePrivateKey(privateKey);
  try {
    assert.equal((await stat(staged.file)).mode & 0o777, 0o600);
    assert.equal(await readFile(staged.file, "utf8"), `${privateKey}\n`);
    assert.equal(await desktopUpdateKeyFile(staged.file), staged.file);
  } finally {
    await staged.cleanup();
  }
  await assert.rejects(stat(staged.file));
  await assert.rejects(desktopUpdateKeyFile("/definitely/not/a/linksense-key"), /readable file/u);
  await assert.rejects(stageDesktopUpdatePrivateKey("invalid"), /base64 Ed25519 private key/u);
});

test("verified update artifacts match MyGo's exact archive, delta and manifest names", async () => {
  const { publicKey, nodePrivateKey } = ed25519Keys();
  const stage = await mkdtemp(path.join(tmpdir(), "linksense-update-artifacts-"));
  const directory = path.join(stage, "darwin-arm64");
  await mkdir(directory);
  const target = "darwin/arm64";
  const version = "1.2.3";
  const root = "https://updates.example.test/stable";
  const names = desktopUpdateArtifactNames(target, version);
  assert.deepEqual(names, {
    archive: "linksense-desktop-1.2.3-darwin-arm64.tar.gz",
    manifest: "update-darwin-arm64.json",
  });
  assert.deepEqual(desktopUpdateArtifactNames("windows/amd64", version), {
    archive: "linksense-desktop-1.2.3-windows-amd64.tar.gz",
    manifest: "update-windows-amd64.json",
  });
  assert.deepEqual(desktopUpdateArtifactNames(target, "1.2.3+build.5"), {
    archive: "linksense-desktop-1.2.3+build.5-darwin-arm64.tar.gz",
    manifest: "update-darwin-arm64.json",
  });
  const app = path.join(directory, "LinkSense.app");
  const plistPath = path.join(app, "Contents", "Info.plist");
  const plist = `<?xml version="1.0" encoding="UTF-8"?>\n<plist version="1.0">\n<dict>\n` +
    `<key>CFBundleShortVersionString</key>\n<string>${version}</string>\n` +
    `<key>CFBundleVersion</key>\n<string>${version}</string>\n</dict>\n</plist>\n`;
  await mkdir(path.join(app, "Contents"), { recursive: true });
  await writeFile(plistPath, plist);
  const archivePath = path.join(directory, names.archive);
  execFileSync("tar", ["-czf", archivePath, "-C", directory, "LinkSense.app"]);
  const bytes = await readFile(archivePath);
  const deltaName = "linksense-desktop-1.2.2-to-1.2.3-darwin-arm64.delta";
  const deltaBytes = Buffer.from("delta fixture");
  const previousName = "linksense-desktop-1.2.2-darwin-arm64.tar.gz";
  const delta = {
    from: "1.2.2",
    url: `${root}/${deltaName}`,
    size: deltaBytes.length,
    signature: sign(null, createHash("sha256").update(deltaBytes).digest(), nodePrivateKey).toString("base64"),
  };
  const previous = {
    version: "1.2.2",
    url: `${root}/${previousName}`,
    size: 10,
    signature: Buffer.alloc(64, 3).toString("base64"),
  };
  const manifest = {
    version,
    url: `${root}/${names.archive}`,
    size: bytes.length,
    signature: sign(null, createHash("sha256").update(bytes).digest(), nodePrivateKey).toString("base64"),
    deltas: [delta],
    previous: [previous],
  };
  const configuration = { target, version, publicKey, selectedRoot: root, signedArtifacts: true };
  const write = async (next = manifest, archive = bytes) => {
    await writeFile(path.join(directory, names.archive), archive);
    await writeFile(path.join(directory, names.manifest), JSON.stringify(next));
    await writeFile(path.join(directory, deltaName), deltaBytes);
    await writeFile(path.join(stage, "SHA256SUMS"),
      `${createHash("sha256").update(archive).digest("hex")}  ${names.archive}\n`);
  };
  try {
    await write();
    const verified = await verifyDesktopUpdateArtifacts(directory, configuration, app);
    assert.deepEqual(verified.manifest, manifest);
    assert.ok(verified.manifestBytes.equals(await readFile(path.join(directory, names.manifest))));
    for (const next of [
      { ...manifest, version: "1.2.4" },
      { ...manifest, url: `${root}/other.tar.gz` },
      { ...manifest, size: bytes.length + 1 },
      { ...manifest, signature: "invalid" },
      { ...manifest, signature: `${manifest.signature.slice(0, -4)}AAAA` },
      { ...manifest, deltas: [{ ...delta, url: `${root}/nested/${deltaName}` }] },
      { ...manifest, deltas: [{ ...delta, url: `${root}/..%2F${deltaName}` }] },
      { ...manifest, deltas: [{ ...delta, signature: "invalid" }] },
      { ...manifest, previous: [{ ...previous, url: `${root}/nested/${previousName}` }] },
      { ...manifest, previous: [{ ...previous, version: "1.2.3" }] },
    ]) {
      await write(next);
      await assert.rejects(verifyDesktopUpdateArtifacts(directory, configuration, app));
    }
    await write();
    await rm(path.join(directory, deltaName));
    await assert.rejects(verifyDesktopUpdateArtifacts(directory, configuration, app), /missing or has the wrong size/u);
    const tampered = Buffer.from(bytes);
    tampered[0] ^= 0xff;
    await write(manifest, tampered);
    await assert.rejects(verifyDesktopUpdateArtifacts(directory, configuration, app), /not signed/u);
    await write();
    await writeFile(path.join(stage, "SHA256SUMS"), "");
    await assert.rejects(verifyDesktopUpdateArtifacts(directory, configuration, app), /SHA256SUMS/u);
    await write();
    await assert.rejects(verifyDesktopUpdateArtifacts(directory, configuration), /verified app bundle/u);
    await writeFile(plistPath, plist.replace("<string>1.2.3</string>", "<string>1.2.4</string>"));
    await assert.rejects(verifyDesktopUpdateArtifacts(directory, configuration, app), /candidate version/u);
    await writeFile(plistPath, plist.replace("</dict>", "<key>Extra</key><string>1</string>\n</dict>"));
    await assert.rejects(verifyDesktopUpdateArtifacts(directory, configuration, app), /does not contain the verified app bundle/u);
  } finally {
    await rm(stage, { recursive: true, force: true });
  }
});

test("the verified manifest is signed last with MyGo's key and exact bytes", async () => {
  const { publicKey, privateKey } = ed25519Keys();
  const stage = await mkdtemp(path.join(tmpdir(), "linksense-update-signed-"));
  const directory = path.join(stage, "darwin-arm64");
  await mkdir(directory);
  const target = "darwin/arm64";
  const version = "1.2.3";
  const root = "https://updates.example.test/stable";
  const names = desktopUpdateArtifactNames(target, version);
  const manifestBytes = Buffer.from(`${JSON.stringify({
    version,
    url: `${root}/${names.archive}`,
    size: 1,
    signature: Buffer.alloc(64, 1).toString("base64"),
  }, null, 2)}\n`);
  const manifestPath = path.join(directory, names.manifest);
  await writeFile(manifestPath, manifestBytes);
  const keyFile = path.join(stage, "mygo-update.key");
  await writeFile(keyFile, `${privateKey}\n`, { mode: 0o600 });
  const configuration = {
    target, version, publicKey, selectedRoot: root,
    selectedFeed: `${root}/${names.manifest}`, signedArtifacts: true,
  };
  try {
    const output = await signDesktopUpdateManifest(directory, configuration, manifestBytes, keyFile);
    assert.equal(output, `${manifestPath}.signed`);
    const envelope = await readFile(output);
    const split = envelope.indexOf(0x0a);
    const signature = envelope.subarray(0, split).toString("utf8");
    const signatureBytes = Buffer.from(signature, "base64");
    assert.equal(signatureBytes.length, 64);
    assert.equal(signatureBytes.toString("base64"), signature);
    assert.ok(envelope.subarray(split + 1).equals(manifestBytes));
    const publicKeyObject = createPublicKey({
      key: { kty: "OKP", crv: "Ed25519", x: Buffer.from(publicKey, "base64").toString("base64url") },
      format: "jwk",
    });
    const message = Buffer.concat([
      Buffer.from(`LinkSense desktop update manifest v1\n${configuration.selectedFeed}\n`, "utf8"), manifestBytes,
    ]);
    assert.ok(verify(null, message, publicKeyObject, signatureBytes));
    // The signature binds the configured raw manifest URL, not another channel.
    const otherFeed = Buffer.concat([
      Buffer.from(`LinkSense desktop update manifest v1\nhttps://updates.example.test/beta/${names.manifest}\n`, "utf8"),
      manifestBytes,
    ]);
    assert.ok(!verify(null, otherFeed, publicKeyObject, signatureBytes));
    const other = ed25519Keys();
    const otherKeyFile = path.join(stage, "other.key");
    await writeFile(otherKeyFile, `${other.privateKey}\n`, { mode: 0o600 });
    await assert.rejects(signDesktopUpdateManifest(directory, configuration, manifestBytes, otherKeyFile),
      /does not match/u);
    await assert.rejects(signDesktopUpdateManifest(directory, configuration, Buffer.from("{}\n"), keyFile),
      /changed after verification/u);
    await assert.rejects(signDesktopUpdateManifest(directory, configuration, manifestBytes), /signing key/u);
    await assert.rejects(signDesktopUpdateManifest(directory, { ...configuration, selectedFeed: undefined },
      manifestBytes, keyFile), /configured update directory/u);
    const invalidKeyFile = path.join(stage, "invalid.key");
    await writeFile(invalidKeyFile, "invalid\n", { mode: 0o600 });
    await assert.rejects(signDesktopUpdateManifest(directory, configuration, manifestBytes, invalidKeyFile),
      /base64 Ed25519 private key/u);
    assert.deepEqual((await readdir(directory)).filter(file => file.includes(".tmp")), []);
  } finally {
    await rm(stage, { recursive: true, force: true });
  }
});

test("MYGO_LDFLAGS carries public values but cannot override update sources", () => {
  const { publicKey } = ed25519Keys();
  const configuration = desktopUpdateConfiguration({
    LINKSENSE_DESKTOP_UPDATE_URL: "https://updates.example.test/stable",
    LINKSENSE_DESKTOP_UPDATE_PUBLIC_KEY: publicKey,
  }, "darwin/arm64");
  const flags = desktopBuildLdflags("https://linksense.example.test", configuration, "-X main.unrelated=1");
  assert.match(flags, /^-X main\.unrelated=1 -X main\.desktopServerURL=https:\/\/linksense\.example\.test/u);
  assert.match(flags, /main\.desktopUpdateFeed=https:\/\/updates\.example\.test\/stable/u);
  assert.match(flags, new RegExp(`main\\.desktopUpdateManifestKey=${publicKey.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")}`, "u"));
  assert.doesNotMatch(flags, /MYGO_UPDATER_PRIVATE_KEY/u);
  assert.throws(() => desktopBuildLdflags("https://linksense.example.test", configuration,
    "-X main.desktopUpdateFeed=https://evil.example.test/update.json"), /must not set LinkSense/u);
  assert.throws(() => desktopBuildLdflags("https://linksense.example.test", configuration,
    `-X main.desktopUpdateManifestKey=${publicKey}`), /must not set LinkSense/u);
  assert.throws(() => desktopBuildLdflags("https://linksense.example.test", configuration,
    "-X github.com/egoist/mygo.packageUpdateKey=unexpected"), /package update flags/u);
  const legacy = desktopUpdateConfiguration({
    LINKSENSE_DESKTOP_UPDATE_FEED: "https://updates.example.test/update-darwin-arm64.json",
    LINKSENSE_DESKTOP_UPDATE_PUBLIC_KEY: publicKey,
  }, "darwin/arm64");
  const legacyFlags = desktopBuildLdflags("https://linksense.example.test", legacy, "-X github.com/egoist/mygo.other=1");
  assert.match(legacyFlags, /packageUpdateFeed=https:\/\/updates\.example\.test/u);
  assert.doesNotMatch(legacyFlags, /main\.desktopUpdateFeed/u);
});

test("release builds require update signing and a manual installer URL but never request MyGo's upload", () => {
  const { publicKey } = ed25519Keys();
  const base = {
    LINKSENSE_DESKTOP_UPDATE_URL: "https://updates.example.test/stable",
    LINKSENSE_DESKTOP_UPDATE_PUBLIC_KEY: publicKey,
  };
  const withoutInstaller = desktopUpdateConfiguration(base, "darwin/arm64");
  assert.throws(() => requireDesktopReleaseUpdateSigning(withoutInstaller, "/secure/key", true),
    /LINKSENSE_DESKTOP_UPDATE_INSTALLER_URL/u);
  const configuration = desktopUpdateConfiguration({
    ...base,
    LINKSENSE_DESKTOP_UPDATE_INSTALLER_URL: "https://linksense.example.test/download",
  }, "darwin/arm64");
  assert.throws(() => requireDesktopReleaseUpdateSigning(configuration, undefined, true), /sign the update archive/u);
  requireDesktopReleaseUpdateSigning(configuration, "/secure/key", true);
  // Development/test update feeds may omit the manual installer page.
  requireDesktopReleaseUpdateSigning(withoutInstaller, undefined, false);
  requireDesktopReleaseUpdateSigning(withoutInstaller, "/secure/key", false);
  // A release without an update directory and legacy check-only builds are unchanged.
  requireDesktopReleaseUpdateSigning(desktopUpdateConfiguration({}, "darwin/arm64"), undefined, true);
  const legacy = desktopUpdateConfiguration({
    LINKSENSE_DESKTOP_UPDATE_FEED: "https://updates.example.test/update-darwin-arm64.json",
    LINKSENSE_DESKTOP_UPDATE_PUBLIC_KEY: publicKey,
  }, "darwin/arm64");
  requireDesktopReleaseUpdateSigning(legacy, undefined, true);
  const release = desktopMygoBuildArguments("darwin/arm64", {
    identity: "Developer ID Application: Fixture (ABCDE12345)",
    outputRoot: "/tmp/stage",
  });
  assert.deepEqual(release, ["tool", "mygo", "build", "-platform", "darwin/arm64",
    "-sign", "Developer ID Application: Fixture (ABCDE12345)", "-o", "/tmp/stage"]);
  assert.ok(!release.includes("-upload"));
  assert.deepEqual(desktopMygoBuildArguments("windows/amd64"),
    ["tool", "mygo", "build", "-platform", "windows/amd64", "-sign", "-", "-skip-notarize"]);
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
  const development = inspectDesktopConfig("0", "build");
  assert.deepEqual(inspectDesktopConfig("1", "dev"), development);
  assert.equal(development.identifier, "org.linksense.desktop");
  assert.equal(development.slug, desktopSlug);
  assert.equal(development.version, desktopVersion);
  assert.equal(development.updates, undefined);
  assert.deepEqual(development.urlSchemes, ["linksense-desktop"]);
  assert.deepEqual(development.macos, { icon: "AppIcon.icns", signingIdentity: "-" });
  const release = inspectDesktopConfig("1", "build");
  assert.deepEqual(release.macos, {
    icon: "AppIcon.icns",
    signingIdentity: "-",
    notarize: { keychainProfile: "linksense-desktop-notary" },
    helperEntitlements: { "runtime/bin/node": "node-release.entitlements.plist" },
  });
});

test("the MyGo configuration uses the selected update root and private key path", () => {
  const { publicKey } = ed25519Keys();
  const build = inspectDesktopConfig("0", "build", {
    LINKSENSE_DESKTOP_VERSION: "1.2.3-beta.1",
    LINKSENSE_DESKTOP_UPDATE_CONFIG_URL: "https://updates.example.test/beta",
    LINKSENSE_DESKTOP_UPDATE_PUBLIC_KEY: publicKey,
    LINKSENSE_DESKTOP_UPDATE_PRIVATE_KEY_FILE: "/secure/mygo-update.key",
  });
  assert.equal(build.version, "1.2.3-beta.1");
  assert.deepEqual(build.updates, {
    publicKey,
    url: "https://updates.example.test/beta",
    deltas: 3,
    privateKey: "/secure/mygo-update.key",
  });
  assert.equal(inspectDesktopConfig("0", "build", {
    LINKSENSE_DESKTOP_UPDATE_CONFIG_URL: "",
  }).updates, undefined);
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

test("macOS packaging stages the pinned permissionflow attribution", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "linksense-desktop-permissionflow-notice-"));
  const output = path.join(directory, "notices");
  try {
    await writeFile(path.join(directory, "go.mod"), `module fixture.test/desktop
go 1.27.3
require github.com/egoist/mygo v0.0.0
replace github.com/egoist/mygo => ./mygo
`);
    await writeFile(path.join(directory, "main.go"), `package main
import _ "github.com/egoist/mygo/plugins/permissionflow"
func main() {}
`);
    const plugin = path.join(directory, "mygo", "plugins", "permissionflow");
    await mkdir(plugin, { recursive: true });
    await writeFile(path.join(directory, "mygo", "go.mod"), "module github.com/egoist/mygo\ngo 1.27.3\n");
    await writeFile(path.join(directory, "mygo", "LICENSE"), "mygo license\n");
    await writeFile(path.join(plugin, "permissionflow.go"), "package permissionflow\n");
    await writeFile(path.join(plugin, "NOTICE.md"), "This package follows PermissionFlow.\n");
    await stageDesktopDependencyNotices("darwin/arm64", output, directory);
    assert.equal(
      await readFile(path.join(output, "github.com/egoist/mygo/plugins/permissionflow/NOTICE.md"), "utf8"),
      "This package follows PermissionFlow.\n",
    );
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
